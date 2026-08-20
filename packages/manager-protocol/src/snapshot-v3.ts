import type { ManagerContentId, ManagerProviderId } from './snapshot-v2.js';

export type ManagerArtifactId = string;
export type ManagerArtifactKind = 'instruction' | 'skill' | 'mcp';
export type ManagerArtifactLifecycle = 'active' | 'archived';
export type ManagerSessionScope = 'read' | 'write' | 'admin';

export type ManagerArtifactScopeV3 =
  | { kind: 'global' }
  | { kind: 'provider-overlay'; provider: ManagerProviderId };

export type ManagerArtifactLocatorV3 =
  | { type: 'file'; path: string }
  | { type: 'directory'; path: string }
  | { type: 'mcp-server'; path: string; serverName: string };

export interface ManagerArtifactMetadataV3 {
  id: ManagerArtifactId;
  kind: ManagerArtifactKind;
  lifecycle: ManagerArtifactLifecycle;
  scope: ManagerArtifactScopeV3;
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  targets: ManagerProviderId[];
  locator: ManagerArtifactLocatorV3;
}

export type ManagerProjectionStatusV3 =
  | 'not-targeted'
  | 'unsupported'
  | 'pending'
  | 'applied'
  | 'drifted'
  | 'missing'
  | 'blocked'
  | 'error';

export interface ManagerProjectionIssueV3 {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  documentationUrl?: string;
}

export interface ManagerArtifactProjectionV3 {
  artifactId: ManagerArtifactId;
  provider: ManagerProviderId;
  status: ManagerProjectionStatusV3;
  destinationPath: string | null;
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
  appliedRevision?: string;
  appliedAt?: string;
  issues: ManagerProjectionIssueV3[];
}

export interface ManagerDraftV3 {
  updatedAt: string;
  validationIssues: ManagerProjectionIssueV3[];
}

export interface ManagerArtifactHistoryV3 {
  revision: string;
  createdAt: string;
  reason: 'edit' | 'rename' | 'archive' | 'delete' | 'restore';
}

export interface ManagerArtifactV3 {
  metadata: ManagerArtifactMetadataV3;
  draft?: ManagerDraftV3;
  projections: ManagerArtifactProjectionV3[];
  history: ManagerArtifactHistoryV3[];
}

export interface ManagerLibraryTombstoneV3 {
  id: ManagerArtifactId;
  kind: ManagerArtifactKind;
  slug: string;
  deletedAt: string;
  recoverableUntil: string;
}

export type ManagerMigrationStateV3 =
  | { status: 'not-needed' | 'available'; legacyArtifacts: number }
  | { status: 'applied'; appliedAt: string; receiptId: string }
  | { status: 'failed'; message: string; recoverable: true };

export interface ManagerLibraryV3 {
  schemaVersion: 2;
  migration: ManagerMigrationStateV3;
  artifacts: ManagerArtifactV3[];
  tombstones: ManagerLibraryTombstoneV3[];
  counts: {
    active: number;
    archived: number;
    drafts: number;
  };
}

export interface ManagerProviderCapabilityV3 {
  supported: boolean;
  issue?: string;
}

export type ManagerProviderSourceOwnershipV3 = 'empty' | 'managed' | 'unmanaged' | 'mixed' | 'unknown';

export interface ManagerProviderSourceItemV3 {
  id: string;
  label: string;
  ownership: 'managed' | 'unmanaged' | 'unknown';
}

export interface ManagerProviderSourceV3 {
  provider: ManagerProviderId;
  content: ManagerContentId;
  path: string | null;
  exists: boolean;
  readable: boolean;
  ownership: ManagerProviderSourceOwnershipV3;
  items: ManagerProviderSourceItemV3[];
  issues: ManagerProjectionIssueV3[];
}

export interface ManagerProviderV3 {
  id: ManagerProviderId;
  displayName: string;
  detected: boolean;
  documentationUrl: string;
  lastVerifiedAt: string;
  schemaVersion: number;
  capabilities: {
    instructions: ManagerProviderCapabilityV3;
    skills: ManagerProviderCapabilityV3;
    mcp: ManagerProviderCapabilityV3;
  };
  sources: ManagerProviderSourceV3[];
  projections: ManagerArtifactProjectionV3[];
}

