import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  newActiveSyncV2State,
  saveSyncV2State,
  sha256String,
} from '@reglet/core';
import { runConflictWebGui } from '../src/conflict-web.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

async function useTempHome(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-conflict-web-'));
  return currentHome;
}

describe('Ephemeral conflict web GUI', () => {
  test('returns immediately when there are no conflicts', async () => {
    const home = await useTempHome();
    let logged = '';
    const origLog = console.log;
    console.log = (msg: string) => { logged += msg + '\n'; };
    try {
      await runConflictWebGui({ openBrowser: false }, home);
    } finally {
      console.log = origLog;
    }
    expect(logged).toContain('No sync conflicts detected');
  });

  test('serves conflict API and resolves conflict via HTTP', async () => {
    const home = await useTempHome();

    const state = newActiveSyncV2State({
      serverUrl: 'https://sync.example',
      vaultId: 'vault',
      deviceId: 'device',
      deviceName: 'Mac',
      keyEpoch: 1,
      credentialId: 'credential',
    });

    const localPath = path.join(home, 'rules', '00-general.md');
    const conflictPath = path.join(home, 'rules', '00-general.conflict-Mac.md');
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, '# Local Rule\n');
    await writeFile(conflictPath, '# Remote Rule\n');

    state.files['rules/00-general.md'] = {
      objectId: 'obj-1',
      revision: 2,
      hash: sha256String('# Remote Rule\n'),
      conflicted: true,
    };
    await saveSyncV2State(state, home);

    // Capture the server URL from console.log
    let serverUrl = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      const match = msg.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);
      if (match) {
        serverUrl = match[0];
      }
    };

    const webGuiPromise = runConflictWebGui({ openBrowser: false }, home);

    // Wait for server to start
    for (let i = 0; i < 50; i++) {
      if (serverUrl.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log = origLog;

    expect(serverUrl).toContain('http://127.0.0.1:');
    const parsedUrl = new URL(serverUrl);
    const token = parsedUrl.searchParams.get('token')!;

    // 1. Fetch HTML page
    const htmlRes = await fetch(serverUrl);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('Reglet Conflict Resolver');

    // 2. Fetch API conflicts
    const apiRes = await fetch(`http://127.0.0.1:${parsedUrl.port}/api/conflicts?token=${token}`);
    expect(apiRes.status).toBe(200);
    const apiJson = (await apiRes.json()) as { conflicts: Array<{ canonicalPath: string; local: { content: string }; remote: { content: string } }> };
    expect(apiJson.conflicts.length).toBe(1);
    expect(apiJson.conflicts[0].canonicalPath).toBe('rules/00-general.md');
    expect(apiJson.conflicts[0].local.content).toContain('Local Rule');
    expect(apiJson.conflicts[0].remote.content).toContain('Remote Rule');

    // 3. Resolve conflict
    const resolveRes = await fetch(`http://127.0.0.1:${parsedUrl.port}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, path: 'rules/00-general.md', choice: 'ours' }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveJson = (await resolveRes.json()) as { success: boolean; remaining: number };
    expect(resolveJson.success).toBe(true);
    expect(resolveJson.remaining).toBe(0);

    // Wait for web GUI to shut down
    await webGuiPromise;
  });
});
