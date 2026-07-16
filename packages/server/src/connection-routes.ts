import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import {
  canonicalJson,
  decodeBase64Url,
  syncV2ProtocolVersion,
  syncV2Suite,
  verifySyncV2DeviceCertificate,
  type SyncV2DeviceCertificate,
} from '@reglet/core';
import {
  connectionGrantByToken,
  createConnectionGrant,
  markGrantStatus,
  saveGrantRequest,
} from './admin-storage.js';
import { errorBody, readJsonBody, type RateLimiter } from './http.js';
import { normalizeDeviceName, sha256 } from './security.js';
import {
  cancelSyncV2PairRequest,
  createSyncV2PairRequest,
  requireSyncV2Device,
  type BootstrapConnectionInput,
} from './v2-storage.js';

export type BootstrapConnectionRequest = BootstrapConnectionInput;

export function registerConnectionRoutes(
  app: Hono,
  db: Database,
  options: { now: () => Date; bodyLimitBytes: number; rateLimiter: RateLimiter; publicUrl: string },
): void {
  const { now, bodyLimitBytes, rateLimiter, publicUrl } = options;

  app.post('/v2/bootstrap/requests', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const token = connectionToken(c.req.header('authorization'));
    const grant = token === null ? null : connectionGrantByToken(db, token, now);
    if (grant === null) return c.json(errorBody('unauthorized', 'invalid or expired connection grant'), 401);
    if (grant.kind !== 'bootstrap') return c.json(errorBody('wrong_connection_kind', 'connection grant requires pairing'), 409);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const request = parseBootstrapConnectionRequest(parsed.value);
    if (request === null) return c.json(errorBody('invalid_request', 'bootstrap identity is invalid'), 400);
    const fingerprint = connectionFingerprint(request);
    const saved = saveGrantRequest(db, grant, request, fingerprint);
    if (saved === 'conflict') return c.json(errorBody('connection_conflict', 'connection grant is already bound'), 409);
    return c.json({
      id: grant.id,
      status: 'pending',
      fingerprint,
      expiresAt: new Date(grant.expiresAtMs).toISOString(),
      replayed: saved === 'replayed',
    }, saved === 'saved' ? 201 : 200);
  });

  app.get('/v2/bootstrap/requests/:id', (c) => {
    const token = connectionToken(c.req.header('authorization'));
    const grant = token === null ? null : connectionGrantByToken(db, token, now);
    if (grant === null || grant.id !== c.req.param('id') || grant.kind !== 'bootstrap') {
      return c.json(errorBody('not_found', 'connection request not found'), 404);
    }
    return c.json({
      id: grant.id,
      status: grant.status,
      fingerprint: grant.fingerprint,
      expiresAt: new Date(grant.expiresAtMs).toISOString(),
    });
  });

  app.post('/v2/bootstrap/requests/:id/claim', (c) => {
    const token = connectionToken(c.req.header('authorization'));
    const grant = token === null ? null : connectionGrantByToken(db, token, now);
    if (grant === null || grant.id !== c.req.param('id') || grant.kind !== 'bootstrap') {
      return c.json(errorBody('not_found', 'connection request not found'), 404);
    }
    if (grant.status === 'claimed') return c.json({ claimed: true, replayed: true });
    if (grant.status !== 'approved') return c.json(errorBody('connection_not_ready', 'connection request is not approved'), 409);
    if (!markGrantStatus(db, grant.id, 'approved', 'claimed', now)) {
      return c.json(errorBody('connection_conflict', 'connection request changed'), 409);
    }
    return c.json({ claimed: true, replayed: false });
  });

  app.delete('/v2/bootstrap/requests/:id', (c) => {
    const token = connectionToken(c.req.header('authorization'));
    const grant = token === null ? null : connectionGrantByToken(db, token, now);
    if (grant === null || grant.id !== c.req.param('id') || grant.kind !== 'bootstrap') {
      return c.json(errorBody('not_found', 'connection request not found'), 404);
    }
    const cancelled = grant.status === 'open'
      ? markGrantStatus(db, grant.id, 'open', 'cancelled', now)
      : grant.status === 'pending' && markGrantStatus(db, grant.id, 'pending', 'cancelled', now);
    return cancelled
      ? c.json({ cancelled: true })
      : c.json(errorBody('connection_conflict', 'connection request can no longer be cancelled'), 409);
  });

  app.post('/v2/invitations', (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const grant = createConnectionGrant(db, { userId: auth.userId, deviceRowId: auth.deviceRowId }, publicUrl, now);
    return c.json({
      id: grant.id,
      kind: grant.kind,
      status: grant.status,
      connectUrl: grant.connectUrl,
      fingerprint: grant.fingerprint,
      expiresAt: grant.expiresAt,
    }, 201);
  });

  app.post('/v2/invitations/requests', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const token = connectionToken(c.req.header('authorization'));
    const grant = token === null ? null : connectionGrantByToken(db, token, now);
    if (grant === null) return c.json(errorBody('unauthorized', 'invalid or expired invitation'), 401);
    if (grant.kind !== 'pair') return c.json(errorBody('wrong_connection_kind', 'connection grant is for first-device setup'), 409);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const request = parsePairRequest(parsed.value);
    if (request === null) return c.json(errorBody('invalid_request', 'pairing request is invalid'), 400);
    const fingerprint = connectionFingerprint(request);
    try {
      const create = db.transaction(() => {
        const saved = saveGrantRequest(db, grant, request, fingerprint);
        if (saved !== 'saved') throw new Error('connection grant is already bound');
        const pair = createSyncV2PairRequest(db, { ...request, invitationId: grant.id }, now);
        if (pair === null) throw new Error('too many pending pairing requests');
        return pair;
      });
      const created = create();
      return c.json({ ...created.request, requestToken: created.requestToken, fingerprint }, 201);
    } catch (error) {
      return c.json(errorBody('pairing_conflict', error instanceof Error ? error.message : 'pairing request failed'), 409);
    }
  });

  app.delete('/v2/pair/requests/:id', (c) => {
    const token = pairingToken(c.req.header('authorization'));
    if (token === null || !cancelSyncV2PairRequest(db, c.req.param('id'), token, now)) {
      return c.json(errorBody('pairing_not_found', 'pending pairing request not found'), 404);
    }
    return c.json({ cancelled: true, requestId: c.req.param('id') });
  });
}