export interface ManagerProjectRootV3 {
  id: string;
  label: string;
  path: string;
  createdAt: string;
  lastScannedAt?: string;
}

export type ManagerDiscoveryStateV3 =
  | 'new'
  | 'changed'
  | 'promoted'
  | 'conflict'
  | 'ignored';

export interface ManagerProjectDiscoveryV3 {
  id: string;
  rootId: string;
  relativePath: string;
  kind: ManagerArtifactKind;
  sourceHash: string;
  size: number;
  recognizedBy: ManagerProviderId[];
  providerFormats: string[];
  scopeSummary: string;
  state: ManagerDiscoveryStateV3;
  changedSincePromotion: boolean;
  skillRisks: string[];
}

export interface ManagerProjectInboxV3 {
  roots: ManagerProjectRootV3[];
  discoveries: ManagerProjectDiscoveryV3[];
}

export interface ManagerActivityV3 {
  id: string;
  occurredAt: string;
  action: string;
  outcome: 'success' | 'warning' | 'error';
  artifactId?: string;
  provider?: ManagerProviderId;
}

export interface ManagerSessionV3 {
  id: string;
  scope: ManagerSessionScope;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface ManagerSnapshotV3 {
  version: 3;
  contract: 'manager-snapshot';
  protocolVersion: 2;
  revision: number;
  permissions: {
    scope: ManagerSessionScope;
    canMutate: boolean;
    canAdmin: boolean;
  };
  library: ManagerLibraryV3;
  providers: ManagerProviderV3[];
  projectInbox?: ManagerProjectInboxV3;
  activity: ManagerActivityV3[];
  settings: {
    setup: {
      completed: boolean;
    };
    sync: {
      enabled: boolean;
      phase: 'disabled' | 'pending' | 'active';
      state: 'disabled' | 'pending' | 'expired' | 'idle' | 'syncing' | 'conflict' | 'error';
      conflictCount: number;
      conflicts: string[];
      lastCompletedAt?: string;
      lastError?: {
        occurredAt: string;
        message: string;
      };
      pending?: {
        method: 'bootstrap' | 'pair';
        deviceName: string;
        expiresAt: string;
      };
    };
    remote: {
      enabled: boolean;
      endpoint?: string;
      warning?: string;
    };
    secretBindings: Array<{ id: string; bound: boolean }>;
    sessions?: ManagerSessionV3[];
  };
  diagnostics: {
    healthy: boolean;
    issues: ManagerProjectionIssueV3[];
  };
}

const providerIds: readonly ManagerProviderId[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'windsurf',
  'opencode',
];
const artifactKinds: readonly ManagerArtifactKind[] = ['instruction', 'skill', 'mcp'];
const projectionStatuses: readonly ManagerProjectionStatusV3[] = [
  'not-targeted',
  'unsupported',
  'pending',
  'applied',
  'drifted',
  'missing',
  'blocked',
  'error',
];

export function isManagerSnapshotV3(value: unknown): value is ManagerSnapshotV3 {
  return isRecord(value) &&
    exact(value, [
      'version',
      'contract',
      'protocolVersion',
      'revision',
      'permissions',
      'library',
      'providers',
      'projectInbox',
      'activity',
      'settings',
      'diagnostics',
    ]) &&
    value.version === 3 &&
    value.contract === 'manager-snapshot' &&
    value.protocolVersion === 2 &&
    isNonNegativeInteger(value.revision) &&
    isPermissions(value.permissions) &&
    isLibrary(value.library) &&
    isArrayOf(value.providers, isProvider) &&
    (value.projectInbox === undefined || isProjectInbox(value.projectInbox)) &&
    isArrayOf(value.activity, isActivity) &&
    isSettings(value.settings) &&
    isDiagnostics(value.diagnostics);
}

function isPermissions(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, ['scope', 'canMutate', 'canAdmin']) &&
    isSessionScope(value.scope) &&
    typeof value.canMutate === 'boolean' &&
    typeof value.canAdmin === 'boolean' &&
    value.canMutate === (value.scope !== 'read') &&
    value.canAdmin === (value.scope === 'admin');
}

