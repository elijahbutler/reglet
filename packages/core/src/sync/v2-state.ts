import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writePrivateJson } from '../fsutil.js';
import { regletHome } from '../paths.js';
import { initialCheckpoint, isSyncV2Checkpoint } from './v2-crypto.js';
import type { SyncV2Checkpoint, SyncV2PairRequest } from './v2-types.js';

export interface SyncV2FileState {
  objectId: string;
  revision: number;
  hash: string;
  deleted?: boolean;
  conflicted?: boolean;
}

export interface ActiveSyncV2State {
  version: 2;
  phase: 'active';
  serverUrl: string;
  vaultId: string;
  deviceId: string;
  deviceName: string;
  keyEpoch: number;
  cursor: number;
  checkpoint: SyncV2Checkpoint;
  credentialId: string;
  files: Record<string, SyncV2FileState>;
}

export interface PendingSyncV2State {
  version: 2;
  phase: 'pending';
  serverUrl: string;
  credentialId: string;
  request: SyncV2PairRequest;
}

export type SyncV2State = ActiveSyncV2State | PendingSyncV2State;

export function syncV2StatePath(home = regletHome()): string {
  return path.join(home, '.state', 'sync-v2.json');
}

export async function loadSyncV2State(home = regletHome()): Promise<SyncV2State | null> {
  try {
    return normalizeSyncV2State(JSON.parse(await readFile(syncV2StatePath(home), 'utf8')) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadActiveSyncV2State(home = regletHome()): Promise<ActiveSyncV2State> {
  const state = await loadSyncV2State(home);
  if (state?.phase !== 'active') throw new Error('This device is not connected to an encrypted sync vault');
  return state;
}

export async function loadPendingSyncV2State(home = regletHome()): Promise<PendingSyncV2State> {
  const state = await loadSyncV2State(home);
  if (state?.phase !== 'pending') throw new Error('This device has no pending encrypted pairing request');
  return state;
}

export async function saveSyncV2State(state: SyncV2State, home = regletHome()): Promise<void> {
  await writePrivateJson(syncV2StatePath(home), state);
}

export async function clearSyncV2State(home = regletHome()): Promise<void> {
  await rm(syncV2StatePath(home), { force: true });
}

export function newActiveSyncV2State(input: {
  serverUrl: string;
  vaultId: string;
  deviceId: string;
  deviceName: string;
  keyEpoch: number;
  credentialId: string;
}): ActiveSyncV2State {
  return {
    version: 2,
    phase: 'active',
    ...input,
    cursor: 0,
    checkpoint: initialCheckpoint(),
    files: {},
  };
}

function normalizeSyncV2State(value: unknown): SyncV2State {
  if (!isRecord(value) || value.version !== 2 || typeof value.serverUrl !== 'string' || typeof value.credentialId !== 'string') {
    throw new Error('Encrypted sync state is invalid');
  }
  if (value.phase === 'pending' && isPairRequest(value.request)) {
    return {
      version: 2,
      phase: 'pending',
      serverUrl: value.serverUrl,
      credentialId: value.credentialId,
      request: value.request,
    };
  }
  if (
    value.phase !== 'active' ||
    typeof value.vaultId !== 'string' ||
    typeof value.deviceId !== 'string' ||
    typeof value.deviceName !== 'string' ||
    !isPositiveSafeInteger(value.keyEpoch) ||
    !isNonNegativeSafeInteger(value.cursor) ||
    !isSyncV2Checkpoint(value.checkpoint) ||
    value.cursor !== value.checkpoint.sequence ||
    !isRecord(value.files)
  ) {
    throw new Error('Encrypted sync state is invalid');
  }
  const files: Record<string, SyncV2FileState> = {};
  for (const [filePath, file] of Object.entries(value.files)) {
    if (!isFileState(file)) throw new Error('Encrypted sync file state is invalid');
    files[filePath] = file;
  }
  return {
    version: 2,
    phase: 'active',
    serverUrl: value.serverUrl,
    vaultId: value.vaultId,
    deviceId: value.deviceId,
    deviceName: value.deviceName,
    keyEpoch: value.keyEpoch,
    cursor: value.cursor,
    checkpoint: value.checkpoint,
    credentialId: value.credentialId,
    files,
  };
}

function isPairRequest(value: unknown): value is SyncV2PairRequest {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.deviceName === 'string' &&
    typeof value.agreementPublicKey === 'string' &&
    typeof value.signingPublicKey === 'string' &&
    typeof value.expiresAt === 'string'
  );
}

function isFileState(value: unknown): value is SyncV2FileState {
  return (
    isRecord(value) &&
    typeof value.objectId === 'string' &&
    isNonNegativeSafeInteger(value.revision) &&
    typeof value.hash === 'string' &&
    (value.deleted === undefined || typeof value.deleted === 'boolean') &&
    (value.conflicted === undefined || typeof value.conflicted === 'boolean')
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
