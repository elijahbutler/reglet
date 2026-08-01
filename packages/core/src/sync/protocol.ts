export interface SyncTransportFile {
  path: string;
  hash: string;
  size: number;
  contentBase64: string;
}

export interface SyncTransportSnapshot {
  revision: number;
  files: SyncTransportFile[];
}

export interface SyncTransportUpdate {
  baseRevision: number;
  files: SyncTransportFile[];
}

export interface SyncTransportConflict {
  currentRevision: number;
}

const canonicalTopLevelFiles = new Set(['library.json', 'reglet.toml']);
const canonicalRoots = new Set(['rules', 'skills', 'mcp']);

export function isCanonicalSyncPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.includes('\0')
  ) {
    return false;
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    return false;
  }
  return (
    (segments.length === 1 && canonicalTopLevelFiles.has(value)) ||
    (segments.length > 1 && canonicalRoots.has(segments[0] ?? ''))
  );
}

export function parseSyncSnapshot(
  value: unknown,
  fileLimitBytes = 25 * 1024 * 1024,
): SyncTransportSnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !('files' in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error('Sync snapshot is invalid.');
  }
  const paths = new Set<string>();
  const files = value.files.map((file) => {
    if (
      typeof file !== 'object' ||
      file === null ||
      !('path' in file) ||
      typeof file.path !== 'string' ||
      !isCanonicalSyncPath(file.path) ||
      paths.has(file.path) ||
      !('hash' in file) ||
      typeof file.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.hash) ||
      !('size' in file) ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > fileLimitBytes ||
      !('contentBase64' in file) ||
      typeof file.contentBase64 !== 'string'
    ) {
      throw new Error('Sync snapshot contains an invalid file.');
    }
    const content = Buffer.from(file.contentBase64, 'base64');
    if (
      content.byteLength !== file.size ||
      content.toString('base64') !== file.contentBase64 ||
      createHash('sha256').update(content).digest('hex') !== file.hash
    ) {
      throw new Error('Sync snapshot file encoding is invalid.');
    }
    paths.add(file.path);
    return {
      path: file.path,
      hash: file.hash,
      size: file.size,
      contentBase64: file.contentBase64,
    };
  });
  return {
    revision: value.revision,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}
import { createHash } from 'node:crypto';
