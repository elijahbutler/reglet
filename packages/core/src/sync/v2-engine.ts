import { lstat, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256String, writePrivateFile } from '../fsutil.js';
import { regletHome } from '../paths.js';
import { tryMergeText } from './engine.js';
import { SyncV2Client } from './v2-client.js';
import {
  loadSyncV2DeviceSecrets,
  platformSyncV2SecretStore,
  type SyncV2SecretStore,
} from './v2-credentials.js';
import {
  createSyncV2Envelope,
  decryptSyncV2Envelope,
  sameCheckpoint,
  syncV2AuthorityPublicKey,
  syncV2CheckpointForEnvelope,
  verifyStoredSyncV2Envelope,
} from './v2-crypto.js';
import { requireAllowedEncryptedSyncPath, resolveEncryptedSyncPath } from './v2-path.js';
import {
  loadActiveSyncV2State,
  saveSyncV2State,
  type ActiveSyncV2State,
} from './v2-state.js';
import type { SyncV2DeviceSecrets, SyncV2ObjectPlaintext, StoredSyncV2Envelope } from './v2-types.js';

export interface SyncV2Result {
  pulled: string[];
  pushed: string[];
  merged: string[];
  conflicts: string[];
  deleted: string[];
  providerReviewRequired: boolean;
}

export interface SyncV2OnceOptions {
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}

interface DecryptedChange {
  envelope: StoredSyncV2Envelope;
  plaintext: SyncV2ObjectPlaintext;
  content: Uint8Array;
  hash: string;
}

export async function syncOnceV2(options: SyncV2OnceOptions = {}): Promise<SyncV2Result> {
  const home = options.home ?? regletHome();
  const state = await loadActiveSyncV2State(home);
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const secrets = await loadSyncV2DeviceSecrets(state.credentialId, store);
  if (secrets.vaultId !== state.vaultId || secrets.keyEpoch !== state.keyEpoch) {
    throw new Error('Sync state does not match the operating system credential store');
  }
  await repairDerivedSyncV2Bases(home, state);
  const client = new SyncV2Client(state.serverUrl, options.fetchImpl);
  await client.ensureCompatible();
  const result: SyncV2Result = {
    pulled: [],
    pushed: [],
    merged: [],
    conflicts: [],
    deleted: [],
    providerReviewRequired: false,
  };
  const pullChanged = await pullEncryptedChanges(home, state, secrets, client, result);
  await pushEncryptedChanges(home, state, secrets, client, result);
  result.providerReviewRequired = pullChanged || result.merged.length > 0 || result.conflicts.length > 0;
  state.lastSync = {
    completedAt: new Date().toISOString(),
    pulled: result.pulled.length,
    pushed: result.pushed.length,
    merged: result.merged.length,
    conflicts: result.conflicts.length,
    deleted: result.deleted.length,
    providerReviewRequired: result.providerReviewRequired,
  };
  await saveSyncV2State(state, home);
  return result;
}

async function pullEncryptedChanges(
  home: string,
  state: ActiveSyncV2State,
  secrets: SyncV2DeviceSecrets,
  client: SyncV2Client,
  result: SyncV2Result,
): Promise<boolean> {
  let changed = false;
  let hasMore = true;
  const authorityPublicKey = syncV2AuthorityPublicKey(secrets.authoritySecretKey);
  while (hasMore) {
    const page = await client.changes(secrets.deviceToken, state.cursor);
    let expectedCheckpoint = state.checkpoint;
    const decrypted: DecryptedChange[] = [];
    for (const envelope of page.changes) {
      verifyStoredSyncV2Envelope(envelope, authorityPublicKey, expectedCheckpoint);
      if (envelope.vaultId !== state.vaultId || envelope.keyEpoch !== state.keyEpoch) {
        throw new Error('Sync rejected an envelope from another vault or key epoch');
      }
      const plaintext = decryptSyncV2Envelope(envelope, secrets.rootSecret);
      const content = plaintext.deleted ? new Uint8Array() : Buffer.from(plaintext.contentBase64, 'base64');
      decrypted.push({
        envelope,
        plaintext,
        content,
        hash: plaintext.deleted ? '' : sha256String(content),
      });
      expectedCheckpoint = envelope.checkpoint;
    }
    if (!sameCheckpoint(page.checkpoint, expectedCheckpoint) || page.cursor !== expectedCheckpoint.sequence) {
      throw new Error('Sync rejected an inconsistent encrypted changes page checkpoint');
    }
    for (const change of decrypted) {
      changed = (await applyDecryptedChange(home, state, change, result)) || changed;
    }
    state.cursor = page.cursor;
    state.checkpoint = page.checkpoint;
    await saveSyncV2State(state, home);
    hasMore = page.hasMore;
  }
  return changed;
}

