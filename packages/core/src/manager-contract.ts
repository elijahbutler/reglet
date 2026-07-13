import type { ApplyContent } from './engine/apply.js';
import type { DriftStatus } from './engine/drift.js';
import type { OperationReceipt } from './engine/operations.js';
import type { ManagedContent } from './manifest.js';
import type { McpServerEntry } from './mcp.js';
import type { ProviderId, ProviderInventory } from './providers/types.js';
import type { ProviderName } from './config.js';

export type ManagerContractVersion = 1 | 2;
export type CapabilityState =
  | { state: 'supported' }
  | { state: 'unsupported'; reason: string }
  | { state: 'needs-attention'; reason: string };

export interface ManagerSafetyCapabilitiesV2 {
  localOnly: true;
  networkSync: false;
  daemon: false;
  notifications: false;
  requiresExplicitReview: true;
}

export interface ManagerProviderDiscoveryV2 {
  provider: ProviderId;
  displayName: string;
  presence: 'installed' | 'not-found' | 'needs-attention';
  detected: boolean;
  capabilities: Record<ApplyContent, CapabilityState>;
}

export interface ManagerSourceInventoryItemV2 {
  provider: ProviderId;
  content: ApplyContent;
  path: string | null;
  readable: boolean;
  exists: boolean;
  items: string[];
  issue?: string;
}

export interface ManagerEnrollmentCellV2 {
  provider: ProviderId;
  content: ApplyContent;
  enrolled: boolean;
  capability: CapabilityState;
  destinationPath: string | null;
}

export interface ManagerEnrollmentProviderV2 {
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  cells: Record<ApplyContent, ManagerEnrollmentCellV2>;
}

export interface ManagerMasterSummaryV2 {
  rules: {
    sharedDocuments: number;
    providerOverlays: Record<ProviderName, number>;
  };
  skills: {
    sharedSkills: number;
    providerScopedSkills: Record<ProviderName, number>;
  };
  mcp: {
    sharedServers: ManagerMcpServerSummaryV2[];
  };
}

export interface ManagerMcpServerSummaryV2 {
  name: string;
  transport: 'command' | 'url' | 'invalid';
  envKeys: string[];
  issues: string[];
}

export interface ManagerEffectiveProviderCompositionV2 {
  provider: ProviderId;
  displayName: string;
  contents: Partial<Record<ApplyContent, ManagerEffectiveContentV2>>;
}

