import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { configureTokenLogin, syncOnce, tryMergeText } from '../src/sync/engine.js';
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

describe('sync engine', () => {
  test('syncs a local edit from one client to another through the server', async () => {
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'sync-token' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'A rules\n');
    await writeBasicMaster(homeB, 'B rules\n');
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-b', homeB);

    const syncA = await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncA.pushed).toContain('rules/00-general.md');
    expect(syncB.conflicts).toContain('rules/00-general.conflict-device-b.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.conflict-device-b.md'), 'utf8')).toBe('A rules\n');
  });

  test('clean pull applies remote files into an empty local master', async () => {
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'sync-token' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Shared rules\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    await writeFile(path.join(homeB, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    await writeFile(path.join(homeB, 'reglet.toml'), '[sync]\nserver_url = ""\n');
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-b', homeB);

    await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncB.pulled).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Shared rules\n');
  });

  test('merges non-overlapping text edits and retries push after remote conflict', async () => {
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'sync-token' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');
    const original = 'line one\nline two\nline three\n';

    await writeBasicMaster(homeA, original);
    await writeBasicMaster(homeB, original);
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-a', homeA);
    await configureTokenLogin('http://reglet.test', 'sync-token', 'device-b', homeB);
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

  test('tryMergeText returns null for overlapping text edits', () => {
    const base = Buffer.from('same\nbase\n');
    const local = Buffer.from('same\nlocal\n');
    const remote = Buffer.from('same\nremote\n');

    expect(tryMergeText(base, local, remote)).toBeNull();
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