function isLibrary(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, ['schemaVersion', 'migration', 'artifacts', 'tombstones', 'counts']) &&
    value.schemaVersion === 2 &&
    isMigration(value.migration) &&
    isArrayOf(value.artifacts, isArtifact) &&
    isArrayOf(value.tombstones, isTombstone) &&
    isCounts(value.counts);
}

function isMigration(value: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'not-needed' || value.status === 'available') {
    return exact(value, ['status', 'legacyArtifacts']) && isNonNegativeInteger(value.legacyArtifacts);
  }
  if (value.status === 'applied') {
    return exact(value, ['status', 'appliedAt', 'receiptId']) &&
      typeof value.appliedAt === 'string' && typeof value.receiptId === 'string';
  }
  return value.status === 'failed' &&
    exact(value, ['status', 'message', 'recoverable']) &&
    typeof value.message === 'string' && value.recoverable === true;
}

function isCounts(value: unknown): boolean {
  return isRecord(value) && exact(value, ['active', 'archived', 'drafts']) &&
    isNonNegativeInteger(value.active) &&
    isNonNegativeInteger(value.archived) &&
    isNonNegativeInteger(value.drafts);
}

function isArtifact(value: unknown): boolean {
  return isRecord(value) && exact(value, ['metadata', 'draft', 'projections', 'history']) &&
    isArtifactMetadata(value.metadata) &&
    (value.draft === undefined || isDraft(value.draft)) &&
    isArrayOf(value.projections, isProjection) &&
    isArrayOf(value.history, isHistory);
}

function isArtifactMetadata(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, [
      'id',
      'kind',
      'lifecycle',
      'scope',
      'slug',
      'title',
      'description',
      'tags',
      'targets',
      'locator',
    ]) &&
    typeof value.id === 'string' &&
    isArtifactKind(value.kind) &&
    (value.lifecycle === 'active' || value.lifecycle === 'archived') &&
    isArtifactScope(value.scope) &&
    typeof value.slug === 'string' &&
    typeof value.title === 'string' &&
    optionalString(value.description) &&
    isArrayOf(value.tags, isString) &&
    isArrayOf(value.targets, isProviderId) &&
    isLocator(value.locator);
}

function isArtifactScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === 'global'
    ? exact(value, ['kind'])
    : value.kind === 'provider-overlay' && exact(value, ['kind', 'provider']) && isProviderId(value.provider);
}

function isLocator(value: unknown): boolean {
  if (!isRecord(value) || typeof value.path !== 'string') return false;
  if (value.type === 'file' || value.type === 'directory') {
    return exact(value, ['type', 'path']);
  }
  return value.type === 'mcp-server' && exact(value, ['type', 'path', 'serverName']) && typeof value.serverName === 'string';
}

function isDraft(value: unknown): boolean {
  return isRecord(value) && exact(value, ['updatedAt', 'validationIssues']) &&
    typeof value.updatedAt === 'string' && isArrayOf(value.validationIssues, isIssue);
}

function isProjection(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, [
      'artifactId',
      'provider',
      'status',
      'destinationPath',
      'desiredHash',
      'appliedHash',
      'observedHash',
      'appliedRevision',
      'appliedAt',
      'issues',
    ]) &&
    typeof value.artifactId === 'string' &&
    isProviderId(value.provider) &&
    typeof value.status === 'string' &&
    projectionStatuses.includes(value.status as ManagerProjectionStatusV3) &&
    (value.destinationPath === null || typeof value.destinationPath === 'string') &&
    optionalString(value.desiredHash) &&
    optionalString(value.appliedHash) &&
    optionalString(value.observedHash) &&
    optionalString(value.appliedRevision) &&
    optionalString(value.appliedAt) &&
    isArrayOf(value.issues, isIssue);
}

