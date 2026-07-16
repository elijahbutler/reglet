import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { canonicalJson } from '@reglet/core';
import { hashToken, randomToken } from './security.js';
import type { AdminSession, ConnectionGrant, DeviceSummary, PendingConnection } from './admin-types.js';

export const adminSessionCookie = 'reglet_admin_session';
const claimLifetimeMs = 30 * 60 * 1000;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const grantLifetimeMs = 10 * 60 * 1000;

export interface AdminAuth extends AdminSession {
  tokenHash: string;
  csrfHash: string;
}

export interface IssuedAdminAuth extends AdminAuth {
  sessionToken: string;
  csrfToken: string;
}

export interface StoredConnectionGrant {
  id: string;
  userId: number;
  ownerId: number | null;
  createdByDeviceId: number | null;
  kind: 'bootstrap' | 'pair';
  status: ConnectionGrant['status'];
  requestJson: string | null;
  fingerprint: string | null;
  expiresAtMs: number;
}

export function issueOwnerClaim(db: Database, now: () => Date): string | null {
  const owner = db.query('select id from admin_owners limit 1').get() as { id: number } | null;
  if (owner !== null) return null;
  const token = randomToken();
  const issuedAt = now();
  const issue = db.transaction(() => {
    db.query("delete from admin_claims where kind = 'claim' and consumed_at is null").run();
    db.query(
      "insert into admin_claims (token_hash, kind, created_at, expires_at) values (?, 'claim', ?, ?)",
    ).run(hashToken(token), issuedAt.toISOString(), issuedAt.getTime() + claimLifetimeMs);
  });
  issue();
  return token;
}

export function issueOwnerReset(db: Database, now: () => Date): string {
  const owner = db.query('select id from admin_owners limit 1').get() as { id: number } | null;
  if (owner === null) throw new Error('The server has not been claimed');
  const token = randomToken();
  const issuedAt = now();
  const issue = db.transaction(() => {
    db.query("delete from admin_claims where kind = 'reset' and consumed_at is null").run();
    db.query(
      "insert into admin_claims (token_hash, kind, owner_id, created_at, expires_at) values (?, 'reset', ?, ?, ?)",
    ).run(hashToken(token), owner.id, issuedAt.toISOString(), issuedAt.getTime() + claimLifetimeMs);
  });
  issue();
  return token;
}

export function completeOwnerClaim(
  db: Database,
  token: string,
  email: string,
  passwordHash: string,
  now: () => Date,
): IssuedAdminAuth | null {
  const timestamp = now();
  const complete = db.transaction((): IssuedAdminAuth | null => {
    const claim = db.query(
      `select kind, owner_id from admin_claims
       where token_hash = ? and consumed_at is null and expires_at >= ?`,
    ).get(hashToken(token), timestamp.getTime()) as { kind: 'claim' | 'reset'; owner_id: number | null } | null;
    if (claim === null) return null;

    let ownerId: number;
    let userId: number;
    if (claim.kind === 'claim') {
      if ((db.query('select id from admin_owners limit 1').get() as { id: number } | null) !== null) return null;
      userId = tenantUserId(db, email, passwordHash);
      ownerId = (db.query(
        `insert into admin_owners (user_id, email, password_hash, created_at, updated_at)
         values (?, ?, ?, ?, ?) returning id`,
      ).get(userId, email, passwordHash, timestamp.toISOString(), timestamp.toISOString()) as { id: number }).id;
    } else {
      if (claim.owner_id === null) return null;
      const owner = db.query('select user_id from admin_owners where id = ?').get(claim.owner_id) as
        | { user_id: number }
        | null;
      if (owner === null) return null;
      ownerId = claim.owner_id;
      userId = owner.user_id;
      db.query('update admin_owners set email = ?, password_hash = ?, updated_at = ? where id = ?').run(
        email,
        passwordHash,
        timestamp.toISOString(),
        ownerId,
      );
      db.query('delete from admin_sessions where owner_id = ?').run(ownerId);
    }
    db.query('update admin_claims set consumed_at = ? where token_hash = ? and consumed_at is null').run(
      timestamp.toISOString(),
      hashToken(token),
    );
    audit(db, userId, ownerId, claim.kind === 'claim' ? 'owner.claimed' : 'owner.password_reset', 'owner', String(ownerId), {}, timestamp);
    return createAdminSession(db, ownerId, userId, email, timestamp);
  });
  return complete();
}

