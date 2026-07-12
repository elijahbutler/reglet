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
  contentBase64: string;
}

export interface CompatibilityResponse {
  service: { name: string; version: string };
  protocol: { current: number; supported: number[] };
}

export interface SyncApiError {
  error: { code: string; message: string };
}

export const syncProtocolVersion = 1;

export class SyncClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async ensureCompatible(): Promise<CompatibilityResponse> {
    const compatibility = await this.requestJson<CompatibilityResponse>('/v1/compatibility', {}, false);
    if (!compatibility.protocol.supported.includes(syncProtocolVersion)) {
      throw new Error(
        `Sync server does not support Reglet protocol ${syncProtocolVersion}. ` +
          `Server supports: ${compatibility.protocol.supported.join(', ') || 'none'}.`,
      );
    }
    return compatibility;
  }

  async changes(since: number): Promise<ChangesResponse> {
    return this.requestJson<ChangesResponse>(`/v1/changes?since=${encodeURIComponent(String(since))}`);
  }

  async getFile(filePath: string): Promise<RemoteFile> {
    return this.requestJson<RemoteFile>(`/v1/files/${filePath}`);
  }

  async putFile(filePath: string, baseRevision: number, content: Uint8Array): Promise<PutFileResponse> {
    return this.requestJson<PutFileResponse>(`/v1/files/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseRevision,
        contentBase64: Buffer.from(content).toString('base64'),
      }),
    });
  }

  async deleteFile(filePath: string, baseRevision: number): Promise<PutFileResponse> {
    return this.requestJson<PutFileResponse>(`/v1/files/${filePath}`, {
      method: 'DELETE',
      body: JSON.stringify({ baseRevision }),
    });
  }

  async tryPutFile(
    filePath: string,
    baseRevision: number,
    content: Uint8Array,
  ): Promise<{ ok: true; revision: number } | { ok: false; conflict: ConflictResponse }> {
    const response = await this.request(`/v1/files/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseRevision,
        contentBase64: Buffer.from(content).toString('base64'),
      }),
    });
    const body = (await response.json()) as unknown;
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

  private async requestJson<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const response = await this.request(path, init, authenticated);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as unknown;
      const detail = isSyncApiError(body) ? ` (${body.error.code}: ${body.error.message})` : '';
      throw new Error(`Sync request failed: ${response.status}${detail}`);
    }
    return (await response.json()) as T;
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

function isPutFileResponse(value: unknown): value is PutFileResponse {
  return typeof value === 'object' && value !== null && 'revision' in value && typeof value.revision === 'number';
}

function isConflictResponse(value: unknown): value is ConflictResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'headRevision' in value &&
    'contentBase64' in value &&
    typeof value.headRevision === 'number' &&
    typeof value.contentBase64 === 'string'
  );
}
