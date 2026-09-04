import { Database } from 'bun:sqlite';
import path from 'node:path';
import { Hono } from 'hono';
import { registerAdminRoutes } from './admin-routes.js';
import { issueOwnerClaim } from './admin-storage.js';
import { registerConnectionRoutes } from './connection-routes.js';
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
  currentSchemaVersion,
  ensureSingleUser,
  initializeSchema,
  renameDevice,
  requireDevice,
  requireSession,
  rotateDeviceToken,
  type FileHead,
} from './storage.js';
import { registerSyncV2Routes } from './v2-routes.js';

export type { RateLimitOptions } from './http.js';

export interface CreateAppOptions {
  dbPath?: string;
  singleUserToken?: string;
  now?: () => Date;
  bodyLimitBytes?: number;
  rateLimit?: RateLimitOptions | false;
  allowRegistration?: boolean;
  enableLegacyV1?: boolean;
  publicUrl?: string;
  adminAssetsPath?: string;
  backupDirectory?: string;
  onOwnerClaimLink?: (link: string) => void;
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
const serviceVersion = '0.5.16';
const protocolVersion = 1;
const defaultBodyLimitBytes = 5 * 1024 * 1024;
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
  const enableLegacyV1 = options.enableLegacyV1 ?? true;
  const publicUrl = requirePublicUrl(options.publicUrl ?? 'https://localhost');
  const rateLimiter = createRateLimiter(options.rateLimit, now);
  try {
    initializeSchema(db);
    if (options.singleUserToken !== undefined) {
      ensureSingleUser(db, options.singleUserToken);
    }
    const ownerClaimToken = issueOwnerClaim(db, now);
    if (ownerClaimToken !== null) {
      options.onOwnerClaimLink?.(`${publicUrl}/admin#claim=${encodeURIComponent(ownerClaimToken)}`);
    }
  } catch (error) {
    db.close();
    throw error;
  }

  const app = new Hono();
  appDatabases.set(app, db);

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'",
    );
  });

  registerAdminRoutes(app, db, {
    now,
    bodyLimitBytes,
    rateLimiter,
    publicUrl,
    serviceVersion,
    backupDirectory: options.backupDirectory,
  });
  registerConnectionRoutes(app, db, { now, bodyLimitBytes, rateLimiter, publicUrl });
  registerSyncV2Routes(app, db, { now, bodyLimitBytes, rateLimiter });
  registerAdminAssets(app, options.adminAssetsPath ?? path.resolve('apps/server-admin/dist'));

  if (!enableLegacyV1) {
    app.use('/v1/*', async (c, next) => {
      if (!enableLegacyV1) return c.json(errorBody('not_found', 'not found'), 404);
      await next();
    });
  }

  app.get('/', (c) =>
    c.html(`<!doctype html>
<html>
  <head><title>Reglet sync server</title></head>
  <body>
    <h1>Reglet sync server</h1>
    <p>Use the Reglet encrypted sync preview CLI to pair devices and exchange ciphertext.</p>
    <ul>
      <li>GET /healthz</li>
      <li>GET /readyz</li>
      <li>GET /v2/compatibility</li>
    </ul>
  </body>
</html>
`),
  );

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: { name: 'reglet-sync-server', version: serviceVersion },
      protocol: enableLegacyV1
        ? { current: protocolVersion, supported: [protocolVersion] }
        : { current: 2, supported: [2] },
    }),
  );

  app.get('/readyz', (c) => {
    const row = db.query('select max(version) as version from schema_migrations').get() as { version: number | null };
    return row.version === currentSchemaVersion
      ? c.json({ ready: true })
      : c.json(errorBody('not_ready', 'database schema is not ready'), 503);
  });

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

function registerAdminAssets(app: Hono, assetsPath: string): void {
  const indexPath = path.join(assetsPath, 'index.html');
  app.get('/admin', async () => serveAdminFile(indexPath, fallbackAdminHtml()));
  app.get('/admin/*', async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const relative = pathname.slice('/admin/'.length);
    if (relative.length > 0 && !relative.includes('..') && !relative.includes('\\')) {
      const candidate = path.resolve(assetsPath, relative);
      if (candidate.startsWith(`${path.resolve(assetsPath)}${path.sep}`)) {
        const response = await serveExistingFile(candidate);
        if (response !== null) return response;
      }
    }
    return serveAdminFile(indexPath, fallbackAdminHtml());
  });
  app.get('/connect', async () => serveAdminFile(indexPath, fallbackConnectHtml()));
}

async function serveAdminFile(
  filePath: string,
  fallback: string,
): Promise<Response> {
  return (await serveExistingFile(filePath)) ?? new Response(fallback, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function serveExistingFile(filePath: string): Promise<Response | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return new Response(file, { headers: { 'Content-Type': contentType(filePath) } });
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function fallbackAdminHtml(): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reglet server</title></head><body><main><h1>Reglet server dashboard</h1><p>The dashboard assets are not installed in this server build.</p></main></body></html>';
}

function fallbackConnectHtml(): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Reglet</title></head><body><main><h1>Connect Reglet</h1><p>Open this invitation with the Reglet desktop app or paste the complete link there.</p></main></body></html>';
}

function requirePublicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REGLET_PUBLIC_URL must be an absolute URL');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('REGLET_PUBLIC_URL must use HTTPS except on loopback');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('REGLET_PUBLIC_URL must not contain credentials, a query, or a fragment');
  }
  return url.toString().replace(/\/$/, '');
}

export function closeApp(app: Hono): void {
  const db = appDatabases.get(app);
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}
    db.close();
  }
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