export function parseBootstrapConnectionRequest(value: unknown): BootstrapConnectionRequest | null {
  if (!isRecord(value)) return null;
  const deviceName = typeof value.deviceName === 'string' ? normalizeDeviceName(value.deviceName) : null;
  const certificate = isDeviceCertificate(value.certificate) ? value.certificate : null;
  if (
    !isIdentifier(value.vaultId) ||
    !isIdentifier(value.deviceId) ||
    deviceName === null ||
    !isSha256(value.deviceTokenHash) ||
    !isPublicKey(value.agreementPublicKey) ||
    !isPublicKey(value.signingPublicKey) ||
    !isPublicKey(value.authorityPublicKey) ||
    certificate === null ||
    certificate.vaultId !== value.vaultId ||
    certificate.deviceId !== value.deviceId ||
    certificate.deviceName !== deviceName ||
    certificate.agreementPublicKey !== value.agreementPublicKey ||
    certificate.signingPublicKey !== value.signingPublicKey ||
    !verifySyncV2DeviceCertificate(certificate, value.authorityPublicKey)
  ) {
    return null;
  }
  return {
    vaultId: value.vaultId,
    deviceId: value.deviceId,
    deviceName,
    deviceTokenHash: value.deviceTokenHash,
    agreementPublicKey: value.agreementPublicKey,
    signingPublicKey: value.signingPublicKey,
    authorityPublicKey: value.authorityPublicKey,
    certificate,
  };
}

function parsePairRequest(value: unknown): {
  requestId: string;
  deviceTokenHash: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
} | null {
  if (!isRecord(value)) return null;
  const deviceName = typeof value.deviceName === 'string' ? normalizeDeviceName(value.deviceName) : null;
  return isIdentifier(value.requestId) && isSha256(value.deviceTokenHash) && isIdentifier(value.deviceId) &&
    deviceName !== null && isPublicKey(value.agreementPublicKey) && isPublicKey(value.signingPublicKey)
    ? {
        requestId: value.requestId,
        deviceTokenHash: value.deviceTokenHash,
        deviceId: value.deviceId,
        deviceName,
        agreementPublicKey: value.agreementPublicKey,
        signingPublicKey: value.signingPublicKey,
      }
    : null;
}

function connectionFingerprint(value: object): string {
  const digest = sha256(Buffer.from(canonicalJson(value)));
  return digest.match(/.{1,4}/g)?.join(' ') ?? digest;
}

function connectionToken(value: string | undefined): string | null {
  return value?.startsWith('Connection ') === true ? value.slice('Connection '.length) : null;
}

function pairingToken(value: string | undefined): string | null {
  return value?.startsWith('Pairing ') === true ? value.slice('Pairing '.length) : null;
}

function isDeviceCertificate(value: unknown): value is SyncV2DeviceCertificate {
  return isRecord(value) && value.protocolVersion === syncV2ProtocolVersion && value.suite === syncV2Suite &&
    typeof value.vaultId === 'string' && typeof value.deviceId === 'string' && typeof value.deviceName === 'string' &&
    typeof value.agreementPublicKey === 'string' && typeof value.signingPublicKey === 'string' &&
    typeof value.issuedAt === 'string' && typeof value.authoritySignature === 'string';
}

function isPublicKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return decodeBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
