import type {
  DeletedArtifactTombstone,
  LibraryArtifactMetadata,
  LibraryManifest,
} from '../artifacts/types.js';

export type SyncConflictCode =
  | 'same-field-edit'
  | 'rename-conflict'
  | 'delete-versus-edit'
  | 'concurrent-create'
  | 'text-conflict'
  | 'binary-conflict';

export interface SyncConflict {
  code: SyncConflictCode;
  artifactId?: string;
  path?: string;
  field?: string;
  message: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}

export interface LibraryMergeResult {
  manifest: LibraryManifest;
  conflicts: SyncConflict[];
}

export interface TextMergeResult {
  content: string;
  clean: boolean;
  conflicts: SyncConflict[];
}

export interface BinaryMergeResult {
  clean: boolean;
  selected?: Uint8Array;
  variants: Array<{ label: 'ours' | 'theirs'; content: Uint8Array }>;
  conflicts: SyncConflict[];
}

export function mergeLibraryManifests(
  base: LibraryManifest,
  ours: LibraryManifest,
  theirs: LibraryManifest,
): LibraryMergeResult {
  const conflicts: SyncConflict[] = [];
  const baseById = byArtifactId(base.artifacts);
  const oursById = byArtifactId(ours.artifacts);
  const theirsById = byArtifactId(theirs.artifacts);
  const ids = new Set([
    ...baseById.keys(),
    ...oursById.keys(),
    ...theirsById.keys(),
  ]);
  const artifacts: LibraryArtifactMetadata[] = [];
  for (const id of [...ids].sort()) {
    const merged = mergeArtifact(
      id,
      baseById.get(id),
      oursById.get(id),
      theirsById.get(id),
      conflicts,
    );
    if (merged !== undefined) {
      artifacts.push(merged);
    }
  }
  artifacts.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.slug.localeCompare(right.slug),
  );
  return {
    manifest: {
      schemaVersion: 2,
      artifacts,
      tombstones: mergeTombstones(base.tombstones, ours.tombstones, theirs.tombstones),
    },
    conflicts,
  };
}

export function mergeTextFile(
  base: string,
  ours: string,
  theirs: string,
  filePath?: string,
): TextMergeResult {
  if (ours === theirs) {
    return { content: ours, clean: true, conflicts: [] };
  }
  if (ours === base) {
    return { content: theirs, clean: true, conflicts: [] };
  }
  if (theirs === base) {
    return { content: ours, clean: true, conflicts: [] };
  }

  const baseLines = splitLines(base);
  const ourChange = singleChange(baseLines, splitLines(ours));
  const theirChange = singleChange(baseLines, splitLines(theirs));
  if (
    ourChange !== undefined &&
    theirChange !== undefined &&
    changesDoNotOverlap(ourChange, theirChange)
  ) {
    const ordered = [ourChange, theirChange].sort(
      (left, right) => right.start - left.start,
    );
    const merged = [...baseLines];
    for (const change of ordered) {
      merged.splice(change.start, change.deleteCount, ...change.insert);
    }
    return { content: merged.join(''), clean: true, conflicts: [] };
  }

  const conflict: SyncConflict = {
    code: 'text-conflict',
    path: filePath,
    message: 'Both machines changed overlapping text.',
    base,
    ours,
    theirs,
  };
  return {
    content: ours,
    clean: false,
    conflicts: [conflict],
  };
}

export function mergeBinaryFile(
  base: Uint8Array,
  ours: Uint8Array,
  theirs: Uint8Array,
  filePath?: string,
): BinaryMergeResult {
  if (bytesEqual(ours, theirs)) {
    return { clean: true, selected: ours, variants: [], conflicts: [] };
  }
  if (bytesEqual(ours, base)) {
    return { clean: true, selected: theirs, variants: [], conflicts: [] };
  }
  if (bytesEqual(theirs, base)) {
    return { clean: true, selected: ours, variants: [], conflicts: [] };
  }
  return {
    clean: false,
    variants: [
      { label: 'ours', content: ours },
      { label: 'theirs', content: theirs },
    ],
    conflicts: [
      {
        code: 'binary-conflict',
        path: filePath,
        message: 'Both machines changed a binary asset; both variants were preserved.',
      },
    ],
  };
}

