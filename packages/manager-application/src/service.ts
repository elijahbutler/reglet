import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addLibraryArtifact,
  allAdapters,
  approveSyncV2Pairing,
  applyLibraryMigration,
  applyProjectionBatch,
  commitArtifactText,
  compareTextLines,
  completeSyncV2BootstrapConnection,
  completeSyncV2Pairing,
  copySkillSafely,
  createManagedSyncV2Invitation,
  createArtifactMetadata,
  createSkill,
  defaultLibraryManifest,
  deriveProjectionStatus,
  detectDrift,
  detachReviewedManagedContent,
  disconnectSyncV2,
  duplicateLibraryArtifact,
  getAdapter,
  hasValidSkillFrontmatter,
  inspectSkill,
  inspectSyncV2Conflict,
  isTrustDecisionCurrent,
  libraryMigrationStatus,
  listOperationReceipts,
  loadDraft,
  loadLibraryManifest,
  loadManifest as loadProjectionManifest,
  loadMasterDir,
  loadSyncV2State,
  saveSyncV2State,
  loadConfig,
  LocalState,
  pendingSyncV2ConnectionStatus,
  permanentlyDeleteArtifact,
  mergeSelectedTextHunks,
  mergeSkillFilesSafely,
  parseProjectMcpServers,
  previewLibraryMigration,
  previewDetachManagedContent,
  previewOperationReceiptRestore,
  previewPurgeProviderBackups,
  previewProviderRestore,
  previewProjectionBatch,
  purgeReviewedProviderBackups,
  providerMcpScope,
  readArtifactText,
  redactMcpCredentialArguments,
  readProviderMcpServers,
  recommendInstructionPromotion,
  regletHome,
  renameLibraryArtifact,
  restoreArtifactRevision,
  restoreReviewedProvider,
  restoreReviewedOperationReceipt,
  resolveSyncV2Conflict,
  rollbackLibraryMigration,
  requestSyncV2Pairing,
  revokeManagedSyncV2Device,
  renameManagedSyncV2Device,
  scanProjectRoot,
  saveConfig,
  saveLibraryManifest,
  secretReferenceStatus,
  setArtifactLifecycle,
  setArtifactTargets,
  snapshotArtifact,
  sharedMcpScope,
  systemSecretStore,
  startSyncV2BootstrapConnection,
  stripGeneratedHeader,
  syncOnceV2,
  updateMcpSyncProviders,
  updateSkillSyncProviders,
  upsertMcpServer,
  validateMcpServer,
  cancelPendingSyncV2Connection,
  listManagedSyncV2Devices,
  writeFileEnsuringDir,
  type ApplyContent,
  type ArtifactDraft,
  type ArtifactKind,
  type LibraryArtifactMetadata,
  type LibraryMigrationPreview,
  type LibraryMigrationStatus,
  type ManifestOutput,
  type McpServerDef,
  type DetachManagedContentPreview,
  type OperationReceipt,
  type OperationRestorePreview,
  type ProjectionBatchApplyResult,
  type ProjectionBatchPreview,
  type ProjectionUnitPreview,
  type ProjectionValidationIssue,
  type ProviderRestorePreview,
  type ProviderId,
  type ProviderInventory,
  type SecretRef,
  type SecretStore,
  type SkillInspection,
  SyncV2RequestError,
} from '@reglet/core';
import {
  isManagerMutatingOperation,
  type ManagerArtifactV3,
  type ManagerArtifactProjectionV3,
  type ManagerMigrationStateV3,
  type ManagerProjectInboxV3,
  type ManagerProviderBackupPurgeResultV3,
  type ManagerProviderBackupPurgeReviewV3,
  type ManagerProviderDetachResultV3,
  type ManagerProviderDetachReviewV3,
  type ManagerProviderRestoreResultV3,
  type ManagerProviderRestoreReviewV3,
  type ManagerProjectionReviewV3,
  type ManagerProjectionIssueV3,
  type ManagerProviderSourceV3,
  type ManagerRecoveryReceiptV3,
  type ManagerRecoveryReviewV3,
  type ManagerRecoveryRestoreResultV3,
  type ManagerProtocolOperation,
  type ManagerRpcInputs,
  type ManagerSessionScope,
  type ManagerSnapshotV3,
  type SyncPendingConnection,
  type SyncSnapshot,
} from '@reglet/manager-protocol';

export type ApplicationCommand = {
  [Operation in ManagerProtocolOperation]: {
    operation: Operation;
    input: ManagerRpcInputs[Operation];
  }
}[ManagerProtocolOperation];

export interface ApplicationCommandOptions {
  expectedRevision?: number;
  scope?: ManagerSessionScope;
}

export interface ApplicationCommandResult {
  revision: number;
  changed: boolean;
  data: unknown;
}

export interface RegletApplicationOptions {
  home?: string;
  secretStore?: SecretStore;
}

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly observedRevision: number;

  constructor(expectedRevision: number, observedRevision: number) {
    super(`Revision conflict: expected ${expectedRevision}, observed ${observedRevision}.`);
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.observedRevision = observedRevision;
  }
}

export class ApplicationPermissionError extends Error {
  readonly requiredScope: ManagerSessionScope;

  constructor(operation: ManagerProtocolOperation, requiredScope: ManagerSessionScope) {
    super(`${operation} requires ${requiredScope} scope.`);
    this.name = 'ApplicationPermissionError';
    this.requiredScope = requiredScope;
  }
}

export class UnsupportedApplicationOperationError extends Error {
  readonly operation: ManagerProtocolOperation;

  constructor(operation: ManagerProtocolOperation) {
    super(`${operation} remains available through the Manager V1 compatibility adapter.`);
    this.name = 'UnsupportedApplicationOperationError';
    this.operation = operation;
  }
}

/** The single serialized use-case layer shared by CLI, local HTTP, and Tauri. */
export class RegletApplication {
  private readonly home: string;
  private readonly secretStore: SecretStore;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RegletApplicationOptions = {}) {
    this.home = options.home ?? regletHome();
    this.secretStore = options.secretStore ?? systemSecretStore();
  }

  execute(
    command: ApplicationCommand,
    options: ApplicationCommandOptions = {},
  ): Promise<ApplicationCommandResult> {
    const scope = options.scope ?? 'admin';
    const requiredScope = requiredScopeFor(command.operation);
    if (!scopeAllows(scope, requiredScope)) {
      return Promise.reject(new ApplicationPermissionError(command.operation, requiredScope));
    }
    const result = this.queue.then(() => this.executeNow(command, options, scope));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async executeNow(
    command: ApplicationCommand,
    options: ApplicationCommandOptions,
    scope: ManagerSessionScope,
  ): Promise<ApplicationCommandResult> {
    const state = await LocalState.open(this.home);
    const mutating = isManagerMutatingOperation(command.operation);
    try {
      const observedRevision = state.commandRevision();
      if (options.expectedRevision !== undefined && options.expectedRevision !== observedRevision) {
        throw new RevisionConflictError(options.expectedRevision, observedRevision);
      }
      const data = await executeCommand(command, this.home, state, scope, this.secretStore);
      if (mutating && indexesCanonicalContent(command.operation)) {
        await indexCanonicalLibrary(this.home, state);
      }
      const revision = mutating
        ? state.advanceCommandRevision(observedRevision)
        : observedRevision;
      if (mutating) {
        state.recordActivity({
          action: command.operation,
          outcome: activityOutcome(data),
          ...activityContext(command, data),
        });
      }
      return { revision, changed: mutating, data };
    } finally {
      state.close();
    }
  }
}

