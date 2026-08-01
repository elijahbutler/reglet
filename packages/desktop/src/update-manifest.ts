export interface AvailableUpdate {
  version: string;
  releaseNotes: string;
}

export function parseGitHubRelease(value: unknown): AvailableUpdate | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version =
    typeof record.tag_name === 'string'
      ? record.tag_name.trim().replace(/^v/, '')
      : '';
  if (!isVersion(version)) {
    return undefined;
  }
  return {
    version,
    releaseNotes: typeof record.body === 'string' ? record.body : '',
  };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (candidateParts === undefined || currentParts === undefined) {
    return false;
  }
  const length = Math.max(candidateParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (candidateParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

function isVersion(value: string): boolean {
  return versionParts(value) !== undefined;
}

function versionParts(value: string): number[] | undefined {
  const stable = value.trim().replace(/^v/, '').split('-', 1)[0];
  if (stable === undefined || !/^\d+(?:\.\d+){1,3}$/.test(stable)) {
    return undefined;
  }
  return stable.split('.').map(Number);
}
