import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  deleteCredential,
  isAllowedEncryptedSyncPath,
  listCredentials,
  loginWithGitHubToken,
  MemorySecretStore,
  pollGitHubDeviceToken,
  readCredential,
  requestGitHubDeviceCode,
  resolveEffectiveMcpServersEnv,
  saveCredential,
  upsertMcpServer,
  validateGitHubToken,
  type SyncedCredential,
} from '../src/index.js';
import { initMasterDir } from '../src/master.js';

describe('auth and synced credentials', () => {
  let home = '';

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-auth-test-'));
  });

  afterEach(async () => {
    if (home !== '') {
      await rm(home, { recursive: true, force: true });
      home = '';
    }
  });

  test('saves, reads, lists, and deletes credentials with OS keyring synchronization', async () => {
    const secretStore = new MemorySecretStore();
    const cred: SyncedCredential = {
      version: 1,
      provider: 'github',
      tokenType: 'bearer',
      token: 'ghp_test_token_12345',
      scopes: ['repo', 'read:user'],
      user: { id: 1234, login: 'octocat' },
      updatedAt: new Date().toISOString(),
    };

    await saveCredential(cred, home, secretStore);

    const read = await readCredential('github', home);
    expect(read).not.toBeNull();
    expect(read?.provider).toBe('github');
    expect(read?.token).toBe('ghp_test_token_12345');
    expect(read?.user?.login).toBe('octocat');

    // OS keyring should have been synchronized
    expect(await secretStore.resolve('oauth-github')).toBe('ghp_test_token_12345');
    expect(await secretStore.resolve('github-token')).toBe('ghp_test_token_12345');

    const all = await listCredentials(home);
    expect(all).toHaveLength(1);
    expect(all[0]?.provider).toBe('github');

    const deleted = await deleteCredential('github', home, secretStore);
    expect(deleted).toBe(true);
    expect(await readCredential('github', home)).toBeNull();
    expect(await secretStore.resolve('oauth-github')).toBeUndefined();
    expect(await secretStore.resolve('github-token')).toBeUndefined();
  });

  test('allows credential paths in encrypted sync v2 path contract', () => {
    expect(isAllowedEncryptedSyncPath('credentials/github.json')).toBe(true);
    expect(isAllowedEncryptedSyncPath('credentials/linear.json')).toBe(true);
    expect(isAllowedEncryptedSyncPath('credentials/sub/nested.json')).toBe(false);
    expect(isAllowedEncryptedSyncPath('credentials/invalid-chars!.json')).toBe(false);
    expect(isAllowedEncryptedSyncPath('credentials/.state')).toBe(false);
  });

  test('validates GitHub token via mock fetch', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({
            id: 999,
            login: 'dev-user',
            name: 'Developer',
            email: 'dev@example.com',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo, read:user, workflow',
            },
          },
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    const user = await validateGitHubToken('ghp_valid_mock_token', { fetchImpl: mockFetch });
    expect(user.login).toBe('dev-user');
    expect(user.id).toBe(999);
    expect(user.scopes).toEqual(['repo', 'read:user', 'workflow']);
  });

  test('requests device code via mock fetch', async () => {
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://github.com/login/device/code');
      const body = JSON.parse(String(init?.body)) as { client_id: string; scope: string };
      expect(body.client_id).toBe('mock_client_id');
      return new Response(
        JSON.stringify({
          device_code: 'device-code-abc',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const device = await requestGitHubDeviceCode({
      clientId: 'mock_client_id',
      scopes: ['repo'],
      fetchImpl: mockFetch,
    });

    expect(device.device_code).toBe('device-code-abc');
    expect(device.user_code).toBe('WDJB-MJHT');
    expect(device.verification_uri).toBe('https://github.com/login/device');
  });

  test('polls device token handling authorization_pending then success', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'authorization_pending' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          access_token: 'ghu_received_access_token',
          token_type: 'bearer',
          scope: 'repo,read:user',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const sleepCalls: number[] = [];
    const mockSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const token = await pollGitHubDeviceToken('device-code-abc', {
      clientId: 'mock_client_id',
      interval: 1,
      fetchImpl: mockFetch,
      sleep: mockSleep,
    });

    expect(token.access_token).toBe('ghu_received_access_token');
    expect(callCount).toBe(2);
    expect(sleepCalls).toEqual([1000]);
  });

  test('loginWithGitHubToken authenticates, stores credential, and updates secret store', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({ id: 42, login: 'testpilot' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo' },
        },
      );
    }) as unknown as typeof fetch;

    const secretStore = new MemorySecretStore();
    const cred = await loginWithGitHubToken('ghp_testpilot_token', {
      home,
      secretStore,
      fetchImpl: mockFetch,
    });

    expect(cred.provider).toBe('github');
    expect(cred.user?.login).toBe('testpilot');
    expect(await secretStore.resolve('oauth-github')).toBe('ghp_testpilot_token');

    const persisted = await readCredential('github', home);
    expect(persisted?.token).toBe('ghp_testpilot_token');
  });

  test('resolves oauth MCP server env reference from secret store', async () => {
    await initMasterDir(home);
    const secretStore = new MemorySecretStore();
    await secretStore.set('oauth-github', 'token_from_oauth');

    await upsertMcpServer(
      'github-mcp',
      {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: { source: 'oauth', provider: 'github' },
        },
      },
      undefined,
      home,
    );

    const resolved = await resolveEffectiveMcpServersEnv('claude', home, process.env, secretStore);
    expect(resolved['github-mcp']?.env?.GITHUB_TOKEN).toBe('token_from_oauth');
  });
});
