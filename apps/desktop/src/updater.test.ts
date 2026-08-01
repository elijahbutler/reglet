import { describe, expect, test } from 'vitest';
import { parseUpdateStatus } from './updater.js';

describe('desktop update response', () => {
  test('accepts the native updater result without exposing transport details', () => {
    expect(parseUpdateStatus({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      available: true,
      releaseUrl: 'https://github.com/elijahbutler/reglet/releases/tag/v1.1.0',
    })).toEqual({ currentVersion: '1.0.0', latestVersion: '1.1.0', available: true });
  });

  test('rejects extra fields and untrusted release origins', () => {
    expect(() => parseUpdateStatus({
      currentVersion: '1.0.0', latestVersion: '1.1.0', available: true,
      releaseUrl: 'https://example.com/download',
    })).toThrow('invalid response');
    expect(() => parseUpdateStatus({
      currentVersion: '1.0.0', latestVersion: '1.1.0', available: true,
      releaseUrl: 'https://github.com/elijahbutler/reglet/releases/latest', extra: true,
    })).toThrow('invalid response');
  });
});
