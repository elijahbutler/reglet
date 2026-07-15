export type ManagerProviderId = 'claude' | 'codex' | 'cursor' | 'gemini' | 'windsurf' | 'opencode';
export type ManagerContentId = 'rules' | 'skills' | 'mcp';

export type CapabilityState =
  | { state: 'supported' }
  | { state: 'unsupported'; reason: string }
  | { state: 'needs-attention'; reason: string };

export interface ManagerSafetyCapabilitiesV2 {
  localOnly: true;
  requiresExplicitReview: true;
}

export interface ManagerProviderDiscoveryV2 {
  provider: ManagerProviderId;
  displayName: string;
  presence: 'installed' | 'not-found' | 'needs-attention';
  detected: boolean;
  capabilities: Record<ManagerContentId, CapabilityState>;
}

export interface ManagerSourceInventoryItemV2 {
  provider: ManagerProviderId;
  content: ManagerContentId;
  path: string | null;
  readable: boolean;
  exists: boolean;
  items: string[];
  issue?: string;
}

export interface ManagerEnrollmentCellV2 {
  provider: ManagerProviderId;
  content: ManagerContentId;
  enrolled: boolean;
  capability: CapabilityState;
  destinationPath: string | null;
}

export interface ManagerEnrollmentProviderV2 {
  provider: ManagerProviderId;
  displayName: string;
  enabled: boolean;
  cells: Record<ManagerContentId, ManagerEnrollmentCellV2>;
}

export type ManagerMcpScope =
  | { kind: 'shared' }
  | { kind: 'provider'; provider: ManagerProviderId };

export type ManagerMcpConflictStatus =
  | { state: 'none' }
  | { state: 'conflict'; displayName: string; conflictingIds: string[] };

export interface ManagerMcpServerSummaryV2 {
  id: string;
  name: string;
  displayName: string;
  scope: ManagerMcpScope;
  overrideOf: string | null;
  affectedProviders: ManagerProviderId[];
  conflictStatus: ManagerMcpConflictStatus;
  transport: 'command' | 'url' | 'invalid';
  envKeys: string[];
  issues: string[];
}

export interface ManagerMasterSummaryV2 {
  rules: {
    sharedDocuments: number;
    providerOverlays: Record<ManagerProviderId, number>;
  };
  skills: {
    sharedSkills: number;
    providerScopedSkills: Record<ManagerProviderId, number>;
  };
  mcp: {
    sharedServers: ManagerMcpServerSummaryV2[];
    providerServers: Record<ManagerProviderId, ManagerMcpServerSummaryV2[]>;
  };
}

export interface ManagerEffectiveProviderCompositionV2 {
  provider: ManagerProviderId;
  displayName: string;
  contents: Partial<Record<ManagerContentId, ManagerEffectiveContentV2>>;
}

export interface ManagerEffectiveContentV2 {
  enrolled: true;
  destinationPath: string;
  masterItems: number;
  capability: CapabilityState;
  compositionRevision?: string;
  lastAppliedCompositionRevision?: string;
  mcpServers?: ManagerMcpServerSummaryV2[];
}

export type ManagerDerivedStateNameV2 = 'draftOnly' | 'changesReady' | 'upToDate' | 'driftDetected' | 'blocked';
export type ManagerDerivedStateReasonV2 =
  | 'noDestinationsEnrolled'
  | 'contentNeedsAttention'
  | 'contentUnsupported'
  | 'requiredMcpEnvironmentMissing'
  | 'managedOutputMissing'
  | 'managedOutputModified'
  | 'noAppliedRevision'
  | 'compositionRevisionChanged'
  | 'compositionRevisionCurrent';

export interface ManagerDerivedStateV2 {
  state: ManagerDerivedStateNameV2;
  reasons: ManagerDerivedStateReasonV2[];
}

export type ManagerIssueCodeV2 =
  | 'INVALID_CONTENT'
  | 'STALE_PLAN'
  | 'MISSING_MCP_ENVIRONMENT'
  | 'UNREADABLE_SOURCE'
  | 'OPERATION_FAILED'
  | 'PARTIAL_SNAPSHOT'
  | 'INTERRUPTED_OPERATION_RECOVERED';

export type ManagerIssueSeverityV2 = 'info' | 'warning' | 'error';

export interface ManagerIssueV2 {
  code: ManagerIssueCodeV2;
  severity: ManagerIssueSeverityV2;
  message: string;
  recoverable: boolean;
  provider?: ManagerProviderId;
  content?: ManagerContentId;
  path?: string;
  operationId?: string;
  command?: string;
}

export interface ManagerErrorResponseV2 {
  version: 2;
  contract: 'manager-error';
  error: ManagerIssueV2;
}

