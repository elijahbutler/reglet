import { copyFile, cp, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPrivateFile, ensurePrivateDir, hasPosixModes, writePrivateJson } from '../fsutil.js';
import { loadManifest, saveManifest, type Manifest, type ManifestOutput } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';
import type { ApplyContent } from './apply.js';

export type OperationLifecycle = 'pending' | 'completed' | 'rolled-back' | 'restored';
export type SnapshotKind = 'file' | 'directory' | 'missing';

export interface OperationTargetReceipt {
  path: string;
  snapshot: string | null;
  snapshotKind: SnapshotKind;
  manifestOutputBefore: ManifestOutput | null;
}

export interface OperationReceipt {
  version: 1;
  id: string;
  lifecycle: OperationLifecycle;
  startedAt: string;
  completedAt: string | null;
  scope: {
    providers?: ProviderId[];
    contents?: ApplyContent[];
  };
  structuredPreviewDigest?: string;
  masterRevision?: string;
  compositionRevisions?: Record<string, string>;
  targets: OperationTargetReceipt[];
  createdDirectories: string[];
  recovery: {
    attempted: boolean;
    recovered: boolean;
    message?: string;
  };
}

export interface RestoreOperationAction {
  path: string;
  action: 'restored' | 'removed';
}

export interface RecoveryResult {
  recovered: OperationReceipt[];
}

interface OperationJournal {
  version: 1;
  id: string;
  lifecycle: 'pending' | 'completed';
  startedAt: string;
  scope: OperationReceipt['scope'];
  structuredPreviewDigest?: string;
  masterRevision?: string;
  compositionRevisions?: Record<string, string>;
  targets: OperationTargetReceipt[];
  createdDirectories: string[];
  manifestSnapshot: Manifest;
}

export interface OperationContext {
  id: string;
  home: string;
  snapshotTarget(targetPath: string): Promise<OperationTargetReceipt>;
  complete(): Promise<OperationReceipt>;
  rollback(message: string): Promise<OperationReceipt>;
}

export interface BeginOperationOptions {
  home?: string;
  providers?: ProviderId[];
  contents?: ApplyContent[];
  structuredPreviewDigest?: string;
  masterRevision?: string;
  compositionRevisions?: Record<string, string>;
}

export async function beginOperation(options: BeginOperationOptions): Promise<OperationContext> {
  const home = options.home ?? regletHome();
  await recoverPendingOperations(home);
  await ensureOperationRoots(home);
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const journal: OperationJournal = {
    version: 1,
    id,
    lifecycle: 'pending',
    startedAt,
    scope: {
      ...(options.providers === undefined ? {} : { providers: options.providers }),
      ...(options.contents === undefined ? {} : { contents: options.contents }),
    },
    ...(options.structuredPreviewDigest === undefined ? {} : { structuredPreviewDigest: options.structuredPreviewDigest }),
    ...(options.masterRevision === undefined ? {} : { masterRevision: options.masterRevision }),
    ...(options.compositionRevisions === undefined ? {} : { compositionRevisions: options.compositionRevisions }),
    targets: [],
    createdDirectories: [],
    manifestSnapshot: await loadManifest(home),
  };
  await saveJournal(home, journal);

  return {
    id,
    home,
    async snapshotTarget(targetPath: string): Promise<OperationTargetReceipt> {
      const existing = journal.targets.find((target) => target.path === targetPath);
      if (existing !== undefined) {
        return existing;
      }
      for (const parent of await missingParentDirectories(targetPath)) {
        if (!journal.createdDirectories.includes(parent)) {
          journal.createdDirectories.push(parent);
        }
      }
      const target = await snapshotTarget(home, id, targetPath, journal.manifestSnapshot.outputs[targetPath] ?? null);
      journal.targets.push(target);
      await saveJournal(home, journal);
      return target;
    },
    async complete(): Promise<OperationReceipt> {
      journal.lifecycle = 'completed';
      await saveJournal(home, journal);
      const receipt = receiptFromJournal(journal, 'completed', {
        attempted: false,
        recovered: false,
      });
      await saveReceipt(home, receipt);
      await rm(journalPath(home, id), { force: true });
      return receipt;
    },
    async rollback(message: string): Promise<OperationReceipt> {
      await restoreJournalTargets(journal);
      await removeCreatedDirectories(journal.createdDirectories);
      await saveManifest(journal.manifestSnapshot, home);
      const receipt = receiptFromJournal(journal, 'rolled-back', {
        attempted: true,
        recovered: true,
        message,
      });
      await saveReceipt(home, receipt);
      await rm(journalPath(home, id), { force: true });
      return receipt;
    },
  };
}

