import { describe, expect, test } from 'bun:test';
import { tryMergeLibraryManifestText, type LibraryManifest } from '../src/index.js';

const artifact = {
  id: 'stable-id',
  kind: 'instruction' as const,
  lifecycle: 'active' as const,
  scope: { kind: 'global' as const },
  slug: 'general',
  title: 'General',
  tags: [],
  targets: ['codex' as const],
  locator: { type: 'file' as const, path: 'rules/general.md' },
};

function bytes(manifest: LibraryManifest): Uint8Array {
  return Buffer.from(JSON.stringify(manifest));
}

function manifest(overrides: Partial<typeof artifact> = {}): LibraryManifest {
  return { schemaVersion: 2, artifacts: [{ ...artifact, ...overrides }], tombstones: [] };
}

describe('library manifest merge', () => {
  test('merges independent fields by stable artifact ID', () => {
    const merged = tryMergeLibraryManifestText(
      bytes(manifest()),
      bytes(manifest({ title: 'General guidance' })),
      bytes(manifest({ tags: ['shared'] })),
    );
    expect(merged).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(merged ?? []).toString('utf8')) as LibraryManifest;
    expect(parsed.artifacts[0]).toMatchObject({ id: 'stable-id', title: 'General guidance', tags: ['shared'] });
  });

  test('requires resolution for concurrent rename and delete-versus-edit', () => {
    expect(tryMergeLibraryManifestText(
      bytes(manifest()),
      bytes(manifest({ slug: 'local-name', locator: { type: 'file', path: 'rules/local-name.md' } })),
      bytes(manifest({ slug: 'remote-name', locator: { type: 'file', path: 'rules/remote-name.md' } })),
    )).toBeNull();
    const deleted: LibraryManifest = { schemaVersion: 2, artifacts: [], tombstones: [{
      id: artifact.id,
      kind: artifact.kind,
      slug: artifact.slug,
      deletedAt: '2026-07-31T00:00:00.000Z',
      recoverableUntil: '2026-08-30T00:00:00.000Z',
      locator: artifact.locator,
    }] };
    expect(tryMergeLibraryManifestText(
      bytes(manifest()),
      bytes(deleted),
      bytes(manifest({ title: 'Edited remotely' })),
    )).toBeNull();
  });
});
