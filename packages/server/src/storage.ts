import { Database } from 'bun:sqlite';
import { hashToken, randomToken, sha256 } from './security.js';

interface Session {
  userId: number;
}

export interface DeviceAuth {
  userId: number;
  deviceId: number;
}

export interface FileHead {
  revision: number;
  hash: string;
  content: Uint8Array;
  deleted: number;
}

export type FileCommitResult =
  | { ok: true; revision: number }
  | { ok: false; head: FileHead | null };

const singleUserEmail = 'single-user@reglet.local';
const singleUserPassword = 'single-user';

export function initializeSchema(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);
`);
  const current = db.query('select version from schema_migrations where version = 1').get() as
    | { version: number }
    | null;
  if (current === null) {
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
  created_at text not null,
  last_seen_at text,
  revoked_at text
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

  const indexes = db.query('select version from schema_migrations where version = 2').get() as
    | { version: number }
    | null;
  if (indexes === null) {
    const migrate = db.transaction(() => {
      db.exec(`
create index if not exists files_user_seq on files (user_id, seq);
create index if not exists history_user_path_revision on file_history (user_id, path, revision);
create index if not exists sessions_expiry on sessions (expires_at);
create index if not exists pair_codes_expiry on pair_codes (expires_at);
`);
      db.query('insert into schema_migrations (version, applied_at) values (?, ?)').run(2, new Date().toISOString());
    });
    migrate();
  }

  const devices = db.query('select version from schema_migrations where version = 3').get() as
    | { version: number }
    | null;
  if (devices === null) {
    const migrate = db.transaction(() => {
      if (!hasColumn(db, 'devices', 'last_seen_at')) db.exec('alter table devices add column last_seen_at text');
      if (!hasColumn(db, 'devices', 'revoked_at')) db.exec('alter table devices add column revoked_at text');
      db.query('insert into schema_migrations (version, applied_at) values (?, ?)').run(3, new Date().toISOString());
    });
    migrate();
  }
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.query(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((item) => item.name === column);
}

export function ensureSingleUser(db: Database, token: string): void {
  const existing = db.query('select id from users where email = ?').get(singleUserEmail) as { id: number } | null;
  const userId = existing?.id ?? (
    db.query('insert into users (email, pass_hash) values (?, ?) returning id').get(
      singleUserEmail,
      singleUserPassword,
    ) as { id: number }
  ).id;
  const tokenHash = hashToken(token);
  const device = db.query('select id from devices where token_hash = ?').get(tokenHash) as { id: number } | null;
  if (device === null) {
    db.query('insert into devices (user_id, name, token_hash, created_at) values (?, ?, ?, ?)').run(
      userId,
      'single-user-token',
      tokenHash,
      new Date().toISOString(),
    );
  } else {
    db.query('update devices set revoked_at = null where id = ?').run(device.id);
  }
}

export function createSession(db: Database, userId: number, now: () => Date): { sessionToken: string } {
  const token = randomToken();
  db.query('insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)').run(
    hashToken(token),
    userId,
    now().getTime() + 60 * 60 * 1000,
  );
  return { sessionToken: token };
}

export function requireSession(db: Database, header: string | undefined, now: () => Date): Session | null {
  const token = bearer(header);
  if (token === null) return null;
  const tokenHash = hashToken(token);
  const session = db.query('select user_id, expires_at from sessions where token_hash = ?').get(tokenHash) as
    | { user_id: number; expires_at: number }
    | null;
  if (session === null || session.expires_at < now().getTime()) {
    if (session !== null) db.query('delete from sessions where token_hash = ?').run(tokenHash);
    return null;
  }
  return { userId: session.user_id };
}

export function requireDevice(db: Database, header: string | undefined, now: () => Date): DeviceAuth | null {
  const token = bearer(header);
  if (token === null) return null;
  const tokenHash = hashToken(token);
  const row = db.query('select id, user_id from devices where token_hash = ? and revoked_at is null').get(tokenHash) as
    | { id: number; user_id: number }
    | null;
  if (row === null) return null;
  db.query('update devices set last_seen_at = ? where id = ?').run(now().toISOString(), row.id);
  return { userId: row.user_id, deviceId: row.id };
}

export function renameDevice(db: Database, userId: number, deviceId: number, name: string): boolean {
  return db
    .query('update devices set name = ? where id = ? and user_id = ? and revoked_at is null')
    .run(name, deviceId, userId).changes === 1;
}

export function rotateDeviceToken(db: Database, userId: number, deviceId: number): string {
  const token = randomToken();
  const update = db
    .query('update devices set token_hash = ? where id = ? and user_id = ? and revoked_at is null')
    .run(hashToken(token), deviceId, userId);
  if (update.changes !== 1) throw new Error('Device token rotation target disappeared');
  return token;
}

function bearer(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
}

export function getFileHead(db: Database, userId: number, filePath: string): FileHead | null {
  return db
    .query('select revision, hash, content, deleted from files where user_id = ? and path = ?')
    .get(userId, filePath) as FileHead | null;
}

export function claimPairCode(
  db: Database,
  code: string,
  deviceName: string,
  deviceToken: string,
  now: () => Date,
): boolean {
  const claim = db.transaction(() => {
    const pairCode = db.query('select user_id, expires_at from pair_codes where code = ?').get(code) as
      | { user_id: number; expires_at: number }
      | null;
    if (pairCode === null || pairCode.expires_at < now().getTime()) {
      if (pairCode !== null) db.query('delete from pair_codes where code = ?').run(code);
      return false;
    }
    const deletion = db.query('delete from pair_codes where code = ?').run(code);
    if (deletion.changes !== 1) return false;
    db.query('insert into devices (user_id, name, token_hash, created_at) values (?, ?, ?, ?)').run(
      pairCode.user_id,
      deviceName,
      hashToken(deviceToken),
      now().toISOString(),
    );
    return true;
  });
  return claim();
}

export function commitFileRevision(
  db: Database,
  userId: number,
  filePath: string,
  baseRevision: number,
  content: Uint8Array,
  deleted: boolean,
  now: () => Date,
): FileCommitResult {
  const commit = db.transaction((): FileCommitResult => {
    const head = getFileHead(db, userId, filePath);
    if ((head?.revision ?? 0) !== baseRevision) return { ok: false, head };
    const revision = baseRevision + 1;
    const hash = deleted ? '' : sha256(content);
    const seq = nextSeq(db, userId);
    upsertFile(db, userId, filePath, revision, hash, content, deleted ? 1 : 0, seq);
    insertHistory(db, userId, filePath, revision, hash, content, now);
    return { ok: true, revision };
  });
  return commit();
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
