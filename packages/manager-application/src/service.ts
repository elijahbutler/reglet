import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  deriveProjectionStatus,
  disconnectSyncV2,
  duplicateLibraryArtifact,
  getAdapter,
  hasValidSkillFrontmatter,
  inspectSkill,
  isTrustDecisionCurrent,
  libraryMigrationStatus,
  loadDraft,
  loadLibraryManifest,
  loadMasterDir,
  loadSyncV2State,
  loadConfig,
  LocalState,
  pendingSyncV2ConnectionStatus,
  permanentlyDeleteArtifact,
  mergeSelectedTextHunks,
  mergeSkillFilesSafely,
  parseProjectMcpServers,
  previewLibraryMigration,
  previewProjectionBatch,
  purgeProviderBackups,
  providerMcpScope,
  readArtifactText,
  recommendInstructionPromotion,
  regletHome,
  renameLibraryArtifact,
  restoreArtifactRevision,
  restore,
  resolveSyncV2Conflict,
  rollbackLibraryMigration,
  requestSyncV2Pairing,
  revokeManagedSyncV2Device,
  renameManagedSyncV2Device,
  scanProjectRoot,
  saveConfig,
  secretReferenceStatus,
  setArtifactLifecycle,
  setArtifactTargets,
  snapshotArtifact,
  sharedMcpScope,
  systemSecretStore,
  startSyncV2BootstrapConnection,
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
  type McpServerDef,
  type ProjectionBatchPreview,
  type ProjectionUnitPreview,
  type ProviderId,
  type SecretRef,
  type SecretStore,
} from '@reglet/core';
import {
  type ManagerArtifactV3,
  type ManagerArtifactProjectionV3,
  type ManagerMigrationStateV3,
  type ManagerProjectInboxV3,
  type ManagerProtocolOperation,
  type ManagerRpcInputs,
  type ManagerSessionScope,
  type ManagerSnapshotV3,
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
    const mutating = mutatingOperations.has(command.operation);
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
        state.recordActivity({ action: command.operation, outcome: activityOutcome(data) });
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
      const trustIssues = await skillTrustUnitIssues(home, state, [command.input.provider]);
      const batch = await previewProjectionBatch({
        providers: [command.input.provider],
        contents: [contentForKind(artifact.kind)],
        home,
        unitIssues: trustIssues,
      });
      return {
        artifact,
        provider: command.input.provider,
        batchDigest: batch.digest,
        unitDigests: Object.fromEntries(batch.units.map((unit) => [unit.key, unit.digest])),
        batch,
        entry: entryForArtifact(batch.units[0], artifact),
      };
    }
    case 'provider.apply': {
      const artifacts = await Promise.all((command.input.artifacts ?? []).map((reference) => resolveArtifact(reference, home)));
      const contents = artifacts.length === 0
        ? undefined
        : [...new Set(artifacts.map((artifact) => contentForKind(artifact.kind)))];
      const trustIssues = await skillTrustUnitIssues(home, state, command.input.providers);
      const result = await applyProjectionBatch({
        home,
        providers: command.input.providers,
        contents,
        batchDigest: command.input.batchDigest,
        unitDigests: command.input.unitDigests,
        confirmDrift: command.input.confirmDrift,
        unitIssues: trustIssues,
      });
      await recordAppliedProjections(result.preview, result.units, home, state);
      return result;
    }
    case 'provider.restore':
      if (!command.input.confirmed) throw new Error('Provider restore requires explicit confirmation.');
      return restore(command.input.provider, home);
    case 'provider.purge-backups':
      if (!command.input.confirmed) throw new Error('Backup purge requires explicit confirmation.');
      return purgeProviderBackups(command.input.provider, home);
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
      return inspectCanonicalSkill(command.input.artifact, home);
    case 'skill.trust': {
      if (!command.input.confirmed) throw new Error('Skill trust requires explicit confirmation.');
      const artifact = await resolveArtifact(command.input.artifact, home);
      const inspection = await inspectCanonicalSkill(artifact.id, home);
      if (inspection.promotionBlocked) throw new Error('Blocked skill cannot be trusted.');
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
      state.setSetting('sync.enabled', 'true');
      state.setSetting('sync.serverUrl', command.input.serverUrl);
      return encryptedSyncStatus(home);
    case 'sync.now':
      return syncOnceV2({ home });
    case 'sync.resolve':
      return resolveSyncV2Conflict(command.input.path, command.input.choice, home);
    case 'diagnostics':
      return diagnostics(home, state);
    case 'external.open':
    case 'external.reveal':
      return { delegated: true, target: command.input.target };
    case 'migration.preview':
      return previewLibraryMigration(home);
    case 'migration.apply': {
      const receipt = await applyLibraryMigration({ ...command.input, home });
      try {
        await indexCanonicalLibrary(home, state);
        return receipt;
      } catch (error) {
        await rollbackLibraryMigration(receipt, home);
        await indexCanonicalLibrary(home, state);
        throw error;
      }
    }
    case 'migration.status':
      return libraryMigrationStatus(home);
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
  const [manifest, migration, providers, batch, bindings] = await Promise.all([
    loadLibraryManifest(home),
    migrationSnapshot(home),
    providerList(),
    previewProjectionBatch({ home }),
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
  const diagnosticState = await diagnostics(home, state);
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
    providers: providers.map((provider) => ({
      ...provider,
      projections: artifacts.flatMap((artifact) => artifact.projections.filter((projection) => projection.provider === provider.id)),
    })),
    ...(projectInbox === undefined ? {} : { projectInbox }),
    activity,
    settings: {
      sync: await encryptedSyncStatus(home),
      remote: remoteStatus(state),
      secretBindings: bindings,
      ...(sessions === undefined ? {} : { sessions }),
    },
    diagnostics: diagnosticState,
  };
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

async function providerList() {
  return Promise.all(allAdapters().map(async (adapter) => ({
    id: adapter.id,
    displayName: adapter.displayName,
    detected: await adapter.detect(),
    documentationUrl: adapter.documentationUrl,
    lastVerifiedAt: adapter.lastVerifiedAt,
    schemaVersion: adapter.schemaVersion,
    capabilities: {
      instructions: capability(adapter.rulesPath() !== null, adapter, 'instruction'),
      skills: capability(adapter.skillsDir() !== null, adapter, 'skill'),
      mcp: capability(adapter.mcpPath() !== null, adapter, 'mcp'),
    },
  })));
}

function capability(supported: boolean, adapter: ReturnType<typeof getAdapter>, kind: ArtifactKind) {
  const issue = adapter.discoveries.find((declaration) => declaration.kind === kind && !declaration.supported)?.issue;
  return { supported, ...(issue === undefined ? {} : { issue }) };
}

function projectionForArtifact(
  artifact: LibraryArtifactMetadata,
  provider: ProviderId,
  batch: ProjectionBatchPreview,
  record: ReturnType<LocalState['listProjectionRecords']>[number] | undefined,
): ManagerArtifactProjectionV3 {
  const unit = batch.units.find((candidate) => candidate.provider === provider && candidate.content === contentForKind(artifact.kind));
  const entry = entryForArtifact(unit, artifact);
  const desiredHash = entry?.resultingTargetHash ?? undefined;
  const observedHash = entry?.expectedTargetHash ?? undefined;
  const destinationPath = entry?.path.length ? entry.path : destinationForArtifact(artifact, provider);
  const supported = destinationPath !== undefined;
  const targeted = artifact.lifecycle === 'active' && artifact.targets.includes(provider);
  const issues = [
    ...(unit?.validationIssues ?? []).map((message) => ({ code: 'blocked-projection', severity: 'error' as const, message })),
    ...(supported ? [] : [{ code: 'unsupported', severity: 'warning' as const, message: `${provider} does not support this artifact kind.` }]),
  ];
  return {
    artifactId: artifact.id,
    provider,
    status: deriveProjectionStatus({
      targeted,
      supported,
      outputExists: observedHash !== undefined,
      desiredHash,
      appliedHash: record?.appliedHash,
      observedHash,
      blocked: issues.some((issue) => issue.severity === 'error'),
    }),
    destinationPath: destinationPath ?? null,
    ...(desiredHash === undefined ? {} : { desiredHash }),
    ...(record?.appliedHash === undefined ? {} : { appliedHash: record.appliedHash }),
    ...(observedHash === undefined ? {} : { observedHash }),
    ...(record?.appliedRevision === undefined ? {} : { appliedRevision: record.appliedRevision }),
    ...(record?.appliedAt === undefined ? {} : { appliedAt: record.appliedAt }),
    issues,
  };
}

function entryForArtifact(unit: ProjectionUnitPreview | undefined, artifact: LibraryArtifactMetadata) {
  if (unit === undefined) return undefined;
  const nonSkipped = unit.entries.filter((entry) => entry.operation !== 'skip');
  if (artifact.kind !== 'skill') return nonSkipped[0];
  return nonSkipped.find((entry) => path.basename(entry.path) === artifact.slug);
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
    if (executableFiles.length > 0 && input.confirmExecutables !== true) {
      throw new Error('Executable skill files require explicit confirmation.');
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

async function skillTrustUnitIssues(
  home: string,
  state: LocalState,
  providers: ProviderId[] | undefined,
): Promise<Record<string, string[]>> {
  const selectedProviders = providers ?? allAdapters().map((adapter) => adapter.id);
  const manifest = await loadLibraryManifest(home);
  const issues: Record<string, string[]> = {};
  for (const artifact of manifest.artifacts.filter((candidate) =>
    candidate.kind === 'skill' && candidate.lifecycle === 'active' && candidate.locator.type === 'directory')) {
    const inspection = await inspectSkill(path.join(home, ...artifact.locator.path.split('/')));
    if (!inspection.requiresExecutableConfirmation) continue;
    const decision = state.trustDecision(artifact.id);
    if (decision !== undefined && isTrustDecisionCurrent(decision, inspection)) continue;
    for (const provider of selectedProviders.filter((candidate) => artifact.targets.includes(candidate))) {
      const key = `${provider}:skills`;
      const current = issues[key] ?? [];
      current.push(`Executable skill ${artifact.slug} changed or has not been trusted at revision ${inspection.revision.slice(0, 12)}.`);
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
      const id = reference.source === 'keychain' ? `keychain:${reference.id}` : `process-env:${reference.name}`;
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

async function diagnostics(home: string, _state: LocalState) {
  const migration = await libraryMigrationStatus(home);
  const issues = migration.state === 'available'
    ? [{ code: 'migration-required', severity: 'warning' as const, message: `${migration.artifactCount} legacy artifacts are ready for reviewed migration.` }]
    : [];
  return { healthy: true, issues };
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
  if (state?.phase !== 'active') return { enabled: false, state: 'disabled', conflictCount: 0 };
  const conflictCount = Object.values(state.files).filter((file) => file.conflicted === true).length;
  return {
    enabled: true,
    state: conflictCount > 0 ? 'conflict' : 'idle',
    conflictCount,
    ...(state.lastSync === undefined ? {} : { lastCompletedAt: state.lastSync.completedAt }),
  };
}

async function encryptedSyncCompatibilitySnapshot(home: string): Promise<unknown> {
  const state = await loadSyncV2State(home);
  if (state === null) return { version: 1, phase: 'disconnected', serverUrl: null, devices: [], lastSync: null };
  if (state.phase === 'pending') {
    return {
      version: 1,
      phase: 'pending',
      serverUrl: state.serverUrl,
      pending: await pendingSyncV2ConnectionStatus({ home }),
      devices: [],
      lastSync: null,
    };
  }
  return {
    version: 1,
    phase: 'active',
    serverUrl: state.serverUrl,
    currentDeviceId: state.deviceId,
    currentDeviceName: state.deviceName,
    devices: await listManagedSyncV2Devices({ home }),
    lastSync: state.lastSync ?? null,
    keyRotationRequired: state.keyRotationRequired === true,
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

const writeOperations = new Set<ManagerProtocolOperation>([
  'library.create', 'library.duplicate', 'library.save', 'library.rename', 'library.archive', 'library.restore', 'library.delete', 'library.targets',
  'provider.apply', 'provider.restore', 'history.undo', 'external.open', 'external.reveal',
]);
const adminOperations = new Set<ManagerProtocolOperation>([
  'provider.purge-backups', 'project.root.add', 'project.root.remove', 'project.root.list', 'project.scan', 'project.discoveries', 'project.ignore',
  'project.promotion-preview', 'project.promote', 'skill.trust', 'secret.set', 'secret.delete', 'secret.status',
  'sync.configure', 'sync.disable', 'sync.status', 'sync.now', 'sync.resolve', 'remote.enable', 'remote.disable', 'remote.status',
  'session.pair', 'session.list', 'session.revoke', 'migration.preview', 'migration.apply', 'migration.status',
  'sync.preview.set', 'sync.snapshot', 'sync.bootstrap.start', 'sync.invitation.create', 'sync.pair.request', 'sync.pair.approve',
  'sync.pair.status', 'sync.pair.complete', 'sync.pair.cancel', 'sync.run', 'sync.device.rename', 'sync.device.revoke', 'sync.disconnect',
]);
const mutatingOperations = new Set<ManagerProtocolOperation>([
  'library.create', 'library.duplicate', 'library.save', 'library.rename', 'library.archive', 'library.restore', 'library.delete', 'library.targets',
  'provider.apply', 'provider.restore', 'provider.purge-backups', 'project.root.add', 'project.root.remove', 'project.scan', 'project.ignore', 'project.promote',
  'skill.trust', 'secret.set', 'secret.delete', 'history.undo', 'sync.configure', 'sync.disable', 'sync.now', 'sync.resolve',
  'remote.enable', 'remote.disable', 'session.pair', 'session.revoke', 'migration.apply',
  'sync.preview.set', 'sync.bootstrap.start', 'sync.invitation.create', 'sync.pair.request', 'sync.pair.approve', 'sync.pair.complete',
  'sync.pair.cancel', 'sync.run', 'sync.device.rename', 'sync.device.revoke', 'sync.disconnect',
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
  return operation.startsWith('library.') || operation === 'history.undo' || operation === 'migration.apply' || operation === 'project.promote';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
