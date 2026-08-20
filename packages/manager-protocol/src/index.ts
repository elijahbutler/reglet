export const managerProtocolVersion = 2 as const;
export const legacyManagerProtocolVersion = 1 as const;
export const managerProtocolVersions = [legacyManagerProtocolVersion, managerProtocolVersion] as const;

export * from './snapshot-v2.js';
export * from './snapshot-v3.js';
export * from './sync.js';
export * from './projection-review.js';
export * from './recovery.js';
export * from './provider-lifecycle.js';
import {
  isManagerSnapshotV2,
  type ManagerContentId,
  type ManagerProviderId,
  type ManagerSnapshotV2,
} from './snapshot-v2.js';
import {
  isManagerSnapshotV3,
  type ManagerArtifactKind,
  type ManagerSessionScope,
  type ManagerSnapshotV3,
} from './snapshot-v3.js';

export const managerProtocolV1Operations = [
  'snapshot',
  'scan',
  'plan',
  'onboard',
  'enroll',
  'unenroll',
  'status',
  'import-drift',
  'rules.list',
  'rules.read',
  'rules.write',
  'rules.source-read',
  'rules.merge-runners',
  'rules.merge-draft',
  'skills.list',
  'skills.tree',
  'skills.read',
  'skills.inspect',
  'skills.write',
  'skills.create',
  'skills.delete',
  'skills.rename',
  'skills.delete-file',
  'skills.rename-file',
  'skills.adopt',
  'skills.update-sync',
  'mcp.list',
  'mcp.upsert',
  'mcp.delete',
  'mcp.update-sync',
  'structured-preview.preview',
  'structured-preview.apply',
  'operation.restore',
  'legacy-state.clear',
  'sync.preview.set',
  'sync.snapshot',
  'sync.bootstrap.start',
  'sync.invitation.create',
  'sync.pair.request',
  'sync.pair.approve',
  'sync.pair.status',
  'sync.pair.complete',
  'sync.pair.cancel',
  'sync.run',
  'sync.device.rename',
  'sync.device.revoke',
  'sync.disconnect',
] as const;

export const managerProtocolOperations = [
  ...managerProtocolV1Operations,
  'library.list',
  'library.show',
  'library.create',
  'library.duplicate',
  'library.save',
  'library.rename',
  'library.archive',
  'library.restore',
  'library.delete',
  'library.targets',
  'provider.list',
  'provider.effective',
  'provider.preview',
  'provider.review',
  'provider.apply',
  'provider.source.preview',
  'provider.source.adopt',
  'provider.source.stop-managing.preview',
  'provider.source.stop-managing',
  'provider.source.start-managing',
  'provider.restore.preview',
  'provider.restore',
  'provider.purge-backups.preview',
  'provider.purge-backups',
  'project.root.add',
  'project.root.remove',
  'project.root.list',
  'project.scan',
  'project.discoveries',
  'project.ignore',
  'project.promotion-preview',
  'project.promote',
  'skill.inspect',
  'skill.trust',
  'secret.set',
  'secret.delete',
  'secret.status',
  'history.list',
  'history.undo',
  'activity.list',
  'recovery.list',
  'recovery.preview',
  'recovery.restore',
  'search',
  'sync.configure',
  'sync.disable',
  'sync.status',
  'sync.now',
  'sync.conflict.preview',
  'sync.resolve',
  'remote.enable',
  'remote.disable',
  'remote.status',
  'session.pair',
  'session.list',
  'session.revoke',
  'diagnostics',
  'external.open',
  'external.reveal',
  'migration.preview',
  'migration.apply',
  'migration.status',
  'setup.complete',
] as const;

export const managerProtocolErrorCodes = [
  'MALFORMED_REQUEST',
  'UNKNOWN_PROTOCOL_VERSION',
  'UNKNOWN_OPERATION',
  'INVALID_INPUT',
  'STALE_PLAN',
  'OPERATION_FAILED',
  'INTERNAL_ERROR',
  'UNSUPPORTED_VERSION',
  'REVISION_CONFLICT',
  'AUTHENTICATION_REQUIRED',
  'PERMISSION_DENIED',
  'BLOCKED_PROJECTION',
  'DRIFT_CONFLICT',
  'MIGRATION_REQUIRED',
  'NOT_FOUND',
  'RATE_LIMITED',
] as const;

export type ManagerProtocolVersion = (typeof managerProtocolVersions)[number];
export type ManagerProtocolV1Operation = (typeof managerProtocolV1Operations)[number];
export type ManagerProtocolOperation = (typeof managerProtocolOperations)[number];
export type ManagerProtocolErrorCode = (typeof managerProtocolErrorCodes)[number];
export type ManagerScopeKind = 'shared' | 'provider';
export type ManagerMergeRunnerId = 'codex' | 'claude' | 'gemini';

/**
 * Commands that advance the shared Manager revision.
 *
 * The runtime, every transport client, and test clients must use this registry
 * so read commands never carry stale optimistic-concurrency headers.
 */
export const managerMutatingOperations = [
  'library.create',
  'library.duplicate',
  'library.save',
  'library.rename',
  'library.archive',
  'library.restore',
  'library.delete',
  'library.targets',
  'provider.apply',
  'provider.source.adopt',
  'provider.source.stop-managing',
  'provider.source.start-managing',
  'provider.restore',
  'provider.purge-backups',
  'project.root.add',
  'project.root.remove',
  'project.scan',
  'project.ignore',
  'project.promote',
  'skill.trust',
  'secret.set',
  'secret.delete',
  'history.undo',
  'recovery.restore',
  'sync.configure',
  'sync.disable',
  'sync.now',
  'sync.resolve',
  'remote.enable',
  'remote.disable',
  'session.pair',
  'session.revoke',
  'migration.apply',
  'sync.preview.set',
  'sync.bootstrap.start',
  'sync.invitation.create',
  'sync.pair.request',
  'sync.pair.approve',
  'sync.pair.complete',
  'sync.pair.cancel',
  'sync.run',
  'sync.device.rename',
  'sync.device.revoke',
  'sync.disconnect',
  'setup.complete',
] as const satisfies readonly ManagerProtocolOperation[];

const managerMutatingOperationSet = new Set<ManagerProtocolOperation>(managerMutatingOperations);

