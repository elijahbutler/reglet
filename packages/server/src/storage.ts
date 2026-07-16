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
export const currentSchemaVersion = 5;

export function initializeSchema(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);
`);
  const newestSchema = db.query('select max(version) as version from schema_migrations').get() as {
    version: number | null;
  };
  if (newestSchema.version !== null && newestSchema.version > currentSchemaVersion) {
    throw new Error(
      `Database schema version ${newestSchema.version} is newer than this server supports (maximum ${currentSchemaVersion})`,
    );
  }
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

  const encryptedSync = db.query('select version from schema_migrations where version = 4').get() as
    | { version: number }
    | null;
  if (encryptedSync === null) {
    const migrate = db.transaction(() => {
      if (!hasColumn(db, 'devices', 'sync_device_id')) db.exec('alter table devices add column sync_device_id text');
      if (!hasColumn(db, 'devices', 'agreement_public_key')) db.exec('alter table devices add column agreement_public_key text');
      if (!hasColumn(db, 'devices', 'signing_public_key')) db.exec('alter table devices add column signing_public_key text');
      if (!hasColumn(db, 'devices', 'certificate_json')) db.exec('alter table devices add column certificate_json text');
      db.exec(`
create unique index if not exists devices_sync_device_id on devices (sync_device_id) where sync_device_id is not null;
create table if not exists sync_vaults (
  id text primary key,
  user_id integer not null unique,
  suite text not null,
  authority_public_key text not null,
  current_epoch integer not null,
  sequence integer not null,
  checkpoint text not null,
  created_at text not null,
  foreign key (user_id) references users(id)
);
create table if not exists sync_pair_requests (
  id text primary key,
  code_hash text not null unique,
  request_token_hash text not null unique,
  device_token_hash text not null unique,
  device_id text not null unique,
  device_name text not null,
  agreement_public_key text not null,
  signing_public_key text not null,
  expires_at integer not null,
  approved_at text,
  claimed_at text,
  user_id integer,
  vault_id text,
  approver_device_id text,
  approval_json text,
  foreign key (user_id) references users(id),
  foreign key (vault_id) references sync_vaults(id)
);
create table if not exists sync_objects (
  vault_id text not null,
  object_id text not null,
  key_epoch integer not null,
  revision integer not null,
  sequence integer not null,
  author_device_id text not null,
  nonce text not null,
  ciphertext text not null,
  previous_checkpoint_sequence integer not null,
  previous_checkpoint_digest text not null,
  idempotency_key text not null,
  signature text not null,
  checkpoint text not null,
  primary key (vault_id, object_id),
  foreign key (vault_id) references sync_vaults(id)
);
create table if not exists sync_history (
  vault_id text not null,
  object_id text not null,
  key_epoch integer not null,
  revision integer not null,
  sequence integer not null,
  author_device_id text not null,
  nonce text not null,
  ciphertext text not null,
  previous_checkpoint_sequence integer not null,
  previous_checkpoint_digest text not null,
  idempotency_key text not null,
  signature text not null,
  checkpoint text not null,
  created_at text not null,
  primary key (vault_id, sequence),
  unique (vault_id, key_epoch, nonce),
  foreign key (vault_id) references sync_vaults(id)
);
create table if not exists sync_mutations (
  device_row_id integer not null,
  idempotency_key text not null,
  mutation_digest text not null,
  response_json text not null,
  created_at text not null,
  primary key (device_row_id, idempotency_key),
  foreign key (device_row_id) references devices(id)
);
create index if not exists sync_history_vault_sequence on sync_history (vault_id, sequence);
create index if not exists sync_pair_requests_expiry on sync_pair_requests (expires_at);
`);
      db.query('insert into schema_migrations (version, applied_at) values (?, ?)').run(4, new Date().toISOString());
    });
    migrate();
  }

  const ownerDashboard = db.query('select version from schema_migrations where version = 5').get() as
    | { version: number }
    | null;
  if (ownerDashboard === null) {
    const migrate = db.transaction(() => {
      if (!hasColumn(db, 'sync_pair_requests', 'invitation_id')) {
        db.exec('alter table sync_pair_requests add column invitation_id text');
      }
      if (!hasColumn(db, 'sync_pair_requests', 'cancelled_at')) {
        db.exec('alter table sync_pair_requests add column cancelled_at text');
      }
      db.exec(`
create table if not exists admin_owners (
  id integer primary key autoincrement,
  user_id integer not null unique,
  email text not null unique,
  password_hash text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (user_id) references users(id)
);
create table if not exists admin_sessions (
  token_hash text primary key,
  owner_id integer not null,
  csrf_hash text not null,
  created_at text not null,
  expires_at integer not null,
  foreign key (owner_id) references admin_owners(id)
);
create table if not exists admin_claims (
  token_hash text primary key,
  kind text not null check (kind in ('claim', 'reset')),
  owner_id integer,
  created_at text not null,
  expires_at integer not null,
  consumed_at text,
  foreign key (owner_id) references admin_owners(id)
);
create table if not exists connection_grants (
  id text primary key,
  token_hash text not null unique,
  user_id integer not null,
  owner_id integer,
  created_by_device_id integer,
  kind text not null check (kind in ('bootstrap', 'pair')),
  status text not null check (status in ('open', 'pending', 'approved', 'cancelled', 'claimed')),
  request_json text,
  request_fingerprint text,
  created_at text not null,
  expires_at integer not null,
  approved_at text,
  claimed_at text,
  cancelled_at text,
  foreign key (user_id) references users(id),
  foreign key (owner_id) references admin_owners(id),
  foreign key (created_by_device_id) references devices(id)
);
create table if not exists admin_audit_events (
  id integer primary key autoincrement,
  user_id integer not null,
  owner_id integer,
  action text not null,
  target_type text not null,
  target_id text,
  metadata_json text not null,
  created_at text not null,
  foreign key (user_id) references users(id),
  foreign key (owner_id) references admin_owners(id)
);
create index if not exists admin_sessions_expiry on admin_sessions (expires_at);
create index if not exists admin_claims_expiry on admin_claims (expires_at);
create index if not exists connection_grants_user_expiry on connection_grants (user_id, expires_at);
create index if not exists admin_audit_user_created on admin_audit_events (user_id, created_at);
create index if not exists sync_pair_requests_invitation on sync_pair_requests (invitation_id);
`);
      db.query('insert into schema_migrations (version, applied_at) values (?, ?)').run(5, new Date().toISOString());
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
