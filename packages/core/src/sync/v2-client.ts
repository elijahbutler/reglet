import {
  readBoundedSyncJson,
  requireSecureSyncServerUrl,
  type CompatibilityResponse,
} from './client.js';
import { requireSyncV2Envelope } from './v2-crypto.js';
import {
  syncV2ProtocolVersion,
  syncV2Suite,
  type StoredSyncV2Envelope,
  type SyncV2ChangesResponse,
  type SyncV2Checkpoint,
  type SyncV2DeviceCertificate,
  type SyncV2DevicesResponse,
  type SyncV2Envelope,
  type SyncV2MutationResponse,
  type SyncV2PairApproval,
  type SyncV2PairRequest,
} from './v2-types.js';

export interface SyncV2BootstrapInput {
  vaultId: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  authorityPublicKey: string;
  certificate: SyncV2DeviceCertificate;
}

export interface SyncV2BootstrapConnectionInput extends SyncV2BootstrapInput {
  deviceTokenHash: string;
}

export interface SyncV2ConnectionStatus {
  id: string;
  status: 'open' | 'pending' | 'approved' | 'cancelled' | 'claimed';
  fingerprint: string | null;
  expiresAt: string;
}

export interface SyncV2Invitation {
  id: string;
  kind: 'pair';
  status: 'open';
  connectUrl: string;
  expiresAt: string;
}

export interface SyncV2PairRequestInput {
  requestId: string;
  deviceTokenHash: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
}

export interface SyncV2PairStatus {
  request: SyncV2PairRequest;
  status: 'pending' | 'approved' | 'claimed';
  approval: SyncV2PairApproval | null;
}

export interface SyncV2MutationConflict {
  headRevision: number;
  checkpoint: SyncV2Checkpoint;
}

type SyncAuth =
  | { kind: 'none' }
  | { kind: 'device'; token: string }
  | { kind: 'pairing'; token: string }
  | { kind: 'connection'; token: string };

export class SyncV2Client {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = requireSecureSyncServerUrl(baseUrl).replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async ensureCompatible(): Promise<CompatibilityResponse> {
    const value = await this.requestJson('/v2/compatibility', {}, { kind: 'none' });
    if (
      !isRecord(value) ||
      !isRecord(value.service) ||
      typeof value.service.name !== 'string' ||
      typeof value.service.version !== 'string' ||
      !isRecord(value.protocol) ||
      value.protocol.current !== syncV2ProtocolVersion ||
      !Array.isArray(value.protocol.supported) ||
      !value.protocol.supported.includes(syncV2ProtocolVersion) ||
      !Array.isArray(value.protocol.suites) ||
      !value.protocol.suites.includes(syncV2Suite)
    ) {
      throw new Error('Sync server does not support the required encrypted protocol-v2 suite');
    }
    return {
      service: { name: value.service.name, version: value.service.version },
      protocol: { current: syncV2ProtocolVersion, supported: [syncV2ProtocolVersion] },
    };
  }

  async bootstrap(token: string, input: SyncV2BootstrapInput): Promise<void> {
    const value = await this.requestJson(
      '/v2/bootstrap',
      { method: 'POST', body: JSON.stringify(input) },
      { kind: 'device', token },
    );
    if (!isRecord(value) || value.created !== true || value.vaultId !== input.vaultId || value.deviceId !== input.deviceId) {
      throw new Error('Sync server returned an invalid encrypted vault bootstrap response');
    }
  }

  async requestBootstrapConnection(
    connectionToken: string,
    input: SyncV2BootstrapConnectionInput,
  ): Promise<SyncV2ConnectionStatus & { fingerprint: string }> {
    const value = await this.requestJson(
      '/v2/bootstrap/requests',
      { method: 'POST', body: JSON.stringify(input) },
      { kind: 'connection', token: connectionToken },
    );
    if (!isConnectionStatus(value) || value.status !== 'pending' || value.fingerprint === null) {
      throw new Error('Sync server returned an invalid first-device connection response');
    }
    return { ...value, fingerprint: value.fingerprint };
  }

  async bootstrapConnectionStatus(
    connectionToken: string,
    grantId: string,
  ): Promise<SyncV2ConnectionStatus> {
    const value = await this.requestJson(
      `/v2/bootstrap/requests/${encodeURIComponent(grantId)}`,
      {},
      { kind: 'connection', token: connectionToken },
    );
    if (!isConnectionStatus(value) || value.id !== grantId) {
      throw new Error('Sync server returned an invalid first-device connection status');
    }
    return value;
  }

