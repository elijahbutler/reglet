import { syncFileRoute } from './path.js';

export interface SyncChange {
  path: string;
  revision: number;
  hash: string;
  deleted: boolean;
  seq: number;
}

export interface ChangesResponse {
  changes: SyncChange[];
  cursor: number;
  hasMore: boolean;
}

export interface RemoteFile {
  revision: number;
  hash: string;
  contentBase64: string;
}

export interface PutFileResponse {
  revision: number;
}

export interface ConflictResponse {
  headRevision: number;
  headHash: string;
  headDeleted: boolean;
  contentBase64: string;
}

export interface CompatibilityResponse {
  service: { name: string; version: string };
  protocol: { current: number; supported: number[] };
}

export interface SyncDevice {
  id: number;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface DevicesResponse {
  currentDeviceId: number;
  devices: SyncDevice[];
}

export interface SyncApiError {
  error: { code: string; message: string };
}

export const syncProtocolVersion = 1;
const maximumSyncResponseBytes = 2 * 1024 * 1024;

export class SyncClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = requireSecureSyncServerUrl(baseUrl).replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async ensureCompatible(): Promise<CompatibilityResponse> {
    const value = await this.requestJson<unknown>('/v1/compatibility', {}, false);
    if (!isCompatibilityResponse(value)) {
      throw new Error('Sync server returned invalid compatibility metadata');
    }
    const compatibility = value;
    if (!compatibility.protocol.supported.includes(syncProtocolVersion)) {
      throw new Error(
        `Sync server does not support Reglet protocol ${syncProtocolVersion}. ` +
          `Server supports: ${compatibility.protocol.supported.join(', ') || 'none'}.`,
      );
    }
    return compatibility;
  }

  async changes(since: number): Promise<ChangesResponse> {
    const value = await this.requestJson<unknown>(`/v1/changes?since=${encodeURIComponent(String(since))}`);
    if (!isChangesResponse(value, since)) {
      throw new Error('Sync server returned an invalid changes response');
    }
    return value;
  }

  async getFile(filePath: string): Promise<RemoteFile> {
    const value = await this.requestJson<unknown>(`/v1/files/${syncFileRoute(filePath)}`);
    if (!isRemoteFile(value)) {
      throw new Error('Sync server returned an invalid file response');
    }
    return value;
  }

