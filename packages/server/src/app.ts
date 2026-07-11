import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';

export interface CreateAppOptions {
  dbPath?: string;
  singleUserToken?: string;
  now?: () => Date;
}

interface JsonResponse {
  [key: string]: unknown;
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
  token: string;
  expiresAt: number;
}

interface PairCode {
  userId: number;
  code: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();
const pairCodes = new Map<string, PairCode>();
const singleUserEmail = 'single-user@reglet.local';
const singleUserPassword = 'single-user';

export function createApp(options: CreateAppOptions = {}): Hono {
  const db = new Database(options.dbPath ?? ':memory:');
  const now = options.now ?? (() => new Date());
  initializeSchema(db);
  if (options.singleUserToken !== undefined) {
    ensureSingleUser(db, options.singleUserToken);
  }

  const app = new Hono();

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

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/v1/auth/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as RegisterBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return c.json({ error: 'email and password are required' }, 400);
    }

    try {
      const passHash = hashSecret(body.password);
      db.query('insert into users (email, pass_hash) values (?, ?)').run(body.email, passHash);
      const row = db.query('select last_insert_rowid() as id').get() as { id: number };
      return c.json(createSession(row.id, now));
    } catch (error) {
      if (isSqliteConstraint(error)) {
        return c.json({ error: 'user already exists' }, 409);
      }
      throw error;
    }
  });

  app.post('/v1/auth/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as LoginBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const user = db.query('select id, pass_hash from users where email = ?').get(body.email) as
      | { id: number; pass_hash: string }
      | null;
    if (user === null || !verifySecret(body.password, user.pass_hash)) {
      return c.json({ error: 'invalid credentials' }, 401);
    }

    return c.json(createSession(user.id, now));
  });

  app.post('/v1/pair/start', (c) => {
    const session = requireSession(c.req.header('authorization'), now);
    if (session === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const code = randomCode();
    pairCodes.set(code, {
      code,
      userId: session.userId,
      expiresAt: now().getTime() + 10 * 60 * 1000,
    });
    return c.json({ code });
  });

  app.post('/v1/pair/claim', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PairClaimBody;
    if (typeof body.code !== 'string' || typeof body.deviceName !== 'string') {
      return c.json({ error: 'code and deviceName are required' }, 400);
    }

    const pairCode = pairCodes.get(body.code);
    if (pairCode === undefined || pairCode.expiresAt < now().getTime()) {
      return c.json({ error: 'invalid pair code' }, 404);
    }
    pairCodes.delete(body.code);

    const deviceToken = randomToken();
    db.query('insert into devices (user_id, name, token_hash, created_at) values (?, ?, ?, ?)').run(
      pairCode.userId,
      body.deviceName,
      hashToken(deviceToken),
      now().toISOString(),
    );
    return c.json({ deviceToken });
  });

  app.get('/v1/changes', (c) => {
    const device = requireDevice(db, c.req.header('authorization'), options.singleUserToken);
    if (device === null) {
      return c.json({ error: 'unauthorized' }, 401);
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
      return c.json({ error: 'unauthorized' }, 401);
    }

    const filePath = c.req.path.replace('/v1/files/', '');
    const file = db
      .query('select revision, hash, content, deleted from files where user_id = ? and path = ?')
      .get(device.userId, filePath) as { revision: number; hash: string; content: Uint8Array; deleted: number } | null;
    if (file === null || file.deleted === 1) {
      return c.json({ error: 'not found' }, 404);
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
      return c.json({ error: 'unauthorized' }, 401);
    }

    const body = (await c.req.json().catch(() => ({}))) as PutFileBody;
    if (typeof body.baseRevision !== 'number' || typeof body.contentBase64 !== 'string') {
      return c.json({ error: 'baseRevision and contentBase64 are required' }, 400);
    }

    const filePath = c.req.path.replace('/v1/files/', '');
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
      return c.json({ error: 'unauthorized' }, 401);
    }

    const body = (await c.req.json().catch(() => ({}))) as DeleteFileBody;
    if (typeof body.baseRevision !== 'number') {
      return c.json({ error: 'baseRevision is required' }, 400);
    }

    const filePath = c.req.path.replace('/v1/files/', '');
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

  return app;
}

function initializeSchema(db: Database): void {
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
`);
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

function createSession(userId: number, now: () => Date): JsonResponse {
  const token = randomToken();
  sessions.set(token, {
    userId,
    token,
    expiresAt: now().getTime() + 60 * 60 * 1000,
  });
  return { sessionToken: token };
}

function requireSession(header: string | undefined, now: () => Date): Session | null {
  const token = bearerToken(header);
  if (token === null) {
    return null;
  }
  const session = sessions.get(token);
  if (session === undefined || session.expiresAt < now().getTime()) {
    return null;
  }
  return session;
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