export function ownerByEmail(db: Database, email: string): { ownerId: number; userId: number; passwordHash: string } | null {
  const row = db.query('select id, user_id, password_hash from admin_owners where email = ?').get(email) as {
    id: number;
    user_id: number;
    password_hash: string;
  } | null;
  return row === null ? null : { ownerId: row.id, userId: row.user_id, passwordHash: row.password_hash };
}

export function startAdminSession(
  db: Database,
  owner: { ownerId: number; userId: number },
  email: string,
  now: () => Date,
): IssuedAdminAuth {
  const timestamp = now();
  audit(db, owner.userId, owner.ownerId, 'owner.login', 'owner', String(owner.ownerId), {}, timestamp);
  return createAdminSession(db, owner.ownerId, owner.userId, email, timestamp);
}

export function requireAdminSession(
  db: Database,
  cookieHeader: string | undefined,
  csrfToken: string | undefined,
  now: () => Date,
  requireCsrf: boolean,
): AdminAuth | null {
  const token = cookieValue(cookieHeader, adminSessionCookie);
  if (token === null) return null;
  const tokenHash = hashToken(token);
  const row = db.query(
    `select s.owner_id, s.csrf_hash, s.expires_at, o.user_id, o.email
     from admin_sessions s join admin_owners o on o.id = s.owner_id where s.token_hash = ?`,
  ).get(tokenHash) as {
    owner_id: number;
    csrf_hash: string;
    expires_at: number;
    user_id: number;
    email: string;
  } | null;
  if (row === null || row.expires_at < now().getTime()) {
    if (row !== null) db.query('delete from admin_sessions where token_hash = ?').run(tokenHash);
    return null;
  }
  if (requireCsrf && (csrfToken === undefined || hashToken(csrfToken) !== row.csrf_hash)) return null;
  return {
    ownerId: row.owner_id,
    userId: row.user_id,
    email: row.email,
    expiresAt: new Date(row.expires_at).toISOString(),
    tokenHash,
    csrfHash: row.csrf_hash,
  };
}

export function endAdminSession(db: Database, auth: AdminAuth, now: () => Date): void {
  db.query('delete from admin_sessions where token_hash = ?').run(auth.tokenHash);
  audit(db, auth.userId, auth.ownerId, 'owner.logout', 'owner', String(auth.ownerId), {}, now());
}

export function rotateAdminCsrf(db: Database, auth: AdminAuth): string {
  const token = randomToken();
  const result = db.query('update admin_sessions set csrf_hash = ? where token_hash = ?').run(
    hashToken(token),
    auth.tokenHash,
  );
  if (result.changes !== 1) throw new Error('Admin session disappeared while rotating CSRF token');
  return token;
}

export function createConnectionGrant(
  db: Database,
  auth: { userId: number; ownerId?: number; deviceRowId?: number },
  publicUrl: string,
  now: () => Date,
): ConnectionGrant & { token: string } {
  const token = randomToken();
  const id = randomBytes(12).toString('base64url');
  const timestamp = now();
  const vault = db.query('select id from sync_vaults where user_id = ?').get(auth.userId) as { id: string } | null;
  const kind = vault === null ? 'bootstrap' : 'pair';
  db.query(
    `insert into connection_grants
     (id, token_hash, user_id, owner_id, created_by_device_id, kind, status, created_at, expires_at)
     values (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(
    id,
    hashToken(token),
    auth.userId,
    auth.ownerId ?? null,
    auth.deviceRowId ?? null,
    kind,
    timestamp.toISOString(),
    timestamp.getTime() + grantLifetimeMs,
  );
  audit(
    db,
    auth.userId,
    auth.ownerId ?? null,
    'connection.created',
    'connection_grant',
    id,
    { kind, createdByDeviceId: auth.deviceRowId ?? null },
    timestamp,
  );
  return {
    id,
    kind,
    status: 'open',
    connectUrl: `${publicUrl.replace(/\/$/, '')}/connect#grant=${encodeURIComponent(token)}`,
    fingerprint: null,
    expiresAt: new Date(timestamp.getTime() + grantLifetimeMs).toISOString(),
    token,
  };
}

