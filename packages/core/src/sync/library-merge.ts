import type {
  DeletedArtifactTombstone,
  LibraryArtifactMetadata,
  LibraryManifest,
} from '../artifacts/types.js';
import { parseLibraryManifest } from '../artifacts/library.js';

type LibraryEntity =
  | { type: 'artifact'; value: LibraryArtifactMetadata }
  | { type: 'tombstone'; value: DeletedArtifactTombstone };

/** Three-way merges schema-v2 metadata by stable artifact ID. */
export function tryMergeLibraryManifestText(
  baseContent: Uint8Array | null,
  localContent: Uint8Array,
  remoteContent: Uint8Array,
): Uint8Array | null {
  let base: LibraryManifest;
  let local: LibraryManifest;
  let remote: LibraryManifest;
  try {
    base = baseContent === null
      ? { schemaVersion: 2, artifacts: [], tombstones: [] }
      : parseLibraryManifest(JSON.parse(Buffer.from(baseContent).toString('utf8')) as unknown);
    local = parseLibraryManifest(JSON.parse(Buffer.from(localContent).toString('utf8')) as unknown);
    remote = parseLibraryManifest(JSON.parse(Buffer.from(remoteContent).toString('utf8')) as unknown);
  } catch {
    return null;
  }
  const baseEntities = entityMap(base);
  const localEntities = entityMap(local);
  const remoteEntities = entityMap(remote);
  const ids = [...new Set([...baseEntities.keys(), ...localEntities.keys(), ...remoteEntities.keys()])].sort();
  const merged: LibraryEntity[] = [];
  for (const id of ids) {
    const entity = mergeEntity(baseEntities.get(id), localEntities.get(id), remoteEntities.get(id));
    if (entity === false) return null;
    if (entity !== undefined) merged.push(entity);
  }
  const manifest: LibraryManifest = {
    schemaVersion: 2,
    artifacts: merged.flatMap((entity) => entity.type === 'artifact' ? [entity.value] : []),
    tombstones: merged.flatMap((entity) => entity.type === 'tombstone' ? [entity.value] : []),
  };
  try {
    const validated = parseLibraryManifest(manifest);
    return Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  } catch {
    return null;
  }
}

function entityMap(manifest: LibraryManifest): Map<string, LibraryEntity> {
  const entities = new Map<string, LibraryEntity>();
  for (const value of manifest.artifacts) entities.set(value.id, { type: 'artifact', value });
  for (const value of manifest.tombstones) entities.set(value.id, { type: 'tombstone', value });
  return entities;
}

function mergeEntity(
  base: LibraryEntity | undefined,
  local: LibraryEntity | undefined,
  remote: LibraryEntity | undefined,
): LibraryEntity | undefined | false {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (local === undefined || remote === undefined || local.type !== remote.type || (base !== undefined && base.type !== local.type)) {
    return false;
  }
  const merged = mergeRecord(base?.value, local.value, remote.value);
  return merged === null ? false : { type: local.type, value: merged } as LibraryEntity;
}

function mergeRecord<Value extends LibraryArtifactMetadata | DeletedArtifactTombstone>(
  base: Value | undefined,
  local: Value,
  remote: Value,
): Value | null {
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})])) {
    const merged = mergeField(base?.[key as keyof Value], local[key as keyof Value], remote[key as keyof Value]);
    if (merged === conflict) return null;
    if (merged !== undefined) result[key] = merged;
  }
  return result as Value;
}

const conflict = Symbol('library-merge-conflict');

function mergeField(base: unknown, local: unknown, remote: unknown): unknown | typeof conflict {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  return conflict;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
