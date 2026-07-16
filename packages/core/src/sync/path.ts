import path from 'node:path';
import { providerNames } from '../config.js';

const maximumSyncPathLength = 1024;
const maximumSyncSegmentLength = 255;

export function isAllowedSyncPath(filePath: string): boolean {
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

  if (filePath === 'reglet.toml' || filePath === 'mcp/servers.json') {
    return true;
  }
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

export function requireAllowedSyncPath(filePath: string): string {
  if (!isAllowedSyncPath(filePath)) {
    throw new Error(`Sync rejected an unsafe Master path: ${JSON.stringify(filePath)}`);
  }
  return filePath;
}

export function resolveSyncPath(root: string, filePath: string): string {
  const allowed = requireAllowedSyncPath(filePath);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...allowed.split('/'));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Sync rejected a path outside its local root: ${JSON.stringify(filePath)}`);
  }
  return target;
}

export function syncFileRoute(filePath: string): string {
  return requireAllowedSyncPath(filePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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
