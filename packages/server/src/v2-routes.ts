import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import {
  decodeBase64Url,
  requireSyncV2Envelope,
  syncV2ProtocolVersion,
  syncV2Suite,
  verifySyncV2DeviceCertificate,
  verifySyncV2EnvelopeSignature,
  verifySyncV2PairApprovalSignature,
  type SyncV2DeviceCertificate,
  type SyncV2Envelope,
  type SyncV2PairApproval,
} from '@reglet/core';
import { errorBody, readJsonBody, type RateLimiter } from './http.js';
import { hashToken, normalizeDeviceName } from './security.js';
import { renameDevice, requireDevice } from './storage.js';
import {
  approveSyncV2PairRequest,
  bootstrapSyncV2Vault,
  claimSyncV2PairRequest,
  commitSyncV2Envelope,
  createSyncV2PairRequest,
  listSyncV2Changes,
  listSyncV2Devices,
  pairRequestByCode,
  pairRequestByToken,
  requireSyncV2Device,
} from './v2-storage.js';

export interface RegisterSyncV2RoutesOptions {
  now: () => Date;
  bodyLimitBytes: number;
  rateLimiter: RateLimiter;
}

interface BootstrapBody {
  vaultId?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  agreementPublicKey?: unknown;
  signingPublicKey?: unknown;
  authorityPublicKey?: unknown;
  certificate?: unknown;
}

interface PairRequestBody {
  requestId?: unknown;
  deviceTokenHash?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  agreementPublicKey?: unknown;
  signingPublicKey?: unknown;
}

interface PairApprovalBody {
  code?: unknown;
  approval?: unknown;
}

interface PairClaimBody {
  requestId?: unknown;
}

interface MutationBody {
  baseRevision?: unknown;
  envelope?: unknown;
}

const changesPageSize = 10;
const devicesPageSize = 50;

