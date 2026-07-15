import type { ApplyContent } from './engine/apply.js';
import type { OperationReceipt } from './engine/operations.js';
import type { EffectiveMcpServerEntry, McpConflictStatus, McpScope, McpServerEntry } from './mcp.js';
import type { ProviderId, ProviderInventory } from './providers/types.js';
import { providerNames, type ProviderName } from './config.js';
import type {
  CapabilityState,
  ManagerDerivedStateReasonV2,
  ManagerDerivedStateV2,
  ManagerDriftInboxItemV2,
  ManagerEffectiveContentV2,
  ManagerEffectiveProviderCompositionV2,
  ManagerEnrollmentCellV2,
  ManagerEnrollmentProviderV2,
  ManagerErrorResponseV2,
  ManagerIssueCodeV2,
  ManagerIssueSeverityV2,
  ManagerIssueV2,
  ManagerLegacyStateV2,
  ManagerMasterSummaryV2,
  ManagerMcpServerSummaryV2,
  ManagerProviderDiscoveryV2,
  ManagerReceiptDetailV2,
  ManagerReceiptListItemV2,
  ManagerSafetyCapabilitiesV2,
  ManagerSnapshotV2,
  ManagerSourceInventoryItemV2,
  ManagerStructuredPlanEntryV2,
  ManagerStructuredPlanSummaryV2,
} from '@reglet/manager-protocol';

export type {
  CapabilityState,
  ManagerDerivedStateNameV2,
  ManagerDerivedStateReasonV2,
  ManagerDerivedStateV2,
  ManagerDriftInboxItemV2,
  ManagerEffectiveContentV2,
  ManagerEffectiveProviderCompositionV2,
  ManagerEnrollmentCellV2,
  ManagerEnrollmentProviderV2,
  ManagerErrorResponseV2,
  ManagerIssueCodeV2,
  ManagerIssueSeverityV2,
  ManagerIssueV2,
  ManagerLegacyStateV2,
  ManagerManifestOutputV2,
  ManagerMasterSummaryV2,
  ManagerMcpConflictStatus,
  ManagerMcpScope,
  ManagerMcpServerSummaryV2,
  ManagerOperationLifecycle,
  ManagerProviderDiscoveryV2,
  ManagerReceiptDetailV2,
  ManagerReceiptListItemV2,
  ManagerReceiptRecoveryV2,
  ManagerReceiptTargetV2,
  ManagerSafetyCapabilitiesV2,
  ManagerSnapshotV2,
  ManagerSourceInventoryItemV2,
  ManagerStructuredPlanEntryV2,
  ManagerStructuredPlanSummaryV2,
} from '@reglet/manager-protocol';

export type ManagerContractVersion = 1 | 2;

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

export function managerIssueMessage(code: ManagerIssueCodeV2): string {
  switch (code) {
  case 'INVALID_CONTENT': return 'Reglet found content that must be corrected before this action can continue.';
  case 'STALE_PLAN': return 'This reviewed plan is no longer current. Review the latest changes and try again.';
  case 'MISSING_MCP_ENVIRONMENT': return 'A required local environment variable for an MCP server is missing.';
  case 'UNREADABLE_SOURCE': return 'Reglet could not read one local source needed for the Manager snapshot.';
  case 'OPERATION_FAILED': return 'The operation failed and Reglet preserved recoverable state where possible.';
  case 'PARTIAL_SNAPSHOT': return 'The Manager snapshot is partial because one local read failed.';
  case 'INTERRUPTED_OPERATION_RECOVERED': return 'Reglet recovered an interrupted operation before reporting Manager state.';
  }
}

export function managerIssue(
  code: ManagerIssueCodeV2,
  options: Omit<ManagerIssueV2, 'code' | 'message' | 'severity' | 'recoverable'> & {
    message?: string;
    severity?: ManagerIssueSeverityV2;
    recoverable?: boolean;
  } = {},
): ManagerIssueV2 {
  return {
    code,
    severity: options.severity ?? managerIssueSeverity(code),
    message: options.message ?? managerIssueMessage(code),
    recoverable: options.recoverable ?? code !== 'STALE_PLAN',
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.content === undefined ? {} : { content: options.content }),
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    ...(options.command === undefined ? {} : { command: options.command }),
  };
}

export function managerErrorFromUnknown(error: unknown, command: string): ManagerErrorResponseV2 {
  const code = classifyManagerIssue(error instanceof Error ? error.message : String(error));
  return {
    version: 2,
    contract: 'manager-error',
    error: managerIssue(code, { command }),
  };
}

export function redactManagerValue<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  return redactUnknown(value, secretValues(env)) as T;
}

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
    id: entry.id,
    name: entry.name,
    displayName: entry.displayName,
    scope: entry.scope,
    overrideOf: entry.overrideOf,
    affectedProviders: entry.affectedProviders,
    conflictStatus: entry.conflictStatus,
    transport: entry.server.command !== undefined ? 'command' : entry.server.url !== undefined ? 'url' : 'invalid',
    envKeys: Object.keys(entry.server.env ?? {}).sort((left, right) => left.localeCompare(right)),
    issues: entry.issues,
  };
}