export function isManagerMutatingOperation(operation: ManagerProtocolOperation): boolean {
  return managerMutatingOperationSet.has(operation);
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ProviderContentSelectionInput = JsonObject & {
  providers?: ManagerProviderId[];
  contents?: ManagerContentId[];
};

export type SnapshotInput = JsonObject & {
  contractVersion?: 1 | 2 | 3;
};

export type OnboardInput = ProviderContentSelectionInput & {
  stageOnly?: boolean;
};

export type ProviderTargetInput = JsonObject & {
  target?: string;
  provider?: ManagerProviderId;
  content?: ManagerContentId;
};

export type ImportDriftInput = JsonObject & {
  provider: ManagerProviderId;
  content: ManagerContentId;
  scope?: ManagerScopeKind;
};

export type PathInput = JsonObject & {
  path: string;
};

export type WriteTextInput = PathInput & {
  content: string;
};

export type RulesMergeDraftInput = JsonObject & {
  providers: ManagerProviderId[];
  runner?: ManagerMergeRunnerId;
  steeringPrompt?: string;
};

export type ProviderInput = JsonObject & {
  provider: ManagerProviderId;
};

export type ProviderReviewInput = JsonObject & {
  units: Array<{
    provider: ManagerProviderId;
    content: ManagerContentId;
  }>;
};

export type ProviderSourceDestination = 'shared' | 'provider';

export type ProviderSourcePreviewInput = JsonObject & {
  provider: ManagerProviderId;
  content: ManagerContentId;
  name?: string;
  destination: ProviderSourceDestination;
  targets?: ManagerProviderId[];
};

export type ProviderSourceAdoptInput = ProviderSourcePreviewInput & {
  previewDigest: string;
  confirmedExecutableRevision?: string;
};

export type ProviderSourceManagementInput = JsonObject & {
  provider: ManagerProviderId;
  content: ManagerContentId;
};
export type ProviderSourceStopManagingInput = ProviderSourceManagementInput & { digest: string; confirmed: true };

export type ScopedInput = JsonObject & {
  scope?: ManagerScopeKind;
  provider?: ManagerProviderId;
};

export type SkillInput = ScopedInput & {
  name: string;
};

export type SkillPathInput = SkillInput & {
  path: string;
};

export type SkillWriteInput = SkillPathInput & {
  content: string;
};

export type SkillCreateInput = SkillInput & {
  content?: string;
};

export type SkillRenameInput = SkillInput & {
  newName: string;
};

export type SkillRenameFileInput = SkillPathInput & {
  newPath: string;
};

export type SkillInspectInput = JsonObject & {
  provider: ManagerProviderId;
  name: string;
  path?: string;
};

export type SkillAdoptInput = JsonObject & {
  provider: ManagerProviderId;
  name: string;
  scope: ManagerScopeKind;
  overwrite?: boolean;
};

export type McpListInput = ScopedInput & {
  effectiveProvider?: ManagerProviderId;
};

export type McpUpsertInput = ScopedInput & {
  id: string;
  displayName?: string;
  server: JsonObject;
};

export type McpDeleteInput = ScopedInput & {
  id: string;
};

export type SkillSyncInput = JsonObject & {
  name: string;
  providers: ManagerProviderId[];
};

export type McpSyncInput = JsonObject & {
  id: string;
  providers: ManagerProviderId[];
};

export type StructuredPreviewApplyInput = ProviderContentSelectionInput & {
  digest: string;
};

export type IdInput = JsonObject & {
  id: string;
};

export type SyncPreviewSetInput = JsonObject & { acknowledged: boolean };
export type SyncConnectionStartInput = JsonObject & { connectUrl: string; deviceName: string };
export type SyncPairRequestInput = JsonObject & { serverUrl?: string; connectUrl?: string; deviceName: string };
export type SyncPairApproveInput = JsonObject & { code: string };
export type SyncPairCompleteInput = JsonObject & { fingerprint: string };
export type SyncDeviceRenameInput = JsonObject & { deviceId: string; name: string };
export type SyncDeviceRevokeInput = JsonObject & { deviceId: string };
export type SyncDisconnectInput = JsonObject & { localOnly?: boolean };

export type ArtifactReferenceInput = JsonObject & { artifact: string };
export type LibraryListInput = JsonObject & {
  kind?: ManagerArtifactKind;
  lifecycle?: 'active' | 'archived';
};
export type LibraryCreateInput = JsonObject & {
  kind: ManagerArtifactKind;
  slug: string;
  title: string;
  content: string;
  description?: string;
  tags?: string[];
  targets?: ManagerProviderId[];
  scope?: JsonObject;
};
export type LibrarySaveInput = ArtifactReferenceInput & { content: string };
export type LibraryRenameInput = ArtifactReferenceInput & { slug: string };
export type ConfirmedArtifactInput = ArtifactReferenceInput & { confirmed: boolean };
export type LibraryTargetsInput = ArtifactReferenceInput & { targets: ManagerProviderId[] };
export type ProviderArtifactInput = ArtifactReferenceInput & { provider: ManagerProviderId };
export type ProviderApplyUnitInput = JsonObject & {
  provider: ManagerProviderId;
  content: ManagerContentId;
  digest: string;
};
export type ProviderApplyInput = JsonObject & {
  batchDigest: string;
  units: ProviderApplyUnitInput[];
  confirmDrift?: boolean;
};
export type ProviderRestorePreviewInput = JsonObject & { provider: ManagerProviderId };
export type ProviderRestoreInput = ProviderRestorePreviewInput & { digest: string; confirmed: true };
export type ProviderPurgeBackupsPreviewInput = JsonObject & { provider: ManagerProviderId };
export type ProviderPurgeBackupsInput = ProviderPurgeBackupsPreviewInput & { digest: string; confirmed: true };
export type ProjectRootAddInput = JsonObject & { path: string; label?: string };
export type ProjectRootRemoveInput = JsonObject & { rootId: string; confirmed: boolean };
export type ProjectScanInput = JsonObject & { rootId?: string; reappearChangedIgnored?: boolean };
export type ProjectDiscoveriesInput = JsonObject & {
  rootId?: string;
  state?: 'new' | 'changed' | 'promoted' | 'conflict' | 'ignored';
};
export type DiscoveryInput = JsonObject & { discoveryId: string };
export type PromotionPreviewInput = DiscoveryInput & {
  mode?: 'global-instruction' | 'convert-to-skill' | 'disabled-draft';
};
export type PromoteInput = PromotionPreviewInput & {
  targets?: ManagerProviderId[];
  confirmedExecutableRevision?: string;
  destinationArtifact?: string;
  selectedHunks?: string[];
  selectedFiles?: string[];
  serverName?: string;
};
export type SkillTrustInput = ArtifactReferenceInput & { revision: string; confirmed: boolean };
export type SecretSetInput = JsonObject & { id: string; value: string };
export type SecretIdInput = JsonObject & { id: string };
export type HistoryUndoInput = ArtifactReferenceInput & { revision?: string; confirmed: boolean };
export type ActivityListInput = JsonObject & { limit?: number };
export type RecoveryListInput = JsonObject & { limit?: number };
export type RecoveryReceiptInput = JsonObject & { receiptId: string };
export type RecoveryRestoreInput = RecoveryReceiptInput & { digest: string; confirmed: true };
export type SearchInput = JsonObject & { query: string; limit?: number };
export type SyncConfigureInput = JsonObject & { serverUrl: string };
export type SyncConflictPreviewInput = JsonObject & { path: string };
export type SyncResolveInput = JsonObject & { path: string; choice: 'ours' | 'theirs' };
export type RemoteEnableInput = JsonObject & { endpoint: string };
export type SessionPairInput = JsonObject & { scope: ManagerSessionScope };
export type SessionRevokeInput = JsonObject & { sessionId: string };
export type ExternalTargetInput = JsonObject & {
  kind: 'canonical' | 'provider' | 'project';
  artifact?: string;
  provider?: ManagerProviderId;
  content?: ManagerContentId;
  discoveryId?: string;
};
export type ExternalInput = JsonObject & { target: ExternalTargetInput };
export type MigrationApplyInput = JsonObject & { yes: boolean; previewDigest: string };
export type SetupCompleteInput = JsonObject & {
  createGlobalDefaults: boolean;
  globalInstructionContent?: string;
  targets?: ManagerProviderId[];
  rootPath?: string;
  scanProject?: boolean;
};

export interface ManagerRpcInputs {
  snapshot: SnapshotInput;
  scan: JsonObject;
  plan: ProviderContentSelectionInput;
  onboard: OnboardInput;
  enroll: ProviderTargetInput;
  unenroll: ProviderTargetInput;
  status: JsonObject;
  'import-drift': ImportDriftInput;
  'rules.list': JsonObject;
  'rules.read': PathInput;
  'rules.write': WriteTextInput;
  'rules.source-read': ProviderInput;
  'rules.merge-runners': JsonObject;
  'rules.merge-draft': RulesMergeDraftInput;
  'skills.list': JsonObject;
  'skills.tree': SkillInput;
  'skills.read': SkillPathInput;
  'skills.inspect': SkillInspectInput;
  'skills.write': SkillWriteInput;
  'skills.create': SkillCreateInput;
  'skills.delete': SkillInput;
  'skills.rename': SkillRenameInput;
  'skills.delete-file': SkillPathInput;
  'skills.rename-file': SkillRenameFileInput;
  'skills.adopt': SkillAdoptInput;
  'skills.update-sync': SkillSyncInput;
  'mcp.list': McpListInput;
  'mcp.upsert': McpUpsertInput;
  'mcp.delete': McpDeleteInput;
  'mcp.update-sync': McpSyncInput;
  'structured-preview.preview': ProviderContentSelectionInput;
  'structured-preview.apply': StructuredPreviewApplyInput;
  'operation.restore': IdInput;
  'legacy-state.clear': JsonObject;
  'sync.preview.set': SyncPreviewSetInput;
  'sync.snapshot': JsonObject;
  'sync.bootstrap.start': SyncConnectionStartInput;
  'sync.invitation.create': JsonObject;
  'sync.pair.request': SyncPairRequestInput;
  'sync.pair.approve': SyncPairApproveInput;
  'sync.pair.status': JsonObject;
  'sync.pair.complete': SyncPairCompleteInput;
  'sync.pair.cancel': JsonObject;
  'sync.run': JsonObject;
  'sync.device.rename': SyncDeviceRenameInput;
  'sync.device.revoke': SyncDeviceRevokeInput;
  'sync.disconnect': SyncDisconnectInput;
  'library.list': LibraryListInput;
  'library.show': ArtifactReferenceInput;
  'library.create': LibraryCreateInput;
  'library.duplicate': ArtifactReferenceInput;
  'library.save': LibrarySaveInput;
  'library.rename': LibraryRenameInput;
  'library.archive': ArtifactReferenceInput;
  'library.restore': ArtifactReferenceInput;
  'library.delete': ConfirmedArtifactInput;
  'library.targets': LibraryTargetsInput;
  'provider.list': JsonObject;
  'provider.effective': ProviderInput;
  'provider.preview': ProviderArtifactInput;
  'provider.review': ProviderReviewInput;
  'provider.apply': ProviderApplyInput;
  'provider.source.preview': ProviderSourcePreviewInput;
  'provider.source.adopt': ProviderSourceAdoptInput;
  'provider.source.stop-managing.preview': ProviderSourceManagementInput;
  'provider.source.stop-managing': ProviderSourceStopManagingInput;
  'provider.source.start-managing': ProviderSourceManagementInput;
  'provider.restore.preview': ProviderRestorePreviewInput;
  'provider.restore': ProviderRestoreInput;
  'provider.purge-backups.preview': ProviderPurgeBackupsPreviewInput;
  'provider.purge-backups': ProviderPurgeBackupsInput;
  'project.root.add': ProjectRootAddInput;
  'project.root.remove': ProjectRootRemoveInput;
  'project.root.list': JsonObject;
  'project.scan': ProjectScanInput;
  'project.discoveries': ProjectDiscoveriesInput;
  'project.ignore': DiscoveryInput;
  'project.promotion-preview': PromotionPreviewInput;
  'project.promote': PromoteInput;
  'skill.inspect': ArtifactReferenceInput;
  'skill.trust': SkillTrustInput;
  'secret.set': SecretSetInput;
  'secret.delete': SecretIdInput;
  'secret.status': SecretIdInput;
  'history.list': ArtifactReferenceInput;
  'history.undo': HistoryUndoInput;
  'activity.list': ActivityListInput;
  'recovery.list': RecoveryListInput;
  'recovery.preview': RecoveryReceiptInput;
  'recovery.restore': RecoveryRestoreInput;
  search: SearchInput;
  'sync.configure': SyncConfigureInput;
  'sync.disable': JsonObject;
  'sync.status': JsonObject;
  'sync.now': JsonObject;
  'sync.conflict.preview': SyncConflictPreviewInput;
  'sync.resolve': SyncResolveInput;
  'remote.enable': RemoteEnableInput;
  'remote.disable': JsonObject;
  'remote.status': JsonObject;
  'session.pair': SessionPairInput;
  'session.list': JsonObject;
  'session.revoke': SessionRevokeInput;
  diagnostics: JsonObject;
  'external.open': ExternalInput;
  'external.reveal': ExternalInput;
  'migration.preview': JsonObject;
  'migration.apply': MigrationApplyInput;
  'migration.status': JsonObject;
  'setup.complete': SetupCompleteInput;
}

export type ManagerRpcRequestFor<Operation extends ManagerProtocolOperation> = {
  protocolVersion: ManagerProtocolVersion;
  operation: Operation;
  input?: ManagerRpcInputs[Operation];
};

export type ManagerRpcRequest = {
  [Operation in ManagerProtocolOperation]: ManagerRpcRequestFor<Operation>
}[ManagerProtocolOperation];

export interface ManagerRpcError {
  code: ManagerProtocolErrorCode;
  message: string;
  recoverable: boolean;
}

export interface ManagerRpcSuccessResponse {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation;
  ok: true;
  result: JsonValue;
}

export interface ManagerRpcFailureResponse {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation | 'unknown';
  ok: false;
  error: ManagerRpcError;
}

export type ManagerRpcResponse = ManagerRpcSuccessResponse | ManagerRpcFailureResponse;

export interface RuntimeValidator<T> {
  readonly schema: JsonObject;
  validate(value: unknown): value is T;
}

const providerIds: ManagerProviderId[] = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'];
const contentIds: ManagerContentId[] = ['rules', 'skills', 'mcp'];

export const requestEnvelopeSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['protocolVersion', 'operation'],
  properties: {
    protocolVersion: { enum: [...managerProtocolVersions] },
    operation: { enum: [...managerProtocolOperations] },
    input: {},
  },
};

