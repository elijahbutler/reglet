import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig, type ProviderName } from '../src/config.js';
import { applyAll } from '../src/engine/apply.js';
import {
  purgeProviderBackups,
  restoreProviderOutputs,
} from '../src/engine/restore.js';
import { detectProjectionDrift } from '../src/engine/drift.js';
import { GENERATED_HEADER } from '../src/header.js';
import { loadManifest } from '../src/manifest.js';
import { getAdapter } from '../src/providers/registry.js';
import { MemorySecretStore } from '../src/security/secrets.js';

let currentHome: string | undefined;
let currentProviderHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  if (currentProviderHome !== undefined) {
    await rm(currentProviderHome, { recursive: true, force: true });
    currentProviderHome = undefined;
  }
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function useTempHomes(): Promise<{ home: string; providerHome: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-apply-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-apply-provider-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentProviderHome;
  return { home: currentHome, providerHome: currentProviderHome };
}

async function writeMasterRule(home: string): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await writeFile(path.join(home, 'rules', '00-general.md'), '# General\n\nBe concise.\n');
}

async function enableProviders(home: string, providers: ProviderName[]): Promise<void> {
  const config = defaultConfig();
  for (const provider of providers) {
    config.providers[provider].enabled = true;
  }
  await saveConfig(config, home);
}

