import { describe, expect, test } from 'vitest';
import { parseRuntimeStartup } from './runtimeBootstrap.js';

const validStartup = {
  version: 1,
  listening: true,
  url: 'http://127.0.0.1:43127',
  managerUrl: 'http://127.0.0.1:43127/manager/#pair=ONCE-ONLY',
  pairingExpiresAt: '2026-07-31T22:10:00.000Z',
  remote: false,
  protocolVersion: 2,
} as const;

describe('Manager runtime bootstrap validation', () => {
  test('accepts an exact loopback startup payload', () => {
    expect(parseRuntimeStartup(validStartup)).toEqual(validStartup);
  });

  test.each([
    { ...validStartup, url: 'http://localhost:43127' },
    { ...validStartup, url: 'https://127.0.0.1:43127' },
    { ...validStartup, managerUrl: 'http://127.0.0.1:43128/manager/#pair=ONCE-ONLY' },
    { ...validStartup, managerUrl: 'http://127.0.0.1:43127/manager/' },
    { ...validStartup, unexpected: true },
  ])('rejects unsafe or expanded payloads', (payload) => {
    expect(() => parseRuntimeStartup(payload)).toThrow();
  });
});
