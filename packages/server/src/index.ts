import { access } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  ApplicationPermissionError,
  LocalState,
  RegletApplication,
  RevisionConflictError,
  inspectEffectiveProviderConfiguration,
  regletHome,
  systemSecretStore,
  type ApplicationCommand,
  type ProviderId,
  type RemoteSessionRecord,
} from '@reglet/core';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import { recordRuntimeLog, redactLogValue } from './logging.js';
import { ProjectRootWatcher } from './project-watcher.js';

export * from './sync.js';
export * from './project-watcher.js';

interface RuntimeVariables {
  session: RemoteSessionRecord;
}

export interface RuntimeReadiness {
  ready: boolean;
  database: boolean;
  canonicalDirectory: boolean;
  watcher: boolean;
  keychain: boolean;
}

export interface RuntimeAppOptions {
  home?: string;
  watcherReady?: () => boolean;
  watchProjects?: boolean;
  managerAssetsDir?: string;
}

export interface RuntimeServeOptions extends RuntimeAppOptions {
  hostname?: string;
  port?: number;
  allowPublicWildcard?: boolean;
  tlsCertificate?: string;
  tlsPrivateKey?: string;
}

export interface RuntimeApp {
  app: Hono<{ Variables: RuntimeVariables }>;
  websocket: ReturnType<typeof createBunWebSocket>['websocket'];
  watcher?: ProjectRootWatcher;
  dispose(): Promise<void>;
}

