import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { saveLibraryManifest } from '../artifacts/library.js';
import type { LibraryManifest } from '../artifacts/types.js';
import { regletHome } from '../paths.js';
import type { SecretStore } from '../security/secrets.js';
import { systemSecretStore } from '../security/secrets.js';
import { LocalState } from '../state/database.js';
import {
  mergeBinaryFile,
  mergeLibraryManifests,
  mergeTextFile,
  type SyncConflictCode,
} from './merge.js';
import {
  isCanonicalSyncPath,
  parseSyncSnapshot,
  type SyncTransportFile,
  type SyncTransportSnapshot,
} from './protocol.js';
import { enumerateCanonicalSyncScope } from './scope.js';

export const syncTokenSecretId = 'reglet-sync-token';

export interface CanonicalSyncConflict {
  path: string;
  code: SyncConflictCode;
  message: string;
  binary: boolean;
}

export interface CanonicalSyncStatus {
  configured: boolean;
  state:
    | 'disabled'
    | 'ready'
    | 'syncing'
    | 'synced'
    | 'blocked'
    | 'conflict'
    | 'error';
  lastSyncedAt?: string;
  remoteRevision?: number;
  conflicts: CanonicalSyncConflict[];
  blockedFiles: Array<{ path: string; size: number; issue: string }>;
  message?: string;
}

export interface CanonicalSyncOptions {
  home?: string;
  serverUrl: string;
  token?: string;
  secretStore?: SecretStore;
  fetch?: typeof globalThis.fetch;
  fileLimitBytes?: number;
}

interface StoredSyncConflict extends CanonicalSyncConflict {
  base?: SyncTransportFile;
  ours?: SyncTransportFile;
  theirs?: SyncTransportFile;
}

interface StoredSyncConflicts {
  conflicts: StoredSyncConflict[];
}

export async function syncCanonicalLibrary(
  options: CanonicalSyncOptions,
): Promise<CanonicalSyncStatus> {
  const home = options.home ?? regletHome();
  const fileLimitBytes = options.fileLimitBytes ?? 25 * 1024 * 1024;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const token =
    options.token ??
    (await (options.secretStore ?? systemSecretStore()).resolve(
      syncTokenSecretId,
    ));
  if (token === undefined) {
    return saveSyncStatus(home, {
      configured: true,
      state: 'blocked',
      conflicts: [],
      blockedFiles: [],
      message: `Required sync credential is unbound: ${syncTokenSecretId}`,
    });
  }
  const scope = await enumerateCanonicalSyncScope(home, fileLimitBytes);
  if (scope.blockedFiles.length > 0) {
    return saveSyncStatus(home, {
      configured: true,
      state: 'blocked',
      conflicts: [],
      blockedFiles: scope.blockedFiles.map((file) => ({
        path: normalizePath(file.relativePath),
        size: file.size,
        issue: file.issue ?? 'File exceeds the sync limit.',
      })),
      message:
        'Oversized canonical files remain locally manageable and applicable.',
    });
  }

  try {
    await saveSyncStatus(home, {
      configured: true,
      state: 'syncing',
      conflicts: [],
      blockedFiles: [],
    });
    const [local, remote, base] = await Promise.all([
      localSnapshot(home, fileLimitBytes),
      fetchRemoteSnapshot(options.serverUrl, token, fetcher, fileLimitBytes),
      readBaseSnapshot(home, fileLimitBytes),
    ]);
    const merge = mergeSnapshots(base, local, remote);
    await applyCleanLocalFiles(home, local, merge.localFiles, merge.conflicts);
    let remoteRevision = remote.revision;
    if (!snapshotsMatch(remote.files, merge.remoteFiles)) {
      remoteRevision = await pushRemoteSnapshot(
        options.serverUrl,
        token,
        remote.revision,
        merge.remoteFiles,
        fetcher,
      );
    }
    await writeBaseSnapshot(home, {
      revision: remoteRevision,
      files: merge.baseFiles,
    });
    await writeConflicts(home, merge.conflicts);
    const status: CanonicalSyncStatus = {
      configured: true,
      state: merge.conflicts.length > 0 ? 'conflict' : 'synced',
      lastSyncedAt: new Date().toISOString(),
      remoteRevision,
      conflicts: merge.conflicts.map(publicConflict),
      blockedFiles: [],
      message:
        merge.conflicts.length > 0
          ? 'Clean canonical files synced. Conflicting files require local resolution.'
          : undefined,
    };
    return saveSyncStatus(home, status);
  } catch (error) {
    return saveSyncStatus(home, {
      configured: true,
      state: 'error',
      conflicts: await readPublicConflicts(home),
      blockedFiles: [],
      message: safeSyncError(error),
    });
  }
}

