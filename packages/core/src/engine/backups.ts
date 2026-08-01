import { rm } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, saveManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';

export interface PurgeProviderBackupsResult {
  provider: ProviderId;
  removed: boolean;
  detachedOutputs: string[];
}

/** Permanently removes only the selected provider's legacy backup tree. */
export async function purgeProviderBackups(
  provider: ProviderId,
  home = regletHome(),
): Promise<PurgeProviderBackupsResult> {
  const backupRoot = path.resolve(home, '.state', 'backups', provider);
  const expectedParent = path.resolve(home, '.state', 'backups');
  if (path.dirname(backupRoot) !== expectedParent) throw new Error('Provider backup target escaped its managed root.');
  const manifest = await loadManifest(home);
  const detachedOutputs: string[] = [];
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== provider || output.backedUpTo === null) continue;
    const backup = path.resolve(output.backedUpTo);
    if (backup !== backupRoot && !backup.startsWith(`${backupRoot}${path.sep}`)) continue;
    manifest.outputs[outputPath] = { ...output, backedUpTo: null };
    detachedOutputs.push(outputPath);
  }
  await rm(backupRoot, { recursive: true, force: true });
  if (detachedOutputs.length > 0) await saveManifest(manifest, home);
  return { provider, removed: true, detachedOutputs };
}
