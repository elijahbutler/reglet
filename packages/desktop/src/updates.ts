import {
  app,
  autoUpdater,
  dialog,
  type BrowserWindow,
} from 'electron';
import {
  isNewerVersion,
  parseGitHubRelease,
} from './update-manifest.js';

const dayMilliseconds = 24 * 60 * 60 * 1_000;
const firstCheckDelayMilliseconds = 15_000;
const defaultReleaseApi =
  'https://api.github.com/repos/elijahbutler/reglet/releases/latest';
const defaultUpdateService = 'https://update.electronjs.org/elijahbutler/reglet';

export function startUpdateChecks(
  getWindow: () => BrowserWindow | undefined,
): void {
  if (
    !app.isPackaged ||
    (process.platform !== 'darwin' && process.platform !== 'win32')
  ) {
    return;
  }

  autoUpdater.on('error', () => {
    console.error('Reglet update download failed.');
  });
  autoUpdater.on('update-downloaded', () => {
    void showDownloadedUpdate(getWindow);
  });

  const firstCheck = setTimeout(() => {
    void checkForApprovedUpdate(getWindow);
  }, firstCheckDelayMilliseconds);
  firstCheck.unref();
  const recurringCheck = setInterval(() => {
    void checkForApprovedUpdate(getWindow);
  }, dayMilliseconds);
  recurringCheck.unref();
}

async function checkForApprovedUpdate(
  getWindow: () => BrowserWindow | undefined,
): Promise<void> {
  try {
    const releaseApi = httpsUrl(
      process.env.REGLET_UPDATE_CHECK_URL ?? defaultReleaseApi,
    );
    const response = await fetch(releaseApi, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Reglet/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return;
    }
    const release = parseGitHubRelease((await response.json()) as unknown);
    if (
      release === undefined ||
      !isNewerVersion(release.version, app.getVersion())
    ) {
      return;
    }

    const result = await showMessage(getWindow(), {
      type: 'info',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Reglet update available',
      message: `Reglet ${release.version} is available.`,
      detail:
        release.releaseNotes.trim().slice(0, 1_000) ||
        'Download now and install the update when Reglet restarts.',
    });
    if (result.response !== 0) {
      return;
    }

    const feedBase = httpsUrl(
      process.env.REGLET_UPDATE_FEED_URL ?? defaultUpdateService,
    ).replace(/\/$/, '');
    autoUpdater.setFeedURL({
      url: `${feedBase}/${process.platform}-${process.arch}/${app.getVersion()}`,
    });
    autoUpdater.checkForUpdates();
  } catch {
    console.error('Reglet update check failed.');
  }
}

async function showDownloadedUpdate(
  getWindow: () => BrowserWindow | undefined,
): Promise<void> {
  const result = await showMessage(getWindow(), {
    type: 'info',
    buttons: ['Restart and install', 'Install on next restart'],
    defaultId: 0,
    cancelId: 1,
    title: 'Reglet update ready',
    message: 'The update is ready to install.',
    detail:
      'Restart Reglet now, or keep working and let the update install on the next restart.',
  });
  if (result.response === 0) {
    autoUpdater.quitAndInstall();
  }
}

function showMessage(
  window: BrowserWindow | undefined,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return window === undefined
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(window, options);
}

function httpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('Update endpoints must use HTTPS.');
  }
  return url.toString();
}
