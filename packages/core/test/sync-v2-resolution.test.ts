import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { newActiveSyncV2State, resolveSyncV2Conflict, saveSyncV2State } from '../src/index.js';

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

describe('encrypted sync conflict resolution', () => {
  test('keeps either local or encrypted remote content only after an explicit choice', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-sync-resolution-'));
    const localPath = path.join(home, 'rules', 'general.md');
    const conflictPath = path.join(home, 'rules', 'general.conflict-Mac.md');
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, 'local\n');
    await writeFile(conflictPath, 'remote\n');
    const state = newActiveSyncV2State({
      serverUrl: 'https://sync.example',
      vaultId: 'vault',
      deviceId: 'device',
      deviceName: 'Mac',
      keyEpoch: 1,
      credentialId: 'credential',
    });
    state.files['rules/general.md'] = { objectId: 'object', revision: 2, hash: 'remote-hash', conflicted: true };
    await saveSyncV2State(state, home);

    await resolveSyncV2Conflict('rules/general.md', 'theirs', home);

    expect(await Bun.file(localPath).text()).toBe('remote\n');
    expect(await Bun.file(conflictPath).exists()).toBe(false);
  });
});
