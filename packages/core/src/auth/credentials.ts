import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDir, pathExists, writePrivateFile } from '../fsutil.js';
import { regletHome } from '../paths.js';
import { systemSecretStore, type SecretStore } from '../security/secrets.js';
import type { SyncedCredential } from './types.js';

const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function credentialsDir(home = regletHome()): string {
  return path.join(home, 'credentials');
}

export function credentialPath(provider: string, home = regletHome()): string {
  validateProviderId(provider);
  return path.join(credentialsDir(home), `${provider.toLowerCase()}.json`);
}

export function validateProviderId(provider: string): void {
  if (!providerPattern.test(provider)) {
    throw new Error(`Invalid credential provider identifier: ${JSON.stringify(provider)}`);
  }
}

export function isSyncedCredential(value: unknown): value is SyncedCredential {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c.version === 1 &&
    typeof c.provider === 'string' &&
    (c.tokenType === 'bearer' || c.tokenType === 'oauth') &&
    typeof c.token === 'string' &&
    c.token.length > 0 &&
    typeof c.updatedAt === 'string'
  );
}

export async function saveCredential(
  credential: SyncedCredential,
  home = regletHome(),
  secretStore: SecretStore = systemSecretStore(),
): Promise<void> {
  if (!isSyncedCredential(credential)) {
    throw new Error('Invalid credential structure');
  }
  validateProviderId(credential.provider);
  const dir = credentialsDir(home);
  await ensurePrivateDir(dir);
  const target = credentialPath(credential.provider, home);
  const content = `${JSON.stringify(credential, null, 2)}\n`;
  await writePrivateFile(target, content);
  await syncCredentialToKeyring(credential, secretStore);
}

export async function readCredential(
  provider: string,
  home = regletHome(),
): Promise<SyncedCredential | null> {
  validateProviderId(provider);
  const target = credentialPath(provider, home);
  if (!(await pathExists(target))) return null;
  try {
    const raw = await readFile(target, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isSyncedCredential(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function deleteCredential(
  provider: string,
  home = regletHome(),
  secretStore: SecretStore = systemSecretStore(),
): Promise<boolean> {
  validateProviderId(provider);
  const target = credentialPath(provider, home);
  const existed = await pathExists(target);
  if (existed) {
    await rm(target, { force: true });
  }
  await secretStore.delete(provider).catch(() => {});
  await secretStore.delete(provider.toLowerCase()).catch(() => {});
  await secretStore.delete(`oauth-${provider.toLowerCase()}`).catch(() => {});
  await secretStore.delete(`${provider.toLowerCase()}-token`).catch(() => {});
  return existed;
}

export async function listCredentials(home = regletHome()): Promise<SyncedCredential[]> {
  const dir = credentialsDir(home);
  if (!(await pathExists(dir))) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const credentials: SyncedCredential[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const provider = entry.name.slice(0, -5);
    try {
      const cred = await readCredential(provider, home);
      if (cred !== null) credentials.push(cred);
    } catch {
      // Ignore corrupt single credential file
    }
  }
  return credentials.sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function syncCredentialToKeyring(
  credential: SyncedCredential,
  secretStore: SecretStore = systemSecretStore(),
): Promise<void> {
  const normalized = credential.provider.toLowerCase();
  await secretStore.set(credential.provider, credential.token).catch(() => {});
  if (normalized !== credential.provider) {
    await secretStore.set(normalized, credential.token).catch(() => {});
  }
  await secretStore.set(`oauth-${normalized}`, credential.token).catch(() => {});
  await secretStore.set(`${normalized}-token`, credential.token).catch(() => {});
}