export const responseEnvelopeSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['protocolVersion', 'operation', 'ok', 'result'],
      properties: {
        protocolVersion: { enum: [...managerProtocolVersions] },
        operation: { enum: [...managerProtocolOperations] },
        ok: { const: true },
        result: {},
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['protocolVersion', 'operation', 'ok', 'error'],
      properties: {
        protocolVersion: { enum: [...managerProtocolVersions] },
        operation: { anyOf: [{ enum: [...managerProtocolOperations] }, { const: 'unknown' }] },
        ok: { const: false },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message', 'recoverable'],
          properties: {
            code: { enum: [...managerProtocolErrorCodes] },
            message: { type: 'string' },
            recoverable: { type: 'boolean' },
          },
        },
      },
    },
  ],
};

const providerSelectionProperties: JsonObject = {
  providers: { type: 'array', items: { enum: providerIds } },
  contents: { type: 'array', items: { enum: contentIds } },
};
const scopedProperties: JsonObject = {
  scope: { enum: ['shared', 'provider'] },
  provider: { enum: providerIds },
};

export const operationInputSchemas: Record<ManagerProtocolOperation, JsonObject> = {
  snapshot: objectSchema({ contractVersion: { enum: [1, 2, 3] } }),
  scan: objectSchema({}),
  plan: objectSchema(providerSelectionProperties),
  onboard: objectSchema({ ...providerSelectionProperties, stageOnly: { type: 'boolean' } }),
  enroll: objectSchema({ target: { type: 'string' }, provider: { enum: providerIds }, content: { enum: contentIds } }),
  unenroll: objectSchema({ target: { type: 'string' }, provider: { enum: providerIds }, content: { enum: contentIds } }),
  status: objectSchema({}),
  'import-drift': objectSchema({ provider: { enum: providerIds }, content: { enum: contentIds }, scope: { enum: ['shared', 'provider'] } }, ['provider', 'content']),
  'rules.list': objectSchema({}),
  'rules.read': objectSchema({ path: { type: 'string' } }, ['path']),
  'rules.write': objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  'rules.source-read': objectSchema({ provider: { enum: providerIds } }, ['provider']),
  'rules.merge-runners': objectSchema({}),
  'rules.merge-draft': objectSchema({
    providers: { type: 'array', items: { enum: providerIds } },
    runner: { enum: ['codex', 'claude', 'gemini'] },
    steeringPrompt: { type: 'string' },
  }, ['providers']),
  'skills.list': objectSchema({}),
  'skills.tree': objectSchema({ ...scopedProperties, name: { type: 'string' } }, ['name']),
  'skills.read': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' } }, ['name', 'path']),
  'skills.inspect': objectSchema({ provider: { enum: providerIds }, name: { type: 'string' }, path: { type: 'string' } }, ['provider', 'name']),
  'skills.write': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, ['name', 'path', 'content']),
  'skills.create': objectSchema({ ...scopedProperties, name: { type: 'string' }, content: { type: 'string' } }, ['name']),
  'skills.delete': objectSchema({ ...scopedProperties, name: { type: 'string' } }, ['name']),
  'skills.rename': objectSchema({ ...scopedProperties, name: { type: 'string' }, newName: { type: 'string' } }, ['name', 'newName']),
  'skills.delete-file': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' } }, ['name', 'path']),
  'skills.rename-file': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' }, newPath: { type: 'string' } }, ['name', 'path', 'newPath']),
  'skills.adopt': objectSchema({ provider: { enum: providerIds }, name: { type: 'string' }, scope: { enum: ['shared', 'provider'] }, overwrite: { type: 'boolean' } }, ['provider', 'name', 'scope']),
  'skills.update-sync': objectSchema({ name: { type: 'string' }, providers: { type: 'array', items: { enum: providerIds } } }, ['name', 'providers']),
  'mcp.list': objectSchema({ ...scopedProperties, effectiveProvider: { enum: providerIds } }),
  'mcp.upsert': objectSchema({ ...scopedProperties, id: { type: 'string' }, displayName: { type: 'string' }, server: { type: 'object' } }, ['id', 'server']),
  'mcp.delete': objectSchema({ ...scopedProperties, id: { type: 'string' } }, ['id']),
  'mcp.update-sync': objectSchema({ id: { type: 'string' }, providers: { type: 'array', items: { enum: providerIds } } }, ['id', 'providers']),
  'structured-preview.preview': objectSchema(providerSelectionProperties),
  'structured-preview.apply': objectSchema({ ...providerSelectionProperties, digest: { type: 'string' } }, ['digest']),
  'operation.restore': objectSchema({ id: { type: 'string' } }, ['id']),
  'legacy-state.clear': objectSchema({}),
  'sync.preview.set': objectSchema({ acknowledged: { type: 'boolean' } }, ['acknowledged']),
  'sync.snapshot': objectSchema({}),
  'sync.bootstrap.start': objectSchema({ connectUrl: { type: 'string' }, deviceName: { type: 'string' } }, ['connectUrl', 'deviceName']),
  'sync.invitation.create': objectSchema({}),
  'sync.pair.request': objectSchema({ serverUrl: { type: 'string' }, connectUrl: { type: 'string' }, deviceName: { type: 'string' } }, ['deviceName']),
  'sync.pair.approve': objectSchema({ code: { type: 'string' } }, ['code']),
  'sync.pair.status': objectSchema({}),
  'sync.pair.complete': objectSchema({ fingerprint: { type: 'string' } }, ['fingerprint']),
  'sync.pair.cancel': objectSchema({}),
  'sync.run': objectSchema({}),
  'sync.device.rename': objectSchema({ deviceId: { type: 'string' }, name: { type: 'string' } }, ['deviceId', 'name']),
  'sync.device.revoke': objectSchema({ deviceId: { type: 'string' } }, ['deviceId']),
  'sync.disconnect': objectSchema({ localOnly: { type: 'boolean' } }),
  'library.list': objectSchema({ kind: { enum: ['instruction', 'skill', 'mcp'] }, lifecycle: { enum: ['active', 'archived'] } }),
  'library.show': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'library.create': objectSchema({
    kind: { enum: ['instruction', 'skill', 'mcp'] },
    slug: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    targets: { type: 'array', items: { enum: providerIds } },
    scope: {
      oneOf: [
        objectSchema({ kind: { const: 'global' } }, ['kind']),
        objectSchema({ kind: { const: 'provider-overlay' }, provider: { enum: providerIds } }, ['kind', 'provider']),
      ],
    },
  }, ['kind', 'slug', 'title', 'content']),
  'library.duplicate': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'library.save': objectSchema({ artifact: { type: 'string' }, content: { type: 'string' } }, ['artifact', 'content']),
  'library.rename': objectSchema({ artifact: { type: 'string' }, slug: { type: 'string' } }, ['artifact', 'slug']),
  'library.archive': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'library.restore': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'library.delete': objectSchema({ artifact: { type: 'string' }, confirmed: { type: 'boolean' } }, ['artifact', 'confirmed']),
  'library.targets': objectSchema({ artifact: { type: 'string' }, targets: { type: 'array', items: { enum: providerIds } } }, ['artifact', 'targets']),
  'provider.list': objectSchema({}),
  'provider.effective': objectSchema({ provider: { enum: providerIds } }, ['provider']),
  'provider.preview': objectSchema({ artifact: { type: 'string' }, provider: { enum: providerIds } }, ['artifact', 'provider']),
  'provider.review': objectSchema({
    units: {
      type: 'array',
      minItems: 1,
      maxItems: 18,
      uniqueItems: true,
      items: objectSchema({ provider: { enum: providerIds }, content: { enum: contentIds } }, ['provider', 'content']),
    },
  }, ['units']),
  'provider.apply': objectSchema({
    batchDigest: { type: 'string' },
    units: {
      type: 'array',
      minItems: 1,
      maxItems: 18,
      uniqueItems: true,
      items: objectSchema({
        provider: { enum: providerIds },
        content: { enum: contentIds },
        digest: { type: 'string' },
      }, ['provider', 'content', 'digest']),
    },
    confirmDrift: { type: 'boolean' },
  }, ['batchDigest', 'units']),
  'provider.source.preview': objectSchema({
    provider: { enum: providerIds },
    content: { enum: contentIds },
    name: { type: 'string' },
    destination: { enum: ['shared', 'provider'] },
    targets: { type: 'array', items: { enum: providerIds }, uniqueItems: true },
  }, ['provider', 'content', 'destination']),
  'provider.source.adopt': objectSchema({
    provider: { enum: providerIds },
    content: { enum: contentIds },
    name: { type: 'string' },
    destination: { enum: ['shared', 'provider'] },
    targets: { type: 'array', items: { enum: providerIds }, uniqueItems: true },
    previewDigest: { type: 'string' },
    confirmedExecutableRevision: { type: 'string' },
  }, ['provider', 'content', 'destination', 'previewDigest']),
  'provider.source.stop-managing.preview': objectSchema({
    provider: { enum: providerIds },
    content: { enum: contentIds },
  }, ['provider', 'content']),
  'provider.source.stop-managing': objectSchema({
    provider: { enum: providerIds },
    content: { enum: contentIds },
    digest: { type: 'string' },
    confirmed: { const: true },
  }, ['provider', 'content', 'digest', 'confirmed']),
  'provider.source.start-managing': objectSchema({
    provider: { enum: providerIds },
    content: { enum: contentIds },
  }, ['provider', 'content']),
  'provider.restore.preview': objectSchema({ provider: { enum: providerIds } }, ['provider']),
  'provider.restore': objectSchema({
    provider: { enum: providerIds },
    digest: { type: 'string' },
    confirmed: { const: true },
  }, ['provider', 'digest', 'confirmed']),
  'provider.purge-backups.preview': objectSchema({ provider: { enum: providerIds } }, ['provider']),
  'provider.purge-backups': objectSchema({
    provider: { enum: providerIds },
    digest: { type: 'string' },
    confirmed: { const: true },
  }, ['provider', 'digest', 'confirmed']),
  'project.root.add': objectSchema({ path: { type: 'string' }, label: { type: 'string' } }, ['path']),
  'project.root.remove': objectSchema({ rootId: { type: 'string' }, confirmed: { type: 'boolean' } }, ['rootId', 'confirmed']),
  'project.root.list': objectSchema({}),
  'project.scan': objectSchema({ rootId: { type: 'string' }, reappearChangedIgnored: { type: 'boolean' } }),
  'project.discoveries': objectSchema({ rootId: { type: 'string' }, state: { enum: ['new', 'changed', 'promoted', 'conflict', 'ignored'] } }),
  'project.ignore': objectSchema({ discoveryId: { type: 'string' } }, ['discoveryId']),
  'project.promotion-preview': objectSchema({ discoveryId: { type: 'string' }, mode: { enum: ['global-instruction', 'convert-to-skill', 'disabled-draft'] } }, ['discoveryId']),
  'project.promote': objectSchema({
    discoveryId: { type: 'string' },
    mode: { enum: ['global-instruction', 'convert-to-skill', 'disabled-draft'] },
    targets: { type: 'array', items: { enum: providerIds } },
    confirmedExecutableRevision: { type: 'string' },
    destinationArtifact: { type: 'string' },
    selectedHunks: { type: 'array', items: { type: 'string' } },
    selectedFiles: { type: 'array', items: { type: 'string' } },
    serverName: { type: 'string' },
  }, ['discoveryId']),
  'skill.inspect': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'skill.trust': objectSchema({
    artifact: { type: 'string' },
    revision: { type: 'string' },
    confirmed: { type: 'boolean' },
  }, ['artifact', 'revision', 'confirmed']),
  'secret.set': objectSchema({ id: { type: 'string' }, value: { type: 'string' } }, ['id', 'value']),
  'secret.delete': objectSchema({ id: { type: 'string' } }, ['id']),
  'secret.status': objectSchema({ id: { type: 'string' } }, ['id']),
  'history.list': objectSchema({ artifact: { type: 'string' } }, ['artifact']),
  'history.undo': objectSchema({ artifact: { type: 'string' }, revision: { type: 'string' }, confirmed: { type: 'boolean' } }, ['artifact', 'confirmed']),
  'activity.list': objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 1_000 } }),
  'recovery.list': objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 1_000 } }),
  'recovery.preview': objectSchema({ receiptId: { type: 'string' } }, ['receiptId']),
  'recovery.restore': objectSchema({
    receiptId: { type: 'string' },
    digest: { type: 'string' },
    confirmed: { const: true },
  }, ['receiptId', 'digest', 'confirmed']),
  search: objectSchema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1_000 } }, ['query']),
  'sync.configure': objectSchema({ serverUrl: { type: 'string' } }, ['serverUrl']),
  'sync.disable': objectSchema({}),
  'sync.status': objectSchema({}),
  'sync.now': objectSchema({}),
  'sync.conflict.preview': objectSchema({ path: { type: 'string' } }, ['path']),
  'sync.resolve': objectSchema({ path: { type: 'string' }, choice: { enum: ['ours', 'theirs'] } }, ['path', 'choice']),
  'remote.enable': objectSchema({ endpoint: { type: 'string' } }, ['endpoint']),
  'remote.disable': objectSchema({}),
  'remote.status': objectSchema({}),
  'session.pair': objectSchema({ scope: { enum: ['read', 'write', 'admin'] } }, ['scope']),
  'session.list': objectSchema({}),
  'session.revoke': objectSchema({ sessionId: { type: 'string' } }, ['sessionId']),
  diagnostics: objectSchema({}),
  'external.open': externalInputSchema(),
  'external.reveal': externalInputSchema(),
  'migration.preview': objectSchema({}),
  'migration.apply': objectSchema({ yes: { const: true }, previewDigest: { type: 'string' } }, ['yes', 'previewDigest']),
  'migration.status': objectSchema({}),
  'setup.complete': objectSchema({
    createGlobalDefaults: { type: 'boolean' },
    globalInstructionContent: { type: 'string' },
    targets: { type: 'array', items: { enum: providerIds } },
    rootPath: { type: 'string' },
    scanProject: { type: 'boolean' },
  }, ['createGlobalDefaults']),
};

