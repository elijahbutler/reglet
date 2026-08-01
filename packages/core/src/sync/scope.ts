import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { regletHome } from '../paths.js';

export interface SyncFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  blocked: boolean;
  issue?: string;
}

export interface SyncScopeResult {
  files: SyncFile[];
  blockedFiles: SyncFile[];
}

const defaultSyncFileLimit = 25 * 1024 * 1024;

export async function enumerateCanonicalSyncScope(
  home = regletHome(),
  fileLimitBytes = defaultSyncFileLimit,
): Promise<SyncScopeResult> {
  const allowedRoots = ['rules', 'skills', 'mcp'];
  const allowedFiles = ['library.json', 'reglet.toml'];
  const candidates: string[] = [];
  for (const relPath of allowedFiles) {
    candidates.push(path.join(home, relPath));
  }
  for (const relPath of allowedRoots) {
    await collectFiles(path.join(home, relPath), candidates);
  }
  const files: SyncFile[] = [];
  for (const absolutePath of candidates) {
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        continue;
      }
      const blocked = stats.size > fileLimitBytes;
      files.push({
        relativePath: path.relative(home, absolutePath),
        absolutePath,
        size: stats.size,
        blocked,
        issue: blocked
          ? `File exceeds the ${fileLimitBytes}-byte sync limit; local management and apply remain available.`
          : undefined,
      });
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    files,
    blockedFiles: files.filter((file) => file.blocked),
  };
}

async function collectFiles(root: string, output: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, output);
    } else if (entry.isFile()) {
      output.push(entryPath);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

