import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import {
  addLibraryArtifact,
  commitArtifactText,
  createArtifactMetadata,
  duplicateLibraryArtifact,
  loadDraft,
  listArtifactHistory,
  loadLibraryManifest,
  migrateLibraryToV2,
  permanentlyDeleteArtifact,
  readArtifactText,
  renameLibraryArtifact,
  restoreArtifactRevision,
  setArtifactLifecycle,
  setArtifactTargets,
  snapshotArtifact,
} from '../artifacts/library.js';
import type {
  ArtifactDraft,
  ArtifactKind,
  LibraryArtifactMetadata,
} from '../artifacts/types.js';
import { applyAll, type ApplyAllOptions } from '../engine/apply.js';
import {
  purgeProviderBackups,
  restoreProviderOutputs,
} from '../engine/restore.js';
import { detectProjectionDrift } from '../engine/drift.js';
import { writeFileEnsuringDir } from '../fsutil.js';
import { initMasterDir } from '../master.js';
import { loadConfig, saveConfig } from '../config.js';
import { regletHome } from '../paths.js';
import {
  recommendInstructionPromotion,
  scanProjectRoot,
  type InstructionPromotionMode,
} from '../projects/discovery.js';
import { extractMcpMachineOverrides } from '../projects/mcp-overrides.js';
import {
  compareTextLines,
  mergeSelectedTextHunks,
} from '../projects/promotion.js';
import type { ProviderId } from '../providers/types.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import {
  inspectEffectiveProviderConfiguration,
  type EffectiveProviderConfiguration,
} from '../providers/effective.js';
import {
  deriveProjectionStatus,
  type ArtifactProjectionState,
  type ProjectionIssue,
} from '../projections/state.js';
import { previewArtifactProjection } from '../projections/preview.js';
import {
  copySkillSafely,
  inspectSkill,
  mergeSkillFilesSafely,
} from '../security/skills.js';
import { systemSecretStore } from '../security/secrets.js';
import {
  LocalState,
  type ActivityRecord,
  type ProjectRootRecord,
  type RemoteSessionRecord,
  type StoredProjectDiscovery,
} from '../state/database.js';
import {
  validateInstruction,
  validateMcpServer,
  validateSkill,
} from '../validation/artifacts.js';
import type {
  ArtifactValidationResult,
  McpServerDefinition,
  ValidationIssue,
} from '../validation/types.js';
import {
  readCanonicalSyncStatus,
  resolveCanonicalSyncConflict,
  syncCanonicalLibrary,
  type CanonicalSyncStatus,
} from '../sync/client.js';

export type ApplicationScope = 'read' | 'write' | 'admin';

export type ApplicationCommand =
  | { type: 'initialize' }
  | { type: 'manager.snapshot' }
  | { type: 'library.list'; kind?: ArtifactKind; lifecycle?: 'active' | 'archived' }
  | { type: 'library.show'; artifact: string }
  | {
      type: 'library.create';
      kind: ArtifactKind;
      slug: string;
      title: string;
      content: string;
      targets?: ProviderId[];
    }
  | { type: 'library.duplicate'; artifact: string }
  | { type: 'library.rename'; artifact: string; slug: string }
  | { type: 'library.archive'; artifact: string }
  | { type: 'library.restore'; artifact: string }
  | { type: 'library.delete'; artifact: string; confirmed: boolean }
  | { type: 'library.targets'; artifact: string; targets: ProviderId[] }
  | { type: 'library.save'; artifact: string; content: string }
  | { type: 'library.inspect-skill'; artifact: string }
  | { type: 'library.trust-skill'; artifact: string; confirmed: boolean }
  | ({ type: 'providers.apply' } & ApplyAllOptions)
  | { type: 'providers.restore'; provider?: ProviderId; confirmed: boolean }
  | {
      type: 'providers.purge-backups';
      provider: ProviderId;
      confirmed: boolean;
    }
  | { type: 'providers.status' }
  | { type: 'providers.preview'; artifact: string; provider: ProviderId }
  | {
      type: 'providers.enrollment';
      provider: ProviderId;
      content?: 'rules' | 'skills' | 'mcp';
      enrolled: boolean;
    }
  | { type: 'project.root.add'; path: string; label?: string }
  | { type: 'project.root.remove'; rootId: string; confirmed: boolean }
  | { type: 'project.root.list' }
  | { type: 'project.scan'; rootId?: string; reappearChangedIgnored?: boolean }
  | { type: 'project.discoveries'; rootId?: string }
  | { type: 'project.ignore'; discoveryId: string }
  | {
      type: 'project.promotion-preview';
      discoveryId: string;
      mode?: InstructionPromotionMode;
    }
  | {
      type: 'project.promote';
      discoveryId: string;
      mode?: InstructionPromotionMode;
      targets?: ProviderId[];
      confirmExecutables?: boolean;
      destinationArtifact?: string;
      selectedHunks?: string[];
      selectedFiles?: string[];
      serverName?: string;
    }
  | { type: 'history.list'; artifact: string }
  | { type: 'history.undo'; artifact: string; revision?: string; confirmed: boolean }
  | { type: 'activity.list'; limit?: number }
  | { type: 'search'; query: string; limit?: number }
  | { type: 'secret.set'; id: string; value: string }
  | { type: 'secret.delete'; id: string }
  | { type: 'secret.status'; id: string }
  | { type: 'remote.enable'; endpoint: string }
  | { type: 'remote.disable' }
  | { type: 'remote.status' }
  | { type: 'sync.configure'; serverUrl: string }
  | { type: 'sync.disable' }
  | { type: 'sync.now' }
  | { type: 'sync.status' }
  | {
      type: 'sync.resolve';
      path: string;
      choice: 'ours' | 'theirs';
    }
  | { type: 'pair.start'; scope: ApplicationScope }
  | { type: 'session.list' }
  | { type: 'session.revoke'; sessionId: string }
  | {
      type: 'external.open';
      target:
        | { kind: 'canonical'; artifact: string }
        | {
            kind: 'provider';
            provider: ProviderId;
            artifact?: string;
            content?: 'rules' | 'skills' | 'mcp';
          }
        | { kind: 'project'; discoveryId: string };
      reveal?: boolean;
    }
  | { type: 'diagnostics' };

export interface ManagerArtifactSnapshot {
  artifact: LibraryArtifactMetadata;
  draft?: ArtifactDraft;
  projections: ArtifactProjectionState[];
}

export interface ManagerProviderSnapshot {
  id: ProviderId;
  displayName: string;
  documentationUrl: string;
  lastVerifiedAt: string;
  schemaVersion: number;
  detected: boolean;
  enrolled: {
    provider: boolean;
    instructions: boolean;
    skills: boolean;
    mcp: boolean;
  };
  effective: EffectiveProviderConfiguration;
}

export interface ManagerSnapshot {
  artifacts: ManagerArtifactSnapshot[];
  providers: ManagerProviderSnapshot[];
  projectRoots: ProjectRootRecord[];
  discoveries: StoredProjectDiscovery[];
  activity: ActivityRecord[];
  sessions: RemoteSessionRecord[];
  remote: {
    enabled: boolean;
    endpoint?: string;
    warning?: string;
  };
  sync: CanonicalSyncStatus & { serverUrl?: string };
  diagnostics: Awaited<ReturnType<typeof diagnostics>>;
}

export interface ApplicationCommandOptions {
  expectedRevision?: number;
  scope?: ApplicationScope;
}

export interface ApplicationCommandResult {
  revision: number;
  changed: boolean;
  data: unknown;
}

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly observedRevision: number;

  constructor(expectedRevision: number, observedRevision: number) {
    super(
      `Revision conflict: expected ${expectedRevision}, observed ${observedRevision}.`,
    );
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.observedRevision = observedRevision;
  }
}

export class ApplicationPermissionError extends Error {
  readonly requiredScope: ApplicationScope;

  constructor(command: ApplicationCommand['type'], requiredScope: ApplicationScope) {
    super(`${command} requires ${requiredScope} scope.`);
    this.name = 'ApplicationPermissionError';
    this.requiredScope = requiredScope;
  }
}

