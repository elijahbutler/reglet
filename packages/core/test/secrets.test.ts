import { describe, expect, test } from 'bun:test';
import { resolveMcpServersSecrets, validateMcpServer } from '../src/mcp.js';
import { MemorySecretStore, secretReferenceStatus } from '../src/security/secrets.js';

describe('MCP secret bindings', () => {
  test('returns binding state without returning secret values', async () => {
    const store = new MemorySecretStore();
    const bound = await store.set('api-token', 'super-secret');

    expect(bound).toEqual({ id: 'api-token', bound: true });
    expect(JSON.stringify(bound)).not.toContain('super-secret');
    expect(await secretReferenceStatus({ source: 'keychain', id: 'api-token' }, store)).toEqual({
      reference: { source: 'keychain', id: 'api-token' },
      bound: true,
    });
    expect(await store.delete('api-token')).toEqual({ id: 'api-token', bound: false });
  });

  test('accepts keychain and process-env references but rejects raw values', async () => {
    const canonical = {
      command: 'node',
      env: {
        TOKEN: { source: 'keychain', id: 'api-token' },
        OPTIONAL_TOKEN: { source: 'process-env', name: 'OPTIONAL_TOKEN', required: false },
      },
    } as const;
    expect(validateMcpServer('local', canonical)).toEqual({ ok: true, issues: [] });
    expect(validateMcpServer('local', { command: 'node', env: { TOKEN: 'raw-secret' } }).ok).toBe(false);
    expect(validateMcpServer('local', { url: 'https://mcp.example', headers: { Authorization: 'Bearer raw-secret' } })).toEqual({
      ok: false,
      issues: ['unsupported field headers may alter security or provider behavior'],
    });
    expect(validateMcpServer('with-enabled', { command: 'node', enabled: true }).ok).toBe(true);
    expect(validateMcpServer('with-disabled', { command: 'node', disabled: false }).ok).toBe(true);
    expect(validateMcpServer('bad-enabled', { command: 'node', enabled: 'yes' }).ok).toBe(false);

    const store = new MemorySecretStore();
    await store.set('api-token', 'super-secret');
    const resolved = await resolveMcpServersSecrets({ local: canonical }, {}, store);
    expect(resolved.local?.env).toEqual({ TOKEN: 'super-secret' });
    expect(JSON.stringify(canonical)).not.toContain('super-secret');
  });

  test('blocks only a server whose required keychain binding is missing', async () => {
    const store = new MemorySecretStore();
    await expect(resolveMcpServersSecrets({
      blocked: {
        command: 'node',
        env: { TOKEN: { source: 'keychain', id: 'missing', required: true } },
      },
    }, {}, store)).rejects.toThrow('blocked');

    expect(await resolveMcpServersSecrets({
      optional: {
        command: 'node',
        env: { TOKEN: { source: 'keychain', id: 'missing', required: false } },
      },
    }, {}, store)).toEqual({ optional: { command: 'node' } });
  });

  test('finds missing required secrets while ignoring optional secrets', async () => {
    const store = new MemorySecretStore();
    await store.set('github-token', 'ghp_secret123');

    const missing = await {
      find: (await import('../src/mcp.js')).findMissingMcpSecrets,
    }.find({
      srv1: {
        command: 'npx',
        env: {
          GITHUB_TOKEN: { source: 'process-env', name: 'GITHUB_TOKEN' },
          API_KEY: { source: 'keychain', id: 'missing-api-key' },
          OPTIONAL_VAR: { source: 'process-env', name: 'NOT_THERE', required: false },
        },
      },
    }, {}, store);

    expect(missing).toEqual([
      { serverName: 'srv1', envKey: 'API_KEY', secretId: 'missing-api-key', source: 'keychain' },
    ]);
  });

  test('resolves secret from store when process-env key is saved in keychain', async () => {
    const store = new MemorySecretStore();
    await store.set('MY_API_KEY', 'key-value-1234');

    const resolved = await resolveMcpServersSecrets({
      custom: {
        command: 'run',
        env: {
          KEY: { source: 'process-env', name: 'MY_API_KEY' },
        },
      },
    }, {}, store);

    expect(resolved.custom?.env).toEqual({ KEY: 'key-value-1234' });
  });
});

