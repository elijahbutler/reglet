import { mkdir, mkdtemp, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { accountSession, claimPairing, loginWithAccount, startPairing } from '../src/sync/account.js';
import { configureTokenLogin, syncOnce, tryMergeText } from '../src/sync/engine.js';
import { SyncClient } from '../src/sync/client.js';
import { sha256String } from '../src/fsutil.js';
import { isAllowedSyncPath, resolveSyncPath } from '../src/sync/path.js';
import { closeApp, createApp } from '../../../packages/server/src/app.js';
import { removeTestDirectory } from '../../server/test/cleanup.js';

let currentDirs: string[] = [];
let currentApps: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const app of currentApps) {
    closeApp(app);
  }
  currentApps = [];
  const dirs = currentDirs;
  currentDirs = [];
  for (const dir of dirs) {
    await removeTestDirectory(dir);
  }
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
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    const syncA = await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncA.pushed).toContain('rules/00-general.md');
    expect(syncB.conflicts).toContain('rules/00-general.conflict-device-b.md');
    expect(syncB.providerReviewRequired).toBe(true);
    expect(await readFile(path.join(homeB, 'rules', '00-general.conflict-device-b.md'), 'utf8')).toBe('A rules\n');

    const repeat = await syncOnce(homeB, fetchImpl);
    expect(repeat.pushed).not.toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('B rules\n');
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
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncB.pulled).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Shared rules\n');
  });

  test('clean pull never writes provider outputs without local Review & Apply', async () => {
    const providerHome = await tempDir('reglet-sync-provider-');
    process.env.REGLET_PROVIDER_HOME = providerHome;
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Remote rules\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    await writeFile(path.join(homeB, 'mcp', 'servers.json'), '{"mcpServers":{}}\n');
    await writeFile(
      path.join(homeB, 'reglet.toml'),
      '[providers.claude]\nenabled = true\nrules = true\nskills = false\nmcp = false\n',
    );
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    await syncOnce(homeA, fetchImpl);
    const result = await syncOnce(homeB, fetchImpl);

    expect(result.providerReviewRequired).toBe(true);
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Remote rules\n');
    await expect(stat(path.join(providerHome, '.claude', 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' });
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
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    const syncA = await syncOnce(homeA, fetchImpl);
    const syncB = await syncOnce(homeB, fetchImpl);

    expect(syncA.pushed).toContain('skills/codex/codex-only/SKILL.md');
    expect(syncB.pulled).toContain('skills/codex/codex-only/SKILL.md');
    expect(await readFile(path.join(homeB, 'skills', 'codex', 'codex-only', 'SKILL.md'), 'utf8')).toBe(
      'codex only\n',
    );
  });

  test('syncs provider-scoped MCP files and local deletions', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');
    const scopedMcp = path.join('mcp', 'providers', 'claude', 'servers.json');

    await writeBasicMaster(homeA, 'Shared rules\n');
    await writeBasicMaster(homeB, 'Shared rules\n');
    await mkdir(path.join(homeA, 'mcp', 'providers', 'claude'), { recursive: true });
    await writeFile(path.join(homeA, scopedMcp), '{"mcpServers":{"local":{"command":"node"}}}\n');
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);

    await syncOnce(homeA, fetchImpl);
    await syncOnce(homeB, fetchImpl);
    expect(await readFile(path.join(homeB, scopedMcp), 'utf8')).toContain('"local"');

    await unlink(path.join(homeA, scopedMcp));
    const deletion = await syncOnce(homeA, fetchImpl);
    expect(deletion.deleted).toContain('mcp/providers/claude/servers.json');
    await syncOnce(homeB, fetchImpl);
    await expect(stat(path.join(homeB, scopedMcp))).rejects.toMatchObject({ code: 'ENOENT' });
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
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);
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

  test('preserves a local edit when another device deletes the remote file', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Shared rules\n');
    await writeBasicMaster(homeB, 'Shared rules\n');
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);
    await syncOnce(homeA, fetchImpl);
    await syncOnce(homeB, fetchImpl);

    await writeFile(path.join(homeB, 'rules', '00-general.md'), 'Keep my local edit\n');
    await unlink(path.join(homeA, 'rules', '00-general.md'));
    await syncOnce(homeA, fetchImpl);
    const conflict = await syncOnce(homeB, fetchImpl);

    expect(conflict.conflicts).toContain('rules/00-general.conflict-device-b.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Keep my local edit\n');
    expect((await stat(path.join(homeB, 'rules', '00-general.conflict-device-b.md'))).size).toBe(0);
    const repeat = await syncOnce(homeB, fetchImpl);
    expect(repeat.pushed).not.toContain('rules/00-general.md');
  });

  test('preserves a local deletion when another device edits the remote file', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: 'reglet-sync-test-token-123456' }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Shared rules\n');
    await writeBasicMaster(homeB, 'Shared rules\n');
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', homeA);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-b', homeB);
    await syncOnce(homeA, fetchImpl);
    await syncOnce(homeB, fetchImpl);

    await unlink(path.join(homeB, 'rules', '00-general.md'));
    await writeFile(path.join(homeA, 'rules', '00-general.md'), 'Remote edit\n');
    await syncOnce(homeA, fetchImpl);
    const conflict = await syncOnce(homeB, fetchImpl);

    expect(conflict.conflicts).toContain('rules/00-general.conflict-device-b.md');
    await expect(stat(path.join(homeB, 'rules', '00-general.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(homeB, 'rules', '00-general.conflict-device-b.md'), 'utf8')).toBe('Remote edit\n');
    const repeat = await syncOnce(homeB, fetchImpl);
    expect(repeat.deleted).not.toContain('rules/00-general.md');
  });

  test('account login pairs a device and pairing codes work across devices and restarts', async () => {
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const app = useApp(createApp({ dbPath: serverDb, allowRegistration: true }));
    const fetchImpl = appFetch(app);
    const homeA = await tempDir('reglet-sync-a-');
    const homeB = await tempDir('reglet-sync-b-');

    await writeBasicMaster(homeA, 'Account rules\n');
    await mkdir(path.join(homeB, 'rules'), { recursive: true });
    await mkdir(path.join(homeB, 'mcp'), { recursive: true });
    const stateA = await loginWithAccount({
      serverUrl: 'https://reglet.test',
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
    const sessionToken = await accountSession('https://reglet.test', 'user@example.com', 'secret-password', 'login', fetchImpl);
    const code = await startPairing('https://reglet.test', sessionToken, fetchImpl);
    const restarted = useApp(createApp({ dbPath: serverDb }));
    const stateB = await claimPairing('https://reglet.test', code, 'device-b', homeB, appFetch(restarted));
    expect(stateB.deviceToken.length).toBeGreaterThan(0);
    expect(stateB.deviceToken).not.toBe(stateA.deviceToken);

    const syncA = await syncOnce(homeA, appFetch(restarted));
    const syncB = await syncOnce(homeB, appFetch(restarted));
    expect(syncA.pushed).toContain('rules/00-general.md');
    expect(syncB.pulled).toContain('rules/00-general.md');
    expect(await readFile(path.join(homeB, 'rules', '00-general.md'), 'utf8')).toBe('Account rules\n');

    const deviceClient = new SyncClient('https://reglet.test', stateB.deviceToken, appFetch(restarted));
    const devices = await deviceClient.devices();
    const deviceA = devices.devices.find((device) => device.name === 'device-a');
    expect(deviceA).toBeDefined();
    await deviceClient.renameDevice(devices.currentDeviceId, 'device-b-renamed');
    expect((await deviceClient.devices()).devices.find((device) => device.id === devices.currentDeviceId)?.name).toBe(
      'device-b-renamed',
    );
    const rotatedToken = await deviceClient.rotateDeviceToken();
    const rotatedClient = new SyncClient('https://reglet.test', rotatedToken, appFetch(restarted));
    await expect(deviceClient.devices()).rejects.toThrow('401');
    await rotatedClient.revokeDevice(deviceA?.id ?? 0);
    await expect(syncOnce(homeA, appFetch(restarted))).rejects.toThrow('401');
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

  test('rejects malformed compatibility metadata, skipped cursors, and oversized responses', async () => {
    const malformed = new SyncClient(
      'https://sync.example.test',
      'token',
      (async () => Response.json({ protocol: { supported: [1] } })) as typeof fetch,
    );
    await expect(malformed.ensureCompatible()).rejects.toThrow('invalid compatibility metadata');

    const skipped = new SyncClient(
      'https://sync.example.test',
      'token',
      (async () => Response.json({
        changes: [{ path: 'rules/00-general.md', revision: 1, hash: 'hash', deleted: false, seq: 1 }],
        cursor: 2,
        hasMore: false,
      })) as typeof fetch,
    );
    await expect(skipped.changes(0)).rejects.toThrow('invalid changes response');

    const oversized = new SyncClient(
      'https://sync.example.test',
      'token',
      (async () => new Response('{}', { headers: { 'content-length': String(55 * 1024 * 1024) } })) as typeof fetch,
    );
    await expect(oversized.ensureCompatible()).rejects.toThrow('response is too large');
  });

  test('requires TLS except for loopback development servers', async () => {
    expect(() => new SyncClient('http://sync.example.test', 'token')).toThrow('requires HTTPS');
    expect(() => new SyncClient('http://localhost:3000', 'token')).not.toThrow();
    await expect(configureTokenLogin('http://sync.example.test', 'token', 'device')).rejects.toThrow('requires HTTPS');
  });

  test('rejects malicious server paths before mutating local files', async () => {
    const root = await tempDir('reglet-sync-malicious-');
    const home = path.join(root, 'home');
    const victim = path.join(root, 'victim.txt');
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await writeFile(victim, 'keep me');
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', home);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/compatibility')) {
        return Response.json({ service: { name: 'reglet-sync-server', version: '0.1.0' }, protocol: { current: 1, supported: [1] } });
      }
      if (url.includes('/v1/changes')) {
        return Response.json({
          changes: [{ path: 'rules/../../victim.txt', revision: 1, hash: '', deleted: true, seq: 1 }],
          cursor: 1,
          hasMore: false,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await expect(syncOnce(home, fetchImpl)).rejects.toThrow('unsafe Master path');
    expect(await readFile(victim, 'utf8')).toBe('keep me');
  });

  test('rejects a symbolic link at the exact remote write target', async () => {
    if (process.platform === 'win32') return;
    const root = await tempDir('reglet-sync-symlink-');
    const home = path.join(root, 'home');
    const victim = path.join(root, 'victim.txt');
    const target = path.join(home, 'rules', 'linked.md');
    const content = Buffer.from('remote content');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(victim, 'keep me');
    await symlink(victim, target);
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', home);
    const hash = sha256String(content);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/compatibility')) {
        return Response.json({ service: { name: 'reglet-sync-server', version: '0.1.0' }, protocol: { current: 1, supported: [1] } });
      }
      if (url.includes('/v1/changes')) {
        return Response.json({
          changes: [{ path: 'rules/linked.md', revision: 1, hash, deleted: false, seq: 1 }],
          cursor: 1,
          hasMore: false,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await expect(syncOnce(home, fetchImpl)).rejects.toThrow('symbolic-link path component');
    expect(await readFile(victim, 'utf8')).toBe('keep me');
  });

  test('rejects a symbolic-link sync base before uploading local content', async () => {
    if (process.platform === 'win32') return;
    await useTempProviderHome();
    const serverDb = path.join(await tempDir('reglet-sync-server-'), 'db.sqlite');
    const token = 'reglet-sync-test-token-123456';
    const app = useApp(createApp({ dbPath: serverDb, singleUserToken: token }));
    const fetchImpl = appFetch(app);
    const home = await tempDir('reglet-sync-base-link-');
    const outside = await tempDir('reglet-sync-base-outside-');
    await writeBasicMaster(home, 'Local rules\n');
    await configureTokenLogin('https://reglet.test', token, 'device-a', home);
    await symlink(outside, path.join(home, '.state', 'sync-base'));

    await expect(syncOnce(home, fetchImpl)).rejects.toThrow('symbolic-link path component');
    expect((await new SyncClient('https://reglet.test', token, fetchImpl).changes(0)).changes).toEqual([]);
  });

  test('rejects inconsistent remote hashes before writing content', async () => {
    const home = await tempDir('reglet-sync-hash-');
    const claimedHash = '0'.repeat(64);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', home);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/compatibility')) {
        return Response.json({ service: { name: 'reglet-sync-server', version: '0.1.0' }, protocol: { current: 1, supported: [1] } });
      }
      if (url.includes('/v1/changes')) {
        return Response.json({
          changes: [{ path: 'rules/00-general.md', revision: 1, hash: claimedHash, deleted: false, seq: 1 }],
          cursor: 1,
          hasMore: false,
        });
      }
      if (url.includes('/v1/files/')) {
        return Response.json({ revision: 1, hash: claimedHash, contentBase64: Buffer.from('tampered').toString('base64') });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await expect(syncOnce(home, fetchImpl)).rejects.toThrow('inconsistent remote content');
    await expect(stat(path.join(home, 'rules', '00-general.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('uses one strict path contract for shared and provider-scoped Master content', () => {
    expect(isAllowedSyncPath('rules/claude/.reglet-provider-overlay')).toBe(true);
    expect(isAllowedSyncPath('skills/codex/review/SKILL.md')).toBe(true);
    expect(isAllowedSyncPath('mcp/providers/claude/servers.json')).toBe(true);
    expect(isAllowedSyncPath('mcp/providers/unknown/servers.json')).toBe(false);
    expect(isAllowedSyncPath('rules/../../victim')).toBe(false);
    expect(isAllowedSyncPath('skills\\..\\victim')).toBe(false);
    expect(() => resolveSyncPath('/tmp/reglet-home', 'rules/../../victim')).toThrow('unsafe Master path');
  });

  test('writes sync state with owner-only permissions on POSIX', async () => {
    if (process.platform === 'win32') return;
    const home = await tempDir('reglet-sync-mode-');
    await configureTokenLogin('https://reglet.test', 'reglet-sync-test-token-123456', 'device-a', home);
    const statePath = path.join(home, '.state', 'sync.json');
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(statePath))).mode & 0o777).toBe(0o700);
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
