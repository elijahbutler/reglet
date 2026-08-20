import type { ManagerRecoveryPathFingerprintV3 } from './recovery.js';
import type { ManagerContentId, ManagerProviderId } from './snapshot-v2.js';

export interface ManagerProviderRestoreTargetV3 {
  path: string;
  content: ManagerContentId;
  action: 'restored' | 'removed';
  current: ManagerRecoveryPathFingerprintV3;
  restored: ManagerRecoveryPathFingerprintV3;
}

export interface ManagerProviderRestoreReviewV3 {
  version: 1;
  provider: ManagerProviderId;
  digest: string;
  status: 'ready' | 'blocked';
  issues: string[];
  targets: ManagerProviderRestoreTargetV3[];
}

export interface ManagerProviderRestoreResultV3 {
  version: 1;
  provider: ManagerProviderId;
  receiptId: string;
  results: Array<{
    path: string;
    action: 'restored' | 'removed';
  }>;
}

export interface ManagerProviderDetachTargetV3 {
  path: string;
  content: ManagerContentId;
  operation: 'rewrite' | 'detach-only';
  diff: string;
  current: ManagerRecoveryPathFingerprintV3;
  resulting: ManagerRecoveryPathFingerprintV3;
}

export interface ManagerProviderDetachReviewV3 {
  version: 1;
  provider: ManagerProviderId;
  content: ManagerContentId;
  digest: string;
  status: 'ready' | 'blocked';
  issues: string[];
  targets: ManagerProviderDetachTargetV3[];
}

export interface ManagerProviderDetachResultV3 {
  version: 1;
  provider: ManagerProviderId;
  content: ManagerContentId;
  receiptId: string;
  detached: Array<{
    path: string;
    headerRemoved: boolean;
  }>;
}

export interface ManagerProviderBackupPurgeReviewV3 {
  version: 1;
  provider: ManagerProviderId;
  digest: string;
  backup: ManagerRecoveryPathFingerprintV3;
  detachedOutputs: string[];
}

export interface ManagerProviderBackupPurgeResultV3 {
  version: 1;
  provider: ManagerProviderId;
  removed: boolean;
  detachedOutputs: string[];
}

const providerIds: readonly ManagerProviderId[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'windsurf',
  'opencode',
];
const contentIds: readonly ManagerContentId[] = ['rules', 'skills', 'mcp'];
const pathKinds = ['file', 'directory', 'missing', 'symlink', 'other'] as const;

export function isManagerProviderRestoreReviewV3(value: unknown): value is ManagerProviderRestoreReviewV3 {
  if (!isRecord(value) || !exact(value, ['version', 'provider', 'digest', 'status', 'issues', 'targets'])) return false;
  if (
    value.version !== 1 || !isProvider(value.provider) || typeof value.digest !== 'string' || value.digest.length === 0 ||
    (value.status !== 'ready' && value.status !== 'blocked') || !isStringArray(value.issues) ||
    !Array.isArray(value.targets) || !value.targets.every(isRestoreTarget)
  ) return false;
  return value.status === 'ready'
    ? value.issues.length === 0 && value.targets.length > 0
    : value.issues.length > 0;
}

export function isManagerProviderRestoreResultV3(value: unknown): value is ManagerProviderRestoreResultV3 {
  return isRecord(value) && exact(value, ['version', 'provider', 'receiptId', 'results']) &&
    value.version === 1 && isProvider(value.provider) && typeof value.receiptId === 'string' && value.receiptId.length > 0 &&
    Array.isArray(value.results) && value.results.every(isRestoreResult);
}

export function isManagerProviderDetachReviewV3(value: unknown): value is ManagerProviderDetachReviewV3 {
  if (!isRecord(value) || !exact(value, ['version', 'provider', 'content', 'digest', 'status', 'issues', 'targets'])) return false;
  if (
    value.version !== 1 || !isProvider(value.provider) || !isContent(value.content) ||
    typeof value.digest !== 'string' || value.digest.length === 0 ||
    (value.status !== 'ready' && value.status !== 'blocked') || !isStringArray(value.issues) ||
    !Array.isArray(value.targets) || !value.targets.every(isDetachTarget)
  ) return false;
  return value.status === 'ready' ? value.issues.length === 0 : value.issues.length > 0;
}

