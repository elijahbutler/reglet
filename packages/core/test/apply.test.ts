import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig, type ProviderName } from '../src/config.js';
import { applyAll } from '../src/engine/apply.js';
import { GENERATED_HEADER } from '../src/header.js';
import { loadManifest } from '../src/manifest.js';
import { getAdapter } from '../src/providers/registry.js';
import { parse as parseToml } from 'smol-toml';

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

  test('applies shared skills plus only matching provider-specific skills', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['claude', 'codex']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'shared'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'claude', 'claude-only'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'codex', 'codex-only'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'shared', 'SKILL.md'), 'shared');
    await writeFile(path.join(home, 'skills', 'claude', 'claude-only', 'SKILL.md'), 'claude only');
    await writeFile(path.join(home, 'skills', 'codex', 'codex-only', 'SKILL.md'), 'codex only');

    await applyAll({ providers: ['claude', 'codex'], contents: ['skills'] });

    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'shared', 'SKILL.md'), 'utf8')).toBe('shared');
    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'claude-only', 'SKILL.md'), 'utf8')).toBe(
      'claude only',
    );
    await expect(
      readFile(path.join(providerHome, '.claude', 'skills', 'codex-only', 'SKILL.md'), 'utf8'),
    ).rejects.toThrow();
    expect(await readFile(path.join(providerHome, '.agents', 'skills', 'shared', 'SKILL.md'), 'utf8')).toBe('shared');
    expect(await readFile(path.join(providerHome, '.agents', 'skills', 'codex-only', 'SKILL.md'), 'utf8')).toBe(
      'codex only',
    );
    await expect(
      readFile(path.join(providerHome, '.agents', 'skills', 'claude-only', 'SKILL.md'), 'utf8'),
    ).rejects.toThrow();
  });

  test('provider-specific skills override shared skills with the same name', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['claude', 'codex']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'alpha'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'codex', 'alpha'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'shared alpha');
    await writeFile(path.join(home, 'skills', 'codex', 'alpha', 'SKILL.md'), 'codex alpha');

    await applyAll({ providers: ['claude', 'codex'], contents: ['skills'] });

    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      'shared alpha',
    );
    expect(await readFile(path.join(providerHome, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      'codex alpha',
    );
  });

  test('removes provider-managed skills when a shared skill becomes provider-specific elsewhere', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['claude', 'codex']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'alpha'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'shared alpha');

    await applyAll({ providers: ['claude', 'codex'], contents: ['skills'] });
    await rm(path.join(home, 'skills', 'alpha'), { recursive: true, force: true });
    await mkdir(path.join(home, 'skills', 'codex', 'alpha'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'codex', 'alpha', 'SKILL.md'), 'codex alpha');
    await applyAll({ providers: ['claude', 'codex'], contents: ['skills'] });

    await expect(readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(providerHome, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      'codex alpha',
    );
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

  test('applies json mcp converters for cursor and windsurf with managed-key removal', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['cursor', 'windsurf']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            alpha: { command: 'node', args: ['alpha.js'] },
            beta: { url: 'https://beta.example.test' },
          },
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(path.join(providerHome, '.cursor'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.cursor', 'mcp.json'),
      `${JSON.stringify({ mcpServers: { user: { command: 'python' } } }, null, 2)}\n`,
    );
    await mkdir(path.join(providerHome, '.codeium', 'windsurf'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.codeium', 'windsurf', 'mcp_config.json'),
      `${JSON.stringify({ window: 'keep', mcpServers: { user: { command: 'ruby' } } }, null, 2)}\n`,
    );

    await applyAll({ providers: ['cursor', 'windsurf'], contents: ['mcp'] });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { beta: { url: 'https://beta.example.test' } } }, null, 2)}\n`,
    );
    await applyAll({ providers: ['cursor', 'windsurf'], contents: ['mcp'] });

    const cursor = JSON.parse(await readFile(path.join(providerHome, '.cursor', 'mcp.json'), 'utf8')) as unknown;
    const windsurf = JSON.parse(
      await readFile(path.join(providerHome, '.codeium', 'windsurf', 'mcp_config.json'), 'utf8'),
    ) as unknown;

    expect(cursor).toEqual({
      mcpServers: {
        user: { command: 'python' },
        beta: { url: 'https://beta.example.test' },
      },
    });
    expect(windsurf).toEqual({
      window: 'keep',
      mcpServers: {
        user: { command: 'ruby' },
        beta: { url: 'https://beta.example.test' },
      },
    });
  });

  test('applies codex toml mcp while preserving unrelated tables and unmanaged servers', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['codex']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            alpha: { command: 'node', args: ['alpha.js'], env: { TOKEN: 'one' } },
            remote: { url: 'https://remote.example.test' },
          },
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(path.join(providerHome, '.codex'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.codex', 'config.toml'),
      [
        '[profile]',
        'model = "gpt-5"',
        '',
        '[mcp_servers.user]',
        'command = "python"',
        '',
      ].join('\n'),
    );

    await applyAll({ providers: ['codex'], contents: ['mcp'] });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { remote: { url: 'https://remote.example.test' } } }, null, 2)}\n`,
    );
    await applyAll({ providers: ['codex'], contents: ['mcp'] });

    const config = parseToml(await readFile(path.join(providerHome, '.codex', 'config.toml'), 'utf8')) as {
      profile?: { model?: string };
      mcp_servers?: Record<string, unknown>;
    };

    expect(config.profile?.model).toBe('gpt-5');
    expect(config.mcp_servers).toEqual({
      user: { command: 'python' },
      remote: { url: 'https://remote.example.test' },
    });
  });

  test('applies opencode mcp schema for local and remote servers', async () => {
    const { home, providerHome } = await useTempHomes();
    await enableProviders(home, ['opencode']);
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            alpha: { command: 'node', args: ['alpha.js'], env: { TOKEN: 'one' } },
            remote: { url: 'https://remote.example.test' },
          },
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(path.join(providerHome, '.config', 'opencode'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.config', 'opencode', 'opencode.json'),
      `${JSON.stringify({ theme: 'system', mcp: { user: { type: 'local', command: ['python'] } } }, null, 2)}\n`,
    );

    await applyAll({ providers: ['opencode'], contents: ['mcp'] });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { remote: { url: 'https://remote.example.test' } } }, null, 2)}\n`,
    );
    await applyAll({ providers: ['opencode'], contents: ['mcp'] });

    const config = JSON.parse(await readFile(path.join(providerHome, '.config', 'opencode', 'opencode.json'), 'utf8')) as unknown;

    expect(config).toEqual({
      $schema: 'https://opencode.ai/config.json',
      theme: 'system',
      mcp: {
        user: { type: 'local', command: ['python'] },
        remote: { type: 'remote', url: 'https://remote.example.test' },
      },
    });
  });
});