export function registerSyncV2Routes(
  app: Hono,
  db: Database,
  options: RegisterSyncV2RoutesOptions,
): void {
  const { now, bodyLimitBytes, rateLimiter } = options;

  app.get('/v2/compatibility', (c) =>
    c.json({
      service: { name: 'reglet-sync-server', version: '0.3.0' },
      protocol: { current: syncV2ProtocolVersion, supported: [syncV2ProtocolVersion], suites: [syncV2Suite] },
      capabilities: {
        bootstrapToken: true,
        bootstrapConnectionGrant: true,
        pairingRequestCode: true,
        pairingInvitation: true,
        pairingCancellation: true,
        backgroundSync: false,
      },
    }),
  );

  app.post('/v2/bootstrap', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const device = requireDevice(db, c.req.header('authorization'), now);
    if (device === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as BootstrapBody;
    const deviceName = typeof body.deviceName === 'string' ? normalizeDeviceName(body.deviceName) : null;
    const certificate = isDeviceCertificate(body.certificate) ? body.certificate : null;
    if (
      !isIdentifier(body.vaultId) ||
      !isIdentifier(body.deviceId) ||
      deviceName === null ||
      !isPublicKey(body.agreementPublicKey) ||
      !isPublicKey(body.signingPublicKey) ||
      !isPublicKey(body.authorityPublicKey) ||
      certificate === null ||
      certificate.vaultId !== body.vaultId ||
      certificate.deviceId !== body.deviceId ||
      certificate.deviceName !== deviceName ||
      certificate.agreementPublicKey !== body.agreementPublicKey ||
      certificate.signingPublicKey !== body.signingPublicKey ||
      !verifySyncV2DeviceCertificate(certificate, body.authorityPublicKey)
    ) {
      return c.json(errorBody('invalid_request', 'bootstrap device authorization is invalid'), 400);
    }
    const result = bootstrapSyncV2Vault(
      db,
      device.deviceId,
      device.userId,
      {
        vaultId: body.vaultId,
        deviceId: body.deviceId,
        deviceName,
        agreementPublicKey: body.agreementPublicKey,
        signingPublicKey: body.signingPublicKey,
        certificate,
        authorityPublicKey: body.authorityPublicKey,
      },
      now,
    );
    if (result === 'exists') return c.json(errorBody('vault_exists', 'encrypted vault is already initialized'), 409);
    if (result === 'device_conflict') return c.json(errorBody('device_conflict', 'bootstrap device is unavailable'), 409);
    return c.json({
      created: true,
      replayed: result === 'replayed',
      vaultId: body.vaultId,
      deviceId: body.deviceId,
      keyEpoch: 1,
      checkpoint: { sequence: 0, digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
  });

  app.post('/v2/pair/requests', async (c) => {
    const limited = rateLimiter.check(c.req.raw, 'pair');
    if (!limited.ok) return c.json(errorBody('rate_limited', 'Too many requests'), 429);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as PairRequestBody;
    const deviceName = typeof body.deviceName === 'string' ? normalizeDeviceName(body.deviceName) : null;
    if (
      !isIdentifier(body.requestId) ||
      !isSha256(body.deviceTokenHash) ||
      !isIdentifier(body.deviceId) ||
      deviceName === null ||
      !isPublicKey(body.agreementPublicKey) ||
      !isPublicKey(body.signingPublicKey)
    ) {
      return c.json(errorBody('invalid_request', 'pairing request is invalid'), 400);
    }
    try {
      const created = createSyncV2PairRequest(
        db,
        {
          requestId: body.requestId,
          deviceTokenHash: body.deviceTokenHash,
          deviceId: body.deviceId,
          deviceName,
          agreementPublicKey: body.agreementPublicKey,
          signingPublicKey: body.signingPublicKey,
        },
        now,
      );
      return created === null
        ? c.json(errorBody('pairing_capacity', 'too many pending pairing requests'), 429)
        : c.json({ ...created.request, requestToken: created.requestToken }, 201);
    } catch (error) {
      if (isUniqueConstraint(error)) return c.json(errorBody('pairing_conflict', 'pairing request already exists'), 409);
      throw error;
    }
  });

  app.post('/v2/pair/inspect', async (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const code = isRecord(parsed.value) && typeof parsed.value.code === 'string' ? parsed.value.code : '';
    const request = pairRequestByCode(db, code, now);
    if (request === null || request.approval !== null || request.claimedAt !== null) {
      return c.json(errorBody('pairing_not_found', 'pending pairing request not found'), 404);
    }
    return c.json(publicPairRequest(request));
  });

  app.post('/v2/pair/approve', async (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as PairApprovalBody;
    if (typeof body.code !== 'string' || !isPairApproval(body.approval)) {
      return c.json(errorBody('invalid_request', 'pairing approval is invalid'), 400);
    }
    const request = pairRequestByCode(db, body.code, now);
    const approval = body.approval;
    if (
      request === null ||
      request.approval !== null ||
      request.claimedAt !== null ||
      approval.requestId !== request.requestId ||
      approval.vaultId !== auth.vaultId ||
      approval.approverDeviceId !== auth.deviceId ||
      approval.approverSigningPublicKey !== auth.signingPublicKey ||
      approval.newDevice.deviceId !== request.deviceId ||
      approval.newDevice.deviceName !== request.deviceName ||
      approval.newDevice.agreementPublicKey !== request.agreementPublicKey ||
      approval.newDevice.signingPublicKey !== request.signingPublicKey ||
      approval.certificate.deviceId !== request.deviceId ||
      approval.certificate.vaultId !== auth.vaultId ||
      approval.certificate.deviceName !== request.deviceName ||
      approval.certificate.agreementPublicKey !== request.agreementPublicKey ||
      approval.certificate.signingPublicKey !== request.signingPublicKey ||
      !verifySyncV2DeviceCertificate(approval.certificate, auth.authorityPublicKey) ||
      !verifySyncV2PairApprovalSignature(approval)
    ) {
      return c.json(errorBody('invalid_approval', 'pairing approval failed identity validation'), 400);
    }
    if (!approveSyncV2PairRequest(db, request.requestId, auth, approval, now)) {
      return c.json(errorBody('pairing_conflict', 'pairing request is no longer pending'), 409);
    }
    return c.json({ approved: true, requestId: request.requestId });
  });

  app.get('/v2/pair/status', (c) => {
    const requestId = c.req.query('requestId') ?? '';
    const requestToken = pairingToken(c.req.header('authorization'));
    if (!isIdentifier(requestId) || requestToken === null) {
      return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    }
    const request = pairRequestByToken(db, requestId, requestToken, now);
    if (request === null) return c.json(errorBody('pairing_not_found', 'pairing request not found'), 404);
    return c.json({
      request: publicPairRequest(request),
      status: request.claimedAt !== null ? 'claimed' : request.approval === null ? 'pending' : 'approved',
      approval: request.claimedAt === null ? request.approval : null,
    });
  });

  app.post('/v2/pair/claim', async (c) => {
    const requestToken = pairingToken(c.req.header('authorization'));
    if (requestToken === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as PairClaimBody;
    if (!isIdentifier(body.requestId)) return c.json(errorBody('invalid_request', 'requestId is invalid'), 400);
    const request = pairRequestByToken(db, body.requestId, requestToken, now);
    if (request === null || request.approval === null) {
      return c.json(errorBody('pairing_not_ready', 'pairing request is not approved'), 409);
    }
    if (request.claimedAt !== null) {
      return c.json({
        claimed: true,
        replayed: true,
        vaultId: request.approval.vaultId,
        deviceId: request.deviceId,
      });
    }
    if (!claimSyncV2PairRequest(db, request, now)) {
      return c.json(errorBody('pairing_conflict', 'pairing request was already claimed'), 409);
    }
    return c.json({ claimed: true, replayed: false, vaultId: request.approval.vaultId, deviceId: request.deviceId });
  });

  app.get('/v2/changes', (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const since = Number(c.req.query('since') ?? '0');
    if (!Number.isSafeInteger(since) || since < 0) {
      return c.json(errorBody('invalid_request', 'since must be a non-negative safe integer'), 400);
    }
    const page = listSyncV2Changes(db, auth, since, changesPageSize);
    if (page === null) return c.json(errorBody('invalid_cursor', 'cursor is not available'), 409);
    return c.json({
      changes: page.changes,
      cursor: page.changes.at(-1)?.sequence ?? since,
      checkpoint: page.checkpoint,
      hasMore: page.hasMore,
    });
  });

  app.put('/v2/objects/:objectId', async (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const body = parsed.value as MutationBody;
    if (!Number.isSafeInteger(body.baseRevision) || (body.baseRevision as number) < 0 || !isRecord(body.envelope)) {
      return c.json(errorBody('invalid_request', 'baseRevision and envelope are required'), 400);
    }
    const envelope = body.envelope as unknown as SyncV2Envelope;
    try {
      requireSyncV2Envelope(envelope);
    } catch {
      return c.json(errorBody('invalid_envelope', 'encrypted object envelope is invalid'), 400);
    }
    if (
      envelope.objectId !== c.req.param('objectId') ||
      envelope.vaultId !== auth.vaultId ||
      envelope.authorDeviceId !== auth.deviceId ||
      envelope.keyEpoch !== auth.currentEpoch ||
      !verifySyncV2EnvelopeSignature(envelope, auth.signingPublicKey)
    ) {
      return c.json(errorBody('invalid_envelope', 'encrypted object identity or signature is invalid'), 400);
    }
    const result = commitSyncV2Envelope(db, auth, envelope, body.baseRevision as number, now);
    if (result.ok) return c.json(result.response);
    if (result.reason === 'conflict') {
      return c.json(
        {
          ...errorBody('conflict', 'encrypted object revision or vault checkpoint conflict'),
          headRevision: result.headRevision,
          checkpoint: result.checkpoint,
        },
        409,
      );
    }
    const status = result.reason === 'quota_exceeded' ? 413 : 409;
    return c.json(errorBody(result.reason, result.reason.replaceAll('_', ' ')), status);
  });

  app.get('/v2/devices', (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const cursor = Number(c.req.query('cursor') ?? '0');
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      return c.json(errorBody('invalid_request', 'cursor must be a non-negative safe integer'), 400);
    }
    return c.json({ currentDeviceId: auth.deviceId, ...listSyncV2Devices(db, auth, cursor, devicesPageSize) });
  });

  app.patch('/v2/devices/:deviceId', async (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const parsed = await readJsonBody(c.req.raw, bodyLimitBytes);
    if (!parsed.ok) return c.json(errorBody(parsed.code, parsed.message), parsed.status);
    const nameValue = isRecord(parsed.value) ? parsed.value.name : undefined;
    const name = typeof nameValue === 'string' ? normalizeDeviceName(nameValue) : null;
    if (!isIdentifier(c.req.param('deviceId')) || name === null) {
      return c.json(errorBody('invalid_request', 'device id or name is invalid'), 400);
    }
    const target = db.query('select id from devices where user_id = ? and sync_device_id = ? and revoked_at is null').get(
      auth.userId,
      c.req.param('deviceId'),
    ) as { id: number } | null;
    if (target === null || !renameDevice(db, auth.userId, target.id, name)) {
      return c.json(errorBody('not_found', 'device not found'), 404);
    }
    return c.json({ renamed: true, deviceId: c.req.param('deviceId'), name });
  });

  app.delete('/v2/devices/:deviceId', (c) => {
    const auth = requireSyncV2Device(db, c.req.header('authorization'), now);
    if (auth === null) return c.json(errorBody('unauthorized', 'unauthorized'), 401);
    const targetId = c.req.param('deviceId');
    if (!isIdentifier(targetId)) return c.json(errorBody('invalid_request', 'device id is invalid'), 400);
    const result = db.query(
      'update devices set revoked_at = ? where user_id = ? and sync_device_id = ? and revoked_at is null',
    ).run(now().toISOString(), auth.userId, targetId);
    if (result.changes !== 1) return c.json(errorBody('not_found', 'device not found'), 404);
    return c.json({ revoked: true, deviceId: targetId, keyRotationRequired: true });
  });
}

function publicPairRequest(request: {
  requestId: string;
  code: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  expiresAt: string;
}): object {
  return {
    requestId: request.requestId,
    code: request.code,
    deviceId: request.deviceId,
    deviceName: request.deviceName,
    agreementPublicKey: request.agreementPublicKey,
    signingPublicKey: request.signingPublicKey,
    expiresAt: request.expiresAt,
  };
}

function pairingToken(value: string | undefined): string | null {
  return value?.startsWith('Pairing ') === true ? value.slice('Pairing '.length) : null;
}

function isDeviceCertificate(value: unknown): value is SyncV2DeviceCertificate {
  return (
    isRecord(value) &&
    value.protocolVersion === syncV2ProtocolVersion &&
    value.suite === syncV2Suite &&
    typeof value.vaultId === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.deviceName === 'string' &&
    typeof value.agreementPublicKey === 'string' &&
    typeof value.signingPublicKey === 'string' &&
    typeof value.issuedAt === 'string' &&
    typeof value.authoritySignature === 'string'
  );
}

function isPairApproval(value: unknown): value is SyncV2PairApproval {
  return (
    isRecord(value) &&
    value.protocolVersion === syncV2ProtocolVersion &&
    value.suite === syncV2Suite &&
    typeof value.requestId === 'string' &&
    typeof value.vaultId === 'string' &&
    typeof value.approverDeviceId === 'string' &&
    typeof value.approverSigningPublicKey === 'string' &&
    isRecord(value.newDevice) &&
    isDeviceCertificate(value.certificate) &&
    typeof value.ephemeralPublicKey === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.encryptedVaultBundle === 'string' &&
    typeof value.approvedAt === 'string' &&
    typeof value.approvalSignature === 'string'
  );
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

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function hashSyncV2DeviceToken(token: string): string {
  return hashToken(token);
}
