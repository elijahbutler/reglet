import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writePrivateJson } from '../fsutil.js';
import { regletHome } from '../paths.js';

export interface SyncFileState {
  revision: number;
  hash: string;
  deleted?: boolean;
  conflicted?: boolean;
}

export interface SyncState {
  version: 1;
  serverUrl: string;
  deviceToken: string;
  cursor: number;
  deviceName: string;
  files: Record<string, SyncFileState>;
}

export function defaultSyncState(serverUrl = '', deviceToken = '', deviceName = 'device'): SyncState {
  return {
    version: 1,
    serverUrl,
    deviceToken,
    cursor: 0,
    deviceName,
    files: {},
  };
}

export function syncStatePath(home = regletHome()): string {
  return path.join(home, '.state', 'sync.json');
}

export async function loadSyncState(home = regletHome()): Promise<SyncState> {
  try {
    return normalizeSyncState(JSON.parse(await readFile(syncStatePath(home), 'utf8')) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultSyncState();
    }
    throw error;
  }
}

export async function saveSyncState(state: SyncState, home = regletHome()): Promise<void> {
  await writePrivateJson(syncStatePath(home), state);
}

function normalizeSyncState(value: unknown): SyncState {
  if (!isRecord(value) || value.version !== 1) {
    return defaultSyncState();
  }
  const files = isRecord(value.files) ? value.files : {};
  const normalizedFiles: Record<string, SyncFileState> = {};
  for (const [filePath, file] of Object.entries(files)) {
    if (isSyncFileState(file)) {
      normalizedFiles[filePath] = file;
    }
  }
  return {
    version: 1,
    serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : '',
    deviceToken: typeof value.deviceToken === 'string' ? value.deviceToken : '',
    cursor: typeof value.cursor === 'number' ? value.cursor : 0,
    deviceName: typeof value.deviceName === 'string' ? value.deviceName : 'device',
    files: normalizedFiles,
  };
}

function isSyncFileState(value: unknown): value is SyncFileState {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    typeof value.hash === 'string' &&
    (value.deleted === undefined || typeof value.deleted === 'boolean') &&
    (value.conflicted === undefined || typeof value.conflicted === 'boolean')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