/**
 * Serializes every state-changing operation. The same service is used by CLI,
 * HTTP, WebSocket-triggered refreshes, and the manager client.
 */
export class RegletApplication {
  private readonly home: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(home = regletHome()) {
    this.home = home;
  }

  execute(
    command: ApplicationCommand,
    options: ApplicationCommandOptions = {},
  ): Promise<ApplicationCommandResult> {
    const requiredScope = requiredScopeFor(command);
    const scope = options.scope ?? 'admin';
    if (!scopeAllows(scope, requiredScope)) {
      return Promise.reject(new ApplicationPermissionError(command.type, requiredScope));
    }

    const result = this.queue.then(() =>
      this.executeNow(command, options, commandMutates(command), scope),
    );
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async executeNow(
    command: ApplicationCommand,
    options: ApplicationCommandOptions,
    mutating: boolean,
    scope: ApplicationScope,
  ): Promise<ApplicationCommandResult> {
    const state = await LocalState.open(this.home);
    try {
      const observedRevision = state.commandRevision();
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== observedRevision
      ) {
        throw new RevisionConflictError(options.expectedRevision, observedRevision);
      }
      const data = await executeCommand(command, this.home, state, scope);
      if (
        mutating &&
        (command.type === 'initialize' ||
          command.type.startsWith('library.') ||
          command.type === 'project.promote' ||
          command.type === 'sync.now' ||
          command.type === 'sync.resolve')
      ) {
        await indexCanonicalLibrary(this.home, state);
      }
      const revision = mutating
        ? state.advanceCommandRevision(observedRevision)
        : observedRevision;
      if (mutating) {
        state.recordActivity({
          action: command.type,
          outcome: activityOutcome(data),
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
  scope: ApplicationScope,
): Promise<unknown> {
  switch (command.type) {
    case 'initialize':
      await initMasterDir(home);
      return migrateLibraryToV2(home);
    case 'manager.snapshot':
      return managerSnapshot(home, state, scope);
    case 'library.list': {
      const library = await migrateLibraryToV2(home);
      return library.artifacts.filter(
        (artifact) =>
          (command.kind === undefined || artifact.kind === command.kind) &&
          (command.lifecycle === undefined || artifact.lifecycle === command.lifecycle),
      );
    }
    case 'library.show':
      return showArtifact(command.artifact, home);
    case 'library.create':
      return createCanonicalArtifact(command, home);
    case 'library.duplicate': {
      const artifact = await resolveArtifact(command.artifact, home);
      return duplicateLibraryArtifact(artifact.id, home);
    }
    case 'library.rename': {
      const artifact = await resolveArtifact(command.artifact, home);
      return renameLibraryArtifact(artifact.id, command.slug, home);
    }
    case 'library.archive': {
      const artifact = await resolveArtifact(command.artifact, home);
      return setArtifactLifecycle(artifact.id, 'archived', home);
    }
    case 'library.restore': {
      const artifact = await resolveArtifact(command.artifact, home);
      return setArtifactLifecycle(artifact.id, 'active', home);
    }
    case 'library.delete': {
      if (!command.confirmed) {
        throw new Error('Permanent deletion requires explicit confirmation.');
      }
      const artifact = await resolveArtifact(command.artifact, home);
      return permanentlyDeleteArtifact(artifact.id, home);
    }
    case 'library.targets': {
      const artifact = await resolveArtifact(command.artifact, home);
      return setArtifactTargets(artifact.id, command.targets, home);
    }
    case 'library.save':
      return saveArtifact(command.artifact, command.content, home);
    case 'library.inspect-skill':
      return inspectCanonicalSkill(command.artifact, home);
    case 'library.trust-skill':
      return trustCanonicalSkill(command, home, state);
    case 'providers.apply':
      return applyAll({
        providers: command.providers,
        contents: command.contents,
        dryRun: command.dryRun,
        allowOverwriteDrift: command.allowOverwriteDrift,
        home,
      });
    case 'providers.restore':
      if (!command.confirmed) {
        throw new Error('Provider restore requires explicit confirmation.');
      }
      return restoreProviderOutputs(command.provider, home);
    case 'providers.purge-backups':
      if (!command.confirmed) {
        throw new Error('Backup purge requires explicit confirmation.');
      }
      return purgeProviderBackups(command.provider, home);
    case 'providers.status':
      return detectProjectionDrift(home);
    case 'providers.preview': {
      const artifact = await resolveArtifact(command.artifact, home);
      return previewArtifactProjection(artifact, command.provider, home);
    }
    case 'providers.enrollment': {
      const config = await loadConfig(home);
      const provider = config.providers[command.provider];
      if (command.content === undefined) {
        provider.enabled = command.enrolled;
      } else {
        provider[command.content] = command.enrolled;
        if (command.enrolled) {
          provider.enabled = true;
        }
      }
      await saveConfig(config, home);
      return { provider: command.provider, ...provider };
    }
    case 'project.root.add':
      return state.addProjectRoot(command.path, command.label);
    case 'project.root.remove':
      if (!command.confirmed) {
        throw new Error('Root removal requires explicit confirmation.');
      }
      return { removed: state.removeProjectRoot(command.rootId) };
    case 'project.root.list':
      return state.listProjectRoots();
    case 'project.scan':
      return scanConfiguredRoots(command, state);
    case 'project.discoveries':
      return state.listDiscoveries(command.rootId);
    case 'project.ignore':
      return ignoreDiscovery(command.discoveryId, state);
    case 'project.promotion-preview':
      return previewProjectPromotion(command, home, state);
    case 'project.promote':
      return promoteDiscovery(command, home, state);
    case 'history.list': {
      const artifact = await resolveArtifact(command.artifact, home);
      return listArtifactHistory(artifact.id, home);
    }
    case 'history.undo': {
      if (!command.confirmed) {
        throw new Error('History restore requires explicit confirmation.');
      }
      const artifactId = await resolveArtifactIdIncludingDeleted(command.artifact, home);
      return restoreArtifactRevision(artifactId, command.revision, home);
    }
    case 'activity.list':
      return state.listActivity(command.limit);
    case 'search':
      return state.search(
        command.query,
        command.limit,
        scope === 'admin' ? undefined : 'canonical',
      );
    case 'secret.set':
      return systemSecretStore().set(command.id, command.value);
    case 'secret.delete':
      return systemSecretStore().delete(command.id);
    case 'secret.status':
      return systemSecretStore().status(command.id);
    case 'remote.enable':
      assertRemoteEndpoint(command.endpoint);
      state.setSetting('remote.enabled', 'true');
      state.setSetting('remote.endpoint', command.endpoint);
      return {
        enabled: true,
        endpoint: command.endpoint,
        warning: remoteEndpointWarning(command.endpoint),
      };
    case 'remote.disable':
      state.setSetting('remote.enabled', 'false');
      return { enabled: false };
    case 'remote.status':
      return {
        enabled: state.setting('remote.enabled') === 'true',
        endpoint: state.setting('remote.endpoint'),
        warning: remoteEndpointWarning(state.setting('remote.endpoint')),
      };
    case 'sync.configure': {
      assertSecureSyncUrl(command.serverUrl);
      const config = await loadConfig(home);
      config.sync.server_url = command.serverUrl;
      await saveConfig(config, home);
      return readCanonicalSyncStatus(true, home);
    }
    case 'sync.disable': {
      const config = await loadConfig(home);
      config.sync.server_url = '';
      await saveConfig(config, home);
      return readCanonicalSyncStatus(false, home);
    }
    case 'sync.status': {
      const config = await loadConfig(home);
      const status = await readCanonicalSyncStatus(
        config.sync.server_url.length > 0,
        home,
      );
      return {
        ...status,
        serverUrl:
          config.sync.server_url.length > 0
            ? config.sync.server_url
            : undefined,
      };
    }
    case 'sync.now': {
      const config = await loadConfig(home);
      if (config.sync.server_url.length === 0) {
        throw new Error('Canonical sync is not configured.');
      }
      return syncCanonicalLibrary({
        home,
        serverUrl: config.sync.server_url,
      });
    }
    case 'sync.resolve':
      return resolveCanonicalSyncConflict(
        command.path,
        command.choice,
        home,
      );
    case 'pair.start':
      return state.createPairingCredential(command.scope);
    case 'session.list':
      return state.listRemoteSessions();
    case 'session.revoke':
      return { revoked: state.revokeRemoteSession(command.sessionId) };
    case 'external.open':
      return openExternalTarget(command, home, state);
    case 'diagnostics':
      return diagnostics(home, state);
  }
}

async function createCanonicalArtifact(
  command: Extract<ApplicationCommand, { type: 'library.create' }>,
  home: string,
): Promise<LibraryArtifactMetadata> {
  const targets = command.targets ?? [];
  const existingArtifacts = (await loadLibraryManifest(home)).artifacts;
  if (
    existingArtifacts.some(
      (artifact) => artifact.kind === command.kind && artifact.slug === command.slug,
    )
  ) {
    throw new Error(`Artifact slug already exists: ${command.kind}:${command.slug}`);
  }
  if (command.kind === 'instruction') {
    const validation = validateInstruction({ content: command.content, targets });
    assertPortableValid(validation.issues);
    const relPath = path.join('rules', `${command.slug}.md`);
    await assertCanonicalPathAvailable(path.join(home, relPath));
    const artifact = createArtifactMetadata({
      kind: 'instruction',
      slug: command.slug,
      title: command.title,
      locator: { type: 'file', path: relPath },
    });
    artifact.targets = targets;
    await writeFileEnsuringDir(path.join(home, relPath), command.content);
    await addLibraryArtifact(artifact, home);
    return artifact;
  }

  if (command.kind === 'skill') {
    const validation = validateSkill({
      slug: command.slug,
      files: [{ relPath: 'SKILL.md', content: command.content }],
      targets,
      canonicalArtifacts: existingArtifacts,
    });
    assertPortableValid(validation.issues);
    const relPath = path.join('skills', command.slug);
    await assertCanonicalPathAvailable(path.join(home, relPath));
    const artifact = createArtifactMetadata({
      kind: 'skill',
      slug: command.slug,
      title: command.title,
      locator: { type: 'directory', path: relPath },
    });
    artifact.targets = targets;
    await writeFileEnsuringDir(path.join(home, relPath, 'SKILL.md'), command.content);
    await addLibraryArtifact(artifact, home);
    return artifact;
  }

  const parsed = parseMcpDefinition(command.content);
  const validation = validateMcpServer({
    name: command.slug,
    definition: parsed.definition,
    targets,
  });
  assertPortableValid([...parsed.issues, ...validation.issues]);
  const relPath = path.join('mcp', 'servers.json');
  const artifact = createArtifactMetadata({
    kind: 'mcp',
    slug: command.slug,
    title: command.title,
    locator: { type: 'mcp-server', path: relPath, serverName: command.slug },
  });
  artifact.targets = targets;
  await writeMcpDefinition(home, command.slug, {
    ...parsed.definition,
    ...parsed.unsupportedOptions,
  });
  await addLibraryArtifact(artifact, home);
  return artifact;
}

async function inspectCanonicalSkill(
  reference: string,
  home: string,
): Promise<Awaited<ReturnType<typeof inspectSkill>>> {
  const artifact = await resolveArtifact(reference, home);
  if (artifact.kind !== 'skill' || artifact.locator.type !== 'directory') {
    throw new Error('Trust inspection requires a canonical skill.');
  }
  return inspectSkill(
    assertPathInside(home, path.resolve(home, artifact.locator.path)),
  );
}

async function trustCanonicalSkill(
  command: Extract<ApplicationCommand, { type: 'library.trust-skill' }>,
  home: string,
  state: LocalState,
): Promise<{ trusted: true; revision: string; executableFiles: string[] }> {
  if (!command.confirmed) {
    throw new Error('Skill trust approval requires explicit confirmation.');
  }
  const artifact = await resolveArtifact(command.artifact, home);
  const inspection = await inspectCanonicalSkill(artifact.id, home);
  if (inspection.promotionBlocked) {
    throw new Error(
      inspection.risks.find((risk) => risk.severity === 'error')?.message ??
        'Skill trust inspection is blocked.',
    );
  }
  const executableFiles = inspection.files
    .filter((file) => file.executable)
    .map((file) => file.relPath);
  state.saveTrustDecision({
    artifactId: artifact.id,
    revision: inspection.revision,
    trustedAt: new Date().toISOString(),
    executableFiles,
  });
  return {
    trusted: true,
    revision: inspection.revision,
    executableFiles,
  };
}

async function assertCanonicalPathAvailable(filePath: string): Promise<void> {
  try {
    await access(filePath);
    throw new Error(`Canonical path already exists: ${path.basename(filePath)}`);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
}

async function saveArtifact(
  reference: string,
  content: string,
  home: string,
): Promise<unknown> {
  const artifact = await resolveArtifact(reference, home);
  const validation = await validateArtifactContent(artifact, content, home);
  return commitArtifactText(
    artifact.id,
    content,
    validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
    home,
  );
}

async function validateArtifactContent(
  artifact: LibraryArtifactMetadata,
  content: string,
  home: string,
): Promise<ArtifactValidationResult> {
  if (artifact.kind === 'instruction') {
    return validateInstruction({
      content,
      targets: artifact.targets,
    });
  }
  if (artifact.kind === 'skill') {
    return validateSkill({
      slug: artifact.slug,
      files: [{ relPath: 'SKILL.md', content }],
      targets: artifact.targets,
      canonicalArtifacts: (await loadLibraryManifest(home)).artifacts.filter(
        (candidate) => candidate.id !== artifact.id,
      ),
    });
  }
  let parsed: ParsedMcpDefinition;
  try {
    parsed = parseMcpDefinition(content);
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          code: 'mcp-json-invalid',
          severity: 'error',
          message: error instanceof Error ? error.message : 'Invalid MCP JSON.',
        },
      ],
      compatibility: artifact.targets.map((provider) => ({
        provider,
        supported: true,
        canProject: false,
        issues: [
          {
            code: 'mcp-json-invalid',
            severity: 'error',
            message: 'Invalid MCP JSON cannot be projected.',
          },
        ],
      })),
    };
  }
  const definition = parsed.definition;
  const references = Object.values(
    definition.transport === 'stdio'
      ? definition.secretEnv
      : definition.secretHeaders,
  );
  let secretBindings: Array<{
    reference: (typeof references)[number];
    bound: boolean;
  }>;
  try {
    const store = systemSecretStore();
    secretBindings = await Promise.all(
      references.map(async (reference) => ({
        reference,
        bound: (await store.status(reference.id)).bound,
      })),
    );
  } catch {
    secretBindings = references.map((reference) => ({
      reference,
      bound: false,
    }));
  }
  const validation = validateMcpServer({
    name: artifact.slug,
    definition,
    targets: artifact.targets,
    secretBindings,
  });
  return {
    ...validation,
    valid:
      validation.valid &&
      !parsed.issues.some((issue) => issue.severity === 'error'),
    issues: [...parsed.issues, ...validation.issues],
  };
}

async function showArtifact(reference: string, home: string): Promise<unknown> {
  const artifact = await resolveArtifact(reference, home);
  const content = await readArtifactText(artifact.id, home);
  return {
    artifact,
    content,
    history: await listArtifactHistory(artifact.id, home),
    validation: await validateArtifactContent(artifact, content, home),
  };
}

async function resolveArtifact(
  reference: string,
  home: string,
): Promise<LibraryArtifactMetadata> {
  const library = await migrateLibraryToV2(home);
  const matches = library.artifacts.filter(
    (artifact) =>
      artifact.id === reference ||
      artifact.slug === reference ||
      `${artifact.kind}:${artifact.slug}` === reference,
  );
  if (matches.length === 0) {
    throw new Error(`Unknown artifact: ${reference}`);
  }
  if (matches.length > 1) {
    throw new Error(`Artifact reference is ambiguous: ${reference}`);
  }
  const artifact = matches[0];
  if (artifact === undefined) {
    throw new Error(`Unknown artifact: ${reference}`);
  }
  return artifact;
}

async function resolveArtifactIdIncludingDeleted(
  reference: string,
  home: string,
): Promise<string> {
  const manifest = await migrateLibraryToV2(home);
  const active = manifest.artifacts.find(
    (artifact) =>
      artifact.id === reference ||
      artifact.slug === reference ||
      `${artifact.kind}:${artifact.slug}` === reference,
  );
  if (active !== undefined) {
    return active.id;
  }
  const deleted = manifest.tombstones.find(
    (tombstone) =>
      tombstone.id === reference ||
      tombstone.slug === reference ||
      `${tombstone.kind}:${tombstone.slug}` === reference,
  );
  if (deleted === undefined) {
    throw new Error(`Unknown artifact: ${reference}`);
  }
  return deleted.id;
}

async function scanConfiguredRoots(
  command: Extract<ApplicationCommand, { type: 'project.scan' }>,
  state: LocalState,
): Promise<unknown> {
  const roots =
    command.rootId === undefined
      ? state.listProjectRoots()
      : [state.getProjectRoot(command.rootId)].filter(
          (root): root is NonNullable<typeof root> => root !== undefined,
        );
  const reports: Array<{ rootId: string; count: number }> = [];
  for (const root of roots) {
    const discoveries = await scanProjectRoot(root.path, {
      ignored: state.ignoredDiscoveries(root.id),
      reappearChangedIgnored: command.reappearChangedIgnored,
    });
    state.replaceDiscoveries(root.id, discoveries);
    await indexProjectDiscoveries(root.id, root.path, discoveries, state);
    reports.push({ rootId: root.id, count: discoveries.length });
  }
  return reports;
}

async function indexCanonicalLibrary(home: string, state: LocalState): Promise<void> {
  const manifest = await loadLibraryManifest(home);
  const records = [];
  for (const artifact of manifest.artifacts) {
    let body: string;
    try {
      body = await readArtifactText(artifact.id, home);
    } catch {
      continue;
    }
    records.push({
      id: `canonical:${artifact.id}`,
      source: 'canonical' as const,
      kind: artifact.kind,
      title: artifact.title,
      pathLabel: artifact.locator.path,
      body,
    });
  }
  state.replaceSearchPrefix('canonical:', records);
}

async function indexProjectDiscoveries(
  rootId: string,
  rootPath: string,
  discoveries: Awaited<ReturnType<typeof scanProjectRoot>>,
  state: LocalState,
): Promise<void> {
  const records = [];
  for (const discovery of discoveries) {
    const sourcePath = path.join(rootPath, discovery.relativePath);
    let body = '';
    try {
      if (discovery.kind === 'skill') {
        body = await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8');
      } else if (discovery.size <= 2 * 1024 * 1024) {
        body = await readFile(sourcePath, 'utf8');
      }
    } catch {
      body = '';
    }
    records.push({
      id: `project:${rootId}:${discovery.id}`,
      source: 'project' as const,
      kind: discovery.kind,
      title: path.basename(discovery.relativePath),
      pathLabel: discovery.relativePath,
      body,
    });
  }
  state.replaceSearchPrefix(`project:${rootId}:`, records);
}

function ignoreDiscovery(discoveryId: string, state: LocalState): unknown {
  const discovery = requireDiscovery(discoveryId, state);
  state.setIgnoredDiscovery(
    discovery.rootId,
    discovery.relativePath,
    discovery.sourceHash,
  );
  state.markDiscoveryState(discovery.id, 'ignored');
  return { ignored: discovery.id };
}

async function promoteDiscovery(
  command: Extract<ApplicationCommand, { type: 'project.promote' }>,
  home: string,
  state: LocalState,
): Promise<unknown> {
  const discovery = requireDiscovery(command.discoveryId, state);
  const root = state.getProjectRoot(discovery.rootId);
  if (root === undefined) {
    throw new Error(`Project root is missing: ${discovery.rootId}`);
  }
  const sourcePath = path.join(root.path, discovery.relativePath);
  const targets = command.targets ?? [];
  const destination =
    command.destinationArtifact === undefined
      ? undefined
      : await resolveArtifact(command.destinationArtifact, home);
  let slug = await availablePromotionSlug(
    slugFromDiscovery(discovery),
    discovery.kind,
    home,
  );
  let artifact: LibraryArtifactMetadata;
  let mode: InstructionPromotionMode | 'skill' | 'mcp';
  let warnings: string[] = [];

  if (discovery.kind === 'instruction') {
    const sourceContent = await readFile(sourcePath, 'utf8');
    const reconstructed = {
      ...discovery,
      absolutePath: sourcePath,
      skillRisks: [],
    };
    const recommendation = recommendInstructionPromotion(reconstructed);
    mode = command.mode ?? recommendation.defaultMode;
    warnings = recommendation.warnings;
    const expectedKind = mode === 'convert-to-skill' ? 'skill' : 'instruction';
    if (destination === undefined && expectedKind !== discovery.kind) {
      slug = await availablePromotionSlug(
        slugFromDiscovery(discovery),
        expectedKind,
        home,
      );
    }
    if (destination !== undefined) {
      if (destination.kind !== expectedKind) {
        throw new Error(
          `${mode.replaceAll('-', ' ')} promotion requires a ${expectedKind} destination.`,
        );
      }
      const incoming = promotedInstructionContent(
        sourceContent,
        mode,
        destination.slug,
        discovery.relativePath,
      );
      const current = await readArtifactText(destination.id, home);
      const hunks = compareTextLines(current, incoming);
      assertSelectedValues(command.selectedHunks, hunks.map((hunk) => hunk.id), 'hunk');
      const merged = mergeSelectedTextHunks(
        current,
        incoming,
        command.selectedHunks,
      );
      const validation = await validateArtifactContent(destination, merged, home);
      assertPortableValid(validation.issues);
      const committed = await commitArtifactText(destination.id, merged, [], home);
      if (!committed.saved) throw new Error('Selected promotion hunks are invalid.');
      artifact =
        command.targets !== undefined || mode === 'disabled-library-draft'
          ? await setArtifactTargets(
              destination.id,
              mode === 'disabled-library-draft' ? [] : targets,
              home,
            )
          : destination;
      warnings.push(
        `Merged ${command.selectedHunks?.length ?? hunks.length} selected text ${
          (command.selectedHunks?.length ?? hunks.length) === 1 ? 'hunk' : 'hunks'
        } into ${destination.title}.`,
      );
    } else if (mode === 'convert-to-skill') {
      const skillContent = promotedInstructionContent(
        sourceContent,
        mode,
        slug,
        discovery.relativePath,
      );
      artifact = await createCanonicalArtifact(
        {
          type: 'library.create',
          kind: 'skill',
          slug,
          title: titleFromSlug(slug),
          content: skillContent,
          targets,
        },
        home,
      );
    } else {
      artifact = await createCanonicalArtifact(
        {
          type: 'library.create',
          kind: 'instruction',
          slug,
          title: titleFromSlug(slug),
          content: stripProviderFrontmatter(sourceContent),
          targets: mode === 'global-instruction' ? targets : [],
        },
        home,
      );
    }
  } else if (discovery.kind === 'skill') {
    mode = 'skill';
    const inspection = await inspectSkill(sourcePath);
    if (inspection.promotionBlocked) {
      throw new Error(
        inspection.risks.find((risk) => risk.severity === 'error')?.message ??
          'Skill promotion is blocked.',
      );
    }
    const selectedFiles =
      command.selectedFiles ??
      inspection.files
        .filter((file) => file.kind !== 'directory')
        .map((file) => file.relPath);
    assertSelectedValues(
      selectedFiles,
      inspection.files
        .filter((file) => file.kind !== 'directory')
        .map((file) => file.relPath),
      'file',
    );
    const selectedExecutables = inspection.files.filter(
      (file) => file.executable && selectedFiles.includes(file.relPath),
    );
    if (
      destination === undefined &&
      selectedFiles.length !==
        inspection.files.filter((file) => file.kind !== 'directory').length
    ) {
      throw new Error(
        'Creating a skill requires its complete reviewed file tree. Select a destination to merge individual files.',
      );
    }
    if (selectedExecutables.length > 0 && !command.confirmExecutables) {
      throw new Error('Executable skill files require explicit confirmation.');
    }
    let resultingInspection = inspection;
    if (destination !== undefined) {
      if (destination.kind !== 'skill' || destination.locator.type !== 'directory') {
        throw new Error('Skill file merge requires a canonical skill destination.');
      }
      if (selectedFiles.includes('SKILL.md')) {
        const incomingSkill = await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8');
        assertPortableValid(
          validateSkill({
            slug: destination.slug,
            files: [{ relPath: 'SKILL.md', content: incomingSkill }],
            targets: command.targets ?? destination.targets,
            canonicalArtifacts: (await loadLibraryManifest(home)).artifacts.filter(
              (candidate) => candidate.id !== destination.id,
            ),
          }).issues,
        );
      }
      await snapshotArtifact(destination, 'edit', home);
      resultingInspection = await mergeSkillFilesSafely(
        sourcePath,
        path.join(home, destination.locator.path),
        selectedFiles,
      );
      artifact =
        command.targets === undefined
          ? destination
          : await setArtifactTargets(destination.id, targets, home);
      warnings.push(
        `Merged ${selectedFiles.length} selected skill ${
          selectedFiles.length === 1 ? 'file' : 'files'
        } into ${destination.title}.`,
      );
    } else {
      const relPath = path.join('skills', slug);
      artifact = createArtifactMetadata({
        kind: 'skill',
        slug,
        title: titleFromSlug(slug),
        locator: { type: 'directory', path: relPath },
      });
      artifact.targets = targets;
      await copySkillSafely(sourcePath, path.join(home, relPath));
      await addLibraryArtifact(artifact, home);
    }
    if (selectedExecutables.length > 0) {
      state.saveTrustDecision({
        artifactId: artifact.id,
        revision: resultingInspection.revision,
        trustedAt: new Date().toISOString(),
        executableFiles: resultingInspection.files
          .filter((file) => file.executable)
          .map((file) => file.relPath),
      });
    }
    warnings = inspection.risks.map((risk) => risk.message);
  } else {
    mode = 'mcp';
    const content = await readFile(sourcePath, 'utf8');
    const imported = parseProjectMcp(content, sourcePath);
    const entry =
      command.serverName === undefined
        ? Object.entries(imported)[0]
        : Object.entries(imported).find(([name]) => name === command.serverName);
    if (entry === undefined) {
      throw new Error(
        command.serverName === undefined
          ? 'Project MCP file contains no server definitions.'
          : `Project MCP server is unavailable: ${command.serverName}`,
      );
    }
    const [serverName, importedServer] = entry;
    const { definition } = importedServer;
    const mcpSlug = await availablePromotionSlug(
      normalizeSlug(serverName),
      'mcp',
      home,
    );
    const extracted = extractMcpMachineOverrides(definition, root.path);
    if (destination !== undefined) {
      if (destination.kind !== 'mcp') {
        throw new Error('Structural MCP merge requires an MCP destination.');
      }
      const validation = await validateArtifactContent(
        destination,
        JSON.stringify(extracted.definition, null, 2),
        home,
      );
      assertPortableValid(validation.issues);
      const committed = await commitArtifactText(
        destination.id,
        JSON.stringify(extracted.definition, null, 2),
        [],
        home,
      );
      if (!committed.saved) throw new Error('MCP structural merge is invalid.');
      artifact =
        command.targets === undefined
          ? destination
          : await setArtifactTargets(destination.id, targets, home);
      warnings.push(`Replaced ${destination.title} from normalized project data.`);
    } else {
      artifact = await createCanonicalArtifact(
        {
          type: 'library.create',
          kind: 'mcp',
          slug: mcpSlug,
          title: titleFromSlug(mcpSlug),
          content: JSON.stringify(extracted.definition, null, 2),
          targets,
        },
        home,
      );
    }
    state.replaceMcpMachineOverrides(artifact.id, extracted.overrides);
    const secretReferenceCount =
      definition.transport === 'stdio'
        ? Object.keys(definition.secretEnv).length
        : Object.keys(definition.secretHeaders).length;
    warnings = [
      ...importedServer.issues.map((issue) => issue.message),
      ...(extracted.overrides.length === 0
        ? []
        : [
            `Extracted ${extracted.overrides.length} project path ${
              extracted.overrides.length === 1 ? 'override' : 'overrides'
            } for this machine.`,
          ]),
      ...(secretReferenceCount === 0
        ? []
        : [
            `Converted ${secretReferenceCount} likely credential ${
              secretReferenceCount === 1 ? 'field' : 'fields'
            } to unbound keychain references.`,
          ]),
    ];
  }

  state.saveProvenance({
    artifactId: artifact.id,
    repositoryLabel: root.label,
    localPath: discovery.relativePath,
    originalProviderFormat:
      Object.values(discovery.formatsByProvider)[0] ?? 'unknown',
    sourceHash: discovery.sourceHash,
    metadata: {
      recognizedBy: discovery.recognizedBy,
      promotionMode: mode,
      scopeFields: discovery.scope.lossyFields,
    },
  });
  state.markDiscoveryState(discovery.id, 'promoted');
  return { artifact, mode, warnings };
}

async function previewProjectPromotion(
  command: Extract<ApplicationCommand, { type: 'project.promotion-preview' }>,
  home: string,
  state: LocalState,
): Promise<unknown> {
  const discovery = requireDiscovery(command.discoveryId, state);
  const root = state.getProjectRoot(discovery.rootId);
  if (root === undefined) throw new Error(`Project root is missing: ${discovery.rootId}`);
  const sourcePath = path.join(root.path, discovery.relativePath);
  const library = await loadLibraryManifest(home);

  if (discovery.kind === 'instruction') {
    const source = await readFile(sourcePath, 'utf8');
    const recommendation = recommendInstructionPromotion({
      ...discovery,
      absolutePath: sourcePath,
    });
    const mode = command.mode ?? recommendation.defaultMode;
    const kind = mode === 'convert-to-skill' ? 'skill' : 'instruction';
    const candidates = await Promise.all(
      library.artifacts
        .filter((artifact) => artifact.kind === kind)
        .map(async (artifact) => {
          const incoming = promotedInstructionContent(
            source,
            mode,
            artifact.slug,
            discovery.relativePath,
          );
          return {
            artifact,
            hunks: compareTextLines(
              await readArtifactText(artifact.id, home),
              incoming,
            ),
          };
        }),
    );
    return {
      kind: 'instruction',
      mode,
      recommendation,
      sourceHash: discovery.sourceHash,
      candidates,
    };
  }

  if (discovery.kind === 'skill') {
    const source = await inspectSkill(sourcePath);
    const candidates = await Promise.all(
      library.artifacts
        .filter(
          (artifact) =>
            artifact.kind === 'skill' && artifact.locator.type === 'directory',
        )
        .map(async (artifact) => {
          const existing = await inspectSkill(path.join(home, artifact.locator.path));
          const existingFiles = new Map(
            existing.files.map((file) => [file.relPath, file]),
          );
          return {
            artifact,
            files: source.files.map((file) => {
              const current = existingFiles.get(file.relPath);
              return {
                ...file,
                status:
                  current === undefined
                    ? 'added'
                    : current.kind === file.kind &&
                        current.contentHash === file.contentHash
                      ? 'unchanged'
                      : 'changed',
              };
            }),
          };
        }),
    );
    return {
      kind: 'skill',
      sourceHash: discovery.sourceHash,
      inspection: source,
      candidates,
    };
  }

  const imported = parseProjectMcp(
    await readFile(sourcePath, 'utf8'),
    sourcePath,
  );
  const servers = Object.entries(imported).map(([name, importedServer]) => {
    const { definition } = importedServer;
    const extracted = extractMcpMachineOverrides(definition, root.path);
    const normalized = stableValue(extracted.definition);
    return {
      name,
      definition: normalized,
      issues: importedServer.issues,
      machineOverrideFields: extracted.overrides.map((item) => item.fieldPath),
      matchingArtifact: library.artifacts.find(
        (artifact) => artifact.kind === 'mcp' && artifact.slug === normalizeSlug(name),
      ),
    };
  });
  return {
    kind: 'mcp',
    sourceHash: discovery.sourceHash,
    servers,
    candidates: library.artifacts.filter((artifact) => artifact.kind === 'mcp'),
  };
}

function promotedInstructionContent(
  sourceContent: string,
  mode: InstructionPromotionMode,
  slug: string,
  relativePath: string,
): string {
  if (mode !== 'convert-to-skill') return stripProviderFrontmatter(sourceContent);
  return `---\nname: ${slug}\ndescription: Promoted project guidance from ${path.basename(
    relativePath,
  )}\n---\n\n${stripProviderFrontmatter(sourceContent).trimStart()}`;
}

function assertSelectedValues(
  selected: string[] | undefined,
  available: string[],
  label: string,
): void {
  if (selected === undefined) return;
  const allowed = new Set(available);
  const unavailable = selected.find((value) => !allowed.has(value));
  if (unavailable !== undefined) {
    throw new Error(`Selected promotion ${label} is unavailable: ${unavailable}`);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function requireDiscovery(
  discoveryId: string,
  state: LocalState,
): StoredProjectDiscovery {
  const discovery = state
    .listDiscoveries()
    .find((candidate) => candidate.id === discoveryId);
  if (discovery === undefined) {
    throw new Error(`Unknown discovery: ${discoveryId}`);
  }
  return discovery;
}

async function availablePromotionSlug(
  initial: string,
  kind: ArtifactKind,
  home: string,
): Promise<string> {
  const artifacts = (await migrateLibraryToV2(home)).artifacts.filter(
    (artifact) => artifact.kind === kind,
  );
  const used = new Set(artifacts.map((artifact) => artifact.slug));
  if (!used.has(initial)) {
    return initial;
  }
  let suffix = 2;
  while (used.has(`${initial}-${suffix}`)) {
    suffix += 1;
  }
  return `${initial}-${suffix}`;
}

function slugFromDiscovery(discovery: StoredProjectDiscovery): string {
  const basename = path.basename(discovery.relativePath);
  const withoutExtension = basename.replace(/\.(?:md|mdc|json|jsonc|toml)$/i, '');
  const generic = /^(?:agents|claude|gemini|skill)$/i.test(withoutExtension)
    ? path.basename(path.dirname(discovery.relativePath))
    : withoutExtension;
  return normalizeSlug(generic.length > 0 && generic !== '.' ? generic : 'project-guidance');
}

function normalizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project-artifact';
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function stripProviderFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  return end === -1 ? content : lines.slice(end + 2).join('\n');
}

interface ParsedProjectMcpServer {
  definition: McpServerDefinition;
  issues: ValidationIssue[];
}

function parseProjectMcp(
  content: string,
  sourcePath?: string,
): Record<string, ParsedProjectMcpServer> {
  const value =
    sourcePath !== undefined && path.extname(sourcePath).toLowerCase() === '.toml'
      ? (parseToml(content) as unknown)
      : (JSON.parse(stripJsonComments(content)) as unknown);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const source =
    typeof record.mcpServers === 'object' &&
    record.mcpServers !== null &&
    !Array.isArray(record.mcpServers)
      ? (record.mcpServers as Record<string, unknown>)
      : typeof record.mcp_servers === 'object' &&
          record.mcp_servers !== null &&
          !Array.isArray(record.mcp_servers)
        ? (record.mcp_servers as Record<string, unknown>)
      : typeof record.mcp === 'object' &&
          record.mcp !== null &&
          !Array.isArray(record.mcp)
        ? (record.mcp as Record<string, unknown>)
        : {};
  const result: Record<string, ParsedProjectMcpServer> = {};
  for (const [name, definition] of Object.entries(source)) {
    const normalized = normalizeMcpDefinition(definition);
    const issues = inspectUnsupportedMcpOptions(definition, normalized.transport);
    assertPortableValid(issues);
    result[name] = {
      definition: extractLikelyMcpSecrets(normalizeSlug(name), normalized),
      issues,
    };
  }
  return result;
}

function extractLikelyMcpSecrets(
  serverSlug: string,
  definition: McpServerDefinition,
): McpServerDefinition {
  if (definition.transport === 'stdio') {
    const env = { ...definition.env };
    const secretEnv = { ...definition.secretEnv };
    for (const [name] of Object.entries(env)) {
      if (!isLikelySecretField(name)) continue;
      secretEnv[name] = {
        id: `${serverSlug}-${normalizeSlug(name)}`,
        required: true,
      };
      delete env[name];
    }
    return { ...definition, env, secretEnv };
  }
  const headers = { ...definition.headers };
  const secretHeaders = { ...definition.secretHeaders };
  for (const [name] of Object.entries(headers)) {
    if (!isLikelySecretField(name)) continue;
    secretHeaders[name] = {
      id: `${serverSlug}-${normalizeSlug(name)}`,
      required: true,
    };
    delete headers[name];
  }
  return { ...definition, headers, secretHeaders };
}

function isLikelySecretField(name: string): boolean {
  return /(?:authorization|cookie|secret|token|password|credential|api[-_]?key)/i.test(
    name,
  );
}

function normalizeMcpDefinition(value: unknown): McpServerDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MCP server definition must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.transport === 'stdio' ||
    record.type === 'local' ||
    typeof record.command === 'string' ||
    Array.isArray(record.command)
  ) {
    const command =
      typeof record.command === 'string'
        ? record.command
        : Array.isArray(record.command) && typeof record.command[0] === 'string'
          ? record.command[0]
          : '';
    const commandArray = Array.isArray(record.command)
      ? record.command.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      transport: 'stdio',
      command,
      args: Array.isArray(record.args)
        ? record.args.filter((item): item is string => typeof item === 'string')
        : commandArray.slice(1),
      cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
      env: stringRecord(record.env ?? record.environment),
      secretEnv: secretReferenceRecord(record.secretEnv),
    };
  }
  const url = typeof record.url === 'string' ? record.url : '';
  return {
    transport: 'http',
    url,
    headers: stringRecord(record.headers ?? record.http_headers),
    secretHeaders: secretReferenceRecord(record.secretHeaders),
  };
}

interface ParsedMcpDefinition {
  definition: McpServerDefinition;
  issues: ValidationIssue[];
  unsupportedOptions: Record<string, unknown>;
}

function parseMcpDefinition(content: string): ParsedMcpDefinition {
  const source = JSON.parse(content) as unknown;
  const definition = normalizeMcpDefinition(source);
  const issues = [
    ...inspectUnsupportedMcpOptions(source, definition.transport),
    ...inspectLiteralMcpSecrets(definition),
  ];
  return {
    definition,
    issues,
    unsupportedOptions: unsupportedMcpOptions(source, definition.transport),
  };
}

function inspectUnsupportedMcpOptions(
  value: unknown,
  transport: McpServerDefinition['transport'],
): ValidationIssue[] {
  const unsupported = unsupportedMcpOptions(value, transport);
  return Object.keys(unsupported).map((field) => {
    const changesBehavior =
      /(?:auth|oauth|tls|cert|insecure|verify|permission|sandbox|enabled|disabled|timeout|retry)/i.test(
        field,
      );
    return {
      code: 'unsupported-field',
      severity: changesBehavior ? 'error' : 'warning',
      message: changesBehavior
        ? `Unsupported MCP option "${field}" may alter security or behavior and cannot be dropped.`
        : `Unsupported MCP option "${field}" will not be included in provider projections.`,
      field,
    };
  });
}

function unsupportedMcpOptions(
  value: unknown,
  transport: McpServerDefinition['transport'],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const supported = new Set(
    transport === 'stdio'
      ? ['transport', 'type', 'command', 'args', 'cwd', 'env', 'environment', 'secretEnv']
      : ['transport', 'type', 'url', 'headers', 'http_headers', 'secretHeaders'],
  );
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([field]) => !supported.has(field),
    ),
  );
}