describe('applyAll', () => {
  test('writes golden rules files for providers with rules support', async () => {
    const { home } = await useTempHomes();
    await writeMasterRule(home);
    const providers: ProviderName[] = ['claude', 'codex', 'gemini', 'windsurf', 'opencode', 'cursor'];
    await enableProviders(home, providers);

    const report = await applyAll({ providers, contents: ['rules'] });

    for (const provider of providers) {
      const adapter = getAdapter(provider);
      const rulesPath = adapter.rulesPath();
      if (rulesPath === null) {
        expect(report.results).toContainEqual({
          provider,
          content: 'rules',
          outputPath: '',
          status: 'skipped',
          message: `${provider}:rules unsupported`,
        });
        continue;
      }

      expect(await readFile(rulesPath, 'utf8')).toBe(
        `${GENERATED_HEADER.replace('<provider>', provider)}\n\n<!-- source: rules/00-general.md -->\n\n# General\n\nBe concise.\n`,
      );
    }
  });

  test('skips providers and content that are not enrolled', async () => {
    const { home } = await useTempHomes();
    await writeMasterRule(home);
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    config.providers.claude.rules = false;
    await saveConfig(config, home);

    const report = await applyAll({ providers: ['claude', 'gemini'], contents: ['rules'] });

    expect(report.results).toEqual([
      {
        provider: 'claude',
        content: 'rules',
        outputPath: '',
        status: 'skipped',
        message: 'claude:rules unenrolled',
      },
      {
        provider: 'gemini',
        content: 'rules',
        outputPath: '',
        status: 'skipped',
        message: 'gemini disabled',
      },
    ]);
  });

  test('backs up an existing output exactly once and no-ops unchanged applies', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);
    const claudeDir = path.join(providerHome, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'CLAUDE.md'), 'original\n');

    const first = await applyAll({ providers: ['claude'], contents: ['rules'] });
    const second = await applyAll({ providers: ['claude'], contents: ['rules'] });
    const manifest = await loadManifest(home);
    const output = manifest.outputs[path.join(claudeDir, 'CLAUDE.md')];
    const backupRoot = path.join(home, '.state', 'backups', 'claude');

    expect(first.results[0]?.status).toBe('written');
    expect(second.results[0]?.status).toBe('unchanged');
    expect(output?.backedUpTo).not.toBeNull();
    expect(await readFile(output?.backedUpTo ?? '', 'utf8')).toBe('original\n');
    expect((await readdir(backupRoot)).length).toBe(1);
  });

  test('adds, updates, and removes only managed skills', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['claude']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'alpha', 'assets'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'alpha v1');
    await writeFile(path.join(home, 'skills', 'alpha', 'assets', 'note.txt'), 'asset');
    const foreignSkillDir = path.join(providerHome, '.claude', 'skills', 'foreign');
    await mkdir(foreignSkillDir, { recursive: true });
    await writeFile(path.join(foreignSkillDir, 'SKILL.md'), 'do not touch');

    const first = await applyAll({ providers: ['claude'], contents: ['skills'] });
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'alpha v2');
    const second = await applyAll({ providers: ['claude'], contents: ['skills'] });
    await rm(path.join(home, 'skills', 'alpha'), { recursive: true, force: true });
    const third = await applyAll({ providers: ['claude'], contents: ['skills'] });

    expect(first.results[0]?.status).toBe('written');
    expect(second.results[0]?.status).toBe('written');
    expect(third.results.some((result) => result.status === 'written')).toBe(true);
    await expect(readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(foreignSkillDir, 'SKILL.md'), 'utf8')).toBe('do not touch');
  });

  test('merges claude and gemini mcp while preserving unmanaged keys', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['claude', 'gemini']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { regletServer: { command: 'node', args: ['server.js'] } } }, null, 2)}\n`,
    );
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ theme: 'dark', mcpServers: { userServer: { command: 'python' } } }, null, 2)}\n`,
    );
    await mkdir(path.join(providerHome, '.gemini'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.gemini', 'settings.json'),
      `${JSON.stringify({ selectedAuthType: 'oauth', mcpServers: { userServer: { url: 'https://example.test' } } }, null, 2)}\n`,
    );

    await applyAll({ providers: ['claude', 'gemini'], contents: ['mcp'] });
    await writeFile(path.join(home, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    await applyAll({ providers: ['claude', 'gemini'], contents: ['mcp'] });

    const claude = JSON.parse(await readFile(path.join(providerHome, '.claude.json'), 'utf8')) as unknown;
    const gemini = JSON.parse(await readFile(path.join(providerHome, '.gemini', 'settings.json'), 'utf8')) as unknown;

    expect(claude).toEqual({ theme: 'dark', mcpServers: { userServer: { command: 'python' } } });
    expect(gemini).toEqual({ selectedAuthType: 'oauth', mcpServers: { userServer: { url: 'https://example.test' } } });
  });

  test('renders and merges MCP for all launch providers', async () => {
    const { home, providerHome } = await useTempHomes();
    const providers: ProviderName[] = [
      'claude',
      'codex',
      'cursor',
      'gemini',
      'windsurf',
      'opencode',
    ];
    await enableProviders(home, providers);
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            local: {
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
              env: { MODE: 'safe' },
              secretEnv: {},
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(path.join(providerHome, '.codex'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.codex', 'config.toml'),
      '# keep this comment\n\n[features]\nweb_search = true\n\n[mcp_servers.user]\ncommand = "python"\n',
    );
    await mkdir(path.join(providerHome, '.cursor'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.cursor', 'mcp.json'),
      `${JSON.stringify({ mcpServers: { user: { command: 'python' } } }, null, 2)}\n`,
    );
    await mkdir(path.join(providerHome, '.codeium', 'windsurf'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.codeium', 'windsurf', 'mcp_config.json'),
      `${JSON.stringify({ mcpServers: { user: { command: 'python' } } }, null, 2)}\n`,
    );
    await mkdir(path.join(providerHome, '.config', 'opencode'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.config', 'opencode', 'opencode.json'),
      `${JSON.stringify({ theme: 'system', mcp: { user: { type: 'local', command: ['python'] } } }, null, 2)}\n`,
    );

    const report = await applyAll({ providers, contents: ['mcp'] });

    expect(report.results.every((result) => result.status === 'written')).toBe(true);
    const codex = await readFile(path.join(providerHome, '.codex', 'config.toml'), 'utf8');
    expect(codex).toContain('# keep this comment');
    expect(codex).toContain('[mcp_servers.user]');
    expect(codex).toContain('[mcp_servers.local]');
    expect(codex).toContain('[mcp_servers.local.env]');
    const opencode = JSON.parse(
      await readFile(
        path.join(providerHome, '.config', 'opencode', 'opencode.json'),
        'utf8',
      ),
    ) as { theme: string; mcp: Record<string, unknown> };
    expect(opencode.theme).toBe('system');
    expect(opencode.mcp.user).toBeDefined();
    expect(opencode.mcp.local).toEqual({
      type: 'local',
      command: ['node', 'server.js'],
      environment: { MODE: 'safe' },
    });
  });

  test('keeps four successful provider writes when two providers fail', async () => {
    const { home } = await useTempHomes();
    const providers: ProviderName[] = [
      'claude',
      'codex',
      'cursor',
      'gemini',
      'windsurf',
      'opencode',
    ];
    await enableProviders(home, providers);
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({
        mcpServers: {
          local: {
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: {},
            secretEnv: {},
          },
        },
      })}\n`,
    );

    for (const provider of ['claude', 'gemini'] satisfies ProviderName[]) {
      const outputPath = getAdapter(provider).mcpPath();
      if (outputPath === null) throw new Error(`${provider} MCP path missing`);
      await mkdir(outputPath, { recursive: true });
    }

    const report = await applyAll({ providers, contents: ['mcp'] });
    expect(report.results.filter((result) => result.status === 'written')).toHaveLength(4);
    expect(report.results.filter((result) => result.status === 'error')).toHaveLength(2);
    for (const provider of ['codex', 'cursor', 'windsurf', 'opencode'] satisfies ProviderName[]) {
      const outputPath = getAdapter(provider).mcpPath();
      if (outputPath === null) throw new Error(`${provider} MCP path missing`);
      expect(await readFile(outputPath, 'utf8')).toContain('local');
    }
  });

  test('blocks only MCP projections whose required secrets are unbound', async () => {
    const { home } = await useTempHomes();
    await enableProviders(home, ['claude', 'cursor']);
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            api: {
              transport: 'http',
              url: 'https://example.test/mcp',
              headers: {},
              secretHeaders: {
                Authorization: { id: 'api-token' },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const secretStore = new MemorySecretStore();

    const blocked = await applyAll({
      providers: ['claude', 'cursor'],
      contents: ['mcp'],
      secretStore,
    });
    await secretStore.set('api-token', 'Bearer bound');
    const applied = await applyAll({
      providers: ['claude', 'cursor'],
      contents: ['mcp'],
      secretStore,
    });

    expect(blocked.results.every((result) => result.status === 'blocked')).toBe(true);
    expect(applied.results.every((result) => result.status === 'written')).toBe(true);
  });

  test('restores provider originals and keeps a pre-restore safety backup', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'provider original\n');
    await applyAll({ providers: ['claude'], contents: ['rules'] });

    const report = await restoreProviderOutputs('claude', home);

    expect(await readFile(outputPath, 'utf8')).toBe('provider original\n');
    expect(report.results[0]?.action).toBe('restored');
    expect(report.results[0]?.safetyBackup).not.toBeNull();
    expect(Object.keys((await loadManifest(home)).outputs)).toHaveLength(0);
  });

  test('purges retained provider originals without changing current output', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'provider original\n');
    await applyAll({ providers: ['claude'], contents: ['rules'] });
    const managedOutput = await readFile(outputPath, 'utf8');

    await purgeProviderBackups('claude', home);

    expect(await readFile(outputPath, 'utf8')).toBe(managedOutput);
    expect(
      Object.values((await loadManifest(home)).outputs)[0]?.backedUpTo,
    ).toBeNull();
  });

  test('detects modified and missing provider projections', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await applyAll({ providers: ['claude'], contents: ['rules'] });
    expect((await detectProjectionDrift(home))[0]?.state).toBe('clean');

    await writeFile(outputPath, 'external edit\n');
    expect((await detectProjectionDrift(home))[0]?.state).toBe('drifted');
    expect(
      (
        await applyAll({
          providers: ['claude'],
          contents: ['rules'],
        })
      ).results[0]?.status,
    ).toBe('blocked');
    expect(
      (
        await applyAll({
          providers: ['claude'],
          contents: ['rules'],
          allowOverwriteDrift: true,
        })
      ).results[0]?.status,
    ).toBe('written');
    await rm(outputPath);
    expect((await detectProjectionDrift(home))[0]?.state).toBe('missing');
  });
});
