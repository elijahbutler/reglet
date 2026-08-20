import type { ManagerContentId, ManagerProviderId } from './snapshot-v2.js';

export type ManagerRecoveryLifecycleV3 = 'pending' | 'completed' | 'rolled-back' | 'restored';
export type ManagerRecoveryPathKindV3 = 'file' | 'directory' | 'missing' | 'symlink' | 'other';

export interface ManagerRecoveryReceiptV3 {
  id: string;
  lifecycle: ManagerRecoveryLifecycleV3;
  startedAt: string;
  completedAt: string | null;
  providers: ManagerProviderId[];
  contents: ManagerContentId[];
  targetCount: number;
  restorable: boolean;
  reason?: string;
}

export interface ManagerRecoveryPathFingerprintV3 {
  kind: ManagerRecoveryPathKindV3;
  hash: string | null;
  size: number | null;
}

export interface ManagerRecoveryTargetV3 {
  path: string;
  action: 'restored' | 'removed';
  current: ManagerRecoveryPathFingerprintV3;
  restored: ManagerRecoveryPathFingerprintV3;
}

export interface ManagerRecoveryReviewV3 {
  version: 1;
  receipt: ManagerRecoveryReceiptV3;
  digest: string;
  targets: ManagerRecoveryTargetV3[];
}

export interface ManagerRecoveryRestoreResultV3 {
  version: 1;
  receiptId: string;
  undoReceiptId: string;
  actions: Array<{
    path: string;
    action: 'restored' | 'removed';
  }>;
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
const lifecycles: readonly ManagerRecoveryLifecycleV3[] = ['pending', 'completed', 'rolled-back', 'restored'];
const pathKinds: readonly ManagerRecoveryPathKindV3[] = ['file', 'directory', 'missing', 'symlink', 'other'];

export function isManagerRecoveryReceiptV3(value: unknown): value is ManagerRecoveryReceiptV3 {
  if (!isRecord(value) || !exact(value, [
    'id',
    'lifecycle',
    'startedAt',
    'completedAt',
    'providers',
    'contents',
    'targetCount',
    'restorable',
    'reason',
  ])) return false;
  const validReason = value.restorable === true
    ? value.reason === undefined
    : typeof value.reason === 'string' && value.reason.length > 0;
  return typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.lifecycle === 'string' && lifecycles.includes(value.lifecycle as ManagerRecoveryLifecycleV3) &&
    typeof value.startedAt === 'string' &&
    (typeof value.completedAt === 'string' || value.completedAt === null) &&
    isUniqueArray(value.providers, isProviderId) &&
    isUniqueArray(value.contents, isContentId) &&
    isNonNegativeInteger(value.targetCount) &&
    typeof value.restorable === 'boolean' && validReason;
}

export function isManagerRecoveryReviewV3(value: unknown): value is ManagerRecoveryReviewV3 {
  return isRecord(value) && exact(value, ['version', 'receipt', 'digest', 'targets']) &&
    value.version === 1 && isManagerRecoveryReceiptV3(value.receipt) &&
    typeof value.digest === 'string' && value.digest.length > 0 &&
    Array.isArray(value.targets) && value.targets.every(isRecoveryTarget) &&
    value.targets.length === value.receipt.targetCount;
}

export function isManagerRecoveryRestoreResultV3(value: unknown): value is ManagerRecoveryRestoreResultV3 {
  return isRecord(value) && exact(value, ['version', 'receiptId', 'undoReceiptId', 'actions']) &&
    value.version === 1 && typeof value.receiptId === 'string' && value.receiptId.length > 0 &&
    typeof value.undoReceiptId === 'string' && value.undoReceiptId.length > 0 &&
    Array.isArray(value.actions) && value.actions.every(isRecoveryAction);
}

function isRecoveryTarget(value: unknown): value is ManagerRecoveryTargetV3 {
  return isRecord(value) && exact(value, ['path', 'action', 'current', 'restored']) &&
    typeof value.path === 'string' && value.path.length > 0 &&
    (value.action === 'restored' || value.action === 'removed') &&
    isPathFingerprint(value.current) && isPathFingerprint(value.restored) &&
    (value.action !== 'removed' || value.restored.kind === 'missing');
}

function isRecoveryAction(value: unknown): value is ManagerRecoveryRestoreResultV3['actions'][number] {
  return isRecord(value) && exact(value, ['path', 'action']) && typeof value.path === 'string' &&
    (value.action === 'restored' || value.action === 'removed');
}

function isPathFingerprint(value: unknown): value is ManagerRecoveryPathFingerprintV3 {
  if (!isRecord(value) || !exact(value, ['kind', 'hash', 'size']) ||
    typeof value.kind !== 'string' || !pathKinds.includes(value.kind as ManagerRecoveryPathKindV3)) return false;
  if (value.kind === 'missing') return value.hash === null && value.size === null;
  return typeof value.hash === 'string' && value.hash.length > 0 && isNonNegativeInteger(value.size);
}

function isProviderId(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isContentId(value: unknown): value is ManagerContentId {
  return typeof value === 'string' && contentIds.includes(value as ManagerContentId);
}

function isUniqueArray<T>(value: unknown, validate: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every(validate) && new Set(value).size === value.length;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    keys.filter((key) => value[key] !== undefined).every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
