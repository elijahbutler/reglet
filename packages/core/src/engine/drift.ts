import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256String } from '../fsutil.js';
import { loadManifest } from '../manifest.js';
import { regletHome } from '../paths.js';

export interface DriftRecord {
  provider: string;
  content: 'rules' | 'skills' | 'mcp';
  outputPath: string;
  state: 'clean' | 'drifted' | 'missing' | 'error';
  appliedHash: string;
  observedHash?: string;
  message?: string;
}

export async function detectProjectionDrift(
  home = regletHome(),
): Promise<DriftRecord[]> {
  const manifest = await loadManifest(home);
  const records: DriftRecord[] = [];
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    try {
      const stats = await lstat(outputPath);
      const observedHash = stats.isDirectory()
        ? await hashDirectory(outputPath)
        : sha256String(await readFile(outputPath));
      records.push({
        provider: output.provider,
        content: output.content,
        outputPath,
        state: observedHash === output.hash ? 'clean' : 'drifted',
        appliedHash: output.hash,
        observedHash,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        records.push({
          provider: output.provider,
          content: output.content,
          outputPath,
          state: 'missing',
          appliedHash: output.hash,
        });
      } else {
        records.push({
          provider: output.provider,
          content: output.content,
          outputPath,
          state: 'error',
          appliedHash: output.hash,
          message: error instanceof Error ? error.message : 'Filesystem observation failed.',
        });
      }
    }
  }
  return records.sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.outputPath.localeCompare(right.outputPath),
  );
}

async function hashDirectory(root: string): Promise<string> {
  const parts: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        parts.push(
          `${path.relative(root, entryPath)}\0${(await readFile(entryPath)).toString('base64')}`,
        );
      }
    }
  }
  await visit(root);
  return sha256String(parts.join('\0'));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