  async claimBootstrapConnection(connectionToken: string, grantId: string): Promise<void> {
    const value = await this.requestJson(
      `/v2/bootstrap/requests/${encodeURIComponent(grantId)}/claim`,
      { method: 'POST' },
      { kind: 'connection', token: connectionToken },
    );
    if (!isRecord(value) || value.claimed !== true) {
      throw new Error('Sync server returned an invalid first-device connection claim');
    }
  }

  async cancelBootstrapConnection(connectionToken: string, grantId: string): Promise<void> {
    const value = await this.requestJson(
      `/v2/bootstrap/requests/${encodeURIComponent(grantId)}`,
      { method: 'DELETE' },
      { kind: 'connection', token: connectionToken },
    );
    if (!isRecord(value) || value.cancelled !== true) {
      throw new Error('Sync server returned an invalid first-device cancellation response');
    }
  }

  async requestPairing(input: SyncV2PairRequestInput): Promise<SyncV2PairRequest & { requestToken: string }> {
    const value = await this.requestJson(
      '/v2/pair/requests',
      { method: 'POST', body: JSON.stringify(input) },
      { kind: 'none' },
    );
    if (!isPairRequest(value) || typeof value.requestToken !== 'string' || value.requestToken.length < 20) {
      throw new Error('Sync server returned an invalid pairing request');
    }
    return { ...value, requestToken: value.requestToken };
  }

  async requestInvitedPairing(
    connectionToken: string,
    input: SyncV2PairRequestInput,
  ): Promise<SyncV2PairRequest & { requestToken: string }> {
    const value = await this.requestJson(
      '/v2/invitations/requests',
      { method: 'POST', body: JSON.stringify(input) },
      { kind: 'connection', token: connectionToken },
    );
    if (!isPairRequest(value) || typeof value.requestToken !== 'string' || value.requestToken.length < 20) {
      throw new Error('Sync server returned an invalid invited pairing request');
    }
    return { ...value, requestToken: value.requestToken };
  }

  async createInvitation(deviceToken: string): Promise<SyncV2Invitation> {
    const value = await this.requestJson('/v2/invitations', { method: 'POST' }, { kind: 'device', token: deviceToken });
    if (!isRecord(value) || typeof value.id !== 'string' || value.kind !== 'pair' || value.status !== 'open' ||
      typeof value.connectUrl !== 'string' || typeof value.expiresAt !== 'string') {
      throw new Error('Sync server returned an invalid device invitation');
    }
    const url = new URL(value.connectUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/connect' || url.search !== '' || !url.hash.startsWith('#grant=')) {
      throw new Error('Sync server returned an unsafe device invitation link');
    }
    return { id: value.id, kind: 'pair', status: 'open', connectUrl: value.connectUrl, expiresAt: value.expiresAt };
  }

  async cancelPairing(requestId: string, requestToken: string): Promise<void> {
    const value = await this.requestJson(
      `/v2/pair/requests/${encodeURIComponent(requestId)}`,
      { method: 'DELETE' },
      { kind: 'pairing', token: requestToken },
    );
    if (!isRecord(value) || value.cancelled !== true || value.requestId !== requestId) {
      throw new Error('Sync server returned an invalid pairing cancellation response');
    }
  }

  async inspectPairing(deviceToken: string, code: string): Promise<SyncV2PairRequest> {
    const value = await this.requestJson(
      '/v2/pair/inspect',
      { method: 'POST', body: JSON.stringify({ code }) },
      { kind: 'device', token: deviceToken },
    );
    if (!isPairRequest(value)) throw new Error('Sync server returned an invalid pending pairing request');
    return value;
  }

  async approvePairing(deviceToken: string, code: string, approval: SyncV2PairApproval): Promise<void> {
    const value = await this.requestJson(
      '/v2/pair/approve',
      { method: 'POST', body: JSON.stringify({ code, approval }) },
      { kind: 'device', token: deviceToken },
    );
    if (!isRecord(value) || value.approved !== true || value.requestId !== approval.requestId) {
      throw new Error('Sync server returned an invalid pairing approval response');
    }
  }