export async function resolveCanonicalSyncConflict(
  relativePath: string,
  choice: 'ours' | 'theirs',
  home = regletHome(),
): Promise<CanonicalSyncStatus> {
  if (!isCanonicalSyncPath(relativePath)) {
    throw new Error('Sync conflict path is invalid.');
  }
  const store = await readConflicts(home);
  const conflict = store.conflicts.find(
    (candidate) => candidate.path === relativePath,
  );
  if (conflict === undefined) {
    throw new Error(`Unknown sync conflict: ${relativePath}`);
  }
  const selected = choice === 'ours' ? conflict.ours : conflict.theirs;
  await writeCanonicalFile(home, relativePath, selected);
  const base = await readBaseSnapshot(home);
  const nextBase = new Map(base.files.map((file) => [file.path, file]));
  if (conflict.theirs === undefined) {
    nextBase.delete(relativePath);
  } else {
    nextBase.set(relativePath, conflict.theirs);
  }
  await writeBaseSnapshot(home, {
    revision: base.revision,
    files: [...nextBase.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  });
  store.conflicts = store.conflicts.filter(
    (candidate) => candidate.path !== relativePath,
  );
  await writeConflicts(home, store.conflicts);
  return saveSyncStatus(home, {
    configured: true,
    state: store.conflicts.length > 0 ? 'conflict' : 'ready',
    remoteRevision: base.revision,
    conflicts: store.conflicts.map(publicConflict),
    blockedFiles: [],
    message:
      store.conflicts.length > 0
        ? 'Other canonical conflicts still require resolution.'
        : 'Conflict resolved locally. Sync again to publish the selection.',
  });
}

export async function readCanonicalSyncStatus(
  configured: boolean,
  home = regletHome(),
): Promise<CanonicalSyncStatus> {
  const state = await LocalState.open(home);
  try {
    const value = state.setting('sync.status');
    if (value !== undefined) {
      const parsed = parseStatus(value);
      if (parsed !== undefined) {
        return { ...parsed, configured };
      }
    }
  } finally {
    state.close();
  }
  return {
    configured,
    state: configured ? 'ready' : 'disabled',
    conflicts: await readPublicConflicts(home),
    blockedFiles: [],
  };
}

export async function syncConflictContents(
  home = regletHome(),
): Promise<CanonicalSyncConflict[]> {
  return readPublicConflicts(home);
}

function mergeSnapshots(
  base: SyncTransportSnapshot,
  ours: SyncTransportSnapshot,
  theirs: SyncTransportSnapshot,
): {
  localFiles: SyncTransportFile[];
  remoteFiles: SyncTransportFile[];
  baseFiles: SyncTransportFile[];
  conflicts: StoredSyncConflict[];
} {
  const baseFiles = fileMap(base.files);
  const ourFiles = fileMap(ours.files);
  const theirFiles = fileMap(theirs.files);
  const paths = new Set([
    ...baseFiles.keys(),
    ...ourFiles.keys(),
    ...theirFiles.keys(),
  ]);
  const local = new Map<string, SyncTransportFile>();
  const remote = new Map<string, SyncTransportFile>();
  const nextBase = new Map<string, SyncTransportFile>();
  const conflicts: StoredSyncConflict[] = [];
  for (const filePath of [...paths].sort()) {
    const baseFile = baseFiles.get(filePath);
    const ourFile = ourFiles.get(filePath);
    const theirFile = theirFiles.get(filePath);
    const merged = mergeFile(filePath, baseFile, ourFile, theirFile);
    if (merged.conflict !== undefined) {
      conflicts.push(merged.conflict);
      if (ourFile !== undefined) local.set(filePath, ourFile);
      if (theirFile !== undefined) remote.set(filePath, theirFile);
      if (baseFile !== undefined) nextBase.set(filePath, baseFile);
      continue;
    }
    if (merged.file !== undefined) {
      local.set(filePath, merged.file);
      remote.set(filePath, merged.file);
      nextBase.set(filePath, merged.file);
    }
  }
  return {
    localFiles: sortedFiles(local),
    remoteFiles: sortedFiles(remote),
    baseFiles: sortedFiles(nextBase),
    conflicts,
  };
}

function mergeFile(
  filePath: string,
  base: SyncTransportFile | undefined,
  ours: SyncTransportFile | undefined,
  theirs: SyncTransportFile | undefined,
): { file?: SyncTransportFile; conflict?: StoredSyncConflict } {
  if (sameFile(ours, theirs)) return { file: ours };
  if (sameFile(ours, base)) return { file: theirs };
  if (sameFile(theirs, base)) return { file: ours };
  if (ours === undefined || theirs === undefined) {
    return {
      conflict: {
        path: filePath,
        code: 'delete-versus-edit',
        message: 'One machine deleted this file while another edited it.',
        binary: false,
        base,
        ours,
        theirs,
      },
    };
  }
  if (filePath === 'library.json') {
    try {
      const merged = mergeLibraryManifests(
        base === undefined
          ? { schemaVersion: 2, artifacts: [], tombstones: [] }
          : parseManifest(base),
        parseManifest(ours),
        parseManifest(theirs),
      );
      if (merged.conflicts.length > 0) {
        return {
          conflict: {
            path: filePath,
            code: merged.conflicts[0]?.code ?? 'same-field-edit',
            message:
              merged.conflicts[0]?.message ??
              'Library metadata changed on both machines.',
            binary: false,
            base,
            ours,
            theirs,
          },
        };
      }
      return {
        file: transportFile(
          filePath,
          Buffer.from(`${JSON.stringify(merged.manifest, null, 2)}\n`),
        ),
      };
    } catch {
      return invalidTextConflict(filePath, base, ours, theirs);
    }
  }
  if (base === undefined) {
    return {
      conflict: {
        path: filePath,
        code: 'concurrent-create',
        message: 'Both machines created different content at the same path.',
        binary: isBinaryFile(filePath, ours, theirs),
        ours,
        theirs,
      },
    };
  }
  if (isBinaryFile(filePath, ours, theirs)) {
    const merged = mergeBinaryFile(
      fileBytes(base),
      fileBytes(ours),
      fileBytes(theirs),
      filePath,
    );
    if (!merged.clean || merged.selected === undefined) {
      return {
        conflict: {
          path: filePath,
          code: 'binary-conflict',
          message:
            merged.conflicts[0]?.message ??
            'Both machines changed a binary asset.',
          binary: true,
          base,
          ours,
          theirs,
        },
      };
    }
    return { file: transportFile(filePath, Buffer.from(merged.selected)) };
  }
  try {
    const merged = mergeTextFile(
      fileBytes(base).toString('utf8'),
      fileBytes(ours).toString('utf8'),
      fileBytes(theirs).toString('utf8'),
      filePath,
    );
    if (!merged.clean) {
      return {
        conflict: {
          path: filePath,
          code: 'text-conflict',
          message:
            merged.conflicts[0]?.message ??
            'Both machines changed overlapping text.',
          binary: false,
          base,
          ours,
          theirs,
        },
      };
    }
    return { file: transportFile(filePath, Buffer.from(merged.content)) };
  } catch {
    return invalidTextConflict(filePath, base, ours, theirs);
  }
}

function invalidTextConflict(
  filePath: string,
  base: SyncTransportFile | undefined,
  ours: SyncTransportFile,
  theirs: SyncTransportFile,
): { conflict: StoredSyncConflict } {
  return {
    conflict: {
      path: filePath,
      code: 'text-conflict',
      message: 'The canonical text could not be merged safely.',
      binary: false,
      base,
      ours,
      theirs,
    },
  };
}

async function localSnapshot(
  home: string,
  fileLimitBytes: number,
): Promise<SyncTransportSnapshot> {
  const scope = await enumerateCanonicalSyncScope(home, fileLimitBytes);
  return {
    revision: 0,
    files: await Promise.all(
      scope.files
        .filter((file) => !file.blocked)
        .map(async (file) =>
          transportFile(
            normalizePath(file.relativePath),
            await readFile(file.absolutePath),
          ),
        ),
    ),
  };
}

async function fetchRemoteSnapshot(
  serverUrl: string,
  token: string,
  fetcher: typeof globalThis.fetch,
  fileLimitBytes: number,
): Promise<SyncTransportSnapshot> {
  const response = await fetcher(syncEndpoint(serverUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const value = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(syncErrorPayload(value));
  }
  return parseSyncSnapshot(value, fileLimitBytes);
}

async function pushRemoteSnapshot(
  serverUrl: string,
  token: string,
  baseRevision: number,
  files: SyncTransportFile[],
  fetcher: typeof globalThis.fetch,
): Promise<number> {
  const response = await fetcher(syncEndpoint(serverUrl), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision, files }),
  });
  const value = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(syncErrorPayload(value));
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('revision' in value) ||
    typeof value.revision !== 'number'
  ) {
    throw new Error('Sync server returned an invalid revision.');
  }
  return value.revision;
}

