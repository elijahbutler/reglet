import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  pair: vi.fn(),
  termination: undefined as (() => void) | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
    mocks.termination = handler;
    return vi.fn();
  }),
}));
vi.mock('@reglet/manager-ui', () => ({
  TauriManagerClient: class {
    constructor(readonly options: { baseUrl: string }) {}
    pair = mocks.pair;
  },
}));

import {
  bootstrapTauriManagerClient,
  parseRuntimeStartup,
  subscribeManagerRuntimeTermination,
} from './runtimeBootstrap.js';

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
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.pair.mockReset();
    mocks.pair.mockResolvedValue({ id: 'session', scope: 'admin' });
  });

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

  test('drops the settled client and bootstraps again after runtime termination', async () => {
    mocks.invoke.mockResolvedValue(validStartup);
    const terminated = vi.fn();
    const unsubscribe = subscribeManagerRuntimeTermination(terminated);

    const first = await bootstrapTauriManagerClient();
    expect(await bootstrapTauriManagerClient()).toBe(first);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    mocks.termination?.();
    const second = await bootstrapTauriManagerClient();
    expect(second).not.toBe(first);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.pair).toHaveBeenCalledTimes(2);
    expect(terminated).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