export function createRuntimeApp(options: RuntimeAppOptions = {}): RuntimeApp {
  const home = options.home ?? regletHome();
  const application = new RegletApplication(home);
  const managerAssetsDir =
    options.managerAssetsDir ??
    process.env.REGLET_MANAGER_ASSETS_DIR ??
    path.resolve(import.meta.dir, '..', '..', 'manager');
  const sockets = new Map<WSContext, string>();
  const websocketTickets = new Map<
    string,
    { session: RemoteSessionRecord; expiresAt: number }
  >();
  const pairingFailures: number[] = [];
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono<{ Variables: RuntimeVariables }>();
  const watcher =
    options.watchProjects === true && options.watcherReady === undefined
      ? new ProjectRootWatcher({
          home,
          application,
          onInvalidation(revision) {
            broadcastInvalidation(sockets, revision);
          },
        })
      : undefined;
  void watcher?.start();

  app.onError((error, context) => {
    const status =
      error instanceof ApplicationPermissionError
        ? 403
        : error instanceof RevisionConflictError
          ? 409
          : error instanceof SyntaxError
            ? 400
            : 500;
    recordRuntimeLog(home, 'request-error', {
      status,
      error: error.name,
      message: redactMessage(error.message),
    });
    return context.json(
      {
        error: {
          code:
            status === 403
              ? 'permission-denied'
              : status === 409
                ? 'revision-conflict'
                : status === 400
                  ? 'invalid-request'
                : 'operation-error',
          message:
            status === 500
              ? 'The operation failed. Check local diagnostics for metadata.'
              : status === 400
                ? 'Request body is not valid JSON.'
              : redactMessage(error.message),
        },
      },
      status,
    );
  });

  app.get('/', (context) =>
    context.json({
      product: 'Reglet',
      localFirst: true,
      remoteAccess: 'disabled-by-default',
      manager: '/manager/',
      health: '/healthz',
      readiness: '/readyz',
    }),
  );
  app.get('/manager', (context) => context.redirect('/manager/'));
  app.get('/manager/', (context) =>
    managerAssetResponse(
      context.req.raw,
      path.join(managerAssetsDir, 'index.html'),
      'text/html; charset=utf-8',
      true,
    ),
  );
  app.get('/manager/src/styles.css', (context) =>
    managerAssetResponse(
      context.req.raw,
      path.join(managerAssetsDir, 'src', 'styles.css'),
      'text/css; charset=utf-8',
    ),
  );
  app.get('/manager/src/app.js', (context) =>
    managerAssetResponse(
      context.req.raw,
      path.join(managerAssetsDir, 'src', 'app.js'),
      'text/javascript; charset=utf-8',
    ),
  );
  app.get('/manager/src/runtime.js', (context) =>
    managerAssetResponse(
      context.req.raw,
      path.join(managerAssetsDir, 'src', 'runtime.js'),
      'text/javascript; charset=utf-8',
    ),
  );
  app.get('/healthz', (context) => context.json({ status: 'ok' }));
  app.get('/readyz', async (context) => {
    const readiness = await readReadiness(
      home,
      options.watcherReady ?? (() => watcher?.isReady() ?? true),
    );
    return context.json(readiness, readiness.ready ? 200 : 503);
  });

  app.post('/v1/pair/claim', async (context) => {
    prunePairingFailures(pairingFailures);
    if (pairingFailures.length >= 12) {
      context.header('Retry-After', '60');
      return context.json(
        {
          error: {
            code: 'pairing-rate-limited',
            message: 'Too many pairing attempts. Try again shortly.',
          },
        },
        429,
      );
    }
    const body = await context.req.json<unknown>();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('code' in body) ||
      typeof body.code !== 'string'
    ) {
      return context.json(
        { error: { code: 'invalid-request', message: 'A pairing code is required.' } },
        400,
      );
    }
    const state = await LocalState.open(home);
    try {
      const claimed = state.claimPairingCredential(body.code);
      if (claimed === undefined) {
        pairingFailures.push(Date.now());
        return context.json(
          {
            error: {
              code: 'pairing-invalid',
              message: 'Pairing credential is invalid, expired, or already used.',
            },
          },
          401,
        );
      }
      context.header(
        'Set-Cookie',
        sessionCookie(claimed.token, context.req.url.startsWith('https://')),
      );
      return context.json(claimed, 201);
    } finally {
      state.close();
    }
  });

  app.use('/v1/*', async (context, next) => {
    if (context.req.path === '/v1/pair/claim') {
      await next();
      return;
    }
    if (context.req.path === '/v1/events') {
      const ticket = context.req.query('ticket');
      const claimed = consumeWebSocketTicket(websocketTickets, ticket);
      if (claimed === undefined) {
        return context.json(
          {
            error: {
              code: 'authentication-failed',
              message: 'WebSocket ticket is invalid, expired, or already used.',
            },
          },
          401,
        );
      }
      context.set('session', claimed);
      await next();
      return;
    }
    const token =
      bearerToken(context.req.header('Authorization')) ??
      cookieValue(context.req.header('Cookie'), 'reglet_session');
    if (token === undefined) {
      return context.json(
        { error: { code: 'authentication-required', message: 'A session token is required.' } },
        401,
      );
    }
    const state = await LocalState.open(home);
    try {
      const session = state.authorizeSession(token);
      if (session === undefined) {
        return context.json(
          { error: { code: 'authentication-failed', message: 'Session is invalid or revoked.' } },
          401,
        );
      }
      context.set('session', session);
    } finally {
      state.close();
    }
    await next();
  });

  app.get('/v1/library', async (context) => {
    const result = await application.execute(
      { type: 'library.list' },
      { scope: context.get('session').scope },
    );
    return context.json(result);
  });

  app.get('/v1/providers/:provider', async (context) => {
    if (context.get('session').scope !== 'admin') {
      throw new ApplicationPermissionError('manager.snapshot', 'admin');
    }
    const provider = parseProvider(context.req.param('provider'));
    if (provider === undefined) {
      return context.json(
        { error: { code: 'provider-unknown', message: 'Unknown provider.' } },
        404,
      );
    }
    return context.json(
      await inspectEffectiveProviderConfiguration(provider, home),
    );
  });

  app.get('/v1/session', (context) =>
    context.json({ session: context.get('session') }),
  );

  app.post('/v1/events/ticket', (context) => {
    const ticket = randomBytes(24).toString('base64url');
    websocketTickets.set(hashCredential(ticket), {
      session: context.get('session'),
      expiresAt: Date.now() + 30_000,
    });
    pruneWebSocketTickets(websocketTickets);
    return context.json({ ticket, expiresInMs: 30_000 }, 201);
  });

  app.get('/v1/diagnostics', async (context) => {
    const result = await application.execute(
      { type: 'diagnostics' },
      { scope: context.get('session').scope },
    );
    return context.json(result);
  });

  app.post('/v1/commands', async (context) => {
    const body = await context.req.json<unknown>();
    const command = parseCommand(body);
    if (command === undefined) {
      return context.json(
        {
          error: {
            code: 'command-invalid',
            message: 'Command body is missing a recognized command type.',
          },
        },
        400,
      );
    }
    const expectedRevision = readExpectedRevision(body);
    const result = await application.execute(command, {
      expectedRevision,
      scope: context.get('session').scope,
    });
    if (result.changed) {
      broadcastInvalidation(sockets, result.revision);
    }
    if (
      command.type === 'project.root.add' ||
      command.type === 'project.root.remove'
    ) {
      await watcher?.refresh();
    }
    if (command.type === 'session.revoke') {
      closeRevokedSessionSockets(sockets, command.sessionId);
    }
    return context.json(result);
  });

  app.get(
    '/v1/events',
    upgradeWebSocket((context) => {
      const session = context.get('session');
      return {
        onOpen(_event, ws) {
          sockets.set(ws, session.id);
          ws.send(
            JSON.stringify({
              type: 'connected',
              scope: session.scope,
            }),
          );
        },
        onMessage(event, ws) {
          if (event.data === 'ping') {
            ws.send('pong');
          }
        },
        onClose(_event, ws) {
          sockets.delete(ws);
        },
        onError(_event, ws) {
          sockets.delete(ws);
        },
      };
    }),
  );

  return {
    app,
    websocket,
    watcher,
    async dispose() {
      await watcher?.dispose();
      for (const socket of sockets.keys()) {
        socket.close(1001, 'Runtime stopped');
      }
      sockets.clear();
    },
  };
}