export const managerRpcRequestValidator: RuntimeValidator<ManagerRpcRequest> = {
  schema: requestEnvelopeSchema,
  validate: isManagerRpcRequest,
};

export const managerRpcResponseValidator: RuntimeValidator<ManagerRpcResponse> = {
  schema: responseEnvelopeSchema,
  validate: isManagerRpcResponse,
};

export const managerSnapshotV2DtoValidator: RuntimeValidator<ManagerSnapshotV2> = {
  schema: {
    type: 'object',
    required: [
      'version',
      'contract',
      'regletHome',
      'safety',
      'providerDiscovery',
      'sourceInventory',
      'enrollmentMatrix',
      'master',
      'state',
      'problems',
      'effectiveProviders',
      'structuredPlan',
      'driftInbox',
      'receipts',
      'legacyNetworkState',
    ],
    properties: {
      version: { const: 2 },
      contract: { const: 'manager-snapshot' },
    },
  },
  validate: isManagerSnapshotV2,
};

export const managerSnapshotV3DtoValidator: RuntimeValidator<ManagerSnapshotV3> = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'version',
      'contract',
      'protocolVersion',
      'revision',
      'permissions',
      'library',
      'providers',
      'activity',
      'settings',
      'diagnostics',
    ],
    properties: {
      version: { const: 3 },
      contract: { const: 'manager-snapshot' },
      protocolVersion: { const: 2 },
      revision: { type: 'integer', minimum: 0 },
      permissions: { type: 'object' },
      library: { type: 'object' },
      providers: { type: 'array' },
      projectInbox: { type: 'object' },
      activity: { type: 'array' },
      settings: { type: 'object' },
      diagnostics: { type: 'object' },
    },
  },
  validate: isManagerSnapshotV3,
};