function inspectLiteralMcpSecrets(
  definition: McpServerDefinition,
): ValidationIssue[] {
  const values =
    definition.transport === 'stdio' ? definition.env : definition.headers;
  return Object.keys(values)
    .filter(isLikelySecretField)
    .map((field) => ({
      code: 'mcp-secret-literal',
      severity: 'error',
      message: `Likely secret field "${field}" must use a keychain reference.`,
      field,
    }));
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function secretReferenceRecord(
  value: unknown,
): Record<string, { id: string; required?: boolean }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const references: Record<string, { id: string; required?: boolean }> = {};
  for (const [name, candidate] of Object.entries(value)) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      Array.isArray(candidate) ||
      !('id' in candidate) ||
      typeof candidate.id !== 'string'
    ) {
      continue;
    }
    references[name] = {
      id: candidate.id,
      ...('required' in candidate && typeof candidate.required === 'boolean'
        ? { required: candidate.required }
        : {}),
    };
  }
  return references;
}

async function writeMcpDefinition(
  home: string,
  name: string,
  definition: Record<string, unknown>,
): Promise<void> {
  const filePath = path.join(home, 'mcp', 'servers.json');
  let value: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      value = parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      value = {};
    } else {
      throw error;
    }
  }
  const servers =
    typeof value.mcpServers === 'object' &&
    value.mcpServers !== null &&
    !Array.isArray(value.mcpServers)
      ? { ...(value.mcpServers as Record<string, unknown>) }
      : {};
  if (name in servers) {
    throw new Error(`MCP server already exists: ${name}`);
  }
  servers[name] = definition;
  value.mcpServers = servers;
  await writeFileEnsuringDir(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function stripJsonComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function assertPortableValid(issues: ValidationIssue[]): void {
  const error = issues.find((issue) => issue.severity === 'error');
  if (error !== undefined) {
    throw new Error(error.message);
  }
}

async function openExternalTarget(
  command: Extract<ApplicationCommand, { type: 'external.open' }>,
  home: string,
  state: LocalState,
): Promise<{ opened: true; revealed: boolean }> {
  let targetPath: string;
  if (command.target.kind === 'canonical') {
    const artifact = await resolveArtifact(command.target.artifact, home);
    targetPath = assertPathInside(
      home,
      path.resolve(home, artifact.locator.path),
    );
  } else if (command.target.kind === 'project') {
    const discovery = requireDiscovery(command.target.discoveryId, state);
    const root = state.getProjectRoot(discovery.rootId);
    if (root === undefined) {
      throw new Error(`Project root is missing: ${discovery.rootId}`);
    }
    targetPath = assertPathInside(
      root.path,
      path.resolve(root.path, discovery.relativePath),
    );
  } else {
    const adapter = getAdapter(command.target.provider);
    const artifact =
      command.target.artifact === undefined
        ? undefined
        : await resolveArtifact(command.target.artifact, home);
    const content =
      artifact?.kind === 'instruction'
        ? 'rules'
        : artifact?.kind === 'skill'
          ? 'skills'
          : artifact?.kind === 'mcp'
            ? 'mcp'
            : command.target.content;
    if (content === undefined) {
      throw new Error('A provider content type is required.');
    }
    const destination =
      content === 'rules'
        ? adapter.rulesPath()
        : content === 'skills'
          ? adapter.skillsDir()
          : adapter.mcpPath();
    if (destination === null) {
      throw new Error(
        `${adapter.displayName} does not support this global artifact type.`,
      );
    }
    targetPath =
      content === 'skills' && artifact !== undefined
        ? path.join(destination, artifact.slug)
        : destination;
  }

  const reveal = command.reveal === true;
  const processHandle = Bun.spawn(externalOpenCommand(targetPath, reveal), {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) {
    throw new Error('The configured external editor could not open this file.');
  }
  return { opened: true, revealed: reveal };
}

function externalOpenCommand(targetPath: string, reveal: boolean): string[] {
  if (!reveal) {
    const editor =
      process.env.REGLET_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
    if (editor !== undefined && editor.trim().length > 0) {
      return [...editor.trim().split(/\s+/), targetPath];
    }
  }
  if (process.platform === 'darwin') {
    return reveal ? ['open', '-R', targetPath] : ['open', targetPath];
  }
  if (process.platform === 'win32') {
    return reveal
      ? ['explorer.exe', `/select,${targetPath}`]
      : ['explorer.exe', targetPath];
  }
  return ['xdg-open', reveal ? path.dirname(targetPath) : targetPath];
}

function assertPathInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('External file path escapes its managed root.');
  }
  return resolvedCandidate;
}