function managerAssetResponse(
  request: Request,
  filePath: string,
  contentType: string,
  document = false,
): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  const headers = new Headers({
    'Cache-Control': document ? 'no-store' : 'no-cache',
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (document) {
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
  }
  return new Response(Bun.file(filePath), { headers });
}

export function serveRuntime(options: RuntimeServeOptions = {}): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? '127.0.0.1';
  if (isWildcardHost(hostname) && options.allowPublicWildcard !== true) {
    throw new Error(
      'Public wildcard binding is refused. Pass the explicit CLI override only after configuring a secure endpoint.',
    );
  }
  const runtime = createRuntimeApp({
    ...options,
    watchProjects: options.watchProjects ?? true,
  });
  const server = Bun.serve({
    hostname,
    port: options.port ?? 4765,
    fetch: runtime.app.fetch,
    websocket: runtime.websocket,
    maxRequestBodySize: 26 * 1024 * 1024,
    ...(options.tlsCertificate !== undefined &&
    options.tlsPrivateKey !== undefined
      ? {
          tls: {
            cert: options.tlsCertificate,
            key: options.tlsPrivateKey,
          },
        }
      : {}),
  });
  const stop = server.stop.bind(server);
  Object.defineProperty(server, 'stop', {
    configurable: true,
    value(closeActiveConnections?: boolean) {
      void runtime.dispose();
      stop(closeActiveConnections);
    },
  });
  return server;
}

async function readReadiness(
  home: string,
  watcherReady: (() => boolean) | undefined,
): Promise<RuntimeReadiness> {
  let database = false;
  let canonicalDirectory = false;
  let keychain = false;
  try {
    await access(home);
    canonicalDirectory = true;
  } catch {
    canonicalDirectory = false;
  }
  try {
    const state = await LocalState.open(home);
    state.close();
    database = true;
  } catch {
    database = false;
  }
  try {
    await systemSecretStore().status('reglet-readiness-probe');
    keychain = true;
  } catch {
    keychain = false;
  }
  const watcher = watcherReady?.() ?? true;
  return {
    ready: database && canonicalDirectory && watcher && keychain,
    database,
    canonicalDirectory,
    watcher,
    keychain,
  };
}

function prunePairingFailures(failures: number[]): void {
  const cutoff = Date.now() - 60_000;
  while ((failures[0] ?? Number.POSITIVE_INFINITY) < cutoff) {
    failures.shift();
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith('Bearer ')) {
    return undefined;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      const value = valueParts.join('=');
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function sessionCookie(token: string, secure: boolean): string {
  return [
    `reglet_session=${token}`,
    'HttpOnly',
    'Path=/v1',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ]
    .filter((part) => part.length > 0)
    .join('; ');
}

function consumeWebSocketTicket(
  tickets: Map<
    string,
    { session: RemoteSessionRecord; expiresAt: number }
  >,
  ticket: string | undefined,
): RemoteSessionRecord | undefined {
  if (ticket === undefined) {
    return undefined;
  }
  const key = hashCredential(ticket);
  const record = tickets.get(key);
  tickets.delete(key);
  return record !== undefined && record.expiresAt > Date.now()
    ? record.session
    : undefined;
}

function pruneWebSocketTickets(
  tickets: Map<
    string,
    { session: RemoteSessionRecord; expiresAt: number }
  >,
): void {
  const now = Date.now();
  for (const [key, record] of tickets) {
    if (record.expiresAt <= now) {
      tickets.delete(key);
    }
  }
}

function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseCommand(value: unknown): ApplicationCommand | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    !knownCommandTypes.has(value.type) ||
    !validCommandShape(value as Record<string, unknown>)
  ) {
    return undefined;
  }
  return value as ApplicationCommand;
}