async function executeCommand(
  command: ApplicationCommand,
  home: string,
  state: LocalState,
  scope: ManagerSessionScope,
  secretStore: SecretStore,
): Promise<unknown> {
  switch (command.operation) {
    case 'snapshot':
      return managerSnapshot(home, state, scope, secretStore);
    case 'library.list': {
      const manifest = await loadLibraryManifest(home);
      return manifest.artifacts.filter((artifact) =>
        (command.input.kind === undefined || artifact.kind === command.input.kind) &&
        (command.input.lifecycle === undefined || artifact.lifecycle === command.input.lifecycle));
    }
    case 'library.show':
      return showArtifact(command.input.artifact, home, state);
    case 'library.create':
      await assertLibraryReady(home);
      return createCanonicalArtifact(command.input, home);
    case 'library.duplicate': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      return duplicateLibraryArtifact(artifact.id, home);
    }
    case 'library.save': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      return commitArtifactText(
        artifact.id,
        command.input.content,
        validateArtifactContent(artifact, command.input.content),
        home,
      );
    }
    case 'library.rename': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      return renameLibraryArtifact(artifact.id, command.input.slug, home);
    }
    case 'library.archive': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      return setArtifactLifecycle(artifact.id, 'archived', home);
    }
    case 'library.restore': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      return setArtifactLifecycle(artifact.id, 'active', home);
    }
    case 'library.delete': {
      if (!command.input.confirmed) throw new Error('Permanent deletion requires explicit confirmation.');
      const artifact = await resolveArtifact(command.input.artifact, home);
      return permanentlyDeleteArtifact(artifact.id, home);
    }
    case 'library.targets': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      const updated = await setArtifactTargets(artifact.id, command.input.targets, home);
      if (updated.scope.kind === 'global' && updated.kind === 'skill') {
        await updateSkillSyncProviders(updated.slug, updated.targets, home);
      }
      if (updated.scope.kind === 'global' && updated.kind === 'mcp') {
        await updateMcpSyncProviders(updated.slug, updated.targets, home);
      }
      return updated;
    }
    case 'provider.list':
      return providerList();
    case 'provider.effective': {
      const adapter = getAdapter(command.input.provider);
      const config = await loadConfig(home);
      return {
        id: adapter.id,
        configuration: config.providers[adapter.id],
        inventory: await adapter.inventory(),
      };
    }
    case 'provider.preview': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      const content = contentForKind(artifact.kind);
      const unitIssues = await projectionUnitIssues(home, state, [command.input.provider]);
      const batch = await previewProjectionBatch({
        unitSelections: [{ provider: command.input.provider, content }],
        home,
        unitIssues,
      });
      const unit = batch.units[0];
      if (unit === undefined) throw new Error('Projection preview did not produce the requested unit.');
      const manifest = await loadLibraryManifest(home);
      const review = managerProjectionReview(batch, manifest.artifacts);
      const reviewUnit = review.units[0];
      if (reviewUnit === undefined) throw new Error('Projection review did not produce the requested unit.');
      return {
        version: 1,
        artifactId: artifact.id,
        provider: command.input.provider,
        content,
        batchDigest: review.digest,
        unitDigest: unit.digest,
        review,
        affectedArtifacts: reviewUnit.artifacts,
      };
    }
    case 'provider.review': {
      const providers = [...new Set(command.input.units.map((unit) => unit.provider))];
      const unitIssues = await projectionUnitIssues(home, state, providers);
      const batch = await previewProjectionBatch({
        unitSelections: command.input.units,
        home,
        unitIssues,
      });
      const manifest = await loadLibraryManifest(home);
      return managerProjectionReview(batch, manifest.artifacts);
    }
    case 'provider.apply': {
      const unitSelections = command.input.units.map(({ provider, content }) => ({ provider, content }));
      const providers = [...new Set(unitSelections.map((unit) => unit.provider))];
      const unitIssues = await projectionUnitIssues(home, state, providers);
      const result = await applyProjectionBatch({
        home,
        unitSelections,
        batchDigest: command.input.batchDigest,
        unitDigests: Object.fromEntries(command.input.units.map((unit) => [
          `${unit.provider}:${unit.content}`,
          unit.digest,
        ])),
        confirmDrift: command.input.confirmDrift,
        unitIssues,
      });
      await recordAppliedProjections(result.preview, result.units, home, state);
      return managerProjectionApplyResult(result);
    }
    case 'provider.source.preview':
      return previewProviderSource(command.input, home);
    case 'provider.source.adopt':
      return adoptProviderSource(command.input, home, state);
    case 'provider.source.stop-managing.preview':
      return managerProviderDetachReview(
        await previewDetachManagedContent(command.input.provider, command.input.content, home),
      );
    case 'provider.source.stop-managing': {
      if (!command.input.confirmed) throw new Error('Stopping provider management requires explicit confirmation.');
      const config = await loadConfig(home);
      const previous = config.providers[command.input.provider][command.input.content];
      config.providers[command.input.provider][command.input.content] = false;
      await saveConfig(config, home);
      try {
        const detached = await detachReviewedManagedContent(
          command.input.provider,
          command.input.content,
          command.input.digest,
          home,
        );
        return {
          version: 1,
          provider: command.input.provider,
          content: command.input.content,
          detached: detached.detached.map(({ outputPath, headerRemoved }) => ({ path: outputPath, headerRemoved })),
          receiptId: detached.receipt.id,
        } satisfies ManagerProviderDetachResultV3;
      } catch (error) {
        config.providers[command.input.provider][command.input.content] = previous;
        await saveConfig(config, home);
        throw error;
      }
    }
    case 'provider.source.start-managing': {
      const config = await loadConfig(home);
      const alreadyManaging = config.providers[command.input.provider].enabled &&
        config.providers[command.input.provider][command.input.content];
      config.providers[command.input.provider].enabled = true;
      config.providers[command.input.provider][command.input.content] = true;
      await saveConfig(config, home);
      return {
        provider: command.input.provider,
        content: command.input.content,
        managing: true,
        alreadyManaging,
        nextAction: 'review-and-apply',
      };
    }
    case 'provider.restore.preview':
      return managerProviderRestoreReview(await previewProviderRestore(command.input.provider, home));
    case 'provider.restore': {
      if (!command.input.confirmed) throw new Error('Provider restore requires explicit confirmation.');
      const result = await restoreReviewedProvider(command.input.provider, command.input.digest, home);
      return {
        version: 1,
        provider: command.input.provider,
        receiptId: result.receipt.id,
        results: result.results.map(({ outputPath, action }) => ({ path: outputPath, action })),
      } satisfies ManagerProviderRestoreResultV3;
    }
    case 'provider.purge-backups.preview':
      return await previewPurgeProviderBackups(command.input.provider, home) satisfies ManagerProviderBackupPurgeReviewV3;
    case 'provider.purge-backups': {
      if (!command.input.confirmed) throw new Error('Backup purge requires explicit confirmation.');
      const result = await purgeReviewedProviderBackups(command.input.provider, command.input.digest, home);
      return { version: 1, ...result } satisfies ManagerProviderBackupPurgeResultV3;
    }
    case 'project.root.add':
      return state.addProjectRoot(command.input.path, command.input.label);
    case 'project.root.remove':
      if (!command.input.confirmed) throw new Error('Root removal requires explicit confirmation.');
      return { removed: state.removeProjectRoot(command.input.rootId) };
    case 'project.root.list':
      return state.listProjectRoots();
    case 'project.scan':
      return scanConfiguredRoots(command.input.rootId, command.input.reappearChangedIgnored, state);
    case 'project.discoveries':
      return state.listDiscoveries(command.input.rootId).filter((discovery) =>
        command.input.state === undefined || discovery.state === command.input.state);
    case 'project.ignore': {
      const discovery = state.listDiscoveries().find((candidate) => candidate.id === command.input.discoveryId);
      if (discovery === undefined) throw new Error(`Unknown discovery: ${command.input.discoveryId}`);
      state.setIgnoredDiscovery(discovery.rootId, discovery.relativePath, discovery.sourceHash);
      state.markDiscoveryState(discovery.id, 'ignored');
      return { ignored: true, id: discovery.id };
    }
    case 'project.promotion-preview':
      return promotionPreview(command.input.discoveryId, command.input.mode, home, state);
    case 'project.promote':
      return promoteDiscovery(command.input, home, state);
    case 'skill.inspect':
      return managerSkillInspection(command.input.artifact, home, state);
    case 'skill.trust': {
      if (!command.input.confirmed) throw new Error('Skill trust requires explicit confirmation.');
      const artifact = await resolveArtifact(command.input.artifact, home);
      const inspection = await inspectCanonicalSkill(artifact.id, home);
      if (inspection.promotionBlocked) throw new Error('Blocked skill cannot be trusted.');
      if (inspection.revision !== command.input.revision) {
        throw new Error('This skill changed after it was reviewed. Reload the executable files and approve the new revision.');
      }
      const executableFiles = inspection.files.filter((file) => file.executable).map((file) => file.relPath);
      state.saveTrustDecision({ artifactId: artifact.id, revision: inspection.revision, trustedAt: new Date().toISOString(), executableFiles });
      return { trusted: true, revision: inspection.revision, executableFiles };
    }
    case 'secret.set':
      return secretStore.set(command.input.id, command.input.value);
    case 'secret.delete':
      return secretStore.delete(command.input.id);
    case 'secret.status':
      return secretStore.status(command.input.id);
    case 'history.list': {
      const artifact = await resolveArtifact(command.input.artifact, home);
      const { listArtifactHistory } = await import('@reglet/core');
      return listArtifactHistory(artifact.id, home);
    }
    case 'history.undo': {
      if (!command.input.confirmed) throw new Error('History restore requires explicit confirmation.');
      return restoreArtifactRevision(await resolveArtifactIdIncludingDeleted(command.input.artifact, home), command.input.revision, home);
    }
    case 'activity.list':
      return state.listActivity(command.input.limit);
    case 'recovery.list':
      return (await listOperationReceipts(home))
        .slice(0, command.input.limit ?? 50)
        .map(managerRecoveryReceipt);
    case 'recovery.preview':
      return managerRecoveryReview(await previewOperationReceiptRestore(command.input.receiptId, home));
    case 'recovery.restore': {
      if (!command.input.confirmed) throw new Error('Recovery restore requires explicit confirmation.');
      const result = await restoreReviewedOperationReceipt(command.input.receiptId, command.input.digest, home);
      return {
        version: 1,
        receiptId: command.input.receiptId,
        undoReceiptId: result.receipt.id,
        actions: result.actions,
      } satisfies ManagerRecoveryRestoreResultV3;
    }
    case 'search':
      return state.search(command.input.query, command.input.limit, scope === 'admin' ? undefined : 'canonical');
    case 'remote.enable':
      return enableRemote(command.input.endpoint, state);
    case 'remote.disable':
      state.setSetting('remote.enabled', 'false');
      return { enabled: false };
    case 'remote.status':
      return remoteStatus(state);
    case 'session.pair':
      return state.createPairingCredential(command.input.scope);
    case 'session.list':
      return state.listRemoteSessions();
    case 'session.revoke':
      return { revoked: state.revokeRemoteSession(command.input.sessionId) };
    case 'sync.status':
      return encryptedSyncStatus(home);
    case 'sync.preview.set': {
      const config = await loadConfig(home);
      config.encryptedSyncPreview.acknowledged = command.input.acknowledged;
      await saveConfig(config, home);
      return encryptedSyncCompatibilitySnapshot(home);
    }
    case 'sync.snapshot':
      return encryptedSyncCompatibilitySnapshot(home);
    case 'sync.bootstrap.start':
      return startSyncV2BootstrapConnection({ ...command.input, home });
    case 'sync.invitation.create':
      return createManagedSyncV2Invitation({ home });
    case 'sync.pair.request':
      return requestSyncV2Pairing({ ...command.input, home });
    case 'sync.pair.approve':
      return approveSyncV2Pairing({ ...command.input, home });
    case 'sync.pair.status':
      return pendingSyncV2ConnectionStatus({ home });
    case 'sync.pair.complete': {
      const syncState = await loadSyncV2State(home);
      if (syncState?.phase !== 'pending') throw new Error('This device has no pending encrypted sync connection.');
      if (syncState.method === 'bootstrap') {
        await completeSyncV2BootstrapConnection({ confirmedFingerprint: command.input.fingerprint, home });
      } else {
        await completeSyncV2Pairing({ confirmedSas: command.input.fingerprint, home });
      }
      return encryptedSyncCompatibilitySnapshot(home);
    }
    case 'sync.pair.cancel':
      await cancelPendingSyncV2Connection({ home });
      return encryptedSyncCompatibilitySnapshot(home);
    case 'sync.run':
      return syncOnceV2({ home });
    case 'sync.device.rename':
      await renameManagedSyncV2Device({ ...command.input, home });
      return { renamed: true, deviceId: command.input.deviceId, name: command.input.name };
    case 'sync.device.revoke':
      return revokeManagedSyncV2Device({ ...command.input, home });
    case 'sync.disconnect':
      await disconnectSyncV2({ home, localOnly: command.input.localOnly });
      return encryptedSyncCompatibilitySnapshot(home);
    case 'sync.disable':
      await disconnectSyncV2({ home, localOnly: true });
      state.setSetting('sync.enabled', 'false');
      return encryptedSyncStatus(home);
    case 'sync.configure':
      assertHttpsUrl(command.input.serverUrl, 'Sync');
      throw new Error(
        'A server URL alone cannot establish encrypted sync. Start a new encrypted vault or connect this device with an invitation.',
      );
    case 'sync.now':
      return syncOnceV2({ home });
    case 'sync.conflict.preview':
      return inspectSyncV2Conflict(command.input.path, home);
    case 'sync.resolve':
      return resolveSyncV2Conflict(command.input.path, command.input.choice, home);
    case 'diagnostics':
      return diagnostics(home, state, secretStore);
    case 'external.open':
    case 'external.reveal':
      return { delegated: true, target: command.input.target };
    case 'migration.preview':
      return publicMigrationPreview(await previewLibraryMigration(home));
    case 'migration.apply': {
      const receipt = await applyLibraryMigration({ ...command.input, home });
      try {
        await indexCanonicalLibrary(home, state);
        return {
          version: receipt.version,
          id: receipt.id,
          migration: receipt.migration,
          digest: receipt.digest,
          appliedAt: receipt.appliedAt,
          artifactCount: receipt.artifactCount,
          reversible: receipt.reversible,
        };
      } catch (error) {
        await rollbackLibraryMigration(receipt, home);
        await indexCanonicalLibrary(home, state);
        throw error;
      }
    }
    case 'migration.status':
      return publicMigrationStatus(await libraryMigrationStatus(home));
    case 'setup.complete':
      return completeSetup(command.input, home, state);
    default:
      throw new UnsupportedApplicationOperationError(command.operation);
  }
}

async function managerSnapshot(
  home: string,
  state: LocalState,
  scope: ManagerSessionScope,
  secretStore: SecretStore,
): Promise<ManagerSnapshotV3> {
  const unitIssues = await projectionUnitIssues(home, state);
  const [manifest, projectionManifest, migration, providers, batch, bindings] = await Promise.all([
    loadLibraryManifest(home),
    loadProjectionManifest(home),
    migrationSnapshot(home),
    providerList(),
    previewProjectionBatch({ home, unitIssues }),
    secretBindings(home, secretStore),
  ]);
  const records = new Map(state.listProjectionRecords().map((record) => [`${record.artifactId}:${record.provider}`, record]));
  const artifacts: ManagerArtifactV3[] = await Promise.all(manifest.artifacts.map(async (artifact) => {
    const [draft, history] = await Promise.all([loadDraft(artifact.id, home), historyForSnapshot(artifact.id, home)]);
    const projections = allAdapters().map((adapter) => projectionForArtifact(
      artifact,
      adapter.id,
      batch,
      records.get(`${artifact.id}:${adapter.id}`),
      projectionManifest.outputs,
    ));
    return {
      metadata: artifact,
      ...(draft === undefined ? {} : { draft: draftForSnapshot(draft) }),
      projections,
      history,
    };
  }));
  const projectInbox = scope === 'admin' ? projectInboxSnapshot(state) : undefined;
  const sessions = scope === 'admin' ? state.listRemoteSessions() : undefined;
  const activity = state.listActivity(100).map((record) => ({
    id: String(record.id),
    occurredAt: record.occurredAt,
    action: record.action,
    outcome: record.outcome,
    ...(record.artifactId === undefined ? {} : { artifactId: record.artifactId }),
    ...(isProviderId(record.provider) ? { provider: record.provider } : {}),
  }));
  const diagnosticState = await diagnostics(home, state, secretStore, providers);
  return {
    version: 3,
    contract: 'manager-snapshot',
    protocolVersion: 2,
    revision: state.commandRevision(),
    permissions: { scope, canMutate: scope !== 'read', canAdmin: scope === 'admin' },
    library: {
      schemaVersion: 2,
      migration,
      artifacts,
      tombstones: manifest.tombstones.map(({ id, kind, slug, deletedAt, recoverableUntil }) => ({ id, kind, slug, deletedAt, recoverableUntil })),
      counts: {
        active: artifacts.filter((artifact) => artifact.metadata.lifecycle === 'active').length,
        archived: artifacts.filter((artifact) => artifact.metadata.lifecycle === 'archived').length,
        drafts: artifacts.filter((artifact) => artifact.draft !== undefined).length,
      },
    },
    providers: providers.map(({ inventory, sourceContext, ...provider }) => ({
      ...provider,
      sources: providerSources(provider.id, inventory, projectionManifest.outputs, sourceContext),
      projections: artifacts.flatMap((artifact) => artifact.projections.filter((projection) => projection.provider === provider.id)),
    })),
    ...(projectInbox === undefined ? {} : { projectInbox }),
    activity,
    settings: {
      setup: {
        completed: state.setting('setup.completed') === 'true' ||
          artifacts.length > 0 || (projectInbox?.roots.length ?? 0) > 0,
      },
      sync: await encryptedSyncStatus(home),
      remote: remoteStatus(state),
      secretBindings: bindings,
      ...(sessions === undefined ? {} : { sessions }),
    },
    diagnostics: diagnosticState,
  };
}

