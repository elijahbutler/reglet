import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { LocalState, regletHome, systemSecretStore, type RemoteSessionRecord } from '@reglet/core';
import {
  ApplicationPermissionError,
  RegletApplication,
  RevisionConflictError,
  UnsupportedApplicationOperationError,
  type ApplicationCommand,
} from '@reglet/manager-application';
import {
  failureResponse,
  managerProtocolVersion,
  managerRpcRequestValidator,
  managerRpcResponseValidator,
  successResponse,
  type JsonValue,
  type ManagerProtocolErrorCode,
  type ManagerProtocolOperation,
  type ManagerRpcRequest,
} from '@reglet/manager-protocol';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import { recordRuntimeLog } from './logging.js';
import { ProjectRootWatcher } from './project-watcher.js';

export * from './logging.js';
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

export interface ManagerRuntimeOptions {
  home?: string;
  managerAssetsDir?: string;
  watchProjects?: boolean;
  watcherReady?: () => boolean;
  allowedOrigins?: string[];
}

export interface ManagerRuntimeServeOptions extends ManagerRuntimeOptions {
  hostname?: string;
  port?: number;
  allowPublicWildcard?: boolean;
  allowRemote?: boolean;
  allowInsecureLanHttp?: boolean;
  tlsCertificate?: string;
  tlsPrivateKey?: string;
}

export interface ManagerRuntimeApp {
  app: Hono<{ Variables: RuntimeVariables }>;
  websocket: ReturnType<typeof createBunWebSocket>['websocket'];
  watcher?: ProjectRootWatcher;
  dispose(): Promise<void>;
}

export interface ManagerRuntimeStartup {
  version: 1;
  listening: true;
  url: string;
  managerUrl: string;
  pairingExpiresAt: string;
  remote: boolean;
  protocolVersion: 2;
  warnings?: string[];
}

