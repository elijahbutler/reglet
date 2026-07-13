import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { regletHome } from './paths.js';

export interface PublicReleaseCapabilities {
  mode: 'public-v1';
  localOnly: true;
  sync: false;
  disabledCommands: readonly ['login', 'register', 'pair', 'sync'];
}

const disabledPublicCommands: PublicReleaseCapabilities['disabledCommands'] = Object.freeze([
  'login',
  'register',
  'pair',
  'sync',
] as const);

export const publicReleaseCapabilities: PublicReleaseCapabilities = Object.freeze({
  mode: 'public-v1',
  localOnly: true,
  sync: false,
  disabledCommands: disabledPublicCommands,
});

export interface LegacySyncStateStatus {
  present: boolean;
  paths: string[];
}

/**
 * Legacy sync state is deliberately inert in public V1. This inspection never
 * reads credentials or contacts a network service; it only reports whether
 * pre-V1 local state exists so the owner can explicitly clear it.
 */
export async function inspectLegacySyncState(home = regletHome()): Promise<LegacySyncStateStatus> {
  const candidates = [
    path.join(home, '.state', 'sync.json'),
    path.join(home, '.state', 'sync-base'),
  ];
  const paths: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) paths.push(candidate);
  }
  return { present: paths.length > 0, paths };
}

/** Removes inert legacy sync credentials and snapshots only after explicit user action. */
export async function clearLegacySyncState(home = regletHome()): Promise<LegacySyncStateStatus> {
  const before = await inspectLegacySyncState(home);
  for (const target of before.paths) {
    await rm(target, { recursive: true, force: true });
  }
  return { present: false, paths: [] };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