export async function recoverPendingOperations(home = regletHome()): Promise<RecoveryResult> {
  await ensureOperationRoots(home);
  const recovered: OperationReceipt[] = [];
  for (const fileName of await safeReadDir(journalsDir(home))) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    const journal = await readJournal(path.join(journalsDir(home), fileName));
    if (journal.lifecycle === 'completed') {
      await saveReceipt(home, receiptFromJournal(journal, 'completed', {
        attempted: false,
        recovered: false,
      }));
      await rm(journalPath(home, journal.id), { force: true });
      continue;
    }
    await restoreJournalTargets(journal);
    await removeCreatedDirectories(journal.createdDirectories);
    await saveManifest(journal.manifestSnapshot, home);
    const receipt = receiptFromJournal(journal, 'rolled-back', {
      attempted: true,
      recovered: true,
      message: 'Recovered unfinished operation before a later mutation.',
    });
    await saveReceipt(home, receipt);
    await rm(journalPath(home, journal.id), { force: true });
    recovered.push(receipt);
  }
  return { recovered };
}

export async function listOperationReceipts(home = regletHome()): Promise<OperationReceipt[]> {
  const receipts: OperationReceipt[] = [];
  for (const fileName of await safeReadDir(receiptsDir(home))) {
    if (fileName.endsWith('.json')) {
      receipts.push(await getOperationReceipt(path.basename(fileName, '.json'), home));
    }
  }
  return receipts.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function getOperationReceipt(id: string, home = regletHome()): Promise<OperationReceipt> {
  const targetPath = receiptPath(home, id);
  await assertPrivateFile(targetPath);
  const parsed = JSON.parse(await readFile(targetPath, 'utf8')) as unknown;
  if (!isOperationReceipt(parsed)) {
    throw new Error(`Invalid operation receipt: ${id}`);
  }
  return parsed;
}

export async function restoreOperationReceipt(id: string, home = regletHome()): Promise<RestoreOperationAction[]> {
  const receipt = await getOperationReceipt(id, home);
  const operation = await beginOperation({
    home,
    ...(receipt.scope.providers === undefined ? {} : { providers: receipt.scope.providers }),
    ...(receipt.scope.contents === undefined ? {} : { contents: receipt.scope.contents }),
  });
  const actions: RestoreOperationAction[] = [];
  try {
    const manifest = await loadManifest(home);
    for (const target of receipt.targets) {
      await operation.snapshotTarget(target.path);
      await restoreTarget(target);
      if (target.manifestOutputBefore === null) {
        delete manifest.outputs[target.path];
      } else {
        manifest.outputs[target.path] = target.manifestOutputBefore;
      }
      actions.push({ path: target.path, action: target.snapshotKind === 'missing' ? 'removed' : 'restored' });
    }

    await saveManifest(manifest, home);
    await saveReceipt(home, {
      ...receipt,
      lifecycle: 'restored',
      completedAt: new Date().toISOString(),
      recovery: {
        attempted: true,
        recovered: true,
        message: 'Explicitly restored from receipt.',
      },
    });
    await operation.complete();
    return actions;
  } catch (error) {
    await operation.rollback(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function replacePathFromFile(sourceFile: string, targetPath: string): Promise<void> {
  const stage = `${targetPath}.reglet-stage-${randomUUID()}`;
  const displaced = `${targetPath}.reglet-previous-${randomUUID()}`;
  await mkdir(path.dirname(stage), { recursive: true });
  let movedExisting = false;
  try {
    await copyFile(sourceFile, stage);
    try {
      await rename(targetPath, displaced);
      movedExisting = true;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    }
    try {
      await rename(stage, targetPath);
    } catch (error) {
      if (movedExisting) {
        await rename(displaced, targetPath);
      }
      throw error;
    }
    if (movedExisting) {
      await rm(displaced, { recursive: true, force: true });
    }
  } finally {
    await rm(stage, { force: true });
  }
}

export async function replacePathFromText(content: string, targetPath: string): Promise<void> {
  const stage = `${targetPath}.reglet-stage-${randomUUID()}`;
  const displaced = `${targetPath}.reglet-previous-${randomUUID()}`;
  await mkdir(path.dirname(stage), { recursive: true });
  let movedExisting = false;
  try {
    await writeFile(stage, content, { mode: 0o600 });
    try {
      await rename(targetPath, displaced);
      movedExisting = true;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    }
    try {
      await rename(stage, targetPath);
    } catch (error) {
      if (movedExisting) {
        await rename(displaced, targetPath);
      }
      throw error;
    }
    if (movedExisting) {
      await rm(displaced, { recursive: true, force: true });
    }
  } finally {
    await rm(stage, { force: true });
  }
}

export async function replacePathFromDirectory(sourceDir: string, targetPath: string): Promise<void> {
  const stage = `${targetPath}.reglet-stage-${randomUUID()}`;
  const displaced = `${targetPath}.reglet-previous-${randomUUID()}`;
  await rm(stage, { recursive: true, force: true });
  let movedExisting = false;
  try {
    await cp(sourceDir, stage, { recursive: true });
    try {
      await rename(targetPath, displaced);
      movedExisting = true;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    }
    try {
      await rename(stage, targetPath);
    } catch (error) {
      if (movedExisting) {
        await rename(displaced, targetPath);
      }
      throw error;
    }
    if (movedExisting) {
      await rm(displaced, { recursive: true, force: true });
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function removePathAtomically(targetPath: string): Promise<void> {
  const stage = `${targetPath}.reglet-removed-${randomUUID()}`;
  try {
    await rename(targetPath, stage);
    await rm(stage, { recursive: true, force: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function snapshotTarget(
  home: string,
  operationId: string,
  targetPath: string,
  manifestOutputBefore: ManifestOutput | null,
): Promise<OperationTargetReceipt> {
  const snapshotRoot = path.join(snapshotsDir(home), operationId);
  await ensurePrivateDir(snapshotRoot);
  try {
    const targetStat = await stat(targetPath);
    const snapshot = path.join(snapshotRoot, encodeURIComponent(targetPath));
    if (targetStat.isDirectory()) {
      await cp(targetPath, snapshot, { recursive: true });
      await chmodPrivateTree(snapshot);
      return { path: targetPath, snapshot, snapshotKind: 'directory', manifestOutputBefore };
    }
    await copyFile(targetPath, snapshot);
    if (hasPosixModes()) {
      const { chmod } = await import('node:fs/promises');
      await chmod(snapshot, 0o600);
    }
    return { path: targetPath, snapshot, snapshotKind: 'file', manifestOutputBefore };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { path: targetPath, snapshot: null, snapshotKind: 'missing', manifestOutputBefore };
    }
    throw error;
  }
}

async function restoreJournalTargets(journal: OperationJournal): Promise<void> {
  for (const target of [...journal.targets].reverse()) {
    await restoreTarget(target);
  }
}

async function restoreTarget(target: OperationTargetReceipt): Promise<void> {
  if (target.snapshotKind === 'missing') {
    await removePathAtomically(target.path);
    await cleanupOperationSiblings(target.path);
    return;
  }
  if (target.snapshot === null) {
    throw new Error(`Receipt target is missing snapshot source: ${target.path}`);
  }
  if (target.snapshotKind === 'directory') {
    await replacePathFromDirectory(target.snapshot, target.path);
    await cleanupOperationSiblings(target.path);
    return;
  }
  await replacePathFromFile(target.snapshot, target.path);
  await cleanupOperationSiblings(target.path);
}

/**
 * If a process stops between sibling renames, the journal snapshot is enough
 * to restore the target. Remove only Reglet's UUID-tagged staging siblings
 * after that restoration so recovery does not leave stray provider folders.
 */
async function cleanupOperationSiblings(targetPath: string): Promise<void> {
  const parent = path.dirname(targetPath);
  const base = path.basename(targetPath);
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (
      entry.startsWith(`${base}.reglet-stage-`) ||
      entry.startsWith(`${base}.reglet-previous-`) ||
      entry.startsWith(`${base}.reglet-removed-`)
    ) {
      await rm(path.join(parent, entry), { recursive: true, force: true });
    }
  }
}

async function missingParentDirectories(targetPath: string): Promise<string[]> {
  const missing: string[] = [];
  let current = path.dirname(targetPath);
  while (true) {
    try {
      await stat(current);
      return missing;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
      missing.unshift(current);
      const parent = path.dirname(current);
      if (parent === current) {
        return missing;
      }
      current = parent;
    }
  }
}

async function removeCreatedDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY')) {
        continue;
      }
      throw error;
    }
  }
}

async function ensureOperationRoots(home: string): Promise<void> {
  await ensurePrivateDir(stateDir(home));
  await ensurePrivateDir(operationsDir(home));
  await ensurePrivateDir(journalsDir(home));
  await ensurePrivateDir(receiptsDir(home));
  await ensurePrivateDir(snapshotsDir(home));
}

async function saveJournal(home: string, journal: OperationJournal): Promise<void> {
  await writePrivateJson(journalPath(home, journal.id), journal);
}

async function saveReceipt(home: string, receipt: OperationReceipt): Promise<void> {
  await writePrivateJson(receiptPath(home, receipt.id), receipt);
}

async function readJournal(filePath: string): Promise<OperationJournal> {
  await assertPrivateFile(filePath);
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isOperationJournal(parsed)) {
    throw new Error(`Invalid operation journal: ${filePath}`);
  }
  return parsed;
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function receiptFromJournal(
  journal: OperationJournal,
  lifecycle: OperationLifecycle,
  recovery: OperationReceipt['recovery'],
): OperationReceipt {
  return {
    version: 1,
    id: journal.id,
    lifecycle,
    startedAt: journal.startedAt,
    completedAt: new Date().toISOString(),
    scope: journal.scope,
    ...(journal.structuredPreviewDigest === undefined ? {} : { structuredPreviewDigest: journal.structuredPreviewDigest }),
    ...(journal.masterRevision === undefined ? {} : { masterRevision: journal.masterRevision }),
    ...(journal.compositionRevisions === undefined ? {} : { compositionRevisions: journal.compositionRevisions }),
    targets: journal.targets,
    createdDirectories: journal.createdDirectories,
    recovery,
  };
}

async function chmodPrivateTree(root: string): Promise<void> {
  if (!hasPosixModes()) {
    return;
  }
  const { chmod } = await import('node:fs/promises');
  const rootStat = await stat(root);
  await chmod(root, rootStat.isDirectory() ? 0o700 : 0o600);
  if (!rootStat.isDirectory()) {
    return;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    await chmodPrivateTree(path.join(root, entry.name));
  }
}

function stateDir(home: string): string {
  return path.join(home, '.state');
}

function operationsDir(home: string): string {
  return path.join(stateDir(home), 'operations');
}

function journalsDir(home: string): string {
  return path.join(operationsDir(home), 'journals');
}

function receiptsDir(home: string): string {
  return path.join(operationsDir(home), 'receipts');
}

function snapshotsDir(home: string): string {
  return path.join(operationsDir(home), 'snapshots');
}

function journalPath(home: string, id: string): string {
  return path.join(journalsDir(home), `${id}.json`);
}

function receiptPath(home: string, id: string): string {
  return path.join(receiptsDir(home), `${id}.json`);
}

function isOperationReceipt(value: unknown): value is OperationReceipt {
  return isRecord(value) && value.version === 1 && typeof value.id === 'string' && isLifecycle(value.lifecycle) && typeof value.startedAt === 'string' && (typeof value.completedAt === 'string' || value.completedAt === null) && isRecord(value.scope) && optionalString(value.masterRevision) && optionalStringRecord(value.compositionRevisions) && Array.isArray(value.targets) && value.targets.every(isTarget) && Array.isArray(value.createdDirectories) && value.createdDirectories.every((directory) => typeof directory === 'string') && isRecord(value.recovery);
}

function isOperationJournal(value: unknown): value is OperationJournal {
  return isRecord(value) && value.version === 1 && typeof value.id === 'string' && (value.lifecycle === 'pending' || value.lifecycle === 'completed') && typeof value.startedAt === 'string' && isRecord(value.scope) && optionalString(value.masterRevision) && optionalStringRecord(value.compositionRevisions) && Array.isArray(value.targets) && value.targets.every(isTarget) && Array.isArray(value.createdDirectories) && value.createdDirectories.every((directory) => typeof directory === 'string') && isRecord(value.manifestSnapshot);
}

function isTarget(value: unknown): value is OperationTargetReceipt {
  return isRecord(value) && typeof value.path === 'string' && (typeof value.snapshot === 'string' || value.snapshot === null) && (value.snapshotKind === 'file' || value.snapshotKind === 'directory' || value.snapshotKind === 'missing') && (value.manifestOutputBefore === null || isManifestOutput(value.manifestOutputBefore));
}

function isManifestOutput(value: unknown): value is ManifestOutput {
  if (!isRecord(value)) return false;
  return typeof value.provider === 'string' &&
    (value.content === 'rules' || value.content === 'skills' || value.content === 'mcp') &&
    typeof value.hash === 'string' &&
    typeof value.appliedAt === 'string' &&
    (typeof value.backedUpTo === 'string' || value.backedUpTo === null) &&
    optionalString(value.masterRevision) &&
    optionalString(value.compositionRevision) &&
    (value.managedKeys === undefined || (Array.isArray(value.managedKeys) && value.managedKeys.every((key) => typeof key === 'string')));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalStringRecord(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every((item) => typeof item === 'string'));
}

function isLifecycle(value: unknown): value is OperationLifecycle {
  return value === 'pending' || value === 'completed' || value === 'rolled-back' || value === 'restored';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