export function connectionGrantByToken(db: Database, token: string, now: () => Date): StoredConnectionGrant | null {
  const row = db.query(
    `select id, user_id, owner_id, created_by_device_id, kind, status, request_json,
            request_fingerprint, expires_at, cancelled_at
     from connection_grants where token_hash = ?`,
  ).get(hashToken(token)) as RawGrant | null;
  if (row === null || row.expires_at < now().getTime() || row.cancelled_at !== null || row.status === 'cancelled') return null;
  return grantFromRow(row);
}

export function saveGrantRequest(
  db: Database,
  grant: StoredConnectionGrant,
  request: object,
  fingerprint: string,
): 'saved' | 'replayed' | 'conflict' {
  const requestJson = canonicalJson(request);
  const result = db.query(
    `update connection_grants set status = 'pending', request_json = ?, request_fingerprint = ?
     where id = ? and status = 'open' and request_json is null`,
  ).run(requestJson, fingerprint, grant.id);
  if (result.changes === 1) return 'saved';
  const current = db.query('select request_json, request_fingerprint from connection_grants where id = ?').get(grant.id) as {
    request_json: string | null;
    request_fingerprint: string | null;
  } | null;
  return current?.request_json === requestJson && current.request_fingerprint === fingerprint ? 'replayed' : 'conflict';
}

export function markGrantStatus(
  db: Database,
  grantId: string,
  from: ConnectionGrant['status'],
  to: ConnectionGrant['status'],
  now: () => Date,
): boolean {
  const timestampColumn = to === 'approved' ? 'approved_at' : to === 'claimed' ? 'claimed_at' : to === 'cancelled' ? 'cancelled_at' : null;
  if (timestampColumn === null) {
    return db.query('update connection_grants set status = ? where id = ? and status = ?').run(to, grantId, from).changes === 1;
  }
  return db.query(`update connection_grants set status = ?, ${timestampColumn} = ? where id = ? and status = ?`).run(
    to,
    now().toISOString(),
    grantId,
    from,
  ).changes === 1;
}

export function listPendingConnections(db: Database, userId: number, now: () => Date): PendingConnection[] {
  const rows = db.query(
    `select g.id, g.kind, g.status, g.request_json, g.request_fingerprint, g.expires_at,
            d.sync_device_id as inviter_device_id
     from connection_grants g left join devices d on d.id = g.created_by_device_id
     where g.user_id = ? and g.status in ('pending', 'approved') and g.expires_at >= ?
     order by g.created_at asc`,
  ).all(userId, now().getTime()) as Array<{
    id: string;
    kind: 'bootstrap' | 'pair';
    status: 'pending' | 'approved';
    request_json: string;
    request_fingerprint: string;
    expires_at: number;
    inviter_device_id: string | null;
  }>;
  return rows.flatMap((row) => {
    const request = parseDeviceName(row.request_json);
    return request === null ? [] : [{
      id: row.id,
      kind: row.kind,
      status: row.status,
      deviceName: request,
      fingerprint: row.request_fingerprint,
      inviterDeviceId: row.inviter_device_id,
      expiresAt: new Date(row.expires_at).toISOString(),
    }];
  });
}

