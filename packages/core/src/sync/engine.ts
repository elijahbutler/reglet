import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyAll } from '../engine/apply.js';
import { sha256String } from '../fsutil.js';
import { regletHome } from '../paths.js';
import { SyncClient } from './client.js';
import { loadSyncState, saveSyncState, type SyncState } from './state.js';

export interface SyncResult {
  pulled: string[];
  pushed: string[];
  merged: string[];
  conflicts: string[];
  deleted: string[];
}

export async function syncOnce(home = regletHome(), fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const state = await loadSyncState(home);
  if (state.serverUrl.length === 0 || state.deviceToken.length === 0) {
    throw new Error('Not logged in. Run reglet login first.');
  }

  const client = new SyncClient(state.serverUrl, state.deviceToken, fetchImpl);
  const result: SyncResult = { pulled: [], pushed: [], merged: [], conflicts: [], deleted: [] };
  const pullChanged = await pullChanges(home, state, client, result);
  await pushChanges(home, state, client, result);
  await saveSyncState(state, home);
  if (pullChanged) {
    await applyAll({ home });
  }
  return result;
}

export async function configureTokenLogin(
  serverUrl: string,
  token: string,
  deviceName: string,
  home = regletHome(),
): Promise<SyncState> {
  const state = await loadSyncState(home);
  const nextState: SyncState = {
    ...state,
    serverUrl,
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
  const changes = await client.changes(state.cursor);
  let changed = false;
  for (const change of changes.changes) {
    if (!isSyncPath(change.path)) {
      continue;
    }

    if (change.deleted) {
      await rm(path.join(home, change.path), { force: true, recursive: true });
      await rm(syncBasePath(home, change.path), { force: true });
      state.files[change.path] = { revision: change.revision, hash: change.hash, deleted: true };
      result.deleted.push(change.path);
      changed = true;
      continue;
    }

    const remote = await client.getFile(change.path);
    const content = Buffer.from(remote.contentBase64, 'base64');
    const localPath = path.join(home, change.path);
    const basePath = syncBasePath(home, change.path);
    const localHash = await optionalFileHash(localPath);
    const baseHash = await optionalFileHash(basePath);

    if (localHash !== null && localHash !== remote.hash && (baseHash === null || localHash !== baseHash)) {
      const localContent = await readFile(localPath);
      const baseContent = baseHash === null ? null : await readFile(basePath);
      const merged = tryMergeText(baseContent, localContent, content);
      if (merged !== null) {
        await writeFileEnsuringDir(localPath, merged);
        await writeFileEnsuringDir(basePath, content);
        state.files[change.path] = { revision: remote.revision, hash: remote.hash };
        result.merged.push(change.path);
        changed = true;
        continue;
      }

      const conflictPath = conflictFilePath(localPath, state.deviceName);
      await writeFileEnsuringDir(conflictPath, content);
      result.conflicts.push(path.relative(home, conflictPath).split(path.sep).join('/'));
      state.files[change.path] = { revision: remote.revision, hash: remote.hash };
      await writeFileEnsuringDir(basePath, content);
      continue;
    }

    await writeFileEnsuringDir(localPath, content);
    await writeFileEnsuringDir(basePath, content);
    state.files[change.path] = { revision: remote.revision, hash: remote.hash };
    result.pulled.push(change.path);
    changed = true;
  }
  state.cursor = changes.cursor;
  return changed;
}

async function pushChanges(home: string, state: SyncState, client: SyncClient, result: SyncResult): Promise<void> {
  const files = await collectSyncFiles(home);
  for (const filePath of files) {
    const absPath = path.join(home, filePath);
    const content = await readFile(absPath);
    const hash = sha256String(content);
    if (state.files[filePath]?.hash === hash && state.files[filePath]?.deleted !== true) {
      continue;
    }

    const baseRevision = state.files[filePath]?.revision ?? 0;
    const put = await client.tryPutFile(filePath, baseRevision, content);
    if (!put.ok) {
      const conflictContent = Buffer.from(put.conflict.contentBase64, 'base64');
      const basePath = syncBasePath(home, filePath);
      const baseContent = await optionalReadFile(basePath);
      const merged = tryMergeText(baseContent, content, conflictContent);
      if (merged !== null) {
        const retry = await client.tryPutFile(filePath, put.conflict.headRevision, merged);
        if (retry.ok) {
          await writeFileEnsuringDir(absPath, merged);
          await writeFileEnsuringDir(basePath, merged);
          state.files[filePath] = { revision: retry.revision, hash: sha256String(merged) };
          result.merged.push(filePath);
          result.pushed.push(filePath);
          continue;
        }
      }

      const conflictPath = conflictFilePath(absPath, state.deviceName);
      await writeFileEnsuringDir(conflictPath, conflictContent);
      await writeFileEnsuringDir(basePath, conflictContent);
      state.files[filePath] = {
        revision: put.conflict.headRevision,
        hash: sha256String(conflictContent),
      };
      result.conflicts.push(path.relative(home, conflictPath).split(path.sep).join('/'));
      continue;
    }

    await writeFileEnsuringDir(syncBasePath(home, filePath), content);
    state.files[filePath] = { revision: put.revision, hash };
    result.pushed.push(filePath);
  }
}

async function collectSyncFiles(home: string): Promise<string[]> {
  const files: string[] = [];
  await collectUnder(path.join(home, 'rules'), 'rules', files);
  await collectUnder(path.join(home, 'skills'), 'skills', files);
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
    const absPath = path.join(absDir, entry.name);
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectUnder(absPath, relPath, files);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
}

function isSyncPath(filePath: string): boolean {
  return (
    filePath === 'reglet.toml' ||
    filePath === 'mcp/servers.json' ||
    filePath.startsWith('rules/') ||
    filePath.startsWith('skills/')
  );
}

function syncBasePath(home: string, filePath: string): string {
  return path.join(home, '.state', 'sync-base', filePath);
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