export interface RunningManagerRuntime {
  server: ReturnType<typeof Bun.serve>;
  startup: ManagerRuntimeStartup;
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export function createManagerRuntime(options: ManagerRuntimeOptions = {}): ManagerRuntimeApp {
  const home = options.home ?? regletHome();
  const application = new RegletApplication({ home });
  const managerAssetsDir = options.managerAssetsDir ?? path.resolve(import.meta.dir, '..', '..', '..', 'apps', 'manager-web', 'dist');
  const sockets = new Map<WSContext, string>();
  const tickets = new Map<string, { session: RemoteSessionRecord; expiresAt: number }>();
  const pairingFailures: number[] = [];
  const allowedOrigins = new Set([
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
    ...(options.allowedOrigins ?? []),
  ]);
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono<{ Variables: RuntimeVariables }>();
  const watcher = options.watchProjects === true && options.watcherReady === undefined
    ? new ProjectRootWatcher({
        home,
        application,
        onInvalidation: (revision) => broadcastInvalidation(sockets, revision, 'filesystem'),
      })
    : undefined;
  void watcher?.start();

  app.onError((error, context) => {
    const mapped = mapRuntimeError(error);
    recordRuntimeLog(home, 'request-error', {
      status: mapped.status,
      code: mapped.code,
      operation: context.req.path,
    });
    const response = failureResponse(
      operationFromPath(context.req.path),
      mapped.code,
      mapped.publicMessage,
      mapped.recoverable,
    );
    return mapped.status === 400
      ? context.json(response, 400)
      : mapped.status === 401
        ? context.json(response, 401)
        : mapped.status === 403
          ? context.json(response, 403)
          : mapped.status === 409
            ? context.json(response, 409)
            : mapped.status === 501
              ? context.json(response, 501)
              : context.json(response, 500);
  });

  app.use('*', async (context, next) => {
    const origin = context.req.header('Origin');
    const requestOrigin = new URL(context.req.url).origin;
    if (origin !== undefined && origin !== requestOrigin && !allowedOrigins.has(origin)) {
      return context.json(failureResponse('unknown', 'PERMISSION_DENIED', 'Cross-origin manager requests are refused.', false), 403);
    }
    if (origin !== undefined && origin !== requestOrigin) {
      context.header('Access-Control-Allow-Origin', origin);
      context.header('Access-Control-Allow-Credentials', 'true');
      context.header('Vary', 'Origin');
      if (context.req.method === 'OPTIONS') {
        context.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Reglet-Revision');
        context.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        return context.body(null, 204);
      }
    }
    await next();
  });

  app.get('/', (context) => context.json({
    product: 'Reglet',
    localFirst: true,
    protocolVersion: managerProtocolVersion,
    manager: '/manager/',
    health: '/healthz',
    readiness: '/readyz',
  }));
  app.get('/healthz', (context) => context.json({ status: 'ok' }));
  app.get('/readyz', async (context) => {
    const readiness = await readReadiness(home, options.watcherReady ?? (() => watcher?.isReady() ?? true));
    return readiness.ready ? context.json(readiness, 200) : context.json(readiness, 503);
  });
  app.get('/manager', (context) => context.redirect('/manager/'));
  app.get('/manager/*', (context) => managerAssetResponse(context.req.path, managerAssetsDir));

  app.post('/v2/pair/claim', async (context) => {
    prunePairingFailures(pairingFailures);
    if (pairingFailures.length >= 12) {
      context.header('Retry-After', '60');
      return context.json(failureResponse('session.pair', 'RATE_LIMITED', 'Too many pairing attempts. Try again shortly.', true), 429);
    }
    const body = await context.req.json<unknown>();
    if (!isRecord(body) || typeof body.code !== 'string') {
      return context.json(failureResponse('session.pair', 'INVALID_INPUT', 'A pairing code is required.', true), 400);
    }
    const state = await LocalState.open(home);
    try {
      const claimed = state.claimPairingCredential(body.code.trim().toUpperCase());
      if (claimed === undefined) {
        pairingFailures.push(Date.now());
        return context.json(failureResponse('session.pair', 'AUTHENTICATION_REQUIRED', 'Pairing credential is invalid, expired, or already used.', true), 401);
      }
      context.header('Set-Cookie', sessionCookie(claimed.token, new URL(context.req.url).protocol === 'https:'));
      return context.json({ session: claimed.session, token: claimed.token }, 201);
    } finally {
      state.close();
    }
  });

  app.use('/v2/*', async (context, next) => {
    if (context.req.path === '/v2/pair/claim') {
      await next();
      return;
    }
    if (context.req.path === '/v2/events') {
      const session = consumeTicket(tickets, context.req.query('ticket'));
      if (session === undefined) {
        return context.json(failureResponse('unknown', 'AUTHENTICATION_REQUIRED', 'WebSocket ticket is invalid or expired.', true), 401);
      }
      context.set('session', session);
      await next();
      return;
    }
    const token = bearerToken(context.req.header('Authorization')) ?? cookieValue(context.req.header('Cookie'), 'reglet_session');
    if (token === undefined) {
      return context.json(failureResponse('unknown', 'AUTHENTICATION_REQUIRED', 'A manager session is required.', true), 401);
    }
    const state = await LocalState.open(home);
    try {
      const session = state.authorizeSession(token);
      if (session === undefined) {
        return context.json(failureResponse('unknown', 'AUTHENTICATION_REQUIRED', 'Manager session is invalid or revoked.', true), 401);
      }
      context.set('session', session);
    } finally {
      state.close();
    }
    await next();
  });

  app.get('/v2/session', (context) => context.json({ session: context.get('session') }));

  app.post('/v2/events/ticket', (context) => {
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(hashCredential(ticket), {
      session: context.get('session'),
      expiresAt: Date.now() + 30_000,
    });
    pruneTickets(tickets);
    return context.json({ ticket, expiresInMs: 30_000 }, 201);
  });

  app.post('/v2/commands', async (context) => {
    const request = await context.req.json<unknown>();
    if (!managerRpcRequestValidator.validate(request)) {
      return context.json(failureResponse('unknown', 'MALFORMED_REQUEST', 'The command envelope or input is invalid.', true), 400);
    }
    let result;
    try {
      result = await application.execute(commandFromRequest(request), {
        expectedRevision: expectedRevision(context.req.header('X-Reglet-Revision')),
        scope: context.get('session').scope,
      });
    } catch (error) {
      const mapped = mapRuntimeError(error instanceof Error ? error : new Error(String(error)));
      recordRuntimeLog(home, 'command-error', {
        status: mapped.status,
        code: mapped.code,
        operation: request.operation,
      });
      const response = failureResponse(
        request.operation,
        mapped.code,
        mapped.publicMessage,
        mapped.recoverable,
        request.protocolVersion,
      );
      return mapped.status === 400
        ? context.json(response, 400)
        : mapped.status === 401
          ? context.json(response, 401)
          : mapped.status === 403
            ? context.json(response, 403)
            : mapped.status === 409
              ? context.json(response, 409)
              : mapped.status === 501
                ? context.json(response, 501)
                : context.json(response, 500);
    }
    const response = successResponse(request.operation, jsonValue({
      revision: result.revision,
      changed: result.changed,
      data: result.data,
    }), request.protocolVersion);
    if (!managerRpcResponseValidator.validate(response)) throw new Error('Runtime produced an invalid protocol response.');
    if (result.changed) {
      broadcastInvalidation(sockets, result.revision, 'command');
      if (request.operation === 'project.root.add' || request.operation === 'project.root.remove') await watcher?.refresh();
      if (request.operation === 'session.revoke') closeRevokedSessionSockets(sockets, request.input?.sessionId);
    }
    return context.json(response);
  });

  app.get('/v2/events', upgradeWebSocket((context) => {
    const session = context.get('session');
    return {
      onOpen(_event, ws) {
        sockets.set(ws, session.id);
        ws.send(JSON.stringify({ type: 'connected', scope: session.scope }));
      },
      onMessage(event, ws) {
        if (event.data === 'ping') ws.send('pong');
      },
      onClose(_event, ws) { sockets.delete(ws); },
      onError(_event, ws) { sockets.delete(ws); },
    };
  }));

  return {
    app,
    websocket,
    watcher,
    async dispose() {
      await watcher?.dispose();
      for (const socket of sockets.keys()) socket.close(1001, 'Runtime stopped');
      sockets.clear();
    },
  };
}

export async function serveManagerRuntime(options: ManagerRuntimeServeOptions = {}): Promise<RunningManagerRuntime> {
  const home = options.home ?? regletHome();
  const hostname = options.hostname ?? '127.0.0.1';
  validateManagerRuntimeBinding(hostname, options);
  await mkdir(home, { recursive: true });
  const runtime = createManagerRuntime({ ...options, home, watchProjects: options.watchProjects ?? true });
  const tls = options.tlsCertificate !== undefined && options.tlsPrivateKey !== undefined
    ? { cert: options.tlsCertificate, key: options.tlsPrivateKey }
    : undefined;
  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    fetch: runtime.app.fetch,
    websocket: runtime.websocket,
    maxRequestBodySize: 26 * 1024 * 1024,
    ...(tls === undefined ? {} : { tls }),
  });
  const protocol = tls === undefined ? 'http' : 'https';
  const displayHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  const url = `${protocol}://${displayHost}:${server.port}`;
  const state = await LocalState.open(home);
  const pairing = state.createPairingCredential('admin');
  state.close();
  const startup: ManagerRuntimeStartup = {
    version: 1,
    listening: true,
    url,
    managerUrl: `${url}/manager/#pair=${encodeURIComponent(pairing.code)}`,
    pairingExpiresAt: pairing.expiresAt,
    remote: !isLoopbackHost(hostname),
    protocolVersion: 2,
    ...(!isLoopbackHost(hostname) && tls === undefined
      ? { warnings: ['Raw LAN HTTP is enabled. Session credentials and Manager traffic are not transport encrypted.'] }
      : {}),
  };
  if (startup.warnings !== undefined) {
    recordRuntimeLog(home, 'insecure-lan-http', { hostname, warning: startup.warnings.join(' ') });
  }
  return {
    server,
    startup,
    async stop(closeActiveConnections = true) {
      await runtime.dispose();
      server.stop(closeActiveConnections);
    },
  };
}

