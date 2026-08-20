import { invoke } from '@tauri-apps/api/core';
import { TauriManagerClient } from '@reglet/manager-ui';

export interface RuntimeStartup {
  version: 1;
  listening: true;
  url: string;
  managerUrl: string;
  pairingExpiresAt: string;
  remote: false;
  protocolVersion: 2;
}

let managerClientPromise: Promise<TauriManagerClient> | undefined;

export function parseRuntimeStartup(value: unknown): RuntimeStartup {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'listening', 'url', 'managerUrl', 'pairingExpiresAt', 'remote', 'protocolVersion']) ||
    value.version !== 1 || value.listening !== true || value.remote !== false || value.protocolVersion !== 2 ||
    typeof value.url !== 'string' || typeof value.managerUrl !== 'string' || typeof value.pairingExpiresAt !== 'string') {
    throw new Error('Reglet returned an invalid Manager runtime bootstrap payload.');
  }
  const runtimeUrl = new URL(value.url);
  const managerUrl = new URL(value.managerUrl);
  const pairing = new URLSearchParams(managerUrl.hash.slice(1));
  const pairingCode = pairing.get('pair');
  if (runtimeUrl.protocol !== 'http:' || runtimeUrl.hostname !== '127.0.0.1' || managerUrl.origin !== runtimeUrl.origin ||
    runtimeUrl.username !== '' || runtimeUrl.password !== '' || runtimeUrl.pathname !== '/' || runtimeUrl.search !== '' || runtimeUrl.hash !== '' ||
    managerUrl.username !== '' || managerUrl.password !== '' || managerUrl.pathname !== '/manager/' || managerUrl.search !== '' ||
    pairingCode === null || pairingCode.trim().length === 0 || pairing.getAll('pair').length !== 1 || [...pairing.keys()].some((key) => key !== 'pair') ||
    !Number.isFinite(Date.parse(value.pairingExpiresAt))) {
    throw new Error('Reglet refused an unsafe Manager runtime origin.');
  }
  return value as unknown as RuntimeStartup;
}

export async function bootstrapTauriManagerClient(): Promise<TauriManagerClient> {
  managerClientPromise ??= createTauriManagerClient().catch((error: unknown) => {
    managerClientPromise = undefined;
    throw error;
  });
  return managerClientPromise;
}

async function createTauriManagerClient(): Promise<TauriManagerClient> {
  const startup = parseRuntimeStartup(await invoke<unknown>('manager_runtime_start'));
  const code = new URLSearchParams(new URL(startup.managerUrl).hash.slice(1)).get('pair');
  if (code === null || code.length === 0) throw new Error('Manager runtime did not provide its one-use bootstrap credential.');
  const client = new TauriManagerClient({ baseUrl: startup.url });
  await client.pair(code);
  return client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}
