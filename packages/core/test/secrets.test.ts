import { describe, expect, test } from 'bun:test';
import { MemorySecretStore } from '../src/security/secrets.js';

describe('secret bindings', () => {
  test('returns binding state without returning secret values', async () => {
    const store = new MemorySecretStore();
    const bound = await store.set('api-token', 'super-secret');

    expect(bound).toEqual({ id: 'api-token', bound: true });
    expect(JSON.stringify(bound)).not.toContain('super-secret');
    expect(await store.status('api-token')).toEqual({
      id: 'api-token',
      bound: true,
    });
    expect(await store.delete('api-token')).toEqual({
      id: 'api-token',
      bound: false,
    });
  });
});
