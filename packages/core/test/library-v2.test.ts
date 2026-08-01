import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  applyLibraryMigration,
  deleteDraft,
  duplicateLibraryArtifact,
  libraryMigrationStatus,
  listArtifactHistory,
  loadDraft,
  loadLibraryManifest,
  permanentlyDeleteArtifact,
  previewLibraryMigration,
  renameLibraryArtifact,
  rollbackLibraryMigration,
  restoreArtifactRevision,
  saveDraft,
  setArtifactLifecycle,
} from '../src/artifacts/library.js';
import { defaultConfig, saveConfig } from '../src/config.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

async function createLegacyLibrary(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-library-v2-'));
  await mkdir(path.join(currentHome, 'rules', 'codex'), { recursive: true });
  await mkdir(path.join(currentHome, 'skills', 'review-code'), { recursive: true });
  await mkdir(path.join(currentHome, 'skills', 'claude', 'review-code'), { recursive: true });
  await mkdir(path.join(currentHome, 'mcp', 'providers', 'cursor'), { recursive: true });
  await writeFile(path.join(currentHome, 'rules', 'general.md'), '# General\n');
  await writeFile(path.join(currentHome, 'rules', 'codex', '.reglet-provider-overlay'), '');
  await writeFile(path.join(currentHome, 'rules', 'codex', 'general.md'), '# Codex overlay\n');
  await writeFile(
    path.join(currentHome, 'skills', 'review-code', 'SKILL.md'),
    '---\nname: review-code\ndescription: Review code\n---\n',
  );
  await writeFile(
    path.join(currentHome, 'skills', 'claude', 'review-code', 'SKILL.md'),
    '---\nname: review-code\ndescription: Claude review\n---\n',
  );
  await writeFile(
    path.join(currentHome, 'mcp', 'servers.json'),
    `${JSON.stringify({ mcpServers: { local: { command: 'node' } } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(currentHome, 'mcp', 'providers', 'cursor', 'servers.json'),
    `${JSON.stringify({ mcpServers: { local: { command: 'bun' } } }, null, 2)}\n`,
  );
  const config = defaultConfig();
  config.providers.claude = { enabled: true, rules: true, skills: true, mcp: true };
  config.providers.codex = { enabled: true, rules: true, skills: true, mcp: true };
  config.providers.cursor = { enabled: true, rules: true, skills: true, mcp: true };
  config.contentSync.skills['review-code'] = ['claude', 'codex'];
  config.contentSync.mcp.local = ['cursor'];
  await saveConfig(config, currentHome);
  return currentHome;
}

describe('schema v2 library migration', () => {
  test('previews without writes, preserves stable IDs, maps overlays, and applies idempotently', async () => {
    const home = await createLegacyLibrary();
    const originalRule = await readFile(path.join(home, 'rules', 'general.md'), 'utf8');
    const firstPreview = await previewLibraryMigration(home);
    const secondPreview = await previewLibraryMigration(home);

    expect(firstPreview.required).toBe(true);
    expect(firstPreview).toEqual(secondPreview);
    expect(firstPreview.artifacts).toHaveLength(6);
    expect(await Bun.file(path.join(home, 'library.json')).exists()).toBe(false);
    expect(new Set(firstPreview.artifacts.map((item) => item.artifact.id)).size).toBe(6);

    const globalSkill = firstPreview.artifacts.find(
      (item) => item.artifact.kind === 'skill' && item.artifact.scope.kind === 'global',
    )?.artifact;
    expect(globalSkill?.targets).toEqual(['claude', 'codex']);
    const overlaySkill = firstPreview.artifacts.find(
      (item) => item.artifact.kind === 'skill' && item.artifact.scope.kind === 'provider-overlay',
    )?.artifact;
    expect(overlaySkill?.scope).toEqual({ kind: 'provider-overlay', provider: 'claude' });
    expect(overlaySkill?.targets).toEqual(['claude']);

    const receipt = await applyLibraryMigration({ home, previewDigest: firstPreview.digest, yes: true });
    const repeated = await applyLibraryMigration({ home, previewDigest: firstPreview.digest, yes: true });
    expect(repeated).toEqual(receipt);
    expect((await loadLibraryManifest(home)).artifacts).toHaveLength(6);
    expect(await readFile(path.join(home, 'rules', 'general.md'), 'utf8')).toBe(originalRule);
    expect((await libraryMigrationStatus(home)).state).toBe('applied');
    expect(receipt.metadataBackupPath).not.toBeNull();
    expect(receipt.reversible).toBe(true);
  });

  test('requires approval and rejects a stale preview', async () => {
    const home = await createLegacyLibrary();
    const preview = await previewLibraryMigration(home);
    await expect(applyLibraryMigration({ home, previewDigest: preview.digest, yes: false })).rejects.toThrow('explicit approval');
    await writeFile(path.join(home, 'rules', 'new-rule.md'), '# New\n');
    await expect(applyLibraryMigration({ home, previewDigest: preview.digest, yes: true })).rejects.toThrow('stale');
    expect(await Bun.file(path.join(home, 'library.json')).exists()).toBe(false);
  });

  test('rolls metadata back without touching canonical content', async () => {
    const home = await createLegacyLibrary();
    const sourcePath = path.join(home, 'rules', 'general.md');
    const source = await readFile(sourcePath, 'utf8');
    const preview = await previewLibraryMigration(home);
    const receipt = await applyLibraryMigration({ home, previewDigest: preview.digest, yes: true });

    await rollbackLibraryMigration(receipt, home);

    expect(await Bun.file(path.join(home, 'library.json')).exists()).toBe(false);
    expect(await readFile(sourcePath, 'utf8')).toBe(source);
    expect((await libraryMigrationStatus(home)).state).toBe('available');
  });
});

describe('schema v2 artifact lifecycle', () => {
  test('duplicates, renames, archives, persists drafts, tombstones, and restores history', async () => {
    const home = await createLegacyLibrary();
    const preview = await previewLibraryMigration(home);
    await applyLibraryMigration({ home, previewDigest: preview.digest, yes: true });
    const manifest = await loadLibraryManifest(home);
    const instruction = manifest.artifacts.find(
      (artifact) => artifact.kind === 'instruction' && artifact.scope.kind === 'global',
    );
    if (instruction === undefined) throw new Error('Fixture instruction missing');

    const duplicate = await duplicateLibraryArtifact(instruction.id, home);
    expect(duplicate.slug).toBe('general-copy');
    expect(duplicate.targets).toEqual([]);
    expect(duplicate.id).not.toBe(instruction.id);

    const renamed = await renameLibraryArtifact(duplicate.id, 'portable-guidance', home);
    expect(renamed.id).toBe(duplicate.id);
    expect(await readFile(path.join(home, 'rules', 'portable-guidance.md'), 'utf8')).toBe('# General\n');

    await setArtifactLifecycle(renamed.id, 'archived', home);
    expect((await loadLibraryManifest(home)).artifacts.find((artifact) => artifact.id === renamed.id)?.lifecycle).toBe('archived');

    await saveDraft(renamed.id, '---\ninvalid', [{ code: 'frontmatter-invalid', message: 'Frontmatter is incomplete.' }], home);
    expect((await loadDraft(renamed.id, home))?.content).toBe('---\ninvalid');
    await deleteDraft(renamed.id, home);
    expect(await loadDraft(renamed.id, home)).toBeUndefined();

    const tombstone = await permanentlyDeleteArtifact(renamed.id, home);
    expect(new Date(tombstone.recoverableUntil).getTime()).toBeGreaterThan(new Date(tombstone.deletedAt).getTime());
    expect((await loadLibraryManifest(home)).artifacts.some((artifact) => artifact.id === renamed.id)).toBe(false);
    expect(await listArtifactHistory(renamed.id, home)).not.toHaveLength(0);

    const restored = await restoreArtifactRevision(renamed.id, undefined, home);
    expect(restored.id).toBe(renamed.id);
    expect(await readFile(path.join(home, 'rules', 'portable-guidance.md'), 'utf8')).toBe('# General\n');
    expect((await loadLibraryManifest(home)).tombstones.some((candidate) => candidate.id === renamed.id)).toBe(false);
  });
});
