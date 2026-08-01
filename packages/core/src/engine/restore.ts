import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, saveManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';

export interface RestoreReportItem {
  provider: string;
  outputPath: string;
  action: 'restored' | 'removed';
  safetyBackup: string | null;
}

export interface RestoreReport {
  results: RestoreReportItem[];
}

export async function purgeProviderBackups(
  provider: ProviderId,
  home = regletHome(),
): Promise<{ provider: ProviderId; purged: true }> {
  await rm(path.join(home, '.state', 'backups', provider), {
    recursive: true,
    force: true,
  });
  const manifest = await loadManifest(home);
  for (const output of Object.values(manifest.outputs)) {
    if (output.provider === provider) {
      output.backedUpTo = null;
    }
  }
  await saveManifest(manifest, home);
  return { provider, purged: true };
}

export async function restoreProviderOutputs(
  provider?: ProviderId,
  home = regletHome(),
): Promise<RestoreReport> {
  const manifest = await loadManifest(home);
  const results: RestoreReportItem[] = [];
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (provider !== undefined && output.provider !== provider) {
      continue;
    }
    const safetyBackup = await backupCurrentOutput(
      outputPath,
      output.provider,
      home,
    );
    if (output.backedUpTo === null) {
      await rm(outputPath, { recursive: true, force: true });
      results.push({
        provider: output.provider,
        outputPath,
        action: 'removed',
        safetyBackup,
      });
    } else {
      await rm(outputPath, { recursive: true, force: true });
      await mkdir(path.dirname(outputPath), { recursive: true });
      const backupStats = await lstat(output.backedUpTo);
      await cp(output.backedUpTo, outputPath, {
        recursive: backupStats.isDirectory(),
        verbatimSymlinks: true,
      });
      results.push({
        provider: output.provider,
        outputPath,
        action: 'restored',
        safetyBackup,
      });
    }
    delete manifest.outputs[outputPath];
  }
  await saveManifest(manifest, home);
  return { results };
}

async function backupCurrentOutput(
  outputPath: string,
  provider: string,
  home: string,
): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(outputPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const destination = path.join(
    home,
    '.state',
    'backups',
    provider,
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
    'pre-restore',
    path.basename(outputPath),
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(outputPath, destination, {
    recursive: stats.isDirectory(),
    verbatimSymlinks: true,
  });
  return destination;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
