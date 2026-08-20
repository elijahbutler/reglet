import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  applyAll, createSkill, deleteMcpServer, listManagedSkillTrees, listMcpServers, readMcpServer, readSkillFile,
  applyStructuredPreview, initMasterDir, loadConfig, previewApplyStructured, renameSkill, renameSkillFile, saveConfig,
  listEffectiveMcpServers, providerMcpScope, renameMcpServerDisplayName, serializeMcpServers, upsertMcpServer,
  validateMcpServer, writeSkillFile,
} from '../src/index.js';

let home = '';
let providerHome = '';
afterEach(async () => {
  if (home !== '') await rm(home, { recursive: true, force: true });
  if (providerHome !== '') await rm(providerHome, { recursive: true, force: true });
  home = ''; providerHome = ''; delete process.env.REGLET_PROVIDER_HOME; delete process.env.REGLET_TEST_TOKEN;
});
async function setup(): Promise<string> { home = await mkdtemp(path.join(tmpdir(), 'reglet-native-edit-')); return home; }

describe('native skill editing', () => {
  test('round trips shared files and preserves provider scope on rename', async () => {
    const root = await setup();
    await createSkill({ kind: 'shared' }, 'review', '---\nname: review\n---\n# Review\n', root);
    await writeSkillFile({ kind: 'shared' }, 'review', 'assets/note.txt', 'hello', root);
    await renameSkillFile({ kind: 'shared' }, 'review', 'assets/note.txt', 'references/note.txt', root);
    expect((await readSkillFile({ kind: 'shared' }, 'review', 'references/note.txt', root)).content).toBe('hello');
    expect((await listManagedSkillTrees(root))[0]?.files.map((file) => file.path)).toEqual(['references/note.txt', 'SKILL.md']);
    await renameSkill({ kind: 'shared' }, 'review', 'review-v2', root);
    expect((await listManagedSkillTrees(root))[0]?.name).toBe('review-v2');
  });

  test('rejects traversal, provider collisions, malformed frontmatter, and symlinks', async () => {
    const root = await setup();
    await createSkill({ kind: 'shared' }, 'review', '# Review\n', root);
    await expect(writeSkillFile({ kind: 'shared' }, 'review', '../outside', 'bad', root)).rejects.toThrow('Traversal');
    await expect(createSkill({ kind: 'shared' }, 'claude', '# Bad\n', root)).rejects.toThrow('provider namespace');
    await expect(writeSkillFile({ kind: 'shared' }, 'review', 'SKILL.md', '---\nname: bad', root)).rejects.toThrow('frontmatter');
    await writeFile(path.join(root, 'outside'), 'secret');
    await symlink(path.join(root, 'outside'), path.join(root, 'skills', 'review', 'linked'));
    await expect(readSkillFile({ kind: 'shared' }, 'review', 'linked', root)).rejects.toThrow('Symlink');
  });
});

