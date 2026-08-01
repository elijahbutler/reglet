import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { configPath, loadConfig, providerNames } from '../config.js';
import { regletHome } from '../paths.js';
import { isNodeError, isRecord } from '../providers/common.js';
import type {
  ArtifactDraft,
  ArtifactHistoryIndex,
  ArtifactHistoryRevision,
  ArtifactId,
  ArtifactKind,
  ArtifactLocator,
  DeletedArtifactTombstone,
  DraftValidationIssue,
  LibraryArtifactMetadata,
  LibraryManifest,
  LibraryMigrationPreview,
  LibraryMigrationReceipt,
  LibraryMigrationStatus,
} from './types.js';
import { artifactSlugPattern } from './types.js';

export const LIBRARY_SCHEMA_VERSION = 2;

export function libraryManifestPath(home = regletHome()): string {
  return path.join(home, 'library.json');
}

export async function hasLibraryManifest(home = regletHome()): Promise<boolean> {
  return fileExists(libraryManifestPath(home));
}

export function defaultLibraryManifest(): LibraryManifest {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    artifacts: [],
    tombstones: [],
  };
}

export async function loadLibraryManifest(home = regletHome()): Promise<LibraryManifest> {
  try {
    return parseLibraryManifest(
      JSON.parse(await readFile(libraryManifestPath(home), 'utf8')) as unknown,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultLibraryManifest();
    }
    throw error;
  }
}

export async function saveLibraryManifest(
  manifest: LibraryManifest,
  home = regletHome(),
): Promise<void> {
  assertUniqueArtifacts(manifest.artifacts);
  const targetPath = libraryManifestPath(home);
  await writeJsonAtomic(targetPath, manifest);
}

export async function previewLibraryMigration(home = regletHome()): Promise<LibraryMigrationPreview> {
  const manifestPath = libraryManifestPath(home);
  if (await fileExists(manifestPath)) {
    const manifest = await loadLibraryManifest(home);
    const artifacts = await Promise.all(manifest.artifacts.map(async (artifact) => ({
      artifact,
      sourceExists: await artifactSourceExists(artifact.locator, home),
    })));
    return {
      version: 1,
      migration: 'library-v2',
      required: false,
      digest: migrationDigest(manifest.artifacts),
      manifestPath,
      artifacts,
    };
  }

  const artifacts = await discoverLegacyArtifacts(home);
  return {
    version: 1,
    migration: 'library-v2',
    required: artifacts.length > 0,
    digest: migrationDigest(artifacts),
    manifestPath,
    artifacts: await Promise.all(artifacts.map(async (artifact) => ({
      artifact,
      sourceExists: await artifactSourceExists(artifact.locator, home),
    }))),
  };
}

export async function applyLibraryMigration(
  options: { previewDigest: string; yes: boolean; home?: string },
): Promise<LibraryMigrationReceipt> {
  if (!options.yes) {
    throw new Error('Library migration requires explicit approval. Pass --yes after reviewing the preview.');
  }
  const home = options.home ?? regletHome();
  const existingReceipt = await readLatestMigrationReceipt(home);
  if (await fileExists(libraryManifestPath(home))) {
    if (existingReceipt !== undefined) return existingReceipt;
    throw new Error('library.json already exists and was not created by a recorded library-v2 migration.');
  }
  const preview = await previewLibraryMigration(home);
  if (preview.digest !== options.previewDigest) {
    throw new Error('Migration preview is stale. Preview the library again before applying.');
  }

  const migrationId = `library-v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${preview.digest.slice(0, 12)}`;
  const receiptDir = path.join(home, '.state', 'migrations', 'library-v2', migrationId);
  const metadataSource = configPath(home);
  const metadataBackupPath = await fileExists(metadataSource)
    ? path.join(receiptDir, 'reglet.toml.before')
    : null;
  await mkdir(receiptDir, { recursive: true });
  if (metadataBackupPath !== null) {
    await cp(metadataSource, metadataBackupPath, { errorOnExist: true, force: false });
  }

  const manifest: LibraryManifest = {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    artifacts: preview.artifacts.map((item) => item.artifact),
    tombstones: [],
  };
  const receipt: LibraryMigrationReceipt = {
    version: 1,
    id: migrationId,
    migration: 'library-v2',
    digest: preview.digest,
    appliedAt: new Date().toISOString(),
    manifestPath: preview.manifestPath,
    manifestBackupPath: null,
    metadataBackupPath,
    createdManifest: true,
    artifactCount: manifest.artifacts.length,
    reversible: true,
  };

  try {
    await saveLibraryManifest(manifest, home);
    await writeJsonAtomic(path.join(receiptDir, 'receipt.json'), receipt);
    await writeJsonAtomic(latestMigrationReceiptPath(home), receipt);
    return receipt;
  } catch (error) {
    await rm(preview.manifestPath, { force: true });
    throw error;
  }
}