function requiredScopeFor(command: ApplicationCommand): ApplicationScope {
  switch (command.type) {
    case 'external.open':
    case 'library.inspect-skill':
    case 'library.trust-skill':
      return 'admin';
    case 'manager.snapshot':
    case 'providers.preview':
    case 'library.list':
    case 'library.show':
    case 'history.list':
    case 'activity.list':
    case 'search':
    case 'diagnostics':
    case 'providers.status':
      return 'read';
    case 'project.root.add':
    case 'project.root.remove':
    case 'project.root.list':
    case 'project.scan':
    case 'project.discoveries':
    case 'project.ignore':
    case 'project.promotion-preview':
    case 'project.promote':
    case 'secret.set':
    case 'secret.delete':
    case 'secret.status':
    case 'remote.enable':
    case 'remote.disable':
    case 'remote.status':
    case 'sync.configure':
    case 'sync.disable':
    case 'sync.now':
    case 'sync.status':
    case 'sync.resolve':
    case 'pair.start':
    case 'session.list':
    case 'session.revoke':
    case 'providers.restore':
    case 'providers.purge-backups':
      return 'admin';
    default:
      return 'write';
  }
}

function commandMutates(command: ApplicationCommand): boolean {
  switch (command.type) {
    case 'providers.apply':
      return command.dryRun !== true;
    case 'manager.snapshot':
    case 'library.list':
    case 'library.show':
    case 'library.inspect-skill':
    case 'providers.status':
    case 'providers.preview':
    case 'project.root.list':
    case 'project.discoveries':
    case 'project.promotion-preview':
    case 'history.list':
    case 'activity.list':
    case 'search':
    case 'secret.status':
    case 'remote.status':
    case 'sync.status':
    case 'session.list':
    case 'external.open':
    case 'diagnostics':
      return false;
    default:
      return true;
  }
}

