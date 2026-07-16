import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  activeSyncV2CredentialId,
  approveSyncV2Pairing,
  bootstrapSyncV2,
  completeSyncV2BootstrapConnection,
  completeSyncV2Pairing,
  disconnectSyncV2,
  listManagedSyncV2Devices,
  loadActiveSyncV2State,
  loadSyncV2State,
  logoutSyncV2,
  pendingSyncV2PairingStatus,
  pendingSyncV2CredentialId,
  parseSyncV2ConnectLink,
  requestSyncV2Pairing,
  startSyncV2BootstrapConnection,
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
  test('retries an interrupted owner-approved first-device connection without changing its fingerprint', async () => {
    const claimLinks: string[] = [];
    const app = useApp(createApp({
      publicUrl: 'https://reglet.test',
      onOwnerClaimLink: (link) => claimLinks.push(link),
      rateLimit: false,
    }));
    const claimToken = new URL(claimLinks[0]!).hash.slice('#claim='.length);
    const claim = await app.request('/api/admin/v1/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://reglet.test' },
      body: JSON.stringify({ token: claimToken, email: 'owner@example.com', password: 'correct horse battery staple' }),
    });
    const cookie = claim.headers.get('set-cookie') ?? '';
    const session = await claim.json() as { csrfToken: string };
    const grantResponse = await app.request('/api/admin/v1/connections', {
      method: 'POST',
      headers: { cookie, origin: 'https://reglet.test', 'x-reglet-csrf': session.csrfToken },
    });
    const grant = await grantResponse.json() as { id: string; connectUrl: string };
    expect(parseSyncV2ConnectLink(grant.connectUrl).kind).toBe('bootstrap');

    const home = await tempDirectory();
    const store = new MemorySecretStore();
    const directFetch = appFetch(app);
    let interrupt = true;
    const interruptedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const response = await directFetch(request);
      if (interrupt && request.method === 'POST' && new URL(request.url).pathname === '/v2/bootstrap/requests') {
        interrupt = false;
        throw new Error('connection dropped after server commit');
      }
      return response;
    }) as typeof fetch;

    await expect(startSyncV2BootstrapConnection({
      connectUrl: grant.connectUrl,
      deviceName: 'Owner Mac',
      home,
      fetchImpl: interruptedFetch,
      secretStore: store,
    })).rejects.toThrow('connection dropped');
    const retried = await startSyncV2BootstrapConnection({
      connectUrl: grant.connectUrl,
      deviceName: 'Owner Mac',
      home,
      fetchImpl: directFetch,
      secretStore: store,
    });
    const pending = await app.request('/api/admin/v1/connections', { headers: { cookie } });
    expect(await pending.json()).toMatchObject({ connections: [{ id: grant.id, fingerprint: retried.fingerprint }] });

    expect((await app.request(`/api/admin/v1/connections/${grant.id}/approve`, {
      method: 'POST',
      headers: { cookie, origin: 'https://reglet.test', 'x-reglet-csrf': session.csrfToken },
    })).status).toBe(200);
    await expect(completeSyncV2BootstrapConnection({
      confirmedFingerprint: 'wrong fingerprint',
      home,
      fetchImpl: directFetch,
      secretStore: store,
    })).rejects.toThrow('does not match');
    await completeSyncV2BootstrapConnection({
      confirmedFingerprint: retried.fingerprint,
      home,
      fetchImpl: directFetch,
      secretStore: store,
    });
    expect((await loadActiveSyncV2State(home)).deviceName).toBe('Owner Mac');
  });

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

    await disconnectSyncV2({ home: windowsHome, fetchImpl, secretStore: windowsStore });
    expect(await loadSyncV2State(windowsHome)).toBeNull();
    expect(windowsStore.values()).toEqual([]);
    expect((await listManagedSyncV2Devices({ home: macHome, fetchImpl, secretStore: macStore })).devices
      .find((device) => device.deviceName === 'Windows PC')?.revokedAt).not.toBeNull();

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

  test('rejects connection links with query secrets, insecure origins, or unexpected fragments', () => {
    expect(() => parseSyncV2ConnectLink('https://sync.example/connect?grant=abcdefghijklmnopqrstuvwxyz')).toThrow('valid grant');
    expect(() => parseSyncV2ConnectLink('http://sync.example/connect#grant=abcdefghijklmnopqrstuvwxyz')).toThrow('must use HTTPS');
    expect(() => parseSyncV2ConnectLink('https://sync.example/connect#grant=abcdefghijklmnopqrstuvwxyz&redirect=evil')).toThrow('unexpected data');
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
