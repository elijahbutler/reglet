import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256String } from '../fsutil.js';
import { loadManifest, saveManifest, type ManagedContent, type ManifestOutput } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';
import {
  beginOperation,
  fingerprintOperationPath,
  removePathAtomically,
  replacePathFromDirectory,
  replacePathFromFile,
  type OperationPathFingerprint,
  type OperationReceipt,
} from './operations.js';

export interface RevertResult {
  outputPath: string;
  provider: string;
  action: 'restored' | 'removed';
}

export interface ProviderRestorePreviewTarget {
  path: string;
  content: ManagedContent;
  action: RevertResult['action'];
  current: OperationPathFingerprint;
  restored: OperationPathFingerprint;
}

export interface ProviderRestorePreview {
  version: 1;
  provider: ProviderId;
  digest: string;
  status: 'ready' | 'blocked';
  issues: string[];
  targets: ProviderRestorePreviewTarget[];
}

export interface ReviewedProviderRestoreResult {
  results: RevertResult[];
  receipt: OperationReceipt;
}

export async function previewProviderRestore(
  provider: ProviderId,
  home = regletHome(),
): Promise<ProviderRestorePreview> {
  const manifest = await loadManifest(home);
  const selected = Object.entries(manifest.outputs)
    .filter(([, output]) => output.provider === provider)
    .sort(([left], [right]) => left.localeCompare(right));
  const issues: string[] = [];
  const targets: ProviderRestorePreviewTarget[] = [];
  for (const [outputPath, output] of selected) {
    const current = await fingerprintOperationPath(outputPath);
    if (output.backedUpTo === null) {
      targets.push({
        path: outputPath,
        content: output.content,
        action: 'removed',
        current,
        restored: { kind: 'missing', hash: null, size: null },
      });
      continue;
    }
    try {
      await assertManagedBackupPath(output.backedUpTo, provider, home);
      const restored = await fingerprintOperationPath(output.backedUpTo);
      if (restored.kind !== 'file' && restored.kind !== 'directory') {
        issues.push(`The original backup for ${outputPath} is ${restored.kind}.`);
      }
      targets.push({
        path: outputPath,
        content: output.content,
        action: 'restored',
        current,
        restored,
      });
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      targets.push({
        path: outputPath,
        content: output.content,
        action: 'restored',
        current,
        restored: { kind: 'missing', hash: null, size: null },
      });
    }
  }
  if (targets.length === 0) issues.push(`${provider} has no managed outputs to restore.`);
  return {
    version: 1,
    provider,
    digest: providerRestoreDigest(provider, selected, targets),
    status: issues.length === 0 ? 'ready' : 'blocked',
    issues,
    targets,
  };
}

export async function restoreReviewedProvider(
  provider: ProviderId,
  digest: string,
  home = regletHome(),
): Promise<ReviewedProviderRestoreResult> {
  const preview = await previewProviderRestore(provider, home);
  assertReadyProviderRestore(preview);
  if (preview.digest !== digest) {
    throw new Error(`Provider restore preview is stale: expected ${digest}, got ${preview.digest}`);
  }
  const operation = await beginOperation({ home, providers: [provider] });
  const results: RevertResult[] = [];
  try {
    const currentPreview = await previewProviderRestore(provider, home);
    assertReadyProviderRestore(currentPreview);
    if (currentPreview.digest !== preview.digest) {
      throw new Error('Provider restore preview became stale before restoration started.');
    }
    const manifest = await loadManifest(home);
    const targets = Object.entries(manifest.outputs)
      .filter(([, output]) => output.provider === provider)
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [outputPath, output] of targets) {
      await operation.snapshotTarget(outputPath);
      if (output.backedUpTo === null) {
        await removePathAtomically(outputPath);
        results.push({ outputPath, provider: output.provider, action: 'removed' });
      } else {
        await assertManagedBackupPath(output.backedUpTo, provider, home);
        await restorePath(output.backedUpTo, outputPath);
        results.push({ outputPath, provider: output.provider, action: 'restored' });
      }
      delete manifest.outputs[outputPath];
    }
    await saveManifest(manifest, home);
    return { results, receipt: await operation.complete() };
  } catch (error) {
    await operation.rollback(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function revert(provider?: ProviderId, home = regletHome()): Promise<RevertResult[]> {
  if (
    Object.values((await loadManifest(home)).outputs).every(
      (output) => provider !== undefined && output.provider !== provider,
    )
  ) {
    return [];
  }

  const operation = await beginOperation({
    home,
    ...(provider === undefined ? {} : { providers: [provider] }),
  });
  const results: RevertResult[] = [];

  try {
    const manifest = await loadManifest(home);
    const targets = Object.entries(manifest.outputs).filter(([, output]) => provider === undefined || output.provider === provider);
    for (const [outputPath, output] of targets) {
      await operation.snapshotTarget(outputPath);
      if (output.backedUpTo === null) {
        await removePathAtomically(outputPath);
        results.push({ outputPath, provider: output.provider, action: 'removed' });
      } else {
        await assertManagedBackupPath(output.backedUpTo, output.provider, home);
        await restorePath(output.backedUpTo, outputPath);
        results.push({ outputPath, provider: output.provider, action: 'restored' });
      }

      delete manifest.outputs[outputPath];
    }

    await saveManifest(manifest, home);
    await operation.complete();
    return results;
  } catch (error) {
    await operation.rollback(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export const restore = revert;

function assertReadyProviderRestore(preview: ProviderRestorePreview): void {
  if (preview.status === 'blocked') {
    throw new Error(preview.issues.join('; '));
  }
}

function providerRestoreDigest(
  provider: ProviderId,
  selected: Array<[string, ManifestOutput]>,
  targets: ProviderRestorePreviewTarget[],
): string {
  return sha256String(JSON.stringify({
    version: 1,
    provider,
    outputs: selected.map(([outputPath, output]) => ({ outputPath, output })),
    targets,
  }));
}

async function assertManagedBackupPath(
  backupPath: string,
  provider: string,
  home: string,
): Promise<void> {
  const candidate = path.resolve(backupPath);
  const backupParent = path.resolve(home, '.state', 'backups');
  const providerBackupRoot = path.resolve(backupParent, provider);
  if (path.dirname(providerBackupRoot) !== backupParent) {
    throw new Error(`Provider backup escaped Reglet private state: ${backupPath}`);
  }
  const allowedRoots = [
    path.resolve(home, '.state', 'operations', 'snapshots'),
    providerBackupRoot,
  ];
  const root = allowedRoots.find((allowed) => candidate.startsWith(`${allowed}${path.sep}`));
  if (root === undefined) {
    throw new Error(`Provider backup escaped Reglet private state: ${backupPath}`);
  }
  await assertNoSymbolicLinkComponents(path.resolve(home), candidate);
}

async function assertNoSymbolicLinkComponents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Provider backup escaped Reglet home: ${target}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter((item) => item.length > 0)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Provider backup contains a symbolic-link path component: ${current}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function restorePath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isDirectory()) {
    await replacePathFromDirectory(sourcePath, destinationPath);
  } else {
    await replacePathFromFile(sourcePath, destinationPath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