function validCommandShape(command: Record<string, unknown>): boolean {
  switch (command.type) {
    case 'initialize':
    case 'manager.snapshot':
    case 'providers.status':
    case 'project.root.list':
    case 'remote.disable':
    case 'remote.status':
    case 'sync.disable':
    case 'sync.now':
    case 'sync.status':
    case 'session.list':
    case 'diagnostics':
      return true;
    case 'library.list':
      return (
        optionalEnum(command.kind, ['instruction', 'skill', 'mcp']) &&
        optionalEnum(command.lifecycle, ['active', 'archived'])
      );
    case 'library.show':
    case 'library.duplicate':
    case 'library.archive':
    case 'library.restore':
    case 'library.inspect-skill':
    case 'history.list':
      return isNonemptyString(command.artifact);
    case 'library.create':
      return (
        isEnum(command.kind, ['instruction', 'skill', 'mcp']) &&
        isNonemptyString(command.slug) &&
        isNonemptyString(command.title) &&
        typeof command.content === 'string' &&
        optionalProviderArray(command.targets)
      );
    case 'library.rename':
      return (
        isNonemptyString(command.artifact) &&
        isNonemptyString(command.slug)
      );
    case 'library.delete':
      return (
        isNonemptyString(command.artifact) &&
        typeof command.confirmed === 'boolean'
      );
    case 'library.targets':
      return (
        isNonemptyString(command.artifact) &&
        isProviderArray(command.targets)
      );
    case 'library.save':
      return (
        isNonemptyString(command.artifact) &&
        typeof command.content === 'string'
      );
    case 'library.trust-skill':
      return (
        isNonemptyString(command.artifact) &&
        typeof command.confirmed === 'boolean'
      );
    case 'providers.apply':
      return (
        optionalProviderArray(command.providers) &&
        optionalEnumArray(command.contents, ['rules', 'skills', 'mcp']) &&
        optionalBoolean(command.dryRun) &&
        optionalBoolean(command.allowOverwriteDrift)
      );
    case 'providers.restore':
      return (
        optionalProvider(command.provider) &&
        typeof command.confirmed === 'boolean'
      );
    case 'providers.purge-backups':
      return (
        isProvider(command.provider) &&
        typeof command.confirmed === 'boolean'
      );
    case 'providers.preview':
      return (
        isNonemptyString(command.artifact) && isProvider(command.provider)
      );
    case 'providers.enrollment':
      return (
        isProvider(command.provider) &&
        optionalEnum(command.content, ['rules', 'skills', 'mcp']) &&
        typeof command.enrolled === 'boolean'
      );
    case 'project.root.add':
      return (
        isNonemptyString(command.path) &&
        optionalString(command.label)
      );
    case 'project.root.remove':
      return (
        isNonemptyString(command.rootId) &&
        typeof command.confirmed === 'boolean'
      );
    case 'project.scan':
      return (
        optionalString(command.rootId) &&
        optionalBoolean(command.reappearChangedIgnored)
      );
    case 'project.discoveries':
      return optionalString(command.rootId);
    case 'project.ignore':
      return isNonemptyString(command.discoveryId);
    case 'project.promotion-preview':
      return (
        isNonemptyString(command.discoveryId) &&
        optionalEnum(command.mode, [
          'global-instruction',
          'convert-to-skill',
          'disabled-library-draft',
        ])
      );
    case 'project.promote':
      return (
        isNonemptyString(command.discoveryId) &&
        optionalEnum(command.mode, [
          'global-instruction',
          'convert-to-skill',
          'disabled-library-draft',
        ]) &&
        optionalProviderArray(command.targets) &&
        optionalBoolean(command.confirmExecutables) &&
        optionalNonemptyString(command.destinationArtifact) &&
        optionalStringArray(command.selectedHunks) &&
        optionalStringArray(command.selectedFiles) &&
        optionalNonemptyString(command.serverName)
      );
    case 'history.undo':
      return (
        isNonemptyString(command.artifact) &&
        optionalString(command.revision) &&
        typeof command.confirmed === 'boolean'
      );
    case 'activity.list':
      return optionalPositiveInteger(command.limit);
    case 'search':
      return (
        typeof command.query === 'string' &&
        optionalPositiveInteger(command.limit)
      );
    case 'secret.set':
      return (
        isNonemptyString(command.id) && typeof command.value === 'string'
      );
    case 'secret.delete':
    case 'secret.status':
      return isNonemptyString(command.id);
    case 'remote.enable':
      return isNonemptyString(command.endpoint);
    case 'sync.configure':
      return isNonemptyString(command.serverUrl);
    case 'sync.resolve':
      return (
        isNonemptyString(command.path) &&
        isEnum(command.choice, ['ours', 'theirs'])
      );
    case 'pair.start':
      return isEnum(command.scope, ['read', 'write', 'admin']);
    case 'session.revoke':
      return isNonemptyString(command.sessionId);
    case 'external.open':
      return (
        validExternalTarget(command.target) &&
        optionalBoolean(command.reveal)
      );
    default:
      return false;
  }
}

