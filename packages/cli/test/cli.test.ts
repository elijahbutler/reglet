import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'bun:test';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(import.meta.dir, '..', 'src', 'index.ts');

let currentHome: string | undefined;
let currentProviderHome: string | undefined;
let currentExtraHomes: string[] = [];

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  if (currentProviderHome !== undefined) {
    await rm(currentProviderHome, { recursive: true, force: true });
    currentProviderHome = undefined;
  }
  for (const home of currentExtraHomes) {
    await rm(home, { recursive: true, force: true });
  }
  currentExtraHomes = [];
});

async function useTempHomes(): Promise<{ home: string; providerHome: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-provider-'));
  return { home: currentHome, providerHome: currentProviderHome };
}

function fakeExecutablePath(bin: string, command: string): string {
  return path.join(bin, process.platform === 'win32' ? `${command}.cmd` : command);
}

async function runCli(
  args: string[],
  home: string,
  providerHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('bun', [cliPath, ...args], {
    env: {
      ...process.env,
      REGLET_HOME: home,
      REGLET_PROVIDER_HOME: providerHome,
      ...extraEnv,
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

async function runRpc(
  request: unknown,
  home: string,
  providerHome: string,
): Promise<{ stdout: string; stderr: string }> {
  return runCliWithInput(
    ['manager', 'rpc', '--json', '--protocol-version', '1'],
    typeof request === 'string' ? request : JSON.stringify(request),
    home,
    providerHome,
  );
}

describe('reglet CLI', () => {
  test('rules list, read, and write manage master documents without applying providers', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'rules', 'codex'), { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'original\n');
    await writeFile(path.join(home, 'rules', 'codex', '.reglet-provider-overlay'), 'v1\n');
    await writeFile(path.join(home, 'rules', 'codex', '10-overlay.md'), 'codex only\n');

    const listed = JSON.parse((await runCli(['rules', 'list', '--json'], home, providerHome)).stdout) as {
      version: number;
      documents: { path: string; scope: { kind: string; provider?: string } }[];
    };
    expect(listed).toEqual({
      version: 1,
      documents: [
        { path: '00-general.md', scope: { kind: 'shared' } },
        { path: 'codex/10-overlay.md', scope: { kind: 'provider', provider: 'codex' } },
      ],
    });
    expect((await runCli(['rules', 'read', '00-general.md'], home, providerHome)).stdout).toBe('original\n');
    expect((await runCli(['rules', 'read', 'codex/10-overlay.md'], home, providerHome)).stdout).toBe('codex only\n');

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
      path: path.join(home, 'rules', 'claude', '00-imported.md'),
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
        destinationPath: path.join(home, 'rules', 'claude', '00-imported.md'),
        state: 'new',
        preview: 'existing claude rules\n',
        truncated: false,
      },
    ]);
    await expect(readFile(path.join(home, 'rules', 'claude', '00-imported.md'), 'utf8')).rejects.toThrow();
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
    await mkdir(path.join(home, 'rules', 'claude'), { recursive: true });
    await mkdir(path.join(home, 'rules', 'codex'), { recursive: true });
    await writeFile(path.join(home, 'rules', 'claude', '00-imported.md'), 'same rules\n');
    await writeFile(path.join(home, 'rules', 'codex', '00-imported.md'), 'old codex rules\n');

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
      destinationPath: path.join(home, 'rules', 'claude', '00-imported.md'),
      state: 'matching',
      preview: 'same rules\n',
      truncated: false,
    });
    expect(plan.reconciliation.rules.find((rule) => rule.provider === 'codex')).toEqual({
      provider: 'codex',
      sourcePath: codexRules,
      destinationPath: path.join(home, 'rules', 'codex', '00-imported.md'),
      state: 'different',
      preview: 'codex provider rules\n',
      truncated: false,
    });
    const opencode = plan.reconciliation.rules.find((rule) => rule.provider === 'opencode');
    expect(opencode).toMatchObject({
      provider: 'opencode',
      sourcePath: opencodeRules,
      destinationPath: path.join(home, 'rules', 'opencode', '00-imported.md'),
      state: 'new',
      truncated: true,
    });
    expect(opencode?.preview).toHaveLength(800);
    expect(plan.reconciliation.rules.some((rule) => rule.provider === 'windsurf')).toBe(false);
    expect(await Bun.file(path.join(home, 'rules', 'opencode', '00-imported.md')).exists()).toBe(false);
    expect(await Bun.file(path.join(home, 'rules', 'windsurf', '00-imported.md')).exists()).toBe(false);
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

  test('rules merge-draft --json invokes a local AI runner and does not write master files', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'Prefer concise answers.\n');
    await writeFile(codexRules, 'Never use npm.\n');

    const result = await runCli(
      ['rules', 'merge-draft', '--provider', 'claude,codex', '--json'],
      home,
      providerHome,
      {
        REGLET_RULES_MERGE_COMMAND_JSON: JSON.stringify([
          'bun',
          '-e',
          'await Bun.stdin.text(); console.log("Prefer concise answers.\\nNever use npm.")',
        ]),
      },
    );
    const merged = JSON.parse(result.stdout) as {
      version: number;
      provider: string;
      draft: string;
      sources: { provider: string; sourcePath: string; bytes: number }[];
    };

    expect(merged).toEqual({
      version: 1,
      provider: 'custom',
      draft: 'Prefer concise answers.\nNever use npm.\n',
      sources: [
        { provider: 'claude', sourcePath: claudeRules, bytes: Buffer.byteLength('Prefer concise answers.\n') },
        { provider: 'codex', sourcePath: codexRules, bytes: Buffer.byteLength('Never use npm.\n') },
      ],
    });
    expect(await Bun.file(path.join(home, 'rules', '00-general.md')).exists()).toBe(false);
  });

  test('rules merge-draft finds user-local AI runners when PATH is minimal', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'Prefer concise answers.\n');
    await writeFile(codexRules, 'Never use npm.\n');

    const fakeHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-runner-home-'));
    currentExtraHomes.push(fakeHome);
    const fakeCodex = path.join(fakeHome, '.local', 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    if (process.platform === 'win32') {
      await writeFile(
        fakeCodex,
        [
          '@echo off',
          'if "%1"=="--version" (',
          '  echo codex 0.0.0',
          '  exit /b 0',
          ')',
          'echo Merged from fake codex.',
          '',
        ].join('\r\n'),
      );
    } else {
      await writeFile(
        fakeCodex,
        [
          '#!/bin/sh',
          'if [ "$1" = "--version" ]; then',
          '  echo "codex 0.0.0"',
          '  exit 0',
          'fi',
          'echo "Merged from fake codex."',
          '',
        ].join('\n'),
      );
      await chmod(fakeCodex, 0o755);
    }

    const result = await runCli(
      ['rules', 'merge-draft', '--provider', 'claude,codex', '--json'],
      home,
      providerHome,
      {
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      },
    );
    const merged = JSON.parse(result.stdout) as { provider: string; draft: string };

    expect(merged.provider).toBe('codex');
    expect(merged.draft).toBe('Merged from fake codex.\n');
  });

  test('rules merge-runners discovers installed tools without invoking them', async () => {
    const { home, providerHome } = await useTempHomes();
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-runner-home-'));
    currentExtraHomes.push(fakeHome);
    const marker = path.join(fakeHome, 'invoked');
    const fakeCodex = fakeExecutablePath(path.join(fakeHome, '.local', 'bin'), 'codex');
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    if (process.platform === 'win32') {
      await writeFile(fakeCodex, `@echo off\r\ntype nul > "${marker}"\r\n`);
    } else {
      await writeFile(fakeCodex, `#!/bin/sh\ntouch '${marker}'\n`);
      await chmod(fakeCodex, 0o755);
    }

    const result = await runCli(['rules', 'merge-runners', '--json'], home, providerHome, {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    });
    const payload = JSON.parse(result.stdout) as {
      version: number;
      runners: { id: string; displayName: string; executablePath: string }[];
    };

    expect(payload).toEqual({
      version: 1,
      runners: [{ id: 'codex', displayName: 'Codex CLI', executablePath: fakeCodex }],
    });
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test('rules merge-draft honors an explicitly selected runner', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'Prefer concise answers.\n');
    await writeFile(codexRules, 'Never use npm.\n');

    const fakeHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-runner-home-'));
    currentExtraHomes.push(fakeHome);
    const bin = path.join(fakeHome, '.local', 'bin');
    await mkdir(bin, { recursive: true });
    const fakeCodex = fakeExecutablePath(bin, 'codex');
    const fakeClaude = fakeExecutablePath(bin, 'claude');
    if (process.platform === 'win32') {
      await writeFile(fakeCodex, '@echo off\r\necho Used codex.\r\n');
      await writeFile(fakeClaude, '@echo off\r\necho Used claude.\r\n');
    } else {
      await writeFile(fakeCodex, '#!/bin/sh\necho "Used codex."\n');
      await writeFile(fakeClaude, '#!/bin/sh\necho "Used claude."\n');
      await chmod(fakeCodex, 0o755);
      await chmod(fakeClaude, 0o755);
    }

    const result = await runCli(
      ['rules', 'merge-draft', '--provider', 'claude,codex', '--runner', 'claude', '--json'],
      home,
      providerHome,
      {
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      },
    );
    const merged = JSON.parse(result.stdout) as { provider: string; draft: string };

    expect(merged).toMatchObject({ provider: 'claude', draft: 'Used claude.\n' });
  });

  test('rules merge-draft runs Codex ephemerally outside Git and sends the prompt through stdin', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'Prefer concise answers.\n');
    await writeFile(codexRules, 'Never use npm.\n');

    const fakeHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-runner-home-'));
    currentExtraHomes.push(fakeHome);
    const argsLog = path.join(fakeHome, 'args');
    const stdinLog = path.join(fakeHome, 'stdin');
    const cwdLog = path.join(fakeHome, 'cwd');
    const fakeCodex = fakeExecutablePath(path.join(fakeHome, '.local', 'bin'), 'codex');
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    if (process.platform === 'win32') {
      const scriptPath = path.join(fakeHome, 'fake-codex.ts');
      await writeFile(scriptPath, [
        `await Bun.write(${JSON.stringify(argsLog)}, process.argv.slice(2).join('\\n') + '\\n');`,
        `await Bun.write(${JSON.stringify(cwdLog)}, process.cwd() + '\\n');`,
        `await Bun.write(${JSON.stringify(stdinLog)}, await Bun.stdin.text());`,
        'console.log("Merged securely.");',
        '',
      ].join('\n'));
      await writeFile(fakeCodex, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    } else {
      await writeFile(fakeCodex, [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > '${argsLog}'`,
        `pwd > '${cwdLog}'`,
        `cat > '${stdinLog}'`,
        'echo "Merged securely."',
        '',
      ].join('\n'));
      await chmod(fakeCodex, 0o755);
    }

    await runCli(
      [
        'rules',
        'merge-draft',
        '--provider',
        'claude,codex',
        '--runner',
        'codex',
        '--steer',
        'Keep package manager preferences and exclude personal biography.',
        '--json',
      ],
      home,
      providerHome,
      {
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      },
    );

    const args = await readFile(argsLog, 'utf8');
    const prompt = await readFile(stdinLog, 'utf8');
    const workingDirectory = (await readFile(cwdLog, 'utf8')).trim();
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('read-only');
    expect(args).not.toContain('Prefer concise answers.');
    expect(prompt).toContain('Prefer concise answers.');
    expect(prompt).toContain('Never use npm.');
    expect(prompt).toContain('Additional guidance from the user:');
    expect(prompt).toContain('Keep package manager preferences and exclude personal biography.');
    expect(path.basename(workingDirectory)).toStartWith('reglet-ai-merge-');
    await expect(stat(workingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rules merge-draft reports a missing explicitly selected runner', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'Prefer concise answers.\n');
    await writeFile(codexRules, 'Never use npm.\n');
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-runner-home-'));
    currentExtraHomes.push(fakeHome);

    await expect(runCli(
      ['rules', 'merge-draft', '--provider', 'claude,codex', '--runner', 'gemini', '--json'],
      home,
      providerHome,
      {
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      },
    )).rejects.toThrow('Gemini CLI was not found');
  });

  test('rules merge-draft requires at least two non-empty provider rule files', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, 'Only one source.\n');

    await expect(
      runCli(['rules', 'merge-draft', '--provider', 'claude,codex', '--json'], home, providerHome, {
        REGLET_RULES_MERGE_COMMAND_JSON: JSON.stringify(['bun', '-e', 'console.log("unused")']),
      }),
    ).rejects.toMatchObject({ code: 1 });
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
              command: '/Users/example/.local/bin/node',
              args: ['server.js'],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await runCli(['init', '--yes'], home, providerHome);

    expect(await readFile(path.join(home, 'rules', 'claude', '00-imported.md'), 'utf8')).toBe('existing claude rules\n');
    await expect(readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(providerHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('alpha skill\n');
    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({
      mcpServers: {
        existingServer: {
          command: '/Users/example/.local/bin/node',
          args: ['server.js'],
        },
      },
    });
    expect(await readFile(claudeRules, 'utf8')).toContain('GENERATED BY REGLET');
    expect(JSON.parse(await readFile(path.join(providerHome, '.claude.json'), 'utf8'))).toEqual({
      theme: 'dark',
      mcpServers: {
        existingServer: {
          command: '/Users/example/.local/bin/node',
          args: ['server.js'],
        },
      },
    });
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('[providers.claude]');
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('enabled = true');
  });

  test('init --yes leaves provider MCP env raw values local and unmanaged', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ mcpServers: { secretServer: { command: 'node', env: { TOKEN: 'one' } } } }, null, 2)}\n`,
    );

    const result = await runCli(['init', '--yes', '--provider', 'claude', '--content', 'mcp'], home, providerHome);
    expect(result.stderr).toContain('Left 1 incompatible MCP server from claude local and unmanaged (secretServer)');
    expect(result.stderr).not.toContain('one');
    expect(await Bun.file(path.join(home, 'mcp', 'servers.json')).exists()).toBe(true);
    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({ mcpServers: {} });
    expect(JSON.parse(await readFile(path.join(providerHome, '.claude.json'), 'utf8'))).toEqual({
      mcpServers: { secretServer: { command: 'node', env: { TOKEN: 'one' } } },
    });
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

    expect(await readFile(path.join(home, 'rules', 'claude', '00-imported.md'), 'utf8')).toBe('selected rules\n');
    await expect(readFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8'))).toEqual({ mcpServers: {} });
    const config = await readFile(path.join(home, 'reglet.toml'), 'utf8');
    expect(config).toContain('[providers.claude]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('rules = true');
    expect(config).toContain('skills = false');
    expect(config).toContain('mcp = false');
  });

  test('init --no-apply stages onboarding without touching provider outputs', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, 'leave this provider file alone\n');

    await runCli(['init', '--provider', 'claude', '--content', 'rules', '--no-apply'], home, providerHome);

    expect(await readFile(path.join(home, 'rules', 'claude', '00-imported.md'), 'utf8')).toBe('leave this provider file alone\n');
    expect(await readFile(claudeRules, 'utf8')).toBe('leave this provider file alone\n');
    const preview = JSON.parse(
      (await runCli(['apply-structured', 'preview', '--provider', 'claude', '--content', 'rules'], home, providerHome)).stdout,
    ) as { digest: string; entries: { expectedTargetHash: string | null; driftStatus: string }[] };
    expect(preview.digest).not.toBeEmpty();
    expect(preview.entries[0]).toMatchObject({ driftStatus: 'unmanaged', expectedTargetHash: expect.any(String) });
  });

  test('manager rpc returns typed errors for malformed input, unknown versions, and unknown operations', async () => {
    const { home, providerHome } = await useTempHomes();

    const malformed = JSON.parse((await runRpc('{', home, providerHome)).stdout) as {
      ok: false;
      error: { code: string };
    };
    expect(malformed).toMatchObject({ protocolVersion: 1, operation: 'unknown', ok: false, error: { code: 'MALFORMED_REQUEST' } });

    const unknownVersion = JSON.parse((await runRpc({ protocolVersion: 2, operation: 'snapshot' }, home, providerHome)).stdout) as {
      ok: false;
      error: { code: string };
    };
    expect(unknownVersion.error.code).toBe('UNKNOWN_PROTOCOL_VERSION');

    const unknownOperation = JSON.parse((await runRpc({ protocolVersion: 1, operation: 'missing' }, home, providerHome)).stdout) as {
      ok: false;
      error: { code: string };
    };
    expect(unknownOperation.error.code).toBe('UNKNOWN_OPERATION');

    const invalidInput = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'rules.read',
      input: {},
    }, home, providerHome)).stdout) as { error: { code: string; recoverable: boolean } };
    expect(invalidInput.error).toEqual({ code: 'INVALID_INPUT', message: 'Operation input is invalid.', recoverable: false });
  });

  test('manager rpc returns snapshot v2 and delegates mutations', async () => {
    const { home, providerHome } = await useTempHomes();
    const snapshot = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'snapshot',
      input: { contractVersion: 2 },
    }, home, providerHome)).stdout) as {
      ok: true;
      result: { version: number; contract: string; providerDiscovery: { provider: string }[] };
    };

    expect(snapshot).toMatchObject({ protocolVersion: 1, operation: 'snapshot', ok: true });
    expect(snapshot.result.version).toBe(2);
    expect(snapshot.result.contract).toBe('manager-snapshot');
    expect(snapshot.result.providerDiscovery.map((provider) => provider.provider)).toContain('claude');

    const mutation = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'enroll',
      input: { target: 'claude:rules' },
    }, home, providerHome)).stdout) as { ok: true };
    expect(mutation.ok).toBe(true);
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('enabled = false');
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).toContain('rules = true');

    const skillSync = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'skills.update-sync',
      input: { name: 'review', providers: ['claude'] },
    }, home, providerHome)).stdout) as { ok: true; result: { providers: string[] } };
    const mcpSync = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'mcp.update-sync',
      input: { id: 'local', providers: ['claude', 'codex'] },
    }, home, providerHome)).stdout) as { ok: true; result: { providers: string[] } };
    expect(skillSync.result.providers).toEqual(['claude']);
    expect(mcpSync.result.providers).toEqual(['claude', 'codex']);
  });

  test('encrypted sync snapshot performs no state or network work before local preview opt-in', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, '.state'), { recursive: true });
    await writeFile(path.join(home, '.state', 'sync-v2.json'), '{ invalid encrypted sync state');
    const response = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'sync.snapshot',
      input: {},
    }, home, providerHome)).stdout) as {
      ok: true;
      result: { previewAcknowledged: boolean; phase: string; serverUrl: string | null };
    };
    expect(response).toMatchObject({
      ok: true,
      result: { previewAcknowledged: false, phase: 'disabled', serverUrl: null },
    });
  });

  test('manager rpc reads only a provider rules source and does not expose its path', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await writeFile(claudeRules, '# Existing Claude rules\n\nUse pnpm.\n');

    const response = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'rules.source-read',
      input: { provider: 'claude' },
    }, home, providerHome)).stdout) as {
      ok: true;
      result: { version: number; provider: string; fileName: string; content: string; sourcePath?: string };
    };

    expect(response).toMatchObject({
      ok: true,
      result: {
        version: 1,
        provider: 'claude',
        fileName: 'CLAUDE.md',
        content: '# Existing Claude rules\n\nUse pnpm.\n',
      },
    });
    expect(response.result.sourcePath).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain(providerHome);
  });

  test('manager rpc maps stale structured preview and redacts secret canaries', async () => {
    const { home, providerHome } = await useTempHomes();
    const canary = 'manager-rpc-secret-canary';
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(providerHome, '.claude'), { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'first\n');
    await writeFile(
      path.join(home, 'reglet.toml'),
      [
        '[providers.claude]',
        'enabled = true',
        'rules = true',
        'skills = false',
        'mcp = false',
        '',
      ].join('\n'),
    );

    const preview = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'structured-preview.preview',
      input: { providers: ['claude'], contents: ['rules'] },
    }, home, providerHome)).stdout) as { ok: true; result: { digest: string } };

    await writeFile(path.join(home, 'rules', '00-general.md'), `${canary}\n`);
    const stale = JSON.parse((await runRpc({
      protocolVersion: 1,
      operation: 'structured-preview.apply',
      input: { digest: preview.result.digest, providers: ['claude'], contents: ['rules'] },
    }, home, providerHome)).stdout) as {
      ok: false;
      error: { code: string; message: string };
    };

    expect(stale.error.code).toBe('STALE_PLAN');
    expect(JSON.stringify(stale)).not.toContain(canary);
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

  test('status --json reports enrollment and drift without loading sync state', async () => {
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
      capabilities: { mode: string; localOnly: boolean; sync: boolean };
      providers: { id: string; enabled: boolean }[];
      drift: { provider: string; content: string; status: string; outputPath: string }[];
      sync?: unknown;
    };
    expect(clean.version).toBe(1);
    expect(clean.driftedCount).toBe(0);
    expect(clean.providers.find((provider) => provider.id === 'claude')).toMatchObject({ enabled: true });
    expect(clean.drift).toHaveLength(1);
    expect(clean.capabilities).toEqual({ mode: 'public-v1', localOnly: true, sync: false });
    expect(clean.sync).toBeUndefined();
    await mkdir(path.join(home, '.state'), { recursive: true });
    await writeFile(path.join(home, '.state', 'sync.json'), '{not-json');
    expect(JSON.parse((await runCli(['status', '--json'], home, providerHome)).stdout).sync).toBeUndefined();

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

  test('MCP JSON commands expose stable ids, provider scope, overrides, effective output, rename, and delete', async () => {
    const { home, providerHome } = await useTempHomes();
    await runCli(['init'], home, providerHome);
    await runCliWithInput(
      ['mcp', 'upsert', 'stable', '--display-name', 'shared-name', '--json'],
      '{"command":"node"}',
      home,
      providerHome,
    );
    const scopedUpsert = JSON.parse((await runCliWithInput(
      ['mcp', 'upsert', 'stable', '--scope', 'provider', '--provider', 'claude', '--display-name', 'claude-name', '--json'],
      '{"command":"ruby"}',
      home,
      providerHome,
    )).stdout) as { server: { id: string; scope: { kind: string; provider: string } } };
    expect(scopedUpsert.server).toMatchObject({
      id: 'stable',
      scope: { kind: 'provider', provider: 'claude' },
    });

    const scoped = JSON.parse((await runCli(
      ['mcp', 'list', '--scope', 'provider', '--provider', 'claude', '--json'],
      home,
      providerHome,
    )).stdout) as { scope: { kind: string; provider: string }; servers: { id: string; overrideOf: string | null }[] };
    expect(scoped.scope).toEqual({ kind: 'provider', provider: 'claude' });
    expect(scoped.servers[0]).toMatchObject({ id: 'stable', overrideOf: 'stable' });

    const effective = JSON.parse((await runCli(
      ['mcp', 'list', '--effective-provider', 'claude', '--json'],
      home,
      providerHome,
    )).stdout) as { effective: boolean; servers: { id: string; displayName: string }[] };
    expect(effective).toMatchObject({ effective: true, servers: [{ id: 'stable', displayName: 'claude-name' }] });

    await runCli(
      ['mcp', 'rename-display-name', 'stable', 'renamed', '--scope', 'provider', '--provider', 'claude', '--json'],
      home,
      providerHome,
    );
    const read = JSON.parse((await runCli(
      ['mcp', 'read', 'stable', '--scope', 'provider', '--provider', 'claude', '--json'],
      home,
      providerHome,
    )).stdout) as { server: { id: string; displayName: string } };
    expect(read.server).toMatchObject({ id: 'stable', displayName: 'renamed' });

    await runCli(
      ['mcp', 'delete', 'stable', '--scope', 'provider', '--provider', 'claude', '--json'],
      home,
      providerHome,
    );
    const afterDelete = JSON.parse((await runCli(
      ['mcp', 'list', '--effective-provider', 'claude', '--json'],
      home,
      providerHome,
    )).stdout) as { servers: { id: string; displayName: string }[] };
    expect(afterDelete.servers).toEqual([{
      id: 'stable',
      displayName: 'shared-name',
      server: { command: 'node' },
      scope: { kind: 'shared' },
      overrideOf: null,
      issues: [],
      conflictStatus: { state: 'none' },
    }]);
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

  test('previews unmanaged skill files through the read-only inspect command', async () => {
    const { home, providerHome } = await useTempHomes();
    const source = path.join(providerHome, '.claude', 'skills', 'local-preview');
    await mkdir(path.join(source, 'references'), { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), '# Local preview\n');
    await writeFile(path.join(source, 'references', 'notes.md'), 'hello preview\n');

    const tree = JSON.parse(
      (await runCli(['skills', 'inspect', 'claude', 'local-preview', '--json'], home, providerHome)).stdout,
    ) as { tree: { scope: { kind: string; provider: string }; files: { path: string }[] } };
    const document = JSON.parse(
      (await runCli(
        ['skills', 'inspect', 'claude', 'local-preview', 'references/notes.md', '--json'],
        home,
        providerHome,
      )).stdout,
    ) as { document: { content: string } };

    expect(tree.tree.scope).toEqual({ kind: 'unmanaged', provider: 'claude' });
    expect(tree.tree.files.map((file) => file.path)).toEqual(['references/notes.md', 'SKILL.md']);
    expect(document.document.content).toBe('hello preview\n');
    expect(await Bun.file(path.join(home, 'skills', 'local-preview')).exists()).toBe(false);
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
      shared: { name: string; path: string; fileCount: number; shadowedBy: string[]; syncProviders: string[] }[];
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
        syncProviders: ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'],
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

  test('public CLI does not expose sync commands', async () => {
    const { home, providerHome } = await useTempHomes();

    const help = (await runCli(['--help'], home, providerHome)).stdout;

    expect(help).not.toContain(' login');
    expect(help).not.toContain(' register');
    expect(help).not.toContain(' pair');
    expect(help).not.toContain(' sync');
    await expect(runCli(['sync'], home, providerHome)).rejects.toMatchObject({ code: 1 });
    await expect(runCli(['login', 'http://reglet.test', '--token', 'dev-token'], home, providerHome)).rejects.toMatchObject({ code: 1 });
    expect(await Bun.file(path.join(home, '.state', 'sync.json')).exists()).toBe(false);
  });

  test('manager snapshot is redacted and legacy network state stays inert', async () => {
    const { home, providerHome } = await useTempHomes();
    await runCli(['init'], home, providerHome);
    await writeFile(path.join(home, '.state', 'sync.json'), '{"deviceToken":"legacy-network-secret"}\n');

    const result = await runCli(['manager', 'snapshot', '--json'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as {
      version: number;
      operations: unknown[];
      legacyNetworkState: { present: boolean; paths: string[] };
    };
    expect(snapshot.version).toBe(1);
    expect(snapshot.operations).toEqual([]);
    expect(snapshot.legacyNetworkState).toEqual({ present: true, paths: [path.join(home, '.state', 'sync.json')] });
    expect(result.stdout).not.toContain('legacy-network-secret');
  });

  test('manager snapshot defaults to legacy v1 for the retained Swift decoder', async () => {
    const { home, providerHome } = await useTempHomes();

    const result = await runCli(['manager', 'snapshot', '--json'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as { version: number; scan?: unknown; providerDiscovery?: unknown };

    expect(snapshot.version).toBe(1);
    expect(snapshot.scan).toBeDefined();
    expect(snapshot.providerDiscovery).toBeUndefined();
  });

  test('manager snapshot v2 does not create local state while reading an empty home', async () => {
    const { home, providerHome } = await useTempHomes();

    const result = await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as { state: { state: string; reasons: string[] } };

    expect(snapshot.state).toEqual({ state: 'draftOnly', reasons: ['noDestinationsEnrolled'] });
    await expect(stat(path.join(home, '.state'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('manager snapshot v2 separates discovery, sources, enrollment, and effective destinations', async () => {
    const { home, providerHome } = await useTempHomes();
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const codexRules = path.join(providerHome, '.codex', 'AGENTS.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(codexRules), { recursive: true });
    await writeFile(claudeRules, 'claude source\n');
    await writeFile(codexRules, 'codex source only\n');
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'master\n');
    await runCli(['enroll', 'claude'], home, providerHome);

    const result = await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as {
      version: number;
      safety: { localOnly: boolean; requiresExplicitReview: boolean };
      providerDiscovery: { provider: string; capabilities: { skills: { state: string; reason?: string } } }[];
      sourceInventory: { provider: string; content: string; path: string | null }[];
      enrollmentMatrix: { provider: string; cells: { rules: { enrolled: boolean } } }[];
      effectiveProviders: { provider: string }[];
    };

    expect(snapshot.version).toBe(2);
    expect(snapshot.safety).toEqual({ localOnly: true, requiresExplicitReview: true });
    expect(snapshot.providerDiscovery).toHaveLength(6);
    expect(snapshot.providerDiscovery.find((provider) => provider.provider === 'windsurf')?.capabilities.skills)
      .toEqual({ state: 'unsupported', reason: 'provider has no skills directory' });
    expect(snapshot.sourceInventory).toContainEqual(expect.objectContaining({ provider: 'codex', content: 'rules', path: codexRules }));
    expect(snapshot.enrollmentMatrix.find((provider) => provider.provider === 'claude')?.cells.rules.enrolled).toBe(true);
    expect(snapshot.effectiveProviders.map((provider) => provider.provider)).toEqual(['claude']);
  });

  test('manager snapshot v2 derives changes, current, and drift states from revisions and hashes', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await writeFile(path.join(home, 'rules', '00-general.md'), 'master\n');
    await runCli(['enroll', 'claude'], home, providerHome);
    await runCli(['unenroll', 'claude:skills'], home, providerHome);
    await runCli(['unenroll', 'claude:mcp'], home, providerHome);

    const changes = JSON.parse(
      (await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome)).stdout,
    ) as { state: { state: string; reasons: string[] } };
    expect(changes.state).toEqual({ state: 'changesReady', reasons: ['noAppliedRevision'] });

    await runCli(['apply', '--provider', 'claude', '--content', 'rules'], home, providerHome);
    const current = JSON.parse(
      (await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome)).stdout,
    ) as { state: { state: string; reasons: string[] }; effectiveProviders: { contents: { rules?: { compositionRevision?: string; lastAppliedCompositionRevision?: string } } }[] };
    expect(current.state).toEqual({ state: 'upToDate', reasons: ['compositionRevisionCurrent'] });
    expect(current.effectiveProviders[0]?.contents.rules?.lastAppliedCompositionRevision)
      .toBe(current.effectiveProviders[0]?.contents.rules?.compositionRevision);

    await writeFile(path.join(providerHome, '.claude', 'CLAUDE.md'), 'local edit\n');
    const drift = JSON.parse(
      (await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome)).stdout,
    ) as { state: { state: string; reasons: string[] } };
    expect(drift.state).toEqual({ state: 'driftDetected', reasons: ['managedOutputModified'] });
  });

  test('manager snapshot v2 loads legacy manifests without silently rewriting them', async () => {
    const { home, providerHome } = await useTempHomes();
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'legacy output\n');
    await mkdir(path.join(home, '.state'), { recursive: true, mode: 0o700 });
    const manifestPath = path.join(home, '.state', 'manifest.json');
    const legacyManifest = `${JSON.stringify({
      version: 1,
      outputs: {
        [outputPath]: {
          provider: 'claude',
          content: 'rules',
          hash: 'legacy-hash',
          appliedAt: '2026-07-13T00:00:00.000Z',
          backedUpTo: null,
        },
      },
    }, null, 2)}\n`;
    await writeFile(manifestPath, legacyManifest, { mode: 0o600 });

    const result = await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as { driftInbox: { status: string }[] };

    expect(snapshot.driftInbox[0]?.status).toBe('modified');
    expect(await readFile(manifestPath, 'utf8')).toBe(legacyManifest);
  });

  test('manager snapshot v2 tracks an applied skills composition across per-skill outputs', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'skills', 'review'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'review', 'SKILL.md'), '# Review\n');
    await runCli(['enroll', 'claude'], home, providerHome);
    await runCli(['unenroll', 'claude:rules'], home, providerHome);
    await runCli(['unenroll', 'claude:mcp'], home, providerHome);

    await runCli(['apply', '--provider', 'claude', '--content', 'skills'], home, providerHome);
    const snapshot = JSON.parse(
      (await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome)).stdout,
    ) as { state: { state: string; reasons: string[] }; effectiveProviders: { contents: { skills?: { compositionRevision?: string; lastAppliedCompositionRevision?: string } } }[] };

    expect(snapshot.state).toEqual({ state: 'upToDate', reasons: ['compositionRevisionCurrent'] });
    expect(snapshot.effectiveProviders[0]?.contents.skills?.lastAppliedCompositionRevision)
      .toBe(snapshot.effectiveProviders[0]?.contents.skills?.compositionRevision);

    await rm(path.join(home, 'skills', 'review'), { recursive: true });
    await runCli(['apply', '--provider', 'claude', '--content', 'skills'], home, providerHome);
    const emptySnapshot = JSON.parse(
      (await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome)).stdout,
    ) as { state: { state: string; reasons: string[] }; effectiveProviders: { contents: { skills?: { compositionRevision?: string; lastAppliedCompositionRevision?: string } } }[] };
    expect(emptySnapshot.state).toEqual({ state: 'upToDate', reasons: ['compositionRevisionCurrent'] });
    expect(emptySnapshot.effectiveProviders[0]?.contents.skills?.lastAppliedCompositionRevision)
      .toBe(emptySnapshot.effectiveProviders[0]?.contents.skills?.compositionRevision);
  });

  test('manager snapshot v2 reports needs-attention cells and does not resolve MCP secret environment values', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(providerHome, '.claude'), { recursive: true });
    await writeFile(path.join(providerHome, '.claude.json'), '{not-json manager-source-secret-canary}');
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { secretServer: { command: 'node', env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_SECRET' } } } } }, null, 2)}\n`,
    );
    await runCli(['enroll', 'claude'], home, providerHome);

    const result = await runCli(
      ['manager', 'snapshot', '--json', '--contract-version', '2'],
      home,
      providerHome,
      { REGLET_TEST_SECRET: 'resolved-secret-value' },
    );
    const snapshot = JSON.parse(result.stdout) as {
      providerDiscovery: { provider: string; capabilities: { mcp: { state: string; reason?: string } } }[];
      enrollmentMatrix: { provider: string; cells: { mcp: { enrolled: boolean; capability: { state: string } } } }[];
      master: { mcp: { sharedServers: { id: string; name: string; displayName: string; scope: { kind: string }; envKeys: string[]; conflictStatus: { state: string } }[] } };
    };

    expect(result.stdout).not.toContain('resolved-secret-value');
    expect(result.stdout).not.toContain('manager-source-secret-canary');
    expect(snapshot.master.mcp.sharedServers[0]).toMatchObject({
      id: 'secretServer',
      name: 'secretServer',
      displayName: 'secretServer',
      scope: { kind: 'shared' },
      envKeys: ['TOKEN'],
      conflictStatus: { state: 'none' },
    });
    expect(snapshot.providerDiscovery.find((provider) => provider.provider === 'claude')?.capabilities.mcp.state)
      .toBe('needs-attention');
    expect(snapshot.enrollmentMatrix.find((provider) => provider.provider === 'claude')?.cells.mcp.enrolled).toBe(true);
  });

  test('manager snapshot v2 reports blocked state for missing MCP environment', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { local: { command: 'node', env: { TOKEN: { source: 'process-env', name: 'REGLET_MISSING_SECRET' } } } } }, null, 2)}\n`,
    );
    await runCli(['enroll', 'claude'], home, providerHome);

    const result = await runCli(['manager', 'snapshot', '--json', '--contract-version', '2'], home, providerHome);
    const snapshot = JSON.parse(result.stdout) as { state: { state: string; reasons: string[] }; problems: { code: string }[] };

    expect(snapshot.state).toEqual({ state: 'blocked', reasons: ['requiredMcpEnvironmentMissing'] });
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'MISSING_MCP_ENVIRONMENT' }));
  });

  test('manager snapshot rejects unsupported contract versions', async () => {
    const { home, providerHome } = await useTempHomes();

    await expect(runCli(['manager', 'snapshot', '--json', '--contract-version', '3'], home, providerHome))
      .rejects.toMatchObject({ code: 1 });
  });
});