async function applyDecryptedChange(
  home: string,
  state: ActiveSyncV2State,
  change: DecryptedChange,
  result: SyncV2Result,
): Promise<boolean> {
  const filePath = requireAllowedEncryptedSyncPath(change.plaintext.canonicalPath);
  const known = state.files[filePath];
  if (known !== undefined && known.objectId !== change.envelope.objectId) {
    throw new Error(`Sync rejected an object identity change for ${JSON.stringify(filePath)}`);
  }
  if (
    known?.revision === change.envelope.revision &&
    known.hash === change.hash &&
    (known.deleted === true) === change.plaintext.deleted
  ) {
    return false;
  }
  const localPath = await safeLocalSyncV2Path(home, filePath);
  const basePath = await safeSyncV2BasePath(home, filePath);
  const localHash = await optionalFileHash(localPath);
  const baseHash = await optionalFileHash(basePath);

  if (change.plaintext.deleted) {
    const locallyChanged = localHash !== null && (baseHash === null || localHash !== baseHash);
    if (known?.conflicted === true || locallyChanged) {
      await recordEncryptedConflict(home, state, filePath, change, result);
      return true;
    }
    await rm(localPath, { force: true, recursive: true });
    await rm(basePath, { force: true });
    state.files[filePath] = {
      objectId: change.envelope.objectId,
      revision: change.envelope.revision,
      hash: '',
      deleted: true,
    };
    result.deleted.push(filePath);
    return true;
  }

  const localDeleted = localHash === null && baseHash !== null;
  const locallyChanged = localHash !== null && localHash !== change.hash && (baseHash === null || localHash !== baseHash);
  if (known?.conflicted === true || localDeleted || locallyChanged) {
    if (localHash !== null && known?.conflicted !== true) {
      const localContent = await readFile(localPath);
      const baseContent = baseHash === null ? null : await readFile(basePath);
      const merged = tryMergeText(baseContent, localContent, change.content);
      if (merged !== null) {
        await writePrivateFile(localPath, merged);
        await writePrivateFile(basePath, change.content);
        state.files[filePath] = {
          objectId: change.envelope.objectId,
          revision: change.envelope.revision,
          hash: change.hash,
        };
        result.merged.push(filePath);
        return true;
      }
    }
    await recordEncryptedConflict(home, state, filePath, change, result);
    return true;
  }

  await writePrivateFile(localPath, change.content);
  await writePrivateFile(basePath, change.content);
  state.files[filePath] = {
    objectId: change.envelope.objectId,
    revision: change.envelope.revision,
    hash: change.hash,
  };
  result.pulled.push(filePath);
  return true;
}

