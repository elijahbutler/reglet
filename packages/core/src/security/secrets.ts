import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

export interface SecretBinding {
  id: string;
  bound: boolean;
}

export interface SecretStore {
  set(id: string, value: string): Promise<SecretBinding>;
  delete(id: string): Promise<SecretBinding>;
  status(id: string): Promise<SecretBinding>;
  /**
   * Internal projection-only access. Callers must never return this value from
   * an API, activity record, diagnostic, or log payload.
   */
  resolve(id: string): Promise<string | undefined>;
}

export class SecretStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreUnavailableError';
  }
}

const secretIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const servicePrefix = 'io.reglet.secret.';

export function systemSecretStore(): SecretStore {
  if (process.platform === 'darwin') {
    return new MacOsKeychainSecretStore();
  }
  if (process.platform === 'linux') {
    return new LinuxSecretServiceStore();
  }
  if (process.platform === 'win32') {
    return new WindowsCredentialStore();
  }
  throw new SecretStoreUnavailableError(
    `OS keychain integration is unavailable on ${process.platform}.`,
  );
}

class MacOsKeychainSecretStore implements SecretStore {
  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    await runSecretCommand(
      '/usr/bin/security',
      [
        'add-generic-password',
        '-a',
        homedir(),
        '-s',
        `${servicePrefix}${id}`,
        '-w',
        value,
        '-U',
      ],
      undefined,
      'Could not bind the secret in macOS Keychain.',
    );
    return { id, bound: true };
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    const result = await runSecretCommand(
      '/usr/bin/security',
      [
        'delete-generic-password',
        '-a',
        homedir(),
        '-s',
        `${servicePrefix}${id}`,
      ],
      undefined,
      'Could not delete the secret from macOS Keychain.',
      true,
    );
    if (result !== 0 && result !== 44) {
      throw new Error('Could not delete the secret from macOS Keychain.');
    }
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    const result = await runSecretCommand(
      '/usr/bin/security',
      [
        'find-generic-password',
        '-a',
        homedir(),
        '-s',
        `${servicePrefix}${id}`,
      ],
      undefined,
      'Could not query macOS Keychain.',
      true,
    );
    return { id, bound: result === 0 };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    return runSecretReadCommand(
      '/usr/bin/security',
      [
        'find-generic-password',
        '-a',
        homedir(),
        '-s',
        `${servicePrefix}${id}`,
        '-w',
      ],
      undefined,
      'Could not read the secret from macOS Keychain.',
    );
  }
}

class LinuxSecretServiceStore implements SecretStore {
  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    await runSecretCommand(
      'secret-tool',
      ['store', '--label', `Reglet ${id}`, 'service', 'reglet', 'id', id],
      value,
      'Could not bind the secret through Secret Service.',
    );
    return { id, bound: true };
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    await runSecretCommand(
      'secret-tool',
      ['clear', 'service', 'reglet', 'id', id],
      undefined,
      'Could not delete the secret through Secret Service.',
    );
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    const result = await runSecretCommand(
      'secret-tool',
      ['lookup', 'service', 'reglet', 'id', id],
      undefined,
      'Could not query Secret Service.',
      true,
    );
    return { id, bound: result === 0 };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    return runSecretReadCommand(
      'secret-tool',
      ['lookup', 'service', 'reglet', 'id', id],
      undefined,
      'Could not read the secret through Secret Service.',
    );
  }
}

class WindowsCredentialStore implements SecretStore {
  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    const script =
      "$vault=New-Object Windows.Security.Credentials.PasswordVault;" +
      "$credential=New-Object Windows.Security.Credentials.PasswordCredential(" +
      `$env:REGLET_SECRET_RESOURCE,$env:USERNAME,$env:REGLET_SECRET_VALUE);` +
      '$vault.Add($credential)';
    await runSecretCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      undefined,
      'Could not bind the secret in Windows Credential Locker.',
      false,
      {
        ...process.env,
        REGLET_SECRET_RESOURCE: `${servicePrefix}${id}`,
        REGLET_SECRET_VALUE: value,
      },
    );
    return { id, bound: true };
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    const script =
      "$vault=New-Object Windows.Security.Credentials.PasswordVault;" +
      'try {$credential=$vault.Retrieve($env:REGLET_SECRET_RESOURCE,$env:USERNAME);' +
      '$vault.Remove($credential)} catch {}';
    await runSecretCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      undefined,
      'Could not delete the secret from Windows Credential Locker.',
      false,
      {
        ...process.env,
        REGLET_SECRET_RESOURCE: `${servicePrefix}${id}`,
      },
    );
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    const script =
      "$vault=New-Object Windows.Security.Credentials.PasswordVault;" +
      'try {$null=$vault.Retrieve($env:REGLET_SECRET_RESOURCE,$env:USERNAME); exit 0}' +
      'catch {exit 1}';
    const result = await runSecretCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      undefined,
      'Could not query Windows Credential Locker.',
      true,
      {
        ...process.env,
        REGLET_SECRET_RESOURCE: `${servicePrefix}${id}`,
      },
    );
    return { id, bound: result === 0 };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    const script =
      "$vault=New-Object Windows.Security.Credentials.PasswordVault;" +
      'try {$credential=$vault.Retrieve($env:REGLET_SECRET_RESOURCE,$env:USERNAME);' +
      '$credential.RetrievePassword();[Console]::Out.Write($credential.Password)}' +
      'catch {exit 1}';
    return runSecretReadCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        ...process.env,
        REGLET_SECRET_RESOURCE: `${servicePrefix}${id}`,
      },
      'Could not read the secret from Windows Credential Locker.',
    );
  }
}

async function runSecretCommand(
  command: string,
  args: string[],
  stdin: string | undefined,
  safeErrorMessage: string,
  allowFailure = false,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let child;
  try {
    child = spawn(command, args, {
      env,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
  } catch {
    throw new SecretStoreUnavailableError(safeErrorMessage);
  }
  child.stdin.end(stdin);
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', () =>
      reject(new SecretStoreUnavailableError(safeErrorMessage)),
    );
    child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0 && !allowFailure) {
    throw new SecretStoreUnavailableError(safeErrorMessage);
  }
  return code;
}

async function runSecretReadCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  safeErrorMessage: string,
): Promise<string | undefined> {
  const child = spawn(command, args, {
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', () =>
      reject(new SecretStoreUnavailableError(safeErrorMessage)),
    );
    child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    return undefined;
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function validateSecretInput(id: string, value: string): void {
  validateSecretId(id);
  if (value.length === 0) {
    throw new Error('Secret value must not be empty.');
  }
}

function validateSecretId(id: string): void {
  if (!secretIdPattern.test(id)) {
    throw new Error('Secret reference ID contains unsupported characters.');
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly bindings = new Map<string, string>();

  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    this.bindings.set(id, value);
    return { id, bound: true };
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    this.bindings.delete(id);
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    return { id, bound: this.bindings.has(id) };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    return this.bindings.get(id);
  }
}
