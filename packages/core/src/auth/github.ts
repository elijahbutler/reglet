import { saveCredential } from './credentials.js';
import type {
  GitHubDeviceCodeResponse,
  GitHubTokenResponse,
  GitHubTokenSuccessResponse,
  GitHubUserInfo,
  SyncedCredential,
} from './types.js';
import type { SecretStore } from '../security/secrets.js';
import { regletHome } from '../paths.js';

const GITHUB_DEVICE_CODE_URL = () => process.env.REGLET_GITHUB_DEVICE_CODE_URL ?? 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = () => process.env.REGLET_GITHUB_ACCESS_TOKEN_URL ?? 'https://github.com/login/oauth/access_token';
const GITHUB_USER_API_URL = () => process.env.REGLET_GITHUB_USER_API_URL ?? 'https://api.github.com/user';

export interface GitHubDeviceCodeOptions {
  clientId?: string;
  scopes?: string[];
  fetchImpl?: typeof fetch;
}

export interface GitHubPollTokenOptions {
  clientId: string;
  interval?: number;
  expiresIn?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface GitHubValidateTokenOptions {
  fetchImpl?: typeof fetch;
}

export interface GitHubLoginOptions {
  home?: string;
  secretStore?: SecretStore;
  fetchImpl?: typeof fetch;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveGitHubClientId(explicitId?: string): string {
  const clientId = explicitId ?? process.env.REGLET_GITHUB_CLIENT_ID;
  if (clientId === undefined || clientId.trim().length === 0) {
    throw new Error(
      'GitHub OAuth requires a Client ID. Set REGLET_GITHUB_CLIENT_ID or pass --client-id, or use a personal access token via --token.',
    );
  }
  return clientId.trim();
}

export async function requestGitHubDeviceCode(
  options: GitHubDeviceCodeOptions = {},
): Promise<GitHubDeviceCodeResponse> {
  const clientId = resolveGitHubClientId(options.clientId);
  const scopes = options.scopes ?? ['repo', 'read:user'];
  const fetchFn = options.fetchImpl ?? fetch;

  const res = await fetchFn(GITHUB_DEVICE_CODE_URL(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Reglet',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: scopes.join(' '),
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to request GitHub device code (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as Partial<GitHubDeviceCodeResponse>;
  if (
    typeof data.device_code !== 'string' ||
    typeof data.user_code !== 'string' ||
    typeof data.verification_uri !== 'string'
  ) {
    throw new Error('Invalid response from GitHub device code endpoint.');
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : 900,
    interval: typeof data.interval === 'number' ? data.interval : 5,
  };
}

export async function pollGitHubDeviceToken(
  deviceCode: string,
  options: GitHubPollTokenOptions,
): Promise<GitHubTokenSuccessResponse> {
  const fetchFn = options.fetchImpl ?? fetch;
  const sleepFn = options.sleep ?? defaultSleep;
  let intervalSeconds = Math.max(1, options.interval ?? 5);
  const expiresAt = Date.now() + (options.expiresIn ?? 900) * 1000;

  while (Date.now() < expiresAt) {
    if (options.signal?.aborted) {
      throw new Error('GitHub device authorization was cancelled.');
    }

    const res = await fetchFn(GITHUB_ACCESS_TOKEN_URL(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Reglet',
      },
      body: JSON.stringify({
        client_id: options.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub token poll failed with status ${res.status}`);
    }

    const data = (await res.json()) as GitHubTokenResponse;

    if ('access_token' in data && typeof data.access_token === 'string') {
      return data;
    }

    if ('error' in data) {
      switch (data.error) {
        case 'authorization_pending':
          break;
        case 'slow_down':
          intervalSeconds += 5;
          break;
        case 'expired_token':
          throw new Error('GitHub device authorization expired. Please initiate login again.');
        case 'access_denied':
          throw new Error('GitHub authorization was denied by the user.');
        default:
          throw new Error(
            `GitHub authorization failed: ${data.error}${data.error_description ? ` (${data.error_description})` : ''}`,
          );
      }
    }

    await sleepFn(intervalSeconds * 1000);
  }

  throw new Error('GitHub device authorization timed out.');
}

export async function validateGitHubToken(
  token: string,
  options: GitHubValidateTokenOptions = {},
): Promise<GitHubUserInfo> {
  const fetchFn = options.fetchImpl ?? fetch;
  const res = await fetchFn(GITHUB_USER_API_URL(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Reglet',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub token validation failed (${res.status}): ensure the token is active.`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const rawScopes = res.headers.get('x-oauth-scopes') ?? '';
  const scopes = rawScopes
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    login: String(data.login ?? ''),
    id: Number(data.id ?? 0),
    name: typeof data.name === 'string' ? data.name : null,
    email: typeof data.email === 'string' ? data.email : null,
    scopes,
  };
}

export async function loginWithGitHubToken(
  token: string,
  options: GitHubLoginOptions = {},
): Promise<SyncedCredential> {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error('Token must not be empty.');
  }

  const user = await validateGitHubToken(trimmed, { fetchImpl: options.fetchImpl });
  const home = options.home ?? regletHome();

  const credential: SyncedCredential = {
    version: 1,
    provider: 'github',
    tokenType: 'bearer',
    token: trimmed,
    scopes: user.scopes,
    user: {
      id: user.id,
      login: user.login,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
    },
    updatedAt: new Date().toISOString(),
  };

  await saveCredential(credential, home, options.secretStore);
  return credential;
}
