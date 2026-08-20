import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  defaultConfig,
  loadManifest,
  LocalState,
  MemorySecretStore,
  newActiveSyncV2State,
  saveConfig,
  saveManifest,
  saveSyncV2State,
  sha256String,
  type LibraryMigrationPreview,
} from '@reglet/core';
import {
  isManagerProjectionReviewV3,
  isManagerProviderBackupPurgeResultV3,
  isManagerProviderBackupPurgeReviewV3,
  isManagerProviderDetachResultV3,
  isManagerProviderDetachReviewV3,
  isManagerProviderRestoreResultV3,
  isManagerProviderRestoreReviewV3,
  isManagerRecoveryReceiptV3,
  isManagerRecoveryRestoreResultV3,
  isManagerRecoveryReviewV3,
  isManagerSnapshotV3,
  isSyncConflictPreview,
  type ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import {
  ApplicationPermissionError,
  RegletApplication,
  RevisionConflictError,
} from '../src/service.js';

let currentHome: string | undefined;
let currentProviderHome: string | undefined;
let currentProjects: string[] = [];

afterEach(async () => {
  if (currentHome !== undefined) await rm(currentHome, { recursive: true, force: true });
  if (currentProviderHome !== undefined) await rm(currentProviderHome, { recursive: true, force: true });
  await Promise.all(currentProjects.map((project) => rm(project, { recursive: true, force: true })));
  currentHome = undefined;
  currentProviderHome = undefined;
  currentProjects = [];
  delete process.env.REGLET_PROVIDER_HOME;
});

async function applicationWithLegacyRule(): Promise<{ app: RegletApplication; home: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-application-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-application-provider-'));
  process.env.REGLET_PROVIDER_HOME = currentProviderHome;
  await mkdir(path.join(currentHome, 'rules'), { recursive: true });
  await writeFile(path.join(currentHome, 'rules', '00-general.md'), '# General\n');
  const config = defaultConfig();
  config.providers.codex.enabled = true;
  await saveConfig(config, currentHome);
  return {
    home: currentHome,
    app: new RegletApplication({ home: currentHome, secretStore: new MemorySecretStore() }),
  };
}

async function migrate(app: RegletApplication): Promise<number> {
  const previewResult = await app.execute({ operation: 'migration.preview', input: {} });
  const preview = previewResult.data as LibraryMigrationPreview;
  const result = await app.execute({
    operation: 'migration.apply',
    input: { yes: true, previewDigest: preview.digest },
  });
  return result.revision;
}

describe('RegletApplication', () => {
  test('sets up an empty machine with one global default and reviewed project discovery', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-application-empty-'));
    currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-application-provider-'));
    process.env.REGLET_PROVIDER_HOME = currentProviderHome;
    const project = await mkdtemp(path.join(tmpdir(), 'reglet-setup-project-'));
    currentProjects.push(project);
    await writeFile(path.join(project, 'AGENTS.md'), '# Project-only rules\n');
    const app = new RegletApplication({ home: currentHome, secretStore: new MemorySecretStore() });

    const setup = await app.execute({
      operation: 'setup.complete',
      input: {
        createGlobalDefaults: true,
        globalInstructionContent: '# Shared machine defaults\n',
        targets: ['codex'],
        rootPath: project,
        scanProject: true,
      },
    });
    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const artifact = snapshot.library.artifacts[0];

    expect(setup.data).toMatchObject({ completed: true, discoveries: 1 });
    expect(snapshot.settings.setup.completed).toBe(true);
    expect(artifact?.metadata).toMatchObject({
      kind: 'instruction',
      scope: { kind: 'global' },
      targets: ['codex'],
    });
    expect(snapshot.projectInbox?.roots).toHaveLength(1);
    expect(snapshot.projectInbox?.discoveries).toHaveLength(1);
    expect(await Bun.file(path.join(currentProviderHome, '.codex', 'AGENTS.md')).exists()).toBe(false);
  });

  test('requires explicit migration approval and produces a strict Snapshot V3', async () => {
    const { app } = await applicationWithLegacyRule();

    await expect(app.execute({
      operation: 'library.create',
      input: { kind: 'instruction', slug: 'blocked', title: 'Blocked', content: '# Blocked' },
    })).rejects.toThrow('migration approval is required');

    const revision = await migrate(app);
    const snapshotResult = await app.execute({ operation: 'snapshot', input: {} });
    const migrationStatus = await app.execute({ operation: 'migration.status', input: {} });

    expect(revision).toBe(1);
    expect(isManagerSnapshotV3(snapshotResult.data)).toBe(true);
    expect((snapshotResult.data as ManagerSnapshotV3).library.migration.status).toBe('applied');
    expect(migrationStatus.data).toMatchObject({
      state: 'applied',
      receipt: { artifactCount: 1, reversible: true },
    });
    expect(JSON.stringify(migrationStatus.data)).not.toContain('BackupPath');
    expect(JSON.stringify(migrationStatus.data)).not.toContain('.state/migrations');
  });

  test('serializes mutations, enforces optimistic revisions, and persists invalid drafts', async () => {
    const { app, home } = await applicationWithLegacyRule();
    const revision = await migrate(app);
    const created = await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'review-first',
        title: 'Review first',
        content: '# Review first\n',
        targets: ['codex'],
      },
    }, { expectedRevision: revision });
    const artifact = created.data as { id: string };

    await expect(app.execute({
      operation: 'library.archive',
      input: { artifact: artifact.id },
    }, { expectedRevision: revision })).rejects.toBeInstanceOf(RevisionConflictError);

    const saved = await app.execute({
      operation: 'library.save',
      input: { artifact: artifact.id, content: '---\nunclosed' },
    }, { expectedRevision: created.revision });
    expect(saved.data).toMatchObject({ saved: false });

    const restarted = new RegletApplication({ home, secretStore: new MemorySecretStore() });
    const shown = await restarted.execute({ operation: 'library.show', input: { artifact: artifact.id } });
    expect(shown.data).toMatchObject({ draft: { content: '---\nunclosed' } });
  });

  test('archives canonical content without deleting it and stops targeting projections', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const created = await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'archivable',
        title: 'Archivable',
        content: '# Archivable\n',
        targets: ['codex'],
      },
    });
    const artifact = created.data as { id: string };
    await app.execute({ operation: 'library.archive', input: { artifact: artifact.id } });
    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const archived = snapshot.library.artifacts.find((candidate) => candidate.metadata.id === artifact.id);

    expect(archived?.metadata.lifecycle).toBe('archived');
    expect(archived?.projections.find((projection) => projection.provider === 'codex')?.status).toBe('not-targeted');
  });

  test('previews and applies the exact provider content unit affected by an artifact', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const first = await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'first-reviewed-rule',
        title: 'First reviewed rule',
        content: '# First reviewed rule\n',
        targets: ['codex'],
      },
    });
    const second = await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'second-reviewed-rule',
        title: 'Second reviewed rule',
        content: '# Second reviewed rule\n',
        targets: ['codex'],
      },
    });
    const firstArtifact = first.data as { id: string };
    const secondArtifact = second.data as { id: string };

    const preview = await app.execute({
      operation: 'provider.preview',
      input: { artifact: firstArtifact.id, provider: 'codex' },
    });
    const plan = preview.data as {
      batchDigest: string;
      content: 'rules';
      unitDigest: string;
      affectedArtifacts: Array<{ id: string }>;
    };
    const applied = await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: plan.batchDigest,
        units: [{ provider: 'codex', content: plan.content, digest: plan.unitDigest }],
      },
    });

    expect(plan.affectedArtifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining([
      firstArtifact.id,
      secondArtifact.id,
    ]));
    const review = (await app.execute({
      operation: 'provider.review',
      input: {
        units: [
          { provider: 'codex', content: 'rules' },
          { provider: 'codex', content: 'skills' },
        ],
      },
    })).data;
    expect(isManagerProjectionReviewV3(review)).toBe(true);
    expect(review).toMatchObject({
      units: [
        { key: 'codex:rules', artifacts: expect.arrayContaining([expect.objectContaining({ id: firstArtifact.id })]) },
        { key: 'codex:skills' },
      ],
    });
    expect(applied.data).toMatchObject({ summary: { applied: 1, blocked: 0, failed: 0 } });
    const output = await Bun.file(path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md')).text();
    expect(output).toContain('# First reviewed rule');
    expect(output).toContain('# Second reviewed rule');
    const activity = (await app.execute({ operation: 'activity.list', input: {} })).data as Array<{
      action: string;
      artifactId?: string;
      provider?: string;
      metadata: Record<string, number>;
    }>;
    expect(activity.find((record) => record.action === 'library.create')).toMatchObject({
      artifactId: secondArtifact.id,
    });
    expect(activity.find((record) => record.action === 'provider.apply')).toMatchObject({
      provider: 'codex',
      metadata: { applied: 1, blocked: 0, failed: 0 },
    });
  });

  test('derives upgraded projection state from the durable output manifest', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const created = await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'manifest-backed-rule',
        title: 'Manifest-backed rule',
        content: '# Manifest-backed rule\n',
        targets: ['codex'],
      },
    });
    const artifact = created.data as { id: string };
    const preview = await app.execute({
      operation: 'provider.preview',
      input: { artifact: artifact.id, provider: 'codex' },
    });
    const plan = preview.data as { batchDigest: string; content: 'rules'; unitDigest: string };
    await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: plan.batchDigest,
        units: [{ provider: 'codex', content: plan.content, digest: plan.unitDigest }],
      },
    });
    const state = await LocalState.open(home);
    state.database.run('DELETE FROM projection_records');
    state.close();

    const appliedSnapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const appliedProjection = appliedSnapshot.library.artifacts
      .find((candidate) => candidate.metadata.id === artifact.id)
      ?.projections.find((candidate) => candidate.provider === 'codex');
    expect(appliedProjection?.status).toBe('applied');

    const outputPath = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await writeFile(outputPath, '# Changed outside Reglet\n');
    const driftedSnapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const driftedProjection = driftedSnapshot.library.artifacts
      .find((candidate) => candidate.metadata.id === artifact.id)
      ?.projections.find((candidate) => candidate.provider === 'codex');
    expect(driftedProjection?.status).toBe('drifted');
    const diagnostics = await app.execute({ operation: 'diagnostics', input: {} });
    expect(diagnostics.data).toMatchObject({
      healthy: false,
      issues: [expect.objectContaining({ code: 'provider-output-modified', severity: 'warning' })],
    });
  });

  test('lists, reviews, and restores one exact public recovery receipt', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const artifact = (await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'recoverable-rule',
        title: 'Recoverable rule',
        content: '# Recoverable rule\n',
        targets: ['codex'],
      },
    })).data as { id: string };
    const outputPath = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, '# Before Reglet apply\n');
    const preview = (await app.execute({
      operation: 'provider.preview',
      input: { artifact: artifact.id, provider: 'codex' },
    })).data as { batchDigest: string; content: 'rules'; unitDigest: string };
    const applied = (await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: preview.batchDigest,
        units: [{ provider: 'codex', content: preview.content, digest: preview.unitDigest }],
      },
    })).data as {
      units: Array<{ receiptId?: string }>;
    };
    const receiptId = applied.units[0]?.receiptId ?? '';

    expect(receiptId).not.toBe('');
    expect(JSON.stringify(applied)).not.toContain('snapshot');
    expect(JSON.stringify(applied)).not.toContain('before');
    expect(JSON.stringify(applied)).not.toContain('after');
    const receipts = (await app.execute({ operation: 'recovery.list', input: {} })).data as unknown[];
    expect(receipts.every(isManagerRecoveryReceiptV3)).toBe(true);
    expect(receipts).toContainEqual(expect.objectContaining({ id: receiptId, restorable: true, targetCount: 1 }));

    const review = (await app.execute({
      operation: 'recovery.preview',
      input: { receiptId },
    })).data;
    expect(isManagerRecoveryReviewV3(review)).toBe(true);
    expect(JSON.stringify(review)).not.toContain('.state/operations/snapshots');
    if (!isManagerRecoveryReviewV3(review)) throw new Error('expected a recovery review');

    await writeFile(outputPath, '# Changed after recovery review\n');
    await expect(app.execute({
      operation: 'recovery.restore',
      input: { receiptId, digest: review.digest, confirmed: true },
    })).rejects.toThrow('preview is stale');
    expect(await Bun.file(outputPath).text()).toBe('# Changed after recovery review\n');

    const refreshed = (await app.execute({
      operation: 'recovery.preview',
      input: { receiptId },
    })).data;
    if (!isManagerRecoveryReviewV3(refreshed)) throw new Error('expected a refreshed recovery review');
    const restored = (await app.execute({
      operation: 'recovery.restore',
      input: { receiptId, digest: refreshed.digest, confirmed: true },
    })).data;
    expect(isManagerRecoveryRestoreResultV3(restored)).toBe(true);
    expect(await Bun.file(outputPath).text()).toBe('# Before Reglet apply\n');
    expect((await app.execute({ operation: 'recovery.list', input: {} })).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: receiptId, lifecycle: 'restored', restorable: false }),
      expect.objectContaining({ id: isManagerRecoveryRestoreResultV3(restored) ? restored.undoReceiptId : '', restorable: true }),
    ]));
    const activity = (await app.execute({ operation: 'activity.list', input: {} })).data as Array<{
      action: string;
      metadata: Record<string, string>;
    }>;
    expect(activity.find((record) => record.action === 'recovery.restore')).toMatchObject({
      metadata: {
        receiptId,
        undoReceiptId: isManagerRecoveryRestoreResultV3(restored) ? restored.undoReceiptId : '',
      },
    });
  });

  test('reviews the exact provider restore before replacing or removing outputs', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const artifact = (await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'provider-restore-rule',
        title: 'Provider restore rule',
        content: '# Provider restore rule\n',
        targets: ['codex'],
      },
    })).data as { id: string };
    const outputPath = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, '# Original provider file\n');
    const projection = (await app.execute({
      operation: 'provider.preview',
      input: { artifact: artifact.id, provider: 'codex' },
    })).data as { batchDigest: string; content: 'rules'; unitDigest: string };
    await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: projection.batchDigest,
        units: [{ provider: 'codex', content: projection.content, digest: projection.unitDigest }],
      },
    });

    const review = (await app.execute({
      operation: 'provider.restore.preview',
      input: { provider: 'codex' },
    })).data;
    expect(isManagerProviderRestoreReviewV3(review)).toBe(true);
    expect(JSON.stringify(review)).not.toContain('backedUpTo');
    expect(JSON.stringify(review)).not.toContain('.state/operations');
    if (!isManagerProviderRestoreReviewV3(review)) throw new Error('expected a provider restore review');

    await writeFile(outputPath, '# Changed after provider restore review\n');
    await expect(app.execute({
      operation: 'provider.restore',
      input: { provider: 'codex', digest: review.digest, confirmed: true },
    })).rejects.toThrow('preview is stale');
    expect(await Bun.file(outputPath).text()).toBe('# Changed after provider restore review\n');

    const refreshed = (await app.execute({
      operation: 'provider.restore.preview',
      input: { provider: 'codex' },
    })).data;
    if (!isManagerProviderRestoreReviewV3(refreshed)) throw new Error('expected a refreshed provider restore review');
    const restored = (await app.execute({
      operation: 'provider.restore',
      input: { provider: 'codex', digest: refreshed.digest, confirmed: true },
    })).data;
    expect(isManagerProviderRestoreResultV3(restored)).toBe(true);
    expect(await Bun.file(outputPath).text()).toBe('# Original provider file\n');
    const activity = (await app.execute({ operation: 'activity.list', input: {} })).data as Array<{
      action: string;
      metadata: Record<string, string>;
    }>;
    expect(activity.find((record) => record.action === 'provider.restore')).toMatchObject({
      provider: 'codex',
      metadata: { receiptId: isManagerProviderRestoreResultV3(restored) ? restored.receiptId : '' },
    });
  });

  test('reviews the exact private backup tree before permanent purge', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const backupPath = path.join(home, '.state', 'backups', 'codex', 'revision', 'AGENTS.md');
    const outputPath = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, '# Original backup\n');
    await saveManifest({
      version: 1,
      outputs: {
        [outputPath]: {
          provider: 'codex',
          content: 'rules',
          hash: 'managed-hash',
          appliedAt: '2026-08-19T12:00:00.000Z',
          backedUpTo: backupPath,
        },
      },
    }, home);

    const review = (await app.execute({
      operation: 'provider.purge-backups.preview',
      input: { provider: 'codex' },
    })).data;
    expect(isManagerProviderBackupPurgeReviewV3(review)).toBe(true);
    expect(JSON.stringify(review)).not.toContain(backupPath);
    if (!isManagerProviderBackupPurgeReviewV3(review)) throw new Error('expected a backup purge review');

    await writeFile(backupPath, '# Backup changed after review\n');
    await expect(app.execute({
      operation: 'provider.purge-backups',
      input: { provider: 'codex', digest: review.digest, confirmed: true },
    })).rejects.toThrow('preview is stale');
    expect(await Bun.file(backupPath).exists()).toBe(true);

    const refreshed = (await app.execute({
      operation: 'provider.purge-backups.preview',
      input: { provider: 'codex' },
    })).data;
    if (!isManagerProviderBackupPurgeReviewV3(refreshed)) throw new Error('expected a refreshed backup purge review');
    const purged = (await app.execute({
      operation: 'provider.purge-backups',
      input: { provider: 'codex', digest: refreshed.digest, confirmed: true },
    })).data;
    expect(isManagerProviderBackupPurgeResultV3(purged)).toBe(true);
    expect(await Bun.file(backupPath).exists()).toBe(false);
    expect((await loadManifest(home)).outputs[outputPath]?.backedUpTo).toBeNull();
  });

  test('classifies provider source ownership before and after reviewed apply', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const providerRules = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await mkdir(path.dirname(providerRules), { recursive: true });
    await writeFile(providerRules, '# Existing provider rule\n');

    const unmanagedSnapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const unmanagedSource = unmanagedSnapshot.providers
      .find((provider) => provider.id === 'codex')
      ?.sources.find((source) => source.content === 'rules');
    expect(unmanagedSource).toMatchObject({
      exists: true,
      readable: true,
      ownership: 'unmanaged',
      items: [{ label: 'AGENTS.md', ownership: 'unmanaged' }],
    });

    const artifact = (await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'source-ownership-rule',
        title: 'Source ownership rule',
        content: '# Source ownership rule\n',
        targets: ['codex'],
      },
    })).data as { id: string };
    const preview = (await app.execute({
      operation: 'provider.preview',
      input: { artifact: artifact.id, provider: 'codex' },
    })).data as { batchDigest: string; content: 'rules'; unitDigest: string };
    await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: preview.batchDigest,
        units: [{ provider: 'codex', content: preview.content, digest: preview.unitDigest }],
      },
    });

    const managedSnapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const managedSource = managedSnapshot.providers
      .find((provider) => provider.id === 'codex')
      ?.sources.find((source) => source.content === 'rules');
    expect(managedSource).toMatchObject({
      ownership: 'managed',
      items: [{ label: 'AGENTS.md', ownership: 'managed' }],
    });

    const detachReview = (await app.execute({
      operation: 'provider.source.stop-managing.preview',
      input: { provider: 'codex', content: 'rules' },
    })).data;
    expect(isManagerProviderDetachReviewV3(detachReview)).toBe(true);
    if (!isManagerProviderDetachReviewV3(detachReview)) throw new Error('expected a provider detach review');
    await writeFile(providerRules, `${await Bun.file(providerRules).text()}\nChanged after detach review.\n`);
    await expect(app.execute({
      operation: 'provider.source.stop-managing',
      input: { provider: 'codex', content: 'rules', digest: detachReview.digest, confirmed: true },
    })).rejects.toThrow('preview is stale');
    const refreshedDetach = (await app.execute({
      operation: 'provider.source.stop-managing.preview',
      input: { provider: 'codex', content: 'rules' },
    })).data;
    if (!isManagerProviderDetachReviewV3(refreshedDetach)) throw new Error('expected a refreshed detach review');
    const detached = (await app.execute({
      operation: 'provider.source.stop-managing',
      input: { provider: 'codex', content: 'rules', digest: refreshedDetach.digest, confirmed: true },
    })).data;
    expect(isManagerProviderDetachResultV3(detached)).toBe(true);
    const detachedSnapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const detachedSource = detachedSnapshot.providers
      .find((provider) => provider.id === 'codex')
      ?.sources.find((source) => source.content === 'rules');
    expect(detachedSource?.ownership).toBe('unmanaged');
    expect(await Bun.file(providerRules).text()).toContain('# Source ownership rule');
    expect((await app.execute({ operation: 'recovery.list', input: {} })).data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: isManagerProviderDetachResultV3(detached) ? detached.receiptId : '',
        restorable: false,
        reason: expect.stringContaining('start managing'),
      }),
    ]));
    const detachRecovery = await app.execute({
      operation: 'recovery.preview',
      input: { receiptId: isManagerProviderDetachResultV3(detached) ? detached.receiptId : '' },
    });
    expect(detachRecovery.data).toMatchObject({
      receipt: { restorable: false, reason: expect.stringContaining('start managing') },
    });

    const resumed = await app.execute({
      operation: 'provider.source.start-managing',
      input: { provider: 'codex', content: 'rules' },
    });
    expect(resumed.data).toMatchObject({ managing: true, alreadyManaging: false, nextAction: 'review-and-apply' });
    const resumedReview = (await app.execute({
      operation: 'provider.review',
      input: { units: [{ provider: 'codex', content: 'rules' }] },
    })).data;
    expect(isManagerProjectionReviewV3(resumedReview)).toBe(true);
  });

  test('adopts an unmanaged provider rule only from its exact preview', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const providerRules = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md');
    await mkdir(path.dirname(providerRules), { recursive: true });
    await writeFile(providerRules, '# Provider-only rule\n');

    const firstPreview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'rules', destination: 'provider' },
    })).data as {
      digest: string;
      blocked: boolean;
      artifact: { slug: string; scope: { kind: string; provider?: string }; targets: string[] };
    };
    expect(firstPreview).toMatchObject({
      blocked: false,
      artifact: { slug: 'codex-instructions', scope: { kind: 'provider-overlay', provider: 'codex' }, targets: ['codex'] },
    });

    await writeFile(providerRules, '# Provider-only rule changed\n');
    await expect(app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'rules',
        destination: 'provider',
        previewDigest: firstPreview.digest,
      },
    })).rejects.toThrow('changed after preview');

    const freshPreview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'rules', destination: 'provider' },
    })).data as { digest: string };
    const adopted = (await app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'rules',
        destination: 'provider',
        previewDigest: freshPreview.digest,
      },
    })).data as { artifact: { id: string; locator: { path: string } } };
    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;

    expect(snapshot.library.artifacts.find((artifact) => artifact.metadata.id === adopted.artifact.id)?.metadata).toMatchObject({
      kind: 'instruction',
      scope: { kind: 'provider-overlay', provider: 'codex' },
      targets: ['codex'],
    });
    expect(await Bun.file(path.join(currentHome ?? '', adopted.artifact.locator.path)).text()).toBe('# Provider-only rule changed\n');
    expect(await Bun.file(providerRules).text()).toBe('# Provider-only rule changed\n');
  });

  test('blocks Codex instruction projection while a global override shadows it', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const artifact = (await app.execute({
      operation: 'library.create',
      input: {
        kind: 'instruction',
        slug: 'codex-managed-rule',
        title: 'Codex managed rule',
        content: '# Managed by Reglet\n',
        targets: ['codex'],
      },
    })).data as { id: string };
    const overridePath = path.join(currentProviderHome ?? '', '.codex', 'AGENTS.override.md');
    await mkdir(path.dirname(overridePath), { recursive: true });
    await writeFile(overridePath, '# Effective override\n');

    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const codex = snapshot.providers.find((provider) => provider.id === 'codex');
    const rules = codex?.sources.find((source) => source.content === 'rules');
    expect(codex?.capabilities.instructions).toEqual({ supported: true });
    expect(rules).toMatchObject({
      exists: true,
      readable: false,
      ownership: 'unmanaged',
      items: [{ label: 'AGENTS.override.md', ownership: 'unmanaged' }],
      issues: [expect.objectContaining({ code: 'codex-global-override-active', severity: 'error' })],
    });
    expect(snapshot.diagnostics).toMatchObject({
      healthy: false,
      issues: [expect.objectContaining({ code: 'codex-global-override-active', severity: 'error' })],
    });

    const projectionPreview = (await app.execute({
      operation: 'provider.preview',
      input: { artifact: artifact.id, provider: 'codex' },
    })).data as {
      batchDigest: string;
      content: 'rules';
      unitDigest: string;
      review: { units: Array<{ status: string; validationIssues: string[]; validationIssueCodes: string[] }> };
    };
    expect(projectionPreview.review.units[0]).toMatchObject({
      status: 'blocked',
      validationIssues: [expect.stringContaining('AGENTS.override.md shadows')],
      validationIssueCodes: ['provider-override-active'],
    });
    const blocked = await app.execute({
      operation: 'provider.apply',
      input: {
        batchDigest: projectionPreview.batchDigest,
        units: [{ provider: 'codex', content: projectionPreview.content, digest: projectionPreview.unitDigest }],
      },
    });
    expect(blocked.data).toMatchObject({ summary: { applied: 0, blocked: 1, failed: 0 } });
    expect(await Bun.file(path.join(currentProviderHome ?? '', '.codex', 'AGENTS.md')).exists()).toBe(false);

    const adoptionPreview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'rules', name: 'AGENTS.override.md', destination: 'provider' },
    })).data as { blocked: boolean; contentText: string };
    expect(adoptionPreview).toMatchObject({ blocked: false, contentText: '# Effective override\n' });
  });

  test('requires exact executable confirmation when adopting a provider skill', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const source = path.join(currentProviderHome ?? '', '.agents', 'skills', 'shell-helper');
    await mkdir(path.join(source, 'scripts'), { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: shell-helper\ndescription: Review shell tasks\n---\n\n# Shell helper\n');
    const script = path.join(source, 'scripts', 'run.sh');
    await writeFile(script, '#!/bin/sh\necho reviewed\n');
    await chmod(script, 0o755);
    const occupiedDestination = path.join(home, 'skills', 'shell-helper');
    await mkdir(occupiedDestination, { recursive: true });
    await writeFile(path.join(occupiedDestination, 'SKILL.md'), 'untracked canonical content\n');

    const preview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'skills', name: 'shell-helper', destination: 'shared', targets: ['codex'] },
    })).data as {
      digest: string;
      blocked: boolean;
      artifact: { slug: string };
      skillInspection: { revision: string; requiresExecutableConfirmation: boolean };
    };
    expect(preview.blocked).toBe(false);
    expect(preview.artifact.slug).toBe('shell-helper-2');
    expect(preview.skillInspection.requiresExecutableConfirmation).toBe(true);
    await expect(app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'skills',
        name: 'shell-helper',
        destination: 'shared',
        targets: ['codex'],
        previewDigest: preview.digest,
      },
    })).rejects.toThrow('exact inspected revision');

    const adopted = (await app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'skills',
        name: 'shell-helper',
        destination: 'shared',
        targets: ['codex'],
        previewDigest: preview.digest,
        confirmedExecutableRevision: preview.skillInspection.revision,
      },
    })).data as { artifact: { id: string } };
    const state = await LocalState.open(home);
    const trust = state.trustDecision(adopted.artifact.id);
    state.close();

    expect(trust?.revision).toBe(preview.skillInspection.revision);
    expect(await Bun.file(path.join(home, 'skills', 'shell-helper-2', 'scripts', 'run.sh')).text()).toContain('echo reviewed');
    expect(await Bun.file(path.join(occupiedDestination, 'SKILL.md')).text()).toBe('untracked canonical content\n');
  });

  test('adopts provider MCP without returning or storing raw environment values', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const providerConfig = path.join(currentProviderHome ?? '', '.codex', 'config.toml');
    await mkdir(path.dirname(providerConfig), { recursive: true });
    await writeFile(providerConfig, [
      '[mcp_servers.local-tools]',
      'command = "node"',
      'args = ["server.js"]',
      '',
      '[mcp_servers.local-tools.env]',
      'TOKEN = "provider-secret-value"',
      '',
    ].join('\n'));

    const preview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'mcp', name: 'local-tools', destination: 'shared', targets: ['codex'] },
    })).data as {
      digest: string;
      blocked: boolean;
      contentText: string;
      issues: Array<{ code: string }>;
    };
    expect(JSON.stringify(preview)).not.toContain('provider-secret-value');
    expect(preview.contentText).toContain('"source": "process-env"');
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'mcp-environment-value-redacted' }));
    expect(preview.blocked).toBe(false);

    const projectionReview = (await app.execute({
      operation: 'provider.review',
      input: { units: [{ provider: 'codex', content: 'mcp' }] },
    })).data;
    expect(isManagerProjectionReviewV3(projectionReview)).toBe(true);
    expect(JSON.stringify(projectionReview)).not.toContain('provider-secret-value');
    expect(projectionReview).not.toHaveProperty('units.0.entries.0.before');
    expect(projectionReview).not.toHaveProperty('units.0.entries.0.after');

    const adopted = (await app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'mcp',
        name: 'local-tools',
        destination: 'shared',
        targets: ['codex'],
        previewDigest: preview.digest,
      },
    })).data as { artifact: { id: string } };
    const canonical = await Bun.file(path.join(home, 'mcp', 'servers.json')).text();
    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;

    expect(canonical).not.toContain('provider-secret-value');
    expect(canonical).toContain('process-env');
    expect(snapshot.library.artifacts.find((artifact) => artifact.metadata.id === adopted.artifact.id)?.metadata).toMatchObject({
      kind: 'mcp',
      targets: ['codex'],
    });
  });

  test('sanitizes prototype-named provider MCP environment keys without leaking values', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const providerConfig = path.join(currentProviderHome ?? '', '.codex', 'config.toml');
    await mkdir(path.dirname(providerConfig), { recursive: true });
    await writeFile(providerConfig, [
      '[mcp_servers.local-tools]',
      'command = "node"',
      '',
      '[mcp_servers.local-tools.env]',
      '__proto__ = "provider-prototype-secret"',
      '',
    ].join('\n'));

    const preview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'mcp', name: 'local-tools', destination: 'shared', targets: ['codex'] },
    })).data as { blocked: boolean; contentText: string };

    expect(JSON.stringify(preview)).not.toContain('provider-prototype-secret');
    expect(preview.contentText).toContain('"__proto__"');
    expect(preview.blocked).toBe(true);
  });

  test('blocks provider MCP adoption when credential-like command arguments would enter canonical content', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const providerConfig = path.join(currentProviderHome ?? '', '.codex', 'config.toml');
    await mkdir(path.dirname(providerConfig), { recursive: true });
    await writeFile(providerConfig, [
      '[mcp_servers.token-tools]',
      'command = "node"',
      'args = ["server.js", "--access-token", "provider-argument-canary"]',
      '',
    ].join('\n'));

    const preview = (await app.execute({
      operation: 'provider.source.preview',
      input: { provider: 'codex', content: 'mcp', name: 'token-tools', destination: 'shared', targets: ['codex'] },
    })).data as {
      digest: string;
      blocked: boolean;
      contentText: string;
      issues: Array<{ code: string }>;
    };

    expect(JSON.stringify(preview)).not.toContain('provider-argument-canary');
    expect(preview.contentText).toContain('<redacted:argument>');
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'mcp-credential-argument-redacted' }));
    expect(preview.blocked).toBe(true);
    await expect(app.execute({
      operation: 'provider.source.adopt',
      input: {
        provider: 'codex',
        content: 'mcp',
        name: 'token-tools',
        destination: 'shared',
        targets: ['codex'],
        previewDigest: preview.digest,
      },
    })).rejects.toThrow('Credential-like command arguments were not imported');
    expect(await Bun.file(path.join(home, 'mcp', 'servers.json')).exists()).toBe(false);
  });

  test('reports an expired pending sync connection without contacting its server', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    await saveSyncV2State({
      version: 2,
      phase: 'pending',
      method: 'pair',
      serverUrl: 'https://sync.example.test',
      credentialId: 'pending-test-credential',
      request: {
        requestId: 'expired-request',
        code: 'EXPIRED1',
        deviceId: 'pending-device',
        deviceName: 'Expired device',
        agreementPublicKey: 'agreement-public-key',
        signingPublicKey: 'signing-public-key',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    }, home);

    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const compatibility = await app.execute({ operation: 'sync.snapshot', input: {} });

    expect(snapshot.settings.sync).toEqual({
      enabled: false,
      phase: 'pending',
      state: 'expired',
      conflictCount: 0,
      conflicts: [],
      pending: {
        method: 'pair',
        deviceName: 'Expired device',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(snapshot.diagnostics).toMatchObject({
      healthy: false,
      issues: [expect.objectContaining({ code: 'sync-connection-expired' })],
    });
    expect(compatibility.data).toMatchObject({
      phase: 'pending',
      compatibility: 'unknown',
      pending: { status: 'expired', code: 'EXPIRED1' },
    });
  });

  test('lists resolvable sync conflicts and preserves the last failed run', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const syncState = newActiveSyncV2State({
      serverUrl: 'https://127.0.0.1:1',
      vaultId: 'vault-id',
      deviceId: 'device-id',
      deviceName: 'MacBook',
      keyEpoch: 1,
      credentialId: 'credential-id',
    });
    const remoteContent = '# Encrypted remote\n';
    await writeFile(path.join(home, 'rules', '00-general.conflict-MacBook.md'), remoteContent);
    syncState.files['rules/00-general.md'] = {
      objectId: 'object-id',
      revision: 2,
      hash: sha256String(remoteContent),
      conflicted: true,
    };
    syncState.lastError = { occurredAt: '2026-08-19T12:00:00.000Z', message: 'Server temporarily unavailable.' };
    await saveSyncV2State(syncState, home);

    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;
    const compatibility = await app.execute({ operation: 'sync.snapshot', input: {} });
    const conflictPreview = await app.execute({
      operation: 'sync.conflict.preview',
      input: { path: 'rules/00-general.md' },
    });

    expect(snapshot.settings.sync).toMatchObject({
      enabled: true,
      phase: 'active',
      state: 'conflict',
      conflictCount: 1,
      conflicts: ['rules/00-general.md'],
      lastError: { message: 'Server temporarily unavailable.' },
    });
    expect(compatibility.data).toMatchObject({
      phase: 'connected',
      compatibility: 'unreachable',
      conflicts: ['rules/00-general.md'],
      lastError: { message: 'Server temporarily unavailable.' },
    });
    expect(isSyncConflictPreview(conflictPreview.data)).toBe(true);
    expect(conflictPreview.data).toMatchObject({
      path: 'rules/00-general.md',
      local: { state: 'text', content: '# General\n' },
      remote: { state: 'text', content: remoteContent },
    });
    expect(snapshot.diagnostics).toMatchObject({
      healthy: false,
      issues: [expect.objectContaining({ code: 'sync-conflicts' })],
    });
  });

  test('surfaces a failed sync run and rejects incomplete legacy configuration', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const syncState = newActiveSyncV2State({
      serverUrl: 'https://127.0.0.1:1',
      vaultId: 'vault-id',
      deviceId: 'device-id',
      deviceName: 'MacBook',
      keyEpoch: 1,
      credentialId: 'credential-id',
    });
    syncState.lastError = { occurredAt: '2026-08-19T12:00:00.000Z', message: 'Server temporarily unavailable.' };
    await saveSyncV2State(syncState, home);

    const snapshot = (await app.execute({ operation: 'snapshot', input: {} })).data as ManagerSnapshotV3;

    expect(snapshot.settings.sync).toMatchObject({
      enabled: true,
      state: 'error',
      conflicts: [],
      lastError: { message: 'Server temporarily unavailable.' },
    });
    expect(snapshot.diagnostics).toMatchObject({
      healthy: false,
      issues: [expect.objectContaining({
        code: 'sync-last-run-failed',
        message: 'Server temporarily unavailable.',
      })],
    });
    await expect(app.execute({
      operation: 'sync.configure',
      input: { serverUrl: 'https://sync.example.test' },
    })).rejects.toThrow('Start a new encrypted vault or connect this device with an invitation.');
  });

  test('keeps read/write sessions away from admin operations and admin-only snapshot data', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);

    await expect(app.execute(
      { operation: 'library.archive', input: { artifact: 'missing' } },
      { scope: 'read' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(app.execute(
      { operation: 'project.root.add', input: { path: home } },
      { scope: 'write' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(app.execute(
      { operation: 'secret.status', input: { id: 'TOKEN' } },
      { scope: 'write' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(app.execute(
      { operation: 'skill.inspect', input: { artifact: 'missing' } },
      { scope: 'write' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(app.execute(
      { operation: 'provider.source.preview', input: { provider: 'codex', content: 'rules', destination: 'provider' } },
      { scope: 'write' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(app.execute(
      { operation: 'recovery.list', input: {} },
      { scope: 'write' },
    )).rejects.toBeInstanceOf(ApplicationPermissionError);

    const snapshot = (await app.execute(
      { operation: 'snapshot', input: {} },
      { scope: 'write' },
    )).data as ManagerSnapshotV3;
    expect(snapshot.projectInbox).toBeUndefined();
    expect(snapshot.settings.sessions).toBeUndefined();
  });

  test('never returns a secret value through the application result', async () => {
    const { home } = await applicationWithLegacyRule();
    const store = new MemorySecretStore();
    const app = new RegletApplication({ home, secretStore: store });
    await app.execute({ operation: 'secret.set', input: { id: 'TOKEN', value: 'super-secret-value' } });
    const status = await app.execute({ operation: 'secret.status', input: { id: 'TOKEN' } });

    expect(status.data).toEqual({ id: 'TOKEN', bound: true });
    expect(JSON.stringify(status.data)).not.toContain('super-secret-value');
  });

  test('promotes scoped Cursor guidance to a skill without editing the project', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const project = await mkdtemp(path.join(tmpdir(), 'reglet-project-guidance-'));
    currentProjects.push(project);
    const sourcePath = path.join(project, '.cursor', 'rules', 'api.mdc');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const source = '---\nglobs: src/api/**\n---\n\nUse bounded API retries.\n';
    await writeFile(sourcePath, source);
    const root = await app.execute({ operation: 'project.root.add', input: { path: project, label: 'API project' } });
    await app.execute({ operation: 'project.scan', input: { rootId: (root.data as { id: string }).id } });
    const discoveries = (await app.execute({ operation: 'project.discoveries', input: {} })).data as Array<{ id: string; relativePath: string }>;
    const discovery = discoveries.find((candidate) => candidate.relativePath === '.cursor/rules/api.mdc');
    expect(discovery).toBeDefined();

    const preview = await app.execute({
      operation: 'project.promotion-preview',
      input: { discoveryId: discovery?.id ?? '' },
    });
    expect(preview.data).toMatchObject({ mode: 'convert-to-skill', kind: 'skill' });
    const promoted = await app.execute({
      operation: 'project.promote',
      input: { discoveryId: discovery?.id ?? '', targets: ['codex'] },
    });
    expect(promoted.data).toMatchObject({ mode: 'convert-to-skill', artifact: { kind: 'skill', targets: ['codex'] } });
    expect(await Bun.file(sourcePath).text()).toBe(source);
  });

  test('requires executable promotion confirmation for the exact inspected skill revision', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const project = await mkdtemp(path.join(tmpdir(), 'reglet-project-executable-skill-'));
    currentProjects.push(project);
    const skillRoot = path.join(project, '.agents', 'skills', 'reviewed-runner');
    const scriptPath = path.join(skillRoot, 'scripts', 'check.sh');
    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), [
      '---',
      'name: reviewed-runner',
      'description: Run a reviewed local check.',
      '---',
      '',
      '# Reviewed runner',
      '',
    ].join('\n'));
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n');
    await chmod(scriptPath, 0o755);
    const root = await app.execute({ operation: 'project.root.add', input: { path: project } });
    await app.execute({ operation: 'project.scan', input: { rootId: (root.data as { id: string }).id } });
    const discoveries = (await app.execute({ operation: 'project.discoveries', input: {} })).data as Array<{
      id: string;
      relativePath: string;
    }>;
    const discovery = discoveries.find((candidate) => candidate.relativePath === '.agents/skills/reviewed-runner');
    expect(discovery).toBeDefined();
    const preview = await app.execute({
      operation: 'project.promotion-preview',
      input: { discoveryId: discovery?.id ?? '' },
    });
    const inspection = (preview.data as { inspection: { revision: string } }).inspection;

    await expect(app.execute({
      operation: 'project.promote',
      input: { discoveryId: discovery?.id ?? '', targets: ['codex'] },
    })).rejects.toThrow('exact inspected revision');

    await writeFile(scriptPath, '#!/bin/sh\nexit 1\n');
    await expect(app.execute({
      operation: 'project.promote',
      input: {
        discoveryId: discovery?.id ?? '',
        targets: ['codex'],
        confirmedExecutableRevision: inspection.revision,
      },
    })).rejects.toThrow('exact inspected revision');

    const refreshedPreview = await app.execute({
      operation: 'project.promotion-preview',
      input: { discoveryId: discovery?.id ?? '' },
    });
    const refreshedInspection = (refreshedPreview.data as { inspection: { revision: string } }).inspection;
    const promoted = await app.execute({
      operation: 'project.promote',
      input: {
        discoveryId: discovery?.id ?? '',
        targets: ['codex'],
        confirmedExecutableRevision: refreshedInspection.revision,
      },
    });
    expect(promoted.data).toMatchObject({ artifact: { kind: 'skill', targets: ['codex'] } });
  });

  test('extracts project MCP paths and credential literals into local overrides and unbound references', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const project = await mkdtemp(path.join(tmpdir(), 'reglet-project-mcp-'));
    currentProjects.push(project);
    const sourcePath = path.join(project, '.mcp.json');
    const rawCredential = 'credential-must-not-leak';
    await writeFile(sourcePath, JSON.stringify({
      mcpServers: {
        local: {
          command: path.join(project, 'bin', 'server'),
          args: ['--stdio'],
          env: { TOKEN: rawCredential },
        },
      },
    }));
    const root = await app.execute({ operation: 'project.root.add', input: { path: project } });
    await app.execute({ operation: 'project.scan', input: { rootId: (root.data as { id: string }).id } });
    const discoveries = (await app.execute({ operation: 'project.discoveries', input: {} })).data as Array<{ id: string; relativePath: string }>;
    const discovery = discoveries.find((candidate) => candidate.relativePath === '.mcp.json');
    const preview = await app.execute({
      operation: 'project.promotion-preview',
      input: { discoveryId: discovery?.id ?? '' },
    });
    expect(JSON.stringify(preview.data)).not.toContain(rawCredential);

    const promoted = await app.execute({
      operation: 'project.promote',
      input: { discoveryId: discovery?.id ?? '', targets: ['codex'], serverName: 'local' },
    });
    const artifact = (promoted.data as { artifact: { id: string } }).artifact;
    const shown = await app.execute({ operation: 'library.show', input: { artifact: artifact.id } });
    const shownData = shown.data as { content: string };
    const promotedDefinition = JSON.parse(shownData.content) as {
      command: string;
      env: Record<string, { source: string }>;
    };
    expect(promotedDefinition.env.TOKEN?.source).toBe('keychain');
    expect(promotedDefinition.command).toBe('reglet://machine-override/command');
    expect(JSON.stringify(shown.data)).not.toContain(rawCredential);
    expect(JSON.stringify(shown.data)).not.toContain(project);
  });

  test('blocks executable skill projection until trust matches the exact content revision', async () => {
    const { app, home } = await applicationWithLegacyRule();
    await migrate(app);
    const created = await app.execute({ operation: 'library.create', input: {
      kind: 'skill',
      slug: 'reviewed-runner',
      title: 'Reviewed runner',
      content: '---\nname: reviewed-runner\ndescription: Run a reviewed local check.\n---\n\n# Runner\n',
      targets: ['codex'],
    } });
    const artifact = created.data as { id: string };
    const executable = path.join(home, 'skills', 'reviewed-runner', 'scripts', 'check.sh');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);

    const blocked = await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    expect(blocked.data).toMatchObject({ review: { units: [{ status: 'blocked' }] } });
    const inspection = await app.execute({ operation: 'skill.inspect', input: { artifact: artifact.id } });
    const reviewedRevision = (inspection.data as { revision: string }).revision;
    await app.execute({ operation: 'skill.trust', input: { artifact: artifact.id, revision: reviewedRevision, confirmed: true } });
    const ready = await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    expect(ready.data).toMatchObject({ review: { units: [{ status: 'ready' }] } });

    await writeFile(executable, '#!/bin/sh\nexit 1\n');
    const changed = await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    expect(changed.data).toMatchObject({ review: { units: [{ status: 'blocked' }] } });
    await expect(app.execute({ operation: 'skill.trust', input: { artifact: artifact.id, revision: reviewedRevision, confirmed: true } }))
      .rejects.toThrow('This skill changed after it was reviewed.');
  });

  test('keeps typical preview and valid autosave operations within the platform latency budget after warmup', async () => {
    const { app } = await applicationWithLegacyRule();
    await migrate(app);
    const created = await app.execute({ operation: 'library.create', input: {
      kind: 'instruction', slug: 'latency-check', title: 'Latency check', content: '# Latency\n', targets: ['codex'],
    } });
    const artifact = created.data as { id: string };
    await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });

    const previewStartedAt = performance.now();
    await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    const previewElapsedMs = performance.now() - previewStartedAt;
    const saveStartedAt = performance.now();
    await app.execute({ operation: 'library.save', input: { artifact: artifact.id, content: '# Latency\n\nUpdated.\n' } });
    const saveElapsedMs = performance.now() - saveStartedAt;

    const latencyBudgetMs = process.platform === 'win32' ? 300 : 150;
    expect(previewElapsedMs).toBeLessThan(latencyBudgetMs);
    expect(saveElapsedMs).toBeLessThan(latencyBudgetMs);
  });
});
