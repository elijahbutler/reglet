import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { accountSession, claimPairing, loginWithAccount, startPairing } from '../src/sync/account.js';
import { configureTokenLogin, syncOnce, tryMergeText } from '../src/sync/engine.js';
import { SyncClient } from '../src/sync/client.js';
import { closeApp, createApp } from '../../../packages/server/src/app.js';

let currentDirs: string[] = [];
let currentApps: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const app of currentApps) {
    closeApp(app);
  }
  currentApps = [];
  for (const dir of currentDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  currentDirs = [];
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  currentDirs.push(dir);
  return dir;
}

async function useTempProviderHome(): Promise<void> {
  process.env.REGLET_PROVIDER_HOME = await tempDir('reglet-sync-provider-');
}

describe('sync engine', () => {
  test('syncs a local edit from one client to another through the server', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'A rules\n');
    await writeBasicMaster(homeB, 'B rules\n');
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    const syncA = await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncA.pushed).toContain('rules/00-general.md');
    expect(syncB.conflicts).toContain('rules/00-general.conflict-device-b.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.conflict-device-b.md'), 'utf8')).toBe('A rules\n');
  });

  test('clean pull applies remote files into an empty local master', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Shared rules\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    await writeFile(path.join(homeB, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    await writeFile(path.join(homeB, 'reglet.toml'), '[sync]\nserver_url = ""\n');
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncB.pulled).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Shared rules\n');
  });

  test('syncs provider-specific skill files as part of the master skills tree', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'A rules\n');
    await mkdir(path.join(homeA, 'skills', 'codex', 'codex-only'), { recursive: true });
    await writeFile(path.join(homeA, 'skills', 'codex', 'codex-only', 'SKILL.md'), 'codex only\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    await writeFile(path.join(homeB, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    await writeFile(path.join(homeB, 'reglet.toml'), '[sync]\nserver_url = ""\n');
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    const syncA = await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncA.pushed).toContain('skills/codex/codex-only/SKILL.md');
    expect(syncB.pulled).toContain('skills/codex/codex-only/SKILL.md');
    expect(await readFile(path.join(homeB, 'skills', 'codex', 'codex-only', 'SKILL.md'), 'utf8')).toBe(
      'codex only\n',
    );
  });

  test('merges non-overlapping text edits and retries push after remote conflict', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');
    const original = 'line one\nline two\nline three\n';

    await writeBasicMaster(homeA, original);
    await writeBasicMaster(homeB, original);
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);
    await syncOnce(homeA, fetchImpl);
    await syncOnce(homeB, fetchImpl);

    await writeFile(path.join(homeA, 'rules', '00-general.md'), 'line one remote\nline two\nline three\n');
    await writeFile(path.join(homeB, 'rules', '00-general.md'), 'line one\nline two local\nline three\n');
    await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncB.merged).toContain('rules/00-general.md');
    expect(syncB.pushed).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe(
      'line one remote\nline two local\nline three\n',
    );
  });

  test('account login pairs a device and pairing codes work across devices and restarts', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Account rules\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    const stateA = await loginWithAccount({
      serverUrl: 'http://reglet.test',
      email: 'user@example.com',
      password: 'secret-password',
      deviceName: 'device-a',
      mode: 'register',
      home: homeA,
      fetchImpl,
    });
    expect(stateA.deviceToken.length).toBeGreaterThan(0);

    // Pair a second device with a code issued by the account, claimed after a
    // simulated server restart (new app instance, same SQLite file).
    const sessionToken = await accountSession('http://reglet.test', 'user@example.com', 'secret-password', 'login', fetchImpl);
    const code = await startPairing('http://reglet.test', sessionToken, fetchImpl);
    const restarted = useApp(createApp({ dbPath: serverDb }));
    const stateB = await claimPairing('http://reglet.test', code, 'device-b', homeB, appFetch(restarted));
    expect(stateB.deviceToken.length).toBeGreaterThan(0);
    expect(stateB.deviceToken).not.toBe(stateA.deviceToken);

    const syncA = await syncOnce(homeA, appFetch(restarted));
    const syncB = await syncOnce(homeB, appFetch(restarted));
    expect(syncA.pushed).toContain('rules/00-general.md');
    expect(syncB.pulled).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Account rules\n');
  });

  test('tryMergeText returns null for overlapping text edits', () => {
    const base = Buffer.from('same\nbase\n');
    const local = Buffer.from('same\nlocal\n');
    const remote = Buffer.from('same\nremote\n');

    expect(tryMergeText(base, local, remote)).toBeNull();
  });

  test('rejects a server that does not support the client protocol before syncing', async () => {
    const fetchImpl = (async () =>
      Response.json({
        service: { name: 'future-sync', version: '9.0.0' },
        protocol: { current: 9, supported: [9] },
      })) as typeof fetch;
    const client = new SyncClient('https://sync.example.test', 'token', fetchImpl);

    await expect(client.ensureCompatible()).rejects.toThrow('does not support Reglet protocol 1');
  });
});

function useApp(app: ReturnType<typeof createApp>): ReturnType<typeof createApp> {
  currentApps.push(app);
  return app;
}

async function writeBasicMaster(home: string, rules: string): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await mkdir(path.join(home, 'mcp'), { recursive: true });
  await writeFile(path.join(home, 'rules', '00-general.md'), rules);
  await writeFile(path.join(home, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  await writeFile(path.join(home, 'reglet.toml'), '[sync]\nserver_url = ""\n');
}

function appFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    return app.request(`${parsed.pathname}${parsed.search}`, init);
  }) as typeof fetch;
}
