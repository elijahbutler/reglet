export type SyncCompatibility = 'unknown' | 'compatible' | 'unreachable' | 'revoked';
export type SyncConnectionPhase = 'disabled' | 'disconnected' | 'pending' | 'connected';

export interface SyncRunResult {
  completedAt: string;
  pulled: string[];
  pushed: string[];
  merged: string[];
  conflicts: string[];
  deleted: string[];
  providerReviewRequired: boolean;
}

export interface SyncLastRunSummary {
  completedAt: string;
  pulled: number;
  pushed: number;
  merged: number;
  conflicts: number;
  deleted: number;
  providerReviewRequired: boolean;
}

export interface SyncDeviceSummary {
  id: string;
  name: string;
  current: boolean;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface SyncPendingConnection {
  method: 'bootstrap' | 'pair';
  status: 'pending' | 'approved' | 'claimed' | 'cancelled' | 'expired';
  deviceName: string;
  code: string | null;
  fingerprint: string | null;
  expiresAt: string;
}

export interface SyncSnapshot {
  version: 1;
  previewAcknowledged: boolean;
  phase: SyncConnectionPhase;
  serverUrl: string | null;
  serverHost: string | null;
  compatibility: SyncCompatibility;
  currentDeviceId: string | null;
  currentDeviceName: string | null;
  pending: SyncPendingConnection | null;
  devices: SyncDeviceSummary[];
  conflicts: string[];
  lastSync: SyncLastRunSummary | null;
  lastError: { occurredAt: string; message: string } | null;
  keyRotationRequired: boolean;
}

export interface SyncInvitation {
  id: string;
  connectUrl: string;
  expiresAt: string;
}

export type SyncConflictContent =
  | { state: 'text'; content: string; size: number; hash: string }
  | { state: 'deleted'; content: null; size: 0; hash: null }
  | { state: 'binary' | 'too-large'; content: null; size: number; hash: string };

export interface SyncConflictPreview {
  version: 1;
  path: string;
  local: SyncConflictContent;
  remote: SyncConflictContent;
}

export function isSyncSnapshot(value: unknown): value is SyncSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'version', 'previewAcknowledged', 'phase', 'serverUrl', 'serverHost', 'compatibility',
    'currentDeviceId', 'currentDeviceName', 'pending', 'devices', 'conflicts', 'lastSync', 'lastError', 'keyRotationRequired',
  ])) return false;
  return value.version === 1 && typeof value.previewAcknowledged === 'boolean' &&
    isPhase(value.phase) && nullableString(value.serverUrl) && nullableString(value.serverHost) &&
    isCompatibility(value.compatibility) && nullableString(value.currentDeviceId) &&
    nullableString(value.currentDeviceName) && (value.pending === null || isPending(value.pending)) &&
    Array.isArray(value.devices) && value.devices.every(isDevice) &&
    stringArray(value.conflicts) && (value.lastSync === null || isLastRun(value.lastSync)) &&
    (value.lastError === null || isSyncError(value.lastError)) && typeof value.keyRotationRequired === 'boolean';
}

export function isSyncRunResult(value: unknown): value is SyncRunResult {
  return isRecord(value) && hasOnlyKeys(value, [
    'completedAt', 'pulled', 'pushed', 'merged', 'conflicts', 'deleted', 'providerReviewRequired',
  ]) && typeof value.completedAt === 'string' && stringArray(value.pulled) && stringArray(value.pushed) &&
    stringArray(value.merged) && stringArray(value.conflicts) && stringArray(value.deleted) &&
    typeof value.providerReviewRequired === 'boolean';
}

export function isSyncInvitation(value: unknown): value is SyncInvitation {
  return isRecord(value) && hasOnlyKeys(value, ['id', 'connectUrl', 'expiresAt']) &&
    typeof value.id === 'string' && typeof value.connectUrl === 'string' && typeof value.expiresAt === 'string';
}

export function isSyncConflictPreview(value: unknown): value is SyncConflictPreview {
  return isRecord(value) && hasOnlyKeys(value, ['version', 'path', 'local', 'remote']) &&
    value.version === 1 && typeof value.path === 'string' &&
    isSyncConflictContent(value.local) && isSyncConflictContent(value.remote);
}

function isSyncConflictContent(value: unknown): value is SyncConflictContent {
  if (!isRecord(value) || !hasOnlyKeys(value, ['state', 'content', 'size', 'hash']) || !nonNegative(value.size)) return false;
  if (value.state === 'text') {
    return typeof value.content === 'string' && typeof value.hash === 'string' &&
      new TextEncoder().encode(value.content).byteLength === value.size;
  }
  if (value.state === 'deleted') return value.content === null && value.size === 0 && value.hash === null;
  return (value.state === 'binary' || value.state === 'too-large') && value.content === null && typeof value.hash === 'string';
}

function isDevice(value: unknown): value is SyncDeviceSummary {
  return isRecord(value) && hasOnlyKeys(value, [
    'id', 'name', 'current', 'status', 'createdAt', 'lastSeenAt', 'revokedAt',
  ]) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.current === 'boolean' &&
    (value.status === 'active' || value.status === 'revoked') && typeof value.createdAt === 'string' &&
    nullableString(value.lastSeenAt) && nullableString(value.revokedAt);
}

function isPending(value: unknown): value is SyncPendingConnection {
  return isRecord(value) && hasOnlyKeys(value, [
    'method', 'status', 'deviceName', 'code', 'fingerprint', 'expiresAt',
  ]) && (value.method === 'bootstrap' || value.method === 'pair') &&
    (value.status === 'pending' || value.status === 'approved' || value.status === 'claimed' ||
      value.status === 'cancelled' || value.status === 'expired') &&
    typeof value.deviceName === 'string' && nullableString(value.code) && nullableString(value.fingerprint) &&
    typeof value.expiresAt === 'string';
}

function isLastRun(value: unknown): value is SyncLastRunSummary {
  return isRecord(value) && hasOnlyKeys(value, [
    'completedAt', 'pulled', 'pushed', 'merged', 'conflicts', 'deleted', 'providerReviewRequired',
  ]) && typeof value.completedAt === 'string' && nonNegative(value.pulled) && nonNegative(value.pushed) &&
    nonNegative(value.merged) && nonNegative(value.conflicts) && nonNegative(value.deleted) &&
    typeof value.providerReviewRequired === 'boolean';
}

function isSyncError(value: unknown): value is { occurredAt: string; message: string } {
  return isRecord(value) && hasOnlyKeys(value, ['occurredAt', 'message']) &&
    typeof value.occurredAt === 'string' && typeof value.message === 'string';
}

function isPhase(value: unknown): value is SyncConnectionPhase {
  return value === 'disabled' || value === 'disconnected' || value === 'pending' || value === 'connected';
}

function isCompatibility(value: unknown): value is SyncCompatibility {
  return value === 'unknown' || value === 'compatible' || value === 'unreachable' || value === 'revoked';
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