  async putFile(filePath: string, baseRevision: number, content: Uint8Array): Promise<PutFileResponse> {
    const value = await this.requestJson<unknown>(`/v1/files/${syncFileRoute(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseRevision,
        contentBase64: Buffer.from(content).toString('base64'),
      }),
    });
    if (!isPutFileResponse(value)) {
      throw new Error('Sync server returned an invalid put response');
    }
    return value;
  }

  async deleteFile(filePath: string, baseRevision: number): Promise<PutFileResponse> {
    const value = await this.requestJson<unknown>(`/v1/files/${syncFileRoute(filePath)}`, {
      method: 'DELETE',
      body: JSON.stringify({ baseRevision }),
    });
    if (!isPutFileResponse(value)) {
      throw new Error('Sync server returned an invalid delete response');
    }
    return value;
  }

  async tryPutFile(
    filePath: string,
    baseRevision: number,
    content: Uint8Array,
  ): Promise<{ ok: true; revision: number } | { ok: false; conflict: ConflictResponse }> {
    const response = await this.request(`/v1/files/${syncFileRoute(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseRevision,
        contentBase64: Buffer.from(content).toString('base64'),
      }),
    });
    const body = await readBoundedSyncJson(response);
    if (response.status === 409 && isConflictResponse(body)) {
      return { ok: false, conflict: body };
    }
    if (!response.ok) {
      throw new Error(`Sync request failed: ${response.status}`);
    }
    if (!isPutFileResponse(body)) {
      throw new Error('Invalid put response');
    }
    return { ok: true, revision: body.revision };
  }

  async tryDeleteFile(
    filePath: string,
    baseRevision: number,
  ): Promise<{ ok: true; revision: number } | { ok: false; conflict: ConflictResponse }> {
    const response = await this.request(`/v1/files/${syncFileRoute(filePath)}`, {
      method: 'DELETE',
      body: JSON.stringify({ baseRevision }),
    });
    const body = await readBoundedSyncJson(response);
    if (response.status === 409 && isConflictResponse(body)) {
      return { ok: false, conflict: body };
    }
    if (!response.ok) {
      throw new Error(`Sync delete failed: ${response.status}`);
    }
    if (!isPutFileResponse(body)) {
      throw new Error('Invalid delete response');
    }
    return { ok: true, revision: body.revision };
  }

  async devices(): Promise<DevicesResponse> {
    const value = await this.requestJson<unknown>('/v1/devices');
    if (!isDevicesResponse(value)) throw new Error('Sync server returned an invalid devices response');
    return value;
  }

  async revokeDevice(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Device id is invalid');
    const value = await this.requestJson<unknown>(`/v1/devices/${id}`, { method: 'DELETE' });
    if (!isRecord(value) || value.revoked !== true || value.id !== id) {
      throw new Error('Sync server returned an invalid device revocation response');
    }
  }

  async renameDevice(id: number, name: string): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1 || name.trim().length === 0) throw new Error('Device rename is invalid');
    const value = await this.requestJson<unknown>(`/v1/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    if (!isRecord(value) || value.renamed !== true || value.id !== id || value.name !== name.trim()) {
      throw new Error('Sync server returned an invalid device rename response');
    }
  }

  async rotateDeviceToken(): Promise<string> {
    const value = await this.requestJson<unknown>('/v1/devices/current/token/rotate', { method: 'POST' });
    if (!isRecord(value) || typeof value.deviceToken !== 'string' || value.deviceToken.length < 20) {
      throw new Error('Sync server returned an invalid device token rotation response');
    }
    return value.deviceToken;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const response = await this.request(path, init, authenticated);
    const body = await readBoundedSyncJson(response).catch((error: unknown) => {
      if (!response.ok) return null;
      throw error;
    });
    if (!response.ok) {
      const detail = isSyncApiError(body) ? ` (${body.error.code}: ${body.error.message})` : '';
      throw new Error(`Sync request failed: ${response.status}${detail}`);
    }
    return body as T;
  }

  private async request(path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });
  }
}

export async function readBoundedSyncJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maximumSyncResponseBytes) {
      throw new Error('Sync server response is too large');
    }
  }
  if (response.body === null) throw new Error('Sync server returned an empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maximumSyncResponseBytes) {
      await reader.cancel();
      throw new Error('Sync server response is too large');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    throw new Error('Sync server returned invalid JSON');
  }
}

export function requireSecureSyncServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Sync server URL must be a valid absolute URL');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('Sync requires HTTPS except for a loopback development server');
  }
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new Error('Sync server URL must not include credentials, query parameters, or fragments');
  }
  return url.toString().replace(/\/$/, '');
}

function isSyncApiError(value: unknown): value is SyncApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

function isChangesResponse(value: unknown, since: number): value is ChangesResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.changes) ||
    value.changes.length > 500 ||
    !isSafeRevision(value.cursor) ||
    value.cursor < since ||
    typeof value.hasMore !== 'boolean' ||
    (value.hasMore && value.changes.length === 0)
  ) {
    return false;
  }
  let lastSequence = since;
  for (const change of value.changes) {
    if (
      !isRecord(change) ||
      typeof change.path !== 'string' ||
      !isPositiveInteger(change.revision) ||
      typeof change.deleted !== 'boolean' ||
      !isSyncContentHash(change.hash, change.deleted) ||
      !isSafeRevision(change.seq) ||
      change.seq <= lastSequence ||
      change.seq > value.cursor
    ) {
      return false;
    }
    lastSequence = change.seq;
  }
  return value.cursor === lastSequence;
}

function isCompatibilityResponse(value: unknown): value is CompatibilityResponse {
  if (!isRecord(value) || !isRecord(value.service) || !isRecord(value.protocol)) return false;
  return (
    typeof value.service.name === 'string' &&
    typeof value.service.version === 'string' &&
    isPositiveInteger(value.protocol.current) &&
    Array.isArray(value.protocol.supported) &&
    value.protocol.supported.length <= 16 &&
    value.protocol.supported.every(isPositiveInteger)
  );
}

function isRemoteFile(value: unknown): value is RemoteFile {
  return (
    isRecord(value) &&
    isPositiveInteger(value.revision) &&
    isSyncContentHash(value.hash, false) &&
    typeof value.contentBase64 === 'string' &&
    isStrictBase64(value.contentBase64)
  );
}

function isDevicesResponse(value: unknown): value is DevicesResponse {
  return (
    isRecord(value) &&
    isPositiveInteger(value.currentDeviceId) &&
    Array.isArray(value.devices) &&
    value.devices.length <= 100 &&
    value.devices.every((device) =>
      isRecord(device) &&
      isPositiveInteger(device.id) &&
      typeof device.name === 'string' &&
      typeof device.createdAt === 'string' &&
      (device.lastSeenAt === null || typeof device.lastSeenAt === 'string') &&
      (device.revokedAt === null || typeof device.revokedAt === 'string'),
    )
  );
}

function isPutFileResponse(value: unknown): value is PutFileResponse {
  return isRecord(value) && isPositiveInteger(value.revision);
}

function isConflictResponse(value: unknown): value is ConflictResponse {
  return (
    isRecord(value) &&
    isSafeRevision(value.headRevision) &&
    typeof value.headHash === 'string' &&
    typeof value.headDeleted === 'boolean' &&
    typeof value.contentBase64 === 'string' &&
    isStrictBase64(value.contentBase64) &&
    (value.headDeleted
      ? value.headHash === '' && value.contentBase64 === ''
      : value.headRevision === 0
        ? value.headHash === '' && value.contentBase64 === ''
        : isSyncContentHash(value.headHash, false))
  );
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length % 4 !== 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function isSyncContentHash(value: unknown, deleted: boolean): value is string {
  return typeof value === 'string' && (deleted ? value === '' : /^[a-f0-9]{64}$/.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
