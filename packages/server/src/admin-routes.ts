import { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import {
  adminSessionCookie,
  audit,
  completeOwnerClaim,
  createConnectionGrant,
  endAdminSession,
  listAdminDevices,
  listPendingConnections,
  ownerByEmail,
  renameAdminDevice,
  requireAdminSession,
  rotateAdminCsrf,
  revokeAdminDevice,
  sessionSecrets,
  startAdminSession,
  type AdminAuth,
} from './admin-storage.js';
import type { AdminOverview } from './admin-types.js';
import { parseBootstrapConnectionRequest } from './connection-routes.js';
import { errorBody, readJsonBody, type RateLimiter } from './http.js';
import { createHostOperations } from './host-operations.js';
import {
  accountCredentials,
  hashSecret,
  maximumPasswordLength,
  normalizeDeviceName,
  normalizeEmail,
  verifySecret,
} from './security.js';
import { currentSchemaVersion } from './storage.js';
import { approveBootstrapConnection } from './v2-storage.js';

interface AuthBody {
  email?: unknown;
  password?: unknown;
  token?: unknown;
}

export function registerAdminRoutes(
  app: Hono,
  db: Database,
  options: {
    now: () => Date;
    bodyLimitBytes: number;
    rateLimiter: RateLimiter;
    publicUrl: string;
    serviceVersion: string;
    backupDirectory?: string;
  },
): void {
  const { now, bodyLimitBytes, rateLimiter, publicUrl, serviceVersion } = options;
  const expectedOrigin = new URL(publicUrl).origin;
  const host = createHostOperations(db, options.backupDirectory, now);

  app.post('/api/admin/v1/claim', async (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const limited = rateLimiter.check(c.req.raw, 'admin');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as AuthBody;
    const credentials = accountCredentials(body.email, body.password);
    if (!credentials.ok || typeof body.token !== 'string' || body.token.length < 20) {
      return c.json(errorBody('invalid_request', credentials.ok ? 'claim token is invalid' : credentials.message), 400);
    }
    const passwordHash = await hashSecret(credentials.password);
    const auth = completeOwnerClaim(db, body.token, credentials.email, passwordHash, now);
    if (auth === null) return c.json(errorBody('invalid_claim', 'claim link is invalid, expired, or already used'), 404);
    return adminSessionResponse(c, auth);
  });

  app.post('/api/admin/v1/login', async (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const limited = rateLimiter.check(c.req.raw, 'admin');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as AuthBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > maximumPasswordLength) {
      return c.json(errorBody('invalid_credentials', 'invalid credentials'), 401);
    }
    const email = normalizeEmail(body.email);
    const owner = email === null ? null : ownerByEmail(db, email);
    if (owner === null) {
      await hashSecret(body.password);
      return c.json(errorBody('invalid_credentials', 'invalid credentials'), 401);
    }
    if (!(await verifySecret(body.password, owner.passwordHash))) {
      return c.json(errorBody('invalid_credentials', 'invalid credentials'), 401);
    }
    return adminSessionResponse(c, startAdminSession(db, owner, email!, now));
  });

  app.get('/api/admin/v1/session', (c) => {
    const auth = adminAuth(db, c.req.raw, now, false);
    return auth === null
      ? c.json(errorBody('unauthorized', 'unauthorized'), 401)
      : c.json({ session: publicSession(auth), csrfToken: rotateAdminCsrf(db, auth) });
  });

  app.post('/api/admin/v1/logout', (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    endAdminSession(db, auth, now);
    c.header('Set-Cookie', expiredSessionCookie());
    return c.json({ loggedOut: true });
  });

  app.get('/api/admin/v1/overview', (c) => {
    const auth = adminAuth(db, c.req.raw, now, false);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const schema = db.query('select max(version) as version from schema_migrations').get() as { version: number | null };
    const vault = db.query('select id from sync_vaults where user_id = ?').get(auth.userId) as { id: string } | null;
    const devices = db.query(
      'select count(*) as count from devices where user_id = ? and sync_device_id is not null and revoked_at is null',
    ).get(auth.userId) as { count: number };
    const pending = listPendingConnections(db, auth.userId, now);
    const overview: AdminOverview = {
      service: { name: 'reglet-sync-server', version: serviceVersion },
      schema: { current: schema.version ?? 0, supported: currentSchemaVersion, ready: schema.version === currentSchemaVersion },
      vault: { initialized: vault !== null, activeDevices: devices.count, pendingConnections: pending.length },
      capabilities: {
        ownerDashboard: true,
        connectionGrants: true,
        pairingInvitations: true,
        serverBackups: host.backupsEnabled,
        liveIntegrityCheck: true,
        liveRestore: false,
        backgroundSync: false,
      },
    };
    return c.json(overview);
  });

  app.post('/api/admin/v1/connections', (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const limited = rateLimiter.check(c.req.raw, 'admin');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const grant = createConnectionGrant(db, { userId: auth.userId, ownerId: auth.ownerId }, publicUrl, now);
    return c.json({
      id: grant.id,
      kind: grant.kind,
      status: grant.status,
      connectUrl: grant.connectUrl,
      fingerprint: grant.fingerprint,
      expiresAt: grant.expiresAt,
    }, 201);
  });

  app.get('/api/admin/v1/connections', (c) => {
    const auth = adminAuth(db, c.req.raw, now, false);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    return c.json({ connections: listPendingConnections(db, auth.userId, now) });
  });

  app.post('/api/admin/v1/connections/:id/approve', (c) => approveConnection(c, db, now, expectedOrigin));

  app.delete('/api/admin/v1/connections/:id', (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const result = db.query(
      `update connection_grants set status = 'cancelled', cancelled_at = ?
       where id = ? and user_id = ? and status in ('open', 'pending')`,
    ).run(now().toISOString(), c.req.param('id'), auth.userId);
    if (result.changes !== 1) return c.json(errorBody('not_found', 'open connection not found'), 404);
    audit(db, auth.userId, auth.ownerId, 'connection.cancelled', 'connection_grant', c.req.param('id'), {}, now());
    return c.json({ cancelled: true, id: c.req.param('id') });
  });

  app.get('/api/admin/v1/devices', (c) => {
    const auth = adminAuth(db, c.req.raw, now, false);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    return c.json({ devices: listAdminDevices(db, auth.userId) });
  });

  app.patch('/api/admin/v1/devices/:id', async (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const value = parsed.value as { name?: unknown };
    const name = typeof value.name === 'string' ? normalizeDeviceName(value.name) : null;
    if (name === null) return c.json(errorBody('invalid_request', 'device name is invalid'), 400);
    const deviceId = c.req.param('id');
    if (!renameAdminDevice(db, auth.userId, deviceId, name)) return c.json(errorBody('not_found', 'device not found'), 404);
    audit(db, auth.userId, auth.ownerId, 'device.renamed', 'device', deviceId, { name }, now());
    return c.json({ renamed: true, id: deviceId, name });
  });

  app.delete('/api/admin/v1/devices/:id', (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const deviceId = c.req.param('id');
    if (!revokeAdminDevice(db, auth.userId, deviceId, now)) return c.json(errorBody('not_found', 'device not found'), 404);
    audit(db, auth.userId, auth.ownerId, 'device.revoked', 'device', deviceId, {}, now());
    return c.json({ revoked: true, deviceId, keyRotationRequired: true });
  });

  app.get('/api/admin/v1/backups', async (c) => {
    const auth = adminAuth(db, c.req.raw, now, false);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    if (!host.backupsEnabled) return c.json(errorBody('capability_unavailable', 'server backups are not configured'), 503);
    return c.json({ backups: await host.listBackups() });
  });

  app.post('/api/admin/v1/backups', async (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    if (!host.backupsEnabled) return c.json(errorBody('capability_unavailable', 'server backups are not configured'), 503);
    const limited = rateLimiter.check(c.req.raw, 'admin');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const backup = await host.createBackup();
    audit(db, auth.userId, auth.ownerId, 'backup.created', 'backup', backup.name, { sizeBytes: backup.sizeBytes }, now());
    return c.json(backup, 201);
  });

  app.post('/api/admin/v1/integrity-check', async (c) => {
    if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
    const auth = adminAuth(db, c.req.raw, now, true);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const result = await host.checkIntegrity();
    audit(db, auth.userId, auth.ownerId, 'integrity.checked', 'database', 'live', {}, now());
    return c.json(result);
  });
}

