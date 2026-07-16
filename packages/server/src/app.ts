import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import {
  createRateLimiter,
  errorBody,
  readJsonBody,
  syncFilePath,
  type JsonResponse,
  type RateLimitOptions,
} from './http.js';
import {
  accountCredentials,
  assertStrongToken,
  hashSecret,
  isSqliteConstraint,
  isStrictBase64,
  isValidRevision,
  maximumPasswordLength,
  normalizeDeviceName,
  normalizeEmail,
  randomCode,
  randomToken,
  verifySecret,
} from './security.js';
import {
  claimPairCode,
  commitFileRevision,
  createSession,
  ensureSingleUser,
  initializeSchema,
  renameDevice,
  requireDevice,
  requireSession,
  rotateDeviceToken,
  type FileHead,
} from './storage.js';

export type { RateLimitOptions } from './http.js';

export interface CreateAppOptions {
  dbPath?: string;
  singleUserToken?: string;
  now?: () => Date;
  bodyLimitBytes?: number;
  rateLimit?: RateLimitOptions | false;
  allowRegistration?: boolean;
}

interface RegisterBody {
  email?: unknown;
  password?: unknown;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface PairClaimBody {
  code?: unknown;
  deviceName?: unknown;
}

interface PutFileBody {
  baseRevision?: unknown;
  contentBase64?: unknown;
}

interface DeleteFileBody {
  baseRevision?: unknown;
}

interface RenameDeviceBody {
  name?: unknown;
}

const appDatabases = new WeakMap<Hono, Database>();
const serviceVersion = '0.1.0';
const protocolVersion = 1;
const defaultBodyLimitBytes = 256 * 1024;
const changesPageSize = 100;

export function createApp(options: CreateAppOptions = {}): Hono {
  if (options.singleUserToken !== undefined) {
    assertStrongToken(options.singleUserToken);
  }
  const db = new Database(options.dbPath ?? ':memory:');
  const now = options.now ?? (() => new Date());
  const bodyLimitBytes = options.bodyLimitBytes ?? defaultBodyLimitBytes;
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes < 1) {
    throw new Error('bodyLimitBytes must be a positive safe integer');
  }
  if (options.singleUserToken !== undefined && options.allowRegistration === true) {
    throw new Error('Single-user token mode cannot enable public account registration');
  }
  const allowRegistration = options.allowRegistration === true;
  const rateLimiter = createRateLimiter(options.rateLimit, now);
  initializeSchema(db);
  if (options.singleUserToken !== undefined) {
    ensureSingleUser(db, options.singleUserToken);
  }

  const app = new Hono();
  appDatabases.set(app, db);