function isIssue(value: unknown): boolean {
  return isRecord(value) && exact(value, ['code', 'severity', 'message', 'documentationUrl']) &&
    typeof value.code === 'string' &&
    (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') &&
    typeof value.message === 'string' && optionalString(value.documentationUrl);
}

function isHistory(value: unknown): boolean {
  return isRecord(value) && exact(value, ['revision', 'createdAt', 'reason']) &&
    typeof value.revision === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.reason === 'edit' || value.reason === 'rename' || value.reason === 'archive' || value.reason === 'delete' || value.reason === 'restore');
}

function isTombstone(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'kind', 'slug', 'deletedAt', 'recoverableUntil']) &&
    typeof value.id === 'string' && isArtifactKind(value.kind) && typeof value.slug === 'string' &&
    typeof value.deletedAt === 'string' && typeof value.recoverableUntil === 'string';
}

function isProvider(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, [
      'id',
      'displayName',
      'detected',
      'documentationUrl',
      'lastVerifiedAt',
      'schemaVersion',
      'capabilities',
      'sources',
      'projections',
    ]) &&
    isProviderId(value.id) &&
    typeof value.displayName === 'string' &&
    typeof value.detected === 'boolean' &&
    typeof value.documentationUrl === 'string' &&
    typeof value.lastVerifiedAt === 'string' &&
    isNonNegativeInteger(value.schemaVersion) &&
    isCapabilities(value.capabilities) &&
    isArrayOf(value.sources, isProviderSource) &&
    isArrayOf(value.projections, isProjection);
}

function isProviderSource(value: unknown): boolean {
  return isRecord(value) && exact(value, [
    'provider',
    'content',
    'path',
    'exists',
    'readable',
    'ownership',
    'items',
    'issues',
  ]) &&
    isProviderId(value.provider) &&
    (value.content === 'rules' || value.content === 'skills' || value.content === 'mcp') &&
    (value.path === null || typeof value.path === 'string') &&
    typeof value.exists === 'boolean' &&
    typeof value.readable === 'boolean' &&
    (value.ownership === 'empty' || value.ownership === 'managed' ||
      value.ownership === 'unmanaged' || value.ownership === 'mixed' || value.ownership === 'unknown') &&
    isArrayOf(value.items, isProviderSourceItem) &&
    isArrayOf(value.issues, isIssue);
}

function isProviderSourceItem(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'label', 'ownership']) &&
    typeof value.id === 'string' && typeof value.label === 'string' &&
    (value.ownership === 'managed' || value.ownership === 'unmanaged' || value.ownership === 'unknown');
}

function isCapabilities(value: unknown): boolean {
  return isRecord(value) && exact(value, ['instructions', 'skills', 'mcp']) &&
    isCapability(value.instructions) && isCapability(value.skills) && isCapability(value.mcp);
}

function isCapability(value: unknown): boolean {
  return isRecord(value) && exact(value, ['supported', 'issue']) &&
    typeof value.supported === 'boolean' && optionalString(value.issue);
}

function isProjectInbox(value: unknown): boolean {
  return isRecord(value) && exact(value, ['roots', 'discoveries']) &&
    isArrayOf(value.roots, isProjectRoot) && isArrayOf(value.discoveries, isDiscovery);
}

function isProjectRoot(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'label', 'path', 'createdAt', 'lastScannedAt']) &&
    typeof value.id === 'string' && typeof value.label === 'string' && typeof value.path === 'string' &&
    typeof value.createdAt === 'string' && optionalString(value.lastScannedAt);
}

function isDiscovery(value: unknown): boolean {
  return isRecord(value) &&
    exact(value, [
      'id',
      'rootId',
      'relativePath',
      'kind',
      'sourceHash',
      'size',
      'recognizedBy',
      'providerFormats',
      'scopeSummary',
      'state',
      'changedSincePromotion',
      'skillRisks',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.rootId === 'string' &&
    typeof value.relativePath === 'string' &&
    isArtifactKind(value.kind) &&
    typeof value.sourceHash === 'string' &&
    isNonNegativeInteger(value.size) &&
    isArrayOf(value.recognizedBy, isProviderId) &&
    isArrayOf(value.providerFormats, isString) &&
    typeof value.scopeSummary === 'string' &&
    typeof value.state === 'string' &&
    ['new', 'changed', 'promoted', 'conflict', 'ignored'].includes(value.state) &&
    typeof value.changedSincePromotion === 'boolean' &&
    isArrayOf(value.skillRisks, isString);
}

function isActivity(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'occurredAt', 'action', 'outcome', 'artifactId', 'provider']) &&
    typeof value.id === 'string' && typeof value.occurredAt === 'string' && typeof value.action === 'string' &&
    (value.outcome === 'success' || value.outcome === 'warning' || value.outcome === 'error') &&
    optionalString(value.artifactId) && (value.provider === undefined || isProviderId(value.provider));
}