async function approveConnection(
  c: Context,
  db: Database,
  now: () => Date,
  expectedOrigin: string,
): Promise<Response> {
  if (!sameOrigin(c.req.raw, expectedOrigin)) return c.json(errorBody('invalid_origin', 'request origin is not allowed'), 403);
  const auth = adminAuth(db, c.req.raw, now, true);
  if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
  const grantId = c.req.param('id');
  if (grantId === undefined) return c.json(errorBody('invalid_request', 'connection id is required'), 400);
  const row = db.query(
    `select kind, status, request_json from connection_grants
     where id = ? and user_id = ? and expires_at >= ?`,
  ).get(grantId, auth.userId, now().getTime()) as {
    kind: 'bootstrap' | 'pair';
    status: string;
    request_json: string | null;
  } | null;
  if (row === null || row.request_json === null) return c.json(errorBody('not_found', 'pending connection not found'), 404);
  if (row.kind !== 'bootstrap') {
    return c.json(errorBody('device_approval_required', 'a trusted Reglet device must approve this pairing'), 403);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.request_json) as unknown;
  } catch {
    return c.json(errorBody('invalid_connection', 'stored connection identity is invalid'), 500);
  }
  const request = parseBootstrapConnectionRequest(parsed);
  if (request === null) return c.json(errorBody('invalid_connection', 'stored connection identity is invalid'), 500);
  const result = approveBootstrapConnection(db, grantId, auth.userId, request, now);
  if (result === 'conflict') return c.json(errorBody('connection_conflict', 'connection request changed'), 409);
  audit(db, auth.userId, auth.ownerId, 'connection.approved', 'connection_grant', grantId, {}, now());
  return c.json({ approved: true, id: grantId, replayed: result === 'replayed' });
}

function adminAuth(db: Database, request: Request, now: () => Date, requireCsrf: boolean): AdminAuth | null {
  return requireAdminSession(db, request.headers.get('cookie') ?? undefined, request.headers.get('x-reglet-csrf') ?? undefined, now, requireCsrf);
}

function publicSession(auth: AdminAuth): object {
  return { ownerId: auth.ownerId, userId: auth.userId, email: auth.email, expiresAt: auth.expiresAt };
}

function adminSessionResponse(c: { header: (name: string, value: string) => void; json: (body: object) => Response }, auth: ReturnType<typeof startAdminSession>): Response {
  const secrets = sessionSecrets(auth);
  c.header('Set-Cookie', sessionCookie(secrets.sessionToken));
  return c.json({ session: publicSession(auth), csrfToken: secrets.csrfToken });
}

function sessionCookie(token: string): string {
  return `${adminSessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

function expiredSessionCookie(): string {
  return `${adminSessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function sameOrigin(request: Request, expectedOrigin: string): boolean {
  return request.headers.get('origin') === expectedOrigin;
}