export interface ManagerEffectiveContentV2 {
  enrolled: true;
  destinationPath: string;
  masterItems: number;
  capability: CapabilityState;
  compositionRevision?: string;
  lastAppliedCompositionRevision?: string;
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

export interface ManagerStructuredPlanSummaryV2 {
  available: false;
  reason: 'snapshot-read-only';
  entries: ManagerStructuredPlanEntryV2[];
}

export interface ManagerStructuredPlanEntryV2 {
  provider: ProviderId;
  content: ApplyContent;
  destinationPath: string | null;
  state: 'eligible' | 'unenrolled' | 'unsupported' | 'needs-attention';
  reason?: string;
}

export interface ManagerDriftInboxItemV2 {
  provider: string;
  content: ManagedContent;
  outputPath: string;
  status: DriftStatus | 'unknown';
  issue?: string;
}

export interface ManagerReceiptListItemV2 {
  id: string;
  lifecycle: OperationReceipt['lifecycle'];
  startedAt: string;
  completedAt: string | null;
  targetCount: number;
  masterRevision?: string;
}

export interface ManagerReceiptDetailV2 {
  id: string;
  lifecycle: OperationReceipt['lifecycle'];
  startedAt: string;
  completedAt: string | null;
  structuredPreviewDigest?: string;
  masterRevision?: string;
  compositionRevisions?: Record<string, string>;
  targets: OperationReceipt['targets'];
  recovery: OperationReceipt['recovery'];
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
  effectiveProviders: ManagerEffectiveProviderCompositionV2[];
  structuredPlan: ManagerStructuredPlanSummaryV2;
  driftInbox: ManagerDriftInboxItemV2[];
  receipts: {
    list: ManagerReceiptListItemV2[];
    details: ManagerReceiptDetailV2[];
  };
  legacyNetworkState: ManagerLegacyStateV2;
}

export interface JsonSchemaCheck<T> {
  readonly version: ManagerContractVersion;
  validate(value: unknown): value is T;
}

export const managerSnapshotV2Schema: JsonSchemaCheck<ManagerSnapshotV2> = {
  version: 2,
  validate: isManagerSnapshotV2,
};

export const managerContractSchemas = {
  providerDiscovery: { version: 2, validate: isProviderDiscoveryV2 },
  sourceInventory: { version: 2, validate: isSourceInventoryItemV2 },
  enrollmentCell: { version: 2, validate: isEnrollmentCellV2 },
  masterSummary: { version: 2, validate: isMasterSummaryV2 },
  effectiveProviderComposition: { version: 2, validate: isEffectiveProviderCompositionV2 },
  structuredPlanSummary: { version: 2, validate: isStructuredPlanSummaryV2 },
  driftInboxItem: { version: 2, validate: isDriftInboxItemV2 },
  receiptListItem: { version: 2, validate: isReceiptListItemV2 },
  receiptDetail: { version: 2, validate: isReceiptDetailV2 },
  managerSnapshot: managerSnapshotV2Schema,
} as const;

export function validateManagerSnapshotV2(value: unknown): ManagerSnapshotV2 {
  if (!isManagerSnapshotV2(value)) {
    throw new Error('Invalid manager snapshot v2 contract');
  }
  return value;
}

export function supportedCapability(): CapabilityState {
  return { state: 'supported' };
}

export function unsupportedCapability(reason: string): CapabilityState {
  return { state: 'unsupported', reason };
}

export function needsAttentionCapability(reason: string): CapabilityState {
  return { state: 'needs-attention', reason };
}

export function receiptListItem(receipt: OperationReceipt): ManagerReceiptListItemV2 {
  return {
    id: receipt.id,
    lifecycle: receipt.lifecycle,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    targetCount: receipt.targets.length,
    ...(receipt.masterRevision === undefined ? {} : { masterRevision: receipt.masterRevision }),
  };
}

export function receiptDetail(receipt: OperationReceipt): ManagerReceiptDetailV2 {
  return {
    id: receipt.id,
    lifecycle: receipt.lifecycle,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    ...(receipt.structuredPreviewDigest === undefined ? {} : { structuredPreviewDigest: receipt.structuredPreviewDigest }),
    ...(receipt.masterRevision === undefined ? {} : { masterRevision: receipt.masterRevision }),
    ...(receipt.compositionRevisions === undefined ? {} : { compositionRevisions: receipt.compositionRevisions }),
    targets: receipt.targets,
    recovery: receipt.recovery,
  };
}

export function mcpServerSummary(entry: McpServerEntry): ManagerMcpServerSummaryV2 {
  return {
    name: entry.name,
    transport: entry.server.command !== undefined ? 'command' : entry.server.url !== undefined ? 'url' : 'invalid',
    envKeys: Object.keys(entry.server.env ?? {}).sort((left, right) => left.localeCompare(right)),
    issues: entry.issues,
  };
}

export function inventoryItems(
  provider: ProviderId,
  inventory: ProviderInventory,
  issues: Partial<Record<ApplyContent, string>> = {},
): ManagerSourceInventoryItemV2[] {
  return [
    {
      provider,
      content: 'rules',
      path: inventory.rulesPath,
      readable: inventory.rulesExists && issues.rules === undefined,
      exists: inventory.rulesExists,
      items: inventory.rulesExists ? [inventory.rulesPath ?? ''] : [],
      ...(issues.rules === undefined ? {} : { issue: issues.rules }),
    },
    {
      provider,
      content: 'skills',
      path: inventory.skillsDir,
      readable: inventory.skillsDir !== null && issues.skills === undefined,
      exists: inventory.skills.length > 0,
      items: inventory.skills,
      ...(issues.skills === undefined ? {} : { issue: issues.skills }),
    },
    {
      provider,
      content: 'mcp',
      path: inventory.mcpPath,
      readable: inventory.mcpPath !== null && issues.mcp === undefined,
      exists: inventory.mcpServers.length > 0,
      items: inventory.mcpServers,
      ...(issues.mcp === undefined ? {} : { issue: issues.mcp }),
    },
  ];
}

function isManagerSnapshotV2(value: unknown): value is ManagerSnapshotV2 {
  if (!isRecord(value)) return false;
  return (
    value.version === 2 &&
    value.contract === 'manager-snapshot' &&
    typeof value.regletHome === 'string' &&
    isSafety(value.safety) &&
    isArrayOf(value.providerDiscovery, isProviderDiscoveryV2) &&
    isArrayOf(value.sourceInventory, isSourceInventoryItemV2) &&
    isArrayOf(value.enrollmentMatrix, isEnrollmentProviderV2) &&
    isMasterSummaryV2(value.master) &&
    optionalString(value.masterRevision) &&
    isDerivedStateV2(value.state) &&
    isArrayOf(value.effectiveProviders, isEffectiveProviderCompositionV2) &&
    isStructuredPlanSummaryV2(value.structuredPlan) &&
    isArrayOf(value.driftInbox, isDriftInboxItemV2) &&
    isRecord(value.receipts) &&
    isArrayOf(value.receipts.list, isReceiptListItemV2) &&
    isArrayOf(value.receipts.details, isReceiptDetailV2) &&
    isLegacyState(value.legacyNetworkState)
  );
}

function isProviderDiscoveryV2(value: unknown): value is ManagerProviderDiscoveryV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    typeof value.displayName === 'string' &&
    (value.presence === 'installed' || value.presence === 'not-found' || value.presence === 'needs-attention') &&
    typeof value.detected === 'boolean' &&
    isContentRecord(value.capabilities, isCapability);
}