async function completeSetup(
  input: ManagerRpcInputs['setup.complete'],
  home: string,
  state: LocalState,
): Promise<unknown> {
  const migration = await libraryMigrationStatus(home);
  if (migration.state === 'available') {
    throw new Error('Review the existing canonical library migration before completing setup.');
  }
  if (migration.state === 'not-needed') {
    await saveLibraryManifest(defaultLibraryManifest(), home);
  }

  const manifest = await loadLibraryManifest(home);
  let defaultArtifact = manifest.artifacts.find((artifact) =>
    artifact.kind === 'instruction' && artifact.scope.kind === 'global' && artifact.lifecycle === 'active');
  if (input.createGlobalDefaults && defaultArtifact === undefined) {
    defaultArtifact = await createCanonicalArtifact({
      kind: 'instruction',
      slug: 'global-agent-defaults',
      title: 'Global agent defaults',
      description: 'Baseline instructions shared with every selected provider.',
      content: input.globalInstructionContent?.trim() || defaultGlobalInstruction,
      targets: input.targets ?? [],
      scope: { kind: 'global' },
    }, home);
  } else if (input.createGlobalDefaults && defaultArtifact !== undefined) {
    const currentContent = await readArtifactText(defaultArtifact.id, home);
    if (currentContent.trim() === '' || currentContent.includes('<!-- Add shared instructions here. -->')) {
      await commitArtifactText(
        defaultArtifact.id,
        input.globalInstructionContent?.trim() || defaultGlobalInstruction,
        [],
        home,
      );
    }
    if (input.targets !== undefined) {
      defaultArtifact = await setArtifactTargets(defaultArtifact.id, input.targets, home);
    }
  }

  let rootId: string | undefined;
  let discoveries = 0;
  const rootPath = input.rootPath?.trim();
  if (rootPath !== undefined && rootPath.length > 0) {
    const root = state.addProjectRoot(rootPath);
    rootId = root.id;
    if (input.scanProject !== false) {
      const scan = await scanConfiguredRoots(root.id, false, state);
      discoveries = scan.reduce((count, result) => count + result.count, 0);
    }
  }
  state.setSetting('setup.completed', 'true');
  state.setSetting('setup.projectReview', input.scanProject === false ? 'later' : 'inbox');
  return {
    completed: true,
    ...(defaultArtifact === undefined ? {} : { defaultArtifactId: defaultArtifact.id }),
    ...(rootId === undefined ? {} : { rootId }),
    discoveries,
  };
}

const defaultGlobalInstruction = `# Global agent defaults

- Follow the nearest project instructions.
- Preserve user work and explain consequential changes.
- Prefer clear, verifiable results over hidden automation.
`;

interface ProviderSourceAdoptionPreview {
  version: 1;
  digest: string;
  provider: ProviderId;
  content: ApplyContent;
  source: {
    path: string;
    name?: string;
    revision: string;
    ownership: 'unmanaged' | 'managed' | 'unknown';
  };
  artifact: {
    kind: ArtifactKind;
    slug: string;
    title: string;
    scope: LibraryArtifactMetadata['scope'];
    targets: ProviderId[];
    locator: LibraryArtifactMetadata['locator'];
  };
  contentText?: string;
  skillInspection?: SkillInspection;
  issues: ManagerProjectionIssueV3[];
  blocked: boolean;
}

async function previewProviderSource(
  input: ManagerRpcInputs['provider.source.preview'],
  home: string,
): Promise<ProviderSourceAdoptionPreview> {
  await assertLibraryReady(home);
  const adapter = getAdapter(input.provider);
  const inventory = await adapter.inventory();
  const projectionManifest = await loadProjectionManifest(home);
  const source = providerSources(input.provider, inventory, projectionManifest.outputs, await providerSpecificSourceContext(adapter))
    .find((candidate) => candidate.content === input.content);
  if (source === undefined || source.path === null || !source.exists) {
    throw new Error(`${adapter.displayName} has no ${input.content} source to adopt.`);
  }
  if (input.content === 'rules' && input.name === undefined && source.items.length > 1) {
    throw new Error(`${adapter.displayName} has multiple instruction sources. Select the exact file to adopt.`);
  }
  const item = input.name === undefined
    ? source.items[0]
    : source.items.find((candidate) => candidate.label === input.name);
  if (item === undefined) {
    throw new Error(`${adapter.displayName} ${input.content} source is unavailable: ${input.name ?? 'instructions'}`);
  }

  const sourcePath = input.content === 'skills'
    ? path.join(source.path, item.label)
    : input.content === 'rules' && item.label !== path.basename(source.path)
      ? path.join(path.dirname(source.path), item.label)
      : source.path;
  const scope: LibraryArtifactMetadata['scope'] = input.destination === 'provider'
    ? { kind: 'provider-overlay', provider: input.provider }
    : { kind: 'global' };
  const targets = scope.kind === 'provider-overlay'
    ? [input.provider]
    : [...new Set(input.targets ?? [input.provider])];
  const kind = kindForContent(input.content);
  const initialSlug = input.content === 'rules'
    ? `${input.provider}-instructions`
    : normalizeSlug(item.label);
  const slug = await availableAdoptionSlug(initialSlug, kind, scope, home);
  const artifact = {
    kind,
    slug,
    title: input.content === 'rules' ? `${adapter.displayName} instructions` : titleFromSlug(slug),
    scope,
    targets,
    locator: artifactLocator(kind, slug, scope),
  };
  const issues: ManagerProjectionIssueV3[] = [];
  if (item.ownership !== 'unmanaged') {
    issues.push({
      code: item.ownership === 'managed' ? 'provider-source-already-managed' : 'provider-source-ownership-unknown',
      severity: 'error',
      message: item.ownership === 'managed'
        ? 'This provider source is already managed by Reglet.'
        : 'Reglet cannot prove whether this provider source is managed. Detach or repair its ownership record before adopting it.',
    });
  }

  let contentText: string | undefined;
  let skillInspection: SkillInspection | undefined;
  let sourceRevision: string;
  if (input.content === 'rules') {
    contentText = stripGeneratedHeader(await readFile(sourcePath, 'utf8'), input.provider);
    sourceRevision = textDigest(contentText);
    issues.push(...validationIssuesForAdoption(artifact, contentText));
  } else if (input.content === 'skills') {
    skillInspection = await inspectSkill(sourcePath);
    sourceRevision = skillInspection.revision;
    issues.push(...skillInspection.risks.map((risk) => ({
      code: `skill-${risk.code}`,
      severity: risk.severity,
      message: `${risk.relPath}: ${risk.message}`,
    })));
    try {
      contentText = await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8');
      issues.push(...validationIssuesForAdoption(artifact, contentText));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      issues.push({ code: 'skill-manifest-missing', severity: 'error', message: 'The provider skill has no SKILL.md file.' });
    }
  } else {
    const providerDefinition = (await readProviderMcpServers(input.provider, sourcePath))[item.label];
    if (providerDefinition === undefined) throw new Error(`Provider MCP server is unavailable: ${item.label}`);
    const sanitized = sanitizeProviderMcpDefinition(providerDefinition);
    contentText = `${JSON.stringify(sanitized.definition, null, 2)}\n`;
    sourceRevision = textDigest(JSON.stringify(providerDefinition));
    issues.push(...sanitized.issues);
    issues.push(...validationIssuesForAdoption(artifact, contentText));
  }

  const digest = objectDigest({
    provider: input.provider,
    content: input.content,
    sourcePath,
    sourceName: input.name,
    sourceRevision,
    artifact,
  });
  return {
    version: 1,
    digest,
    provider: input.provider,
    content: input.content,
    source: {
      path: sourcePath,
      ...(input.content === 'rules' ? {} : { name: item.label }),
      revision: sourceRevision,
      ownership: item.ownership,
    },
    artifact,
    ...(contentText === undefined ? {} : { contentText }),
    ...(skillInspection === undefined ? {} : { skillInspection }),
    issues,
    blocked: issues.some((issue) => issue.severity === 'error'),
  };
}