export function effectiveMcpServerSummary(entry: EffectiveMcpServerEntry): ManagerMcpServerSummaryV2 {
  return {
    id: entry.id,
    name: entry.displayName,
    displayName: entry.displayName,
    scope: entry.scope,
    overrideOf: entry.overrideOf,
    affectedProviders: entry.scope.kind === 'provider' ? [entry.scope.provider] : [...providerNames],
    conflictStatus: entry.conflictStatus,
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
    isArrayOf(value.problems, isManagerIssueV2) &&
    isArrayOf(value.effectiveProviders, isEffectiveProviderCompositionV2) &&
    isStructuredPlanSummaryV2(value.structuredPlan) &&
    isArrayOf(value.driftInbox, isDriftInboxItemV2) &&
    isRecord(value.receipts) &&
    isArrayOf(value.receipts.list, isReceiptListItemV2) &&
    isArrayOf(value.receipts.details, isReceiptDetailV2) &&
    isLegacyState(value.legacyNetworkState)
  );
}

function isManagerIssueV2(value: unknown): value is ManagerIssueV2 {
  return isRecord(value) &&
    isManagerIssueCodeV2(value.code) &&
    (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') &&
    typeof value.message === 'string' &&
    typeof value.recoverable === 'boolean' &&
    optionalProviderId(value.provider) &&
    optionalContent(value.content) &&
    optionalString(value.path) &&
    optionalString(value.operationId) &&
    optionalString(value.command);
}

function isManagerIssueCodeV2(value: unknown): value is ManagerIssueCodeV2 {
  return value === 'INVALID_CONTENT' ||
    value === 'STALE_PLAN' ||
    value === 'MISSING_MCP_ENVIRONMENT' ||
    value === 'UNREADABLE_SOURCE' ||
    value === 'OPERATION_FAILED' ||
    value === 'PARTIAL_SNAPSHOT' ||
    value === 'INTERRUPTED_OPERATION_RECOVERED';
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
    isArrayOf(value.mcp.sharedServers, isMcpServerSummaryV2) &&
    isProviderArrayRecord(value.mcp.providerServers, isMcpServerSummaryV2);
}

function isMcpServerSummaryV2(value: unknown): value is ManagerMcpServerSummaryV2 {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.displayName === 'string' &&
    isMcpScope(value.scope) &&
    (typeof value.overrideOf === 'string' || value.overrideOf === null) &&
    isArrayOf(value.affectedProviders, isProviderId) &&
    isMcpConflictStatus(value.conflictStatus) &&
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
    optionalString(value.lastAppliedCompositionRevision) &&
    (value.mcpServers === undefined || isArrayOf(value.mcpServers, isMcpServerSummaryV2));
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

function isProviderArrayRecord<T>(value: unknown, item: (candidate: unknown) => candidate is T): value is Record<ProviderName, T[]> {
  return isRecord(value) && providerIds.every((provider) => isArrayOf(value[provider], item));
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

function optionalProviderId(value: unknown): boolean {
  return value === undefined || isProviderId(value);
}

function optionalContent(value: unknown): boolean {
  return value === undefined || isContent(value);
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

function isMcpScope(value: unknown): value is McpScope {
  return isRecord(value) &&
    (value.kind === 'shared' || (value.kind === 'provider' && isProviderId(value.provider)));
}

function isMcpConflictStatus(value: unknown): value is McpConflictStatus {
  return isRecord(value) &&
    (value.state === 'none' ||
      (value.state === 'conflict' && typeof value.displayName === 'string' && isArrayOf(value.conflictingIds, isString)));
}

function isLifecycle(value: unknown): value is OperationReceipt['lifecycle'] {
  return value === 'pending' || value === 'completed' || value === 'rolled-back' || value === 'restored';
}

function classifyManagerIssue(message: string): ManagerIssueCodeV2 {
  if (message.includes('stale')) return 'STALE_PLAN';
  if (message.includes('Missing process environment')) return 'MISSING_MCP_ENVIRONMENT';
  if (message.includes('Invalid') || message.includes('Unsupported') || message.includes('validation issues') || message.includes('raw env')) return 'INVALID_CONTENT';
  if (message.includes('EACCES') || message.includes('EPERM') || message.includes('permission')) return 'UNREADABLE_SOURCE';
  return 'OPERATION_FAILED';
}

function managerIssueSeverity(code: ManagerIssueCodeV2): ManagerIssueSeverityV2 {
  if (code === 'INTERRUPTED_OPERATION_RECOVERED') return 'warning';
  if (code === 'PARTIAL_SNAPSHOT') return 'warning';
  return 'error';
}

function redactUnknown(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, secrets));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactUnknown(item, secrets)]),
  );
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join('<redacted:secret>');
  }
  return redacted;
}

function secretValues(env: NodeJS.ProcessEnv): string[] {
  return Array.from(new Set(
    Object.entries(env)
      .filter(([key, value]) =>
        value !== undefined &&
        value.length >= 8 &&
        /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API[_-]?KEY/i.test(key))
      .map(([, value]) => value)
      .filter((value): value is string => value !== undefined),
  ));
}

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;
