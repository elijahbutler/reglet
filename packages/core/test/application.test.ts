import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  ApplicationPermissionError,
  type ManagerSnapshot,
  RegletApplication,
  RevisionConflictError,
} from '../src/application/service.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { LocalState } from '../src/state/database.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function useApplication(): Promise<RegletApplication> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-application-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = path.join(currentHome, 'providers');
  return new RegletApplication(currentHome);
}

describe('application command layer', () => {
  test('does not advance revisions or activity for sensitive read commands', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const before = await application.execute({ type: 'activity.list' });

    const snapshot = await application.execute({ type: 'manager.snapshot' });
    const diagnostics = await application.execute({ type: 'diagnostics' });
    const after = await application.execute({ type: 'activity.list' });

    expect(snapshot.changed).toBe(false);
    expect(diagnostics.changed).toBe(false);
    expect(snapshot.revision).toBe(before.revision);
    expect(diagnostics.revision).toBe(before.revision);
    expect(after.data).toEqual(before.data);
  });

  test('serializes mutations and enforces optimistic revisions', async () => {
    const application = await useApplication();
    const initialized = await application.execute({ type: 'initialize' });
    const created = await application.execute(
      {
        type: 'library.create',
        kind: 'instruction',
        slug: 'shared',
        title: 'Shared',
        content: '# Shared\n',
      },
      { expectedRevision: initialized.revision },
    );

    expect(created.revision).toBe(initialized.revision + 1);
    await expect(
      application.execute(
        {
          type: 'library.archive',
          artifact: 'shared',
        },
        { expectedRevision: initialized.revision },
      ),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  test('preserves invalid edits as drafts instead of canonical content', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    await application.execute({
      type: 'library.create',
      kind: 'skill',
      slug: 'review-code',
      title: 'Review code',
      content:
        '---\nname: review-code\ndescription: Review source code\n---\n# Review\n',
    });
    const result = await application.execute({
      type: 'library.save',
      artifact: 'review-code',
      content: '---\nname: wrong\n---\n',
    });
    const shown = await application.execute({
      type: 'library.show',
      artifact: 'review-code',
    });

    expect(result.data).toMatchObject({ saved: false });
    expect(JSON.stringify(shown.data)).toContain('name: review-code');
  });

  test('returns portable and provider compatibility validation with artifact details', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    await application.execute({
      type: 'library.create',
      kind: 'skill',
      slug: 'release-check',
      title: 'Release check',
      targets: ['codex'],
      content:
        '---\nname: release-check\ndescription: Review a release\nlicense: MIT\n---\n# Release check\n',
    });

    const shown = await application.execute({
      type: 'library.show',
      artifact: 'release-check',
    });

    expect(shown.data).toMatchObject({
      validation: {
        valid: true,
        issues: [],
        compatibility: [
          {
            provider: 'codex',
            supported: true,
            canProject: true,
            issues: [
              {
                code: 'lossy-conversion',
                severity: 'warning',
              },
            ],
          },
        ],
      },
    });
  });

  test('previews exact instruction output and redacts observed MCP secrets', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    await application.execute({
      type: 'library.create',
      kind: 'instruction',
      slug: 'preview-rule',
      title: 'Preview rule',
      targets: ['codex'],
      content: '# Preview rule\n\nKeep the output reviewable.\n',
    });
    const codexPreview = await application.execute({
      type: 'providers.preview',
      artifact: 'preview-rule',
      provider: 'codex',
    });
    expect(codexPreview.data).toMatchObject({
      format: 'text',
      exact: true,
      redacted: false,
    });
    expect(JSON.stringify(codexPreview.data)).toContain('Keep the output reviewable.');

    await application.execute({
      type: 'library.create',
      kind: 'mcp',
      slug: 'private-server',
      title: 'Private server',
      targets: ['cursor'],
      content: JSON.stringify({
        transport: 'stdio',
        command: 'server',
        args: [],
        env: {},
        secretEnv: {
          API_TOKEN: { id: 'private-token', required: true },
        },
      }),
    });
    const providerMcpPath = path.join(
      process.env.REGLET_PROVIDER_HOME ?? '',
      '.cursor',
      'mcp.json',
    );
    await mkdir(path.dirname(providerMcpPath), { recursive: true });
    await writeFile(
      providerMcpPath,
      JSON.stringify({
        mcpServers: {
          'private-server': {
            command: 'server',
            env: { API_TOKEN: 'must-never-leak' },
          },
        },
      }),
    );
    const mcpPreview = await application.execute({
      type: 'providers.preview',
      artifact: 'private-server',
      provider: 'cursor',
    });
    expect(mcpPreview.data).toMatchObject({
      format: 'structural',
      exact: false,
      redacted: true,
    });
    expect(JSON.stringify(mcpPreview.data)).not.toContain('must-never-leak');
    expect((mcpPreview.data as { observed: string }).observed).toContain(
      '"bound": true',
    );
    expect((mcpPreview.data as { desired: string }).desired).toContain(
      '"reference": "private-token"',
    );
  });

  test('invalidates executable skill trust when its content changes', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const created = await application.execute({
      type: 'library.create',
      kind: 'skill',
      slug: 'trusted-check',
      title: 'Trusted check',
      targets: ['claude'],
      content:
        '---\nname: trusted-check\ndescription: Run a reviewed check\n---\n# Trusted check\n',
    });
    const artifact = created.data as { id: string };
    const scriptPath = path.join(
      currentHome ?? '',
      'skills',
      'trusted-check',
      'scripts',
      'check.sh',
    );
    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n');
    await chmod(scriptPath, 0o755);
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, currentHome);

    const initiallyBlocked = await application.execute({
      type: 'providers.apply',
      providers: ['claude'],
      contents: ['skills'],
    });
    expect(initiallyBlocked.data).toMatchObject({
      results: [{ status: 'blocked' }],
    });

    await application.execute({
      type: 'library.trust-skill',
      artifact: artifact.id,
      confirmed: true,
    });
    const applied = await application.execute({
      type: 'providers.apply',
      providers: ['claude'],
      contents: ['skills'],
    });
    expect(applied.data).toMatchObject({
      results: [{ status: 'written' }],
    });

    await writeFile(scriptPath, '#!/bin/sh\nexit 1\n');
    const changed = await application.execute({
      type: 'providers.apply',
      providers: ['claude'],
      contents: ['skills'],
    });
    expect(changed.data).toMatchObject({
      results: [
        {
          status: 'blocked',
          message: expect.stringContaining('changed after trust approval'),
        },
      ],
    });
  });

  test('lets write sessions use a sanitized manager without admin data', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    await application.execute({
      type: 'project.root.add',
      path: '/tmp/project',
    });

    await expect(
      application.execute(
        {
          type: 'project.root.add',
          path: '/tmp/project',
        },
        { scope: 'write' },
      ),
    ).rejects.toBeInstanceOf(ApplicationPermissionError);
    await expect(
      application.execute(
        { type: 'project.root.list' },
        { scope: 'write' },
      ),
    ).rejects.toBeInstanceOf(ApplicationPermissionError);
    const snapshot = await application.execute(
      { type: 'manager.snapshot' },
      { scope: 'write' },
    );
    expect(snapshot.data).toMatchObject({
      projectRoots: [],
      discoveries: [],
      sessions: [],
      remote: { endpoint: undefined },
      sync: { serverUrl: undefined },
    });
  });

  test('keeps diagnostic exports metadata-only', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    await application.execute({
      type: 'library.create',
      kind: 'instruction',
      slug: 'private-body',
      title: 'Private body',
      content: '# artifact-body-must-not-leak\n',
    });
    await application.execute({
      type: 'project.root.add',
      path: path.join(currentHome ?? '', 'private-project-path'),
    });

    const diagnostics = await application.execute({ type: 'diagnostics' });
    const exported = JSON.stringify(diagnostics.data);

    expect(exported).not.toContain('artifact-body-must-not-leak');
    expect(exported).not.toContain('private-project-path');
    expect(diagnostics.data).toMatchObject({
      projectRoots: { count: 1, pathsIncluded: false },
      secretsIncluded: false,
      authorizationIncluded: false,
    });
  });

  test('builds a manager snapshot from exact dry-run projection hashes', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, currentHome);
    const created = await application.execute({
      type: 'library.create',
      kind: 'instruction',
      slug: 'snapshot-rule',
      title: 'Snapshot rule',
      content: '# Snapshot rule\n',
      targets: ['claude'],
    });

    const before = (await application.execute({
      type: 'manager.snapshot',
    })).data as ManagerSnapshot;
    const artifactId = (created.data as { id: string }).id;
    const beforeProjection = before.artifacts
      .find((entry) => entry.artifact.id === artifactId)
      ?.projections.find((projection) => projection.provider === 'claude');

    expect(beforeProjection).toMatchObject({
      status: 'pending',
      provider: 'claude',
    });
    expect(beforeProjection?.desiredHash).toHaveLength(64);

    await application.execute({
      type: 'providers.apply',
      providers: ['claude'],
      contents: ['rules'],
    });
    const after = (await application.execute({
      type: 'manager.snapshot',
    })).data as ManagerSnapshot;
    const afterProjection = after.artifacts
      .find((entry) => entry.artifact.id === artifactId)
      ?.projections.find((projection) => projection.provider === 'claude');
    expect(afterProjection).toMatchObject({
      status: 'applied',
      desiredHash: beforeProjection?.desiredHash,
      appliedHash: beforeProjection?.desiredHash,
      observedHash: beforeProjection?.desiredHash,
    });
  });

  test('scans configured roots through the shared command layer', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'project');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'AGENTS.md'), '# Guidance\n');
    await application.execute({
      type: 'project.root.add',
      path: project,
      label: 'Project',
    });
    await application.execute({ type: 'project.scan' });
    const result = await application.execute({ type: 'project.discoveries' });

    expect(JSON.stringify(result.data)).toContain(
      'codex","cursor","opencode","windsurf',
    );
  });

  test('previews and merges selected instruction hunks into a stable artifact', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const created = await application.execute({
      type: 'library.create',
      kind: 'instruction',
      slug: 'shared-review',
      title: 'Shared review',
      targets: ['codex'],
      content: '# Review\n\nKeep A.\n\nKeep B.\n',
    });
    const artifactId = (created.data as { id: string }).id;
    const project = path.join(currentHome!, 'promotion-project');
    await mkdir(path.join(project, '.cursor', 'rules'), { recursive: true });
    await writeFile(
      path.join(project, '.cursor', 'rules', 'review.mdc'),
      '# Review\n\nChange A.\n\nChange B.\n',
    );
    await application.execute({ type: 'project.root.add', path: project });
    await application.execute({ type: 'project.scan' });
    const discovery = (
      (
        await application.execute({ type: 'project.discoveries' })
      ).data as Array<{ id: string; relativePath: string }>
    ).find((item) => item.relativePath.endsWith('review.mdc'));
    if (discovery === undefined) throw new Error('Instruction discovery missing');

    const preview = await application.execute({
      type: 'project.promotion-preview',
      discoveryId: discovery.id,
      mode: 'global-instruction',
    });
    const candidates = (preview.data as {
      candidates: Array<{ artifact: { id: string }; hunks: Array<{ id: string }> }>;
    }).candidates;
    const comparison = candidates.find((item) => item.artifact.id === artifactId);
    expect(comparison?.hunks).toHaveLength(2);

    await application.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      mode: 'global-instruction',
      destinationArtifact: artifactId,
      selectedHunks: [comparison?.hunks[0]?.id ?? 'missing'],
    });
    const shown = (
      await application.execute({ type: 'library.show', artifact: artifactId })
    ).data as {
      artifact: { id: string; targets: string[] };
      content: string;
      history: unknown[];
    };
    expect(shown.artifact).toMatchObject({ id: artifactId, targets: ['codex'] });
    expect(shown.content).toBe('# Review\n\nChange A.\n\nKeep B.\n');
    expect(shown.history.length).toBeGreaterThan(0);
  });

  test('merges selected project skill files without replacing SKILL.md', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const created = await application.execute({
      type: 'library.create',
      kind: 'skill',
      slug: 'shared-skill',
      title: 'Shared skill',
      content:
        '---\nname: shared-skill\ndescription: Canonical guidance\n---\n# Canonical\n',
    });
    const artifactId = (created.data as { id: string }).id;
    const project = path.join(currentHome!, 'skill-promotion-project');
    const projectSkill = path.join(
      project,
      '.agents',
      'skills',
      'shared-skill',
    );
    await mkdir(projectSkill, { recursive: true });
    await writeFile(
      path.join(projectSkill, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Project guidance\n---\n# Project\n',
    );
    await writeFile(path.join(projectSkill, 'notes.md'), 'Reviewed project notes.\n');
    await application.execute({ type: 'project.root.add', path: project });
    await application.execute({ type: 'project.scan' });
    const discovery = (
      (
        await application.execute({ type: 'project.discoveries' })
      ).data as Array<{ id: string; kind: string }>
    ).find((item) => item.kind === 'skill');
    if (discovery === undefined) throw new Error('Skill discovery missing');

    const preview = await application.execute({
      type: 'project.promotion-preview',
      discoveryId: discovery.id,
    });
    expect(JSON.stringify(preview.data)).toContain('notes.md');
    await application.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      destinationArtifact: artifactId,
      selectedFiles: ['notes.md'],
    });
    const canonicalSkill = path.join(currentHome!, 'skills', 'shared-skill');
    expect(await readFile(path.join(canonicalSkill, 'notes.md'), 'utf8')).toBe(
      'Reviewed project notes.\n',
    );
    expect(await readFile(path.join(canonicalSkill, 'SKILL.md'), 'utf8')).toContain(
      '# Canonical',
    );
  });

  test('selects a named server from a multi-server project MCP file', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'multi-mcp-project');
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, '.mcp.json'),
      `${JSON.stringify({
        mcpServers: {
          first: { command: 'first-server' },
          second: { command: 'second-server', args: ['--safe'] },
        },
      })}\n`,
    );
    await application.execute({ type: 'project.root.add', path: project });
    await application.execute({ type: 'project.scan' });
    const discovery = (
      (
        await application.execute({ type: 'project.discoveries' })
      ).data as Array<{ id: string; kind: string }>
    ).find((item) => item.kind === 'mcp');
    if (discovery === undefined) throw new Error('MCP discovery missing');
    const preview = await application.execute({
      type: 'project.promotion-preview',
      discoveryId: discovery.id,
    });
    expect((preview.data as { servers: unknown[] }).servers).toHaveLength(2);
    const promoted = await application.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      serverName: 'second',
    });
    const artifact = (promoted.data as { artifact: { id: string } }).artifact;
    const shown = await application.execute({
      type: 'library.show',
      artifact: artifact.id,
    });
    expect(JSON.stringify(shown.data)).toContain('second-server');
    expect(JSON.stringify(shown.data)).not.toContain('first-server');
  });

  test('normalizes trusted Codex TOML project MCP layers', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'codex-mcp-project');
    await mkdir(path.join(project, '.codex'), { recursive: true });
    await writeFile(
      path.join(project, '.codex', 'config.toml'),
      `[mcp_servers.local_tools]\ncommand = "bun"\nargs = ["run", "server.ts"]\n\n[mcp_servers.local_tools.env]\nMODE = "safe"\nAPI_TOKEN = "must-not-enter-canonical"\n`,
    );
    await application.execute({ type: 'project.root.add', path: project });
    await application.execute({ type: 'project.scan' });
    const discovery = (
      (
        await application.execute({ type: 'project.discoveries' })
      ).data as Array<{ id: string; relativePath: string }>
    ).find((item) => item.relativePath === '.codex/config.toml');
    if (discovery === undefined) throw new Error('Codex MCP discovery missing');

    const preview = await application.execute({
      type: 'project.promotion-preview',
      discoveryId: discovery.id,
    });
    expect(JSON.stringify(preview.data)).toContain('local_tools');
    expect(JSON.stringify(preview.data)).not.toContain('must-not-enter-canonical');
    const promoted = await application.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      serverName: 'local_tools',
      targets: ['codex'],
    });
    const artifactId = (promoted.data as { artifact: { id: string } }).artifact.id;
    const shown = await application.execute({
      type: 'library.show',
      artifact: artifactId,
    });
    expect(shown.data).toMatchObject({
      validation: { valid: true },
    });
    const shownContent = JSON.parse(
      (shown.data as { content: string }).content,
    ) as { env: Record<string, string> };
    const serialized = JSON.stringify(shown.data);
    expect(serialized).toContain('local-tools-api-token');
    expect(shownContent.env.MODE).toBe('safe');
    expect(serialized).not.toContain('must-not-enter-canonical');
  });

  test('extracts project MCP absolute paths into machine-local overrides', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'project');
    await mkdir(path.join(project, '.cursor'), { recursive: true });
    const serverPath = path.join(project, 'tools', 'server.js');
    await writeFile(
      path.join(project, '.cursor', 'mcp.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            local: {
              command: serverPath,
              args: ['--project', project],
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const rootResult = await application.execute({
      type: 'project.root.add',
      path: project,
      label: 'Project',
    });
    await application.execute({ type: 'project.scan' });
    const discoveries = await application.execute({
      type: 'project.discoveries',
    });
    const discoveryList = discoveries.data as Array<{ id: string; kind: string }>;
    const mcpDiscovery = discoveryList.find((discovery) => discovery.kind === 'mcp');
    expect(mcpDiscovery).toBeDefined();
    if (mcpDiscovery === undefined) {
      throw new Error('MCP discovery missing');
    }

    const promoted = await application.execute({
      type: 'project.promote',
      discoveryId: mcpDiscovery.id,
      targets: ['claude'],
    });
    const promotedData = promoted.data as {
      artifact: { id: string };
      warnings: string[];
    };
    const shown = await application.execute({
      type: 'library.show',
      artifact: promotedData.artifact.id,
    });
    expect(JSON.stringify(shown.data)).toContain('reglet://machine-override/');
    expect(promotedData.warnings[0]).toContain('Extracted 2 project path overrides');

    const state = await LocalState.open(currentHome);
    expect(state.mcpMachineOverrides(promotedData.artifact.id)).toEqual([
      {
        artifactId: promotedData.artifact.id,
        fieldPath: 'args.1',
        value: project,
      },
      {
        artifactId: promotedData.artifact.id,
        fieldPath: 'command',
        value: serverPath,
      },
    ]);
    expect(state.getProjectRoot((rootResult.data as { id: string }).id)?.label).toBe(
      'Project',
    );
    state.close();

    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, currentHome);
    const applied = await application.execute({
      type: 'providers.apply',
      providers: ['claude'],
      contents: ['mcp'],
    });
    expect(JSON.stringify(applied.data)).not.toContain('reglet://machine-override/');
    const providerConfig = await readFile(
      path.join(currentHome, 'providers', '.claude.json'),
      'utf8',
    );
    expect(providerConfig).toContain(serverPath);
    expect(providerConfig).not.toContain('reglet://machine-override/');
  });

  test('extracts likely project MCP credentials into unbound keychain references', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'secret-project');
    await mkdir(path.join(project, '.cursor'), { recursive: true });
    await writeFile(
      path.join(project, '.cursor', 'mcp.json'),
      `${JSON.stringify({
        mcpServers: {
          privateApi: {
            command: 'private-api-server',
            env: {
              API_TOKEN: 'project-secret-must-not-enter-library',
              MODE: 'safe',
            },
          },
        },
      })}\n`,
    );
    await application.execute({
      type: 'project.root.add',
      path: project,
    });
    await application.execute({ type: 'project.scan' });
    const discoveries = (
      await application.execute({ type: 'project.discoveries' })
    ).data as Array<{ id: string; kind: string }>;
    const discovery = discoveries.find((item) => item.kind === 'mcp');
    if (discovery === undefined) {
      throw new Error('MCP discovery missing');
    }
    const secretSearch = await application.execute({
      type: 'search',
      query: 'project-secret-must-not-enter-library',
    });
    expect(secretSearch.data).toHaveLength(1);
    expect(JSON.stringify(secretSearch.data)).not.toContain(
      'project-secret-must-not-enter-library',
    );

    const promoted = await application.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      targets: ['cursor'],
    });
    const promotedData = promoted.data as {
      artifact: { id: string };
      warnings: string[];
    };
    const shown = await application.execute({
      type: 'library.show',
      artifact: promotedData.artifact.id,
    });
    const shownData = shown.data as { content: string };
    const serialized = JSON.stringify(shown.data);

    expect(serialized).not.toContain('project-secret-must-not-enter-library');
    expect(serialized).toContain('privateapi-api-token');
    expect(JSON.parse(shownData.content)).toMatchObject({
      env: { MODE: 'safe' },
    });
    expect(promotedData.warnings).toContain(
      'Converted 1 likely credential field to unbound keychain references.',
    );
  });

  test('preserves harmless unsupported MCP options as visible compatibility warnings', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const created = await application.execute({
      type: 'library.create',
      kind: 'mcp',
      slug: 'annotated-server',
      title: 'Annotated server',
      targets: ['cursor'],
      content: JSON.stringify({
        transport: 'stdio',
        command: 'annotated-server',
        args: [],
        env: {},
        secretEnv: {},
        notes: 'Provider adapters do not project this field.',
      }),
    });
    const artifactId = (created.data as { id: string }).id;
    const shown = await application.execute({
      type: 'library.show',
      artifact: artifactId,
    });
    const shownData = shown.data as {
      content: string;
      validation: { issues: Array<{ code: string; severity: string; field?: string }> };
    };

    expect(JSON.parse(shownData.content)).toMatchObject({
      notes: 'Provider adapters do not project this field.',
    });
    expect(shownData.validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-field',
        severity: 'warning',
        field: 'notes',
      }),
    );
  });

  test('blocks literal MCP secrets from entering canonical content', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });

    await expect(
      application.execute({
        type: 'library.create',
        kind: 'mcp',
        slug: 'unsafe-server',
        title: 'Unsafe server',
        content: JSON.stringify({
          transport: 'stdio',
          command: 'unsafe-server',
          args: [],
          env: { API_TOKEN: 'must-not-enter-canonical' },
          secretEnv: {},
        }),
      }),
    ).rejects.toThrow('must use a keychain reference');

    const library = await application.execute({ type: 'library.list' });
    expect(JSON.stringify(library.data)).not.toContain('must-not-enter-canonical');
  });

  test('blocks project MCP options whose removal changes behavior', async () => {
    const application = await useApplication();
    await application.execute({ type: 'initialize' });
    const project = path.join(currentHome!, 'unsafe-options-project');
    await mkdir(path.join(project, '.cursor'), { recursive: true });
    await writeFile(
      path.join(project, '.cursor', 'mcp.json'),
      `${JSON.stringify({
        mcpServers: {
          conditional: {
            command: 'conditional-server',
            disabled: true,
          },
        },
      })}\n`,
    );
    await application.execute({ type: 'project.root.add', path: project });
    await application.execute({ type: 'project.scan' });
    const discoveries = (
      await application.execute({ type: 'project.discoveries' })
    ).data as Array<{ id: string; kind: string }>;
    const discovery = discoveries.find((item) => item.kind === 'mcp');
    if (discovery === undefined) throw new Error('MCP discovery missing');

    await expect(
      application.execute({
        type: 'project.promotion-preview',
        discoveryId: discovery.id,
      }),
    ).rejects.toThrow('may alter security or behavior');
  });
});
