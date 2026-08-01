import type {
  ActivityRecord,
  ApplicationCommand,
  ApplicationCommandResult,
  ApplyReport,
  ArtifactValidationResult,
  DriftRecord,
  LibraryArtifactMetadata,
  StoredProjectDiscovery,
} from '@reglet/core';

export interface RuntimeClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface LibraryArtifactDetail {
  artifact: LibraryArtifactMetadata;
  content: string;
  history: unknown[];
  validation: ArtifactValidationResult;
}

export interface RuntimeInvalidation {
  type: 'connected' | 'invalidated';
  revision?: number;
  scope?: 'read' | 'write' | 'admin';
}

export class RuntimeClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RuntimeClientError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Typed browser client for the same serialized application commands used by
 * the CLI. It carries the latest optimistic revision across mutations so a
 * stale window cannot silently overwrite newer local or remote work.
 */
export class RegletRuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private observedRevision: number | undefined;

  constructor(options: RuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory =
      options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  revision(): number | undefined {
    return this.observedRevision;
  }

  async execute<T>(
    command: ApplicationCommand,
    options: { optimistic?: boolean } = {},
  ): Promise<ApplicationCommandResult & { data: T }> {
    const optimistic = options.optimistic ?? isMutatingCommand(command);
    const response = await this.fetcher(`${this.baseUrl}/v1/commands`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        ...command,
        ...(optimistic && this.observedRevision !== undefined
          ? { expectedRevision: this.observedRevision }
          : {}),
      }),
    });
    const result = await parseRuntimeResponse<T>(response);
    this.observedRevision = result.revision;
    return result;
  }

  async listLibrary(
    options: {
      kind?: LibraryArtifactMetadata['kind'];
      lifecycle?: LibraryArtifactMetadata['lifecycle'];
    } = {},
  ): Promise<LibraryArtifactMetadata[]> {
    const result = await this.execute<LibraryArtifactMetadata[]>(
      {
        type: 'library.list',
        kind: options.kind,
        lifecycle: options.lifecycle,
      },
      { optimistic: false },
    );
    return result.data;
  }

  async showArtifact(artifact: string): Promise<LibraryArtifactDetail> {
    const result = await this.execute<LibraryArtifactDetail>(
      { type: 'library.show', artifact },
      { optimistic: false },
    );
    return result.data;
  }

  async saveArtifact(
    artifact: string,
    content: string,
  ): Promise<ApplicationCommandResult> {
    return this.execute({ type: 'library.save', artifact, content });
  }

  async projectDiscoveries(rootId?: string): Promise<StoredProjectDiscovery[]> {
    const result = await this.execute<StoredProjectDiscovery[]>(
      { type: 'project.discoveries', rootId },
      { optimistic: false },
    );
    return result.data;
  }

  async providerStatus(): Promise<DriftRecord[]> {
    const result = await this.execute<DriftRecord[]>(
      { type: 'providers.status' },
      { optimistic: false },
    );
    return result.data;
  }

  async apply(options: {
    providers?: Extract<
      ApplicationCommand,
      { type: 'providers.apply' }
    >['providers'];
    contents?: Extract<
      ApplicationCommand,
      { type: 'providers.apply' }
    >['contents'];
    allowOverwriteDrift?: boolean;
  } = {}): Promise<ApplyReport> {
    const result = await this.execute<ApplyReport>({
      type: 'providers.apply',
      ...options,
    });
    return result.data;
  }

  async activity(limit = 100): Promise<ActivityRecord[]> {
    const result = await this.execute<ActivityRecord[]>(
      { type: 'activity.list', limit },
      { optimistic: false },
    );
    return result.data;
  }

  subscribe(
    onInvalidation: (event: RuntimeInvalidation) => void,
    onError?: (event: Event) => void,
  ): () => void {
    let socket: WebSocket | undefined;
    let closed = false;
    void this.createEventSocket()
      .then((created) => {
        if (closed) {
          created.close(1000, 'Manager subscription closed');
          return;
        }
        socket = created;
        created.addEventListener('message', (event) => {
          const invalidation = parseInvalidation(event.data);
          if (invalidation === undefined) {
            return;
          }
          if (invalidation.revision !== undefined) {
            this.observedRevision = invalidation.revision;
          }
          onInvalidation(invalidation);
        });
        if (onError !== undefined) {
          created.addEventListener('error', onError);
        }
      })
      .catch(() => onError?.(new Event('error')));
    return () => {
      closed = true;
      socket?.close(1000, 'Manager subscription closed');
    };
  }

  private headers(): Headers {
    return new Headers({
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    });
  }

  private async createEventSocket(): Promise<WebSocket> {
    const response = await this.fetcher(`${this.baseUrl}/v1/events/ticket`, {
      method: 'POST',
      headers: this.headers(),
    });
    const value = (await response.json()) as unknown;
    if (
      !response.ok ||
      typeof value !== 'object' ||
      value === null ||
      !('ticket' in value) ||
      typeof value.ticket !== 'string'
    ) {
      const error = runtimeErrorPayload(value);
      throw new RuntimeClientError(response.status, error.code, error.message);
    }
    const url = new URL('/v1/events', this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', value.ticket);
    return this.webSocketFactory(url.toString());
  }
}

async function parseRuntimeResponse<T>(
  response: Response,
): Promise<ApplicationCommandResult & { data: T }> {
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const error = runtimeErrorPayload(value);
    throw new RuntimeClientError(response.status, error.code, error.message);
  }
  if (!isCommandResult(value)) {
    throw new RuntimeClientError(
      response.status,
      'invalid-response',
      'The local runtime returned an invalid command result.',
    );
  }
  return {
    revision: value.revision,
    changed: value.changed,
    data: value.data as T,
  };
}

function isCommandResult(
  value: unknown,
): value is {
  revision: number;
  changed: boolean;
  data: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'revision' in value &&
    typeof value.revision === 'number' &&
    'changed' in value &&
    typeof value.changed === 'boolean' &&
    'data' in value
  );
}

function runtimeErrorPayload(value: unknown): {
  code: string;
  message: string;
} {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    typeof value.error.code === 'string' &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  ) {
    return { code: value.error.code, message: value.error.message };
  }
  return {
    code: 'operation-error',
    message: 'The local runtime request failed.',
  };
}

function parseInvalidation(value: unknown): RuntimeInvalidation | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    (parsed.type !== 'connected' && parsed.type !== 'invalidated')
  ) {
    return undefined;
  }
  return {
    type: parsed.type,
    revision:
      'revision' in parsed && typeof parsed.revision === 'number'
        ? parsed.revision
        : undefined,
    scope:
      'scope' in parsed &&
      (parsed.scope === 'read' ||
        parsed.scope === 'write' ||
        parsed.scope === 'admin')
        ? parsed.scope
        : undefined,
  };
}

function isMutatingCommand(command: ApplicationCommand): boolean {
  if (command.type === 'providers.apply' && command.dryRun === true) {
    return false;
  }
  return ![
    'manager.snapshot',
    'library.list',
    'library.show',
    'library.inspect-skill',
    'providers.preview',
    'project.root.list',
    'project.discoveries',
    'history.list',
    'activity.list',
    'search',
    'diagnostics',
    'secret.status',
    'remote.status',
    'sync.status',
    'providers.status',
    'external.open',
  ].includes(command.type);
}