export function isManagerProviderDetachResultV3(value: unknown): value is ManagerProviderDetachResultV3 {
  return isRecord(value) && exact(value, ['version', 'provider', 'content', 'receiptId', 'detached']) &&
    value.version === 1 && isProvider(value.provider) && isContent(value.content) &&
    typeof value.receiptId === 'string' && value.receiptId.length > 0 &&
    Array.isArray(value.detached) && value.detached.every(isDetachResult);
}

export function isManagerProviderBackupPurgeReviewV3(value: unknown): value is ManagerProviderBackupPurgeReviewV3 {
  return isRecord(value) && exact(value, ['version', 'provider', 'digest', 'backup', 'detachedOutputs']) &&
    value.version === 1 && isProvider(value.provider) && typeof value.digest === 'string' && value.digest.length > 0 &&
    isFingerprint(value.backup) && isUniqueStringArray(value.detachedOutputs);
}

export function isManagerProviderBackupPurgeResultV3(value: unknown): value is ManagerProviderBackupPurgeResultV3 {
  return isRecord(value) && exact(value, ['version', 'provider', 'removed', 'detachedOutputs']) &&
    value.version === 1 && isProvider(value.provider) && typeof value.removed === 'boolean' &&
    isUniqueStringArray(value.detachedOutputs);
}

function isRestoreTarget(value: unknown): value is ManagerProviderRestoreTargetV3 {
  return isRecord(value) && exact(value, ['path', 'content', 'action', 'current', 'restored']) &&
    typeof value.path === 'string' && value.path.length > 0 && isContent(value.content) &&
    (value.action === 'restored' || value.action === 'removed') &&
    isFingerprint(value.current) && isFingerprint(value.restored) &&
    (value.action !== 'removed' || value.restored.kind === 'missing');
}

function isRestoreResult(value: unknown): value is ManagerProviderRestoreResultV3['results'][number] {
  return isRecord(value) && exact(value, ['path', 'action']) && typeof value.path === 'string' &&
    (value.action === 'restored' || value.action === 'removed');
}

function isDetachTarget(value: unknown): value is ManagerProviderDetachTargetV3 {
  return isRecord(value) && exact(value, ['path', 'content', 'operation', 'diff', 'current', 'resulting']) &&
    typeof value.path === 'string' && value.path.length > 0 && isContent(value.content) &&
    (value.operation === 'rewrite' || value.operation === 'detach-only') && typeof value.diff === 'string' &&
    isFingerprint(value.current) && isFingerprint(value.resulting) &&
    (value.operation !== 'detach-only' || value.diff.length === 0);
}

function isDetachResult(value: unknown): value is ManagerProviderDetachResultV3['detached'][number] {
  return isRecord(value) && exact(value, ['path', 'headerRemoved']) && typeof value.path === 'string' &&
    typeof value.headerRemoved === 'boolean';
}

function isFingerprint(value: unknown): value is ManagerRecoveryPathFingerprintV3 {
  if (!isRecord(value) || !exact(value, ['kind', 'hash', 'size']) ||
    typeof value.kind !== 'string' || !pathKinds.includes(value.kind as (typeof pathKinds)[number])) return false;
  if (value.kind === 'missing') return value.hash === null && value.size === null;
  return typeof value.hash === 'string' && value.hash.length > 0 &&
    typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0;
}

function isProvider(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isContent(value: unknown): value is ManagerContentId {
  return typeof value === 'string' && contentIds.includes(value as ManagerContentId);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isUniqueStringArray(value: unknown): value is string[] {
  return isStringArray(value) && new Set(value).size === value.length;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