async function applyCleanLocalFiles(
  home: string,
  current: SyncTransportSnapshot,
  nextFiles: SyncTransportFile[],
  conflicts: StoredSyncConflict[],
): Promise<void> {
  const conflictPaths = new Set(conflicts.map((conflict) => conflict.path));
  const currentPaths = new Set(current.files.map((file) => file.path));
  const next = fileMap(nextFiles);
  for (const filePath of currentPaths) {
    if (!next.has(filePath) && !conflictPaths.has(filePath)) {
      await writeCanonicalFile(home, filePath, undefined);
    }
  }
  for (const file of next.values()) {
    if (!conflictPaths.has(file.path)) {
      await writeCanonicalFile(home, file.path, file);
    }
  }
}

async function writeCanonicalFile(
  home: string,
  relativePath: string,
  file: SyncTransportFile | undefined,
): Promise<void> {
  if (!isCanonicalSyncPath(relativePath)) {
    throw new Error('Canonical sync path is invalid.');
  }
  const target = path.join(home, ...relativePath.split('/'));
  if (file === undefined) {
    await rm(target, { force: true });
    return;
  }
  if (relativePath === 'library.json') {
    await saveLibraryManifest(parseManifest(file), home);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.sync`;
  await writeFile(temporary, fileBytes(file), { mode: 0o600 });
  await rename(temporary, target);
}

function parseManifest(file: SyncTransportFile): LibraryManifest {
  return JSON.parse(fileBytes(file).toString('utf8')) as LibraryManifest;
}

function isBinaryFile(
  filePath: string,
  ...files: SyncTransportFile[]
): boolean {
  if (
    /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|otf|wasm|exe|dll|dylib)$/i.test(
      filePath,
    )
  ) {
    return true;
  }
  return files.some((file) => fileBytes(file).includes(0));
}

function transportFile(
  filePath: string,
  content: Uint8Array,
): SyncTransportFile {
  const buffer = Buffer.from(content);
  return {
    path: filePath,
    hash: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.byteLength,
    contentBase64: buffer.toString('base64'),
  };
}

function fileBytes(file: SyncTransportFile): Buffer {
  return Buffer.from(file.contentBase64, 'base64');
}

function sameFile(
  left: SyncTransportFile | undefined,
  right: SyncTransportFile | undefined,
): boolean {
  return left?.hash === right?.hash && left?.size === right?.size;
}

function fileMap(
  files: SyncTransportFile[],
): Map<string, SyncTransportFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function sortedFiles(
  files: Map<string, SyncTransportFile>,
): SyncTransportFile[] {
  return [...files.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function snapshotsMatch(
  left: SyncTransportFile[],
  right: SyncTransportFile[],
): boolean {
  if (left.length !== right.length) return false;
  const rightFiles = fileMap(right);
  return left.every((file) => sameFile(file, rightFiles.get(file.path)));
}

function syncEndpoint(serverUrl: string): string {
  const url = new URL('/v1/sync/snapshot', normalizedServerUrl(serverUrl));
  return url.toString();
}

function normalizedServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' ||
        url.hostname === 'localhost' ||
        url.hostname === '::1')
    )
  ) {
    throw new Error(
      'Sync requires HTTPS unless the server is on the loopback interface.',
    );
  }
  return url.toString();
}

function basePath(home: string): string {
  return path.join(home, '.state', 'sync-base', 'snapshot.json');
}

function conflictPath(home: string): string {
  return path.join(home, '.state', 'sync-conflicts', 'conflicts.json');
}

async function readBaseSnapshot(
  home: string,
  fileLimitBytes?: number,
): Promise<SyncTransportSnapshot> {
  try {
    return parseSyncSnapshot(
      JSON.parse(await readFile(basePath(home), 'utf8')) as unknown,
      fileLimitBytes,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { revision: 0, files: [] };
    }
    throw error;
  }
}

async function writeBaseSnapshot(
  home: string,
  snapshot: SyncTransportSnapshot,
): Promise<void> {
  await writePrivateJson(basePath(home), snapshot);
}

async function readConflicts(home: string): Promise<StoredSyncConflicts> {
  try {
    const value = JSON.parse(await readFile(conflictPath(home), 'utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('conflicts' in value) ||
      !Array.isArray(value.conflicts)
    ) {
      return { conflicts: [] };
    }
    return { conflicts: value.conflicts as StoredSyncConflict[] };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { conflicts: [] };
    }
    throw error;
  }
}

async function writeConflicts(
  home: string,
  conflicts: StoredSyncConflict[],
): Promise<void> {
  if (conflicts.length === 0) {
    await rm(conflictPath(home), { force: true });
    return;
  }
  await writePrivateJson(conflictPath(home), { conflicts });
}

async function readPublicConflicts(
  home: string,
): Promise<CanonicalSyncConflict[]> {
  return (await readConflicts(home)).conflicts.map(publicConflict);
}

function publicConflict(
  conflict: StoredSyncConflict,
): CanonicalSyncConflict {
  return {
    path: conflict.path,
    code: conflict.code,
    message: conflict.message,
    binary: conflict.binary,
  };
}

async function writePrivateJson(
  target: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, target);
}

async function saveSyncStatus(
  home: string,
  status: CanonicalSyncStatus,
): Promise<CanonicalSyncStatus> {
  const state = await LocalState.open(home);
  try {
    state.setSetting('sync.status', JSON.stringify(status));
  } finally {
    state.close();
  }
  return status;
}

function parseStatus(value: string): CanonicalSyncStatus | undefined {
  try {
    const parsed = JSON.parse(value) as CanonicalSyncStatus;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function syncErrorPayload(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  ) {
    return value.error.message;
  }
  return 'Sync server request failed.';
}

function safeSyncError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Canonical sync failed.';
  return message
    .replace(
      /(?:secret|token|password|credential|authorization|api[-_]?key)\s*[=:]\s*[^\s,;]+/gi,
      '[REDACTED]',
    )
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s,;]+/g, '[PATH]');
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