function mergeArtifact(
  id: string,
  base: LibraryArtifactMetadata | undefined,
  ours: LibraryArtifactMetadata | undefined,
  theirs: LibraryArtifactMetadata | undefined,
  conflicts: SyncConflict[],
): LibraryArtifactMetadata | undefined {
  if (ours === undefined && theirs === undefined) {
    return undefined;
  }
  if (base !== undefined && ours === undefined && theirs !== undefined) {
    if (!deepEqual(base, theirs)) {
      conflicts.push({
        code: 'delete-versus-edit',
        artifactId: id,
        message: 'One machine deleted this artifact while another edited it.',
        base,
        ours,
        theirs,
      });
      return theirs;
    }
    return undefined;
  }
  if (base !== undefined && theirs === undefined && ours !== undefined) {
    if (!deepEqual(base, ours)) {
      conflicts.push({
        code: 'delete-versus-edit',
        artifactId: id,
        message: 'One machine deleted this artifact while another edited it.',
        base,
        ours,
        theirs,
      });
      return ours;
    }
    return undefined;
  }
  if (ours === undefined) {
    return cloneArtifact(theirs!);
  }
  if (theirs === undefined) {
    return cloneArtifact(ours);
  }
  if (deepEqual(ours, theirs)) {
    return cloneArtifact(ours);
  }
  if (base === undefined) {
    conflicts.push({
      code: 'concurrent-create',
      artifactId: id,
      message: 'Two machines created different artifacts with the same stable ID.',
      ours,
      theirs,
    });
  }

  const result = cloneArtifact(base ?? ours);
  const fields: Array<keyof LibraryArtifactMetadata> = [
    'kind',
    'lifecycle',
    'slug',
    'title',
    'description',
    'tags',
    'targets',
    'locator',
  ];
  for (const field of fields) {
    const merged = mergeField(
      id,
      field,
      base?.[field],
      ours[field],
      theirs[field],
      conflicts,
    );
    assignArtifactField(result, field, merged);
  }
  return result;
}

function mergeField(
  artifactId: string,
  field: keyof LibraryArtifactMetadata,
  base: unknown,
  ours: unknown,
  theirs: unknown,
  conflicts: SyncConflict[],
): unknown {
  if (deepEqual(ours, theirs)) {
    return structuredClone(ours);
  }
  if (deepEqual(ours, base)) {
    return structuredClone(theirs);
  }
  if (deepEqual(theirs, base)) {
    return structuredClone(ours);
  }
  conflicts.push({
    code:
      field === 'slug' || field === 'locator'
        ? 'rename-conflict'
        : 'same-field-edit',
    artifactId,
    field,
    message:
      field === 'slug' || field === 'locator'
        ? 'Both machines moved or renamed this artifact differently.'
        : `Both machines changed "${field}".`,
    base,
    ours,
    theirs,
  });
  return structuredClone(ours);
}

function assignArtifactField(
  artifact: LibraryArtifactMetadata,
  field: keyof LibraryArtifactMetadata,
  value: unknown,
): void {
  switch (field) {
    case 'kind':
      if (value === 'instruction' || value === 'skill' || value === 'mcp') {
        artifact.kind = value;
      }
      break;
    case 'lifecycle':
      if (value === 'active' || value === 'archived') {
        artifact.lifecycle = value;
      }
      break;
    case 'slug':
      if (typeof value === 'string') artifact.slug = value;
      break;
    case 'title':
      if (typeof value === 'string') artifact.title = value;
      break;
    case 'description':
      artifact.description = typeof value === 'string' ? value : undefined;
      break;
    case 'tags':
      if (isStringArray(value)) artifact.tags = value;
      break;
    case 'targets':
      if (isProviderArray(value)) artifact.targets = value;
      break;
    case 'locator':
      if (isLocator(value)) artifact.locator = value;
      break;
    case 'id':
      break;
  }
}

function mergeTombstones(
  base: DeletedArtifactTombstone[],
  ours: DeletedArtifactTombstone[],
  theirs: DeletedArtifactTombstone[],
): DeletedArtifactTombstone[] {
  const result = new Map<string, DeletedArtifactTombstone>();
  for (const tombstone of [...base, ...ours, ...theirs]) {
    const existing = result.get(tombstone.id);
    if (
      existing === undefined ||
      tombstone.deletedAt.localeCompare(existing.deletedAt) > 0
    ) {
      result.set(tombstone.id, structuredClone(tombstone));
    }
  }
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id));
}

interface LineChange {
  start: number;
  deleteCount: number;
  insert: string[];
}

function singleChange(base: string[], changed: string[]): LineChange | undefined {
  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < changed.length &&
    base[prefix] === changed[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < changed.length - prefix &&
    base[base.length - 1 - suffix] === changed[changed.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    deleteCount: base.length - prefix - suffix,
    insert: changed.slice(prefix, changed.length - suffix),
  };
}

function changesDoNotOverlap(left: LineChange, right: LineChange): boolean {
  const leftEnd = left.start + left.deleteCount;
  const rightEnd = right.start + right.deleteCount;
  if (left.deleteCount === 0 && right.deleteCount === 0) {
    return left.start !== right.start;
  }
  return leftEnd <= right.start || rightEnd <= left.start;
}

function splitLines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function byArtifactId(
  artifacts: LibraryArtifactMetadata[],
): Map<string, LibraryArtifactMetadata> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function cloneArtifact(artifact: LibraryArtifactMetadata): LibraryArtifactMetadata {
  return structuredClone(artifact);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isProviderArray(
  value: unknown,
): value is LibraryArtifactMetadata['targets'] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === 'claude' ||
        item === 'codex' ||
        item === 'cursor' ||
        item === 'gemini' ||
        item === 'windsurf' ||
        item === 'opencode',
    )
  );
}

function isLocator(value: unknown): value is LibraryArtifactMetadata['locator'] {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('path' in value)) {
    return false;
  }
  if (typeof value.path !== 'string') {
    return false;
  }
  return (
    value.type === 'file' ||
    value.type === 'directory' ||
    (value.type === 'mcp-server' &&
      'serverName' in value &&
      typeof value.serverName === 'string')
  );
}

