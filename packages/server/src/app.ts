import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';

export interface CreateAppOptions {
  dbPath?: string;
  singleUserToken?: string;
  now?: () => Date;
  bodyLimitBytes?: number;
  rateLimit?: RateLimitOptions | false;
}

interface JsonResponse {
  [key: string]: unknown;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  key?: (request: Request) => string;
}

interface ErrorBody extends JsonResponse {
  error: {
    code: string;
    message: string;
  };
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

interface Session {
  userId: number;
}

const singleUserEmail = 'single-user@reglet.local';
const singleUserPassword = 'single-user';
const appDatabases = new WeakMap<Hono, Database>();
const serviceVersion = '0.1.0';
const protocolVersion = 1;
const defaultBodyLimitBytes = 256 * 1024;
const defaultRateLimitWindowMs = 60 * 1000;
const defaultRateLimitMax = 60;
const minimumTokenLength = 20;

export function createApp(options: CreateAppOptions = {}): Hono {
  if (options.singleUserToken !== undefined) {
    assertStrongToken(options.singleUserToken);
  }
  const db = new Database(options.dbPath ?? ':memory:');
  const now = options.now ?? (() => new Date());
  const bodyLimitBytes = options.bodyLimitBytes ?? defaultBodyLimitBytes;
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

    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) {
      return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    }
    const body = parsed.value as RegisterBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return c.json(errorBody('invalid_request', 'email and password are required'), 400);
    }

    try {
      const passHash = hashSecret(body.password);
      db.query('insert into users (email, pass_hash) values (?, ?)').run(body.email, passHash);
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

    const user = db.query('select id, pass_hash from users where email = ?').get(body.email) as
      | { id: number; pass_hash: string }
      | null;
    if (user === null || !verifySecret(body.password, user.pass_hash)) {
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

    const pairCode = db.query('select user_id, expires_at from pair_codes where code = ?').get(body.code) as
      | { user_id: number; expires_at: number }
      | null;
    if (pairCode === null || pairCode.expires_at < now().getTime()) {
      return c.json(errorBody('invalid_pair_code', 'invalid pair code'), 404);
    }
    db.query('delete from pair_codes where code = ?').run(body.code);

    const deviceToken = randomToken();
    db.query('insert into devices (user_id, name, token_hash, created_at) values (?, ?, ?, ?)').run(
      pairCode.user_id,
      body.deviceName,
      hashToken(deviceToken),
      now().toISOString(),
    );
    return c.json({ deviceToken });
  });

  app.get('/v1/changes', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), options.singleUserToken);
    if (device === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }

    const since = Number(c.req.query('since') ?? '0');
    const rows = db
      .query(
        'select path, revision, hash, deleted, seq from files where user_id = ? and seq > ? order by seq asc',
      )
      .all(device.userId, Number.isFinite(since) ? since : 0) as Array<{
      path: string;
      revision: number;
      hash: string;
      deleted: number;
      seq: number;
    }>;
    const cursor = rows.reduce((max, row) => Math.max(max, row.seq), Number.isFinite(since) ? since : 0);
    return c.json({
      changes: rows.map((row) => ({
        path: row.path,
        revision: row.revision,
        hash: row.hash,
        deleted: row.deleted === 1,
        seq: row.seq,
      })),
      cursor,
    });
  });

  app.get('/v1/files/*', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), options.singleUserToken);
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
    const device = requireDevice(db, c.req.header('authorization'), options.singleUserToken);
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

    const head = getFileHead(db, device.userId, filePath);
    if ((head?.revision ?? 0) !== body.baseRevision) {
      return conflict(c, head);
    }

    const content = Buffer.from(body.contentBase64, 'base64');
    const revision = body.baseRevision + 1;
    const hash = sha256(content);
    const seq = nextSeq(db, device.userId);
    upsertFile(db, device.userId, filePath, revision, hash, content, 0, seq);
    insertHistory(db, device.userId, filePath, revision, hash, content, now);
    return c.json({ revision });
  });

  app.delete('/v1/files/*', async (c) => {
    const device = requireDevice(db, c.req.header('authorization'), options.singleUserToken);
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

    const head = getFileHead(db, device.userId, filePath);
    if ((head?.revision ?? 0) !== body.baseRevision) {
      return conflict(c, head);
    }

    const revision = body.baseRevision + 1;
    const seq = nextSeq(db, device.userId);
    upsertFile(db, device.userId, filePath, revision, '', new Uint8Array(), 1, seq);
    insertHistory(db, device.userId, filePath, revision, '', new Uint8Array(), now);
    return c.json({ revision });
  });

  app.notFound((c) => c.json(errorBody('not_found', 'not found'), 404));

  return app;
}

export function closeApp(app: Hono): void {
  appDatabases.get(app)?.close();
  appDatabases.delete(app);
}

function initializeSchema(db: Database): void {
  db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);