async function adoptProviderSource(
  input: ManagerRpcInputs['provider.source.adopt'],
  home: string,
  state: LocalState,
): Promise<{ artifact: LibraryArtifactMetadata; previewDigest: string; sourcePath: string }> {
  const preview = await previewProviderSource(input, home);
  if (preview.digest !== input.previewDigest) {
    throw new Error('Provider source changed after preview. Review it again before adopting.');
  }
  if (preview.blocked) {
    throw new Error(preview.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; '));
  }
  if (
    preview.skillInspection?.requiresExecutableConfirmation === true &&
    input.confirmedExecutableRevision !== preview.skillInspection.revision
  ) {
    throw new Error('Executable skill files require confirmation for the exact inspected revision.');
  }

  let artifact: LibraryArtifactMetadata;
  if (preview.content === 'skills') {
    const destinationPath = path.join(home, ...preview.artifact.locator.path.split('/'));
    if (await pathExists(destinationPath)) throw new Error('Adoption destination now exists. Preview the provider source again.');
    artifact = createArtifactMetadata(preview.artifact);
    try {
      await copySkillSafely(preview.source.path, destinationPath);
      await addLibraryArtifact(artifact, home);
    } catch (error) {
      await rm(destinationPath, { recursive: true, force: true });
      throw error;
    }
    if (artifact.scope.kind === 'global') await updateSkillSyncProviders(artifact.slug, artifact.targets, home);
    if (preview.skillInspection?.requiresExecutableConfirmation === true) {
      saveTrustDecision(state, artifact.id, preview.skillInspection);
    }
  } else {
    if (preview.contentText === undefined) throw new Error('Provider source preview has no adoptable content.');
    if (await locatorOccupied(preview.artifact.locator, home)) {
      throw new Error('Adoption destination now exists. Preview the provider source again.');
    }
    artifact = await createCanonicalArtifact({
      kind: preview.artifact.kind,
      slug: preview.artifact.slug,
      title: preview.artifact.title,
      content: preview.contentText,
      targets: preview.artifact.targets,
      scope: preview.artifact.scope,
    }, home);
  }
  return { artifact, previewDigest: preview.digest, sourcePath: preview.source.path };
}

function validationIssuesForAdoption(
  artifact: ProviderSourceAdoptionPreview['artifact'],
  content: string,
): ManagerProjectionIssueV3[] {
  const metadata = createArtifactMetadata(artifact);
  return validateArtifactContent(metadata, content).map((issue) => ({
    code: issue.code,
    severity: 'error',
    message: issue.message,
  }));
}

function sanitizeProviderMcpDefinition(value: unknown): {
  definition: Record<string, unknown>;
  issues: ManagerProjectionIssueV3[];
} {
  if (!isRecord(value)) return { definition: Object.create(null) as Record<string, unknown>, issues: [] };
  const definition = Object.create(null) as Record<string, unknown>;
  for (const key of ['command', 'url'] as const) {
    if (value[key] !== undefined) definition[key] = value[key];
  }
  const issues: ManagerProjectionIssueV3[] = [];
  if (Array.isArray(value.args) && value.args.every((argument) => typeof argument === 'string')) {
    const args = redactMcpCredentialArguments(value.args);
    definition.args = args.args;
    if (args.redacted) {
      issues.push({
        code: 'mcp-credential-argument-redacted',
        severity: 'error',
        message: 'Credential-like command arguments were not imported. Move the value to a process environment or keychain reference, then review this source again.',
      });
    }
  } else if (value.args !== undefined) {
    definition.args = value.args;
  }
  if (isRecord(value.env)) {
    const env = Object.create(null) as Record<string, unknown>;
    for (const [key, entry] of Object.entries(value.env)) {
      if (typeof entry === 'string') {
        env[key] = { source: 'process-env', name: key, required: true };
        issues.push({
          code: 'mcp-environment-value-redacted',
          severity: 'warning',
          message: `${key} was converted to a required process environment reference. Its provider value was not imported.`,
        });
      } else {
        env[key] = entry;
      }
    }
    definition.env = env;
  }
  return { definition, issues };
}

async function availableAdoptionSlug(
  initial: string,
  kind: ArtifactKind,
  scope: LibraryArtifactMetadata['scope'],
  home: string,
): Promise<string> {
  const manifest = await loadLibraryManifest(home);
  let suffix = 1;
  while (true) {
    const candidate = suffix === 1 ? initial : `${initial}-${suffix}`;
    const used = manifest.artifacts.some((artifact) =>
      artifact.kind === kind && artifact.slug === candidate && sameArtifactScope(artifact.scope, scope));
    if (!used && !(await locatorOccupied(artifactLocator(kind, candidate, scope), home))) return candidate;
    suffix += 1;
  }
}

async function locatorOccupied(locator: LibraryArtifactMetadata['locator'], home: string): Promise<boolean> {
  const filePath = path.join(home, ...locator.path.split('/'));
  if (locator.type !== 'mcp-server') return pathExists(filePath);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) && isRecord(parsed.mcpServers) && locator.serverName in parsed.mcpServers;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function sameArtifactScope(
  left: LibraryArtifactMetadata['scope'],
  right: LibraryArtifactMetadata['scope'],
): boolean {
  return left.kind === right.kind &&
    (left.kind === 'global' || (right.kind === 'provider-overlay' && left.provider === right.provider));
}

function textDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function objectDigest(value: unknown): string {
  return textDigest(JSON.stringify(value));
}

async function createCanonicalArtifact(
  input: ManagerRpcInputs['library.create'],
  home: string,
): Promise<LibraryArtifactMetadata> {
  const scope = artifactScope(input.scope);
  const targets = scope.kind === 'provider-overlay' ? [scope.provider] : input.targets ?? [];
  const locator = artifactLocator(input.kind, input.slug, scope);
  const artifact = createArtifactMetadata({
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    locator,
    description: input.description,
    tags: input.tags,
    scope,
    targets,
  });
  const issues = validateArtifactContent(artifact, input.content);
  if (issues.length > 0) throw new Error(`Invalid artifact: ${issues.map((issue) => issue.message).join('; ')}`);

  if (input.kind === 'instruction' && locator.type === 'file') {
    if (scope.kind === 'provider-overlay') {
      await writeFileEnsuringDir(path.join(home, 'rules', scope.provider, '.reglet-provider-overlay'), '');
    }
    await writeTextAtomic(path.join(home, ...locator.path.split('/')), input.content);
  } else if (input.kind === 'skill' && locator.type === 'directory') {
    await createSkill(
      scope.kind === 'global' ? { kind: 'shared' } : { kind: 'provider', provider: scope.provider },
      input.slug,
      input.content,
      home,
    );
  } else if (input.kind === 'mcp' && locator.type === 'mcp-server') {
    const definition = parseMcpServer(input.content);
    await upsertMcpServer(
      input.slug,
      definition,
      scope.kind === 'global' ? sharedMcpScope() : providerMcpScope(scope.provider),
      home,
      input.title,
    );
  }
  await addLibraryArtifact(artifact, home);
  if (scope.kind === 'global' && input.kind === 'skill') await updateSkillSyncProviders(input.slug, targets, home);
  if (scope.kind === 'global' && input.kind === 'mcp') await updateMcpSyncProviders(input.slug, targets, home);
  return artifact;
}

async function assertLibraryReady(home: string): Promise<void> {
  const status = await libraryMigrationStatus(home);
  if (status.state === 'available') {
    throw new Error('Library migration approval is required before creating canonical artifacts.');
  }
}

function validateArtifactContent(
  artifact: LibraryArtifactMetadata,
  content: string,
): Array<{ code: string; message: string }> {
  if (artifact.kind === 'instruction') {
    if (content.trim().length === 0) return [{ code: 'instruction-empty', message: 'Instruction content must not be empty.' }];
    if (content.startsWith('---') && !content.slice(3).includes('\n---')) {
      return [{ code: 'frontmatter-invalid', message: 'Markdown frontmatter is not closed.' }];
    }
    return [];
  }
  if (artifact.kind === 'skill') {
    const validation = hasValidSkillFrontmatter(content);
    return validation.ok ? [] : validation.issues.map((message) => ({ code: 'skill-frontmatter-invalid', message }));
  }
  try {
    const parsed = parseMcpServer(content);
    const validation = validateMcpServer(artifact.slug, parsed);
    return validation.ok ? [] : validation.issues.map((message) => ({ code: 'mcp-invalid', message }));
  } catch (error) {
    return [{ code: 'mcp-json-invalid', message: error instanceof Error ? error.message : 'Invalid MCP JSON.' }];
  }
}

async function showArtifact(reference: string, home: string, state: LocalState): Promise<unknown> {
  const artifact = await resolveArtifact(reference, home);
  return {
    artifact,
    content: await readArtifactText(artifact.id, home),
    draft: await loadDraft(artifact.id, home),
    history: await historyForSnapshot(artifact.id, home),
    projections: state.listProjectionRecords(artifact.id),
  };
}

async function resolveArtifact(reference: string, home: string): Promise<LibraryArtifactMetadata> {
  const artifacts = (await loadLibraryManifest(home)).artifacts;
  const direct = artifacts.find((artifact) => artifact.id === reference);
  if (direct !== undefined) return direct;
  const matches = artifacts.filter((artifact) => artifact.slug === reference);
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  if (matches.length > 1) throw new Error(`Artifact reference is ambiguous: ${reference}`);
  throw new Error(`Unknown artifact: ${reference}`);
}

async function resolveArtifactIdIncludingDeleted(reference: string, home: string): Promise<string> {
  const manifest = await loadLibraryManifest(home);
  return manifest.artifacts.find((artifact) => artifact.id === reference || artifact.slug === reference)?.id ??
    manifest.tombstones.find((tombstone) => tombstone.id === reference || tombstone.slug === reference)?.id ??
    reference;
}

interface ProviderSourceContext {
  commonIssues: ManagerProjectionIssueV3[];
  contentIssues: Partial<Record<ApplyContent, ManagerProjectionIssueV3[]>>;
  extraItems: Partial<Record<ApplyContent, ManagerProviderSourceV3['items']>>;
}

function emptyProviderSourceContext(): ProviderSourceContext {
  return { commonIssues: [], contentIssues: {}, extraItems: {} };
}

async function providerSpecificSourceContext(
  adapter: ReturnType<typeof getAdapter>,
  context = emptyProviderSourceContext(),
): Promise<ProviderSourceContext> {
  if (adapter.id !== 'codex') return context;
  const rulesPath = adapter.rulesPath();
  const overridePath = rulesPath === null ? null : path.join(path.dirname(rulesPath), 'AGENTS.override.md');
  if (overridePath === null || !(await fileExists(overridePath))) return context;
  context.contentIssues.rules = [{
    code: 'codex-global-override-active',
    severity: 'error',
    message: 'AGENTS.override.md shadows the managed Codex AGENTS.md file. Reglet will not apply Codex instructions until you adopt, move, or remove the override.',
  }];
  context.extraItems.rules = [{
    id: providerSourceItemId('codex', 'rules', 'AGENTS.override.md'),
    label: 'AGENTS.override.md',
    ownership: 'unmanaged',
  }];
  return context;
}

async function providerList() {
  return Promise.all(allAdapters().map(async (adapter) => {
    let detected = false;
    const sourceContext = emptyProviderSourceContext();
    try {
      detected = await adapter.detect();
    } catch {
      sourceContext.commonIssues.push({
        code: 'provider-detection-failed',
        severity: 'warning',
        message: `Reglet could not determine whether ${adapter.displayName} is installed.`,
      });
    }
    let inventory: ProviderInventory;
    try {
      inventory = await adapter.inventory();
    } catch {
      inventory = await fallbackProviderInventory(adapter);
      sourceContext.commonIssues.push({
        code: 'provider-inventory-failed',
        severity: 'error',
        message: `Reglet could not read part of the ${adapter.displayName} configuration.`,
      });
    }
    await providerSpecificSourceContext(adapter, sourceContext);
    return {
      id: adapter.id,
      displayName: adapter.displayName,
      detected,
      documentationUrl: adapter.documentationUrl,
      lastVerifiedAt: adapter.lastVerifiedAt,
      schemaVersion: adapter.schemaVersion,
      capabilities: {
        instructions: capability(adapter.rulesPath() !== null, adapter, 'instruction'),
        skills: capability(adapter.skillsDir() !== null, adapter, 'skill'),
        mcp: capability(adapter.mcpPath() !== null, adapter, 'mcp'),
      },
      inventory,
      sourceContext,
    };
  }));
}

async function fallbackProviderInventory(adapter: ReturnType<typeof getAdapter>): Promise<ProviderInventory> {
  const rulesPath = adapter.rulesPath();
  const skillsDir = adapter.skillsDir();
  return {
    rulesPath,
    rulesExists: rulesPath === null ? false : await fileExists(rulesPath),
    skillsDir,
    skills: skillsDir === null ? [] : await childDirectories(skillsDir),
    mcpPath: adapter.mcpPath(),
    mcpServers: [],
  };
}

function providerSources(
  provider: ProviderId,
  inventory: ProviderInventory,
  outputs: Readonly<Record<string, ManifestOutput>>,
  context: ProviderSourceContext,
): ManagerProviderSourceV3[] {
  const rulesItems: ManagerProviderSourceV3['items'] = [
    ...(inventory.rulesExists && inventory.rulesPath !== null
      ? [{
          id: providerSourceItemId(provider, 'rules', 'instructions'),
          label: path.basename(inventory.rulesPath),
          ownership: isManagedProviderOutput(outputs[inventory.rulesPath], provider, 'rules') ? 'managed' as const : 'unmanaged' as const,
        }]
      : []),
    ...(context.extraItems.rules ?? []),
  ];
  const skillItems: ManagerProviderSourceV3['items'] = [...inventory.skills.map((name) => {
    const outputPath = inventory.skillsDir === null ? undefined : path.join(inventory.skillsDir, name);
    return {
      id: providerSourceItemId(provider, 'skills', name),
      label: name,
      ownership: outputPath !== undefined && isManagedProviderOutput(outputs[outputPath], provider, 'skills')
        ? 'managed' as const
        : 'unmanaged' as const,
    };
  }), ...(context.extraItems.skills ?? [])];
  const mcpOutput = inventory.mcpPath === null ? undefined : outputs[inventory.mcpPath];
  const mcpManaged = isManagedProviderOutput(mcpOutput, provider, 'mcp');
  const managedMcpKeys = mcpManaged && mcpOutput?.managedKeys !== undefined
    ? new Set(mcpOutput.managedKeys)
    : undefined;
  const mcpItems: ManagerProviderSourceV3['items'] = [...inventory.mcpServers.map((name) => ({
    id: providerSourceItemId(provider, 'mcp', name),
    label: name,
    ownership: !mcpManaged
      ? 'unmanaged' as const
      : managedMcpKeys === undefined
        ? 'unknown' as const
        : managedMcpKeys.has(name)
          ? 'managed' as const
          : 'unmanaged' as const,
  })), ...(context.extraItems.mcp ?? [])];
  return [
    providerSource(provider, 'rules', inventory.rulesPath, rulesItems.length > 0, rulesItems, sourceIssues(context, 'rules')),
    providerSource(provider, 'skills', inventory.skillsDir, skillItems.length > 0, skillItems, sourceIssues(context, 'skills')),
    providerSource(provider, 'mcp', inventory.mcpPath, mcpItems.length > 0, mcpItems, sourceIssues(context, 'mcp')),
  ];
}

function sourceIssues(context: ProviderSourceContext, content: ApplyContent): ManagerProjectionIssueV3[] {
  return [...context.commonIssues, ...(context.contentIssues[content] ?? [])];
}

function providerSource(
  provider: ProviderId,
  content: ApplyContent,
  sourcePath: string | null,
  exists: boolean,
  items: ManagerProviderSourceV3['items'],
  inventoryIssues: readonly ManagerProjectionIssueV3[],
): ManagerProviderSourceV3 {
  const issues = sourcePath === null
    ? [{
        code: 'provider-content-unsupported',
        severity: 'info' as const,
        message: `${provider} does not expose a ${content} source.`,
      }]
    : [...inventoryIssues];
  return {
    provider,
    content,
    path: sourcePath,
    exists,
    readable: sourcePath !== null && !issues.some((issue) => issue.severity === 'error'),
    ownership: sourceOwnership(items),
    items,
    issues,
  };
}

function sourceOwnership(items: ManagerProviderSourceV3['items']): ManagerProviderSourceV3['ownership'] {
  if (items.length === 0) return 'empty';
  const states = new Set(items.map((item) => item.ownership));
  return states.size === 1 ? items[0]?.ownership ?? 'empty' : 'mixed';
}

function isManagedProviderOutput(
  output: ManifestOutput | undefined,
  provider: ProviderId,
  content: ApplyContent,
): boolean {
  return output?.provider === provider && output.content === content;
}

function providerSourceItemId(provider: ProviderId, content: ApplyContent, label: string): string {
  return `${provider}:${content}:${encodeURIComponent(label)}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function childDirectories(directoryPath: string): Promise<string[]> {
  try {
    return (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function capability(supported: boolean, adapter: ReturnType<typeof getAdapter>, kind: ArtifactKind) {
  const issue = supported
    ? undefined
    : adapter.discoveries.find((declaration) =>
        declaration.scope === 'global' && declaration.kind === kind && !declaration.supported)?.issue;
  return { supported, ...(issue === undefined ? {} : { issue }) };
}

function projectionForArtifact(
  artifact: LibraryArtifactMetadata,
  provider: ProviderId,
  batch: ProjectionBatchPreview,
  record: ReturnType<LocalState['listProjectionRecords']>[number] | undefined,
  outputs: Readonly<Record<string, ManifestOutput>>,
): ManagerArtifactProjectionV3 {
  const unit = batch.units.find((candidate) => candidate.provider === provider && candidate.content === contentForKind(artifact.kind));
  const entry = entryForArtifact(unit, artifact);
  const desiredHash = entry?.resultingTargetHash ?? undefined;
  const observedHash = entry?.expectedTargetHash ?? undefined;
  const destinationPath = entry?.path.length ? entry.path : destinationForArtifact(artifact, provider);
  const output = destinationPath === undefined ? undefined : outputs[destinationPath];
  const managedOutput = output?.provider === provider && output.content === contentForKind(artifact.kind)
    ? output
    : undefined;
  const appliedHash = record?.appliedHash ?? managedOutput?.hash;
  const appliedRevision = record?.appliedRevision ?? managedOutput?.masterRevision ?? managedOutput?.compositionRevision;
  const appliedAt = record?.appliedAt ?? managedOutput?.appliedAt;
  const supported = destinationPath !== undefined;
  const targeted = artifact.lifecycle === 'active' && artifact.targets.includes(provider);
  const issues = [
    ...(unit?.validationIssues ?? []).map((message) => ({ code: 'blocked-projection', severity: 'error' as const, message })),
    ...(supported ? [] : [{ code: 'unsupported', severity: 'warning' as const, message: `${provider} does not support this artifact kind.` }]),
    ...(targeted && managedOutput === undefined && entry?.driftStatus === 'unmanaged'
      ? [{
          code: 'unmanaged-provider-output',
          severity: 'info' as const,
          message: `Existing ${provider} ${contentForKind(artifact.kind)} content has not been applied by Reglet.`,
        }]
      : []),
  ];
  return {
    artifactId: artifact.id,
    provider,
    status: deriveProjectionStatus({
      targeted,
      supported,
      outputExists: observedHash !== undefined,
      desiredHash,
      appliedHash,
      observedHash,
      blocked: issues.some((issue) => issue.severity === 'error'),
    }),
    destinationPath: destinationPath ?? null,
    ...(desiredHash === undefined ? {} : { desiredHash }),
    ...(appliedHash === undefined ? {} : { appliedHash }),
    ...(observedHash === undefined ? {} : { observedHash }),
    ...(appliedRevision === undefined ? {} : { appliedRevision }),
    ...(appliedAt === undefined ? {} : { appliedAt }),
    issues,
  };
}

function entryForArtifact(unit: ProjectionUnitPreview | undefined, artifact: LibraryArtifactMetadata) {
  if (unit === undefined) return undefined;
  const nonSkipped = unit.entries.filter((entry) => entry.operation !== 'skip');
  if (artifact.kind !== 'skill') return nonSkipped[0];
  return nonSkipped.find((entry) => path.basename(entry.path) === artifact.slug);
}

function managerProjectionReview(
  batch: ProjectionBatchPreview,
  artifacts: readonly LibraryArtifactMetadata[],
): ManagerProjectionReviewV3 {
  return {
    version: 1,
    digest: batch.digest,
    units: batch.units.map((unit) => ({
      key: unit.key,
      provider: unit.provider,
      content: unit.content,
      digest: unit.digest,
      masterRevision: unit.masterRevision,
      status: unit.status,
      validationIssues: unit.validationIssues,
      validationIssueCodes: unit.validationIssueCodes,
      entries: unit.entries.map((entry) => ({
        operation: entry.operation,
        path: entry.path,
        diff: entry.diff,
        driftStatus: entry.driftStatus,
        expectedTargetHash: entry.expectedTargetHash,
        resultingTargetHash: entry.resultingTargetHash,
        snapshotBehavior: entry.snapshot.behavior,
        backupBehavior: entry.backup.behavior,
        ...(entry.operation === 'skip' && typeof entry.after === 'string' ? { note: entry.after } : {}),
      })),
      artifacts: artifacts
        .filter((artifact) => artifact.lifecycle === 'active' &&
          contentForKind(artifact.kind) === unit.content && artifact.targets.includes(unit.provider))
        .map((artifact) => ({ id: artifact.id, title: artifact.title, kind: artifact.kind })),
      requiresDriftConfirmation: unit.entries.some((entry) =>
        entry.driftStatus === 'modified' || entry.driftStatus === 'missing'),
    })),
  };
}

function managerProjectionApplyResult(result: ProjectionBatchApplyResult) {
  return {
    version: result.version,
    units: result.units.map((unit) => ({
      key: unit.key,
      provider: unit.provider,
      content: unit.content,
      status: unit.status,
      issues: unit.issues,
      ...(unit.receipt === undefined ? {} : {
        receiptId: unit.receipt.id,
        completedAt: unit.receipt.completedAt,
      }),
    })),
    summary: result.summary,
  };
}

function managerProviderRestoreReview(
  preview: ProviderRestorePreview,
): ManagerProviderRestoreReviewV3 {
  return {
    version: preview.version,
    provider: preview.provider,
    digest: preview.digest,
    status: preview.status,
    issues: preview.issues,
    targets: preview.targets,
  };
}

function managerProviderDetachReview(
  preview: DetachManagedContentPreview,
): ManagerProviderDetachReviewV3 {
  return {
    version: preview.version,
    provider: preview.provider,
    content: preview.content,
    digest: preview.digest,
    status: preview.status,
    issues: preview.issues,
    targets: preview.targets,
  };
}

function managerRecoveryReceipt(receipt: OperationReceipt): ManagerRecoveryReceiptV3 {
  return managerRecoveryReceiptSummary({
    id: receipt.id,
    lifecycle: receipt.lifecycle,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    providers: receipt.scope.providers ?? [],
    contents: receipt.scope.contents ?? [],
    targetCount: receipt.targets.length,
    restoreAllowed: receipt.restorePolicy?.allowed,
    reason: receipt.restorePolicy?.reason,
  });
}

function managerRecoveryReview(preview: OperationRestorePreview): ManagerRecoveryReviewV3 {
  return {
    version: 1,
    receipt: managerRecoveryReceiptSummary({
      id: preview.receiptId,
      lifecycle: preview.lifecycle,
      startedAt: preview.startedAt,
      completedAt: preview.completedAt,
      providers: preview.scope.providers ?? [],
      contents: preview.scope.contents ?? [],
      targetCount: preview.targets.length,
      restoreAllowed: preview.restorable,
      reason: preview.reason,
    }),
    digest: preview.digest,
    targets: preview.targets,
  };
}

function managerRecoveryReceiptSummary(input: {
  id: string;
  lifecycle: OperationReceipt['lifecycle'];
  startedAt: string;
  completedAt: string | null;
  providers: ProviderId[];
  contents: ApplyContent[];
  targetCount: number;
  restoreAllowed?: boolean;
  reason?: string;
}): ManagerRecoveryReceiptV3 {
  const restorable = input.lifecycle === 'completed' && input.targetCount > 0 && input.restoreAllowed !== false;
  const reason = restorable
    ? undefined
    : input.reason ?? (input.restoreAllowed === false
      ? 'This operation has a dedicated inverse action and cannot be replayed from its receipt.'
      : input.targetCount === 0
      ? 'This receipt did not change any filesystem targets.'
      : `A ${input.lifecycle} receipt cannot be restored.`);
  return {
    id: input.id,
    lifecycle: input.lifecycle,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    providers: [...new Set(input.providers)],
    contents: [...new Set(input.contents)],
    targetCount: input.targetCount,
    restorable,
    ...(reason === undefined ? {} : { reason }),
  };
}

function destinationForArtifact(artifact: LibraryArtifactMetadata, provider: ProviderId): string | undefined {
  const adapter = getAdapter(provider);
  if (artifact.kind === 'instruction') return adapter.rulesPath() ?? undefined;
  if (artifact.kind === 'mcp') return adapter.mcpPath() ?? undefined;
  const root = adapter.skillsDir();
  return root === null ? undefined : path.join(root, artifact.slug);
}

async function recordAppliedProjections(
  preview: ProjectionBatchPreview,
  results: Array<{ key: string; status: string; receipt?: { completedAt: string | null } }>,
  home: string,
  state: LocalState,
): Promise<void> {
  const manifest = await loadLibraryManifest(home);
  for (const result of results.filter((candidate) => candidate.status === 'applied')) {
    const unit = preview.units.find((candidate) => candidate.key === result.key);
    if (unit === undefined) continue;
    const kind = kindForContent(unit.content);
    for (const artifact of manifest.artifacts.filter((candidate) =>
      candidate.kind === kind && candidate.lifecycle === 'active' && candidate.targets.includes(unit.provider))) {
      const entry = entryForArtifact(unit, artifact);
      state.saveProjectionRecord({
        artifactId: artifact.id,
        provider: unit.provider,
        destinationPath: entry?.path || destinationForArtifact(artifact, unit.provider),
        desiredHash: entry?.resultingTargetHash ?? undefined,
        appliedHash: entry?.resultingTargetHash ?? undefined,
        observedHash: entry?.resultingTargetHash ?? undefined,
        appliedRevision: unit.masterRevision,
        appliedAt: result.receipt?.completedAt ?? new Date().toISOString(),
      });
    }
  }
}

async function scanConfiguredRoots(rootId: string | undefined, reappearChangedIgnored: boolean | undefined, state: LocalState) {
  const roots = rootId === undefined ? state.listProjectRoots() : [state.getProjectRoot(rootId)].filter((root) => root !== undefined);
  if (rootId !== undefined && roots.length === 0) throw new Error(`Unknown project root: ${rootId}`);
  const results = [];
  for (const root of roots) {
    const discoveries = await scanProjectRoot(root.path, {
      ignored: state.ignoredDiscoveries(root.id),
      reappearChangedIgnored,
    });
    state.replaceDiscoveries(root.id, discoveries);
    await indexProjectDiscoveries(root.id, root.path, discoveries, state);
    results.push({ rootId: root.id, count: discoveries.length });
  }
  return results;
}

async function promotionPreview(
  discoveryId: string,
  requestedMode: 'global-instruction' | 'convert-to-skill' | 'disabled-draft' | undefined,
  home: string,
  state: LocalState,
) {
  const discovery = state.listDiscoveries().find((candidate) => candidate.id === discoveryId);
  if (discovery === undefined) throw new Error(`Unknown discovery: ${discoveryId}`);
  const root = state.getProjectRoot(discovery.rootId);
  if (root === undefined) throw new Error(`Unknown project root: ${discovery.rootId}`);
  const sourcePath = path.join(root.path, discovery.relativePath);
  const library = await loadLibraryManifest(home);
  if (discovery.kind === 'instruction') {
    const source = await readFile(sourcePath, 'utf8');
    const recommendation = recommendInstructionPromotion({ ...discovery, absolutePath: sourcePath });
    const mode = requestedMode ?? recommendation.defaultMode;
    const kind: ArtifactKind = mode === 'convert-to-skill' ? 'skill' : 'instruction';
    return {
      kind,
      mode,
      recommendation,
      sourceHash: discovery.sourceHash,
      candidates: await Promise.all(library.artifacts.filter((artifact) => artifact.kind === kind).map(async (artifact) => ({
        artifact,
        hunks: compareTextLines(await readArtifactText(artifact.id, home), promotedInstructionContent(source, mode, artifact.slug, discovery.relativePath)),
      }))),
    };
  }
  if (discovery.kind === 'skill') {
    const inspection = await inspectSkill(sourcePath);
    return {
      kind: 'skill',
      sourceHash: discovery.sourceHash,
      inspection,
      candidates: library.artifacts.filter((artifact) => artifact.kind === 'skill'),
    };
  }
  const servers = parseProjectMcpServers(await readFile(sourcePath, 'utf8'), sourcePath, root.path);
  return {
    kind: 'mcp',
    sourceHash: discovery.sourceHash,
    servers: servers.map((server) => ({
      name: server.name,
      definition: server.definition,
      issues: server.issues,
      machineOverrideFields: server.machineOverrides.map((override) => override.fieldPath),
      secretReferenceIds: server.secretReferenceIds,
    })),
    candidates: library.artifacts.filter((artifact) => artifact.kind === 'mcp'),
  };
}

async function promoteDiscovery(
  input: ManagerRpcInputs['project.promote'],
  home: string,
  state: LocalState,
): Promise<unknown> {
  const discovery = state.listDiscoveries().find((candidate) => candidate.id === input.discoveryId);
  if (discovery === undefined) throw new Error(`Unknown discovery: ${input.discoveryId}`);
  const root = state.getProjectRoot(discovery.rootId);
  if (root === undefined) throw new Error(`Unknown project root: ${discovery.rootId}`);
  const sourcePath = path.join(root.path, discovery.relativePath);
  const targets = input.targets ?? [];
  const destination = input.destinationArtifact === undefined
    ? undefined
    : await resolveArtifact(input.destinationArtifact, home);
  let artifact: LibraryArtifactMetadata;
  let mode: string;
  const warnings: string[] = [];

  if (discovery.kind === 'instruction') {
    const source = await readFile(sourcePath, 'utf8');
    const recommendation = recommendInstructionPromotion({ ...discovery, absolutePath: sourcePath });
    const instructionMode = input.mode ?? recommendation.defaultMode;
    mode = instructionMode;
    warnings.push(...recommendation.warnings);
    const kind: ArtifactKind = instructionMode === 'convert-to-skill' ? 'skill' : 'instruction';
    if (destination !== undefined) {
      if (destination.kind !== kind) throw new Error(`${mode} promotion requires a ${kind} destination.`);
      const incoming = promotedInstructionContent(source, instructionMode, destination.slug, discovery.relativePath);
      const availableHunks = compareTextLines(await readArtifactText(destination.id, home), incoming);
      assertSelection(input.selectedHunks, availableHunks.map((hunk) => hunk.id), 'hunk');
      const merged = mergeSelectedTextHunks(await readArtifactText(destination.id, home), incoming, input.selectedHunks);
      const issues = validateArtifactContent(destination, merged);
      if (issues.length > 0) throw new Error(`Invalid promoted artifact: ${issues.map((issue) => issue.message).join('; ')}`);
      await commitArtifactText(destination.id, merged, [], home);
      artifact = input.targets === undefined
        ? destination
        : await setArtifactTargets(destination.id, instructionMode === 'disabled-draft' ? [] : targets, home);
    } else {
      const slug = await availablePromotionSlug(slugFromDiscovery(discovery.relativePath), kind, home);
      artifact = await createCanonicalArtifact({
        kind,
        slug,
        title: titleFromSlug(slug),
        content: promotedInstructionContent(source, instructionMode, slug, discovery.relativePath),
        targets: instructionMode === 'disabled-draft' ? [] : targets,
      }, home);
    }
  } else if (discovery.kind === 'skill') {
    mode = 'skill';
    const inspection = await inspectSkill(sourcePath);
    if (inspection.promotionBlocked) {
      throw new Error(inspection.risks.find((risk) => risk.severity === 'error')?.message ?? 'Skill promotion is blocked.');
    }
    const files = inspection.files.filter((file) => file.kind !== 'directory').map((file) => file.relPath);
    const selected = input.selectedFiles ?? files;
    assertSelection(selected, files, 'file');
    const executableFiles = inspection.files.filter((file) => file.executable && selected.includes(file.relPath));
    if (executableFiles.length > 0 && input.confirmedExecutableRevision !== inspection.revision) {
      throw new Error('Executable skill files require confirmation for the exact inspected revision.');
    }
    if (destination !== undefined) {
      if (destination.kind !== 'skill' || destination.locator.type !== 'directory') throw new Error('Skill merge requires a skill destination.');
      await snapshotArtifact(destination, 'edit', home);
      const resulting = await mergeSkillFilesSafely(sourcePath, path.join(home, ...destination.locator.path.split('/')), selected);
      artifact = input.targets === undefined ? destination : await setArtifactTargets(destination.id, targets, home);
      if (executableFiles.length > 0) saveTrustDecision(state, artifact.id, resulting);
    } else {
      if (selected.length !== files.length) throw new Error('A new skill requires the complete reviewed file tree.');
      const slug = await availablePromotionSlug(slugFromDiscovery(discovery.relativePath), 'skill', home);
      artifact = createArtifactMetadata({
        kind: 'skill', slug, title: titleFromSlug(slug), locator: { type: 'directory', path: path.posix.join('skills', slug) }, targets,
      });
      await copySkillSafely(sourcePath, path.join(home, 'skills', slug));
      await addLibraryArtifact(artifact, home);
      await updateSkillSyncProviders(slug, targets, home);
      if (executableFiles.length > 0) saveTrustDecision(state, artifact.id, inspection);
    }
    warnings.push(...inspection.risks.map((risk) => risk.message));
  } else {
    mode = 'mcp';
    const candidates = parseProjectMcpServers(await readFile(sourcePath, 'utf8'), sourcePath, root.path);
    const candidate = input.serverName === undefined
      ? candidates[0]
      : candidates.find((server) => server.name === input.serverName);
    if (candidate === undefined) throw new Error('Project MCP server is unavailable.');
    const blocking = candidate.issues.filter((issue) => issue.severity === 'error');
    if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join('; '));
    const content = `${JSON.stringify(candidate.definition, null, 2)}\n`;
    if (destination !== undefined) {
      if (destination.kind !== 'mcp') throw new Error('MCP promotion requires an MCP destination.');
      const issues = validateArtifactContent(destination, content);
      if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('; '));
      await commitArtifactText(destination.id, content, [], home);
      artifact = input.targets === undefined ? destination : await setArtifactTargets(destination.id, targets, home);
    } else {
      const slug = await availablePromotionSlug(normalizeSlug(candidate.name), 'mcp', home);
      artifact = await createCanonicalArtifact({ kind: 'mcp', slug, title: titleFromSlug(slug), content, targets }, home);
    }
    state.replaceMcpMachineOverrides(artifact.id, candidate.machineOverrides);
    warnings.push(...candidate.issues.map((issue) => issue.message));
  }

  if (input.targets !== undefined && artifact.scope.kind === 'global') {
    if (artifact.kind === 'skill') await updateSkillSyncProviders(artifact.slug, artifact.targets, home);
    if (artifact.kind === 'mcp') await updateMcpSyncProviders(artifact.slug, artifact.targets, home);
  }

  state.saveProvenance({
    artifactId: artifact.id,
    repositoryLabel: root.label,
    localPath: discovery.relativePath,
    originalProviderFormat: Object.values(discovery.formatsByProvider)[0] ?? 'unknown',
    sourceHash: discovery.sourceHash,
    metadata: { recognizedBy: discovery.recognizedBy, promotionMode: mode, scopeFields: discovery.scope.lossyFields },
  });
  state.markDiscoveryState(discovery.id, 'promoted');
  return { artifact, mode, warnings };
}

function saveTrustDecision(state: LocalState, artifactId: string, inspection: Awaited<ReturnType<typeof inspectSkill>>): void {
  state.saveTrustDecision({
    artifactId,
    revision: inspection.revision,
    trustedAt: new Date().toISOString(),
    executableFiles: inspection.files.filter((file) => file.executable).map((file) => file.relPath),
  });
}

async function availablePromotionSlug(initial: string, kind: ArtifactKind, home: string): Promise<string> {
  const used = new Set((await loadLibraryManifest(home)).artifacts.filter((artifact) => artifact.kind === kind).map((artifact) => artifact.slug));
  if (!used.has(initial)) return initial;
  let suffix = 2;
  while (used.has(`${initial}-${suffix}`)) suffix += 1;
  return `${initial}-${suffix}`;
}

function slugFromDiscovery(relativePath: string): string {
  const basename = path.basename(relativePath).replace(/\.(?:md|mdc|json|jsonc|toml)$/i, '');
  const candidate = /^(?:agents|claude|gemini|skill)$/i.test(basename)
    ? path.basename(path.dirname(relativePath))
    : basename;
  return normalizeSlug(candidate);
}

function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project-artifact';
}

function titleFromSlug(slug: string): string {
  return slug.split('-').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function promotedInstructionContent(
  source: string,
  mode: 'global-instruction' | 'convert-to-skill' | 'disabled-draft' | 'disabled-library-draft',
  slug: string,
  relativePath: string,
): string {
  const content = stripProviderFrontmatter(source);
  return mode === 'convert-to-skill'
    ? `---\nname: ${slug}\ndescription: Promoted project guidance from ${path.basename(relativePath)}\n---\n\n${content.trimStart()}`
    : content;
}

function stripProviderFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return content;
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  return end < 0 ? content : lines.slice(end + 2).join('\n');
}

function assertSelection(selected: string[] | undefined, available: string[], label: string): void {
  if (selected === undefined) return;
  const allowed = new Set(available);
  const unavailable = selected.find((value) => !allowed.has(value));
  if (unavailable !== undefined) throw new Error(`Selected promotion ${label} is unavailable: ${unavailable}`);
}

async function indexProjectDiscoveries(
  rootId: string,
  rootPath: string,
  discoveries: Awaited<ReturnType<typeof scanProjectRoot>>,
  state: LocalState,
): Promise<void> {
  const records = await Promise.all(discoveries.map(async (discovery) => {
    const sourcePath = path.join(rootPath, discovery.relativePath);
    let body = '';
    try {
      body = discovery.kind === 'skill'
        ? await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
        : discovery.size <= 2 * 1024 * 1024
          ? await readFile(sourcePath, 'utf8')
          : '';
    } catch { body = ''; }
    return {
      id: `project:${rootId}:${discovery.id}`,
      source: 'project' as const,
      kind: discovery.kind,
      title: path.basename(discovery.relativePath),
      pathLabel: discovery.relativePath,
      body,
    };
  }));
  state.replaceSearchPrefix(`project:${rootId}:`, records);
}

async function inspectCanonicalSkill(reference: string, home: string) {
  const artifact = await resolveArtifact(reference, home);
  if (artifact.kind !== 'skill' || artifact.locator.type !== 'directory') throw new Error('Skill inspection requires a canonical skill.');
  return inspectSkill(path.join(home, ...artifact.locator.path.split('/')));
}

async function managerSkillInspection(reference: string, home: string, state: LocalState) {
  const artifact = await resolveArtifact(reference, home);
  if (artifact.kind !== 'skill' || artifact.locator.type !== 'directory') throw new Error('Skill inspection requires a canonical skill.');
  const inspection = await inspectSkill(path.join(home, ...artifact.locator.path.split('/')));
  const decision = state.trustDecision(artifact.id);
  const trustState = inspection.promotionBlocked
    ? 'blocked'
    : !inspection.requiresExecutableConfirmation
      ? 'not-required'
      : decision === undefined
        ? 'untrusted'
        : isTrustDecisionCurrent(decision, inspection)
          ? 'trusted'
          : 'changed';
  return {
    artifact: {
      id: artifact.id,
      title: artifact.title,
      slug: artifact.slug,
      targets: artifact.targets,
    },
    revision: inspection.revision,
    totalBytes: inspection.totalBytes,
    files: inspection.files,
    risks: inspection.risks,
    promotionBlocked: inspection.promotionBlocked,
    requiresExecutableConfirmation: inspection.requiresExecutableConfirmation,
    trust: {
      state: trustState,
      ...(decision === undefined ? {} : {
        revision: decision.revision,
        trustedAt: decision.trustedAt,
        executableFiles: decision.executableFiles,
      }),
    },
  };
}

async function projectionUnitIssues(
  home: string,
  state: LocalState,
  providers?: ProviderId[],
): Promise<Record<string, ProjectionValidationIssue[]>> {
  const issues = await skillTrustUnitIssues(home, state, providers);
  if (providers === undefined || providers.includes('codex')) {
    const rulesPath = getAdapter('codex').rulesPath();
    const overridePath = rulesPath === null ? null : path.join(path.dirname(rulesPath), 'AGENTS.override.md');
    if (overridePath !== null && await fileExists(overridePath)) {
      const current = issues['codex:rules'] ?? [];
      current.push({
        code: 'provider-override-active',
        message: 'AGENTS.override.md shadows the managed Codex AGENTS.md file. Adopt, move, or remove the override before applying Codex instructions.',
      });
      issues['codex:rules'] = current;
    }
  }
  return issues;
}

async function skillTrustUnitIssues(
  home: string,
  state: LocalState,
  providers: ProviderId[] | undefined,
): Promise<Record<string, ProjectionValidationIssue[]>> {
  const selectedProviders = providers ?? allAdapters().map((adapter) => adapter.id);
  const manifest = await loadLibraryManifest(home);
  const issues: Record<string, ProjectionValidationIssue[]> = {};
  for (const artifact of manifest.artifacts.filter((candidate) =>
    candidate.kind === 'skill' && candidate.lifecycle === 'active' && candidate.locator.type === 'directory')) {
    const inspection = await inspectSkill(path.join(home, ...artifact.locator.path.split('/')));
    if (!inspection.requiresExecutableConfirmation) continue;
    const decision = state.trustDecision(artifact.id);
    if (decision !== undefined && isTrustDecisionCurrent(decision, inspection)) continue;
    const message = decision === undefined
      ? `Executable skill ${artifact.slug} has not been approved for provider sync at revision ${inspection.revision.slice(0, 12)}.`
      : `Executable skill ${artifact.slug} changed after approval. Review revision ${inspection.revision.slice(0, 12)} before provider sync.`;
    for (const provider of selectedProviders.filter((candidate) => artifact.targets.includes(candidate))) {
      const key = `${provider}:skills`;
      const current = issues[key] ?? [];
      current.push({ code: 'executable-skill-approval-required', message });
      issues[key] = current;
    }
  }
  return issues;
}

async function indexCanonicalLibrary(home: string, state: LocalState): Promise<void> {
  const manifest = await loadLibraryManifest(home);
  const records = await Promise.all(manifest.artifacts.map(async (artifact) => ({
    id: `canonical:${artifact.id}`,
    source: 'canonical' as const,
    kind: artifact.kind,
    title: artifact.title,
    pathLabel: artifact.locator.path,
    body: await readArtifactText(artifact.id, home),
  })));
  state.replaceSearchPrefix('canonical:', records);
}

async function secretBindings(home: string, store: SecretStore) {
  const master = await loadMasterDir(home);
  const references = new Map<string, SecretRef>();
  for (const definition of [
    ...Object.values(master.mcpDefinitions),
    ...Object.values(master.providerMcpDefinitions).flatMap((definitions) => Object.values(definitions)),
  ]) {
    for (const reference of Object.values(definition.server.env ?? {})) {
      const id = reference.source === 'keychain'
        ? `keychain:${reference.id}`
        : reference.source === 'oauth'
          ? `oauth:${reference.provider}`
          : `process-env:${reference.name}`;
      references.set(id, reference);
    }
  }
  return Promise.all([...references.entries()].map(async ([id, reference]) => ({
    id,
    bound: (await secretReferenceStatus(reference, store)).bound,
  })));
}

async function migrationSnapshot(home: string): Promise<ManagerMigrationStateV3> {
  const status = await libraryMigrationStatus(home);
  if (status.state === 'applied') {
    return { status: 'applied', appliedAt: status.receipt?.appliedAt ?? '', receiptId: status.receipt?.id ?? 'unrecorded' };
  }
  return { status: status.state, legacyArtifacts: status.artifactCount };
}

function publicMigrationPreview(preview: LibraryMigrationPreview) {
  return {
    version: preview.version,
    migration: preview.migration,
    required: preview.required,
    digest: preview.digest,
    artifacts: preview.artifacts.map(({ artifact, sourceExists }) => ({
      artifact,
      sourceExists,
    })),
  };
}

function publicMigrationStatus(status: LibraryMigrationStatus) {
  return {
    state: status.state,
    artifactCount: status.artifactCount,
    ...(status.receipt === undefined ? {} : {
      receipt: {
        version: status.receipt.version,
        id: status.receipt.id,
        migration: status.receipt.migration,
        digest: status.receipt.digest,
        appliedAt: status.receipt.appliedAt,
        artifactCount: status.receipt.artifactCount,
        reversible: status.receipt.reversible,
      },
    }),
  };
}

function projectInboxSnapshot(state: LocalState): ManagerProjectInboxV3 {
  return {
    roots: state.listProjectRoots(),
    discoveries: state.listDiscoveries().map((discovery) => ({
      id: discovery.id,
      rootId: discovery.rootId,
      relativePath: discovery.relativePath,
      kind: discovery.kind,
      sourceHash: discovery.sourceHash,
      size: discovery.size,
      recognizedBy: discovery.recognizedBy,
      providerFormats: Object.values(discovery.formatsByProvider).filter((value): value is string => value !== undefined),
      scopeSummary: discovery.scope.rootLevel ? 'Root-level' : 'Nested or scoped',
      state: discovery.state,
      changedSincePromotion: discovery.state === 'changed',
      skillRisks: discovery.skillRisks.map((risk) => risk.code),
    })),
  };
}

async function historyForSnapshot(artifactId: string, home: string) {
  const { listArtifactHistory } = await import('@reglet/core');
  return (await listArtifactHistory(artifactId, home)).map(({ revision, createdAt, reason }) => ({ revision, createdAt, reason }));
}

function draftForSnapshot(draft: ArtifactDraft) {
  return {
    updatedAt: draft.updatedAt,
    validationIssues: draft.validationIssues.map((issue) => ({ code: issue.code, severity: 'error' as const, message: issue.message })),
  };
}

async function diagnostics(
  home: string,
  _state: LocalState,
  secretStore: SecretStore,
  providerState?: Awaited<ReturnType<typeof providerList>>,
) {
  const migration = await libraryMigrationStatus(home);
  const issues: ManagerProjectionIssueV3[] = [];
  if (migration.state === 'available') {
    issues.push({
      code: 'migration-required',
      severity: 'warning',
      message: `${migration.artifactCount} legacy artifacts are ready for reviewed migration.`,
    });
  }
  for (const provider of providerState ?? await providerList()) {
    const providerIssues = [
      ...provider.sourceContext.commonIssues,
      ...Object.values(provider.sourceContext.contentIssues).flatMap((contentIssues) => contentIssues ?? []),
    ];
    for (const issue of providerIssues) {
      if (!issues.some((candidate) => candidate.code === issue.code && candidate.message === issue.message)) issues.push(issue);
    }
  }
  try {
    const drift = await detectDrift(home);
    const counts = new Map<string, { provider: string; content: string; status: 'modified' | 'missing'; count: number }>();
    for (const record of drift) {
      if (record.status === 'clean') continue;
      const key = `${record.provider}:${record.content}:${record.status}`;
      const current = counts.get(key);
      counts.set(key, {
        provider: record.provider,
        content: record.content,
        status: record.status,
        count: (current?.count ?? 0) + 1,
      });
    }
    for (const record of counts.values()) {
      const subject = record.count === 1 ? 'output' : `${record.count} outputs`;
      issues.push({
        code: `provider-output-${record.status}`,
        severity: 'warning',
        message: record.status === 'modified'
          ? `${record.provider} ${record.content} ${subject} changed outside Reglet.`
          : record.count === 1
            ? `${record.provider} ${record.content} output managed by Reglet is missing.`
            : `${record.count} ${record.provider} ${record.content} outputs managed by Reglet are missing.`,
      });
    }
  } catch {
    issues.push({
      code: 'provider-drift-check-failed',
      severity: 'error',
      message: 'Reglet could not verify one or more managed provider outputs.',
    });
  }
  try {
    const sync = await encryptedSyncStatus(home);
    if (sync.state === 'expired') {
      issues.push({
        code: 'sync-connection-expired',
        severity: 'warning',
        message: 'The pending encrypted sync connection expired and must be cleared before retrying.',
      });
    } else if (sync.state === 'conflict') {
      issues.push({
        code: 'sync-conflicts',
        severity: 'warning',
        message: `${sync.conflictCount} encrypted sync conflict${sync.conflictCount === 1 ? '' : 's'} require review.`,
      });
    } else if (sync.state === 'error') {
      issues.push({
        code: 'sync-last-run-failed',
        severity: 'error',
        message: sync.lastError?.message ?? 'The last encrypted sync attempt failed.',
      });
    }
  } catch {
    issues.push({
      code: 'sync-state-invalid',
      severity: 'error',
      message: 'Reglet could not read the local encrypted sync state.',
    });
  }
  try {
    await secretStore.status('reglet-diagnostics-probe');
  } catch {
    issues.push({
      code: 'credential-store-unavailable',
      severity: 'warning',
      message: 'The operating-system credential store is unavailable. Secret-backed MCP servers and encrypted sync may be blocked.',
    });
  }
  return {
    healthy: !issues.some((issue) => issue.severity === 'warning' || issue.severity === 'error'),
    issues,
  };
}

function enableRemote(endpoint: string, state: LocalState) {
  assertHttpsUrl(endpoint, 'Remote access');
  const url = new URL(endpoint);
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]' || url.hostname === '::') {
    throw new Error('Wildcard remote binding requires the advanced CLI override.');
  }
  state.setSetting('remote.enabled', 'true');
  state.setSetting('remote.endpoint', endpoint);
  return remoteStatus(state);
}

function remoteStatus(state: LocalState) {
  const enabled = state.setting('remote.enabled') === 'true';
  const endpoint = state.setting('remote.endpoint');
  return { enabled, ...(endpoint === undefined ? {} : { endpoint }) };
}

async function encryptedSyncStatus(home: string): Promise<ManagerSnapshotV3['settings']['sync']> {
  const state = await loadSyncV2State(home);
  if (state === null) return { enabled: false, phase: 'disabled', state: 'disabled', conflictCount: 0, conflicts: [] };
  if (state.phase === 'pending') {
    const expiresAt = state.method === 'pair' ? state.request.expiresAt : state.expiresAt;
    const deviceName = state.method === 'pair' ? state.request.deviceName : state.deviceName;
    return {
      enabled: false,
      phase: 'pending',
      state: isExpired(expiresAt) ? 'expired' : 'pending',
      conflictCount: 0,
      conflicts: [],
      pending: { method: state.method, deviceName, expiresAt },
    };
  }
  const conflicts = Object.entries(state.files)
    .filter(([, file]) => file.conflicted === true)
    .map(([filePath]) => filePath)
    .sort((left, right) => left.localeCompare(right));
  return {
    enabled: true,
    phase: 'active',
    state: conflicts.length > 0 ? 'conflict' : state.lastError === undefined ? 'idle' : 'error',
    conflictCount: conflicts.length,
    conflicts,
    ...(state.lastSync === undefined ? {} : { lastCompletedAt: state.lastSync.completedAt }),
    ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  };
}

function isExpired(value: string, now = Date.now()): boolean {
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function encryptedSyncCompatibilitySnapshot(home: string): Promise<SyncSnapshot> {
  const config = await loadConfig(home);
  const state = await loadSyncV2State(home);
  const previewAcknowledged = config.encryptedSyncPreview.acknowledged;
  if (state === null) {
    return {
      version: 1,
      previewAcknowledged,
      phase: 'disconnected',
      serverUrl: null,
      serverHost: null,
      compatibility: 'unknown',
      currentDeviceId: null,
      currentDeviceName: null,
      pending: null,
      devices: [],
      conflicts: [],
      lastSync: null,
      lastError: null,
      keyRotationRequired: false,
    };
  }
  const serverHost = new URL(state.serverUrl).host;
  if (state.phase === 'pending') {
    const localPending = localPendingSyncConnection(state);
    let pending = localPending;
    let compatibility: SyncSnapshot['compatibility'] = 'unknown';
    if (localPending.status !== 'expired') {
      try {
        const remotePending = await pendingSyncV2ConnectionStatus({ home });
        pending = {
          ...remotePending,
          code: remotePending.method === 'pair' ? remotePending.code : null,
        };
        compatibility = 'compatible';
      } catch {
        compatibility = 'unreachable';
      }
    }
    return {
      version: 1,
      previewAcknowledged,
      phase: 'pending',
      serverUrl: state.serverUrl,
      serverHost,
      compatibility,
      currentDeviceId: null,
      currentDeviceName: null,
      pending,
      devices: [],
      conflicts: [],
      lastSync: null,
      lastError: null,
      keyRotationRequired: false,
    };
  }
  let devices: SyncSnapshot['devices'] = [];
  let compatibility: SyncSnapshot['compatibility'] = 'compatible';
  try {
    const response = await listManagedSyncV2Devices({ home });
    devices = response.devices.map((device) => ({
      id: device.deviceId,
      name: device.deviceName,
      current: device.deviceId === response.currentDeviceId,
      status: device.revokedAt === null ? 'active' : 'revoked',
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt,
    }));
  } catch (error) {
    const revoked = error instanceof SyncV2RequestError && error.status === 401;
    compatibility = revoked ? 'revoked' : 'unreachable';
    if (revoked && state.keyRotationRequired !== true) {
      state.keyRotationRequired = true;
      await saveSyncV2State(state, home);
    }
  }
  return {
    version: 1,
    previewAcknowledged,
    phase: 'connected',
    serverUrl: state.serverUrl,
    serverHost,
    compatibility,
    currentDeviceId: state.deviceId,
    currentDeviceName: state.deviceName,
    pending: null,
    devices,
    conflicts: Object.entries(state.files)
      .filter(([, file]) => file.conflicted === true)
      .map(([filePath]) => filePath)
      .sort((left, right) => left.localeCompare(right)),
    lastSync: state.lastSync ?? null,
    lastError: state.lastError ?? null,
    keyRotationRequired: state.keyRotationRequired === true || compatibility === 'revoked',
  };
}

function localPendingSyncConnection(
  state: Extract<Awaited<ReturnType<typeof loadSyncV2State>>, { phase: 'pending' }>,
): SyncPendingConnection {
  if (state.method === 'pair') {
    return {
      method: 'pair',
      status: isExpired(state.request.expiresAt) ? 'expired' : 'pending',
      deviceName: state.request.deviceName,
      code: state.request.code,
      fingerprint: null,
      expiresAt: state.request.expiresAt,
    };
  }
  return {
    method: 'bootstrap',
    status: isExpired(state.expiresAt) ? 'expired' : 'pending',
    deviceName: state.deviceName,
    code: null,
    fingerprint: state.fingerprint,
    expiresAt: state.expiresAt,
  };
}

function assertHttpsUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} requires HTTPS.`);
}