  async pairingStatus(requestId: string, requestToken: string): Promise<SyncV2PairStatus> {
    const value = await this.requestJson(
      `/v2/pair/status?requestId=${encodeURIComponent(requestId)}`,
      {},
      { kind: 'pairing', token: requestToken },
    );
    if (
      !isRecord(value) ||
      !isPairRequest(value.request) ||
      (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'claimed') ||
      (value.approval !== null && !isPairApproval(value.approval))
    ) {
      throw new Error('Sync server returned an invalid pairing status');
    }
    return { request: value.request, status: value.status, approval: value.approval };
  }

  async claimPairing(requestId: string, requestToken: string): Promise<void> {
    const value = await this.requestJson(
      '/v2/pair/claim',
      { method: 'POST', body: JSON.stringify({ requestId }) },
      { kind: 'pairing', token: requestToken },
    );
    if (!isRecord(value) || value.claimed !== true || typeof value.vaultId !== 'string' || typeof value.deviceId !== 'string') {
      throw new Error('Sync server returned an invalid pairing claim response');
    }
  }

  async changes(deviceToken: string, since: number): Promise<SyncV2ChangesResponse> {
    const value = await this.requestJson(
      `/v2/changes?since=${encodeURIComponent(String(since))}`,
      {},
      { kind: 'device', token: deviceToken },
    );
    if (
      !isRecord(value) ||
      !Array.isArray(value.changes) ||
      value.changes.length > 10 ||
      !value.changes.every(isStoredEnvelope) ||
      !isNonNegativeSafeInteger(value.cursor) ||
      value.cursor < since ||
      !isCheckpoint(value.checkpoint) ||
      value.checkpoint.sequence !== value.cursor ||
      typeof value.hasMore !== 'boolean' ||
      (value.hasMore && value.changes.length === 0)
    ) {
      throw new Error('Sync server returned an invalid encrypted changes response');
    }
    return {
      changes: value.changes,
      cursor: value.cursor,
      checkpoint: value.checkpoint,
      hasMore: value.hasMore,
    };
  }

  async putEnvelope(
    deviceToken: string,
    envelope: SyncV2Envelope,
    baseRevision: number,
  ): Promise<{ ok: true; response: SyncV2MutationResponse } | { ok: false; conflict: SyncV2MutationConflict }> {
    const response = await this.request(
      `/v2/objects/${encodeURIComponent(envelope.objectId)}`,
      { method: 'PUT', body: JSON.stringify({ baseRevision, envelope }) },
      { kind: 'device', token: deviceToken },
    );
    const value = await readBoundedSyncJson(response).catch((error: unknown) => {
      if (!response.ok) return null;
      throw error;
    });
    if (response.status === 409 && isMutationConflict(value)) return { ok: false, conflict: value };
    if (!response.ok) throw apiError(response.status, value);
    if (!isMutationResponse(value)) throw new Error('Sync server returned an invalid encrypted mutation response');
    return { ok: true, response: value };
  }

  async devices(deviceToken: string): Promise<SyncV2DevicesResponse> {
    let cursor = 0;
    let currentDeviceId = '';
    const devices: SyncV2DevicesResponse['devices'] = [];
    for (;;) {
      const value = await this.requestJson(
        `/v2/devices?cursor=${encodeURIComponent(String(cursor))}`,
        {},
        { kind: 'device', token: deviceToken },
      );
      if (!isDevicesResponse(value) || value.cursor < cursor || (value.hasMore && value.devices.length === 0)) {
        throw new Error('Sync server returned an invalid encrypted device list');
      }
      if (currentDeviceId !== '' && currentDeviceId !== value.currentDeviceId) {
        throw new Error('Sync server changed the current device identity during pagination');
      }
      currentDeviceId = value.currentDeviceId;
      devices.push(...value.devices);
      cursor = value.cursor;
      if (!value.hasMore) return { currentDeviceId, devices, cursor, hasMore: false };
    }
  }

