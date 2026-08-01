import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  RegletApplication,
  applyAll,
  defaultConfig,
  readArtifactText,
  resolveCanonicalSyncConflict,
  saveConfig,
  syncCanonicalLibrary,
} from '@reglet/core';
import { createSyncApp } from '../src/sync.js';

const token = 'test-sync-token-with-enough-entropy';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  delete process.env.REGLET_PROVIDER_HOME;
});

describe('canonical sync server', () => {
  test('authenticates snapshots and rejects stale revisions', async () => {
    const dataDirectory = await temporaryDirectory('reglet-sync-server-');
    const app = createSyncApp({ dataDirectory, token });
    const content = Buffer.from('# Canonical\n');
    const file = {
      path: 'rules/canonical.md',
      hash: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
      contentBase64: content.toString('base64'),
    };

    expect((await app.request('/v1/sync/snapshot')).status).toBe(401);
    const first = await app.request('/v1/sync/snapshot', {
      method: 'PUT',
      headers: authorizationHeaders(),
      body: JSON.stringify({ baseRevision: 0, files: [file] }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ revision: 1 });

    const stale = await app.request('/v1/sync/snapshot', {
      method: 'PUT',
      headers: authorizationHeaders(),
      body: JSON.stringify({ baseRevision: 0, files: [] }),
    });
    expect(stale.status).toBe(409);

    const snapshot = await app.request('/v1/sync/snapshot', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await snapshot.json()).toMatchObject({
      revision: 1,
      files: [{ path: 'rules/canonical.md' }],
    });
  });
});

describe('canonical sync client', () => {
  test('syncs clean files, retains conflicts, and resolves a selected variant', async () => {
    const dataDirectory = await temporaryDirectory('reglet-sync-server-');
    const homeA = await temporaryDirectory('reglet-sync-a-');
    const homeB = await temporaryDirectory('reglet-sync-b-');
    const providerHome = await temporaryDirectory('reglet-sync-providers-');
    process.env.REGLET_PROVIDER_HOME = providerHome;
    const app = createSyncApp({ dataDirectory, token });
    const fetcher = appFetch(app);
    const applicationA = new RegletApplication(homeA);
    const applicationB = new RegletApplication(homeB);
    await applicationA.execute({ type: 'initialize' });
    await applicationB.execute({ type: 'initialize' });
    const created = await applicationA.execute({
      type: 'library.create',
      kind: 'instruction',
      slug: 'shared-sync',
      title: 'Shared sync',
      content: '# Shared\n\nBase.\n',
      targets: ['claude'],
    });
    const artifactId = (created.data as { id: string }).id;

    expect(
      (
        await syncCanonicalLibrary({
          home: homeA,
          serverUrl: 'http://127.0.0.1:4766',
          token,
          fetch: fetcher,
        })
      ).state,
    ).toBe('synced');
    expect(
      (
        await syncCanonicalLibrary({
          home: homeB,
          serverUrl: 'http://127.0.0.1:4766',
          token,
          fetch: fetcher,
        })
      ).state,
    ).toBe('synced');
    expect(await readArtifactText(artifactId, homeB)).toContain('Base.');

    await applicationA.execute({
      type: 'library.save',
      artifact: artifactId,
      content: '# Shared\n\nMachine A.\n',
    });
    await applicationB.execute({
      type: 'library.save',
      artifact: artifactId,
      content: '# Shared\n\nMachine B.\n',
    });
    await syncCanonicalLibrary({
      home: homeA,
      serverUrl: 'http://127.0.0.1:4766',
      token,
      fetch: fetcher,
    });
    const conflicted = await syncCanonicalLibrary({
      home: homeB,
      serverUrl: 'http://127.0.0.1:4766',
      token,
      fetch: fetcher,
    });
    expect(conflicted.state).toBe('conflict');
    expect(conflicted.conflicts[0]?.path).toBe('rules/shared-sync.md');
    expect(await readArtifactText(artifactId, homeB)).toContain('Machine B.');

    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, homeB);
    const blockedApply = await applyAll({
      providers: ['claude'],
      contents: ['rules'],
      home: homeB,
    });
    expect(blockedApply.results[0]?.status).toBe('blocked');
    expect(blockedApply.results[0]?.issues?.[0]?.code).toBe('sync-conflict');

    await resolveCanonicalSyncConflict(
      'rules/shared-sync.md',
      'theirs',
      homeB,
    );
    expect(await readArtifactText(artifactId, homeB)).toContain('Machine A.');
  });

  test('reports oversized files without uploading or blocking local use', async () => {
    const dataDirectory = await temporaryDirectory('reglet-sync-server-');
    const home = await temporaryDirectory('reglet-sync-large-');
    const app = createSyncApp({ dataDirectory, token, fileLimitBytes: 5 });
    const application = new RegletApplication(home);
    await application.execute({ type: 'initialize' });

    const status = await syncCanonicalLibrary({
      home,
      serverUrl: 'http://127.0.0.1:4766',
      token,
      fetch: appFetch(app),
      fileLimitBytes: 5,
    });

    expect(status.state).toBe('blocked');
    expect(status.blockedFiles.length).toBeGreaterThan(0);
    expect(await readFile(path.join(home, 'library.json'), 'utf8')).toContain(
      '"schemaVersion": 2',
    );
  });
});

function authorizationHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function appFetch(app: ReturnType<typeof createSyncApp>): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return app.request(request);
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
