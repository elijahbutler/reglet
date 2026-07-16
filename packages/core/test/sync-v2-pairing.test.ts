import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  activeSyncV2CredentialId,
  approveSyncV2Pairing,
  bootstrapSyncV2,
  completeSyncV2Pairing,
  listManagedSyncV2Devices,
  loadActiveSyncV2State,
  loadSyncV2State,
  logoutSyncV2,
  pendingSyncV2PairingStatus,
  pendingSyncV2CredentialId,
  requestSyncV2Pairing,
  type SyncV2SecretStore,
} from '../src/index.js';
import { closeApp, createApp } from '../../server/src/app.js';
import { removeTestDirectory } from '../../server/test/cleanup.js';

const directories: string[] = [];
const apps: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const app of apps) closeApp(app);
  apps.length = 0;
  for (const directory of directories) {
    await removeTestDirectory(directory);
  }
  directories.length = 0;
});

describe('sync protocol v2 pairing orchestration', () => {
  test('bootstraps a Mac, pairs Windows after SAS comparison, and keeps secrets out of state files', async () => {
    const databasePath = path.join(await tempDirectory(), 'reglet.sqlite');
    const bootstrapToken = 'pairing-bootstrap-token-with-entropy-123';
    const app = useApp(createApp({
      dbPath: databasePath,
      singleUserToken: bootstrapToken,
      enableLegacyV1: false,
      rateLimit: false,
    }));
    const fetchImpl = appFetch(app);
    const macHome = await tempDirectory();
    const windowsHome = await tempDirectory();
    const macStore = new MemorySecretStore();
    const windowsStore = new MemorySecretStore();

    await bootstrapSyncV2({
      serverUrl: 'https://reglet.test',
      bootstrapToken,
      deviceName: 'MacBook',
      home: macHome,
      fetchImpl,
      secretStore: macStore,
    });
    // Bootstrap is idempotent so an interrupted response can be safely retried.
    await bootstrapSyncV2({
      serverUrl: 'https://reglet.test',
      bootstrapToken,
      deviceName: 'MacBook',
      home: macHome,
      fetchImpl,
      secretStore: macStore,
    });
    const pending = await requestSyncV2Pairing({
      serverUrl: 'https://reglet.test',
      deviceName: 'Windows PC',
      home: windowsHome,
      fetchImpl,
      secretStore: windowsStore,
    });
    expect(pending.code).toHaveLength(8);

    const approved = await approveSyncV2Pairing({
      code: pending.code,
      home: macHome,
      fetchImpl,
      secretStore: macStore,
    });
    const status = await pendingSyncV2PairingStatus({
      home: windowsHome,
      fetchImpl,
      secretStore: windowsStore,
    });
    expect(status.status).toBe('approved');
    expect(status.sas).toBe(approved.sas);

    await expect(
      completeSyncV2Pairing({
        confirmedSas: 'WRONG FINGERPRINT',
        home: windowsHome,
        fetchImpl,
        secretStore: windowsStore,
      }),
    ).rejects.toThrow('does not match');
    await completeSyncV2Pairing({
      confirmedSas: approved.sas,
      home: windowsHome,
      fetchImpl,
      secretStore: windowsStore,
    });

    const macDevices = await listManagedSyncV2Devices({ home: macHome, fetchImpl, secretStore: macStore });
    const windowsDevices = await listManagedSyncV2Devices({ home: windowsHome, fetchImpl, secretStore: windowsStore });
    expect(macDevices.devices.map((device) => device.deviceName)).toEqual(['MacBook', 'Windows PC']);
    expect(windowsDevices.currentDeviceId).toBe((await loadActiveSyncV2State(windowsHome)).deviceId);

    const macState = await readFile(path.join(macHome, '.state', 'sync-v2.json'), 'utf8');
    const windowsState = await readFile(path.join(windowsHome, '.state', 'sync-v2.json'), 'utf8');
    expect(macState).not.toContain(bootstrapToken);
    for (const storedSecret of [...macStore.values(), ...windowsStore.values()]) {
      const parsed = JSON.parse(storedSecret) as Record<string, unknown>;
      for (const key of ['deviceToken', 'rootSecret', 'authoritySecretKey', 'agreementSecretKey', 'signingSecretKey']) {
        if (typeof parsed[key] === 'string') {
          expect(macState).not.toContain(parsed[key]);
          expect(windowsState).not.toContain(parsed[key]);
        }
      }
    }

    await macStore.set(pendingSyncV2CredentialId('https://reglet.test'), 'interrupted-cleanup-credential');
    await logoutSyncV2({ home: macHome, secretStore: macStore });
    expect(macStore.values()).toEqual([]);
    expect(await loadSyncV2State(macHome)).toBeNull();
  });

  test('does not overwrite orphaned operating-system credentials when local state is missing', async () => {
    const token = 'orphan-bootstrap-token-with-entropy-123';
    const app = useApp(createApp({ singleUserToken: token, enableLegacyV1: false, rateLimit: false }));
    const fetchImpl = appFetch(app);
    const serverUrl = 'https://reglet.test';

    const bootstrapStore = new MemorySecretStore();
    await bootstrapStore.set(activeSyncV2CredentialId(serverUrl), 'recoverable-active-credential');
    await expect(
      bootstrapSyncV2({
        serverUrl,
        bootstrapToken: token,
        deviceName: 'MacBook',
        home: await tempDirectory(),
        fetchImpl,
        secretStore: bootstrapStore,
      }),
    ).rejects.toThrow('credentials exist but local sync state is missing');
    expect(await bootstrapStore.get(activeSyncV2CredentialId(serverUrl))).toBe('recoverable-active-credential');

    const pairingStore = new MemorySecretStore();
    await pairingStore.set(pendingSyncV2CredentialId(serverUrl), 'recoverable-pending-credential');
    await expect(
      requestSyncV2Pairing({
        serverUrl,
        deviceName: 'Windows PC',
        home: await tempDirectory(),
        fetchImpl,
        secretStore: pairingStore,
      }),
    ).rejects.toThrow('credentials exist but local sync state is missing');
    expect(await pairingStore.get(pendingSyncV2CredentialId(serverUrl))).toBe('recoverable-pending-credential');
  });
});

class MemorySecretStore implements SyncV2SecretStore {
  private readonly records = new Map<string, string>();

  async get(account: string): Promise<string | null> {
    return this.records.get(account) ?? null;
  }

  async set(account: string, secret: string): Promise<void> {
    this.records.set(account, secret);
  }

  async delete(account: string): Promise<void> {
    this.records.delete(account);
  }

  values(): string[] {
    return [...this.records.values()];
  }
}

function appFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return app.fetch(request);
  }) as typeof fetch;
}

function useApp(app: ReturnType<typeof createApp>): ReturnType<typeof createApp> {
  apps.push(app);
  return app;
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'reglet-pairing-v2-'));
  directories.push(directory);
  return directory;
}