function isSettings(value: unknown): boolean {
  return isRecord(value) && exact(value, ['setup', 'sync', 'remote', 'secretBindings', 'sessions']) &&
    isSetupSettings(value.setup) && isSyncSettings(value.sync) && isRemoteSettings(value.remote) &&
    isArrayOf(value.secretBindings, isSecretBinding) &&
    (value.sessions === undefined || isArrayOf(value.sessions, isSession));
}

function isSetupSettings(value: unknown): boolean {
  return isRecord(value) && exact(value, ['completed']) && typeof value.completed === 'boolean';
}

function isSyncSettings(value: unknown): boolean {
  return isRecord(value) && exact(value, ['enabled', 'phase', 'state', 'conflictCount', 'conflicts', 'lastCompletedAt', 'lastError', 'pending']) &&
    typeof value.enabled === 'boolean' &&
    (value.phase === 'disabled' || value.phase === 'pending' || value.phase === 'active') &&
    typeof value.state === 'string' &&
    ['disabled', 'pending', 'expired', 'idle', 'syncing', 'conflict', 'error'].includes(value.state) &&
    isNonNegativeInteger(value.conflictCount) && isArrayOf(value.conflicts, isString) &&
    value.conflictCount === value.conflicts.length && optionalString(value.lastCompletedAt) &&
    (value.lastError === undefined || isSyncError(value.lastError)) &&
    (value.pending === undefined || isPendingSyncSettings(value.pending)) &&
    value.enabled === (value.phase === 'active') &&
    (value.phase === 'pending') === (value.pending !== undefined);
}

function isSyncError(value: unknown): boolean {
  return isRecord(value) && exact(value, ['occurredAt', 'message']) &&
    typeof value.occurredAt === 'string' && typeof value.message === 'string';
}

function isPendingSyncSettings(value: unknown): boolean {
  return isRecord(value) && exact(value, ['method', 'deviceName', 'expiresAt']) &&
    (value.method === 'bootstrap' || value.method === 'pair') &&
    typeof value.deviceName === 'string' && typeof value.expiresAt === 'string';
}

function isRemoteSettings(value: unknown): boolean {
  return isRecord(value) && exact(value, ['enabled', 'endpoint', 'warning']) &&
    typeof value.enabled === 'boolean' && optionalString(value.endpoint) && optionalString(value.warning);
}

function isSecretBinding(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'bound']) &&
    typeof value.id === 'string' && typeof value.bound === 'boolean';
}

function isSession(value: unknown): boolean {
  return isRecord(value) && exact(value, ['id', 'scope', 'createdAt', 'expiresAt', 'revokedAt']) &&
    typeof value.id === 'string' && isSessionScope(value.scope) && typeof value.createdAt === 'string' &&
    optionalString(value.expiresAt) && optionalString(value.revokedAt);
}

function isDiagnostics(value: unknown): boolean {
  return isRecord(value) && exact(value, ['healthy', 'issues']) &&
    typeof value.healthy === 'boolean' && isArrayOf(value.issues, isIssue);
}

function isArtifactKind(value: unknown): value is ManagerArtifactKind {
  return typeof value === 'string' && artifactKinds.includes(value as ManagerArtifactKind);
}

function isProviderId(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isSessionScope(value: unknown): value is ManagerSessionScope {
  return value === 'read' || value === 'write' || value === 'admin';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[];
function isArrayOf(value: unknown, guard: (item: unknown) => boolean): boolean;
function isArrayOf(value: unknown, guard: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(guard);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
