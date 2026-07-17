import { describe, expect, test } from 'bun:test';
import { macKeychainSetArgs } from '../src/sync/v2-credentials.js';

describe('sync protocol v2 credential storage', () => {
  test('macOS Keychain set arguments preserve long JSON secrets without prompt truncation', () => {
    const secret = JSON.stringify({
      version: 1,
      rootSecret: 'x'.repeat(96),
      authoritySecretKey: 'y'.repeat(96),
      deviceToken: 'z'.repeat(96),
    });
    const args = macKeychainSetArgs('pending-test', secret);

    expect(args.slice(0, -1)).toEqual([
      'add-generic-password',
      '-a',
      'pending-test',
      '-s',
      'build.reglet.sync.v2',
      '-U',
      '-X',
    ]);
    expect(Buffer.from(args.at(-1) ?? '', 'hex').toString('utf8')).toBe(secret);
  });
});