export interface ManagerStructuredPlanSummaryV2 {
  available: false;
  reason: 'snapshot-read-only';
  entries: ManagerStructuredPlanEntryV2[];
}

export interface ManagerStructuredPlanEntryV2 {
  provider: ManagerProviderId;
  content: ManagerContentId;
  destinationPath: string | null;
  state: 'eligible' | 'unenrolled' | 'unsupported' | 'needs-attention';
  reason?: string;
}

export interface ManagerDriftInboxItemV2 {
  provider: string;
  content: ManagerContentId;
  outputPath: string;
  status: 'clean' | 'modified' | 'missing' | 'unknown';
  issue?: string;
}

export type ManagerOperationLifecycle = 'pending' | 'completed' | 'rolled-back' | 'restored';

export interface ManagerReceiptListItemV2 {
  id: string;
  lifecycle: ManagerOperationLifecycle;
  startedAt: string;
  completedAt: string | null;
  targetCount: number;
  masterRevision?: string;
}

export interface ManagerManifestOutputV2 {
  provider: string;
  content: ManagerContentId;
  hash: string;
  appliedAt: string;
  backedUpTo: string | null;
  managedKeys?: string[];
  masterRevision?: string;
  compositionRevision?: string;
}

export interface ManagerReceiptTargetV2 {
  path: string;
  snapshot: string | null;
  snapshotKind: 'file' | 'directory' | 'missing';
  manifestOutputBefore: ManagerManifestOutputV2 | null;
}

export interface ManagerReceiptRecoveryV2 {
  attempted: boolean;
  recovered: boolean;
  message?: string;
}

export interface ManagerReceiptDetailV2 {
  id: string;
  lifecycle: ManagerOperationLifecycle;
  startedAt: string;
  completedAt: string | null;
  structuredPreviewDigest?: string;
  masterRevision?: string;
  compositionRevisions?: Record<string, string>;
  targets: ManagerReceiptTargetV2[];
  recovery: ManagerReceiptRecoveryV2;
}

export interface ManagerLegacyStateV2 {
  present: boolean;
  paths: string[];
}

export interface ManagerSnapshotV2 {
  version: 2;
  contract: 'manager-snapshot';
  regletHome: string;
  safety: ManagerSafetyCapabilitiesV2;
  providerDiscovery: ManagerProviderDiscoveryV2[];
  sourceInventory: ManagerSourceInventoryItemV2[];
  enrollmentMatrix: ManagerEnrollmentProviderV2[];
  master: ManagerMasterSummaryV2;
  masterRevision?: string;
  state: ManagerDerivedStateV2;
  problems: ManagerIssueV2[];
  effectiveProviders: ManagerEffectiveProviderCompositionV2[];
  structuredPlan: ManagerStructuredPlanSummaryV2;
  driftInbox: ManagerDriftInboxItemV2[];
  receipts: {
    list: ManagerReceiptListItemV2[];
    details: ManagerReceiptDetailV2[];
  };
  legacyNetworkState: ManagerLegacyStateV2;
}

export function isManagerSnapshotV2(value: unknown): value is ManagerSnapshotV2 {
  return isRecord(value) &&
    value.version === 2 &&
    value.contract === 'manager-snapshot' &&
    typeof value.regletHome === 'string' &&
    isSafety(value.safety) &&
    isArrayOf(value.providerDiscovery, isProviderDiscovery) &&
    isArrayOf(value.sourceInventory, isSourceInventoryItem) &&
    isArrayOf(value.enrollmentMatrix, isEnrollmentProvider) &&
    isMasterSummary(value.master) &&
    optionalString(value.masterRevision) &&
    isDerivedState(value.state) &&
    isArrayOf(value.problems, isIssue) &&
    isArrayOf(value.effectiveProviders, isEffectiveProvider) &&
    isStructuredPlan(value.structuredPlan) &&
    isArrayOf(value.driftInbox, isDriftItem) &&
    isRecord(value.receipts) &&
    isArrayOf(value.receipts.list, isReceiptListItem) &&
    isArrayOf(value.receipts.details, isReceiptDetail) &&
    isLegacyState(value.legacyNetworkState);
}

function isSafety(value: unknown): value is ManagerSafetyCapabilitiesV2 {
  return isRecord(value) && value.localOnly === true && value.requiresExplicitReview === true;
}

function isProviderDiscovery(value: unknown): value is ManagerProviderDiscoveryV2 {
  return isRecord(value) && isProvider(value.provider) && typeof value.displayName === 'string' &&
    (value.presence === 'installed' || value.presence === 'not-found' || value.presence === 'needs-attention') &&
    typeof value.detected === 'boolean' && isContentRecord(value.capabilities, isCapability);
}

