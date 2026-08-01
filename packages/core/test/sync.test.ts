import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type {
  LibraryArtifactMetadata,
  LibraryManifest,
} from '../src/artifacts/types.js';
import {
  mergeBinaryFile,
  mergeLibraryManifests,
  mergeTextFile,
} from '../src/sync/merge.js';
import { enumerateCanonicalSyncScope } from '../src/sync/scope.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

describe('sync merge rules', () => {
  test('merges independent metadata fields by stable artifact ID', () => {
    const baseArtifact = artifact();
    const base = manifest(baseArtifact);
    const ours = manifest({ ...baseArtifact, title: 'Our title' });
    const theirs = manifest({ ...baseArtifact, tags: ['remote'] });

    const merged = mergeLibraryManifests(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(merged.manifest.artifacts[0]).toMatchObject({
      id: baseArtifact.id,
      title: 'Our title',
      tags: ['remote'],
    });
  });

  test('reports competing renames and delete-versus-edit', () => {
    const baseArtifact = artifact();
    const rename = mergeLibraryManifests(
      manifest(baseArtifact),
      manifest({
        ...baseArtifact,
        slug: 'ours',
        locator: { type: 'file', path: 'rules/ours.md' },
      }),
      manifest({
        ...baseArtifact,
        slug: 'theirs',
        locator: { type: 'file', path: 'rules/theirs.md' },
      }),
    );
    const deleteEdit = mergeLibraryManifests(
      manifest(baseArtifact),
      { schemaVersion: 2, artifacts: [], tombstones: [] },
      manifest({ ...baseArtifact, title: 'Edited remotely' }),
    );

    expect(rename.conflicts.some((conflict) => conflict.code === 'rename-conflict')).toBe(
      true,
    );
    expect(deleteEdit.conflicts[0]?.code).toBe('delete-versus-edit');
    expect(deleteEdit.manifest.artifacts[0]?.title).toBe('Edited remotely');
  });

  test('merges non-overlapping text and preserves both binary variants on conflict', () => {
    const text = mergeTextFile(
      'one\ntwo\nthree\nfour\n',
      'ONE\ntwo\nthree\nfour\n',
      'one\ntwo\nthree\nFOUR\n',
      'rules/general.md',
    );
    const binary = mergeBinaryFile(
      Uint8Array.from([0]),
      Uint8Array.from([1]),
      Uint8Array.from([2]),
      'skills/example/image.png',
    );

    expect(text.clean).toBe(true);
    expect(text.content).toBe('ONE\ntwo\nthree\nFOUR\n');
    expect(binary.clean).toBe(false);
    expect(binary.variants).toHaveLength(2);
    expect(binary.conflicts[0]?.code).toBe('binary-conflict');
  });
});

describe('canonical sync scope', () => {
  test('excludes local state and reports oversized files without affecting local use', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-sync-'));
    await mkdir(path.join(currentHome, 'rules'), { recursive: true });
    await mkdir(path.join(currentHome, '.state', 'drafts'), { recursive: true });
    await writeFile(path.join(currentHome, 'rules', 'large.md'), '123456');
    await writeFile(path.join(currentHome, '.state', 'drafts', 'private'), 'draft');
    await writeFile(path.join(currentHome, 'library.json'), '{}');

    const scope = await enumerateCanonicalSyncScope(currentHome, 5);

    expect(scope.files.map((file) => file.relativePath)).toEqual([
      'library.json',
      path.join('rules', 'large.md'),
    ]);
    expect(scope.blockedFiles[0]?.relativePath).toBe(
      path.join('rules', 'large.md'),
    );
  });
});

function artifact(): LibraryArtifactMetadata {
  return {
    id: 'artifact-1',
    kind: 'instruction',
    lifecycle: 'active',
    slug: 'shared',
    title: 'Shared',
    tags: [],
    targets: ['claude'],
    locator: { type: 'file', path: 'rules/shared.md' },
  };
}

function manifest(artifactValue: LibraryArtifactMetadata): LibraryManifest {
  return {
    schemaVersion: 2,
    artifacts: [artifactValue],
    tombstones: [],
  };
}

