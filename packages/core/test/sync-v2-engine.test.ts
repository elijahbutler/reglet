import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  approveSyncV2Pairing,
  bootstrapSyncV2,
  completeSyncV2Pairing,
  loadSyncV2State,
  newActiveSyncV2State,
  requestSyncV2Pairing,
  saveSyncV2State,
  syncOnceV2,
  type SyncV2SecretStore,
  saveLibraryManifest,
  readCredential,
  saveCredential,
  type SyncedCredential,
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
  delete process.env.REGLET_PROVIDER_HOME;
});

describe('encrypted sync protocol v2 engine', () => {
  test('persists a visible failure and clears it after a successful run', async () => {
    const failedHome = await tempDirectory();
    await saveSyncV2State(newActiveSyncV2State({
      serverUrl: 'https://reglet.test',
      vaultId: 'missing-vault',
      deviceId: 'missing-device',
      deviceName: 'Missing credentials',
      keyEpoch: 1,
      credentialId: 'missing-credential',
    }), failedHome);
    await expect(syncOnceV2({ home: failedHome, secretStore: new MemorySecretStore() }))
      .rejects.toThrow('credentials are missing');
    const failed = await loadSyncV2State(failedHome);
    expect(failed?.phase === 'active' ? failed.lastError?.message : undefined).toContain('credentials are missing');

    const setup = await twoDeviceSetup();
    const before = await loadSyncV2State(setup.macHome);
    if (before?.phase !== 'active') throw new Error('Expected active sync state.');
    before.lastError = { occurredAt: '2020-01-01T00:00:00.000Z', message: 'Previous failure' };
    await saveSyncV2State(before, setup.macHome);
    const completed = await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    const after = await loadSyncV2State(setup.macHome);

    expect(completed.completedAt).toBe(after?.phase === 'active' ? after.lastSync?.completedAt : undefined);
    expect(after?.phase === 'active' ? after.lastError : undefined).toBeUndefined();
  });

  test('syncs only manifest-indexed canonical files after library-v2 migration', async () => {
    const setup = await twoDeviceSetup();
    await mkdir(path.join(setup.macHome, 'rules'), { recursive: true });
    await mkdir(path.join(setup.macHome, 'skills', 'archived'), { recursive: true });
    await mkdir(path.join(setup.macHome, '.state', 'drafts'), { recursive: true });
    await writeFile(path.join(setup.macHome, 'rules', 'managed.md'), 'Managed\n');
    await writeFile(path.join(setup.macHome, 'rules', 'unindexed.md'), 'Local only\n');
    await writeFile(path.join(setup.macHome, 'skills', 'archived', 'SKILL.md'), 'Archived canonical\n');
    await writeFile(path.join(setup.macHome, '.state', 'drafts', 'artifact.json'), '{"secret":"local"}\n');
    await saveLibraryManifest({
      schemaVersion: 2,
      artifacts: [
        {
          id: 'instruction-id', kind: 'instruction', lifecycle: 'active', scope: { kind: 'global' },
          slug: 'managed', title: 'Managed', tags: [], targets: ['codex'], locator: { type: 'file', path: 'rules/managed.md' },
        },
        {
          id: 'archived-id', kind: 'skill', lifecycle: 'archived', scope: { kind: 'global' },
          slug: 'archived', title: 'Archived', tags: [], targets: [], locator: { type: 'directory', path: 'skills/archived' },
        },
      ],
      tombstones: [],
    }, setup.macHome);

    const pushed = await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    const pulled = await syncOnceV2({ home: setup.windowsHome, fetchImpl: setup.fetchImpl, secretStore: setup.windowsStore });

    expect(pushed.pushed).toEqual(['library.json', 'rules/managed.md', 'skills/archived/SKILL.md']);
    expect(pulled.pulled).toEqual(['library.json', 'rules/managed.md', 'skills/archived/SKILL.md']);
    await expect(stat(path.join(setup.windowsHome, 'rules', 'unindexed.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(setup.windowsHome, '.state', 'drafts', 'artifact.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('moves rules, skills, and MCP from Mac to Windows without provider writes or machine-local config', async () => {
    const setup = await twoDeviceSetup();
    await mkdir(path.join(setup.macHome, 'rules'), { recursive: true });
    await mkdir(path.join(setup.macHome, 'skills', 'shared', 'homeserver'), { recursive: true });
    await mkdir(path.join(setup.macHome, 'mcp'), { recursive: true });
    await writeFile(path.join(setup.macHome, 'rules', '00-general.md'), 'Shared agent rules\n');
    await writeFile(path.join(setup.macHome, 'skills', 'shared', 'homeserver', 'SKILL.md'), 'Synced skill\n');
    await writeFile(path.join(setup.macHome, 'mcp', 'servers.json'), '{"mcpServers":{}}\n');
    await writeFile(path.join(setup.macHome, 'reglet.toml'), '[providers.claude]\nenabled = true\n');

    const pushed = await syncOnceV2({
      home: setup.macHome,
      fetchImpl: setup.fetchImpl,
      secretStore: setup.macStore,
    });
    const pulled = await syncOnceV2({
      home: setup.windowsHome,
      fetchImpl: setup.fetchImpl,
      secretStore: setup.windowsStore,
    });

    expect(pushed.pushed).toEqual([
      'mcp/servers.json',
      'rules/00-general.md',
      'skills/shared/homeserver/SKILL.md',
    ]);
    expect(pulled.pulled).toEqual([
      'mcp/servers.json',
      'rules/00-general.md',
      'skills/shared/homeserver/SKILL.md',
    ]);
    expect(pulled.providerReviewRequired).toBe(true);
    expect(await readFile(path.join(setup.windowsHome, 'rules', '00-general.md'), 'utf8')).toBe('Shared agent rules\n');
    expect(await readFile(path.join(setup.windowsHome, 'skills', 'shared', 'homeserver', 'SKILL.md'), 'utf8')).toBe(
      'Synced skill\n',
    );
    await expect(stat(path.join(setup.windowsHome, 'reglet.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(setup.providerHome, '.claude', 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves overlapping device edits in a local-only conflict artifact', async () => {
    const setup = await twoDeviceSetup();
    await mkdir(path.join(setup.macHome, 'rules'), { recursive: true });
    await writeFile(path.join(setup.macHome, 'rules', '00-general.md'), 'original\n');
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    await syncOnceV2({ home: setup.windowsHome, fetchImpl: setup.fetchImpl, secretStore: setup.windowsStore });

    await writeFile(path.join(setup.macHome, 'rules', '00-general.md'), 'mac edit\n');
    await writeFile(path.join(setup.windowsHome, 'rules', '00-general.md'), 'windows edit\n');
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    const conflict = await syncOnceV2({
      home: setup.windowsHome,
      fetchImpl: setup.fetchImpl,
      secretStore: setup.windowsStore,
    });

    expect(conflict.conflicts).toEqual(['rules/00-general.conflict-Windows-PC.md']);
    expect(await readFile(path.join(setup.windowsHome, 'rules', '00-general.md'), 'utf8')).toBe('windows edit\n');
    expect(await readFile(path.join(setup.windowsHome, 'rules', '00-general.conflict-Windows-PC.md'), 'utf8')).toBe(
      'mac edit\n',
    );
    expect(conflict.pushed).not.toContain('rules/00-general.md');
  });

  test('synchronizes a reviewed deletion as an encrypted tombstone', async () => {
    const setup = await twoDeviceSetup();
    const skillPath = path.join('skills', 'shared', 'temporary', 'SKILL.md');
    await mkdir(path.join(setup.macHome, path.dirname(skillPath)), { recursive: true });
    await writeFile(path.join(setup.macHome, skillPath), 'temporary\n');
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    await syncOnceV2({ home: setup.windowsHome, fetchImpl: setup.fetchImpl, secretStore: setup.windowsStore });

    await unlink(path.join(setup.macHome, skillPath));
    const deletion = await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    const pulled = await syncOnceV2({
      home: setup.windowsHome,
      fetchImpl: setup.fetchImpl,
      secretStore: setup.windowsStore,
    });

    expect(deletion.deleted).toContain('skills/shared/temporary/SKILL.md');
    expect(pulled.deleted).toContain('skills/shared/temporary/SKILL.md');
    await expect(stat(path.join(setup.windowsHome, skillPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('synchronizes an encrypted credential from Mac to Windows', async () => {
    const setup = await twoDeviceSetup();
    const cred: SyncedCredential = {
      version: 1,
      provider: 'github',
      tokenType: 'bearer',
      token: 'ghp_secret_cross_device_token',
      scopes: ['repo'],
      updatedAt: new Date().toISOString(),
    };
    await saveCredential(cred, setup.macHome);
    const pushed = await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    expect(pushed.pushed).toContain('credentials/github.json');

    const pulled = await syncOnceV2({ home: setup.windowsHome, fetchImpl: setup.fetchImpl, secretStore: setup.windowsStore });
    expect(pulled.pulled).toContain('credentials/github.json');

    const received = await readCredential('github', setup.windowsHome);
    expect(received?.token).toBe('ghp_secret_cross_device_token');
  });

  test('repairs derived merge bases after an interrupted local commit', async () => {
    const setup = await twoDeviceSetup();
    const filePath = path.join('rules', '00-general.md');
    const localPath = path.join(setup.macHome, filePath);
    const basePath = path.join(setup.macHome, '.state', 'sync-v2-bases', filePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, 'tracked\n');
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });

    await writeFile(basePath, 'stale\n');
    const noOp = await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    expect(noOp.pushed).toEqual([]);
    expect(await readFile(basePath, 'utf8')).toBe('tracked\n');

    await unlink(localPath);
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    await writeFile(basePath, 'stale after deletion\n');
    await syncOnceV2({ home: setup.macHome, fetchImpl: setup.fetchImpl, secretStore: setup.macStore });
    await expect(stat(basePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function twoDeviceSetup(): Promise<{
  macHome: string;
  windowsHome: string;
  providerHome: string;
  macStore: MemorySecretStore;
  windowsStore: MemorySecretStore;
  fetchImpl: typeof fetch;
}> {
  const databasePath = path.join(await tempDirectory(), 'reglet.sqlite');
  const token = 'engine-bootstrap-token-with-entropy-123';
  const app = useApp(createApp({
    dbPath: databasePath,
    singleUserToken: token,
    enableLegacyV1: false,
    rateLimit: false,
  }));
  const fetchImpl = appFetch(app);
  const macHome = await tempDirectory();
  const windowsHome = await tempDirectory();
  const providerHome = await tempDirectory();
  process.env.REGLET_PROVIDER_HOME = providerHome;
  const macStore = new MemorySecretStore();
  const windowsStore = new MemorySecretStore();
  await bootstrapSyncV2({
    serverUrl: 'https://reglet.test',
    bootstrapToken: token,
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
  const approval = await approveSyncV2Pairing({
    code: pending.code,
    home: macHome,
    fetchImpl,
    secretStore: macStore,
  });
  await completeSyncV2Pairing({
    confirmedSas: approval.sas,
    home: windowsHome,
    fetchImpl,
    secretStore: windowsStore,
  });
  return { macHome, windowsHome, providerHome, macStore, windowsStore, fetchImpl };
}

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
  const directory = await mkdtemp(path.join(tmpdir(), 'reglet-engine-v2-'));
  directories.push(directory);
  return directory;
}
