import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadManifest, purgeProviderBackups, saveManifest } from '../src/index.js';

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

describe('provider backup purge', () => {
  test('removes only one provider tree and detaches affected manifest outputs', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-backups-'));
    const codexBackup = path.join(home, '.state', 'backups', 'codex', 'revision', 'AGENTS.md');
    const claudeBackup = path.join(home, '.state', 'backups', 'claude', 'revision', 'CLAUDE.md');
    await mkdir(path.dirname(codexBackup), { recursive: true });
    await mkdir(path.dirname(claudeBackup), { recursive: true });
    await writeFile(codexBackup, 'codex');
    await writeFile(claudeBackup, 'claude');
    await saveManifest({ version: 1, outputs: {
      '/tmp/codex-output': { provider: 'codex', content: 'rules', hash: 'a', appliedAt: new Date().toISOString(), backedUpTo: codexBackup },
      '/tmp/claude-output': { provider: 'claude', content: 'rules', hash: 'b', appliedAt: new Date().toISOString(), backedUpTo: claudeBackup },
    } }, home);

    const result = await purgeProviderBackups('codex', home);
    const manifest = await loadManifest(home);

    expect(result.detachedOutputs).toEqual(['/tmp/codex-output']);
    expect(await Bun.file(codexBackup).exists()).toBe(false);
    expect(await Bun.file(claudeBackup).exists()).toBe(true);
    expect(manifest.outputs['/tmp/codex-output']?.backedUpTo).toBeNull();
    expect(manifest.outputs['/tmp/claude-output']?.backedUpTo).toBe(claudeBackup);
  });
});
