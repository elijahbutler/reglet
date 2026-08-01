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
});