  async renameDevice(deviceToken: string, deviceId: string, name: string): Promise<void> {
    const value = await this.requestJson(
      `/v2/devices/${encodeURIComponent(deviceId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      { kind: 'device', token: deviceToken },
    );
    if (!isRecord(value) || value.renamed !== true || value.deviceId !== deviceId || value.name !== name.trim()) {
      throw new Error('Sync server returned an invalid device rename response');
    }
  }

  async revokeDevice(deviceToken: string, deviceId: string): Promise<{ keyRotationRequired: boolean }> {
    const value = await this.requestJson(
      `/v2/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE' },
      { kind: 'device', token: deviceToken },
    );
    if (!isRecord(value) || value.revoked !== true || value.deviceId !== deviceId || value.keyRotationRequired !== true) {
      throw new Error('Sync server returned an invalid device revocation response');
    }
    return { keyRotationRequired: true };
  }

  private async requestJson(path: string, init: RequestInit, auth: SyncAuth): Promise<unknown> {
    const response = await this.request(path, init, auth);
    const value = await readBoundedSyncJson(response).catch((error: unknown) => {
      if (!response.ok) return null;
      throw error;
    });
    if (!response.ok) throw apiError(response.status, value);
    return value;
  }

  private request(path: string, init: RequestInit, auth: SyncAuth): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(auth.kind === 'device'
          ? { authorization: `Bearer ${auth.token}` }
          : auth.kind === 'pairing'
            ? { authorization: `Pairing ${auth.token}` }
            : auth.kind === 'connection'
              ? { authorization: `Connection ${auth.token}` }
              : {}),
        ...init.headers,
      },
    });
  }
}

function isStoredEnvelope(value: unknown): value is StoredSyncV2Envelope {
  if (!isRecord(value) || !isCheckpoint(value.checkpoint) || !isDeviceIdentity(value.author)) return false;
  try {
    requireSyncV2Envelope(value as unknown as SyncV2Envelope);
    return value.checkpoint.sequence === value.sequence;
  } catch {
    return false;
  }
}

function isDeviceIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.deviceId === 'string' &&
    typeof value.deviceName === 'string' &&
    typeof value.agreementPublicKey === 'string' &&
    typeof value.signingPublicKey === 'string' &&
    isDeviceCertificate(value.certificate)
  );
}

function isDevicesResponse(value: unknown): value is SyncV2DevicesResponse {
  return (
    isRecord(value) &&
    typeof value.currentDeviceId === 'string' &&
    Array.isArray(value.devices) &&
    value.devices.length <= 50 &&
    value.devices.every(
      (device) =>
        isDeviceIdentity(device) &&
        isRecord(device) &&
        typeof device.createdAt === 'string' &&
        (device.lastSeenAt === null || typeof device.lastSeenAt === 'string') &&
        (device.revokedAt === null || typeof device.revokedAt === 'string'),
    ) &&
    isNonNegativeSafeInteger(value.cursor) &&
    typeof value.hasMore === 'boolean'
  );
}

function isPairRequest(value: unknown): value is SyncV2PairRequest & { requestToken?: string } {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.deviceName === 'string' &&
    typeof value.agreementPublicKey === 'string' &&
    typeof value.signingPublicKey === 'string' &&
    typeof value.expiresAt === 'string'
  );
}

function isConnectionStatus(value: unknown): value is SyncV2ConnectionStatus {
  return isRecord(value) && typeof value.id === 'string' &&
    ['open', 'pending', 'approved', 'cancelled', 'claimed'].includes(String(value.status)) &&
    (value.fingerprint === null || typeof value.fingerprint === 'string') && typeof value.expiresAt === 'string';
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

function isMutationResponse(value: unknown): value is SyncV2MutationResponse {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.revision) &&
    isPositiveSafeInteger(value.sequence) &&
    isCheckpoint(value.checkpoint) &&
    value.checkpoint.sequence === value.sequence &&
    typeof value.replayed === 'boolean'
  );
}

function isMutationConflict(value: unknown): value is SyncV2MutationConflict {
  return isRecord(value) && isNonNegativeSafeInteger(value.headRevision) && isCheckpoint(value.checkpoint);
}

function isCheckpoint(value: unknown): value is SyncV2Checkpoint {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.sequence) &&
    typeof value.digest === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.digest)
  );
}

function apiError(status: number, value: unknown): Error {
  const error = isRecord(value) && isRecord(value.error) ? value.error : null;
  const detail = error !== null && typeof error.code === 'string' && typeof error.message === 'string'
    ? ` (${error.code}: ${error.message})`
    : '';
  return new Error(`Encrypted sync request failed: ${status}${detail}`);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
