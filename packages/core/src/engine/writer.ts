import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { copyDirRecursive, sha256String, writeFileEnsuringDir } from '../fsutil.js';
import { getOutput, recordOutput, type ManagedContent } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ApplyStatus, ProviderId } from '../providers/types.js';

export interface SafeWriteFileOptions {
  outputPath: string;
  content: string;
  provider: ProviderId;
  managedContent: ManagedContent;
  dryRun: boolean;
  managedKeys?: string[];
}

export interface SafeWriteDirectoryOptions {
  sourceDir: string;
  outputPath: string;
  provider: ProviderId;
  dryRun: boolean;
}

export interface SafeWriteResult {
  status: ApplyStatus;
  backedUpTo: string | null;
  hash: string;
}

export async function safeWriteFile(options: SafeWriteFileOptions): Promise<SafeWriteResult> {
  const hash = sha256String(options.content);
  const previous = await getOutput(options.outputPath);

  if (previous?.hash === hash) {
    return { status: 'unchanged', backedUpTo: previous.backedUpTo, hash };
  }

  if (options.dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(options.outputPath, options.provider));
  await writeFileEnsuringDir(options.outputPath, options.content);
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: options.managedContent,
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
    managedKeys: options.managedKeys,
  });

  return { status: 'written', backedUpTo, hash };
}

export async function safeWriteDirectory(options: SafeWriteDirectoryOptions): Promise<SafeWriteResult> {
  const hash = await hashDirectory(options.sourceDir);
  const previous = await getOutput(options.outputPath);

  if (previous?.hash === hash) {
    return { status: 'unchanged', backedUpTo: previous.backedUpTo, hash };
  }

  if (options.dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(options.outputPath, options.provider));
  await rm(options.outputPath, { recursive: true, force: true });
  await copyDirRecursive(options.sourceDir, options.outputPath);
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
  });

  return { status: 'written', backedUpTo, hash };
}

export async function removeManagedDirectory(
  outputPath: string,
  provider: ProviderId,
  dryRun: boolean,
): Promise<SafeWriteResult> {
  const previous = await getOutput(outputPath);
  const hash = sha256String('removed');

  if (dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(outputPath, provider));
  await rm(outputPath, { recursive: true, force: true });
  await recordOutput(outputPath, {
    provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
  });

  return { status: 'written', backedUpTo, hash };
}

async function backupPathIfExists(outputPath: string, provider: ProviderId): Promise<string | null> {
  try {
    await stat(outputPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const backupPath = path.join(
    regletHome(),
    '.state',
    'backups',
    provider,
    new Date().toISOString().replaceAll(':', '-'),
    path.basename(outputPath),
  );
  await mkdir(path.dirname(backupPath), { recursive: true });
  const stats = await stat(outputPath);
  if (stats.isDirectory()) {
    await cp(outputPath, backupPath, { recursive: true });
  } else {
    await copyFile(outputPath, backupPath);
  }
  return backupPath;
}

async function hashDirectory(dirPath: string): Promise<string> {
  const parts: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (entry.isFile()) {
        const relPath = normalizeRelativePath(path.relative(dirPath, entryPath));
        parts.push(`${relPath}\0${await readFile(entryPath, 'utf8')}`);
      }
    }
  }

  await visit(dirPath);
  return sha256String(parts.join('\0'));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}