describe('native MCP editing', () => {
  test('validates transports and writes deterministic definitions', async () => {
    const root = await setup();
    expect(validateMcpServer('bad', { command: 'node', url: 'https://example.test' }).ok).toBe(false);
    expect(validateMcpServer('remote', { url: 'file:///tmp/socket' }).ok).toBe(false);
    expect(validateMcpServer('absolute', { command: '/Users/example/.local/bin/branchforge' }).ok).toBe(true);
    await upsertMcpServer('zeta', { url: 'https://example.test' }, root);
    await expect(validateMcpServer('raw', { command: 'node', env: { TOKEN: 'secret' } }).issues).toContain(
      'env.TOKEN must be a process-env reference, not a raw string',
    );
    await upsertMcpServer('alpha', {
      command: 'node',
      env: { Z: { source: 'process-env', name: 'REGLET_TEST_TOKEN' }, A: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } },
    }, root);
    expect((await listMcpServers(root)).servers.map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
    expect(await readFile(path.join(root, 'mcp', 'servers.json'), 'utf8')).toBe(serializeMcpServers({
      alpha: {
        command: 'node',
        env: {
          A: { source: 'process-env', name: 'REGLET_TEST_TOKEN' },
          Z: { source: 'process-env', name: 'REGLET_TEST_TOKEN' },
        },
      },
      zeta: { url: 'https://example.test' },
    }));
    await deleteMcpServer('alpha', root);
    expect((await listMcpServers(root)).servers.map((entry) => entry.name)).toEqual(['zeta']);
  });

  test('rejects raw legacy environment values without exposing or copying them', async () => {
    const root = await setup();
    await initMasterDir(root);
    const serversPath = path.join(root, 'mcp', 'servers.json');
    await writeFile(serversPath, JSON.stringify({
      mcpServers: {
        legacy: { command: 'node', env: { TOKEN: 'super-secret' } },
      },
    }));

    const listed = await listMcpServers(root);
    expect(listed.servers[0]?.issues).toContain('env.TOKEN must be a process-env reference, not a raw string');
    expect(JSON.stringify(listed)).not.toContain('super-secret');
    expect(JSON.stringify(await readMcpServer('legacy', root))).not.toContain('super-secret');
    await expect(upsertMcpServer('new-server', { command: 'node' }, root)).rejects.toThrow('Invalid MCP server legacy');
    await expect(applyAll({ contents: ['mcp'], home: root })).rejects.toThrow('Invalid MCP configuration');

    await deleteMcpServer('legacy', root);
    expect((await listMcpServers(root)).servers).toEqual([]);
  });

  test('keeps stable ids across provider overrides, display renames, and deletes without rewriting legacy shared data', async () => {
    const root = await setup();
    await initMasterDir(root);
    const sharedPath = path.join(root, 'mcp', 'servers.json');
    const legacy = '{"mcpServers":{"stable":{"command":"node"},"shared-only":{"command":"ruby"}}}\n';
    await writeFile(sharedPath, legacy);

    await upsertMcpServer('stable', { command: 'python' }, providerMcpScope('claude'), root, 'claude-name');
    await upsertMcpServer('provider-only', { command: 'deno' }, providerMcpScope('claude'), root, 'provider-name');

    const shared = await listMcpServers(root);
    const scoped = await listMcpServers(providerMcpScope('claude'), root);
    expect(shared.servers.find((entry) => entry.id === 'stable')?.affectedProviders).not.toContain('claude');
    expect(shared.servers.find((entry) => entry.id === 'stable')?.affectedProviders).toContain('codex');
    expect(scoped.servers.find((entry) => entry.id === 'stable')?.overrideOf).toBe('stable');
    expect(scoped.servers.find((entry) => entry.id === 'provider-only')?.overrideOf).toBeNull();
    expect(await readFile(sharedPath, 'utf8')).toBe(legacy);

    await renameMcpServerDisplayName('stable', 'renamed-output', providerMcpScope('claude'), root);
    expect((await listEffectiveMcpServers('claude', root)).find((entry) => entry.id === 'stable'))
      .toMatchObject({ displayName: 'renamed-output', overrideOf: 'stable' });
    await deleteMcpServer('stable', providerMcpScope('claude'), root);
    expect((await listEffectiveMcpServers('claude', root)).find((entry) => entry.id === 'stable'))
      .toMatchObject({ displayName: 'stable', scope: { kind: 'shared' }, overrideOf: null });
  });

  test('does not let an invalid unselected provider scope block preview', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = true;
    await saveConfig(config, root);
    await upsertMcpServer('shared', { command: 'node' }, root);
    const codexScope = path.join(root, 'mcp', 'providers', 'codex');
    await Bun.write(path.join(codexScope, 'servers.json'), '{"mcpServers":{"bad":{"command":"node","env":{"TOKEN":"provider-secret"}}}}\n');

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(preview.validationIssues).toEqual([]);
    expect(preview.entries[0]?.operation).toBe('write');
    expect(JSON.stringify(preview)).not.toContain('provider-secret');
  });

  test('redacts raw legacy MCP values from a blocked structured preview', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.claude.enabled = true;
    await saveConfig(config, root);
    await writeFile(
      path.join(root, 'mcp', 'servers.json'),
      '{"mcpServers":{"legacy":{"command":"node","env":{"TOKEN":"raw-preview-secret"}}}}\n',
    );
    await writeFile(
      path.join(providerHome, '.claude.json'),
      '{"mcpServers":{"legacy":{"command":"node","env":{"TOKEN":"raw-preview-secret"}}}}\n',
    );

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(preview.validationIssues).toContain('mcp/legacy: env.TOKEN must be a process-env reference, not a raw string');
    expect(JSON.stringify(preview)).not.toContain('raw-preview-secret');
  });

  test('renders exact redacted provider output and rejects a stale digest', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = true;
    await saveConfig(config, root);
    process.env.REGLET_TEST_TOKEN = 'super-secret';
    await upsertMcpServer('managed', {
      command: 'node',
      env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } },
    }, root);
    const output = path.join(providerHome, '.claude.json');
    await writeFile(output, '{"theme":"dark","mcpServers":{"local":{"command":"ruby"}}}\n');

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(preview.entries[0]?.diff).toContain('"theme": "dark"');
    expect(preview.entries[0]?.diff).toContain('<redacted:TOKEN>');
    expect(preview.entries[0]?.diff).not.toContain('super-secret');
    expect(preview.entries[0]?.expectedTargetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.entries[0]?.resultingTargetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.entries[0]?.driftStatus).toBe('unmanaged');
    expect(preview.entries[0]?.snapshot).toMatchObject({
      behavior: 'snapshot-before-write',
      location: expect.stringContaining('<receipt-id>'),
    });

    await writeFile(
      output,
      '{"mcpServers":{"managed":{"command":"node","env":{"TOKEN":"provider-secret-one"}}}}\n',
    );
    const changedProviderSecret = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    await writeFile(
      output,
      '{"mcpServers":{"managed":{"command":"node","env":{"TOKEN":"provider-secret-two"}}}}\n',
    );
    const rotatedProviderSecret = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(rotatedProviderSecret.digest).not.toBe(changedProviderSecret.digest);
    expect(JSON.stringify(rotatedProviderSecret)).not.toContain('provider-secret-two');

    const sameFilesNewEnv = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    process.env.REGLET_TEST_TOKEN = 'rotated-secret';
    const changedEnv = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(changedEnv.digest).not.toBe(sameFilesNewEnv.digest);
    expect(JSON.stringify(changedEnv)).not.toContain('rotated-secret');

    await writeFile(output, '{"theme":"light","mcpServers":{}}\n');
    await expect(applyStructuredPreview(preview.digest, { providers: ['claude'], contents: ['mcp'], home: root, providerHome }))
      .rejects.toThrow('stale');
  });

  test('redacts credential-like command arguments from JSON and TOML provider previews', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.codex.enabled = true;
    config.providers.codex.mcp = true;
    await saveConfig(config, root);
    await upsertMcpServer('managed', {
      command: 'node',
      args: [
        '--access-token',
        'canonical-cli-canary',
        '--header',
        'Authorization: Bearer canonical-header-canary',
        '--api-key=canonical-inline-canary',
      ],
    }, root);
    const output = path.join(providerHome, '.codex', 'config.toml');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, [
      '[mcp_servers.managed]',
      'command = "node"',
      'args = ["--access-token", "provider-cli-canary", "--header", "Authorization: Bearer provider-header-canary"]',
      '',
    ].join('\n'));

    const preview = await previewApplyStructured({ providers: ['codex'], contents: ['mcp'], home: root, providerHome });
    const serialized = JSON.stringify(preview);
    expect(serialized).toContain('<redacted:argument>');
    expect(serialized).not.toContain('canonical-cli-canary');
    expect(serialized).not.toContain('canonical-header-canary');
    expect(serialized).not.toContain('canonical-inline-canary');
    expect(serialized).not.toContain('provider-cli-canary');
    expect(serialized).not.toContain('provider-header-canary');
  });

  test('rejects missing process env references before writing providers', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = true;
    await saveConfig(config, root);
    await upsertMcpServer('managed', {
      command: 'node',
      env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } },
    }, root);

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root, providerHome });
    expect(preview.validationIssues).toContain('Missing process environment for MCP server managed: TOKEN:REGLET_TEST_TOKEN');
    expect(preview.entries[0]).toMatchObject({ operation: 'skip', after: 'claude:mcp blocked by validation' });
    await expect(applyStructuredPreview('unused', { providers: ['claude'], contents: ['mcp'], home: root, providerHome }))
      .rejects.toThrow('Missing process environment');
    expect(await Bun.file(path.join(providerHome, '.claude.json')).exists()).toBe(false);
  });

  test('isolates concurrent MCP previews across provider homes', async () => {
    const roots = await Promise.all([
      mkdtemp(path.join(tmpdir(), 'reglet-native-parallel-a-')),
      mkdtemp(path.join(tmpdir(), 'reglet-native-parallel-b-')),
    ]);
    const providerRoots = await Promise.all([
      mkdtemp(path.join(tmpdir(), 'reglet-provider-parallel-a-')),
      mkdtemp(path.join(tmpdir(), 'reglet-provider-parallel-b-')),
    ]);
    try {
      await Promise.all(roots.map(async (root, index) => {
        await initMasterDir(root);
        const config = await loadConfig(root);
        config.providers.claude.enabled = true;
        config.providers.claude.mcp = true;
        await saveConfig(config, root);
        await upsertMcpServer('managed', { command: 'node' }, root);
        await writeFile(
          path.join(providerRoots[index]!, '.claude.json'),
          JSON.stringify({ theme: index === 0 ? 'dark' : 'light', mcpServers: {} }),
        );
      }));

      const previews = await Promise.all(roots.map((root, index) => previewApplyStructured({
        providers: ['claude'],
        contents: ['mcp'],
        home: root,
        providerHome: providerRoots[index],
      })));

      expect(previews[0]?.entries[0]?.diff).toContain('"theme": "dark"');
      expect(previews[1]?.entries[0]?.diff).toContain('"theme": "light"');
    } finally {
      await Promise.all([...roots, ...providerRoots].map((directory) => rm(directory, { recursive: true, force: true })));
    }
  });
});
