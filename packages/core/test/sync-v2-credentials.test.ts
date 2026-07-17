import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { platformSyncV2SecretStore } from '../src/sync/v2-credentials.js';

describe('sync protocol v2 credential storage', () => {
  const nativeCredentialTest = process.platform === 'darwin' || process.platform === 'win32' ? test : test.skip;

  test('supports native credential stores on every desktop platform', () => {
    expect(() => platformSyncV2SecretStore('darwin')).not.toThrow();
    expect(() => platformSyncV2SecretStore('win32')).not.toThrow();
    expect(() => platformSyncV2SecretStore('linux')).not.toThrow();
    expect(() => platformSyncV2SecretStore('freebsd')).toThrow('macOS, Windows, and Linux');
  });

  nativeCredentialTest('native credential round trip preserves long JSON secrets', async () => {
    const account = `round-trip-${randomUUID()}`;
    const store = platformSyncV2SecretStore();
    const secret = JSON.stringify({
      version: 1,
      rootSecret: 'x'.repeat(512),
      authoritySecretKey: 'y'.repeat(512),
      deviceToken: 'z'.repeat(512),
    });

    try {
      await store.set(account, secret);
      expect(await store.get(account)).toBe(secret);
    } finally {
      await store.delete(account);
    }
    expect(await store.get(account)).toBeNull();
  });
});
