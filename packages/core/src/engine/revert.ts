import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, saveManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';

export interface RevertResult {
  outputPath: string;
  provider: string;
  action: 'restored' | 'removed';
}

export async function revert(provider?: ProviderId, home = regletHome()): Promise<RevertResult[]> {
  const manifest = await loadManifest(home);
  const results: RevertResult[] = [];

  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (provider !== undefined && output.provider !== provider) {
      continue;
    }

    if (output.backedUpTo === null) {
      await rm(outputPath, { recursive: true, force: true });
      results.push({ outputPath, provider: output.provider, action: 'removed' });
    } else {
      await restorePath(output.backedUpTo, outputPath);
      results.push({ outputPath, provider: output.provider, action: 'restored' });
    }

    delete manifest.outputs[outputPath];
  }

  await saveManifest(manifest, home);
  return results;
}

export const restore = revert;

async function restorePath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);
  await rm(destinationPath, { recursive: true, force: true });
  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (sourceStat.isDirectory()) {
    await cp(sourcePath, destinationPath, { recursive: true });
  } else {
    await copyFile(sourcePath, destinationPath);
  }
}
