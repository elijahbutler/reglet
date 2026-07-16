import { regletHome } from '../paths.js';
import { configureTokenLogin } from './engine.js';
import { readBoundedSyncJson, requireSecureSyncServerUrl } from './client.js';
import type { SyncState } from './state.js';

export type AccountAuthMode = 'register' | 'login';

export interface AccountLoginOptions {
  serverUrl: string;
  email: string;
  password: string;
  deviceName: string;
  mode: AccountAuthMode;
  home?: string;
  fetchImpl?: typeof fetch;
}

/** Registers or logs into an account and returns a short-lived session token. */
export async function accountSession(
  serverUrl: string,
  email: string,
  password: string,
  mode: AccountAuthMode,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = await postJson(fetchImpl, serverUrl, `/v1/auth/${mode}`, { email, password });
  if (typeof body.sessionToken !== 'string') {
    throw new Error(`Server did not return a session token for ${mode}`);
  }
  return body.sessionToken;
}

/** Starts pairing for the account and returns the code to enter on another device. */
export async function startPairing(
  serverUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = await postJson(fetchImpl, serverUrl, '/v1/pair/start', {}, sessionToken);
  if (typeof body.code !== 'string') {
    throw new Error('Server did not return a pair code');
  }
  return body.code;
}

/** Claims a pair code, stores the resulting device token, and returns sync state. */
export async function claimPairing(
  serverUrl: string,
  code: string,
  deviceName: string,
  home = regletHome(),
  fetchImpl: typeof fetch = fetch,
): Promise<SyncState> {
  const body = await postJson(fetchImpl, serverUrl, '/v1/pair/claim', { code, deviceName });
  if (typeof body.deviceToken !== 'string') {
    throw new Error('Server did not return a device token');
  }
  return configureTokenLogin(serverUrl, body.deviceToken, deviceName, home);
}

/** Full account flow: authenticate, pair this device, and store its token. */
export async function loginWithAccount(options: AccountLoginOptions): Promise<SyncState> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const home = options.home ?? regletHome();
  const sessionToken = await accountSession(
    options.serverUrl,
    options.email,
    options.password,
    options.mode,
    fetchImpl,
  );
  const code = await startPairing(options.serverUrl, sessionToken, fetchImpl);
  return claimPairing(options.serverUrl, code, options.deviceName, home, fetchImpl);
}

async function postJson(
  fetchImpl: typeof fetch,
  serverUrl: string,
  route: string,
  payload: Record<string, unknown>,
  sessionToken?: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(new URL(route, ensureTrailingSlash(requireSecureSyncServerUrl(serverUrl))), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionToken === undefined ? {} : { authorization: `Bearer ${sessionToken}` }),
    },
    body: JSON.stringify(payload),
  });

  const value = await readBoundedSyncJson(response).catch(() => ({}));
  const body = isRecord(value) ? value : {};
  if (!response.ok) {
    const error = typeof body.error === 'object' && body.error !== null ? body.error as Record<string, unknown> : undefined;
    const message = typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`;
    throw new Error(`${route} failed: ${message}`);
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureTrailingSlash(serverUrl: string): string {
  return serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
}
