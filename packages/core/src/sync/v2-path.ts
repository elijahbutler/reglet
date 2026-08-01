import path from 'node:path';
import { providerNames } from '../config.js';

const maximumSyncPathLength = 1024;
const maximumSyncSegmentLength = 255;

/**
 * Protocol v2 syncs portable Master content only. Provider enrollment and
 * server preferences stay machine-local in reglet.toml.
 */
export function isAllowedEncryptedSyncPath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.length > maximumSyncPathLength ||
    filePath.startsWith('/') ||
    filePath.startsWith('~') ||
    filePath.includes('\\') ||
    /[\0-\x1f\x7f]/.test(filePath)
  ) {
    return false;
  }
  const segments = filePath.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > maximumSyncSegmentLength ||
        segment === '.' ||
        segment === '..' ||
        isLocalOnlySyncArtifact(segment),
    ) ||
    segments.includes('.state')
  ) {
    return false;
  }
  if (filePath === 'mcp/servers.json') return true;
  if (filePath === 'library.json') return true;
  if (
    segments.length === 4 &&
    segments[0] === 'mcp' &&
    segments[1] === 'providers' &&
    providerNames.includes(segments[2] as (typeof providerNames)[number]) &&
    segments[3] === 'servers.json'
  ) {
    return true;
  }
  return (segments[0] === 'rules' || segments[0] === 'skills') && segments.length >= 2;
}

export function requireAllowedEncryptedSyncPath(filePath: string): string {
  if (!isAllowedEncryptedSyncPath(filePath)) {
    throw new Error(`Sync rejected an unsafe or machine-local Master path: ${JSON.stringify(filePath)}`);
  }
  return filePath;
}

export function resolveEncryptedSyncPath(root: string, filePath: string): string {
  const allowed = requireAllowedEncryptedSyncPath(filePath);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...allowed.split('/'));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Sync rejected a path outside its local root: ${JSON.stringify(filePath)}`);
  }
  return target;
}

function isLocalOnlySyncArtifact(segment: string): boolean {
  return (
    segment.endsWith('~') ||
    segment.endsWith('.bak') ||
    segment.endsWith('.backup') ||
    segment.includes('.conflict-') ||
    segment.includes('.reglet-stage-')
  );
}
