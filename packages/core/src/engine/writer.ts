import { randomUUID } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256File, sha256String, writeFileEnsuringDir } from '../fsutil.js';
import { getOutput, recordOutput, type ManagedContent } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ApplyStatus, ProviderId } from '../providers/types.js';
import { copySkillSafely, inspectSkill } from '../security/skills.js';

export interface SafeWriteFileOptions {
  outputPath: string;
  content: string;
  provider: ProviderId;
  managedContent: ManagedContent;
  dryRun: boolean;
  managedKeys?: string[];
  home?: string;
}

export interface SafeWriteDirectoryOptions {
  sourceDir: string;
  outputPath: string;
  provider: ProviderId;
  dryRun: boolean;
  home?: string;
}

export interface SafeWriteResult {
  status: ApplyStatus;
  backedUpTo: string | null;
  hash: string;
  appliedHash?: string;
  observedHash?: string;
  appliedAt?: string;
}

export async function safeWriteFile(options: SafeWriteFileOptions): Promise<SafeWriteResult> {
  const home = options.home ?? regletHome();
  const hash = sha256String(options.content);
  const previous = await getOutput(options.outputPath, home);
  const observedHash = await observedFileHash(options.outputPath);

  if (
    previous?.hash === hash &&
    observedHash === hash
  ) {
    return {
      status: 'unchanged',
      backedUpTo: previous.backedUpTo,
      hash,
      appliedHash: previous.hash,
      observedHash,
      appliedAt: previous.appliedAt,
    };
  }

  if (options.dryRun) {
    return {
      status: 'skipped',
      backedUpTo: previous?.backedUpTo ?? null,
      hash,
      appliedHash: previous?.hash,
      observedHash,
      appliedAt: previous?.appliedAt,
    };
  }

  const writeBackup = await backupPathIfExists(options.outputPath, options.provider, home);
  const backedUpTo = previous === undefined ? writeBackup : previous.backedUpTo;
  await writeFileEnsuringDir(options.outputPath, options.content);
  if (options.managedContent === 'mcp') {
    await chmod(options.outputPath, 0o600);
  }
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: options.managedContent,
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
    managedKeys: options.managedKeys,
  }, home);

  return {
    status: 'written',
    backedUpTo,
    hash,
    appliedHash: hash,
    observedHash: hash,
    appliedAt: new Date().toISOString(),
  };
}

export async function safeWriteDirectory(options: SafeWriteDirectoryOptions): Promise<SafeWriteResult> {
  const home = options.home ?? regletHome();
  const inspection = await inspectSkill(options.sourceDir);
  if (inspection.promotionBlocked) {
    const issue = inspection.risks.find((risk) => risk.severity === 'error');
    throw new Error(issue?.message ?? 'Skill failed its trust inspection.');
  }
  const hash = await hashDirectory(options.sourceDir);
  const previous = await getOutput(options.outputPath, home);
  const observedHash = await observedDirectoryHash(options.outputPath);

  if (
    previous?.hash === hash &&
    observedHash === hash
  ) {
    return {
      status: 'unchanged',
      backedUpTo: previous.backedUpTo,
      hash,
      appliedHash: previous.hash,
      observedHash,
      appliedAt: previous.appliedAt,
    };
  }

  if (options.dryRun) {
    return {
      status: 'skipped',
      backedUpTo: previous?.backedUpTo ?? null,
      hash,
      appliedHash: previous?.hash,
      observedHash,
      appliedAt: previous?.appliedAt,
    };
  }

  const writeBackup = await backupPathIfExists(options.outputPath, options.provider, home);
  const backedUpTo = previous === undefined ? writeBackup : previous.backedUpTo;
  const temporaryPath = path.join(
    path.dirname(options.outputPath),
    `.${path.basename(options.outputPath)}.reglet-${randomUUID()}`,
  );
  await rm(temporaryPath, { recursive: true, force: true });
  await copySkillSafely(options.sourceDir, temporaryPath);
  await rm(options.outputPath, { recursive: true, force: true });
  try {
    await rename(temporaryPath, options.outputPath);
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
  await recordOutput(options.outputPath, {
    provider: options.provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
  }, home);

  return {
    status: 'written',
    backedUpTo,
    hash,
    appliedHash: hash,
    observedHash: hash,
    appliedAt: new Date().toISOString(),
  };
}

export async function removeManagedDirectory(
  outputPath: string,
  provider: ProviderId,
  dryRun: boolean,
  home = regletHome(),
): Promise<SafeWriteResult> {
  const previous = await getOutput(outputPath, home);
  const hash = sha256String('removed');
  const observedHash = await observedDirectoryHash(outputPath);

  if (dryRun) {
    return {
      status: 'skipped',
      backedUpTo: previous?.backedUpTo ?? null,
      hash,
      appliedHash: previous?.hash,
      observedHash,
      appliedAt: previous?.appliedAt,
    };
  }

  const writeBackup = await backupPathIfExists(outputPath, provider, home);
  const backedUpTo = previous === undefined ? writeBackup : previous.backedUpTo;
  await rm(outputPath, { recursive: true, force: true });
  await recordOutput(outputPath, {
    provider,
    content: 'skills',
    hash,
    appliedAt: new Date().toISOString(),
    backedUpTo,
  }, home);

  return {
    status: 'written',
    backedUpTo,
    hash,
    appliedHash: hash,
    appliedAt: new Date().toISOString(),
  };
}

async function backupPathIfExists(
  outputPath: string,
  provider: ProviderId,
  home: string,
): Promise<string | null> {
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
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
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
        const relPath = path.relative(dirPath, entryPath);
        parts.push(`${relPath}\0${(await readFile(entryPath)).toString('base64')}`);
      }
    }
  }

  await visit(dirPath);
  return sha256String(parts.join('\0'));
}

async function observedFileHash(filePath: string): Promise<string | undefined> {
  try {
    return await sha256File(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function observedDirectoryHash(
  dirPath: string,
): Promise<string | undefined> {
  try {
    return await hashDirectory(dirPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
