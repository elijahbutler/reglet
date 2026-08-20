import type { ManagerContentId, ManagerProviderId } from './snapshot-v2.js';
import type { ManagerArtifactKind } from './snapshot-v3.js';

export type ManagerProjectionReviewDriftV3 =
  | 'clean'
  | 'modified'
  | 'missing'
  | 'unmanaged'
  | 'not-applicable';

export interface ManagerProjectionReviewArtifactV3 {
  id: string;
  title: string;
  kind: ManagerArtifactKind;
}

export interface ManagerProjectionReviewEntryV3 {
  operation: 'write' | 'remove' | 'skip';
  path: string;
  diff: string;
  driftStatus: ManagerProjectionReviewDriftV3;
  expectedTargetHash: string | null;
  resultingTargetHash: string | null;
  snapshotBehavior: 'snapshot-before-write' | 'record-absence' | 'none';
  backupBehavior: 'none' | 'existing-backup' | 'backup-before-write';
  note?: string;
}

export interface ManagerProjectionReviewUnitV3 {
  key: string;
  provider: ManagerProviderId;
  content: ManagerContentId;
  digest: string;
  masterRevision: string;
  status: 'ready' | 'blocked';
  validationIssues: string[];
  entries: ManagerProjectionReviewEntryV3[];
  artifacts: ManagerProjectionReviewArtifactV3[];
  requiresDriftConfirmation: boolean;
}

export interface ManagerProjectionReviewV3 {
  version: 1;
  digest: string;
  units: ManagerProjectionReviewUnitV3[];
}

const providers: readonly ManagerProviderId[] = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'];
const contents: readonly ManagerContentId[] = ['rules', 'skills', 'mcp'];
const kinds: readonly ManagerArtifactKind[] = ['instruction', 'skill', 'mcp'];
const drifts: readonly ManagerProjectionReviewDriftV3[] = ['clean', 'modified', 'missing', 'unmanaged', 'not-applicable'];

export function isManagerProjectionReviewV3(value: unknown): value is ManagerProjectionReviewV3 {
  if (!isRecord(value) || !exact(value, ['version', 'digest', 'units']) || value.version !== 1 ||
    typeof value.digest !== 'string' || !Array.isArray(value.units)) return false;
  const keys = new Set<string>();
  for (const unit of value.units) {
    if (!isReviewUnit(unit) || keys.has(unit.key)) return false;
    keys.add(unit.key);
  }
  return true;
}

function isReviewUnit(value: unknown): value is ManagerProjectionReviewUnitV3 {
  if (!isRecord(value) || !exact(value, [
    'key',
    'provider',
    'content',
    'digest',
    'masterRevision',
    'status',
    'validationIssues',
    'entries',
    'artifacts',
    'requiresDriftConfirmation',
  ]) || !isProvider(value.provider) || !isContent(value.content) || value.key !== `${value.provider}:${value.content}` ||
    typeof value.digest !== 'string' || typeof value.masterRevision !== 'string' ||
    (value.status !== 'ready' && value.status !== 'blocked') || !isStringArray(value.validationIssues) ||
    !Array.isArray(value.entries) || !value.entries.every(isReviewEntry) ||
    !Array.isArray(value.artifacts) || !value.artifacts.every(isReviewArtifact) ||
    typeof value.requiresDriftConfirmation !== 'boolean') return false;
  const blocked = value.validationIssues.length > 0;
  const requiresDrift = value.entries.some((entry) => entry.driftStatus === 'modified' || entry.driftStatus === 'missing');
  return value.status === (blocked ? 'blocked' : 'ready') && value.requiresDriftConfirmation === requiresDrift;
}

function isReviewEntry(value: unknown): value is ManagerProjectionReviewEntryV3 {
  return isRecord(value) && exact(value, [
    'operation',
    'path',
    'diff',
    'driftStatus',
    'expectedTargetHash',
    'resultingTargetHash',
    'snapshotBehavior',
    'backupBehavior',
    'note',
  ]) && (value.operation === 'write' || value.operation === 'remove' || value.operation === 'skip') &&
    typeof value.path === 'string' && typeof value.diff === 'string' && drifts.includes(value.driftStatus as ManagerProjectionReviewDriftV3) &&
    nullableString(value.expectedTargetHash) && nullableString(value.resultingTargetHash) &&
    (value.snapshotBehavior === 'snapshot-before-write' || value.snapshotBehavior === 'record-absence' || value.snapshotBehavior === 'none') &&
    (value.backupBehavior === 'none' || value.backupBehavior === 'existing-backup' || value.backupBehavior === 'backup-before-write') &&
    (value.note === undefined || typeof value.note === 'string');
}

function isReviewArtifact(value: unknown): value is ManagerProjectionReviewArtifactV3 {
  return isRecord(value) && exact(value, ['id', 'title', 'kind']) && typeof value.id === 'string' &&
    typeof value.title === 'string' && kinds.includes(value.kind as ManagerArtifactKind);
}

function isProvider(value: unknown): value is ManagerProviderId {
  return providers.includes(value as ManagerProviderId);
}

function isContent(value: unknown): value is ManagerContentId {
  return contents.includes(value as ManagerContentId);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value || key === 'note');
}