async function pushEncryptedChanges(
  home: string,
  state: ActiveSyncV2State,
  secrets: SyncV2DeviceSecrets,
  client: SyncV2Client,
  result: SyncV2Result,
): Promise<void> {
  const files = await collectEncryptedSyncFiles(home);
  const currentFiles = new Set(files);
  for (const filePath of files) {
    const localPath = await safeLocalSyncV2Path(home, filePath);
    const basePath = await safeSyncV2BasePath(home, filePath);
    const content = await readFile(localPath);
    const hash = sha256String(content);
    const tracked = state.files[filePath];
    if (tracked?.conflicted === true) {
      const conflictPath = conflictFilePath(localPath, state.deviceName);
      if (tracked.deleted !== true && tracked.hash === hash) {
        await rm(conflictPath, { force: true });
        state.files[filePath] = { ...tracked, conflicted: false };
        await saveSyncV2State(state, home);
        continue;
      }
      if (await pathExists(conflictPath)) continue;
      state.files[filePath] = { ...tracked, conflicted: false };
    }
    if (state.files[filePath]?.hash === hash && state.files[filePath]?.deleted !== true) continue;
    await pushOneEncryptedChange(home, state, secrets, client, result, filePath, content, hash, false);
    await writePrivateFile(basePath, content);
  }

  for (const [filePath, tracked] of Object.entries(state.files)) {
    if (currentFiles.has(filePath)) continue;
    requireAllowedEncryptedSyncPath(filePath);
    const localPath = await safeLocalSyncV2Path(home, filePath);
    const basePath = await safeSyncV2BasePath(home, filePath);
    if (tracked.conflicted === true) {
      const conflictPath = conflictFilePath(localPath, state.deviceName);
      if (await pathExists(conflictPath)) continue;
      state.files[filePath] = { ...tracked, conflicted: false };
      if (tracked.deleted === true) {
        await saveSyncV2State(state, home);
        continue;
      }
    } else if (tracked.deleted === true) {
      continue;
    }
    await pushOneEncryptedChange(home, state, secrets, client, result, filePath, new Uint8Array(), '', true);
    await rm(basePath, { force: true });
  }
}

async function pushOneEncryptedChange(
  home: string,
  state: ActiveSyncV2State,
  secrets: SyncV2DeviceSecrets,
  client: SyncV2Client,
  result: SyncV2Result,
  filePath: string,
  content: Uint8Array,
  hash: string,
  deleted: boolean,
): Promise<void> {
  const tracked = state.files[filePath];
  const baseRevision = tracked?.revision ?? 0;
  const envelope = createSyncV2Envelope({
    vaultId: state.vaultId,
    rootSecret: secrets.rootSecret,
    keyEpoch: state.keyEpoch,
    path: filePath,
    content,
    deleted,
    revision: baseRevision + 1,
    sequence: state.checkpoint.sequence + 1,
    authorDeviceId: state.deviceId,
    signingSecretKey: secrets.signingSecretKey,
    previousCheckpoint: state.checkpoint,
  });
  const mutation = await client.putEnvelope(secrets.deviceToken, envelope, baseRevision);
  if (!mutation.ok) {
    throw new Error(
      `Sync changed on another device while uploading ${JSON.stringify(filePath)}. ` +
        'No local content was discarded; run sync again to pull and review the conflict.',
    );
  }
  if (
    mutation.response.revision !== envelope.revision ||
    mutation.response.sequence !== envelope.sequence ||
    !sameCheckpoint(mutation.response.checkpoint, syncV2CheckpointForEnvelope(envelope))
  ) {
    throw new Error('Sync server returned inconsistent encrypted mutation metadata');
  }
  state.cursor = mutation.response.sequence;
  state.checkpoint = mutation.response.checkpoint;
  state.files[filePath] = {
    objectId: envelope.objectId,
    revision: envelope.revision,
    hash,
    ...(deleted ? { deleted: true } : {}),
  };
  if (deleted) result.deleted.push(filePath);
  else result.pushed.push(filePath);
  await saveSyncV2State(state, home);
}

