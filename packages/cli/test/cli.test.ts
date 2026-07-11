import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'bun:test';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(import.meta.dir, '..', 'src', 'index.ts');

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
});

async function useTempHomes(): Promise<{ home: string; providerHome: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-provider-'));
  return { home: currentHome, providerHome: currentProviderHome };
}

async function runCli(args: string[], home: string, providerHome: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('bun', [cliPath, ...args], {
    env: {
      ...process.env,
      REGLET_HOME: home,
      REGLET_PROVIDER_HOME: providerHome,
    },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

describe('reglet CLI', () => {
  test('scan --json reports provider inventory and safety defaults', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, 'existing claude rules\n');

    const result = await runCli(['scan', '--json'], home, providerHome);
    const scan = JSON.parse(result.stdout) as {
      version: number;
      regletHome: string;
      safety: {
        daemonEnabled: boolean;
        syncEnabled: boolean;
        notificationsEnabled: boolean;
        requiresExplicitConfirmation: boolean;
      };
      providers: {
        id: string;
        detected: boolean;
        inventory: {
          rulesPath: string | null;
          rulesExists: boolean;
        };
      }[];
    };

    expect(scan.version).toBe(1);
    expect(scan.regletHome).toBe(home);
    expect(scan.safety).toEqual({
      daemonEnabled: false,
      syncEnabled: false,
      notificationsEnabled: false,
      requiresExplicitConfirmation: true,
    });
    const claude = scan.providers.find((provider) => provider.id === 'claude');
    expect(claude).toMatchObject({
      detected: true,
      inventory: {
        rulesPath: claudeRules,
        rulesExists: true,
      },
    });
  });

  test('plan --json previews first-run reads and writes without changing files', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.join(providerHome, '.claude', 'skills', 'alpha'), { recursive: true });
    await writeFile(claudeRules, 'existing claude rules\n');
    await writeFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha skill\n');

    const result = await runCli(['plan', '--provider', 'claude', '--content', 'rules,skills', '--json'], home, providerHome);
    const plan = JSON.parse(result.stdout) as {
      version: number;
      mode: string;
      unifiedSkills: { name: string; status: string; sourceProvider: string | null; sourceName: string | null }[];
      rules: { status: string; sources: { provider: string; hash: string; preview: string }[]; unifiedFiles: string[] };
      reads: { path: string; scope: string; operation: string }[];
      writes: { path: string; scope: string; operation: string }[];
      safety: { daemonEnabled: boolean; syncEnabled: boolean; notificationsEnabled: boolean };
    };

    expect(plan.version).toBe(1);
    expect(plan.mode).toBe('onboarding');
    expect(plan.unifiedSkills).toContainEqual({
      name: 'alpha',
      status: 'selected',
      sourceProvider: 'claude',
      sourceName: 'alpha',
    });
    expect(plan.rules).toMatchObject({
      status: 'single',
      unifiedFiles: ['imported-claude.md'],
    });
    expect(plan.rules.sources[0]).toMatchObject({
      provider: 'claude',
      preview: 'existing claude rules',
    });
    expect(plan.rules.sources[0]?.hash).toHaveLength(64);
    expect(plan.reads).toContainEqual({
      provider: 'claude',
      content: 'rules',
      path: claudeRules,
      scope: 'provider',
      operation: 'read',
      reason: 'import claude:rules',
    });
    expect(plan.writes).toContainEqual({
      provider: 'claude',
      content: 'rules',
      path: path.join(home, 'rules', 'imported-claude.md'),
      scope: 'master',
      operation: 'write',
      reason: 'manage claude:rules',
    });
    expect(plan.writes).toContainEqual({
      provider: 'claude',
      content: 'skills',
      path: path.join(home, 'skills', 'alpha'),
      scope: 'master',
      operation: 'write',
      reason: 'manage claude:skills',
    });
    expect(plan.safety).toMatchObject({
      daemonEnabled: false,
      syncEnabled: false,
      notificationsEnabled: false,
    });
    await expect(readFile(path.join(home, 'rules', 'imported-claude.md'), 'utf8')).rejects.toThrow();
  });

  test('plan --json can preview only selected provider skills', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(providerHome, '.claude', 'skills', 'alpha'), { recursive: true });
    await mkdir(path.join(providerHome, '.claude', 'skills', 'beta'), { recursive: true });
    await writeFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha skill\n');
    await writeFile(path.join(providerHome, '.claude', 'skills', 'beta', 'SKILL.md'), 'beta skill\n');

    const result = await runCli(
      ['plan', '--provider', 'claude', '--content', 'skills', '--skill', 'claude:alpha', '--json'],
      home,
      providerHome,
    );
    const plan = JSON.parse(result.stdout) as {
      providers: { contents: { skills: { items: string[] } } }[];
      writes: { content: string; path: string }[];
    };

    expect(plan.providers[0]?.contents.skills.items).toEqual(['alpha']);
    expect(plan.writes).toContainEqual(expect.objectContaining({
      content: 'skills',
      path: path.join(home, 'skills', 'alpha'),
    }));
    expect(plan.writes).not.toContainEqual(expect.objectContaining({
      content: 'skills',
      path: path.join(home, 'skills', 'beta'),
    }));
  });

  test('init --yes enrolls detected providers, imports rules, and applies outputs', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, 'existing claude rules\n');
    await mkdir(path.join(providerHome, '.claude', 'skills', 'alpha'), { recursive: true });
    await writeFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha skill\n');
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify(
        {
          theme: 'dark',
          mcpServers: {
            existingServer: {
              command: 'node',
              args: ['server.js'],
              env: { TOKEN: 'one' },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await runCli(['init', '--yes'], home, providerHome);

    expect(await readFile(path.join(home, 'rules', 'imported-claude.md'), 'utf8')).toBe('existing claude rules\n');
    expect(await readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('alpha skill\n');
    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({
      mcpServers: {
        existingServer: {
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'one' },
        },
      },
    });
    expect(await readFile(claudeRules, 'utf8')).toContain('GENERATED BY REGLET');
    expect(JSON.parse(await readFile(path.join(providerHome, '.claude.json'), 'utf8'))).toEqual({
      theme: 'dark',
      mcpServers: {
        existingServer: {
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'one' },
        },
      },
    });
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('[providers.claude]');
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('enabled = true');
  });

  test('init can transfer only selected provider skills into the unified directory', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(providerHome, '.claude', 'skills', 'alpha'), { recursive: true });
    await mkdir(path.join(providerHome, '.claude', 'skills', 'beta'), { recursive: true });
    await writeFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha skill\n');
    await writeFile(path.join(providerHome, '.claude', 'skills', 'beta', 'SKILL.md'), 'beta skill\n');

    await runCli(['init', '--provider', 'claude', '--content', 'skills', '--skill', 'claude:alpha'], home, providerHome);

    expect(await readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('alpha skill\n');
    await expect(readFile(path.join(home, 'skills', 'beta', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('alpha skill\n');
    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'beta', 'SKILL.md'), 'utf8')).toBe('beta skill\n');

    const manifest = JSON.parse(await readFile(path.join(home, '.state', 'manifest.json'), 'utf8')) as {
      outputs: Record<string, { backedUpTo: string | null }>;
    };
    expect(manifest.outputs[path.join(providerHome, '.claude', 'skills', 'alpha')]?.backedUpTo).not.toBeNull();
    expect(manifest.outputs[path.join(providerHome, '.claude', 'skills', 'beta')]).toBeUndefined();
  });

  test('init --yes imports opencode mcp schema into canonical master format', async () => {
    const { home, providerHome } = await useTempHomes();
    const opencodeConfig = path.join(providerHome, '.config', 'opencode', 'opencode.json');
    await mkdir(path.dirname(opencodeConfig), { recursive: true });
    await writeFile(
      opencodeConfig,
      `${JSON.stringify(
        {
          mcp: {
            localServer: {
              type: 'local',
              command: ['node', 'server.js'],
              environment: { TOKEN: 'one' },
            },
            remoteServer: {
              type: 'remote',
              url: 'https://example.test/mcp',
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await runCli(['init', '--yes'], home, providerHome);

    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({
      mcpServers: {
        localServer: {
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'one' },
        },
        remoteServer: {
          url: 'https://example.test/mcp',
        },
      },
    });
  });

  test('init with provider and content flags imports only selected content', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.join(providerHome, '.claude', 'skills', 'alpha'), { recursive: true });
    await writeFile(claudeRules, 'selected rules\n');
    await writeFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'should not import\n');
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ mcpServers: { shouldNotImport: { command: 'node' } } }, null, 2)}\n`,
    );

    await runCli(['init', '--provider', 'claude', '--content', 'rules'], home, providerHome);

    expect(await readFile(path.join(home, 'rules', 'imported-claude.md'), 'utf8')).toBe('selected rules\n');
    await expect(readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({ mcpServers: {} });
    const config = await readFile(path.join(home, 'reglet.toml'), 'utf8');
    expect(config).toContain('[providers.claude]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('rules = true');
    expect(config).toContain('skills = false');
    expect(config).toContain('mcp = false');
  });

  test('apply, status --check, and restore work in a sandbox', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeDir = path.join(providerHome, '.claude');
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'Be concise.\n');
    await writeFile(
      path.join(home, 'reglet.toml'),
      [
        '[providers.claude]',
        'enabled = true',
        'rules = true',
        'skills = true',
        'mcp = true',
        '',
        '[sync]',
        'server_url = ""',
        '',
      ].join('\n'),
    );

    const apply = await runCli(['apply', '--provider', 'claude', '--content', 'rules'], home, providerHome);
    expect(apply.stdout).toContain('claude\trules\twritten');

    const outputPath = path.join(claudeDir, 'CLAUDE.md');
    await writeFile(outputPath, `${await readFile(outputPath, 'utf8')}\nhand edit\n`);
    await expect(runCli(['status', '--check'], home, providerHome)).rejects.toMatchObject({ code: 2 });

    const restore = await runCli(['restore', 'claude'], home, providerHome);
    expect(restore.stdout).toContain('claude\tremoved');
    await expect(readFile(outputPath, 'utf8')).rejects.toThrow();
  });

  test('import provider rules writes stripped drift back into master rules', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeDir = path.join(providerHome, '.claude');
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'Base rules.\n');
    await writeFile(
      path.join(home, 'reglet.toml'),
      [
        '[providers.claude]',
        'enabled = true',
        'rules = true',
        'skills = true',
        'mcp = true',
        '',
        '[sync]',
        'server_url = ""',
        '',
      ].join('\n'),
    );
    await runCli(['apply', '--provider', 'claude', '--content', 'rules'], home, providerHome);

    const outputPath = path.join(claudeDir, 'CLAUDE.md');
    await writeFile(outputPath, `${await readFile(outputPath, 'utf8')}\nProvider-only edit.\n`);
    const result = await runCli(['import', 'claude:rules'], home, providerHome);

    expect(result.stdout).toContain('claude\trules\timported');
    const importedFile = result.stdout.trim().split('\t').at(-1);
    expect(importedFile).toBeDefined();
    expect(await readFile(importedFile ?? '', 'utf8')).not.toContain('GENERATED BY REGLET');
    expect(await readFile(importedFile ?? '', 'utf8')).toContain('Provider-only edit.');
  });

  test('enroll and unenroll update provider config', async () => {
    const { home, providerHome } = await useTempHomes();

    await runCli(['init'], home, providerHome);
    await runCli(['enroll', 'codex'], home, providerHome);
    await runCli(['unenroll', 'codex:mcp'], home, providerHome);
    const config = await readFile(path.join(home, 'reglet.toml'), 'utf8');

    expect(config).toContain('[providers.codex]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('mcp = false');
  });

  test('login --token writes sync state with device name', async () => {
    const { home, providerHome } = await useTempHomes();

    await runCli(['login', 'http://reglet.test', '--token', 'dev-token', '--device', 'laptop'], home, providerHome);
    const state = JSON.parse(await readFile(path.join(home, '.state', 'sync.json'), 'utf8')) as unknown;

    expect(state).toMatchObject({
      version: 1,
      serverUrl: 'http://reglet.test',
      deviceToken: 'dev-token',
      deviceName: 'laptop',
    });
  });
});
