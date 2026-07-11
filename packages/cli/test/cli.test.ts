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

async function runCliWithInput(
  args: string[],
  input: string,
  home: string,
  providerHome: string,
): Promise<{ stdout: string; stderr: string }> {
  const process = Bun.spawn(['bun', cliPath, ...args], {
    env: { ...Bun.env, REGLET_HOME: home, REGLET_PROVIDER_HOME: providerHome },
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (status !== 0) {
    throw new Error(`CLI exited ${status}: ${stderr}`);
  }
  return { stdout, stderr };
}

describe('reglet CLI', () => {
  test('rules list, read, and write manage master documents without applying providers', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'original\n');

    const listed = JSON.parse((await runCli(['rules', 'list', '--json'], home, providerHome)).stdout) as {
      version: number;
      documents: { path: string }[];
    };
    expect(listed).toEqual({ version: 1, documents: [{ path: '00-general.md' }] });
    expect((await runCli(['rules', 'read', '00-general.md'], home, providerHome)).stdout).toBe('original\n');

    await runCliWithInput(['rules', 'write', '00-general.md'], 'edited\n', home, providerHome);
    expect(await readFile(path.join(home, 'rules', '00-general.md'), 'utf8')).toBe('edited\n');
    expect(await Bun.file(path.join(providerHome, '.claude', 'CLAUDE.md')).exists()).toBe(false);
  });

  test('rules commands reject paths outside the master directory', async () => {
    const { home, providerHome } = await useTempHomes();
    await expect(runCli(['rules', 'read', '../reglet.toml'], home, providerHome)).rejects.toBeDefined();
  });

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
      reads: { path: string; scope: string; operation: string }[];
      writes: { path: string; scope: string; operation: string }[];
      reconciliation: {
        rules: {
          provider: string;
          sourcePath: string;
          destinationPath: string;
          state: string;
          preview: string;
          truncated: boolean;
        }[];
      };
      safety: { daemonEnabled: boolean; syncEnabled: boolean; notificationsEnabled: boolean };
    };

    expect(plan.version).toBe(1);
    expect(plan.mode).toBe('onboarding');
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
      path: path.join(providerHome, '.claude', 'skills'),
      scope: 'provider',
      operation: 'write',
      reason: 'manage claude:skills',
    });
    expect(plan.writes.some((write) => write.path === path.join(home, 'skills', 'alpha'))).toBe(false);
    expect(plan.safety).toMatchObject({
      daemonEnabled: false,
      syncEnabled: false,
      notificationsEnabled: false,
    });
    expect(plan.reconciliation.rules).toEqual([
      {
        provider: 'claude',
        sourcePath: claudeRules,
        destinationPath: path.join(home, 'rules', 'imported-claude.md'),
        state: 'new',
        preview: 'existing claude rules\n',
        truncated: false,
      },
    ]);
    await expect(readFile(path.join(home, 'rules', 'imported-claude.md'), 'utf8')).rejects.toThrow();
  });

  test('plan --json reconciles selected provider rules without creating master files', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    const opencodeRules = path.join(providerHome, '.config', 'opencode', 'AGENTS.md');
    const longRules = `${'x'.repeat(900)}\n`;
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await mkdir(path.dirname(opencodeRules), { recursive: true });
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await writeFile(claudeRules, 'same rules\n');
    await writeFile(codexRules, 'codex provider rules\n');
    await writeFile(opencodeRules, longRules);
    await writeFile(path.join(home, 'rules', 'imported-claude.md'), 'same rules\n');
    await writeFile(path.join(home, 'rules', 'imported-codex.md'), 'old codex rules\n');

    const result = await runCli(
      ['plan', '--provider', 'claude,codex,opencode,windsurf', '--content', 'rules', '--json'],
      home,
      providerHome,
    );
    const plan = JSON.parse(result.stdout) as {
      version: number;
      reads: { provider: string; content: string; path: string }[];
      writes: { provider: string; content: string; path: string }[];
      reconciliation: {
        rules: {
          provider: string;
          sourcePath: string;
          destinationPath: string;
          state: 'new' | 'matching' | 'different';
          preview: string;
          truncated: boolean;
        }[];
      };
    };

    expect(plan.version).toBe(1);
    expect(plan.reconciliation.rules).toHaveLength(3);
    expect(plan.reconciliation.rules.find((rule) => rule.provider === 'claude')).toEqual({
      provider: 'claude',
      sourcePath: claudeRules,
      destinationPath: path.join(home, 'rules', 'imported-claude.md'),
      state: 'matching',
      preview: 'same rules\n',
      truncated: false,
    });
    expect(plan.reconciliation.rules.find((rule) => rule.provider === 'codex')).toEqual({
      provider: 'codex',
      sourcePath: codexRules,
      destinationPath: path.join(home, 'rules', 'imported-codex.md'),
      state: 'different',
      preview: 'codex provider rules\n',
      truncated: false,
    });
    const opencode = plan.reconciliation.rules.find((rule) => rule.provider === 'opencode');
    expect(opencode).toMatchObject({
      provider: 'opencode',
      sourcePath: opencodeRules,
      destinationPath: path.join(home, 'rules', 'imported-opencode.md'),
      state: 'new',
      truncated: true,
    });
    expect(opencode?.preview).toHaveLength(800);
    expect(plan.reconciliation.rules.some((rule) => rule.provider === 'windsurf')).toBe(false);
    expect(await Bun.file(path.join(home, 'rules', 'imported-opencode.md')).exists()).toBe(false);
    expect(await Bun.file(path.join(home, 'rules', 'imported-windsurf.md')).exists()).toBe(false);
  });

  test('plan --json omits rule reconciliation when rules are not selected and leaves master absent', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, 'rules not selected\n');

    const result = await runCli(['plan', '--provider', 'claude', '--content', 'skills', '--json'], home, providerHome);
    const plan = JSON.parse(result.stdout) as { reconciliation: { rules: unknown[] } };

    expect(plan.reconciliation.rules).toEqual([]);
    expect(await Bun.file(path.join(home, 'rules')).exists()).toBe(false);
  });

  test('init --yes leaves existing provider skills local while importing rules and MCP', async () => {
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
    await expect(readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('alpha skill\n');
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

  test('status --json reports enrollment, drift, and sync state', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeDir = path.join(providerHome, '.claude');
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'Be concise.\n');
    await runCli(['enroll', 'claude'], home, providerHome);
    await runCli(['apply', '--provider', 'claude', '--content', 'rules'], home, providerHome);

    const clean = JSON.parse((await runCli(['status', '--json'], home, providerHome)).stdout) as {
      version: number;
      driftedCount: number;
      providers: { id: string; enabled: boolean }[];
      drift: { provider: string; content: string; status: string; outputPath: string }[];
      sync: { configured: boolean; serverUrl: string; deviceName: string };
    };
    expect(clean.version).toBe(1);
    expect(clean.driftedCount).toBe(0);
    expect(clean.providers.find((provider) => provider.id === 'claude')).toMatchObject({ enabled: true });
    expect(clean.drift).toHaveLength(1);
    expect(clean.sync).toEqual({ configured: false, serverUrl: '', deviceName: 'device' });

    const outputPath = path.join(claudeDir, 'CLAUDE.md');
    await writeFile(outputPath, `${await readFile(outputPath, 'utf8')}\nhand edit\n`);
    const drifted = JSON.parse((await runCli(['status', '--json'], home, providerHome)).stdout) as typeof clean;
    expect(drifted.driftedCount).toBe(1);
    expect(drifted.drift[0]).toMatchObject({ provider: 'claude', content: 'rules', status: 'modified' });

    await expect(runCli(['status', '--json', '--check'], home, providerHome)).rejects.toMatchObject({ code: 2 });
  });

  test('import provider skills and mcp write drifted content back into master', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'my-skill'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'my-skill', 'SKILL.md'), 'original\n');
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node' } } }, null, 2)}\n`,
    );
    await runCli(['enroll', 'claude'], home, providerHome);
    await runCli(['apply', '--provider', 'claude'], home, providerHome);

    await writeFile(path.join(providerHome, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'edited\n');
    const skillsResult = await runCli(['import', 'claude:skills'], home, providerHome);
    expect(skillsResult.stdout).toContain('claude\tskills\timported');
    expect(await readFile(path.join(home, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('edited\n');

    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'ruby' } } }, null, 2)}\n`,
    );
    const mcpResult = await runCli(['import', 'claude:mcp', '--json'], home, providerHome);
    const imported = JSON.parse(mcpResult.stdout) as { content: string; importedServers: string[] };
    expect(imported.content).toBe('mcp');
    expect(imported.importedServers).toEqual(['managed']);
    const master = JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8')) as {
      mcpServers: Record<string, { command?: string }>;
    };
    expect(master.mcpServers.managed?.command).toBe('ruby');
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

  test('lists and adopts unmanaged provider skills through JSON commands', async () => {
    const { home, providerHome } = await useTempHomes();
    const source = path.join(providerHome, '.claude', 'skills', 'local-alpha');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), 'local alpha\n');
    await runCli(['init'], home, providerHome);
    await runCli(['enroll', 'claude'], home, providerHome);

    const listed = JSON.parse((await runCli(['skills', 'unmanaged', '--json'], home, providerHome)).stdout) as {
      version: number;
      skills: { provider: string; name: string; sharedConflict: string; providerConflict: string }[];
    };
    expect(listed).toMatchObject({
      version: 1,
      skills: [{ provider: 'claude', name: 'local-alpha', sharedConflict: 'none', providerConflict: 'none' }],
    });

    const adopted = JSON.parse(
      (await runCli(['skills', 'adopt', 'claude', 'local-alpha', '--scope', 'provider', '--json'], home, providerHome))
        .stdout,
    ) as { adoption: { scope: string; destination: string; affectedProviders: string[] } };
    expect(adopted.adoption).toEqual({
      provider: 'claude',
      name: 'local-alpha',
      scope: 'provider',
      sourcePath: source,
      destination: path.join(home, 'skills', 'claude', 'local-alpha'),
      overwritten: false,
      affectedProviders: ['claude'],
    });
    expect(await readFile(path.join(home, 'skills', 'claude', 'local-alpha', 'SKILL.md'), 'utf8')).toBe(
      'local alpha\n',
    );
  });

  test('skills list prints managed and unmanaged skills as tab-separated text', async () => {
    const { home, providerHome } = await useTempHomes();
    const shared = path.join(home, 'skills', 'shared-alpha');
    const scoped = path.join(home, 'skills', 'claude', 'scoped-alpha');
    const local = path.join(providerHome, '.claude', 'skills', 'local-alpha');
    await mkdir(shared, { recursive: true });
    await mkdir(scoped, { recursive: true });
    await mkdir(local, { recursive: true });
    await writeFile(path.join(shared, 'SKILL.md'), 'shared\n');
    await writeFile(path.join(scoped, 'SKILL.md'), 'scoped\n');
    await writeFile(path.join(local, 'SKILL.md'), 'local\n');

    const result = await runCli(['skills', 'list'], home, providerHome);

    expect(result.stdout.trim().split('\n')).toEqual([
      `shared\tshared-alpha\t${shared}`,
      `claude\tscoped-alpha\t${scoped}`,
      `claude\tlocal-alpha\t${local}`,
    ]);
  });

  test('skills list --json prints the unified skills overview shape', async () => {
    const { home, providerHome } = await useTempHomes();
    const shared = path.join(home, 'skills', 'shared-alpha');
    const scoped = path.join(home, 'skills', 'claude', 'shared-alpha');
    const local = path.join(providerHome, '.claude', 'skills', 'local-alpha');
    await mkdir(shared, { recursive: true });
    await mkdir(scoped, { recursive: true });
    await mkdir(local, { recursive: true });
    await writeFile(path.join(shared, 'SKILL.md'), 'shared\n');
    await writeFile(path.join(scoped, 'SKILL.md'), 'scoped\n');
    await writeFile(path.join(local, 'SKILL.md'), 'local\n');

    const listed = JSON.parse((await runCli(['skills', 'list', '--json'], home, providerHome)).stdout) as {
      version: number;
      regletHome: string;
      shared: { name: string; path: string; fileCount: number; shadowedBy: string[] }[];
      providerScoped: {
        provider: string;
        name: string;
        path: string;
        fileCount: number;
        shadowsShared: boolean;
      }[];
      unmanaged: { provider: string; name: string; sourcePath: string }[];
    };

    expect(Object.keys(listed)).toEqual(['version', 'regletHome', 'shared', 'providerScoped', 'unmanaged']);
    expect(listed.version).toBe(1);
    expect(listed.regletHome).toBe(home);
    expect(listed.shared).toEqual([
      {
        name: 'shared-alpha',
        path: shared,
        fileCount: 1,
        shadowedBy: ['claude'],
      },
    ]);
    expect(listed.providerScoped).toEqual([
      {
        provider: 'claude',
        name: 'shared-alpha',
        path: scoped,
        fileCount: 1,
        shadowsShared: true,
      },
    ]);
    expect(listed.unmanaged).toHaveLength(1);
    expect(listed.unmanaged[0]).toMatchObject({
      provider: 'claude',
      name: 'local-alpha',
      sourcePath: local,
    });
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