function scopeAllows(actual: ApplicationScope, required: ApplicationScope): boolean {
  if (actual === 'admin') {
    return true;
  }
  if (actual === 'write') {
    return required === 'read' || required === 'write';
  }
  return required === 'read';
}

function activityOutcome(data: unknown): 'success' | 'warning' | 'error' {
  if (
    typeof data === 'object' &&
    data !== null &&
    'state' in data &&
    data.state === 'error'
  ) {
    return 'error';
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'state' in data &&
    (data.state === 'conflict' || data.state === 'blocked')
  ) {
    return 'warning';
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'results' in data &&
    Array.isArray(data.results) &&
    data.results.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'status' in item &&
        item.status === 'error',
    )
  ) {
    return 'warning';
  }
  return 'success';
}

async function diagnostics(home: string, state: LocalState) {
  const config = await loadConfig(home);
  const sync = await readCanonicalSyncStatus(
    config.sync.server_url.length > 0,
    home,
  );
  const providers = await Promise.all(
    allAdapters().map(async (adapter) => ({
      id: adapter.id,
      detected: await adapter.detect(),
      enrolled: config.providers[adapter.id].enabled,
      adapterIssueCount: adapter.discoveries.filter(
        (discovery) => !discovery.supported || discovery.issue !== undefined,
      ).length,
    })),
  );
  const watcherHeartbeat = state.setting('watcher.heartbeat-at');
  const watcherHeartbeatAt =
    watcherHeartbeat === undefined ? Number.NaN : Date.parse(watcherHeartbeat);
  const watcherIsLive =
    Number.isFinite(watcherHeartbeatAt) &&
    Date.now() - watcherHeartbeatAt < 30_000;
  const watcherMode = watcherIsLive
    ? state.setting('watcher.mode') ?? 'filesystem-events'
    : 'explicit-scan';
  const watcherReady =
    watcherIsLive && state.setting('watcher.ready') === 'true';
  return {
    ready: true,
    runtime: {
      version: '0.1.0',
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
    database: {
      ready: true,
      migrationVersion: state.migrationVersion(),
    },
    canonicalDirectory: {
      ready: true,
      pathRedacted: home.length > 0,
    },
    projectRoots: {
      count: state.listProjectRoots().length,
      pathsIncluded: false,
    },
    activity: {
      countSampled: state.listActivity(1_000).length,
      contentIncluded: false,
    },
    watcher: {
      mode: watcherMode,
      ready: watcherMode === 'explicit-scan' ? true : watcherReady,
      detail:
        watcherMode === 'explicit-scan'
          ? 'Project roots are rescanned on demand; no background watcher is active.'
          : state.setting('watcher.detail') ??
            'Filesystem events are debounced and coalesced by repository.',
    },
    providers: {
      detected: providers.filter((provider) => provider.detected).length,
      enrolled: providers.filter((provider) => provider.enrolled).length,
      adapters: providers,
    },
    sync: {
      configured: sync.configured,
      state: sync.state,
      conflictCount: sync.conflicts.length,
      blockedFileCount: sync.blockedFiles.length,
      lastSyncedAt: sync.lastSyncedAt,
      endpointIncluded: false,
    },
    secretsIncluded: false,
    authorizationIncluded: false,
  };
}

async function managerSnapshot(
  home: string,
  state: LocalState,
  scope: ApplicationScope,
): Promise<ManagerSnapshot> {
  const [library, config, preview, providerSnapshots] = await Promise.all([
    migrateLibraryToV2(home),
    loadConfig(home),
    applyAll({ dryRun: true, home }),
    Promise.all(
      allAdapters().map(async (adapter): Promise<ManagerProviderSnapshot> => {
        const providerConfig = (await loadConfig(home)).providers[adapter.id];
        return {
          id: adapter.id,
          displayName: adapter.displayName,
          documentationUrl: adapter.documentationUrl,
          lastVerifiedAt: adapter.lastVerifiedAt,
          schemaVersion: adapter.schemaVersion,
          detected: await adapter.detect(),
          enrolled: {
            provider: providerConfig.enabled,
            instructions: providerConfig.rules,
            skills: providerConfig.skills,
            mcp: providerConfig.mcp,
          },
          effective: await inspectEffectiveProviderConfiguration(adapter.id, home),
        };
      }),
    ),
  ]);
  const artifacts = await Promise.all(
    library.artifacts.map(async (artifact): Promise<ManagerArtifactSnapshot> => ({
      artifact,
      draft: await loadDraft(artifact.id, home),
      projections: providerSnapshots.map((provider) =>
        projectionForArtifact(artifact, provider, preview.results),
      ),
    })),
  );
  const remoteEndpoint = state.setting('remote.endpoint');
  const syncStatus = await readCanonicalSyncStatus(
    config.sync.server_url.length > 0,
    home,
  );
  const admin = scope === 'admin';
  return {
    artifacts,
    providers: admin
      ? providerSnapshots
      : providerSnapshots.map((provider) => ({
          ...provider,
          effective: {
            ...provider.effective,
            knownProjectFiles: [],
          },
        })),
    projectRoots: admin ? state.listProjectRoots() : [],
    discoveries: admin ? state.listDiscoveries() : [],
    activity: state.listActivity(100),
    sessions: admin ? state.listRemoteSessions() : [],
    remote: {
      enabled: state.setting('remote.enabled') === 'true',
      endpoint: admin ? remoteEndpoint : undefined,
      warning: admin ? remoteEndpointWarning(remoteEndpoint) : undefined,
    },
    sync: {
      ...syncStatus,
      serverUrl:
        admin && config.sync.server_url.length > 0
          ? config.sync.server_url
          : undefined,
    },
    diagnostics: await diagnostics(home, state),
  };
}

function assertSecureSyncUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLoopbackHost(url.hostname))
  ) {
    return;
  }
  throw new Error(
    'Sync requires HTTPS unless the server is on the loopback interface.',
  );
}