function validExternalTarget(value: unknown): boolean {
  if (!isRecord(value) || !isNonemptyString(value.kind)) return false;
  if (value.kind === 'canonical') {
    return isNonemptyString(value.artifact);
  }
  if (value.kind === 'project') {
    return isNonemptyString(value.discoveryId);
  }
  return (
    value.kind === 'provider' &&
    isProvider(value.provider) &&
    optionalNonemptyString(value.artifact) &&
    optionalEnum(value.content, ['rules', 'skills', 'mcp']) &&
    (isNonemptyString(value.artifact) ||
      isEnum(value.content, ['rules', 'skills', 'mcp']))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalNonemptyString(value: unknown): boolean {
  return value === undefined || isNonemptyString(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalPositiveInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0)
  );
}

function isEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): boolean {
  return value === undefined || isEnum(value, values);
}

function optionalEnumArray<T extends string>(
  value: unknown,
  values: readonly T[],
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isEnum(item, values)))
  );
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function isProvider(value: unknown): value is ProviderId {
  return isEnum(value, [
    'claude',
    'codex',
    'cursor',
    'gemini',
    'windsurf',
    'opencode',
  ]);
}

function optionalProvider(value: unknown): boolean {
  return value === undefined || isProvider(value);
}

function isProviderArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isProvider);
}

function optionalProviderArray(value: unknown): boolean {
  return value === undefined || isProviderArray(value);
}

function readExpectedRevision(value: unknown): number | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('expectedRevision' in value) ||
    value.expectedRevision === undefined
  ) {
    return undefined;
  }
  return typeof value.expectedRevision === 'number' &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0
    ? value.expectedRevision
    : undefined;
}

function parseProvider(
  value: string,
):
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'windsurf'
  | 'opencode'
  | undefined {
  return value === 'claude' ||
    value === 'codex' ||
    value === 'cursor' ||
    value === 'gemini' ||
    value === 'windsurf' ||
    value === 'opencode'
    ? value
    : undefined;
}

function broadcastInvalidation(
  sockets: Map<WSContext, string>,
  revision: number,
): void {
  const payload = JSON.stringify({ type: 'invalidated', revision });
  for (const socket of sockets.keys()) {
    try {
      socket.send(payload);
    } catch {
      sockets.delete(socket);
    }
  }
}

function closeRevokedSessionSockets(
  sockets: Map<WSContext, string>,
  sessionId: string,
): void {
  for (const [socket, socketSessionId] of sockets) {
    if (socketSessionId !== sessionId) {
      continue;
    }
    sockets.delete(socket);
    try {
      socket.close(1008, 'Session revoked');
    } catch {
      // The transport already closed; authorization is still revoked in SQLite.
    }
  }
}

function isWildcardHost(hostname: string): boolean {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
}

function redactMessage(value: string): string {
  return redactLogValue(value);
}

const knownCommandTypes: ReadonlySet<string> = new Set([
  'initialize',
  'manager.snapshot',
  'library.list',
  'library.show',
  'library.create',
  'library.duplicate',
  'library.rename',
  'library.archive',
  'library.restore',
  'library.delete',
  'library.targets',
  'library.save',
  'library.inspect-skill',
  'library.trust-skill',
  'providers.apply',
  'providers.restore',
  'providers.purge-backups',
  'providers.status',
  'providers.preview',
  'providers.enrollment',
  'project.root.add',
  'project.root.remove',
  'project.root.list',
  'project.scan',
  'project.discoveries',
  'project.ignore',
  'project.promotion-preview',
  'project.promote',
  'history.list',
  'history.undo',
  'activity.list',
  'search',
  'secret.set',
  'secret.delete',
  'secret.status',
  'remote.enable',
  'remote.disable',
  'remote.status',
  'sync.configure',
  'sync.disable',
  'sync.now',
  'sync.status',
  'sync.resolve',
  'pair.start',
  'session.list',
  'session.revoke',
  'external.open',
  'diagnostics',
] satisfies ApplicationCommand['type'][]);
