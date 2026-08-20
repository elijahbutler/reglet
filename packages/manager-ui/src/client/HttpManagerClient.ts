import {
  isJsonValue,
  isManagerMutatingOperation,
  isManagerSnapshotV3,
  managerProtocolVersion,
  managerRpcRequestValidator,
  managerRpcResponseValidator,
  type JsonValue,
  type ManagerProtocolOperation,
  type ManagerRpcInputs,
  type ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type {
  ManagerClient,
  ManagerCommandOptions,
  ManagerCommandResult,
  ManagerInvalidation,
} from './ManagerClient.js';

export interface HttpManagerClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: (url: string) => WebSocket;
}

export class ManagerTransportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoverable: boolean;

  constructor(status: number, code: string, message: string, recoverable: boolean) {
    super(message);
    this.name = 'ManagerTransportError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class HttpManagerClient implements ManagerClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private token?: string;
  private revision?: number;

  constructor(options: HttpManagerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  async pair(code: string): Promise<{ id: string; scope: 'read' | 'write' | 'admin' }> {
    const response = await this.fetcher(`${this.baseUrl}/v2/pair/claim`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    const value = await readJson(response);
    if (!response.ok) throw transportError(response.status, value);
    if (!isPairingResponse(value)) throw new ManagerTransportError(response.status, 'INVALID_INPUT', 'Runtime returned an invalid pairing response.', false);
    this.token = value.token;
    return value.session;
  }

  async snapshot(): Promise<ManagerSnapshotV3> {
    const result = await this.command('snapshot', { contractVersion: 3 });
    if (!isManagerSnapshotV3(result.data)) {
      throw new ManagerTransportError(200, 'INVALID_INPUT', 'Runtime returned an invalid Manager Snapshot V3.', false);
    }
    return result.data;
  }

  async command<Operation extends ManagerProtocolOperation>(
    operation: Operation,
    input?: ManagerRpcInputs[Operation],
    options: ManagerCommandOptions = {},
  ): Promise<ManagerCommandResult> {
    const request = {
      protocolVersion: managerProtocolVersion,
      operation,
      ...(input === undefined ? {} : { input }),
    };
    if (!managerRpcRequestValidator.validate(request)) {
      throw new ManagerTransportError(0, 'INVALID_INPUT', 'Manager command input failed local validation.', false);
    }
    const expectedRevision = options.expectedRevision ?? (isManagerMutatingOperation(operation) ? this.revision : undefined);
    const response = await this.fetcher(`${this.baseUrl}/v2/commands`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token === undefined ? {} : { Authorization: `Bearer ${this.token}` }),
        ...(expectedRevision === undefined ? {} : { 'X-Reglet-Revision': String(expectedRevision) }),
      },
      body: JSON.stringify(request),
    });
    const envelope = await readJson(response);
    if (!managerRpcResponseValidator.validate(envelope)) {
      throw new ManagerTransportError(response.status, 'INVALID_INPUT', 'Runtime returned an invalid protocol response.', false);
    }
    if (!envelope.ok) {
      throw new ManagerTransportError(response.status, envelope.error.code, envelope.error.message, envelope.error.recoverable);
    }
    if (envelope.operation !== operation || !isCommandResult(envelope.result)) {
      throw new ManagerTransportError(response.status, 'INVALID_INPUT', 'Runtime returned a mismatched command result.', false);
    }
    this.advanceRevision(envelope.result.revision);
    return envelope.result;
  }

  subscribe(listener: (invalidation: ManagerInvalidation) => void): () => void {
    let closed = false;
    let connecting = false;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 250;

    const scheduleReconnect = () => {
      if (closed || retryTimer !== undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        connect();
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
    };
    const connect = () => {
      if (closed || connecting) return;
      connecting = true;
      void this.eventTicket().then((ticket) => {
        if (closed) return;
        const url = new URL('/v2/events', this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('ticket', ticket);
        const nextSocket = this.webSocketFactory(url.toString());
        socket = nextSocket;
        nextSocket.addEventListener('open', () => { retryDelayMs = 250; }, { once: true });
        nextSocket.addEventListener('message', (event) => {
          const invalidation = parseInvalidation(event.data);
          if (invalidation === undefined) return;
          this.advanceRevision(invalidation.revision);
          listener(invalidation);
        });
        nextSocket.addEventListener('close', () => {
          if (socket === nextSocket) socket = undefined;
          scheduleReconnect();
        }, { once: true });
        nextSocket.addEventListener('error', () => {
          nextSocket.close();
          scheduleReconnect();
        }, { once: true });
      }).catch(scheduleReconnect).finally(() => {
        connecting = false;
      });
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      socket?.close(1000, 'Manager subscription closed');
    };
  }

  private async eventTicket(): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/v2/events/ticket`, {
      method: 'POST',
      credentials: 'include',
      headers: this.token === undefined ? {} : { Authorization: `Bearer ${this.token}` },
    });
    const value = await readJson(response);
    if (!response.ok) throw transportError(response.status, value);
    if (!isRecord(value) || typeof value.ticket !== 'string') {
      throw new ManagerTransportError(response.status, 'INVALID_INPUT', 'Runtime returned an invalid event ticket.', false);
    }
    return value.ticket;
  }

  private advanceRevision(revision: number): void {
    this.revision = Math.max(this.revision ?? 0, revision);
  }
}

/** Tauri uses the same loopback transport with an admin bootstrap credential. */
export class TauriManagerClient extends HttpManagerClient {}

function isCommandResult(value: JsonValue): value is JsonValue & ManagerCommandResult {
  return isRecord(value) &&
    typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.changed === 'boolean' &&
    isJsonValue(value.data);
}

function isPairingResponse(value: unknown): value is {
  token: string;
  session: { id: string; scope: 'read' | 'write' | 'admin' };
} {
  return isRecord(value) && typeof value.token === 'string' && isRecord(value.session) &&
    typeof value.session.id === 'string' &&
    (value.session.scope === 'read' || value.session.scope === 'write' || value.session.scope === 'admin');
}

function parseInvalidation(value: unknown): ManagerInvalidation | undefined {
  if (typeof value !== 'string') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { return undefined; }
  if (!isRecord(parsed) || parsed.type !== 'invalidated' || typeof parsed.revision !== 'number') return undefined;
  if (parsed.reason !== 'command' && parsed.reason !== 'filesystem' && parsed.reason !== 'sync' && parsed.reason !== 'runtime') return undefined;
  return { revision: parsed.revision, reason: parsed.reason };
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { return undefined; }
}

function transportError(status: number, value: unknown): ManagerTransportError {
  if (managerRpcResponseValidator.validate(value) && !value.ok) {
    return new ManagerTransportError(status, value.error.code, value.error.message, value.error.recoverable);
  }
  return new ManagerTransportError(status, 'OPERATION_FAILED', 'Manager runtime request failed.', true);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