function isSourceInventoryItem(value: unknown): value is ManagerSourceInventoryItemV2 {
  return isRecord(value) && isProvider(value.provider) && isContent(value.content) && nullableString(value.path) &&
    typeof value.readable === 'boolean' && typeof value.exists === 'boolean' && isArrayOf(value.items, isString) &&
    optionalString(value.issue);
}

function isEnrollmentProvider(value: unknown): value is ManagerEnrollmentProviderV2 {
  return isRecord(value) && isProvider(value.provider) && typeof value.displayName === 'string' &&
    typeof value.enabled === 'boolean' && isContentRecord(value.cells, isEnrollmentCell);
}

function isEnrollmentCell(value: unknown): value is ManagerEnrollmentCellV2 {
  return isRecord(value) && isProvider(value.provider) && isContent(value.content) &&
    typeof value.enrolled === 'boolean' && isCapability(value.capability) && nullableString(value.destinationPath);
}

function isMasterSummary(value: unknown): value is ManagerMasterSummaryV2 {
  return isRecord(value) && isRecord(value.rules) && typeof value.rules.sharedDocuments === 'number' &&
    isProviderRecord(value.rules.providerOverlays, isNumber) && isRecord(value.skills) &&
    typeof value.skills.sharedSkills === 'number' && isProviderRecord(value.skills.providerScopedSkills, isNumber) &&
    isRecord(value.mcp) && isArrayOf(value.mcp.sharedServers, isMcpServerSummary) &&
    isProviderRecord(value.mcp.providerServers, (item): item is ManagerMcpServerSummaryV2[] => isArrayOf(item, isMcpServerSummary));
}

function isMcpServerSummary(value: unknown): value is ManagerMcpServerSummaryV2 {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.displayName === 'string' && isMcpScope(value.scope) && nullableString(value.overrideOf) &&
    isArrayOf(value.affectedProviders, isProvider) && isMcpConflict(value.conflictStatus) &&
    (value.transport === 'command' || value.transport === 'url' || value.transport === 'invalid') &&
    isArrayOf(value.envKeys, isString) && isArrayOf(value.issues, isString);
}

function isEffectiveProvider(value: unknown): value is ManagerEffectiveProviderCompositionV2 {
  return isRecord(value) && isProvider(value.provider) && typeof value.displayName === 'string' &&
    isRecord(value.contents) && Object.entries(value.contents).every(([key, item]) => isContent(key) && isEffectiveContent(item));
}

function isEffectiveContent(value: unknown): value is ManagerEffectiveContentV2 {
  return isRecord(value) && value.enrolled === true && typeof value.destinationPath === 'string' &&
    typeof value.masterItems === 'number' && isCapability(value.capability) &&
    optionalString(value.compositionRevision) && optionalString(value.lastAppliedCompositionRevision) &&
    (value.mcpServers === undefined || isArrayOf(value.mcpServers, isMcpServerSummary));
}

function isDerivedState(value: unknown): value is ManagerDerivedStateV2 {
  return isRecord(value) &&
    (value.state === 'draftOnly' || value.state === 'changesReady' || value.state === 'upToDate' ||
      value.state === 'driftDetected' || value.state === 'blocked') &&
    isArrayOf(value.reasons, isDerivedReason);
}