export async function libraryMigrationStatus(home = regletHome()): Promise<LibraryMigrationStatus> {
  if (await fileExists(libraryManifestPath(home))) {
    const manifest = await loadLibraryManifest(home);
    const receipt = await readLatestMigrationReceipt(home);
    return {
      state: 'applied',
      artifactCount: manifest.artifacts.length,
      ...(receipt === undefined ? {} : { receipt }),
    };
  }
  const preview = await previewLibraryMigration(home);
  return {
    state: preview.required ? 'available' : 'not-needed',
    artifactCount: preview.artifacts.length,
  };
}

export async function rollbackLibraryMigration(
  receipt: LibraryMigrationReceipt,
  home = regletHome(),
): Promise<void> {
  const manifestPath = libraryManifestPath(home);
  if (path.resolve(receipt.manifestPath) !== path.resolve(manifestPath) || !/^library-v2-[A-Za-z0-9-]+$/.test(receipt.id)) {
    throw new Error('Migration receipt does not target the canonical library manifest.');
  }
  if (receipt.createdManifest) {
    await rm(manifestPath, { force: true });
  } else if (receipt.manifestBackupPath !== null) {
    await cp(receipt.manifestBackupPath, manifestPath, { force: true });
  }
  if (receipt.metadataBackupPath !== null) {
    await cp(receipt.metadataBackupPath, configPath(home), { force: true });
  }
  await rm(latestMigrationReceiptPath(home), { force: true });
  await writeJsonAtomic(
    path.join(home, '.state', 'migrations', 'library-v2', receipt.id, 'rollback.json'),
    { version: 1, migration: 'library-v2', receiptId: receipt.id, rolledBackAt: new Date().toISOString() },
  );
}

async function discoverLegacyArtifacts(home: string): Promise<LibraryArtifactMetadata[]> {
  const config = await loadConfig(home);
  const targetsByKind: Record<ArtifactKind, LibraryArtifactMetadata['targets']> = {
    instruction: Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled && provider.rules)
      .map(([provider]) => provider as LibraryArtifactMetadata['targets'][number]),
    skill: Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled && provider.skills)
      .map(([provider]) => provider as LibraryArtifactMetadata['targets'][number]),
    mcp: Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled && provider.mcp)
      .map(([provider]) => provider as LibraryArtifactMetadata['targets'][number]),
  };
  const artifacts = [
    ...(await discoverLegacyInstructions(home, targetsByKind.instruction)),
    ...(await discoverLegacySkills(home, targetsByKind.skill, config.contentSync.skills)),
    ...(await discoverLegacyMcpServers(home, targetsByKind.mcp, config.contentSync.mcp)),
  ];
  sortArtifacts(artifacts);
  assertUniqueArtifacts(artifacts);
  return artifacts;
}

