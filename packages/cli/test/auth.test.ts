import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-auth-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-auth-provider-'));
  return { home: currentHome, providerHome: currentProviderHome };
}

async function runCli(
  args: string[],
  home: string,
  providerHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync('bun', [cliPath, ...args], {
      env: {
        ...process.env,
        REGLET_HOME: home,
        REGLET_PROVIDER_HOME: providerHome,
        ...extraEnv,
      },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.code ?? 1,
    };
  }
}

async function runCliWithInput(
  args: string[],
  input: string,
  home: string,
  providerHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', cliPath, ...args], {
    env: { ...Bun.env, REGLET_HOME: home, REGLET_PROVIDER_HOME: providerHome, ...extraEnv },
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('reglet auth CLI', () => {
  test('status when unauthenticated reports cleanly in text and json', async () => {
    const { home, providerHome } = await useTempHomes();

    const textRes = await runCli(['auth', 'status'], home, providerHome);
    expect(textRes.exitCode).toBe(0);
    expect(textRes.stdout).toContain('No credentials configured');

    const jsonRes = await runCli(['auth', 'status', '--json'], home, providerHome);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.credentials).toEqual([]);

    const singleRes = await runCli(['auth', 'status', 'github'], home, providerHome);
    expect(singleRes.exitCode).toBe(1);
    expect(singleRes.stdout).toContain('auth\tgithub\tnot-authenticated');
  });

  test('login with --token against mock API, verify status, and logout', async () => {
    const { home, providerHome } = await useTempHomes();

    // Start a mock GitHub API server
    const server = createServer((req, res) => {
      if (req.url === '/user' && req.headers.authorization === 'Bearer ghp_mock_cli_pat') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-OAuth-Scopes': 'repo, read:user',
        });
        res.end(JSON.stringify({ id: 54321, login: 'cli-pilot', name: 'CLI Pilot' }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Bad credentials' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const mockUserUrl = `http://127.0.0.1:${address.port}/user`;

    try {
      // 1. Run login --token
      const loginRes = await runCli(
        ['auth', 'login', 'github', '--token', 'ghp_mock_cli_pat'],
        home,
        providerHome,
        { REGLET_GITHUB_USER_API_URL: mockUserUrl },
      );
      expect(loginRes.exitCode).toBe(0);
      expect(loginRes.stdout).toContain('auth\tlogged-in\tprovider=github\tuser=cli-pilot\tscopes=repo,read:user');

      // Verify file persisted in credentials directory
      const rawCred = JSON.parse(await readFile(path.join(home, 'credentials', 'github.json'), 'utf8'));
      expect(rawCred.provider).toBe('github');
      expect(rawCred.token).toBe('ghp_mock_cli_pat');
      expect(rawCred.user?.login).toBe('cli-pilot');

      // 2. Check status for github
      const statusRes = await runCli(['auth', 'status', 'github'], home, providerHome);
      expect(statusRes.exitCode).toBe(0);
      expect(statusRes.stdout).toContain('auth\tgithub\tauthenticated\tuser=cli-pilot');

      // 3. Check status --json
      const jsonRes = await runCli(['auth', 'status', '--json'], home, providerHome);
      expect(jsonRes.exitCode).toBe(0);
      const parsed = JSON.parse(jsonRes.stdout);
      expect(parsed.credentials).toHaveLength(1);
      expect(parsed.credentials[0]?.provider).toBe('github');

      // 4. Logout
      const logoutRes = await runCli(['auth', 'logout', 'github', '-y'], home, providerHome);
      expect(logoutRes.exitCode).toBe(0);
      expect(logoutRes.stdout).toContain('auth\tgithub\tlogged-out');

      // 5. Verify status is unauthenticated again
      const afterRes = await runCli(['auth', 'status', 'github'], home, providerHome);
      expect(afterRes.exitCode).toBe(1);
    } finally {
      server.close();
    }
  });

  test('login with device flow against mock OAuth server', async () => {
    const { home, providerHome } = await useTempHomes();

    const server = createServer((req, res) => {
      if (req.url === '/device/code') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          device_code: 'mock_device_code_123',
          user_code: 'WDJB-MJHT',
          verification_uri: 'http://127.0.0.1/verify',
          expires_in: 300,
          interval: 1,
        }));
        return;
      }
      if (req.url === '/oauth/access_token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'gho_device_authorized_token',
          token_type: 'bearer',
          scope: 'repo,read:user',
        }));
        return;
      }
      if (req.url === '/user') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-OAuth-Scopes': 'repo, read:user',
        });
        res.end(JSON.stringify({ id: 8888, login: 'octodev' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const loginRes = await runCli(
        ['auth', 'login', 'github', '--client-id', 'mock_client_id_abc', '--no-browser'],
        home,
        providerHome,
        {
          REGLET_GITHUB_DEVICE_CODE_URL: `${baseUrl}/device/code`,
          REGLET_GITHUB_ACCESS_TOKEN_URL: `${baseUrl}/oauth/access_token`,
          REGLET_GITHUB_USER_API_URL: `${baseUrl}/user`,
        },
      );
      expect(loginRes.exitCode).toBe(0);
      expect(loginRes.stdout).toContain('WDJB-MJHT');
      expect(loginRes.stdout).toContain('auth\tlogged-in\tprovider=github\tuser=octodev');

      const rawCred = JSON.parse(await readFile(path.join(home, 'credentials', 'github.json'), 'utf8'));
      expect(rawCred.token).toBe('gho_device_authorized_token');
      expect(rawCred.user?.login).toBe('octodev');
    } finally {
      server.close();
    }
  });

  test('resolves OAuth token into MCP servers during preview and apply', async () => {
    const { home, providerHome } = await useTempHomes();

    // 1. Initialize master directory and enroll claude
    await runCli(['init'], home, providerHome);
    await runCli(['enroll', 'claude'], home, providerHome);

    // 2. Log in with token
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-OAuth-Scopes': 'repo' });
      res.end(JSON.stringify({ id: 100, login: 'mcp-user' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const mockUserUrl = `http://127.0.0.1:${address.port}/user`;

    try {
      await runCli(
        ['auth', 'login', 'github', '--token', 'ghp_oauth_mcp_test_token'],
        home,
        providerHome,
        { REGLET_GITHUB_USER_API_URL: mockUserUrl },
      );

      // 3. Upsert MCP server with oauth source
      const mcpDef = JSON.stringify({
        command: 'node',
        args: ['server.js'],
        env: {
          GITHUB_TOKEN: { source: 'oauth', provider: 'github' },
        },
      });

      const upsertRes = await runCliWithInput(['mcp', 'upsert', 'github-tool'], mcpDef, home, providerHome);
      expect(upsertRes.exitCode).toBe(0);

      // 4. Preview apply - check redaction
      const previewRes = await runCli(['apply-structured', 'preview', '-p', 'claude', '-c', 'mcp'], home, providerHome);
      expect(previewRes.exitCode).toBe(0);
      expect(previewRes.stdout).toContain('<redacted:GITHUB_TOKEN>');
      expect(previewRes.stdout).not.toContain('ghp_oauth_mcp_test_token');

      // 5. Apply
      const applyRes = await runCli(['apply', '-p', 'claude', '-c', 'mcp'], home, providerHome);
      expect(applyRes.exitCode).toBe(0);

      // 6. Check that provider config received the actual resolved token
      const claudeConfig = JSON.parse(await readFile(path.join(providerHome, '.claude.json'), 'utf8'));
      expect(claudeConfig.mcpServers['github-tool'].env.GITHUB_TOKEN).toBe('ghp_oauth_mcp_test_token');
    } finally {
      server.close();
    }
  });
});
