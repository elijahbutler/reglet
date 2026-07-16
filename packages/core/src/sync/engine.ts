import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256String, writePrivateFile } from '../fsutil.js';
import { regletHome } from '../paths.js';
import { requireSecureSyncServerUrl, SyncClient } from './client.js';
import { requireAllowedSyncPath, resolveSyncPath } from './path.js';
import { loadSyncState, saveSyncState, type SyncState } from './state.js';

export interface SyncResult {
  pulled: string[];
  pushed: string[];
  merged: string[];
  conflicts: string[];
  deleted: string[];
  providerReviewRequired: boolean;
}

export async function syncOnce(home = regletHome(), fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const state = await loadSyncState(home);
  if (state.serverUrl.length === 0 || state.deviceToken.length === 0) {
    throw new Error('Not logged in. Run reglet login first.');
  }

  const client = new SyncClient(state.serverUrl, state.deviceToken, fetchImpl);
  await client.ensureCompatible();
  const result: SyncResult = { pulled: [], pushed: [], merged: [], conflicts: [], deleted: [], providerReviewRequired: false };
  const pullChanged = await pullChanges(home, state, client, result);
  await pushChanges(home, state, client, result);
  await saveSyncState(state, home);
  result.providerReviewRequired = pullChanged || result.merged.length > 0 || result.conflicts.length > 0;
  return result;
}

export async function configureTokenLogin(
  serverUrl: string,
  token: string,
  deviceName: string,
  home = regletHome(),
): Promise<SyncState> {
  const secureServerUrl = requireSecureSyncServerUrl(serverUrl);
  const state = await loadSyncState(home);
  const nextState: SyncState = {
    ...state,
    serverUrl: secureServerUrl,
    deviceToken: token,
    deviceName,
  };
  await saveSyncState(nextState, home);
  return nextState;
}

async function pullChanges(
  home: string,
  state: SyncState,
  client: SyncClient,
  result: SyncResult,
): Promise<boolean> {
  let changed = false;
  let hasMore = true;
  while (hasMore) {
    const changes = await client.changes(state.cursor);
    for (const change of changes.changes) {
      requireAllowedSyncPath(change.path);
    }
    for (const change of changes.changes) {
      const known = state.files[change.path];
      if (
        known?.revision === change.revision &&
        known.hash === change.hash &&
        (known.deleted === true) === change.deleted
      ) {
        continue;
      }
      const localPath = await safeLocalSyncPath(home, change.path);
      const basePath = await safeSyncBasePath(home, change.path);
      const localHash = await optionalFileHash(localPath);
      const baseHash = await optionalFileHash(basePath);
      if (change.deleted) {
        const locallyChanged = localHash !== null && (baseHash === null || localHash !== baseHash);
        if (known?.conflicted === true || locallyChanged) {
          await recordConflict(home, state, change.path, {
            revision: change.revision,
            hash: '',
            deleted: true,
            content: new Uint8Array(),
          }, result);
          changed = true;
          continue;
        }

        await rm(localPath, { force: true, recursive: true });
        await rm(basePath, { force: true });
        state.files[change.path] = { revision: change.revision, hash: change.hash, deleted: true };
        result.deleted.push(change.path);
        changed = true;
        continue;
      }

      const remote = await client.getFile(change.path);
      const content = Buffer.from(remote.contentBase64, 'base64');
      if (remote.revision !== change.revision || remote.hash !== change.hash || sha256String(content) !== remote.hash) {
        throw new Error(`Sync rejected inconsistent remote content for ${JSON.stringify(change.path)}`);
      }

      const localDeleted = localHash === null && baseHash !== null;
      const locallyChanged = localHash !== null && localHash !== remote.hash && (baseHash === null || localHash !== baseHash);
      if (known?.conflicted === true || localDeleted || locallyChanged) {
        if (localHash !== null && known?.conflicted !== true) {
          const localContent = await readFile(localPath);
          const baseContent = baseHash === null ? null : await readFile(basePath);
          const merged = tryMergeText(baseContent, localContent, content);
          if (merged !== null) {
            await writeFileEnsuringDir(localPath, merged);
            await writePrivateFile(basePath, content);
            state.files[change.path] = { revision: remote.revision, hash: remote.hash };
            result.merged.push(change.path);
            changed = true;
            continue;
          }
        }

        await recordConflict(home, state, change.path, {
          revision: remote.revision,
          hash: remote.hash,
          deleted: false,
          content,
        }, result);
        changed = true;
        continue;
      }

      await writeFileEnsuringDir(localPath, content);
      await writePrivateFile(basePath, content);
      state.files[change.path] = { revision: remote.revision, hash: remote.hash };
      result.pulled.push(change.path);
      changed = true;
    }
    state.cursor = changes.cursor;
    hasMore = changes.hasMore;
  }
  return changed;
}

