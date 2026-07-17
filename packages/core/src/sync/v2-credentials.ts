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
const maximumCredentialBytes = 2 * 1024;

export function activeSyncV2CredentialId(serverUrl: string): string {
  return `active-${serverIdentity(serverUrl)}`;
}

export function pendingSyncV2CredentialId(serverUrl: string): string {
  return `pending-${serverIdentity(serverUrl)}`;
}

export function platformSyncV2SecretStore(platform = process.platform): SyncV2SecretStore {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return new NativeKeyringSecretStore();
  }
  throw new Error('Encrypted sync preview supports client credential storage on macOS, Windows, and Linux only');
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

class NativeKeyringSecretStore implements SyncV2SecretStore {
  async get(account: string): Promise<string | null> {
    try {
      const value = await (await nativeKeyringEntry(account)).getSecret();
      if (value === undefined || value === null) return null;
      const secret = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(value));
      requireBoundedSecret(secret);
      return secret;
    } catch {
      throw new Error('The operating system credential store is unavailable');
    }
  }

  async set(account: string, secret: string): Promise<void> {
    requireBoundedSecret(secret);
    try {
      await (await nativeKeyringEntry(account)).setSecret(new TextEncoder().encode(secret));
    } catch {
      throw new Error('The operating system credential store rejected the Reglet credential update');
    }
  }

  async delete(account: string): Promise<void> {
    try {
      await (await nativeKeyringEntry(account)).deleteCredential();
    } catch {
      throw new Error('The operating system credential store rejected the Reglet credential deletion');
    }
  }
}

async function nativeKeyringEntry(account: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(credentialService, account);
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