`);
  const current = db.query('select version from schema_migrations where version = 1').get() as
    | { version: number }
    | null;
  if (current !== null) {
    return;
  }

  const migrate = db.transaction(() => {
  db.exec(`
create table if not exists users (
  id integer primary key autoincrement,
  email text not null unique,
  pass_hash text not null
);
create table if not exists devices (
  id integer primary key autoincrement,
  user_id integer not null,
  name text not null,
  token_hash text not null unique,
  created_at text not null
);
create table if not exists files (
  user_id integer not null,
  path text not null,
  revision integer not null,
  hash text not null,
  content blob not null,
  deleted integer not null,
  seq integer not null,
  primary key (user_id, path)
);
create table if not exists file_history (
  user_id integer not null,
  path text not null,
  revision integer not null,
  hash text not null,
  content blob not null,
  created_at text not null
);
create table if not exists user_seq (
  user_id integer primary key,
  seq integer not null
);
create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null,
  expires_at integer not null
);
create table if not exists pair_codes (
  code text primary key,
  user_id integer not null,
  expires_at integer not null
);
`);
    db.query('insert into schema_migrations (version, applied_at) values (?, ?)').run(1, new Date().toISOString());
  });
  migrate();
}

function ensureSingleUser(db: Database, token: string): void {
  const existing = db.query('select id from users where email = ?').get(singleUserEmail) as { id: number } | null;
  const userId =
    existing?.id ??
    (
      db.query('insert into users (email, pass_hash) values (?, ?) returning id').get(
        singleUserEmail,
        hashSecret(singleUserPassword),
      ) as { id: number }
    ).id;
  const tokenHash = hashToken(token);
  const device = db.query('select id from devices where token_hash = ?').get(tokenHash);
  if (device === null) {
    db.query('insert into devices (user_id, name, token_hash, created_at) values (?, ?, ?, ?)').run(
      userId,
      'single-user-token',
      tokenHash,
      new Date().toISOString(),
    );
  }
}

function createSession(db: Database, userId: number, now: () => Date): JsonResponse {
  const token = randomToken();
  db.query('insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)').run(
    hashToken(token),
    userId,
    now().getTime() + 60 * 60 * 1000,
  );
  return { sessionToken: token };
}

function requireSession(db: Database, header: string | undefined, now: () => Date): Session | null {
  const token = bearerToken(header);
  if (token === null) {
    return null;
  }
  const session = db.query('select user_id, expires_at from sessions where token_hash = ?').get(hashToken(token)) as
    | { user_id: number; expires_at: number }
    | null;
  if (session === null || session.expires_at < now().getTime()) {
    return null;
  }
  return { userId: session.user_id };
}

function requireDevice(
  db: Database,
  header: string | undefined,
  singleUserToken: string | undefined,
): { userId: number } | null {
  const token = bearerToken(header);
  if (token === null) {
    return null;
  }
  if (singleUserToken !== undefined && token === singleUserToken) {
    const user = db.query('select id from users where email = ?').get(singleUserEmail) as { id: number } | null;
    return user === null ? null : { userId: user.id };
  }
  const tokenHash = hashToken(token);
  const row = db.query('select user_id from devices where token_hash = ?').get(tokenHash) as { user_id: number } | null;
  return row === null ? null : { userId: row.user_id };
}

function getFileHead(
  db: Database,
  userId: number,
  filePath: string,
): { revision: number; hash: string; content: Uint8Array; deleted: number } | null {
  return db
    .query('select revision, hash, content, deleted from files where user_id = ? and path = ?')
    .get(userId, filePath) as { revision: number; hash: string; content: Uint8Array; deleted: number } | null;
}

function conflict(c: { json: (value: JsonResponse, status?: number) => Response }, head: ReturnType<typeof getFileHead>): Response {
  return c.json(
    {
      ...errorBody('conflict', 'file revision conflict'),
      headRevision: head?.revision ?? 0,
      contentBase64: head === null ? '' : Buffer.from(head.content).toString('base64'),
    },
    409,
  );
}

function upsertFile(
  db: Database,
  userId: number,
  filePath: string,
  revision: number,
  hash: string,
  content: Uint8Array,
  deleted: number,
  seq: number,
): void {
  db.query(
    `insert into files (user_id, path, revision, hash, content, deleted, seq)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(user_id, path) do update set
       revision = excluded.revision,
       hash = excluded.hash,
       content = excluded.content,
       deleted = excluded.deleted,
       seq = excluded.seq`,
  ).run(userId, filePath, revision, hash, content, deleted, seq);
}

function insertHistory(
  db: Database,
  userId: number,
  filePath: string,
  revision: number,
  hash: string,
  content: Uint8Array,
  now: () => Date,
): void {
  db.query('insert into file_history (user_id, path, revision, hash, content, created_at) values (?, ?, ?, ?, ?, ?)').run(
    userId,
    filePath,
    revision,
    hash,
    content,
    now().toISOString(),
  );
}

function nextSeq(db: Database, userId: number): number {
  const current = db.query('select seq from user_seq where user_id = ?').get(userId) as { seq: number } | null;
  const seq = (current?.seq ?? 0) + 1;
  db.query(
    `insert into user_seq (user_id, seq) values (?, ?)
     on conflict(user_id) do update set seq = excluded.seq`,
  ).run(userId, seq);
  return seq;
}

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (salt === undefined || hash === undefined) {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(secret, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return sha256(Buffer.from(token));
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

function randomCode(): string {
  return randomBytes(4).toString('base64url').replaceAll('-', 'A').replaceAll('_', 'B').slice(0, 6);
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

function isSqliteConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: string; message: string };

async function readJsonBody(request: Request, limitBytes: number): Promise<JsonParseResult> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > limitBytes) {
      return { ok: false, status: 413, code: 'body_too_large', message: 'request body is too large' };
    }
  }

  const body = await readLimitedText(request, limitBytes);
  if (!body.ok) {
    return { ok: false, status: 413, code: 'body_too_large', message: 'request body is too large' };
  }

  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'request body must be valid JSON' };
  }
}

async function readLimitedText(request: Request, limitBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  if (request.body === null) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    bytes += chunk.value.byteLength;
    if (bytes > limitBytes) {
      await reader.cancel();
      return { ok: false };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}

function assertStrongToken(token: string): void {
  if (!isStrongToken(token)) {
    throw new Error(`REGLET_TOKEN must be at least ${minimumTokenLength} non-whitespace characters`);
  }
}

function isStrongToken(token: string): boolean {
  return token.trim() === token && token.length >= minimumTokenLength && new Set(token).size >= 8;
}

function isValidRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  if (value.length % 4 !== 0) {
    return false;
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function syncFilePath(request: Request): string | null {
  const rawPath = new URL(request.url).pathname;
  const prefix = '/v1/files/';
  if (!rawPath.startsWith(prefix)) {
    return null;
  }

  const rawFilePath = rawPath.slice(prefix.length);
  if (rawFilePath.length === 0 || containsEncodedSlash(rawFilePath)) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawFilePath);
  } catch {
    return null;
  }
  if (
    decoded !== rawFilePath &&
    (containsEncodedTraversal(rawFilePath) || containsEncodedTraversal(decoded) || containsEncodedSlash(decoded))
  ) {
    return null;
  }
  return isAllowedSyncPath(decoded) ? decoded : null;
}

function containsEncodedSlash(rawPath: string): boolean {
  return /%2f|%5c/i.test(rawPath);
}

function containsEncodedTraversal(rawPath: string): boolean {
  return /%2e/i.test(rawPath) && decodedSegments(rawPath).includes('..');
}

function decodedSegments(rawPath: string): string[] {
  try {
    return decodeURIComponent(rawPath).split('/');
  } catch {
    return [];
  }
}

function isAllowedSyncPath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.startsWith('/') ||
    filePath.startsWith('~') ||
    filePath.includes('\\') ||
    filePath.includes('\0')
  ) {
    return false;
  }
  const segments = filePath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }
  if (segments.includes('.state') || segments.some((segment) => isBackupOrConflictArtifact(segment))) {
    return false;
  }
  return (
    filePath === 'reglet.toml' ||
    filePath === 'mcp/servers.json' ||
    (filePath.startsWith('rules/') && segments.length >= 2) ||
    (filePath.startsWith('skills/') && segments.length >= 2)
  );
}

function isBackupOrConflictArtifact(segment: string): boolean {
  return (
    segment.endsWith('~') ||
    segment.endsWith('.bak') ||
    segment.endsWith('.backup') ||
    segment.includes('.conflict-')
  );
}

interface RateLimiter {
  check: (request: Request, bucket: 'auth' | 'pair') => { ok: true } | { ok: false };
}

function createRateLimiter(options: RateLimitOptions | false | undefined, now: () => Date): RateLimiter {
  if (options === false) {
    return { check: () => ({ ok: true }) };
  }

  const windowMs = options?.windowMs ?? defaultRateLimitWindowMs;
  const max = options?.max ?? defaultRateLimitMax;
  const keyFor = options?.key ?? defaultRateLimitKey;
  const buckets = new Map<string, { resetAt: number; count: number }>();

  return {
    check(request: Request, bucket: 'auth' | 'pair') {
      const key = `${bucket}:${keyFor(request)}`;
      const timestamp = now().getTime();
      const current = buckets.get(key);
      if (current === undefined || current.resetAt <= timestamp) {
        buckets.set(key, { resetAt: timestamp + windowMs, count: 1 });
        return { ok: true };
      }
      current.count += 1;
      if (current.count > max) {
        return { ok: false };
      }
      return { ok: true };
    },
  };
}

function defaultRateLimitKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}