export function listAdminDevices(db: Database, userId: number): DeviceSummary[] {
  const rows = db.query(
    `select id, sync_device_id, name, created_at, last_seen_at, revoked_at
     from devices where user_id = ? and sync_device_id is not null order by created_at asc`,
  ).all(userId) as Array<{
    id: number;
    sync_device_id: string;
    name: string;
    created_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.sync_device_id,
    name: row.name,
    current: false,
    status: row.revoked_at === null ? 'active' : 'revoked',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }));
}

export function renameAdminDevice(db: Database, userId: number, deviceId: string, name: string): boolean {
  return db.query(
    'update devices set name = ? where user_id = ? and sync_device_id = ? and revoked_at is null',
  ).run(name, userId, deviceId).changes === 1;
}

export function revokeAdminDevice(db: Database, userId: number, deviceId: string, now: () => Date): boolean {
  return db.query(
    'update devices set revoked_at = ? where user_id = ? and sync_device_id = ? and revoked_at is null',
  ).run(now().toISOString(), userId, deviceId).changes === 1;
}

export function audit(
  db: Database,
  userId: number,
  ownerId: number | null,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: object,
  now: Date,
): void {
  db.query(
    `insert into admin_audit_events
     (user_id, owner_id, action, target_type, target_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, ownerId, action, targetType, targetId, canonicalJson(metadata), now.toISOString());
}

function createAdminSession(
  db: Database,
  ownerId: number,
  userId: number,
  email: string,
  now: Date,
): IssuedAdminAuth {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const expiresAt = now.getTime() + sessionLifetimeMs;
  db.query(
    `insert into admin_sessions (token_hash, owner_id, csrf_hash, created_at, expires_at)
     values (?, ?, ?, ?, ?)`,
  ).run(hashToken(sessionToken), ownerId, hashToken(csrfToken), now.toISOString(), expiresAt);
  return {
    ownerId,
    userId,
    email,
    expiresAt: new Date(expiresAt).toISOString(),
    tokenHash: hashToken(sessionToken),
    csrfHash: hashToken(csrfToken),
    sessionToken,
    csrfToken,
  };
}

export function sessionSecrets(auth: IssuedAdminAuth): { sessionToken: string; csrfToken: string } {
  return { sessionToken: auth.sessionToken, csrfToken: auth.csrfToken };
}

function tenantUserId(db: Database, email: string, passwordHash: string): number {
  const vault = db.query('select user_id from sync_vaults order by created_at asc limit 1').get() as { user_id: number } | null;
  if (vault !== null) return vault.user_id;
  const device = db.query('select user_id from devices order by id asc limit 1').get() as { user_id: number } | null;
  if (device !== null) return device.user_id;
  const user = db.query('select id from users order by id asc limit 1').get() as { id: number } | null;
  if (user !== null) return user.id;
  return (db.query('insert into users (email, pass_hash) values (?, ?) returning id').get(email, passwordHash) as { id: number }).id;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

function parseDeviceName(requestJson: string): string | null {
  try {
    const value = JSON.parse(requestJson) as unknown;
    return typeof value === 'object' && value !== null && 'deviceName' in value && typeof value.deviceName === 'string'
      ? value.deviceName
      : null;
  } catch {
    return null;
  }
}

interface RawGrant {
  id: string;
  user_id: number;
  owner_id: number | null;
  created_by_device_id: number | null;
  kind: 'bootstrap' | 'pair';
  status: ConnectionGrant['status'];
  request_json: string | null;
  request_fingerprint: string | null;
  expires_at: number;
  cancelled_at: string | null;
}

function grantFromRow(row: RawGrant): StoredConnectionGrant {
  return {
    id: row.id,
    userId: row.user_id,
    ownerId: row.owner_id,
    createdByDeviceId: row.created_by_device_id,
    kind: row.kind,
    status: row.status,
    requestJson: row.request_json,
    fingerprint: row.request_fingerprint,
    expiresAtMs: row.expires_at,
  };
}