function artifactScope(scope: unknown): LibraryArtifactMetadata['scope'] {
  if (isRecord(scope) && scope.kind === 'provider-overlay' && isProviderId(scope.provider)) {
    return { kind: 'provider-overlay', provider: scope.provider };
  }
  return { kind: 'global' };
}

function artifactLocator(kind: ArtifactKind, slug: string, scope: LibraryArtifactMetadata['scope']): LibraryArtifactMetadata['locator'] {
  const provider = scope.kind === 'provider-overlay' ? scope.provider : undefined;
  if (kind === 'instruction') return { type: 'file', path: path.posix.join('rules', ...(provider === undefined ? [] : [provider]), `${slug}.md`) };
  if (kind === 'skill') return { type: 'directory', path: path.posix.join('skills', ...(provider === undefined ? [] : [provider]), slug) };
  return { type: 'mcp-server', path: path.posix.join('mcp', ...(provider === undefined ? [] : ['providers', provider]), 'servers.json'), serverName: slug };
}

function parseMcpServer(content: string): McpServerDef {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error('MCP definition must be a JSON object.');
  return parsed as McpServerDef;
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const stage = `${filePath}.reglet-stage-${crypto.randomUUID()}`;
  await writeFile(stage, content);
  await rename(stage, filePath);
}

