import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  inspectSyncV2Conflict,
  listSyncV2Conflicts,
  newActiveSyncV2State,
  resolveSyncV2Conflict,
  saveSyncV2State,
  sha256String,
} from '../src/index.js';

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
    state.files['rules/general.md'] = { objectId: 'object', revision: 2, hash: sha256String('remote\n'), conflicted: true };
    await saveSyncV2State(state, home);

    expect(await inspectSyncV2Conflict('rules/general.md', home)).toEqual({
      version: 1,
      path: 'rules/general.md',
      local: { state: 'text', content: 'local\n', size: 6, hash: sha256String('local\n') },
      remote: { state: 'text', content: 'remote\n', size: 7, hash: sha256String('remote\n') },
    });

    await resolveSyncV2Conflict('rules/general.md', 'theirs', home);

    expect(await Bun.file(localPath).text()).toBe('remote\n');
    expect(await Bun.file(conflictPath).exists()).toBe(false);
  });

  test('refuses a changed remote conflict copy', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-sync-resolution-tamper-'));
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
    state.files['rules/general.md'] = { objectId: 'object', revision: 2, hash: sha256String('remote\n'), conflicted: true };
    await saveSyncV2State(state, home);
    await writeFile(conflictPath, 'changed\n');

    await expect(inspectSyncV2Conflict('rules/general.md', home)).rejects.toThrow('changed after sync');
    await expect(resolveSyncV2Conflict('rules/general.md', 'theirs', home)).rejects.toThrow('changed after sync');
    expect(await Bun.file(localPath).text()).toBe('local\n');
  });

  test('lists conflicts and resolves using conflict artifact path', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-sync-list-conflicts-'));
    const localPath = path.join(home, 'rules', 'general.md');
    const conflictPath = path.join(home, 'rules', 'general.conflict-Mac.md');
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, 'local content\n');
    await writeFile(conflictPath, 'remote content\n');
    const state = newActiveSyncV2State({
      serverUrl: 'https://sync.example',
      vaultId: 'vault',
      deviceId: 'device',
      deviceName: 'Mac',
      keyEpoch: 1,
      credentialId: 'credential',
    });
    state.files['rules/general.md'] = { objectId: 'object', revision: 2, hash: sha256String('remote content\n'), conflicted: true };
    await saveSyncV2State(state, home);

    const conflicts = await listSyncV2Conflicts(home);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.canonicalPath).toBe('rules/general.md');

    // Resolving using the conflict artifact path (rules/general.conflict-Mac.md)
    await resolveSyncV2Conflict('rules/general.conflict-Mac.md', 'ours', home);
    expect(await Bun.file(localPath).text()).toBe('local content\n');
    expect(await Bun.file(conflictPath).exists()).toBe(false);
    expect(await listSyncV2Conflicts(home)).toHaveLength(0);
  });
});
