import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  PendingSyncV2BootstrapSecrets,
  PendingSyncV2PairSecrets,
  SyncV2DeviceSecrets,
} from './v2-types.js';

export interface SyncV2SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const credentialService = 'build.reglet.sync.v2';
const maximumCredentialBytes = 16 * 1024;

export function activeSyncV2CredentialId(serverUrl: string): string {
  return `active-${serverIdentity(serverUrl)}`;
}

export function pendingSyncV2CredentialId(serverUrl: string): string {
  return `pending-${serverIdentity(serverUrl)}`;
}

export function platformSyncV2SecretStore(platform = process.platform): SyncV2SecretStore {
  if (platform === 'darwin') return new MacKeychainSecretStore();
  if (platform === 'win32') return new WindowsCredentialManagerSecretStore();
  throw new Error('Encrypted sync preview supports client credential storage on macOS and Windows only');
}

export async function saveSyncV2DeviceSecrets(
  account: string,
  secrets: SyncV2DeviceSecrets,
  store = platformSyncV2SecretStore(),
): Promise<void> {
  await store.set(account, JSON.stringify(secrets));
}

export async function loadSyncV2DeviceSecrets(
  account: string,
  store = platformSyncV2SecretStore(),
): Promise<SyncV2DeviceSecrets> {
  const value = await store.get(account);
  if (value === null) throw new Error('Sync credentials are missing from the operating system credential store');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Sync credentials in the operating system credential store are invalid');
  }
  if (!isDeviceSecrets(parsed)) throw new Error('Sync credentials in the operating system credential store are invalid');
  return parsed;
}

export async function savePendingSyncV2Secrets(
  account: string,
  secrets: PendingSyncV2PairSecrets,
  store = platformSyncV2SecretStore(),
): Promise<void> {
  await store.set(account, JSON.stringify(secrets));
}

export async function loadPendingSyncV2Secrets(
  account: string,
  store = platformSyncV2SecretStore(),
): Promise<PendingSyncV2PairSecrets> {
  const value = await store.get(account);
  if (value === null) throw new Error('Pending pairing credentials are missing from the operating system credential store');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Pending pairing credentials in the operating system credential store are invalid');
  }
  if (!isPendingSecrets(parsed)) {
    throw new Error('Pending pairing credentials in the operating system credential store are invalid');
  }
  return parsed;
}

export async function savePendingSyncV2BootstrapSecrets(
  account: string,
  secrets: PendingSyncV2BootstrapSecrets,
  store = platformSyncV2SecretStore(),
): Promise<void> {
  await store.set(account, JSON.stringify(secrets));
}

export async function loadPendingSyncV2BootstrapSecrets(
  account: string,
  store = platformSyncV2SecretStore(),
): Promise<PendingSyncV2BootstrapSecrets> {
  const value = await store.get(account);
  if (value === null) throw new Error('Pending connection credentials are missing from the operating system credential store');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Pending connection credentials in the operating system credential store are invalid');
  }
  if (!isBootstrapSecrets(parsed)) {
    throw new Error('Pending connection credentials in the operating system credential store are invalid');
  }
  return parsed;
}

class MacKeychainSecretStore implements SyncV2SecretStore {
  async get(account: string): Promise<string | null> {
    const result = await runCredentialCommand(
      'security',
      ['find-generic-password', '-a', account, '-s', credentialService, '-w'],
      '',
      44,
    );
    return result === null ? null : result.replace(/\r?\n$/, '');
  }

  async set(account: string, secret: string): Promise<void> {
    requireBoundedSecret(secret);
    // Omitting the -w argument makes `security` read and confirm the value from
    // stdin instead of exposing it in the process list.
    await runCredentialCommand(
      'security',
      ['add-generic-password', '-a', account, '-s', credentialService, '-U', '-w'],
      `${secret}\n${secret}\n`,
      null,
    );
  }

  async delete(account: string): Promise<void> {
    await runCredentialCommand(
      'security',
      ['delete-generic-password', '-a', account, '-s', credentialService],
      '',
      44,
    );
  }
}