async function pushChanges(home: string, state: SyncState, client: SyncClient, result: SyncResult): Promise<void> {
  const files = await collectSyncFiles(home);
  const currentFiles = new Set(files);
  for (const filePath of files) {
    const absPath = await safeLocalSyncPath(home, filePath);
    const basePath = await safeSyncBasePath(home, filePath);
    const content = await readFile(absPath);
    const hash = sha256String(content);
    const tracked = state.files[filePath];
    if (tracked?.conflicted === true) {
      const conflictPath = conflictFilePath(absPath, state.deviceName);
      if (tracked.deleted !== true && tracked.hash === hash) {
        await rm(conflictPath, { force: true });
        state.files[filePath] = { ...tracked, conflicted: false };
        continue;
      }
      if (await pathExists(conflictPath)) continue;
      state.files[filePath] = { ...tracked, conflicted: false };
    }
    if (state.files[filePath]?.hash === hash && state.files[filePath]?.deleted !== true) {
      continue;
    }

    const baseRevision = state.files[filePath]?.revision ?? 0;
    const put = await client.tryPutFile(filePath, baseRevision, content);
    if (!put.ok) {
      const conflictContent = verifiedConflictContent(filePath, put.conflict);
      const baseContent = await optionalReadFile(basePath);
      const merged = put.conflict.headDeleted ? null : tryMergeText(baseContent, content, conflictContent);
      if (merged !== null) {
        const retry = await client.tryPutFile(filePath, put.conflict.headRevision, merged);
        if (retry.ok) {
          await writeFileEnsuringDir(absPath, merged);
          await writePrivateFile(basePath, merged);
          state.files[filePath] = { revision: retry.revision, hash: sha256String(merged) };
          result.merged.push(filePath);
          result.pushed.push(filePath);
          continue;
        }
      }

      await recordConflict(home, state, filePath, {
        revision: put.conflict.headRevision,
        hash: put.conflict.headHash,
        deleted: put.conflict.headDeleted,
        content: conflictContent,
      }, result);
      continue;
    }

    await writePrivateFile(basePath, content);
    state.files[filePath] = { revision: put.revision, hash };
    result.pushed.push(filePath);
  }

  for (const [filePath, tracked] of Object.entries(state.files)) {
    if (currentFiles.has(filePath)) continue;
    requireAllowedSyncPath(filePath);
    const basePath = await safeSyncBasePath(home, filePath);
    if (tracked.conflicted === true) {
      const conflictPath = conflictFilePath(await safeLocalSyncPath(home, filePath), state.deviceName);
      if (await pathExists(conflictPath)) continue;
      state.files[filePath] = { ...tracked, conflicted: false };
      if (tracked.deleted === true) continue;
    } else if (tracked.deleted === true) {
      continue;
    }
    const deletion = await client.tryDeleteFile(filePath, tracked.revision);
    if (deletion.ok) {
      await rm(basePath, { force: true });
      state.files[filePath] = { revision: deletion.revision, hash: '', deleted: true };
      result.deleted.push(filePath);
      continue;
    }

    const remoteContent = verifiedConflictContent(filePath, deletion.conflict);
    if (deletion.conflict.headDeleted) {
      await rm(basePath, { force: true });
      state.files[filePath] = { revision: deletion.conflict.headRevision, hash: '', deleted: true };
      result.deleted.push(filePath);
      continue;
    }
    await recordConflict(home, state, filePath, {
      revision: deletion.conflict.headRevision,
      hash: deletion.conflict.headHash,
      deleted: false,
      content: remoteContent,
    }, result);
  }
}

async function recordConflict(
  home: string,
  state: SyncState,
  filePath: string,
  remote: { revision: number; hash: string; deleted: boolean; content: Uint8Array },
  result: SyncResult,
): Promise<void> {
  const localPath = await safeLocalSyncPath(home, filePath);
  const basePath = await safeSyncBasePath(home, filePath);
  const conflictPath = conflictFilePath(localPath, state.deviceName);
  await writeFileEnsuringDir(conflictPath, remote.content);
  if (remote.deleted) {
    await rm(basePath, { force: true });
  } else {
    if (sha256String(remote.content) !== remote.hash) {
      throw new Error(`Sync rejected inconsistent conflict content for ${JSON.stringify(filePath)}`);
    }
    await writePrivateFile(basePath, remote.content);
  }
  state.files[filePath] = {
    revision: remote.revision,
    hash: remote.hash,
    deleted: remote.deleted,
    conflicted: true,
  };
  const relativeConflict = path.relative(home, conflictPath).split(path.sep).join('/');
  if (!result.conflicts.includes(relativeConflict)) result.conflicts.push(relativeConflict);
}

