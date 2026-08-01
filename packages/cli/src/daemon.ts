import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { watch } from 'chokidar';
import {
  appendDriftEvent,
  applyAll,
  detectDrift,
  getAdapter,
  loadConfig,
  regletHome,
  type ProviderId,
} from '@reglet/core';

export interface DaemonRunOptions {
  debounceMs?: number;
}

export interface ServiceSpec {
  kind: 'launchd' | 'schtasks';
  path?: string;
  command: string[];
  content?: string;
}

const daemonLabel = 'com.reglet.daemon';

export async function runDaemon(options: DaemonRunOptions = {}): Promise<void> {
  const debounceMs = options.debounceMs ?? 500;
  const home = regletHome();
  await assertDaemonAllowed();
  await mkdir(path.join(home, '.state'), { recursive: true });
  await writeFile(pidPath(home), `${process.pid}\n`);
  await logDaemon(`reglet daemon started pid=${process.pid}`);

  let applyTimer: NodeJS.Timeout | undefined;
  let driftTimer: NodeJS.Timeout | undefined;

  const scheduleApply = (): void => {
    if (applyTimer !== undefined) {
      clearTimeout(applyTimer);
    }
    applyTimer = setTimeout(() => {
      void applyFromDaemon();
    }, debounceMs);
  };

  const scheduleDrift = (): void => {
    if (driftTimer !== undefined) {
      clearTimeout(driftTimer);
    }
    driftTimer = setTimeout(() => {
      void queueDriftFromDaemon();
    }, debounceMs);
  };

  const providerPaths = await managedProviderPaths();
  const watcher = watch(
    [
      path.join(home, 'rules'),
      path.join(home, 'skills'),
      path.join(home, 'mcp'),
      path.join(home, 'reglet.toml'),
    ],
    { ignoreInitial: true },
  );
  watcher.on('add', scheduleApply).on('change', scheduleApply).on('unlink', scheduleApply);
  const watcherReady = new Promise<void>((resolve) => watcher.once('ready', resolve));

  const providerWatcher = watch(providerPaths, { ignoreInitial: true });
  providerWatcher.on('add', scheduleDrift).on('change', scheduleDrift).on('unlink', scheduleDrift);
  const providerWatcherReady = new Promise<void>((resolve) => providerWatcher.once('ready', resolve));
  await Promise.all([watcherReady, providerWatcherReady]);
  await logDaemon('reglet daemon watching');

  await new Promise<void>((resolve) => {
    let stopping = false;
    const shutdown = (): void => {
      if (stopping) return;
      stopping = true;
      if (applyTimer !== undefined) clearTimeout(applyTimer);
      if (driftTimer !== undefined) clearTimeout(driftTimer);
      void Promise.all([watcher.close(), providerWatcher.close()])
        .then(async () => {
          await rm(pidPath(home), { force: true });
          await logDaemon('reglet daemon stopped');
        })
        .finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

export async function startDaemon(): Promise<number> {
  const home = regletHome();
  await assertDaemonAllowed();
  const current = await readRunningPid(home);
  if (current !== null) {
    return current;
  }

  await mkdir(path.join(home, '.state'), { recursive: true });
  const logFd = await openLogFd(home);
  const child = spawn(process.execPath, [currentCliPath(), 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  await writeFile(pidPath(home), `${child.pid ?? ''}\n`);
  return child.pid ?? 0;
}

export async function stopDaemon(): Promise<boolean> {
  const home = regletHome();
  const current = await readRunningPid(home);
  if (current === null) {
    await rm(pidPath(home), { force: true });
    return false;
  }

  process.kill(current, 'SIGTERM');
  await rm(pidPath(home), { force: true });
  return true;
}

export async function daemonStatus(): Promise<'running' | 'stopped'> {
  return (await readRunningPid(regletHome())) === null ? 'stopped' : 'running';
}

export async function installDaemon(platform = process.platform, homeDir = os.homedir()): Promise<ServiceSpec> {
  await assertDaemonAllowed();
  const spec = daemonServiceSpec(platform, homeDir);
  if (spec.kind === 'launchd') {
    if (spec.path === undefined || spec.content === undefined) {
      throw new Error('Invalid launchd service spec');
    }
    await mkdir(path.dirname(spec.path), { recursive: true });
    await writeFile(spec.path, spec.content);
    spawn(spec.command[0] ?? 'launchctl', spec.command.slice(1), { stdio: 'inherit' });
    return spec;
  }

  spawn(spec.command[0] ?? 'schtasks', spec.command.slice(1), { stdio: 'inherit' });
  return spec;
}

export async function uninstallDaemon(platform = process.platform, homeDir = os.homedir()): Promise<ServiceSpec> {
  const spec = daemonUninstallSpec(platform, homeDir);
  if (spec.kind === 'launchd' && spec.path !== undefined) {
    spawn(spec.command[0] ?? 'launchctl', spec.command.slice(1), { stdio: 'inherit' });
    await rm(spec.path, { force: true });
    return spec;
  }

  spawn(spec.command[0] ?? 'schtasks', spec.command.slice(1), { stdio: 'inherit' });
  return spec;
}

export function daemonServiceSpec(platform: NodeJS.Platform, homeDir: string): ServiceSpec {
  const cliPath = currentCliPath();
  if (platform === 'darwin') {
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${daemonLabel}.plist`);
    return {
      kind: 'launchd',
      path: plistPath,
      command: ['launchctl', 'load', plistPath],
      content: renderLaunchdPlist(cliPath),
    };
  }

  if (platform === 'win32') {
    return {
      kind: 'schtasks',
      command: [
        'schtasks',
        '/create',
        '/tn',
        daemonLabel,
        '/sc',
        'onlogon',
        '/tr',
        `"${process.execPath}" "${cliPath}" daemon run`,
        '/f',
      ],
    };
  }

  throw new Error(`Daemon install is unsupported on ${platform}`);
}

export function daemonUninstallSpec(platform: NodeJS.Platform, homeDir: string): ServiceSpec {
  if (platform === 'darwin') {
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${daemonLabel}.plist`);
    return {
      kind: 'launchd',
      path: plistPath,
      command: ['launchctl', 'unload', plistPath],
    };
  }

  if (platform === 'win32') {
    return {
      kind: 'schtasks',
      command: ['schtasks', '/delete', '/tn', daemonLabel, '/f'],
    };
  }

  throw new Error(`Daemon uninstall is unsupported on ${platform}`);
}

async function managedProviderPaths(): Promise<string[]> {
  const config = await loadConfig();
  const paths: string[] = [];
  for (const provider of Object.keys(config.providers) as ProviderId[]) {
    if (!config.providers[provider].enabled) {
      continue;
    }
    const adapter = getAdapter(provider);
    const rulesPath = adapter.rulesPath();
    const mcpPath = adapter.mcpPath();
    const skillsDir = adapter.skillsDir();
    if (config.providers[provider].rules && rulesPath !== null) {
      paths.push(rulesPath);
    }
    if (config.providers[provider].mcp && mcpPath !== null) {
      paths.push(mcpPath);
    }
    if (config.providers[provider].skills && skillsDir !== null) {
      paths.push(skillsDir);
    }
  }
  return paths;
}

async function assertDaemonAllowed(): Promise<void> {
  const config = await loadConfig();
  if (Object.values(config.providers).every((provider) => !provider.enabled)) {
    throw new Error('Refusing to run daemon before onboarding: no providers are enrolled. Run reglet init first.');
  }
}

async function applyFromDaemon(): Promise<void> {
  try {
    await applyAll();
    await logDaemon('applied master changes');
  } catch (error) {
    await logDaemon(`apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function queueDriftFromDaemon(): Promise<void> {
  try {
    const drift = (await detectDrift()).filter((record) => record.status !== 'clean');
    for (const record of drift) {
      await appendDriftEvent(record);
      await logDaemon(`queued drift ${record.provider}:${record.content}:${record.status} ${record.outputPath}`);
    }
    if (drift.length > 0 && process.platform === 'darwin' && notificationsEnabled()) {
      spawn('osascript', ['-e', 'display notification "Provider config drift detected" with title "Reglet"'], {
        stdio: 'ignore',
      });
    }
  } catch (error) {
    await logDaemon(`drift detection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function notificationsEnabled(): boolean {
  return process.env.REGLET_ENABLE_NOTIFICATIONS === '1';
}

async function readRunningPid(home: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(pidPath(home), 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ESRCH')) {
      return null;
    }
    return null;
  }
}

async function openLogFd(home: string): Promise<number> {
  return openSync(path.join(home, '.state', 'daemon.log'), 'a');
}

async function logDaemon(message: string): Promise<void> {
  const line = `${new Date().toISOString()} ${message}\n`;
  await mkdir(path.join(regletHome(), '.state'), { recursive: true });
  await writeFile(path.join(regletHome(), '.state', 'daemon.log'), line, { flag: 'a' });
  console.log(line.trimEnd());
}

function renderLaunchdPlist(cliPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${daemonLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

function pidPath(home: string): string {
  return path.join(home, '.state', 'daemon.pid');
}

function currentCliPath(): string {
  return fileURLToPath(import.meta.url).endsWith(`${path.sep}daemon.ts`)
    ? path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')
    : fileURLToPath(import.meta.url);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