function isSourceInventoryItemV2(value: unknown): value is ManagerSourceInventoryItemV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    isContent(value.content) &&
    (typeof value.path === 'string' || value.path === null) &&
    typeof value.readable === 'boolean' &&
    typeof value.exists === 'boolean' &&
    isArrayOf(value.items, isString) &&
    optionalString(value.issue);
}

function isEnrollmentProviderV2(value: unknown): value is ManagerEnrollmentProviderV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    typeof value.displayName === 'string' &&
    typeof value.enabled === 'boolean' &&
    isContentRecord(value.cells, isEnrollmentCellV2);
}

function isEnrollmentCellV2(value: unknown): value is ManagerEnrollmentCellV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    isContent(value.content) &&
    typeof value.enrolled === 'boolean' &&
    isCapability(value.capability) &&
    (typeof value.destinationPath === 'string' || value.destinationPath === null);
}

function isMasterSummaryV2(value: unknown): value is ManagerMasterSummaryV2 {
  return isRecord(value) &&
    isRecord(value.rules) &&
    typeof value.rules.sharedDocuments === 'number' &&
    isProviderNumberRecord(value.rules.providerOverlays) &&
    isRecord(value.skills) &&
    typeof value.skills.sharedSkills === 'number' &&
    isProviderNumberRecord(value.skills.providerScopedSkills) &&
    isRecord(value.mcp) &&
    isArrayOf(value.mcp.sharedServers, isMcpServerSummaryV2);
}

function isMcpServerSummaryV2(value: unknown): value is ManagerMcpServerSummaryV2 {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    (value.transport === 'command' || value.transport === 'url' || value.transport === 'invalid') &&
    isArrayOf(value.envKeys, isString) &&
    isArrayOf(value.issues, isString);
}

function isEffectiveProviderCompositionV2(value: unknown): value is ManagerEffectiveProviderCompositionV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    typeof value.displayName === 'string' &&
    isPartialContentRecord(value.contents, isEffectiveContentV2);
}

function isEffectiveContentV2(value: unknown): value is ManagerEffectiveContentV2 {
  return isRecord(value) &&
    value.enrolled === true &&
    typeof value.destinationPath === 'string' &&
    typeof value.masterItems === 'number' &&
    isCapability(value.capability) &&
    optionalString(value.compositionRevision) &&
    optionalString(value.lastAppliedCompositionRevision);
}

function isDerivedStateV2(value: unknown): value is ManagerDerivedStateV2 {
  return isRecord(value) &&
    (value.state === 'draftOnly' || value.state === 'changesReady' || value.state === 'upToDate' || value.state === 'driftDetected' || value.state === 'blocked') &&
    isArrayOf(value.reasons, isDerivedStateReason);
}

function isDerivedStateReason(value: unknown): value is ManagerDerivedStateReasonV2 {
  return value === 'noDestinationsEnrolled' ||
    value === 'contentNeedsAttention' ||
    value === 'contentUnsupported' ||
    value === 'requiredMcpEnvironmentMissing' ||
    value === 'managedOutputMissing' ||
    value === 'managedOutputModified' ||
    value === 'noAppliedRevision' ||
    value === 'compositionRevisionChanged' ||
    value === 'compositionRevisionCurrent';
}