function verifiedConflictContent(
  filePath: string,
  conflict: { headHash: string; headDeleted: boolean; contentBase64: string },
): Uint8Array {
  const content = Buffer.from(conflict.contentBase64, 'base64');
  if (!conflict.headDeleted && sha256String(content) !== conflict.headHash) {
    throw new Error(`Sync rejected inconsistent conflict content for ${JSON.stringify(filePath)}`);
  }
  return content;
}

async function collectSyncFiles(home: string): Promise<string[]> {
  const files: string[] = [];
  await collectUnder(path.join(home, 'rules'), 'rules', files);
  await collectUnder(path.join(home, 'skills'), 'skills', files);
  await collectUnder(path.join(home, 'mcp', 'providers'), 'mcp/providers', files);
  for (const filePath of ['mcp/servers.json', 'reglet.toml']) {
    if (await pathExists(path.join(home, filePath))) {
      files.push(filePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectUnder(absDir: string, relDir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isLocalOnlySyncArtifact(entry.name)) {
      continue;
    }
    const absPath = path.join(absDir, entry.name);
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectUnder(absPath, relPath, files);
    } else if (entry.isFile()) {
      files.push(requireAllowedSyncPath(relPath));
    }
  }
}

function isLocalOnlySyncArtifact(name: string): boolean {
  return name.endsWith('~') || name.endsWith('.bak') || name.endsWith('.backup') || name.includes('.conflict-');
}

function syncBasePath(home: string, filePath: string): string {
  return resolveSyncPath(path.join(home, '.state', 'sync-base'), filePath);
}

async function safeSyncBasePath(home: string, filePath: string): Promise<string> {
  const target = syncBasePath(home, filePath);
  await rejectSymbolicLinkComponents(home, target, filePath);
  return target;
}

function conflictFilePath(filePath: string, deviceName: string): string {
  const ext = path.extname(filePath);
  const withoutExt = ext.length === 0 ? filePath : filePath.slice(0, -ext.length);
  return `${withoutExt}.conflict-${sanitizeDeviceName(deviceName)}${ext}`;
}

function sanitizeDeviceName(deviceName: string): string {
  return deviceName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
}

async function writeFileEnsuringDir(filePath: string, content: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function safeLocalSyncPath(home: string, filePath: string): Promise<string> {
  const target = resolveSyncPath(home, filePath);
  await rejectSymbolicLinkComponents(home, target, filePath);
  return target;
}

async function rejectSymbolicLinkComponents(root: string, target: string, filePath: string): Promise<void> {
  const relative = path.relative(path.resolve(root), target);
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Sync rejected a symbolic-link path component: ${JSON.stringify(filePath)}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') break;
      throw error;
    }
  }
}

async function optionalFileHash(filePath: string): Promise<string | null> {
  try {
    return sha256String(await readFile(filePath));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function optionalReadFile(filePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function tryMergeText(
  baseContent: Uint8Array | null,
  localContent: Uint8Array,
  remoteContent: Uint8Array,
): Uint8Array | null {
  if (!isUtf8Text(localContent) || !isUtf8Text(remoteContent) || (baseContent !== null && !isUtf8Text(baseContent))) {
    return null;
  }

  if (baseContent === null) {
    return null;
  }

  const base = splitLines(Buffer.from(baseContent).toString('utf8'));
  const local = splitLines(Buffer.from(localContent).toString('utf8'));
  const remote = splitLines(Buffer.from(remoteContent).toString('utf8'));
  const localChanges = changedLineIndexes(base, local);
  const remoteChanges = changedLineIndexes(base, remote);

  for (const index of localChanges) {
    if (remoteChanges.has(index)) {
      return null;
    }
  }

  const maxLength = Math.max(base.length, local.length, remote.length);
  const merged: string[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    if (localChanges.has(index)) {
      merged.push(local[index] ?? '');
    } else if (remoteChanges.has(index)) {
      merged.push(remote[index] ?? '');
    } else {
      merged.push(base[index] ?? '');
    }
  }
  return Buffer.from(merged.join(''), 'utf8');
}

function changedLineIndexes(base: string[], next: string[]): Set<number> {
  const indexes = new Set<number>();
  const maxLength = Math.max(base.length, next.length);
  for (let index = 0; index < maxLength; index += 1) {
    if ((base[index] ?? '') !== (next[index] ?? '')) {
      indexes.add(index);
    }
  }
  return indexes;
}

function splitLines(content: string): string[] {
  const matches = content.match(/[^\n]*\n|[^\n]+/g);
  return matches ?? [];
}

function isUtf8Text(content: Uint8Array): boolean {
  return !Buffer.from(content).includes(0);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