function contentForKind(kind: ArtifactKind): ApplyContent {
  return kind === 'instruction' ? 'rules' : kind === 'skill' ? 'skills' : 'mcp';
}

function kindForContent(content: ApplyContent): ArtifactKind {
  return content === 'rules' ? 'instruction' : content === 'skills' ? 'skill' : 'mcp';
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && allAdapters().some((adapter) => adapter.id === value);
}

function activityOutcome(data: unknown): 'success' | 'warning' | 'error' {
  if (isRecord(data) && isRecord(data.summary)) {
    return typeof data.summary.failed === 'number' && data.summary.failed > 0 ? 'warning' : 'success';
  }
  return 'success';
}

function activityContext(
  command: ApplicationCommand,
  data: unknown,
): {
  artifactId?: string;
  provider?: string;
  metadata?: Record<string, string | number | boolean | null>;
} {
  const input = command.input;
  const artifactId = activityArtifactId(command, data);
  const provider = isProviderId(input.provider)
    ? input.provider
    : singleProviderFromApplyInput(input);
  const summary = isRecord(data) && isRecord(data.summary) ? data.summary : undefined;
  const receiptIds = receiptIdsFromActivityData(data);
  const summaryMetadata = summary === undefined
    ? {}
    : Object.fromEntries(Object.entries(summary).filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0));
  const metadata: Record<string, string | number | boolean | null> = {
    ...summaryMetadata,
    ...(receiptIds.length === 1 ? { receiptId: receiptIds[0] } : {}),
    ...(receiptIds.length > 1 ? { receiptCount: receiptIds.length } : {}),
    ...(isRecord(data) && typeof data.undoReceiptId === 'string' ? { undoReceiptId: data.undoReceiptId } : {}),
  };
  return {
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(provider === undefined ? {} : { provider }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function receiptIdsFromActivityData(data: unknown): string[] {
  if (!isRecord(data)) return [];
  const ids = new Set<string>();
  if (typeof data.receiptId === 'string') ids.add(data.receiptId);
  if (isRecord(data.receipt) && typeof data.receipt.id === 'string') ids.add(data.receipt.id);
  if (Array.isArray(data.units)) {
    for (const unit of data.units) {
      if (isRecord(unit) && typeof unit.receiptId === 'string') ids.add(unit.receiptId);
    }
  }
  return [...ids];
}

function activityArtifactId(command: ApplicationCommand, data: unknown): string | undefined {
  if (typeof command.input.artifact === 'string') return command.input.artifact;
  if (!isRecord(data)) return undefined;
  if (
    (command.operation === 'library.create' || command.operation === 'library.duplicate') &&
    typeof data.id === 'string'
  ) return data.id;
  if (
    (command.operation === 'provider.source.adopt' || command.operation === 'project.promote') &&
    isRecord(data.artifact) && typeof data.artifact.id === 'string'
  ) return data.artifact.id;
  return undefined;
}

function singleProviderFromApplyInput(input: Record<string, unknown>): ProviderId | undefined {
  if (!Array.isArray(input.units)) return undefined;
  const providers = [...new Set(input.units.flatMap((unit) =>
    isRecord(unit) && isProviderId(unit.provider) ? [unit.provider] : []))];
  return providers.length === 1 ? providers[0] : undefined;
}

const writeOperations = new Set<ManagerProtocolOperation>([
  'library.create', 'library.duplicate', 'library.save', 'library.rename', 'library.archive', 'library.restore', 'library.delete', 'library.targets',
  'provider.apply', 'provider.source.adopt', 'provider.source.stop-managing', 'provider.source.start-managing', 'provider.restore',
  'history.undo', 'external.open', 'external.reveal',
]);
const adminOperations = new Set<ManagerProtocolOperation>([
  'provider.source.preview', 'provider.purge-backups.preview', 'provider.purge-backups', 'project.root.add', 'project.root.remove', 'project.root.list',
  'project.scan', 'project.discoveries', 'project.ignore',
  'project.promotion-preview', 'project.promote', 'skill.inspect', 'skill.trust', 'secret.set', 'secret.delete', 'secret.status',
  'recovery.list', 'recovery.preview', 'recovery.restore',
  'sync.configure', 'sync.disable', 'sync.status', 'sync.now', 'sync.conflict.preview', 'sync.resolve', 'remote.enable', 'remote.disable', 'remote.status',
  'session.pair', 'session.list', 'session.revoke', 'migration.preview', 'migration.apply', 'migration.status',
  'sync.preview.set', 'sync.snapshot', 'sync.bootstrap.start', 'sync.invitation.create', 'sync.pair.request', 'sync.pair.approve',
  'sync.pair.status', 'sync.pair.complete', 'sync.pair.cancel', 'sync.run', 'sync.device.rename', 'sync.device.revoke', 'sync.disconnect',
  'setup.complete',
]);
function requiredScopeFor(operation: ManagerProtocolOperation): ManagerSessionScope {
  if (adminOperations.has(operation)) return 'admin';
  if (writeOperations.has(operation)) return 'write';
  return 'read';
}

function scopeAllows(actual: ManagerSessionScope, required: ManagerSessionScope): boolean {
  const rank: Record<ManagerSessionScope, number> = { read: 0, write: 1, admin: 2 };
  return rank[actual] >= rank[required];
}

function indexesCanonicalContent(operation: ManagerProtocolOperation): boolean {
  return operation.startsWith('library.') || operation === 'history.undo' || operation === 'migration.apply' ||
    operation === 'project.promote' || operation === 'provider.source.adopt' || operation === 'setup.complete';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