function isStructuredPlanSummaryV2(value: unknown): value is ManagerStructuredPlanSummaryV2 {
  return isRecord(value) &&
    value.available === false &&
    value.reason === 'snapshot-read-only' &&
    isArrayOf(value.entries, isStructuredPlanEntryV2);
}

function isStructuredPlanEntryV2(value: unknown): value is ManagerStructuredPlanEntryV2 {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    isContent(value.content) &&
    (typeof value.destinationPath === 'string' || value.destinationPath === null) &&
    (value.state === 'eligible' || value.state === 'unenrolled' || value.state === 'unsupported' || value.state === 'needs-attention') &&
    optionalString(value.reason);
}

function isDriftInboxItemV2(value: unknown): value is ManagerDriftInboxItemV2 {
  return isRecord(value) &&
    typeof value.provider === 'string' &&
    isContent(value.content) &&
    typeof value.outputPath === 'string' &&
    (value.status === 'clean' || value.status === 'modified' || value.status === 'missing' || value.status === 'unknown') &&
    optionalString(value.issue);
}

function isReceiptListItemV2(value: unknown): value is ManagerReceiptListItemV2 {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isLifecycle(value.lifecycle) &&
    typeof value.startedAt === 'string' &&
    (typeof value.completedAt === 'string' || value.completedAt === null) &&
    optionalString(value.masterRevision) &&
    typeof value.targetCount === 'number';
}

function isReceiptDetailV2(value: unknown): value is ManagerReceiptDetailV2 {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isLifecycle(value.lifecycle) &&
    typeof value.startedAt === 'string' &&
    (typeof value.completedAt === 'string' || value.completedAt === null) &&
    optionalString(value.structuredPreviewDigest) &&
    optionalString(value.masterRevision) &&
    optionalStringRecord(value.compositionRevisions) &&
    isArrayOf(value.targets, isReceiptTarget) &&
    isRecord(value.recovery) &&
    typeof value.recovery.attempted === 'boolean' &&
    typeof value.recovery.recovered === 'boolean' &&
    optionalString(value.recovery.message);
}

function isReceiptTarget(value: unknown): value is OperationReceipt['targets'][number] {
  return isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.snapshot === 'string' || value.snapshot === null) &&
    (value.snapshotKind === 'file' || value.snapshotKind === 'directory' || value.snapshotKind === 'missing') &&
    (isRecord(value.manifestOutputBefore) || value.manifestOutputBefore === null);
}

function isSafety(value: unknown): value is ManagerSafetyCapabilitiesV2 {
  return isRecord(value) &&
    value.localOnly === true &&
    value.networkSync === false &&
    value.daemon === false &&
    value.notifications === false &&
    value.requiresExplicitReview === true;
}

function isLegacyState(value: unknown): value is ManagerLegacyStateV2 {
  return isRecord(value) &&
    typeof value.present === 'boolean' &&
    isArrayOf(value.paths, isString);
}

function isCapability(value: unknown): value is CapabilityState {
  return isRecord(value) &&
    (value.state === 'supported' ||
      ((value.state === 'unsupported' || value.state === 'needs-attention') && typeof value.reason === 'string'));
}

function isProviderNumberRecord(value: unknown): value is Record<ProviderName, number> {
  return isRecord(value) && providerIds.every((provider) => typeof value[provider] === 'number');
}

function isContentRecord<T>(value: unknown, item: (candidate: unknown) => candidate is T): value is Record<ApplyContent, T> {
  return isRecord(value) && contentIds.every((content) => item(value[content]));
}

function isPartialContentRecord<T>(value: unknown, item: (candidate: unknown) => candidate is T): value is Partial<Record<ApplyContent, T>> {
  return isRecord(value) && Object.entries(value).every(([key, candidate]) => isContent(key) && item(candidate));
}

function isArrayOf<T>(value: unknown, item: (candidate: unknown) => candidate is T): value is T[] {
  return Array.isArray(value) && value.every(item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalStringRecord(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every((item) => typeof item === 'string'));
}

function isContent(value: unknown): value is ApplyContent {
  return value === 'rules' || value === 'skills' || value === 'mcp';
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && providerIds.includes(value as ProviderId);
}

function isLifecycle(value: unknown): value is OperationReceipt['lifecycle'] {
  return value === 'pending' || value === 'completed' || value === 'rolled-back' || value === 'restored';
}

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;