function isIssue(value: unknown): value is ManagerIssueV2 {
  return isRecord(value) && isIssueCode(value.code) &&
    (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') &&
    typeof value.message === 'string' && typeof value.recoverable === 'boolean' &&
    (value.provider === undefined || isProvider(value.provider)) &&
    (value.content === undefined || isContent(value.content)) && optionalString(value.path) &&
    optionalString(value.operationId) && optionalString(value.command);
}

function isStructuredPlan(value: unknown): value is ManagerStructuredPlanSummaryV2 {
  return isRecord(value) && value.available === false && value.reason === 'snapshot-read-only' &&
    isArrayOf(value.entries, isStructuredPlanEntry);
}

function isStructuredPlanEntry(value: unknown): value is ManagerStructuredPlanEntryV2 {
  return isRecord(value) && isProvider(value.provider) && isContent(value.content) &&
    nullableString(value.destinationPath) &&
    (value.state === 'eligible' || value.state === 'unenrolled' || value.state === 'unsupported' || value.state === 'needs-attention') &&
    optionalString(value.reason);
}

function isDriftItem(value: unknown): value is ManagerDriftInboxItemV2 {
  return isRecord(value) && typeof value.provider === 'string' && isContent(value.content) &&
    typeof value.outputPath === 'string' &&
    (value.status === 'clean' || value.status === 'modified' || value.status === 'missing' || value.status === 'unknown') &&
    optionalString(value.issue);
}

function isReceiptListItem(value: unknown): value is ManagerReceiptListItemV2 {
  return isRecord(value) && typeof value.id === 'string' && isLifecycle(value.lifecycle) &&
    typeof value.startedAt === 'string' && nullableString(value.completedAt) &&
    typeof value.targetCount === 'number' && optionalString(value.masterRevision);
}

function isReceiptDetail(value: unknown): value is ManagerReceiptDetailV2 {
  return isRecord(value) && typeof value.id === 'string' && isLifecycle(value.lifecycle) &&
    typeof value.startedAt === 'string' && nullableString(value.completedAt) &&
    optionalString(value.structuredPreviewDigest) && optionalString(value.masterRevision) &&
    optionalStringRecord(value.compositionRevisions) && isArrayOf(value.targets, isReceiptTarget) &&
    isRecovery(value.recovery);
}

function isReceiptTarget(value: unknown): value is ManagerReceiptTargetV2 {
  return isRecord(value) && typeof value.path === 'string' && nullableString(value.snapshot) &&
    (value.snapshotKind === 'file' || value.snapshotKind === 'directory' || value.snapshotKind === 'missing') &&
    (value.manifestOutputBefore === null || isManifestOutput(value.manifestOutputBefore));
}

function isManifestOutput(value: unknown): value is ManagerManifestOutputV2 {
  return isRecord(value) && typeof value.provider === 'string' && isContent(value.content) &&
    typeof value.hash === 'string' && typeof value.appliedAt === 'string' && nullableString(value.backedUpTo) &&
    (value.managedKeys === undefined || isArrayOf(value.managedKeys, isString)) && optionalString(value.masterRevision) &&
    optionalString(value.compositionRevision);
}

function isRecovery(value: unknown): value is ManagerReceiptRecoveryV2 {
  return isRecord(value) && typeof value.attempted === 'boolean' && typeof value.recovered === 'boolean' &&
    optionalString(value.message);
}

function isLegacyState(value: unknown): value is ManagerLegacyStateV2 {
  return isRecord(value) && typeof value.present === 'boolean' && isArrayOf(value.paths, isString);
}

function isCapability(value: unknown): value is CapabilityState {
  return isRecord(value) && (value.state === 'supported' ||
    ((value.state === 'unsupported' || value.state === 'needs-attention') && typeof value.reason === 'string'));
}

function isMcpScope(value: unknown): value is ManagerMcpScope {
  return isRecord(value) && (value.kind === 'shared' || (value.kind === 'provider' && isProvider(value.provider)));
}

function isMcpConflict(value: unknown): value is ManagerMcpConflictStatus {
  return isRecord(value) && (value.state === 'none' ||
    (value.state === 'conflict' && typeof value.displayName === 'string' && isArrayOf(value.conflictingIds, isString)));
}

function isDerivedReason(value: unknown): value is ManagerDerivedStateReasonV2 {
  return derivedReasons.includes(value as ManagerDerivedStateReasonV2);
}

function isIssueCode(value: unknown): value is ManagerIssueCodeV2 {
  return issueCodes.includes(value as ManagerIssueCodeV2);
}

function isLifecycle(value: unknown): value is ManagerOperationLifecycle {
  return value === 'pending' || value === 'completed' || value === 'rolled-back' || value === 'restored';
}

function isProvider(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isContent(value: unknown): value is ManagerContentId {
  return typeof value === 'string' && contentIds.includes(value as ManagerContentId);
}

function isContentRecord<T>(value: unknown, validator: (item: unknown) => item is T): value is Record<ManagerContentId, T> {
  return isRecord(value) && contentIds.every((content) => validator(value[content]));
}

function isProviderRecord<T>(value: unknown, validator: (item: unknown) => item is T): value is Record<ManagerProviderId, T> {
  return isRecord(value) && providerIds.every((provider) => validator(value[provider]));
}

function isArrayOf<T>(value: unknown, validator: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(validator);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function optionalStringRecord(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(isString));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;
const derivedReasons: readonly ManagerDerivedStateReasonV2[] = [
  'noDestinationsEnrolled', 'contentNeedsAttention', 'contentUnsupported', 'requiredMcpEnvironmentMissing',
  'managedOutputMissing', 'managedOutputModified', 'noAppliedRevision', 'compositionRevisionChanged',
  'compositionRevisionCurrent',
];
const issueCodes: readonly ManagerIssueCodeV2[] = [
  'INVALID_CONTENT', 'STALE_PLAN', 'MISSING_MCP_ENVIRONMENT', 'UNREADABLE_SOURCE', 'OPERATION_FAILED',
  'PARTIAL_SNAPSHOT', 'INTERRUPTED_OPERATION_RECOVERED',
];
