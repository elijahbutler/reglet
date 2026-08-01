import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  deleteDraft,
  duplicateLibraryArtifact,
  listArtifactHistory,
  loadDraft,
  loadLibraryManifest,
  migrateLibraryToV2,
  permanentlyDeleteArtifact,
  renameLibraryArtifact,
  restoreArtifactRevision,
  saveDraft,
  setArtifactLifecycle,
} from '../src/artifacts/library.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

async function createLegacyLibrary(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-library-v2-'));
  await mkdir(path.join(currentHome, 'rules'), { recursive: true });
  await mkdir(path.join(currentHome, 'skills', 'review-code'), { recursive: true });
  await mkdir(path.join(currentHome, 'mcp'), { recursive: true });
  await writeFile(path.join(currentHome, 'rules', 'general.md'), '# General\n');
  await writeFile(
    path.join(currentHome, 'skills', 'review-code', 'SKILL.md'),
    '---\nname: review-code\ndescription: Review code\n---\n',
  );
  await writeFile(
    path.join(currentHome, 'mcp', 'servers.json'),
    `${JSON.stringify({ mcpServers: { local: { command: 'node' } } }, null, 2)}\n`,
  );
  return currentHome;
}

describe('schema v2 library', () => {
  test('migrates idempotently with stable IDs', async () => {
    const home = await createLegacyLibrary();
    const first = await migrateLibraryToV2(home);
    const second = await migrateLibraryToV2(home);

    expect(first.artifacts).toHaveLength(3);
    expect(second).toEqual(first);
    expect(new Set(first.artifacts.map((artifact) => artifact.id)).size).toBe(3);
  });

  test('duplicates, renames, archives, drafts, and deletes safely', async () => {
    const home = await createLegacyLibrary();
    const manifest = await migrateLibraryToV2(home);
    const instruction = manifest.artifacts.find((artifact) => artifact.kind === 'instruction');
    expect(instruction).toBeDefined();
    if (instruction === undefined) {
      throw new Error('Fixture instruction missing');
    }

    instruction.targets = ['claude'];
    const duplicate = await duplicateLibraryArtifact(instruction.id, home);
    expect(duplicate.slug).toBe('general-copy');
    expect(duplicate.targets).toEqual([]);

    const renamed = await renameLibraryArtifact(duplicate.id, 'portable-guidance', home);
    expect(renamed.id).toBe(duplicate.id);
    expect(await readFile(path.join(home, 'rules', 'portable-guidance.md'), 'utf8')).toBe(
      '# General\n',
    );

    await setArtifactLifecycle(renamed.id, 'archived', home);
    expect(
      (await loadLibraryManifest(home)).artifacts.find(
        (artifact) => artifact.id === renamed.id,
      )?.lifecycle,
    ).toBe('archived');

    await saveDraft(
      renamed.id,
      '---\ninvalid',
      [{ code: 'frontmatter-invalid', message: 'Frontmatter is incomplete.' }],
      home,
    );
    expect((await loadDraft(renamed.id, home))?.content).toBe('---\ninvalid');
    await deleteDraft(renamed.id, home);
    expect(await loadDraft(renamed.id, home)).toBeUndefined();

    const tombstone = await permanentlyDeleteArtifact(renamed.id, home);
    expect(tombstone.id).toBe(renamed.id);
    expect(
      (await loadLibraryManifest(home)).artifacts.some(
        (artifact) => artifact.id === renamed.id,
      ),
    ).toBe(false);
    expect(await listArtifactHistory(renamed.id, home)).not.toHaveLength(0);
    const restored = await restoreArtifactRevision(renamed.id, undefined, home);
    expect(restored.id).toBe(renamed.id);
    expect(await readFile(path.join(home, 'rules', 'portable-guidance.md'), 'utf8')).toBe(
      '# General\n',
    );
    expect(
      (await loadLibraryManifest(home)).tombstones.some(
        (candidate) => candidate.id === renamed.id,
      ),
    ).toBe(false);
  });
});