export function isManagerProtocolOperation(value: unknown): value is ManagerProtocolOperation {
  return typeof value === 'string' && managerProtocolOperations.includes(value as ManagerProtocolOperation);
}

export function isManagerProtocolV1Operation(value: unknown): value is ManagerProtocolV1Operation {
  return typeof value === 'string' && managerProtocolV1Operations.includes(value as ManagerProtocolV1Operation);
}

export function isManagerProtocolVersion(value: unknown): value is ManagerProtocolVersion {
  return value === legacyManagerProtocolVersion || value === managerProtocolVersion;
}

export function isManagerProtocolErrorCode(value: unknown): value is ManagerProtocolErrorCode {
  return typeof value === 'string' && managerProtocolErrorCodes.includes(value as ManagerProtocolErrorCode);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return type !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isManagerRpcRequest(value: unknown): value is ManagerRpcRequest {
  if (!isManagerRpcEnvelope(value)) return false;
  const input = value.input ?? {};
  return isOperationInput(value.operation, input);
}

export function isManagerRpcEnvelope(value: unknown): value is {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation;
  input?: JsonObject;
} {
  if (!isRecord(value)) return false;
  if (!isManagerProtocolVersion(value.protocolVersion) ||
    !isManagerProtocolOperation(value.operation) ||
    (value.protocolVersion === legacyManagerProtocolVersion && !isManagerProtocolV1Operation(value.operation))) {
    return false;
  }
  return hasOnlyKeys(value, ['protocolVersion', 'operation', 'input']) &&
    (value.input === undefined || isJsonObject(value.input));
}

export function isManagerRpcResponse(value: unknown): value is ManagerRpcResponse {
  if (!isRecord(value)) return false;
  if (!isManagerProtocolVersion(value.protocolVersion)) return false;
  const isValidOperation = isManagerProtocolOperation(value.operation) &&
    (value.protocolVersion === managerProtocolVersion || isManagerProtocolV1Operation(value.operation));
  if (value.ok === true) {
    return hasOnlyKeys(value, ['protocolVersion', 'operation', 'ok', 'result']) &&
      isValidOperation && isJsonValue(value.result);
  }
  if (value.ok !== false) return false;
  if (!hasOnlyKeys(value, ['protocolVersion', 'operation', 'ok', 'error'])) return false;
  if (!(isValidOperation || value.operation === 'unknown')) return false;
  if (!isRecord(value.error)) return false;
  return hasOnlyKeys(value.error, ['code', 'message', 'recoverable']) &&
    isManagerProtocolErrorCode(value.error.code) &&
    typeof value.error.message === 'string' &&
    typeof value.error.recoverable === 'boolean';
}

export function successResponse(
  operation: ManagerProtocolOperation,
  result: JsonValue,
  protocolVersion: ManagerProtocolVersion = managerProtocolVersion,
): ManagerRpcSuccessResponse {
  return {
    protocolVersion,
    operation,
    ok: true,
    result,
  };
}

export function failureResponse(
  operation: ManagerProtocolOperation | 'unknown',
  code: ManagerProtocolErrorCode,
  message: string,
  recoverable: boolean,
  protocolVersion: ManagerProtocolVersion = managerProtocolVersion,
): ManagerRpcFailureResponse {
  return {
    protocolVersion,
    operation,
    ok: false,
    error: { code, message, recoverable },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectSchema(properties: JsonObject, required: string[] = []): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

function isOperationInput(operation: ManagerProtocolOperation, input: JsonObject): boolean {
  switch (operation) {
    case 'snapshot':
      return exact(input, ['contractVersion']) &&
        (input.contractVersion === undefined || input.contractVersion === 1 || input.contractVersion === 2 || input.contractVersion === 3);
    case 'scan':
    case 'status':
    case 'rules.list':
    case 'rules.merge-runners':
    case 'skills.list':
    case 'legacy-state.clear':
    case 'sync.snapshot':
    case 'sync.invitation.create':
    case 'sync.pair.status':
    case 'sync.pair.cancel':
    case 'sync.run':
    case 'provider.list':
    case 'project.root.list':
    case 'sync.disable':
    case 'sync.status':
    case 'sync.now':
    case 'remote.disable':
    case 'remote.status':
    case 'session.list':
    case 'diagnostics':
    case 'migration.preview':
    case 'migration.status':
      return exact(input, []);
    case 'plan':
    case 'structured-preview.preview':
      return isProviderSelection(input);
    case 'onboard':
      return isProviderSelection(input, ['stageOnly']) && optionalBoolean(input.stageOnly);
    case 'enroll':
    case 'unenroll':
      return exact(input, ['target', 'provider', 'content']) &&
        ((typeof input.target === 'string' && input.provider === undefined && input.content === undefined) ||
          (isProvider(input.provider) && optionalContent(input.content) && input.target === undefined));
    case 'import-drift':
      return exact(input, ['provider', 'content', 'scope']) && isProvider(input.provider) && isContent(input.content) && optionalScope(input.scope);
    case 'rules.read':
      return exact(input, ['path']) && typeof input.path === 'string';
    case 'rules.write':
      return exact(input, ['path', 'content']) && typeof input.path === 'string' && typeof input.content === 'string';
    case 'rules.source-read':
      return exact(input, ['provider']) && isProvider(input.provider);
    case 'rules.merge-draft':
      return exact(input, ['providers', 'runner', 'steeringPrompt']) && isProviderArray(input.providers) &&
        (input.runner === undefined || input.runner === 'codex' || input.runner === 'claude' || input.runner === 'gemini') &&
        optionalString(input.steeringPrompt);
    case 'skills.tree':
    case 'skills.delete':
      return isSkillBase(input, []);
    case 'skills.read':
    case 'skills.delete-file':
      return isSkillBase(input, ['path']) && typeof input.path === 'string';
    case 'skills.write':
      return isSkillBase(input, ['path', 'content']) && typeof input.path === 'string' && typeof input.content === 'string';
    case 'skills.create':
      return isSkillBase(input, ['content']) && optionalString(input.content);
    case 'skills.rename':
      return isSkillBase(input, ['newName']) && typeof input.newName === 'string';
    case 'skills.rename-file':
      return isSkillBase(input, ['path', 'newPath']) && typeof input.path === 'string' && typeof input.newPath === 'string';
    case 'skills.inspect':
      return exact(input, ['provider', 'name', 'path']) && isProvider(input.provider) && typeof input.name === 'string' && optionalString(input.path);
    case 'skills.adopt':
      return exact(input, ['provider', 'name', 'scope', 'overwrite']) && isProvider(input.provider) &&
        typeof input.name === 'string' && (input.scope === 'shared' || input.scope === 'provider') && optionalBoolean(input.overwrite);
    case 'skills.update-sync':
      return exact(input, ['name', 'providers']) && typeof input.name === 'string' && isProviderArray(input.providers);
    case 'mcp.list':
      return exact(input, ['scope', 'provider', 'effectiveProvider']) && isValidScope(input) && optionalProvider(input.effectiveProvider);
    case 'mcp.upsert':
      return exact(input, ['scope', 'provider', 'id', 'displayName', 'server']) && isValidScope(input) &&
        typeof input.id === 'string' && optionalString(input.displayName) && isJsonObject(input.server);
    case 'mcp.delete':
      return exact(input, ['scope', 'provider', 'id']) && isValidScope(input) && typeof input.id === 'string';
    case 'mcp.update-sync':
      return exact(input, ['id', 'providers']) && typeof input.id === 'string' && isProviderArray(input.providers);
    case 'structured-preview.apply':
      return isProviderSelection(input, ['digest']) && typeof input.digest === 'string';
    case 'operation.restore':
      return exact(input, ['id']) && typeof input.id === 'string';
    case 'sync.preview.set':
      return exact(input, ['acknowledged']) && typeof input.acknowledged === 'boolean';
    case 'sync.bootstrap.start':
      return exact(input, ['connectUrl', 'deviceName']) && typeof input.connectUrl === 'string' && typeof input.deviceName === 'string';
    case 'sync.pair.request':
      return exact(input, ['serverUrl', 'connectUrl', 'deviceName']) && optionalString(input.serverUrl) &&
        optionalString(input.connectUrl) && (typeof input.serverUrl === 'string' || typeof input.connectUrl === 'string') &&
        typeof input.deviceName === 'string';
    case 'sync.pair.approve':
      return exact(input, ['code']) && typeof input.code === 'string';
    case 'sync.pair.complete':
      return exact(input, ['fingerprint']) && typeof input.fingerprint === 'string';
    case 'sync.device.rename':
      return exact(input, ['deviceId', 'name']) && typeof input.deviceId === 'string' && typeof input.name === 'string';
    case 'sync.device.revoke':
      return exact(input, ['deviceId']) && typeof input.deviceId === 'string';
    case 'sync.disconnect':
      return exact(input, ['localOnly']) && optionalBoolean(input.localOnly);
    case 'library.list':
      return exact(input, ['kind', 'lifecycle']) && optionalArtifactKind(input.kind) &&
        (input.lifecycle === undefined || input.lifecycle === 'active' || input.lifecycle === 'archived');
    case 'library.show':
    case 'library.duplicate':
    case 'library.archive':
    case 'library.restore':
    case 'skill.inspect':
    case 'history.list':
      return isArtifactReference(input);
    case 'library.create':
      return exact(input, ['kind', 'slug', 'title', 'content', 'description', 'tags', 'targets', 'scope']) &&
        isArtifactKind(input.kind) && typeof input.slug === 'string' && typeof input.title === 'string' &&
        typeof input.content === 'string' && optionalString(input.description) && optionalStringArray(input.tags) &&
        optionalProviderArray(input.targets) && (input.scope === undefined || isArtifactScope(input.scope));
    case 'library.save':
      return exact(input, ['artifact', 'content']) && typeof input.artifact === 'string' && typeof input.content === 'string';
    case 'library.rename':
      return exact(input, ['artifact', 'slug']) && typeof input.artifact === 'string' && typeof input.slug === 'string';
    case 'library.delete':
      return exact(input, ['artifact', 'confirmed']) && typeof input.artifact === 'string' && typeof input.confirmed === 'boolean';
    case 'skill.trust':
      return exact(input, ['artifact', 'revision', 'confirmed']) && typeof input.artifact === 'string' &&
        typeof input.revision === 'string' && typeof input.confirmed === 'boolean';
    case 'library.targets':
      return exact(input, ['artifact', 'targets']) && typeof input.artifact === 'string' && isProviderArray(input.targets);
    case 'provider.effective':
      return exact(input, ['provider']) && isProvider(input.provider);
    case 'provider.preview':
      return exact(input, ['artifact', 'provider']) && typeof input.artifact === 'string' && isProvider(input.provider);
    case 'provider.review':
      return exact(input, ['units']) && isProviderReviewUnits(input.units);
    case 'provider.apply':
      return exact(input, ['batchDigest', 'units', 'confirmDrift']) &&
        typeof input.batchDigest === 'string' && isProviderApplyUnits(input.units) && optionalBoolean(input.confirmDrift);
    case 'provider.source.preview':
      return isProviderSourceInput(input, false);
    case 'provider.source.adopt':
      return isProviderSourceInput(input, true);
    case 'provider.source.stop-managing.preview':
    case 'provider.source.start-managing':
      return exact(input, ['provider', 'content']) && isProvider(input.provider) && isContent(input.content);
    case 'provider.source.stop-managing':
      return exact(input, ['provider', 'content', 'digest', 'confirmed']) && isProvider(input.provider) && isContent(input.content) &&
        typeof input.digest === 'string' && input.confirmed === true;
    case 'provider.restore.preview':
      return exact(input, ['provider']) && isProvider(input.provider);
    case 'provider.restore':
      return exact(input, ['provider', 'digest', 'confirmed']) && isProvider(input.provider) &&
        typeof input.digest === 'string' && input.confirmed === true;
    case 'provider.purge-backups.preview':
      return exact(input, ['provider']) && isProvider(input.provider);
    case 'provider.purge-backups':
      return exact(input, ['provider', 'digest', 'confirmed']) && isProvider(input.provider) &&
        typeof input.digest === 'string' && input.confirmed === true;
    case 'project.root.add':
      return exact(input, ['path', 'label']) && typeof input.path === 'string' && optionalString(input.label);
    case 'project.root.remove':
      return exact(input, ['rootId', 'confirmed']) && typeof input.rootId === 'string' && typeof input.confirmed === 'boolean';
    case 'project.scan':
      return exact(input, ['rootId', 'reappearChangedIgnored']) && optionalString(input.rootId) && optionalBoolean(input.reappearChangedIgnored);
    case 'project.discoveries':
      return exact(input, ['rootId', 'state']) && optionalString(input.rootId) && optionalDiscoveryState(input.state);
    case 'project.ignore':
      return isDiscoveryReference(input);
    case 'project.promotion-preview':
      return exact(input, ['discoveryId', 'mode']) && typeof input.discoveryId === 'string' && optionalPromotionMode(input.mode);
    case 'project.promote':
      return exact(input, [
        'discoveryId',
        'mode',
        'targets',
        'confirmedExecutableRevision',
        'destinationArtifact',
        'selectedHunks',
        'selectedFiles',
        'serverName',
      ]) && typeof input.discoveryId === 'string' && optionalPromotionMode(input.mode) &&
        optionalProviderArray(input.targets) && optionalString(input.confirmedExecutableRevision) &&
        optionalString(input.destinationArtifact) && optionalStringArray(input.selectedHunks) &&
        optionalStringArray(input.selectedFiles) && optionalString(input.serverName);
    case 'secret.set':
      return exact(input, ['id', 'value']) && typeof input.id === 'string' && typeof input.value === 'string';
    case 'secret.delete':
    case 'secret.status':
      return exact(input, ['id']) && typeof input.id === 'string';
    case 'history.undo':
      return exact(input, ['artifact', 'revision', 'confirmed']) && typeof input.artifact === 'string' &&
        optionalString(input.revision) && typeof input.confirmed === 'boolean';
    case 'activity.list':
      return exact(input, ['limit']) && optionalBoundedLimit(input.limit);
    case 'recovery.list':
      return exact(input, ['limit']) && optionalBoundedLimit(input.limit);
    case 'recovery.preview':
      return exact(input, ['receiptId']) && typeof input.receiptId === 'string';
    case 'recovery.restore':
      return exact(input, ['receiptId', 'digest', 'confirmed']) && typeof input.receiptId === 'string' &&
        typeof input.digest === 'string' && input.confirmed === true;
    case 'search':
      return exact(input, ['query', 'limit']) && typeof input.query === 'string' && optionalBoundedLimit(input.limit);
    case 'sync.configure':
      return exact(input, ['serverUrl']) && typeof input.serverUrl === 'string';
    case 'sync.conflict.preview':
      return exact(input, ['path']) && typeof input.path === 'string';
    case 'sync.resolve':
      return exact(input, ['path', 'choice']) && typeof input.path === 'string' &&
        (input.choice === 'ours' || input.choice === 'theirs');
    case 'remote.enable':
      return exact(input, ['endpoint']) && typeof input.endpoint === 'string';
    case 'session.pair':
      return exact(input, ['scope']) && (input.scope === 'read' || input.scope === 'write' || input.scope === 'admin');
    case 'session.revoke':
      return exact(input, ['sessionId']) && typeof input.sessionId === 'string';
    case 'external.open':
    case 'external.reveal':
      return exact(input, ['target']) && isExternalTarget(input.target);
    case 'migration.apply':
      return exact(input, ['yes', 'previewDigest']) && input.yes === true && typeof input.previewDigest === 'string';
    case 'setup.complete':
      return exact(input, ['createGlobalDefaults', 'globalInstructionContent', 'targets', 'rootPath', 'scanProject']) &&
        typeof input.createGlobalDefaults === 'boolean' && optionalString(input.globalInstructionContent) &&
        optionalProviderArray(input.targets) && optionalString(input.rootPath) && optionalBoolean(input.scanProject);
  }
}

function isProviderSelection(input: JsonObject, extraKeys: string[] = []): boolean {
  return exact(input, ['providers', 'contents', ...extraKeys]) && optionalProviderArray(input.providers) && optionalContentArray(input.contents);
}

function isSkillBase(input: JsonObject, extraKeys: string[]): boolean {
  return exact(input, ['scope', 'provider', 'name', ...extraKeys]) && isValidScope(input) && typeof input.name === 'string';
}

function isValidScope(input: JsonObject): boolean {
  return (input.scope === undefined || input.scope === 'shared')
    ? input.provider === undefined
    : input.scope === 'provider' && isProvider(input.provider);
}

function exact(input: JsonObject, keys: string[]): boolean {
  return hasOnlyKeys(input, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isProvider(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isContent(value: unknown): value is ManagerContentId {
  return typeof value === 'string' && contentIds.includes(value as ManagerContentId);
}

function isProviderArray(value: unknown): value is ManagerProviderId[] {
  return Array.isArray(value) && value.every(isProvider);
}

function isProviderApplyUnits(value: unknown): value is ProviderApplyUnitInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 18) return false;
  const keys = new Set<string>();
  for (const unit of value) {
    if (!isRecord(unit) || !hasOnlyKeys(unit, ['provider', 'content', 'digest']) ||
      !isProvider(unit.provider) || !isContent(unit.content) || typeof unit.digest !== 'string') return false;
    const key = `${unit.provider}:${unit.content}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function isProviderReviewUnits(value: unknown): value is ProviderReviewInput['units'] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 18) return false;
  const keys = new Set<string>();
  for (const unit of value) {
    if (!isRecord(unit) || !hasOnlyKeys(unit, ['provider', 'content']) || !isProvider(unit.provider) || !isContent(unit.content)) return false;
    const key = `${unit.provider}:${unit.content}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function isProviderSourceInput(input: JsonObject, adopting: boolean): boolean {
  const keys = adopting
    ? ['provider', 'content', 'name', 'destination', 'targets', 'previewDigest', 'confirmedExecutableRevision']
    : ['provider', 'content', 'name', 'destination', 'targets'];
  if (!exact(input, keys) || !isProvider(input.provider) || !isContent(input.content)) return false;
  if (input.destination !== 'shared' && input.destination !== 'provider') return false;
  if (!optionalString(input.name) || !optionalProviderArray(input.targets)) return false;
  if (input.content !== 'rules' && (typeof input.name !== 'string' || input.name.length === 0)) return false;
  if (input.destination === 'provider' && input.targets !== undefined) return false;
  return !adopting || (typeof input.previewDigest === 'string' && optionalString(input.confirmedExecutableRevision));
}

function isArtifactReference(input: JsonObject): boolean {
  return exact(input, ['artifact']) && typeof input.artifact === 'string';
}

function isDiscoveryReference(input: JsonObject): boolean {
  return exact(input, ['discoveryId']) && typeof input.discoveryId === 'string';
}

function isArtifactKind(value: unknown): value is ManagerArtifactKind {
  return value === 'instruction' || value === 'skill' || value === 'mcp';
}

function optionalArtifactKind(value: unknown): boolean {
  return value === undefined || isArtifactKind(value);
}

function isArtifactScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === 'global'
    ? hasOnlyKeys(value, ['kind'])
    : value.kind === 'provider-overlay' && hasOnlyKeys(value, ['kind', 'provider']) && isProvider(value.provider);
}

function optionalDiscoveryState(value: unknown): boolean {
  return value === undefined || value === 'new' || value === 'changed' || value === 'promoted' || value === 'conflict' || value === 'ignored';
}

function optionalPromotionMode(value: unknown): boolean {
  return value === undefined || value === 'global-instruction' || value === 'convert-to-skill' || value === 'disabled-draft';
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function optionalBoundedLimit(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1_000);
}

function isExternalTarget(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'canonical') {
    return hasOnlyKeys(value, ['kind', 'artifact']) && typeof value.artifact === 'string';
  }
  if (value.kind === 'provider') {
    return hasOnlyKeys(value, ['kind', 'provider', 'artifact', 'content']) && isProvider(value.provider) &&
      optionalString(value.artifact) && optionalContent(value.content) &&
      (typeof value.artifact === 'string' || isContent(value.content));
  }
  return value.kind === 'project' && hasOnlyKeys(value, ['kind', 'discoveryId']) && typeof value.discoveryId === 'string';
}

function optionalProviderArray(value: unknown): boolean {
  return value === undefined || isProviderArray(value);
}

function optionalContentArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isContent));
}

function optionalProvider(value: unknown): boolean {
  return value === undefined || isProvider(value);
}

function optionalContent(value: unknown): boolean {
  return value === undefined || isContent(value);
}

function optionalScope(value: unknown): boolean {
  return value === undefined || value === 'shared' || value === 'provider';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function externalInputSchema(): JsonObject {
  return objectSchema({
    target: {
      oneOf: [
        objectSchema({ kind: { const: 'canonical' }, artifact: { type: 'string' } }, ['kind', 'artifact']),
        objectSchema({
          kind: { const: 'provider' },
          provider: { enum: providerIds },
          artifact: { type: 'string' },
          content: { enum: contentIds },
        }, ['kind', 'provider']),
        objectSchema({ kind: { const: 'project' }, discoveryId: { type: 'string' } }, ['kind', 'discoveryId']),
      ],
    },
  }, ['target']);
}
