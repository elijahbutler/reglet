import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  defaultConfig,
  MemorySecretStore,
  saveConfig,
  type LibraryMigrationPreview,
} from '@reglet/core';
import { isManagerSnapshotV3, type ManagerSnapshotV3 } from '@reglet/manager-protocol';
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
  test('requires explicit migration approval and produces a strict Snapshot V3', async () => {
    const { app } = await applicationWithLegacyRule();

    await expect(app.execute({
      operation: 'library.create',
      input: { kind: 'instruction', slug: 'blocked', title: 'Blocked', content: '# Blocked' },
    })).rejects.toThrow('migration approval is required');

    const revision = await migrate(app);
    const snapshotResult = await app.execute({ operation: 'snapshot', input: {} });

    expect(revision).toBe(1);
    expect(isManagerSnapshotV3(snapshotResult.data)).toBe(true);
    expect((snapshotResult.data as ManagerSnapshotV3).library.migration.status).toBe('applied');
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
    expect(blocked.data).toMatchObject({ batch: { units: [{ status: 'blocked' }] } });
    await app.execute({ operation: 'skill.trust', input: { artifact: artifact.id, confirmed: true } });
    const ready = await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    expect(ready.data).toMatchObject({ batch: { units: [{ status: 'ready' }] } });

    await writeFile(executable, '#!/bin/sh\nexit 1\n');
    const changed = await app.execute({ operation: 'provider.preview', input: { artifact: artifact.id, provider: 'codex' } });
    expect(changed.data).toMatchObject({ batch: { units: [{ status: 'blocked' }] } });
  });

  test('keeps typical preview and valid autosave operations under 150ms after warmup', async () => {
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

    expect(previewElapsedMs).toBeLessThan(150);
    expect(saveElapsedMs).toBeLessThan(150);
  });
});
