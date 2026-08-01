import { describe, expect, test } from 'bun:test';
import {
  parseRuntimeStartup,
  redactRuntimeError,
  validateRuntimeStartup,
} from '../src/runtime-bootstrap.js';

describe('desktop runtime bootstrap', () => {
  test('accepts only a paired loopback manager URL', () => {
    const startup = parseRuntimeStartup(
      JSON.stringify({
        listening: true,
        url: 'http://127.0.0.1:49152',
        managerUrl: 'http://127.0.0.1:49152/manager/#pair=ABC234',
        pairingExpiresAt: '2026-07-31T00:00:00.000Z',
        remote: false,
      }),
    );
    expect(startup).toBeDefined();
    if (startup === undefined) throw new Error('Startup fixture failed.');
    expect(() => validateRuntimeStartup(startup)).not.toThrow();
    expect(() =>
      validateRuntimeStartup({
        ...startup,
        managerUrl: 'http://example.test/manager/#pair=ABC234',
      }),
    ).toThrow('unsafe bootstrap URL');
  });

  test('redacts credentials and local paths from startup errors', () => {
    const redacted = redactRuntimeError(
      'token=visible /Users/example/.reglet/library.json',
    );
    expect(redacted).not.toContain('visible');
    expect(redacted).not.toContain('/Users/example');
  });
});