function assertRemoteEndpoint(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' &&
    url.protocol !== 'http:'
  ) {
    throw new Error('Remote endpoint must use HTTP or HTTPS.');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('Remote endpoint must not contain embedded credentials.');
  }
}

function projectionForArtifact(
  artifact: LibraryArtifactMetadata,
  provider: ManagerProviderSnapshot,
  results: Awaited<ReturnType<typeof applyAll>>['results'],
): ArtifactProjectionState {
  const content =
    artifact.kind === 'instruction'
      ? 'rules'
      : artifact.kind === 'skill'
        ? 'skills'
        : 'mcp';
  const destinationPath = destinationForArtifact(artifact, provider);
  const supported = destinationPath !== undefined;
  const result = results.find(
    (candidate) =>
      candidate.provider === provider.id &&
      candidate.content === content &&
      (artifact.kind !== 'skill' ||
        candidate.outputPath === destinationPath),
  );
  const targeted = artifact.targets.includes(provider.id);
  const issues = [
    ...provider.effective.issues,
    ...(result?.issues ?? []).map(normalizeApplyIssue),
  ];
  const operationError = result?.status === 'error';
  const blocked = result?.status === 'blocked' || issues.some(
    (issue) => issue.severity === 'error',
  );
  return {
    provider: provider.id,
    status: deriveProjectionStatus({
      targeted,
      supported,
      outputExists: result?.observedHash !== undefined,
      desiredHash: result?.desiredHash,
      appliedHash: result?.appliedHash,
      observedHash: result?.observedHash,
      blocked,
      operationError,
    }),
    desiredHash: result?.desiredHash,
    appliedHash: result?.appliedHash,
    observedHash: result?.observedHash,
    issues,
    destinationPath,
    appliedAt: result?.appliedAt,
  };
}

