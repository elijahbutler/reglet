import { stat } from 'node:fs/promises';
import { loadManifest, saveManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';
import {
  beginOperation,
  removePathAtomically,
  replacePathFromDirectory,
  replacePathFromFile,
} from './operations.js';

export interface RevertResult {
  outputPath: string;
  provider: string;
  action: 'restored' | 'removed';
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

async function restorePath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isDirectory()) {
    await replacePathFromDirectory(sourcePath, destinationPath);
  } else {
    await replacePathFromFile(sourcePath, destinationPath);
  }
}
