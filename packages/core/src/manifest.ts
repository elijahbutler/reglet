import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertPrivateFile, writePrivateJson } from './fsutil.js';
import { regletHome } from './paths.js';

export type ManagedContent = 'rules' | 'skills' | 'mcp';

export interface ManifestOutput {
  provider: string;
  content: ManagedContent;
  hash: string;
  appliedAt: string;
  backedUpTo: string | null;
  managedKeys?: string[];
}

export interface Manifest {
  version: 1;
  outputs: Record<string, ManifestOutput>;
}

export function defaultManifest(): Manifest {
  return {
    version: 1,
    outputs: {},
  };
}

export function manifestPath(home = regletHome()): string {
  return path.join(home, '.state', 'manifest.json');
}

export async function loadManifest(home = regletHome()): Promise<Manifest> {
  try {
    const targetPath = manifestPath(home);
    await assertPrivateFile(targetPath);
    return normalizeManifest(JSON.parse(await readFile(targetPath, 'utf8')) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultManifest();
    }
    throw error;
  }
}

export async function saveManifest(manifest: Manifest, home = regletHome()): Promise<void> {
  await writePrivateJson(manifestPath(home), manifest);
}

export async function recordOutput(
  outputPath: string,
  output: ManifestOutput,
  home = regletHome(),
): Promise<Manifest> {
  const manifest = await loadManifest(home);
  manifest.outputs[outputPath] = output;
  await saveManifest(manifest, home);
  return manifest;
}

export async function getOutput(outputPath: string, home = regletHome()): Promise<ManifestOutput | undefined> {
  return (await loadManifest(home)).outputs[outputPath];
}

function normalizeManifest(value: unknown): Manifest {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.outputs)) {
    return defaultManifest();
  }

  const outputs: Record<string, ManifestOutput> = {};
  for (const [outputPath, output] of Object.entries(value.outputs)) {
    if (isManifestOutput(output)) {
      outputs[outputPath] = output;
    }
  }

  return {
    version: 1,
    outputs,
  };
}

function isManifestOutput(value: unknown): value is ManifestOutput {
  if (!isRecord(value)) {
    return false;
  }

  const content = value.content;
  const managedKeys = value.managedKeys;
  return (
    typeof value.provider === 'string' &&
    (content === 'rules' || content === 'skills' || content === 'mcp') &&
    typeof value.hash === 'string' &&
    typeof value.appliedAt === 'string' &&
    (typeof value.backedUpTo === 'string' || value.backedUpTo === null) &&
    (managedKeys === undefined || (Array.isArray(managedKeys) && managedKeys.every((key) => typeof key === 'string')))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