  app.get('/', (c) =>
    c.html(`<!doctype html>
<html>
  <head><title>Reglet sync server</title></head>
  <body>
    <h1>Reglet sync server</h1>
    <p>Use the Reglet CLI to register, pair devices, and sync master directory files.</p>
    <ul>
      <li>GET /healthz</li>
      <li>POST /v1/auth/register</li>
      <li>POST /v1/auth/login</li>
      <li>POST /v1/pair/start</li>
      <li>POST /v1/pair/claim</li>
      <li>GET /v1/changes?since=&lt;seq&gt;</li>
    </ul>
  </body>
</html>
`),
  );

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: { name: 'reglet-sync-server', version: serviceVersion },
      protocol: { current: protocolVersion, supported: [protocolVersion] },
    }),
  );

  app.get('/v1/compatibility', (c) =>
    c.json({
      service: { name: 'reglet-sync-server', version: serviceVersion },
      protocol: { current: protocolVersion, supported: [protocolVersion] },
    }),
  );

  app.post('/v1/auth/register', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'auth');
    if (!limited.ok) {
      return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    }

    if (!allowRegistration) {
      return c.json(errorBody('registration_disabled', 'account registration is disabled'), 403);
    }
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as RegisterBody;
    const credentials = accountCredentials(body.email, body.password);
    if (!credentials.ok) {
      return c.json(errorBody('invalid_request', credentials.message), 400);
    }

    try {
      const passHash = await hashSecret(credentials.password);
      db.query('insert into users (email, pass_hash) values (?, ?)').run(credentials.email, passHash);
      const row = db.query('select last_insert_rowid() as id').get() as { id: number };
      return c.json(createSession(db, row.id, now));
    } catch (error) {
      if (isSqliteConstraint(error)) {
        return c.json(errorBody('user_exists', 'user already exists'), 409);
      }
      throw error;
    }
  });

  app.post('/v1/auth/login', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'auth');
    if (!limited.ok) {
      return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    }

    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as LoginBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return c.json(errorBody('invalid_request', 'email and password are required'), 400);
    }
    const email = normalizeEmail(body.email);
    if (email === null || body.password.length > maximumPasswordLength) {
      return c.json(errorBody('invalid_credentials', 'invalid credentials'), 401);
    }

    const user = db.query('select id, pass_hash from users where email = ?').get(email) as
      | { id: number; pass_hash: string }
      | null;
    if (user === null || !(await verifySecret(body.password, user.pass_hash))) {
      return c.json(errorBody('invalid_credentials', 'invalid credentials'), 401);
    }

    return c.json(createSession(db, user.id, now));
  });

  app.post('/v1/pair/start', (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) {
      return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    }

    const session = requireSession(db, c.req.header('authorization'), now);
    if (session === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const code = randomCode();
    db.query('insert into pair_codes (code, user_id, expires_at) values (?, ?, ?)').run(
      code,
      session.userId,
      now().getTime() + 10 * 60 * 1000,
    );
    return c.json({ code });
  });

  app.post('/v1/pair/claim', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) {
      return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    }

    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as PairClaimBody;
    if (typeof body.code !== 'string' || typeof body.deviceName !== 'string') {
      return c.json(errorBody('invalid_request', 'code and deviceName are required'), 400);
    }
    const deviceName = normalizeDeviceName(body.deviceName);
    if (deviceName === null) {
      return c.json(errorBody('invalid_request', 'deviceName is invalid'), 400);
    }

    const deviceToken = randomToken();
    const claimed = claimPairCode(db, body.code, deviceName, deviceToken, now);
    if (!claimed) {
      return c.json(errorBody('invalid_pair_code', 'invalid pair code'), 404);
    }
    return c.json({ deviceToken });
  });

  app.get('/v1/changes', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const since = Number(c.req.query('since') ?? '0');
    if (!isValidRevision(since)) {
      return c.json(errorBody('invalid_request', 'since must be a non-negative safe integer'), 400);
    }
    const rows = db
      .query(
        'select path, revision, hash, deleted, seq from files where user_id = ? and seq > ? order by seq asc limit ?',
      )
      .all(device.userId, since, changesPageSize + 1) as Array<{
      path: string;
      revision: number;
      hash: string;
      deleted: number;
      seq: number;
    }>;
    const hasMore = rows.length > changesPageSize;
    const page = hasMore ? rows.slice(0, changesPageSize) : rows;
    const cursor = page.reduce((max, row) => Math.max(max, row.seq), since);
    return c.json({
      changes: page.map((row) => ({
        path: row.path,
        revision: row.revision,
        hash: row.hash,
        deleted: row.deleted === 1,
        seq: row.seq,
      })),
      cursor,
      hasMore,
    });
  });

  app.get('/v1/files/*', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const filePath = syncFilePath(c.req.raw);
    if (filePath === null) {
      return c.json(errorBody('invalid_path', 'path is not in the supported sync scope'), 400);
    }

    const file = db
      .query('select revision, hash, content, deleted from files where user_id = ? and path = ?')
      .get(device.userId, filePath) as { revision: number; hash: string; content: Uint8Array; deleted: number } | null;
    if (file === null || file.deleted === 1) {
      return c.json(errorBody('not_found', 'not found'), 404);
    }
    return c.json({
      revision: file.revision,
      hash: file.hash,
      contentBase64: Buffer.from(file.content).toString('base64'),
    });
  });

  app.put('/v1/files/*', async (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const filePath = syncFilePath(c.req.raw);
    if (filePath === null) {
      return c.json(errorBody('invalid_path', 'path is not in the supported sync scope'), 400);
    }

    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as PutFileBody;
    if (!isValidRevision(body.baseRevision) || typeof body.contentBase64 !== 'string') {
      return c.json(errorBody('invalid_request', 'baseRevision and contentBase64 are required'), 400);
    }
    if (!isStrictBase64(body.contentBase64)) {
      return c.json(errorBody('invalid_base64', 'contentBase64 must be strict valid base64'), 400);
    }

    const content = Buffer.from(body.contentBase64, 'base64');
    const commit = commitFileRevision(db, device.userId, filePath, body.baseRevision, content, false, now);
    return commit.ok ? c.json({ revision: commit.revision }) : conflict(c, commit.head);
  });

  app.delete('/v1/files/*', async (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const filePath = syncFilePath(c.req.raw);
    if (filePath === null) {
      return c.json(errorBody('invalid_path', 'path is not in the supported sync scope'), 400);
    }

    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as DeleteFileBody;
    if (!isValidRevision(body.baseRevision)) {
      return c.json(errorBody('invalid_request', 'baseRevision is required'), 400);
    }

    const commit = commitFileRevision(db, device.userId, filePath, body.baseRevision, new Uint8Array(), true, now);
    return commit.ok ? c.json({ revision: commit.revision }) : conflict(c, commit.head);
  });

  app.get('/v1/devices', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const devices = db
      .query('select id, name, created_at, last_seen_at, revoked_at from devices where user_id = ? order by id asc')
      .all(device.userId) as Array<{
      id: number;
      name: string;
      created_at: string;
      last_seen_at: string | null;
      revoked_at: string | null;
    }>;
    return c.json({
      currentDeviceId: device.deviceId,
      devices: devices.map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.created_at,
        lastSeenAt: item.last_seen_at,
        revokedAt: item.revoked_at,
      })),
    });
  });

  app.patch('/v1/devices/:id', async (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id < 1) {
      return c.json(errorBody('invalid_request', 'device id is invalid'), 400);
    }
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const nameValue = (parsed.value as RenameDeviceBody).name;
    const name = typeof nameValue === 'string' ? normalizeDeviceName(nameValue) : null;
    if (name === null) return c.json(errorBody('invalid_request', 'device name is invalid'), 400);
    if (!renameDevice(db, device.userId, id, name)) {
      return c.json(errorBody('not_found', 'device not found'), 404);
    }
    return c.json({ renamed: true, id, name });
  });

  app.post('/v1/devices/current/token/rotate', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    return c.json({ deviceToken: rotateDeviceToken(db, device.userId, device.deviceId) });
  });

  app.delete('/v1/devices/:id', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id < 1) {
      return c.json(errorBody('invalid_request', 'device id is invalid'), 400);
    }
    const result = db
      .query('update devices set revoked_at = ? where id = ? and user_id = ? and revoked_at is null')
      .run(now().toISOString(), id, device.userId);
    if (result.changes !== 1) return c.json(errorBody('not_found', 'device not found'), 404);
    return c.json({ revoked: true, id });
  });

  app.notFound((c) => c.json(errorBody('not_found', 'not found'), 404));

  return app;
}

export function closeApp(app: Hono): void {
  appDatabases.get(app)?.close();
  appDatabases.delete(app);
}

function conflict(c: { json: (value: JsonResponse, status?: number) => Response }, head: FileHead | null): Response {
  return c.json(
    {
      ...errorBody('conflict', 'file revision conflict'),
      headRevision: head?.revision ?? 0,
      headHash: head?.hash ?? '',
      headDeleted: head?.deleted === 1,
      contentBase64: head === null || head.deleted === 1 ? '' : Buffer.from(head.content).toString('base64'),
    },
    409,
  );
}
