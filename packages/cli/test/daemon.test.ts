import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'bun:test';
import { daemonServiceSpec, daemonUninstallSpec } from '../src/daemon.js';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(import.meta.dir, '..', 'src', 'index.ts');
let currentHome: string | undefined;
let currentProviderHome: string | undefined;
let currentDaemon: ChildProcess | undefined;

afterEach(async () => {
  await stopCurrentDaemon();
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    currentHome = undefined;
  }
  if (currentProviderHome !== undefined) {
    await rm(currentProviderHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    currentProviderHome = undefined;
  }
});

async function stopCurrentDaemon(): Promise<void> {
  const daemon = currentDaemon;
  currentDaemon = undefined;
  if (daemon === undefined || daemon.exitCode !== null || daemon.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    daemon.once('exit', () => resolve());
    daemon.kill('SIGTERM');
  });
}

async function useTempHomes(): Promise<{ home: string; providerHome: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-daemon-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-daemon-provider-'));
  return { home: currentHome, providerHome: currentProviderHome };
}

describe('daemon service specs', () => {
  test('renders a macOS launchd service spec', () => {
    const home = path.join(path.sep, 'Users', 'test');
    const spec = daemonServiceSpec('darwin', home);

    expect(spec.kind).toBe('launchd');
    expect(spec.path).toBe(path.join(home, 'Library', 'LaunchAgents', 'com.reglet.daemon.plist'));
    expect(spec.command).toEqual(['launchctl', 'load', spec.path]);
    expect(spec.content).toContain('<string>com.reglet.daemon</string>');
    expect(spec.content).toContain('<string>daemon</string>');
    expect(spec.content).toContain('<string>run</string>');
    expect(spec.content).toContain('<key>RunAtLoad</key>');
    expect(spec.content).toContain('<key>KeepAlive</key>');
  });

  test('renders Windows scheduled task install and uninstall specs', () => {
    const install = daemonServiceSpec('win32', 'C:\\Users\\test');
    const uninstall = daemonUninstallSpec('win32', 'C:\\Users\\test');

    expect(install.kind).toBe('schtasks');
    expect(install.command.slice(0, 8)).toEqual([
      'schtasks',
      '/create',
      '/tn',
      'com.reglet.daemon',
      '/sc',
      'onlogon',
      '/tr',
      install.command[7],
    ]);
    expect(install.command[7]).toContain('daemon run');
    expect(uninstall.command).toEqual(['schtasks', '/delete', '/tn', 'com.reglet.daemon', '/f']);
  });

  test('rejects unsupported service platforms', () => {
    expect(() => daemonServiceSpec('linux', '/home/test')).toThrow('unsupported');
    expect(() => daemonUninstallSpec('linux', '/home/test')).toThrow('unsupported');
  });
});

describe('daemon watcher', () => {
  test('refuses to run before onboarding enrolls a provider', async () => {
    const { home, providerHome } = await useTempHomes();

    await expect(execCli(['daemon', 'run'], home, providerHome)).rejects.toMatchObject({
      code: 1,
    });
    await expect(readFile(path.join(home, '.state', 'daemon.pid'), 'utf8')).rejects.toThrow();
  });

  test('applies provider output when master rules change', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeClaudeConfig(home, providerHome, 'Initial rules.\n');
    currentDaemon = startDaemonProcess(home, providerHome);
    await waitForDaemonReady(home);

    await writeFile(path.join(home, 'rules', '00-general.md'), 'Updated rules.\n');

    await waitFor(async () => {
      try {
        return (await readFile(path.join(providerHome, '.claude', 'CLAUDE.md'), 'utf8')).includes('Updated rules.');
      } catch {
        return false;
      }
    });
  }, 10000);

  test('queues drift when a provider output is edited externally', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeClaudeConfig(home, providerHome, 'Initial rules.\n');
    await applyOnce(home, providerHome);
    currentDaemon = startDaemonProcess(home, providerHome);
    await waitForDaemonReady(home);

    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await writeFile(outputPath, `${await readFile(outputPath, 'utf8')}\nExternal edit.\n`);

    await waitFor(async () => {
      try {
        const queue = JSON.parse(await readFile(path.join(home, '.state', 'drift.json'), 'utf8')) as unknown;
        return (
          typeof queue === 'object' &&
          queue !== null &&
          'events' in queue &&
          Array.isArray(queue.events) &&
          queue.events.some((event) => event.provider === 'claude' && event.content === 'rules')
        );
      } catch {
        return false;
      }
    });
  }, 10000);
});

async function execCli(args: string[], home: string, providerHome: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('bun', [cliPath, ...args], {
    env: {
      ...process.env,
      REGLET_HOME: home,
      REGLET_PROVIDER_HOME: providerHome,
    },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function writeClaudeConfig(home: string, providerHome: string, rules: string): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await mkdir(path.join(providerHome, '.claude'), { recursive: true });
  await writeFile(path.join(home, 'rules', '00-general.md'), rules);
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
}

function startDaemonProcess(home: string, providerHome: string): ChildProcess {
  return spawn('bun', [cliPath, 'daemon', 'run'], {
    env: {
      ...process.env,
      REGLET_HOME: home,
      REGLET_PROVIDER_HOME: providerHome,
    },
    stdio: 'ignore',
  });
}

async function applyOnce(home: string, providerHome: string): Promise<void> {
  const child = spawn('bun', [cliPath, 'apply', '--provider', 'claude', '--content', 'rules'], {
    env: {
      ...process.env,
      REGLET_HOME: home,
      REGLET_PROVIDER_HOME: providerHome,
    },
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`apply exited with ${code}`));
      }
    });
    child.once('error', reject);
  });
}

async function waitForFile(filePath: string): Promise<void> {
  await waitFor(async () => {
    try {
      await readFile(filePath, 'utf8');
      return true;
    } catch {
      return false;
    }
  });
}

async function waitForDaemonReady(home: string): Promise<void> {
  await waitForFile(path.join(home, '.state', 'daemon.pid'));
  await waitFor(async () => {
    try {
      return (await readFile(path.join(home, '.state', 'daemon.log'), 'utf8')).includes('reglet daemon watching');
    } catch {
      return false;
    }
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
}
