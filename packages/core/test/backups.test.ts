import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  loadManifest,
  previewPurgeProviderBackups,
  purgeProviderBackups,
  purgeReviewedProviderBackups,
  saveManifest,
} from '../src/index.js';

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

  test('binds backup purge to the exact private tree and manifest references', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-backups-'));
    const backup = path.join(home, '.state', 'backups', 'codex', 'revision', 'AGENTS.md');
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, 'first backup');
    await saveManifest({ version: 1, outputs: {
      '/tmp/codex-output': {
        provider: 'codex',
        content: 'rules',
        hash: 'a',
        appliedAt: new Date().toISOString(),
        backedUpTo: backup,
      },
    } }, home);

    const preview = await previewPurgeProviderBackups('codex', home);
    expect(preview).toMatchObject({
      provider: 'codex',
      backup: { kind: 'directory' },
      detachedOutputs: ['/tmp/codex-output'],
    });
    await writeFile(backup, 'changed after review');
    await expect(purgeReviewedProviderBackups('codex', preview.digest, home)).rejects.toThrow('preview is stale');
    expect(await Bun.file(backup).exists()).toBe(true);
    expect((await loadManifest(home)).outputs['/tmp/codex-output']?.backedUpTo).toBe(backup);

    const refreshed = await previewPurgeProviderBackups('codex', home);
    expect(await purgeReviewedProviderBackups('codex', refreshed.digest, home)).toEqual({
      provider: 'codex',
      removed: true,
      detachedOutputs: ['/tmp/codex-output'],
    });
  });

  test('refuses a symbolic-link provider backup root', async () => {
    if (process.platform === 'win32') return;
    home = await mkdtemp(path.join(tmpdir(), 'reglet-backups-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'reglet-backups-outside-'));
    const backupRoot = path.join(home, '.state', 'backups', 'codex');
    await mkdir(path.dirname(backupRoot), { recursive: true });
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    await symlink(outside, backupRoot);

    await expect(previewPurgeProviderBackups('codex', home)).rejects.toThrow('symlink');
    expect(await Bun.file(path.join(outside, 'keep.txt')).exists()).toBe(true);
    await rm(outside, { recursive: true, force: true });
  });
});
