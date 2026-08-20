import { rm } from 'node:fs/promises';
import path from 'node:path';
import { sha256String } from '../fsutil.js';
import { loadManifest, saveManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';
import { fingerprintOperationPath, type OperationPathFingerprint } from './operations.js';

export interface PurgeProviderBackupsResult {
  provider: ProviderId;
  removed: boolean;
  detachedOutputs: string[];
}

export interface PurgeProviderBackupsPreview {
  version: 1;
  provider: ProviderId;
  digest: string;
  backup: OperationPathFingerprint;
  detachedOutputs: string[];
}

export async function previewPurgeProviderBackups(
  provider: ProviderId,
  home = regletHome(),
): Promise<PurgeProviderBackupsPreview> {
  const backupRoot = providerBackupRoot(provider, home);
  const manifest = await loadManifest(home);
  const detached = Object.entries(manifest.outputs)
    .filter(([, output]) => output.provider === provider && output.backedUpTo !== null &&
      isInsideBackupRoot(output.backedUpTo, backupRoot))
    .sort(([left], [right]) => left.localeCompare(right));
  const backup = await fingerprintOperationPath(backupRoot);
  if (backup.kind !== 'directory' && backup.kind !== 'missing') {
    throw new Error(`Provider backup root is ${backup.kind}, not a private directory: ${backupRoot}`);
  }
  return {
    version: 1,
    provider,
    digest: sha256String(JSON.stringify({
      version: 1,
      provider,
      backup,
      outputs: detached.map(([outputPath, output]) => ({ outputPath, output })),
    })),
    backup,
    detachedOutputs: detached.map(([outputPath]) => outputPath),
  };
}

/** Permanently removes only the selected provider's legacy backup tree. */
export async function purgeProviderBackups(
  provider: ProviderId,
  home = regletHome(),
): Promise<PurgeProviderBackupsResult> {
  const preview = await previewPurgeProviderBackups(provider, home);
  return purgeProviderBackupsFromPreview(preview, home);
}

export async function purgeReviewedProviderBackups(
  provider: ProviderId,
  digest: string,
  home = regletHome(),
): Promise<PurgeProviderBackupsResult> {
  const preview = await previewPurgeProviderBackups(provider, home);
  if (preview.digest !== digest) {
    throw new Error(`Provider backup purge preview is stale: expected ${digest}, got ${preview.digest}`);
  }
  return purgeProviderBackupsFromPreview(preview, home);
}

async function purgeProviderBackupsFromPreview(
  preview: PurgeProviderBackupsPreview,
  home: string,
): Promise<PurgeProviderBackupsResult> {
  const currentPreview = await previewPurgeProviderBackups(preview.provider, home);
  if (currentPreview.digest !== preview.digest) {
    throw new Error('Provider backup purge preview became stale before deletion started.');
  }
  const backupRoot = providerBackupRoot(preview.provider, home);
  const manifest = await loadManifest(home);
  const detachedOutputs: string[] = [];
  const originalOutputs = new Map<string, (typeof manifest.outputs)[string]>();
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== preview.provider || output.backedUpTo === null ||
      !isInsideBackupRoot(output.backedUpTo, backupRoot)) continue;
    originalOutputs.set(outputPath, output);
    manifest.outputs[outputPath] = { ...output, backedUpTo: null };
    detachedOutputs.push(outputPath);
  }
  if (detachedOutputs.length > 0) await saveManifest(manifest, home);
  try {
    await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (detachedOutputs.length > 0) {
      const rollback = await loadManifest(home);
      for (const outputPath of detachedOutputs) {
        const output = originalOutputs.get(outputPath);
        if (output === undefined || output.backedUpTo === null) continue;
        try {
          const backup = await fingerprintOperationPath(output.backedUpTo);
          if (backup.kind === 'file' || backup.kind === 'directory') {
            rollback.outputs[outputPath] = output;
          }
        } catch {
          // Keep the output detached if its backup cannot be confirmed.
        }
      }
      await saveManifest(rollback, home);
    }
    throw error;
  }
  return {
    provider: preview.provider,
    removed: preview.backup.kind !== 'missing',
    detachedOutputs: detachedOutputs.sort((left, right) => left.localeCompare(right)),
  };
}

function providerBackupRoot(provider: ProviderId, home: string): string {
  const backupRoot = path.resolve(home, '.state', 'backups', provider);
  const expectedParent = path.resolve(home, '.state', 'backups');
  if (path.dirname(backupRoot) !== expectedParent) throw new Error('Provider backup target escaped its managed root.');
  return backupRoot;
}

function isInsideBackupRoot(candidatePath: string, backupRoot: string): boolean {
  const candidate = path.resolve(candidatePath);
  return candidate === backupRoot || candidate.startsWith(`${backupRoot}${path.sep}`);
}