async function recordEncryptedConflict(
  home: string,
  state: ActiveSyncV2State,
  filePath: string,
  remote: DecryptedChange,
  result: SyncV2Result,
): Promise<void> {
  const localPath = await safeLocalSyncV2Path(home, filePath);
  const basePath = await safeSyncV2BasePath(home, filePath);
  const conflictPath = conflictFilePath(localPath, state.deviceName);
  await writePrivateFile(conflictPath, remote.content);
  if (remote.plaintext.deleted) await rm(basePath, { force: true });
  else await writePrivateFile(basePath, remote.content);
  state.files[filePath] = {
    objectId: remote.envelope.objectId,
    revision: remote.envelope.revision,
    hash: remote.hash,
    deleted: remote.plaintext.deleted,
    conflicted: true,
  };
  const relativeConflict = path.relative(home, conflictPath).split(path.sep).join('/');
  if (!result.conflicts.includes(relativeConflict)) result.conflicts.push(relativeConflict);
}

async function collectEncryptedSyncFiles(home: string): Promise<string[]> {
  const files: string[] = [];
  await collectUnder(path.join(home, 'rules'), 'rules', files);
  await collectUnder(path.join(home, 'skills'), 'skills', files);
  await collectUnder(path.join(home, 'mcp', 'providers'), 'mcp/providers', files);
  if (await pathExists(path.join(home, 'mcp', 'servers.json'))) files.push('mcp/servers.json');
  return files.sort((left, right) => left.localeCompare(right));
}

async function repairDerivedSyncV2Bases(home: string, state: ActiveSyncV2State): Promise<void> {
  for (const [filePath, tracked] of Object.entries(state.files)) {
    if (tracked.conflicted === true) continue;
    requireAllowedEncryptedSyncPath(filePath);
    const localPath = await safeLocalSyncV2Path(home, filePath);
    const basePath = await safeSyncV2BasePath(home, filePath);
    if (tracked.deleted === true) {
      await rm(basePath, { force: true });
      continue;
    }
    const localHash = await optionalFileHash(localPath);
    if (localHash === tracked.hash && (await optionalFileHash(basePath)) !== tracked.hash) {
      await writePrivateFile(basePath, await readFile(localPath));
    }
  }
}

async function collectUnder(absoluteDirectory: string, relativeDirectory: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isLocalOnlySyncArtifact(entry.name)) continue;
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) await collectUnder(absolutePath, relativePath, files);
    else if (entry.isFile()) files.push(requireAllowedEncryptedSyncPath(relativePath));
  }
}

function syncV2BasePath(home: string, filePath: string): string {
  return resolveEncryptedSyncPath(path.join(home, '.state', 'sync-v2-bases'), filePath);
}

async function safeSyncV2BasePath(home: string, filePath: string): Promise<string> {
  const target = syncV2BasePath(home, filePath);
  await rejectSymbolicLinkComponents(home, target, filePath);
  return target;
}

async function safeLocalSyncV2Path(home: string, filePath: string): Promise<string> {
  const target = resolveEncryptedSyncPath(home, filePath);
  await rejectSymbolicLinkComponents(home, target, filePath);
  return target;
}

async function rejectSymbolicLinkComponents(root: string, target: string, filePath: string): Promise<void> {
  const relative = path.relative(path.resolve(root), target);
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Sync rejected a symbolic-link path component: ${JSON.stringify(filePath)}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') break;
      throw error;
    }
  }
}

function conflictFilePath(filePath: string, deviceName: string): string {
  const extension = path.extname(filePath);
  const withoutExtension = extension.length === 0 ? filePath : filePath.slice(0, -extension.length);
  return `${withoutExtension}.conflict-${sanitizeDeviceName(deviceName)}${extension}`;
}

function sanitizeDeviceName(deviceName: string): string {
  return deviceName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
}

function isLocalOnlySyncArtifact(name: string): boolean {
  return (
    name.endsWith('~') ||
    name.endsWith('.bak') ||
    name.endsWith('.backup') ||
    name.includes('.conflict-') ||
    name.includes('.reglet-stage-')
  );
}

async function optionalFileHash(filePath: string): Promise<string | null> {
  try {
    return sha256String(await readFile(filePath));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
