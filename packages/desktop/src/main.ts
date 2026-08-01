import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  session,
  shell,
  type WebContents,
} from 'electron';
import startedBySquirrel from 'electron-squirrel-startup';
import {
  parseRuntimeStartup,
  redactRuntimeError,
  validateRuntimeStartup,
  type RuntimeStartup,
} from './runtime-bootstrap.js';
import { startUpdateChecks } from './updates.js';

interface ManagedRuntime {
  process: RuntimeProcess;
  startup: RuntimeStartup;
}

type RuntimeProcess = ChildProcessByStdio<null, Readable, Readable>;

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const allowedExternalHosts = new Set([
  'learn.chatgpt.com',
  'docs.anthropic.com',
  'docs.cursor.com',
  'docs.windsurf.com',
  'opencode.ai',
  'github.com',
]);
let runtime: ManagedRuntime | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;

app.enableSandbox();
app.setAppUserModelId('com.squirrel.reglet.reglet');
if (startedBySquirrel || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktop).catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    app.exit(1);
  });
}

app.on('before-quit', () => {
  quitting = true;
  stopRuntime();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow !== undefined) {
    mainWindow.show();
    return;
  }
  void createWindow();
});

async function startDesktop(): Promise<void> {
  configureSessionSecurity();
  runtime = await startRuntime();
  await createWindow();
  startUpdateChecks(() => mainWindow);
}

async function createWindow(): Promise<void> {
  if (runtime === undefined) {
    runtime = await startRuntime();
  }
  const runtimeOrigin = new URL(runtime.startup.url).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#040506',
    title: 'Reglet',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = window;
  secureWebContents(window.webContents, runtimeOrigin);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  await window.loadURL(runtime.startup.managerUrl);
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

function secureWebContents(contents: WebContents, runtimeOrigin: string): void {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (!isRuntimeUrl(navigationUrl, runtimeOrigin)) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function isRuntimeUrl(value: string, runtimeOrigin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === runtimeOrigin && url.pathname.startsWith('/manager/');
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedExternalHosts.has(url.hostname);
  } catch {
    return false;
  }
}

async function startRuntime(): Promise<ManagedRuntime> {
  const managerAssets = app.isPackaged
    ? path.join(process.resourcesPath, 'manager')
    : path.resolve(sourceDirectory, '..', '..', 'manager');
  const command = runtimeCommand();
  const processHandle = spawn(command.executable, command.args, {
    cwd: app.getPath('userData'),
    env: {
      ...process.env,
      REGLET_MANAGER_ASSETS_DIR: managerAssets,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const startup = await waitForRuntimeStartup(processHandle);
  validateRuntimeStartup(startup);
  processHandle.once('exit', (code) => {
    if (!quitting && code !== 0) {
      console.error(`Reglet runtime exited with code ${code ?? 'unknown'}.`);
      app.quit();
    }
  });
  return { process: processHandle, startup };
}

function runtimeCommand(): { executable: string; args: string[] } {
  if (app.isPackaged) {
    const executable = path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'reglet.exe' : 'reglet',
    );
    return {
      executable,
      args: ['serve', '--hostname', '127.0.0.1', '--port', '0', '--json'],
    };
  }
  const cliEntry = path.resolve(
    sourceDirectory,
    '..',
    '..',
    'cli',
    'src',
    'index.ts',
  );
  return {
    executable: process.env.REGLET_BUN_PATH ?? 'bun',
    args: [
      cliEntry,
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
      '--json',
    ],
  };
}

function waitForRuntimeStartup(
  processHandle: RuntimeProcess,
): Promise<RuntimeStartup> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      processHandle.kill();
      reject(new Error('The local Reglet runtime did not become ready in time.'));
    }, 15_000);
    const finish = (callback: () => void): void => {
      clearTimeout(timer);
      processHandle.stdout.removeAllListeners();
      processHandle.stderr.removeAllListeners();
      processHandle.removeAllListeners('error');
      processHandle.removeAllListeners('exit');
      callback();
    };
    processHandle.stdout.setEncoding('utf8');
    processHandle.stderr.setEncoding('utf8');
    processHandle.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const parsed = parseRuntimeStartup(stdout);
      if (parsed !== undefined) {
        finish(() => resolve(parsed));
      }
    });
    processHandle.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_192);
    });
    processHandle.once('error', (error) => finish(() => reject(error)));
    processHandle.once('exit', (code) => {
      finish(() =>
        reject(
          new Error(
            `The local Reglet runtime exited before startup (${code ?? 'unknown'}): ${redactRuntimeError(stderr)}`,
          ),
        ),
      );
    });
  });
}

function stopRuntime(): void {
  if (runtime === undefined) return;
  runtime.process.kill();
  runtime = undefined;
}

function safeErrorMessage(error: unknown): string {
  return redactRuntimeError(
    error instanceof Error ? error.message : 'Desktop startup failed.',
  );
}
