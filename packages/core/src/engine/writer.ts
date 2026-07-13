import { chmod, copyFile, cp, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDir, hasPosixModes, sha256String } from '../fsutil.js';
import { getOutput, recordOutput, type ManagedContent } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ApplyStatus, ProviderId } from '../providers/types.js';
import {
  removePathAtomically,
  replacePathFromDirectory,
  replacePathFromText,
  type OperationContext,
} from './operations.js';

export interface SafeWriteFileOptions {
  outputPath: string;
  content: string;
  provider: ProviderId;
  managedContent: ManagedContent;
  dryRun: boolean;
  managedKeys?: string[];
  masterRevision?: string;
  compositionRevision?: string;
  home?: string;
  operation?: OperationContext;
}

export interface SafeWriteDirectoryOptions {
  sourceDir: string;
  outputPath: string;
  provider: ProviderId;
  dryRun: boolean;
  masterRevision?: string;
  compositionRevision?: string;
  home?: string;
  operation?: OperationContext;
}

export interface SafeWriteResult {
  status: ApplyStatus;
  backedUpTo: string | null;
  hash: string;
}

export async function safeWriteFile(options: SafeWriteFileOptions): Promise<SafeWriteResult> {
  const hash = sha256String(options.content);
  const home = options.home ?? regletHome();
  const previous = await getOutput(options.outputPath, home);

  if (previous?.hash === hash && previous.compositionRevision === options.compositionRevision && await fileMatchesHash(options.outputPath, hash)) {
    return { status: 'unchanged', backedUpTo: previous.backedUpTo, hash };
  }

  if (options.dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  if (options.operation !== undefined) {
    const snapshot = await options.operation.snapshotTarget(options.outputPath);
    await replacePathFromText(options.content, options.outputPath);
    await recordOutput(options.outputPath, {
      provider: options.provider,
      content: options.managedContent,
      hash,
      appliedAt: new Date().toISOString(),
      backedUpTo: previous?.backedUpTo ?? snapshot.snapshot,
      managedKeys: options.managedKeys,
      masterRevision: options.masterRevision,
      compositionRevision: options.compositionRevision,
    }, home);
    return { status: 'written', backedUpTo: previous?.backedUpTo ?? snapshot.snapshot, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(options.outputPath, options.provider, home));
  await replacePathFromText(options.content, options.outputPath);
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: options.managedContent,
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
    managedKeys: options.managedKeys,
    masterRevision: options.masterRevision,
    compositionRevision: options.compositionRevision,
  }, home);

  return { status: 'written', backedUpTo, hash };
}

export async function safeWriteDirectory(options: SafeWriteDirectoryOptions): Promise<SafeWriteResult> {
  const hash = await hashDirectory(options.sourceDir);
  const home = options.home ?? regletHome();
  const previous = await getOutput(options.outputPath, home);

  if (previous?.hash === hash && previous.compositionRevision === options.compositionRevision && await directoryMatchesHash(options.outputPath, hash)) {
    return { status: 'unchanged', backedUpTo: previous.backedUpTo, hash };
  }

  if (options.dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  if (options.operation !== undefined) {
    const snapshot = await options.operation.snapshotTarget(options.outputPath);
    await replacePathFromDirectory(options.sourceDir, options.outputPath);
    await recordOutput(options.outputPath, {
      provider: options.provider,
      content: 'skills',
      hash,
      appliedAt: new Date().toISOString(),
      backedUpTo: previous?.backedUpTo ?? snapshot.snapshot,
      masterRevision: options.masterRevision,
      compositionRevision: options.compositionRevision,
    }, home);
    return { status: 'written', backedUpTo: previous?.backedUpTo ?? snapshot.snapshot, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(options.outputPath, options.provider, home));
  await replacePathFromDirectory(options.sourceDir, options.outputPath);
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
    masterRevision: options.masterRevision,
    compositionRevision: options.compositionRevision,
  }, home);

  return { status: 'written', backedUpTo, hash };
}

export async function removeManagedDirectory(
  outputPath: string,
  provider: ProviderId,
  dryRun: boolean,
  home = regletHome(),
  operation?: OperationContext,
): Promise<SafeWriteResult> {
  const previous = await getOutput(outputPath, home);
  const hash = sha256String('removed');

  if (dryRun) {
    return { status: 'skipped', backedUpTo: previous?.backedUpTo ?? null, hash };
  }

  if (operation !== undefined) {
    const snapshot = await operation.snapshotTarget(outputPath);
    await removePathAtomically(outputPath);
    await recordOutput(outputPath, {
      provider,
      content: 'skills',
      hash,
      appliedAt: new Date().toISOString(),
      backedUpTo: previous?.backedUpTo ?? snapshot.snapshot,
    }, home);
    return { status: 'written', backedUpTo: previous?.backedUpTo ?? snapshot.snapshot, hash };
  }

  const backedUpTo = previous?.backedUpTo ?? (await backupPathIfExists(outputPath, provider, home));
  await removePathAtomically(outputPath);
  await recordOutput(outputPath, {
    provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
  }, home);

  return { status: 'written', backedUpTo, hash };
}

async function backupPathIfExists(outputPath: string, provider: ProviderId, home: string): Promise<string | null> {
  try {
    await stat(outputPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const backupPath = path.join(
    home,
    '.state',
    'backups',
    provider,
    new Date().toISOString().replaceAll(':', '-'),
    path.basename(outputPath),
  );
  await ensurePrivateDir(path.dirname(backupPath));
  const stats = await stat(outputPath);
  if (stats.isDirectory()) {
    await cp(outputPath, backupPath, { recursive: true });
    await chmodPrivateTree(backupPath);
  } else {
    await copyFile(outputPath, backupPath);
    if (hasPosixModes()) {
      await chmod(backupPath, 0o600);
    }
  }
  return backupPath;
}

async function chmodPrivateTree(targetPath: string): Promise<void> {
  if (!hasPosixModes()) return;
  const target = await stat(targetPath);
  await chmod(targetPath, target.isDirectory() ? 0o700 : 0o600);
  if (!target.isDirectory()) return;
  for (const entry of await readdir(targetPath, { withFileTypes: true })) {
    await chmodPrivateTree(path.join(targetPath, entry.name));
  }
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

async function fileMatchesHash(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    return sha256String(await readFile(filePath)) === expectedHash;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function directoryMatchesHash(dirPath: string, expectedHash: string): Promise<boolean> {
  try {
    return (await hashDirectory(dirPath)) === expectedHash;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}