function commandFromRequest(request: ManagerRpcRequest): ApplicationCommand {
  return {
    operation: request.operation,
    input: request.input ?? {},
  } as ApplicationCommand;
}

async function readReadiness(home: string, watcherReady: () => boolean): Promise<RuntimeReadiness> {
  let canonicalDirectory = false;
  let database = false;
  let keychain = false;
  try { await access(home); canonicalDirectory = true; } catch { canonicalDirectory = false; }
  try {
    const state = await LocalState.open(home);
    state.close();
    database = true;
  } catch { database = false; }
  try { await systemSecretStore().status('reglet-readiness-probe'); keychain = true; } catch { keychain = false; }
  const watcher = watcherReady();
  return { ready: canonicalDirectory && database && watcher, database, canonicalDirectory, watcher, keychain };
}

function managerAssetResponse(requestPath: string, assetsDir: string): Response {
  const relativePath = requestPath === '/manager/' ? 'index.html' : requestPath.slice('/manager/'.length);
  const safePath = relativePath.length === 0 || relativePath.includes('..') ? 'index.html' : relativePath;
  const filePath = path.join(assetsDir, safePath);
  const file = Bun.file(filePath);
  const headers = new Headers({
    'Cache-Control': safePath === 'index.html' ? 'no-store' : 'no-cache',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  return new Response(file, { status: file.size === 0 ? 404 : 200, headers });
}

function mapRuntimeError(error: Error): {
  status: 400 | 401 | 403 | 409 | 500 | 501;
  code: ManagerProtocolErrorCode;
  publicMessage: string;
  recoverable: boolean;
} {
  if (error instanceof ApplicationPermissionError) return { status: 403, code: 'PERMISSION_DENIED', publicMessage: error.message, recoverable: false };
  if (error instanceof RevisionConflictError) return { status: 409, code: 'REVISION_CONFLICT', publicMessage: error.message, recoverable: true };
  if (error instanceof UnsupportedApplicationOperationError) return { status: 501, code: 'OPERATION_FAILED', publicMessage: error.message, recoverable: true };
  if (error instanceof SyntaxError) return { status: 400, code: 'INVALID_INPUT', publicMessage: 'Request JSON is invalid.', recoverable: true };
  return { status: 500, code: 'OPERATION_FAILED', publicMessage: 'The operation failed. Inspect local diagnostics for metadata.', recoverable: true };
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}

function expectedRevision(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const revision = Number.parseInt(value, 10);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length === 0 ? undefined : token;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || undefined;
  }
  return undefined;
}

function sessionCookie(token: string, secure: boolean): string {
  return [`reglet_session=${token}`, 'HttpOnly', 'Path=/v2', 'SameSite=Strict', secure ? 'Secure' : ''].filter(Boolean).join('; ');
}

function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function consumeTicket(
  tickets: Map<string, { session: RemoteSessionRecord; expiresAt: number }>,
  ticket: string | undefined,
): RemoteSessionRecord | undefined {
  if (ticket === undefined) return undefined;
  const key = hashCredential(ticket);
  const record = tickets.get(key);
  tickets.delete(key);
  return record !== undefined && record.expiresAt > Date.now() ? record.session : undefined;
}

function pruneTickets(tickets: Map<string, { session: RemoteSessionRecord; expiresAt: number }>): void {
  const now = Date.now();
  for (const [key, record] of tickets) if (record.expiresAt <= now) tickets.delete(key);
}

function prunePairingFailures(failures: number[]): void {
  const cutoff = Date.now() - 60_000;
  while ((failures[0] ?? Number.POSITIVE_INFINITY) < cutoff) failures.shift();
}

function broadcastInvalidation(sockets: Map<WSContext, string>, revision: number, reason: 'command' | 'filesystem'): void {
  const payload = JSON.stringify({ type: 'invalidated', revision, reason });
  for (const socket of sockets.keys()) {
    try { socket.send(payload); } catch { sockets.delete(socket); }
  }
}

function closeRevokedSessionSockets(sockets: Map<WSContext, string>, sessionId: unknown): void {
  if (typeof sessionId !== 'string') return;
  for (const [socket, currentSessionId] of sockets) {
    if (currentSessionId !== sessionId) continue;
    sockets.delete(socket);
    socket.close(1008, 'Session revoked');
  }
}

function operationFromPath(pathname: string): ManagerProtocolOperation | 'unknown' {
  return pathname === '/v2/commands' ? 'snapshot' : 'unknown';
}

export function validateManagerRuntimeBinding(hostname: string, options: ManagerRuntimeServeOptions): void {
  if (isWildcardHost(hostname) && options.allowPublicWildcard !== true) {
    throw new Error('Public wildcard binding is refused without the explicit CLI override.');
  }
  if (!isLoopbackHost(hostname) && options.allowRemote !== true) {
    throw new Error('Remote manager access is disabled. Enable it explicitly before binding outside loopback.');
  }
  const hasCertificate = options.tlsCertificate !== undefined && options.tlsPrivateKey !== undefined;
  if (!isLoopbackHost(hostname) && !hasCertificate && options.allowInsecureLanHttp !== true) {
    throw new Error('Remote manager access requires HTTPS. Raw LAN HTTP is available only through the advanced override.');
  }
}

function isWildcardHost(hostname: string): boolean {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'localhost';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