function destinationForArtifact(
  artifact: LibraryArtifactMetadata,
  provider: ManagerProviderSnapshot,
): string | undefined {
  if (artifact.kind === 'instruction') {
    return provider.effective.managedProjection.rulesPath ?? undefined;
  }
  if (artifact.kind === 'skill') {
    const directory = provider.effective.managedProjection.skillsDir;
    return directory === null ? undefined : path.join(directory, artifact.slug);
  }
  return provider.effective.managedProjection.mcpPath ?? undefined;
}

function normalizeApplyIssue(
  issue: NonNullable<
    Awaited<ReturnType<typeof applyAll>>['results'][number]['issues']
  >[number],
): ProjectionIssue {
  const code =
    issue.code === 'missing-secret'
      ? 'missing-secret'
      : issue.code === 'skill-trust-required'
        ? 'invalid-source'
      : issue.code === 'external-drift'
        ? 'invalid-source'
        : issue.code.includes('permission')
          ? 'permission-denied'
          : 'unsupported-field';
  return {
    code,
    severity: issue.severity,
    message: issue.message,
  };
}

function remoteEndpointWarning(endpoint: string | undefined): string | undefined {
  if (endpoint === undefined || endpoint.length === 0) {
    return undefined;
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      return 'Raw LAN HTTP exposes session traffic. Prefer a tailnet or custom HTTPS endpoint.';
    }
  } catch {
    return 'Remote endpoint is not a valid absolute URL.';
  }
  return undefined;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