class WindowsCredentialManagerSecretStore implements SyncV2SecretStore {
  async get(account: string): Promise<string | null> {
    const output = await runPowerShellCredentialScript(windowsReadScript, account, '', 2);
    if (output === null) return null;
    try {
      return Buffer.from(output.trim(), 'base64').toString('utf8');
    } catch {
      throw new Error('Windows Credential Manager returned invalid Reglet credentials');
    }
  }

  async set(account: string, secret: string): Promise<void> {
    requireBoundedSecret(secret);
    await runPowerShellCredentialScript(windowsWriteScript, account, secret, null);
  }

  async delete(account: string): Promise<void> {
    await runPowerShellCredentialScript(windowsDeleteScript, account, '', 2);
  }
}

async function runPowerShellCredentialScript(
  script: string,
  account: string,
  stdin: string,
  missingExitCode: number | null,
): Promise<string | null> {
  const encoded = Buffer.from(`${windowsPrelude}\n${script}`, 'utf16le').toString('base64');
  return runCredentialCommand(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    stdin,
    missingExitCode,
    { REGLET_CREDENTIAL_TARGET: `${credentialService}/${account}` },
  );
}

function runCredentialCommand(
  command: string,
  args: string[],
  stdin: string,
  missingExitCode: number | null,
  environment: Record<string, string> = {},
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...environment },
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maximumCredentialBytes) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => reject(new Error('The operating system credential store is unavailable')));
    child.on('close', (code) => {
      if (stdoutBytes > maximumCredentialBytes) {
        reject(new Error('The operating system credential store returned too much data'));
      } else if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else if (missingExitCode !== null && code === missingExitCode) {
        resolve(null);
      } else {
        reject(new Error('The operating system credential store rejected the Reglet credential update'));
      }
    });
    child.stdin.end(stdin);
  });
}

function serverIdentity(serverUrl: string): string {
  return createHash('sha256').update(serverUrl).digest('base64url').slice(0, 32);
}

function requireBoundedSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') > maximumCredentialBytes) throw new Error('Sync credential is too large');
}

function isDeviceSecrets(value: unknown): value is SyncV2DeviceSecrets {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.vaultId === 'string' &&
    typeof value.rootSecret === 'string' &&
    typeof value.authoritySecretKey === 'string' &&
    typeof value.keyEpoch === 'number' &&
    typeof value.deviceToken === 'string' &&
    typeof value.agreementSecretKey === 'string' &&
    typeof value.signingSecretKey === 'string'
  );
}

function isPendingSecrets(value: unknown): value is PendingSyncV2PairSecrets {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.requestToken === 'string' &&
    typeof value.deviceToken === 'string' &&
    typeof value.agreementSecretKey === 'string' &&
    typeof value.signingSecretKey === 'string'
  );
}

function isBootstrapSecrets(value: unknown): value is PendingSyncV2BootstrapSecrets {
  return isRecord(value) && isDeviceSecrets(value) &&
    typeof value.connectionToken === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.deviceName === 'string' &&
    typeof value.issuedAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const windowsPrelude = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RegletCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Write(ref Credential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Delete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
  public static extern void Free(IntPtr credential);
}
'@
$target = $env:REGLET_CREDENTIAL_TARGET
`;

const windowsWriteScript = String.raw`
$secret = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($secret)
$pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
  $credential = New-Object RegletCred+Credential
  $credential.Type = 1; $credential.TargetName = $target; $credential.CredentialBlobSize = $bytes.Length
  $credential.CredentialBlob = $pointer; $credential.Persist = 2; $credential.UserName = 'Reglet'
  if (-not [RegletCred]::Write([ref]$credential, 0)) { exit 1 }
} finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
`;

const windowsReadScript = String.raw`
$pointer = [IntPtr]::Zero
if (-not [RegletCred]::Read($target, 1, 0, [ref]$pointer)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 2 }
  exit 1
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][RegletCred+Credential])
  $bytes = New-Object byte[] $credential.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
  [Console]::Out.Write([Convert]::ToBase64String($bytes))
} finally { [RegletCred]::Free($pointer) }
`;

const windowsDeleteScript = String.raw`
if (-not [RegletCred]::Delete($target, 1, 0)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 2 }
  exit 1
}
`;