export async function getLibraryArtifact(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<LibraryArtifactMetadata | undefined> {
  return (await loadLibraryManifest(home)).artifacts.find(
    (artifact) => artifact.id === artifactId,
  );
}

export async function addLibraryArtifact(
  artifact: LibraryArtifactMetadata,
  home = regletHome(),
): Promise<void> {
  validateMetadata(artifact);
  const manifest = await loadLibraryManifest(home);
  if (manifest.artifacts.some((candidate) => candidate.id === artifact.id)) {
    throw new Error(`Artifact ID already exists: ${artifact.id}`);
  }
  if (
    manifest.artifacts.some(
      (candidate) => artifactIdentityKey(candidate) === artifactIdentityKey(artifact),
    )
  ) {
    throw new Error(`Artifact slug already exists: ${artifact.kind}:${artifact.slug}`);
  }
  manifest.artifacts.push(artifact);
  sortArtifacts(manifest.artifacts);
  await saveLibraryManifest(manifest, home);
}

export function createArtifactMetadata(input: {
  kind: ArtifactKind;
  slug: string;
  title: string;
  locator: ArtifactLocator;
  description?: string;
  tags?: string[];
  scope?: LibraryArtifactMetadata['scope'];
  targets?: LibraryArtifactMetadata['targets'];
}): LibraryArtifactMetadata {
  const scope = input.scope ?? { kind: 'global' };
  const metadata: LibraryArtifactMetadata = {
    id: randomUUID(),
    kind: input.kind,
    lifecycle: 'active',
    scope,
    slug: input.slug,
    title: input.title,
    description: input.description,
    tags: [...(input.tags ?? [])],
    targets: scope.kind === 'provider-overlay'
      ? [scope.provider]
      : [...(input.targets ?? [])],
    locator: input.locator,
  };
  validateMetadata(metadata);
  return metadata;
}

export async function duplicateLibraryArtifact(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<LibraryArtifactMetadata> {
  const manifest = await loadLibraryManifest(home);
  const source = requireArtifact(manifest, artifactId);
  const slug = nextAvailableSlug(
    `${source.slug}-copy`,
    manifest.artifacts.filter(
      (artifact) => artifact.kind === source.kind && sameArtifactScope(artifact.scope, source.scope),
    ),
  );
  const locator = locatorForDuplicate(source.locator, slug);
  await copyArtifactContent(source.locator, locator, home);

  const duplicate: LibraryArtifactMetadata = {
    ...source,
    id: randomUUID(),
    lifecycle: 'active',
    slug,
    title: `${source.title} copy`,
    targets: source.scope.kind === 'provider-overlay' ? [source.scope.provider] : [],
    tags: [...source.tags],
    locator,
  };
  manifest.artifacts.push(duplicate);
  sortArtifacts(manifest.artifacts);
  await saveLibraryManifest(manifest, home);
  return duplicate;
}

export async function renameLibraryArtifact(
  artifactId: ArtifactId,
  newSlug: string,
  home = regletHome(),
): Promise<LibraryArtifactMetadata> {
  if (!artifactSlugPattern.test(newSlug)) {
    throw new Error(`Invalid artifact slug: ${newSlug}`);
  }

  const manifest = await loadLibraryManifest(home);
  const artifact = requireArtifact(manifest, artifactId);
  if (
    manifest.artifacts.some(
      (candidate) =>
        candidate.id !== artifactId &&
        candidate.kind === artifact.kind &&
        sameArtifactScope(candidate.scope, artifact.scope) &&
        candidate.slug === newSlug,
    )
  ) {
    throw new Error(`Artifact slug already exists: ${artifact.kind}:${newSlug}`);
  }
  if (artifact.slug === newSlug) {
    return artifact;
  }

  await snapshotArtifact(artifact, 'rename', home);
  const locator = locatorForRename(artifact.locator, newSlug);
  await moveArtifactContent(artifact.locator, locator, home);
  artifact.slug = newSlug;
  artifact.locator = locator;
  await saveLibraryManifest(manifest, home);
  return artifact;
}

export async function setArtifactLifecycle(
  artifactId: ArtifactId,
  lifecycle: 'active' | 'archived',
  home = regletHome(),
): Promise<LibraryArtifactMetadata> {
  const manifest = await loadLibraryManifest(home);
  const artifact = requireArtifact(manifest, artifactId);
  if (artifact.lifecycle === lifecycle) {
    return artifact;
  }
  await snapshotArtifact(artifact, 'archive', home);
  artifact.lifecycle = lifecycle;
  await saveLibraryManifest(manifest, home);
  return artifact;
}

export async function permanentlyDeleteArtifact(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<DeletedArtifactTombstone> {
  const manifest = await loadLibraryManifest(home);
  const artifact = requireArtifact(manifest, artifactId);
  const revision = await snapshotArtifact(artifact, 'delete', home);
  await removeArtifactContent(artifact.locator, home);

  const deletedAt = new Date();
  const tombstone: DeletedArtifactTombstone = {
    id: artifact.id,
    kind: artifact.kind,
    slug: artifact.slug,
    locator: artifact.locator,
    deletedAt: deletedAt.toISOString(),
    recoverableUntil: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    historyRevision: revision.revision,
  };
  manifest.artifacts = manifest.artifacts.filter((candidate) => candidate.id !== artifactId);
  manifest.tombstones = [
    ...manifest.tombstones.filter((candidate) => candidate.id !== artifactId),
    tombstone,
  ];
  await saveLibraryManifest(manifest, home);
  await deleteDraft(artifactId, home);
  return tombstone;
}

export function draftPath(artifactId: ArtifactId, home = regletHome()): string {
  return path.join(home, '.state', 'drafts', `${safeId(artifactId)}.json`);
}

export async function saveDraft(
  artifactId: ArtifactId,
  content: string,
  validationIssues: DraftValidationIssue[],
  home = regletHome(),
): Promise<ArtifactDraft> {
  const draft: ArtifactDraft = {
    artifactId,
    content,
    updatedAt: new Date().toISOString(),
    validationIssues,
  };
  await writeJsonAtomic(draftPath(artifactId, home), draft);
  return draft;
}

export async function loadDraft(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<ArtifactDraft | undefined> {
  try {
    const value = JSON.parse(await readFile(draftPath(artifactId, home), 'utf8')) as unknown;
    if (!isRecord(value) || value.artifactId !== artifactId || typeof value.content !== 'string') {
      return undefined;
    }
    const issues = Array.isArray(value.validationIssues)
      ? value.validationIssues.filter(isDraftValidationIssue)
      : [];
    return {
      artifactId,
      content: value.content,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      validationIssues: issues,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function deleteDraft(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<void> {
  await rm(draftPath(artifactId, home), { force: true });
}

export async function readArtifactText(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<string> {
  const artifact = await getLibraryArtifact(artifactId, home);
  if (artifact === undefined) {
    throw new Error(`Unknown artifact: ${artifactId}`);
  }
  if (artifact.locator.type === 'file') {
    return readFile(resolveWithinHome(artifact.locator.path, home), 'utf8');
  }
  if (artifact.locator.type === 'directory') {
    return readFile(
      path.join(resolveWithinHome(artifact.locator.path, home), 'SKILL.md'),
      'utf8',
    );
  }
  const value = await readJsonRecord(resolveWithinHome(artifact.locator.path, home));
  const servers = isRecord(value.mcpServers) ? value.mcpServers : {};
  const entry = servers[artifact.locator.serverName];
  const definition = isRecord(entry) && isRecord(entry.server) ? entry.server : entry;
  return `${JSON.stringify(definition ?? null, null, 2)}\n`;
}

export async function commitArtifactText(
  artifactId: ArtifactId,
  content: string,
  validationIssues: DraftValidationIssue[],
  home = regletHome(),
): Promise<{ saved: boolean; draft?: ArtifactDraft }> {
  if (validationIssues.length > 0) {
    return {
      saved: false,
      draft: await saveDraft(artifactId, content, validationIssues, home),
    };
  }
  const manifest = await loadLibraryManifest(home);
  const artifact = requireArtifact(manifest, artifactId);
  await snapshotArtifact(artifact, 'edit', home);
  if (artifact.locator.type === 'file') {
    await writeTextAtomic(resolveWithinHome(artifact.locator.path, home), content);
  } else if (artifact.locator.type === 'directory') {
    await writeTextAtomic(
      path.join(resolveWithinHome(artifact.locator.path, home), 'SKILL.md'),
      content,
    );
  } else {
    const definition = JSON.parse(content) as unknown;
    if (!isRecord(definition)) {
      throw new Error('MCP definition must be a JSON object.');
    }
    const filePath = resolveWithinHome(artifact.locator.path, home);
    const value = await readJsonRecord(filePath);
    const servers = isRecord(value.mcpServers) ? { ...value.mcpServers } : {};
    const current = servers[artifact.locator.serverName];
    servers[artifact.locator.serverName] = isRecord(current) && typeof current.displayName === 'string'
      ? { displayName: current.displayName, server: definition }
      : definition;
    value.mcpServers = servers;
    await writeJsonAtomic(filePath, value);
  }
  await deleteDraft(artifactId, home);
  return { saved: true };
}

export async function setArtifactTargets(
  artifactId: ArtifactId,
  targets: LibraryArtifactMetadata['targets'],
  home = regletHome(),
): Promise<LibraryArtifactMetadata> {
  const manifest = await loadLibraryManifest(home);
  const artifact = requireArtifact(manifest, artifactId);
  artifact.targets = [...new Set(targets)];
  await saveLibraryManifest(manifest, home);
  return artifact;
}

export async function listArtifactHistory(
  artifactId: ArtifactId,
  home = regletHome(),
): Promise<ArtifactHistoryRevision[]> {
  return (await loadHistoryIndex(artifactId, home)).revisions;
}

export async function restoreArtifactRevision(
  artifactId: ArtifactId,
  revision?: string,
  home = regletHome(),
): Promise<LibraryArtifactMetadata> {
  const manifest = await loadLibraryManifest(home);
  const existing = manifest.artifacts.find((artifact) => artifact.id === artifactId);
  const history = await loadHistoryIndex(artifactId, home);
  const target =
    revision === undefined
      ? history.revisions[0]
      : history.revisions.find((candidate) => candidate.revision === revision);
  if (target === undefined || target.metadata === undefined) {
    throw new Error(`Recoverable history is unavailable for artifact: ${artifactId}`);
  }

  if (existing !== undefined) {
    await snapshotArtifact(existing, 'restore', home);
    await removeArtifactContent(existing.locator, home);
  }
  await restoreSnapshotContent(target, home);
  const restored = structuredClone(target.metadata);
  const index = manifest.artifacts.findIndex((artifact) => artifact.id === artifactId);
  if (index === -1) {
    manifest.artifacts.push(restored);
  } else {
    manifest.artifacts[index] = restored;
  }
  manifest.tombstones = manifest.tombstones.filter(
    (tombstone) => tombstone.id !== artifactId,
  );
  sortArtifacts(manifest.artifacts);
  await saveLibraryManifest(manifest, home);
  await deleteDraft(artifactId, home);
  return restored;
}

export async function snapshotArtifact(
  artifact: LibraryArtifactMetadata,
  reason: ArtifactHistoryRevision['reason'],
  home = regletHome(),
): Promise<ArtifactHistoryRevision> {
  const revision = await hashArtifactContent(artifact.locator, home);
  const objectPath = path.join(home, '.state', 'history', 'objects', revision);
  if (!(await fileExists(objectPath))) {
    await copyArtifactToSnapshot(artifact.locator, objectPath, home);
  }

  const historyRevision: ArtifactHistoryRevision = {
    revision,
    artifactId: artifact.id,
    createdAt: new Date().toISOString(),
    reason,
    objectPath,
    locator: artifact.locator,
    metadata: structuredClone(artifact),
  };
  const index = await loadHistoryIndex(artifact.id, home);
  index.revisions.unshift(historyRevision);
  const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
  index.revisions = index.revisions.filter(
    (candidate, position) =>
      position < 50 ||
      new Date(candidate.createdAt).getTime() >= retentionCutoff,
  );
  await writeJsonAtomic(historyIndexPath(artifact.id, home), index);
  return historyRevision;
}

async function restoreSnapshotContent(
  revision: ArtifactHistoryRevision,
  home: string,
): Promise<void> {
  const locator = revision.metadata?.locator ?? revision.locator;
  if (locator.type === 'mcp-server') {
    const snapshot = await readJsonRecord(revision.objectPath);
    const filePath = resolveWithinHome(locator.path, home);
    let value: Record<string, unknown>;
    try {
      value = await readJsonRecord(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        value = {};
      } else {
        throw error;
      }
    }
    const servers = isRecord(value.mcpServers) ? { ...value.mcpServers } : {};
    servers[locator.serverName] = snapshot.definition ?? null;
    value.mcpServers = servers;
    await writeJsonAtomic(filePath, value);
    return;
  }
  const destination = resolveWithinHome(locator.path, home);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(revision.objectPath, destination, {
    recursive: locator.type === 'directory',
    verbatimSymlinks: true,
  });
}

function historyIndexPath(artifactId: ArtifactId, home: string): string {
  return path.join(home, '.state', 'history', 'indexes', `${safeId(artifactId)}.json`);
}

async function loadHistoryIndex(
  artifactId: ArtifactId,
  home: string,
): Promise<ArtifactHistoryIndex> {
  try {
    const value = JSON.parse(
      await readFile(historyIndexPath(artifactId, home), 'utf8'),
    ) as unknown;
    if (!isRecord(value) || !Array.isArray(value.revisions)) {
      return { artifactId, revisions: [] };
    }
    return {
      artifactId,
      revisions: value.revisions.filter(isHistoryRevision),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { artifactId, revisions: [] };
    }
    throw error;
  }
}

async function discoverLegacyInstructions(
  home: string,
  targets: LibraryArtifactMetadata['targets'],
): Promise<LibraryArtifactMetadata[]> {
  const rulesDir = path.join(home, 'rules');
  const files = await listFilesIfPresent(rulesDir);
  const overlayProviders = new Set(
    (
      await Promise.all(providerNames.map(async (provider) => ({
        provider,
        marked: await fileExists(path.join(rulesDir, provider, '.reglet-provider-overlay')),
      })))
    ).filter((candidate) => candidate.marked).map((candidate) => candidate.provider),
  );
  return files.filter((file) => file.endsWith('.md')).map((file) => {
      const relPath = path.posix.join('rules', file.split(path.sep).join('/'));
      const slug = normalizeSlug(file.replace(/\.md$/i, ''));
      const [candidateProvider] = file.split(path.sep);
      const provider = providerNames.find(
        (name) => name === candidateProvider && overlayProviders.has(name),
      );
      return legacyMetadata(
        'instruction',
        slug,
        relPath,
        {
          type: 'file',
          path: relPath,
        },
        provider === undefined ? { kind: 'global' } : { kind: 'provider-overlay', provider },
        provider === undefined ? targets : [provider],
      );
    });
}

async function discoverLegacySkills(
  home: string,
  targets: LibraryArtifactMetadata['targets'],
  syncSelections: Record<string, LibraryArtifactMetadata['targets']>,
): Promise<LibraryArtifactMetadata[]> {
  const skillsDir = path.join(home, 'skills');
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const artifacts: LibraryArtifactMetadata[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const provider = providerNames.find((name) => name === entry.name);
    if (provider !== undefined) {
      let providerEntries;
      try {
        providerEntries = await readdir(path.join(skillsDir, provider), { withFileTypes: true });
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') continue;
        throw error;
      }
      for (const skill of providerEntries.filter((candidate) => candidate.isDirectory())) {
        const relPath = path.posix.join('skills', provider, skill.name);
        const slug = normalizeSlug(skill.name);
        artifacts.push(legacyMetadata(
          'skill',
          slug,
          relPath,
          { type: 'directory', path: relPath },
          { kind: 'provider-overlay', provider },
          [provider],
        ));
      }
      continue;
    }
      const relPath = path.posix.join('skills', entry.name);
      const slug = normalizeSlug(entry.name);
      artifacts.push(legacyMetadata(
        'skill',
        slug,
        relPath,
        {
          type: 'directory',
          path: relPath,
        },
        { kind: 'global' },
        syncSelections[entry.name] ?? targets,
      ));
  }
  return artifacts;
}

async function discoverLegacyMcpServers(
  home: string,
  targets: LibraryArtifactMetadata['targets'],
  syncSelections: Record<string, LibraryArtifactMetadata['targets']>,
): Promise<LibraryArtifactMetadata[]> {
  const artifacts = await discoverMcpFile(
    home,
    path.posix.join('mcp', 'servers.json'),
    { kind: 'global' },
    (serverName) => syncSelections[serverName] ?? targets,
  );
  for (const provider of providerNames) {
    artifacts.push(...await discoverMcpFile(
      home,
      path.posix.join('mcp', 'providers', provider, 'servers.json'),
      { kind: 'provider-overlay', provider },
      () => [provider],
    ));
  }
  return artifacts;
}

async function discoverMcpFile(
  home: string,
  relPath: string,
  scope: LibraryArtifactMetadata['scope'],
  targets: (serverName: string) => LibraryArtifactMetadata['targets'],
): Promise<LibraryArtifactMetadata[]> {
  try {
    const value = JSON.parse(await readFile(path.join(home, relPath), 'utf8')) as unknown;
    if (!isRecord(value) || !isRecord(value.mcpServers)) {
      return [];
    }
    return Object.keys(value.mcpServers).map((serverName) =>
      legacyMetadata(
        'mcp',
        normalizeSlug(serverName),
        `${relPath}#${serverName}`,
        {
          type: 'mcp-server',
          path: relPath,
          serverName,
        },
        scope,
        targets(serverName),
      ),
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function legacyMetadata(
  kind: ArtifactKind,
  slug: string,
  identity: string,
  locator: ArtifactLocator,
  scope: LibraryArtifactMetadata['scope'],
  targets: LibraryArtifactMetadata['targets'],
): LibraryArtifactMetadata {
  return {
    id: deterministicArtifactId(kind, identity),
    kind,
    lifecycle: 'active',
    scope,
    slug,
    title: titleFromSlug(slug),
    tags: [],
    targets: [...targets],
    locator,
  };
}

function deterministicArtifactId(kind: ArtifactKind, identity: string): string {
  return `legacy-${createHash('sha256')
    .update(`${kind}\0${identity}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function normalizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

function requireArtifact(
  manifest: LibraryManifest,
  artifactId: ArtifactId,
): LibraryArtifactMetadata {
  const artifact = manifest.artifacts.find((candidate) => candidate.id === artifactId);
  if (artifact === undefined) {
    throw new Error(`Unknown artifact: ${artifactId}`);
  }
  return artifact;
}

function nextAvailableSlug(
  candidate: string,
  artifacts: LibraryArtifactMetadata[],
): string {
  const slugs = new Set(artifacts.map((artifact) => artifact.slug));
  if (!slugs.has(candidate)) {
    return candidate;
  }
  let suffix = 2;
  while (slugs.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
}

function locatorForDuplicate(locator: ArtifactLocator, slug: string): ArtifactLocator {
  return locatorForRename(locator, slug);
}

function locatorForRename(locator: ArtifactLocator, slug: string): ArtifactLocator {
  if (locator.type === 'file') {
    return {
      type: 'file',
      path: path.posix.join(path.posix.dirname(locator.path), `${slug}${path.posix.extname(locator.path)}`),
    };
  }
  if (locator.type === 'directory') {
    return {
      type: 'directory',
      path: path.posix.join(path.posix.dirname(locator.path), slug),
    };
  }
  return {
    ...locator,
    serverName: slug,
  };
}

async function copyArtifactContent(
  source: ArtifactLocator,
  destination: ArtifactLocator,
  home: string,
): Promise<void> {
  if (source.type !== destination.type) {
    throw new Error('Cannot copy artifact between locator types');
  }
  if (source.type === 'mcp-server' && destination.type === 'mcp-server') {
    const filePath = resolveWithinHome(source.path, home);
    const value = await readJsonRecord(filePath);
    const servers = isRecord(value.mcpServers) ? { ...value.mcpServers } : {};
    if (!(source.serverName in servers)) {
      throw new Error(`MCP server is missing: ${source.serverName}`);
    }
    if (destination.serverName in servers) {
      throw new Error(`MCP server already exists: ${destination.serverName}`);
    }
    servers[destination.serverName] = servers[source.serverName];
    value.mcpServers = servers;
    await writeJsonAtomic(filePath, value);
    return;
  }

  const sourcePath = resolveWithinHome(source.path, home);
  const destinationPath = resolveWithinHome(destination.path, home);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (source.type === 'directory') {
    await cp(sourcePath, destinationPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
  } else {
    await cp(sourcePath, destinationPath, { errorOnExist: true, force: false });
  }
}

async function moveArtifactContent(
  source: ArtifactLocator,
  destination: ArtifactLocator,
  home: string,
): Promise<void> {
  if (source.type !== destination.type) {
    throw new Error('Cannot move artifact between locator types');
  }
  if (source.type === 'mcp-server' && destination.type === 'mcp-server') {
    const filePath = resolveWithinHome(source.path, home);
    const value = await readJsonRecord(filePath);
    const servers = isRecord(value.mcpServers) ? { ...value.mcpServers } : {};
    if (!(source.serverName in servers)) {
      throw new Error(`MCP server is missing: ${source.serverName}`);
    }
    if (
      destination.serverName !== source.serverName &&
      destination.serverName in servers
    ) {
      throw new Error(`MCP server already exists: ${destination.serverName}`);
    }
    servers[destination.serverName] = servers[source.serverName];
    delete servers[source.serverName];
    value.mcpServers = servers;
    await writeJsonAtomic(filePath, value);
    return;
  }

  const sourcePath = resolveWithinHome(source.path, home);
  const destinationPath = resolveWithinHome(destination.path, home);
  if (await fileExists(destinationPath)) {
    throw new Error(`Canonical destination already exists: ${destination.path}`);
  }
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rename(sourcePath, destinationPath);
}

async function removeArtifactContent(locator: ArtifactLocator, home: string): Promise<void> {
  if (locator.type === 'mcp-server') {
    const filePath = resolveWithinHome(locator.path, home);
    const value = await readJsonRecord(filePath);
    const servers = isRecord(value.mcpServers) ? { ...value.mcpServers } : {};
    delete servers[locator.serverName];
    value.mcpServers = servers;
    await writeJsonAtomic(filePath, value);
    return;
  }

  const targetPath = resolveWithinHome(locator.path, home);
  const stats = await lstat(targetPath);
  if (locator.type === 'directory' && !stats.isDirectory()) {
    throw new Error(`Skill locator is not a directory: ${locator.path}`);
  }
  await rm(targetPath, { recursive: locator.type === 'directory', force: false });
}

async function hashArtifactContent(locator: ArtifactLocator, home: string): Promise<string> {
  const hash = createHash('sha256');
  if (locator.type === 'mcp-server') {
    const value = await readJsonRecord(resolveWithinHome(locator.path, home));
    const servers = isRecord(value.mcpServers) ? value.mcpServers : {};
    hash.update(JSON.stringify(servers[locator.serverName] ?? null));
    return hash.digest('hex');
  }
  const targetPath = resolveWithinHome(locator.path, home);
  if (locator.type === 'file') {
    hash.update(await readFile(targetPath));
    return hash.digest('hex');
  }
  for (const relPath of await listFilesIfPresent(targetPath)) {
    hash.update(relPath);
    hash.update('\0');
    hash.update(await readFile(path.join(targetPath, relPath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function copyArtifactToSnapshot(
  locator: ArtifactLocator,
  objectPath: string,
  home: string,
): Promise<void> {
  await mkdir(path.dirname(objectPath), { recursive: true });
  if (locator.type === 'mcp-server') {
    const value = await readJsonRecord(resolveWithinHome(locator.path, home));
    const servers = isRecord(value.mcpServers) ? value.mcpServers : {};
    await writeJsonAtomic(objectPath, {
      serverName: locator.serverName,
      definition: servers[locator.serverName] ?? null,
    });
    return;
  }
  const sourcePath = resolveWithinHome(locator.path, home);
  await cp(sourcePath, objectPath, {
    recursive: locator.type === 'directory',
    verbatimSymlinks: true,
  });
}

function resolveWithinHome(relPath: string, home: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error(`Artifact locator must be relative: ${relPath}`);
  }
  const resolvedHome = path.resolve(home);
  const resolved = path.resolve(resolvedHome, relPath);
  if (resolved !== resolvedHome && !resolved.startsWith(`${resolvedHome}${path.sep}`)) {
    throw new Error(`Artifact locator escapes the library: ${relPath}`);
  }
  return resolved;
}

async function listFilesIfPresent(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, entryPath));
      }
    }
  }
  await visit(root);
  return files;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content);
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isRecord(value)) {
    throw new Error(`Expected a JSON object: ${filePath}`);
  }
  return value;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function validateMetadata(artifact: LibraryArtifactMetadata): void {
  if (artifact.id.trim().length === 0) {
    throw new Error('Artifact ID must not be empty');
  }
  if (!artifactSlugPattern.test(artifact.slug)) {
    throw new Error(`Invalid artifact slug: ${artifact.slug}`);
  }
  if (artifact.title.trim().length === 0) {
    throw new Error('Artifact title must not be empty');
  }
  if (
    artifact.scope.kind === 'provider-overlay' &&
    (artifact.targets.length !== 1 || artifact.targets[0] !== artifact.scope.provider)
  ) {
    throw new Error('A provider-overlay artifact must target only its provider');
  }
  if (
    (artifact.kind === 'instruction' && artifact.locator.type !== 'file') ||
    (artifact.kind === 'skill' && artifact.locator.type !== 'directory') ||
    (artifact.kind === 'mcp' && artifact.locator.type !== 'mcp-server')
  ) {
    throw new Error(`Locator does not match artifact kind: ${artifact.kind}`);
  }
}

function assertUniqueArtifacts(artifacts: LibraryArtifactMetadata[]): void {
  const ids = new Set<string>();
  const kindSlugs = new Set<string>();
  for (const artifact of artifacts) {
    validateMetadata(artifact);
    if (ids.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    }
    ids.add(artifact.id);
    const kindSlug = artifactIdentityKey(artifact);
    if (kindSlugs.has(kindSlug)) {
      throw new Error(`Duplicate artifact slug: ${kindSlug}`);
    }
    kindSlugs.add(kindSlug);
  }
}

function sortArtifacts(artifacts: LibraryArtifactMetadata[]): void {
  artifacts.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      artifactScopeKey(left.scope).localeCompare(artifactScopeKey(right.scope)) ||
      left.slug.localeCompare(right.slug),
  );
}

function artifactIdentityKey(artifact: Pick<LibraryArtifactMetadata, 'kind' | 'scope' | 'slug'>): string {
  return `${artifact.kind}:${artifactScopeKey(artifact.scope)}:${artifact.slug}`;
}

function artifactScopeKey(scope: LibraryArtifactMetadata['scope']): string {
  return scope.kind === 'global' ? 'global' : `provider-overlay:${scope.provider}`;
}

function sameArtifactScope(
  left: LibraryArtifactMetadata['scope'],
  right: LibraryArtifactMetadata['scope'],
): boolean {
  return artifactScopeKey(left) === artifactScopeKey(right);
}

function safeId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseLibraryManifest(value: unknown): LibraryManifest {
  if (!isRecord(value) || value.schemaVersion !== LIBRARY_SCHEMA_VERSION) {
    throw new Error('Unsupported library schema. Run the schema-v2 migration.');
  }
  if (!Array.isArray(value.artifacts) || !Array.isArray(value.tombstones)) {
    throw new Error('Invalid library manifest');
  }
  const artifacts = value.artifacts.filter(isLibraryArtifactMetadata);
  if (artifacts.length !== value.artifacts.length) {
    throw new Error('Invalid artifact metadata in library manifest');
  }
  const tombstones = value.tombstones.filter(isDeletedArtifactTombstone);
  if (tombstones.length !== value.tombstones.length) {
    throw new Error('Invalid tombstone in library manifest');
  }
  assertUniqueArtifacts(artifacts);
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    artifacts,
    tombstones,
  };
}

function isLibraryArtifactMetadata(value: unknown): value is LibraryArtifactMetadata {
  if (!isRecord(value) || !isArtifactLocator(value.locator)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    (value.kind === 'instruction' || value.kind === 'skill' || value.kind === 'mcp') &&
    (value.lifecycle === 'active' || value.lifecycle === 'archived') &&
    isArtifactScope(value.scope) &&
    typeof value.slug === 'string' &&
    typeof value.title === 'string' &&
    (value.description === undefined || typeof value.description === 'string') &&
    isStringArray(value.tags) &&
    isProviderIdArray(value.targets)
  );
}

function isArtifactLocator(value: unknown): value is ArtifactLocator {
  if (!isRecord(value) || typeof value.path !== 'string') {
    return false;
  }
  return (
    value.type === 'file' ||
    value.type === 'directory' ||
    (value.type === 'mcp-server' && typeof value.serverName === 'string')
  );
}

function isArtifactScope(value: unknown): value is LibraryArtifactMetadata['scope'] {
  return isRecord(value) &&
    (value.kind === 'global' ||
      (value.kind === 'provider-overlay' && isProviderId(value.provider)));
}

function isDeletedArtifactTombstone(value: unknown): value is DeletedArtifactTombstone {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'instruction' || value.kind === 'skill' || value.kind === 'mcp') &&
    typeof value.slug === 'string' &&
    typeof value.deletedAt === 'string' &&
    typeof value.recoverableUntil === 'string' &&
    isArtifactLocator(value.locator) &&
    (value.historyRevision === undefined || typeof value.historyRevision === 'string')
  );
}

function isHistoryRevision(value: unknown): value is ArtifactHistoryRevision {
  return (
    isRecord(value) &&
    typeof value.revision === 'string' &&
    typeof value.artifactId === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.reason === 'edit' ||
      value.reason === 'rename' ||
      value.reason === 'archive' ||
      value.reason === 'delete' ||
      value.reason === 'restore') &&
    typeof value.objectPath === 'string' &&
    isArtifactLocator(value.locator) &&
    (value.metadata === undefined || isLibraryArtifactMetadata(value.metadata))
  );
}

function isDraftValidationIssue(value: unknown): value is DraftValidationIssue {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.path === undefined || typeof value.path === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isProviderIdArray(
  value: unknown,
): value is LibraryArtifactMetadata['targets'] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === 'claude' ||
        item === 'codex' ||
        item === 'cursor' ||
        item === 'gemini' ||
        item === 'windsurf' ||
        item === 'opencode',
    )
  );
}

function isProviderId(value: unknown): value is LibraryArtifactMetadata['targets'][number] {
  return value === 'claude' || value === 'codex' || value === 'cursor' ||
    value === 'gemini' || value === 'windsurf' || value === 'opencode';
}

function migrationDigest(artifacts: LibraryArtifactMetadata[]): string {
  return createHash('sha256')
    .update(JSON.stringify(artifacts))
    .digest('hex');
}

async function artifactSourceExists(locator: ArtifactLocator, home: string): Promise<boolean> {
  return fileExists(resolveWithinHome(locator.path, home));
}

function latestMigrationReceiptPath(home: string): string {
  return path.join(home, '.state', 'migrations', 'library-v2', 'latest.json');
}

async function readLatestMigrationReceipt(home: string): Promise<LibraryMigrationReceipt | undefined> {
  try {
    const value = JSON.parse(await readFile(latestMigrationReceiptPath(home), 'utf8')) as unknown;
    return isLibraryMigrationReceipt(value) ? value : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function isLibraryMigrationReceipt(value: unknown): value is LibraryMigrationReceipt {
  return isRecord(value) && value.version === 1 && value.migration === 'library-v2' &&
    typeof value.id === 'string' && typeof value.digest === 'string' &&
    typeof value.appliedAt === 'string' && typeof value.manifestPath === 'string' &&
    (value.manifestBackupPath === null || typeof value.manifestBackupPath === 'string') &&
    (value.metadataBackupPath === null || typeof value.metadataBackupPath === 'string') &&
    typeof value.createdManifest === 'boolean' && typeof value.artifactCount === 'number' &&
    value.reversible === true;
}
