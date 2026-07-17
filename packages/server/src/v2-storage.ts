import { Database } from 'bun:sqlite';
import {
  canonicalJson,
  initialCheckpoint,
  syncV2CheckpointForEnvelope,
  syncV2Suite,
  type StoredSyncV2Envelope,
  type SyncV2Checkpoint,
  type SyncV2DeviceCertificate,
  type SyncV2DeviceIdentity,
  type SyncV2DeviceRecord,
  type SyncV2Envelope,
  type SyncV2MutationResponse,
  type SyncV2PairApproval,
  type SyncV2PairRequest,
} from '@reglet/core';
import { hashToken, randomCode, randomToken, sha256 } from './security.js';
import { connectionGrantLifetimeMs } from './admin-storage.js';
import { requireDevice } from './storage.js';

export interface SyncV2DeviceAuth {
  userId: number;
  deviceRowId: number;
  deviceId: string;
  deviceName: string;
  vaultId: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  certificate: SyncV2DeviceCertificate;
  authorityPublicKey: string;
  currentEpoch: number;
  checkpoint: SyncV2Checkpoint;
}

export interface CreatePairRequestInput {
  requestId: string;
  deviceTokenHash: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  invitationId?: string;
}

export interface SyncV2PairRequestWithToken {
  request: SyncV2PairRequest;
  requestToken: string;
}

export interface PairRequestRow extends SyncV2PairRequest {
  deviceTokenHash: string;
  requestTokenHash: string;
  approval: SyncV2PairApproval | null;
  claimedAt: string | null;
  invitationId: string | null;
}

export interface BootstrapConnectionInput {
  vaultId: string;
  deviceId: string;
  deviceName: string;
  deviceTokenHash: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  certificate: SyncV2DeviceCertificate;
  authorityPublicKey: string;
}

export type SyncV2CommitResult =
  | { ok: true; response: SyncV2MutationResponse }
  | { ok: false; reason: 'conflict'; headRevision: number; checkpoint: SyncV2Checkpoint }
  | { ok: false; reason: 'idempotency_reuse' | 'quota_exceeded' | 'nonce_reuse' };

const pairLifetimeMs = 10 * 60 * 1000;
const maximumDevicesPerVault = 25;
const maximumPendingPairRequests = 1000;
const maximumObjectsPerVault = 10_000;
const maximumHistoryPerVault = 100_000;

export function bootstrapSyncV2Vault(
  db: Database,
  legacyDeviceRowId: number,
  userId: number,
  input: {
    vaultId: string;
    deviceId: string;
    deviceName: string;
    agreementPublicKey: string;
    signingPublicKey: string;
    certificate: SyncV2DeviceCertificate;
    authorityPublicKey: string;
  },
  now: () => Date,
): 'created' | 'replayed' | 'exists' | 'device_conflict' {
  const bootstrap = db.transaction((): 'created' | 'replayed' | 'exists' | 'device_conflict' => {
    const existing = db.query('select id, authority_public_key from sync_vaults where user_id = ?').get(userId) as {
      id: string;
      authority_public_key: string;
    } | null;
    if (existing !== null) {
      const existingDevice = db.query(
        `select sync_device_id, agreement_public_key, signing_public_key from devices
         where id = ? and user_id = ? and revoked_at is null`,
      ).get(legacyDeviceRowId, userId) as {
        sync_device_id: string | null;
        agreement_public_key: string | null;
        signing_public_key: string | null;
      } | null;
      return existing.id === input.vaultId &&
        existing.authority_public_key === input.authorityPublicKey &&
        existingDevice?.sync_device_id === input.deviceId &&
        existingDevice.agreement_public_key === input.agreementPublicKey &&
        existingDevice.signing_public_key === input.signingPublicKey
        ? 'replayed'
        : 'exists';
    }
    const device = db.query('select sync_device_id from devices where id = ? and user_id = ?').get(
      legacyDeviceRowId,
      userId,
    ) as { sync_device_id: string | null } | null;
    if (device === null || device.sync_device_id !== null) return 'device_conflict';
    db.query(
      `insert into sync_vaults
       (id, user_id, suite, authority_public_key, current_epoch, sequence, checkpoint, created_at)
       values (?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run(input.vaultId, userId, syncV2Suite, input.authorityPublicKey, initialCheckpoint().digest, now().toISOString());
    db.query(
      `update devices set name = ?, sync_device_id = ?, agreement_public_key = ?, signing_public_key = ?, certificate_json = ?
       where id = ? and user_id = ?`,
    ).run(
      input.deviceName,
      input.deviceId,
      input.agreementPublicKey,
      input.signingPublicKey,
      canonicalJson(input.certificate),
      legacyDeviceRowId,
      userId,
    );
    return 'created';
  });
  return bootstrap();
}

export function approveBootstrapConnection(
  db: Database,
  grantId: string,
  userId: number,
  input: BootstrapConnectionInput,
  now: () => Date,
): 'created' | 'replayed' | 'conflict' {
  const approve = db.transaction((): 'created' | 'replayed' | 'conflict' => {
    const grant = db.query(
      `select status from connection_grants
       where id = ? and user_id = ? and kind = 'bootstrap' and expires_at >= ?`,
    ).get(grantId, userId, now().getTime()) as { status: string } | null;
    if (grant?.status === 'approved' || grant?.status === 'claimed') {
      const existing = db.query(
        `select v.id as vault_id, d.sync_device_id from sync_vaults v
         join devices d on d.user_id = v.user_id where v.user_id = ? and d.token_hash = ?`,
      ).get(userId, input.deviceTokenHash) as { vault_id: string; sync_device_id: string | null } | null;
      return existing?.vault_id === input.vaultId && existing.sync_device_id === input.deviceId ? 'replayed' : 'conflict';
    }
    if (grant?.status !== 'pending') return 'conflict';
    if ((db.query('select id from sync_vaults where user_id = ?').get(userId) as { id: string } | null) !== null) {
      return 'conflict';
    }
    db.query(
      `insert into sync_vaults
       (id, user_id, suite, authority_public_key, current_epoch, sequence, checkpoint, created_at)
       values (?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run(input.vaultId, userId, syncV2Suite, input.authorityPublicKey, initialCheckpoint().digest, now().toISOString());
    db.query(
      `insert into devices
       (user_id, name, token_hash, created_at, sync_device_id, agreement_public_key, signing_public_key, certificate_json)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      input.deviceName,
      input.deviceTokenHash,
      now().toISOString(),
      input.deviceId,
      input.agreementPublicKey,
      input.signingPublicKey,
      canonicalJson(input.certificate),
    );
    const approvedAt = now();
    const updated = db.query(
      "update connection_grants set status = 'approved', approved_at = ?, expires_at = ? where id = ? and status = 'pending'",
    ).run(approvedAt.toISOString(), approvedAt.getTime() + connectionGrantLifetimeMs, grantId);
    return updated.changes === 1 ? 'created' : 'conflict';
  });
  return approve();
}

export function requireSyncV2Device(
  db: Database,
  authorization: string | undefined,
  now: () => Date,
): SyncV2DeviceAuth | null {
  const base = requireDevice(db, authorization, now);
  if (base === null) return null;
  const row = db.query(
    `select d.name, d.sync_device_id, d.agreement_public_key, d.signing_public_key, d.certificate_json,
            v.id as vault_id, v.authority_public_key, v.current_epoch, v.sequence, v.checkpoint
     from devices d join sync_vaults v on v.user_id = d.user_id
     where d.id = ? and d.user_id = ? and d.revoked_at is null`,
  ).get(base.deviceId, base.userId) as {
    name: string;
    sync_device_id: string | null;
    agreement_public_key: string | null;
    signing_public_key: string | null;
    certificate_json: string | null;
    vault_id: string;
    authority_public_key: string;
    current_epoch: number;
    sequence: number;
    checkpoint: string;
  } | null;
  if (
    row === null ||
    row.sync_device_id === null ||
    row.agreement_public_key === null ||
    row.signing_public_key === null ||
    row.certificate_json === null
  ) {
    return null;
  }
  let certificate: SyncV2DeviceCertificate;
  try {
    certificate = JSON.parse(row.certificate_json) as SyncV2DeviceCertificate;
  } catch {
    return null;
  }
  return {
    userId: base.userId,
    deviceRowId: base.deviceId,
    deviceId: row.sync_device_id,
    deviceName: row.name,
    vaultId: row.vault_id,
    agreementPublicKey: row.agreement_public_key,
    signingPublicKey: row.signing_public_key,
    certificate,
    authorityPublicKey: row.authority_public_key,
    currentEpoch: row.current_epoch,
    checkpoint: { sequence: row.sequence, digest: row.checkpoint },
  };
}

export function createSyncV2PairRequest(
  db: Database,
  input: CreatePairRequestInput,
  now: () => Date,
): SyncV2PairRequestWithToken | null {
  const timestamp = now().getTime();
  db.query('delete from sync_pair_requests where expires_at < ?').run(timestamp);
  const pending = db.query('select count(*) as count from sync_pair_requests where claimed_at is null').get() as { count: number };
  if (pending.count >= maximumPendingPairRequests) return null;
  const requestToken = randomToken();
  const code = randomCode();
  const expiresAt = new Date(timestamp + pairLifetimeMs).toISOString();
  db.query(
    `insert into sync_pair_requests
     (id, code_hash, request_token_hash, device_token_hash, device_id, device_name,
      agreement_public_key, signing_public_key, expires_at, invitation_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.requestId,
    hashToken(code),
    hashToken(requestToken),
    input.deviceTokenHash,
    input.deviceId,
    input.deviceName,
    input.agreementPublicKey,
    input.signingPublicKey,
    timestamp + pairLifetimeMs,
    input.invitationId ?? null,
  );
  return {
    requestToken,
    request: {
      requestId: input.requestId,
      code,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      agreementPublicKey: input.agreementPublicKey,
      signingPublicKey: input.signingPublicKey,
      expiresAt,
    },
  };
}

export function pairRequestByCode(db: Database, code: string, now: () => Date): PairRequestRow | null {
  return pairRequestFromRow(
    db.query(
      `select id, request_token_hash, device_token_hash, device_id, device_name, agreement_public_key,
              signing_public_key, expires_at, approval_json, claimed_at,
              invitation_id, cancelled_at
       from sync_pair_requests where code_hash = ?`,
    ).get(hashToken(code)) as RawPairRequestRow | null,
    code,
    now,
  );
}

export function pairRequestByToken(
  db: Database,
  requestId: string,
  requestToken: string,
  now: () => Date,
): PairRequestRow | null {
  return pairRequestFromRow(
    db.query(
      `select id, request_token_hash, device_token_hash, device_id, device_name, agreement_public_key,
              signing_public_key, expires_at, approval_json, claimed_at,
              invitation_id, cancelled_at
       from sync_pair_requests where id = ? and request_token_hash = ?`,
    ).get(requestId, hashToken(requestToken)) as RawPairRequestRow | null,
    '',
    now,
  );
}

export function approveSyncV2PairRequest(
  db: Database,
  requestId: string,
  auth: SyncV2DeviceAuth,
  approval: SyncV2PairApproval,
  now: () => Date,
): boolean {
  const approve = db.transaction(() => {
    const deviceCount = db.query(
      'select count(*) as count from devices where user_id = ? and revoked_at is null and sync_device_id is not null',
    ).get(auth.userId) as { count: number };
    if (deviceCount.count >= maximumDevicesPerVault) return false;
    const binding = db.query(
      `select g.user_id, g.created_by_device_id
       from sync_pair_requests r join connection_grants g on g.id = r.invitation_id
       where r.id = ?`,
    ).get(requestId) as { user_id: number; created_by_device_id: number | null } | null;
    if (
      binding !== null &&
      (binding.user_id !== auth.userId ||
        (binding.created_by_device_id !== null && binding.created_by_device_id !== auth.deviceRowId))
    ) {
      return false;
    }
    const result = db.query(
      `update sync_pair_requests
       set approved_at = ?, user_id = ?, vault_id = ?, approver_device_id = ?, approval_json = ?
       where id = ? and approval_json is null and claimed_at is null and cancelled_at is null and expires_at >= ?`,
    ).run(
      now().toISOString(),
      auth.userId,
      auth.vaultId,
      auth.deviceId,
      canonicalJson(approval),
      requestId,
      now().getTime(),
    );
    if (result.changes !== 1) return false;
    db.query(
      `update connection_grants set status = 'approved', approved_at = ?
       where id = (select invitation_id from sync_pair_requests where id = ?) and status = 'pending'`,
    ).run(now().toISOString(), requestId);
    return true;
  });
  return approve();
}

export function claimSyncV2PairRequest(
  db: Database,
  row: PairRequestRow,
  now: () => Date,
): boolean {
  if (row.approval === null || row.claimedAt !== null) return false;
  const claim = db.transaction(() => {
    const pending = db.query(
      `select user_id, vault_id, approval_json, invitation_id from sync_pair_requests
       where id = ? and claimed_at is null and cancelled_at is null and expires_at >= ?`,
    ).get(row.requestId, now().getTime()) as {
      user_id: number | null;
      vault_id: string | null;
      approval_json: string | null;
      invitation_id: string | null;
    } | null;
    if (pending?.user_id === null || pending?.user_id === undefined || pending.vault_id === null || pending.approval_json === null) {
      return false;
    }
    const approval = JSON.parse(pending.approval_json) as SyncV2PairApproval;
    db.query(
      `insert into devices
       (user_id, name, token_hash, created_at, sync_device_id, agreement_public_key, signing_public_key, certificate_json)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pending.user_id,
      row.deviceName,
      row.deviceTokenHash,
      now().toISOString(),
      row.deviceId,
      row.agreementPublicKey,
      row.signingPublicKey,
      canonicalJson(approval.certificate),
    );
    const claimed = db.query('update sync_pair_requests set claimed_at = ? where id = ? and claimed_at is null').run(
      now().toISOString(),
      row.requestId,
    ).changes === 1;
    if (claimed && pending.invitation_id !== null) {
      db.query(
        "update connection_grants set status = 'claimed', claimed_at = ? where id = ? and status = 'approved'",
      ).run(now().toISOString(), pending.invitation_id);
    }
    return claimed;
  });
  return claim();
}

export function cancelSyncV2PairRequest(
  db: Database,
  requestId: string,
  requestToken: string,
  now: () => Date,
): boolean {
  const cancel = db.transaction(() => {
    const row = db.query(
      `select invitation_id from sync_pair_requests
       where id = ? and request_token_hash = ? and claimed_at is null and cancelled_at is null and expires_at >= ?`,
    ).get(requestId, hashToken(requestToken), now().getTime()) as { invitation_id: string | null } | null;
    if (row === null) return false;
    const changed = db.query(
      'update sync_pair_requests set cancelled_at = ? where id = ? and cancelled_at is null',
    ).run(now().toISOString(), requestId).changes === 1;
    if (changed && row.invitation_id !== null) {
      db.query(
        "update connection_grants set status = 'cancelled', cancelled_at = ? where id = ? and status in ('open', 'pending', 'approved')",
      ).run(now().toISOString(), row.invitation_id);
    }
    return changed;
  });
  return cancel();
}

export function commitSyncV2Envelope(
  db: Database,
  auth: SyncV2DeviceAuth,
  envelope: SyncV2Envelope,
  baseRevision: number,
  now: () => Date,
): SyncV2CommitResult {
  const checkpoint = syncV2CheckpointForEnvelope(envelope);
  const mutationDigest = checkpoint.digest;
  const commit = db.transaction((): SyncV2CommitResult => {
    const replay = db.query(
      'select mutation_digest, response_json from sync_mutations where device_row_id = ? and idempotency_key = ?',
    ).get(auth.deviceRowId, envelope.idempotencyKey) as { mutation_digest: string; response_json: string } | null;
    if (replay !== null) {
      if (replay.mutation_digest !== mutationDigest) return { ok: false, reason: 'idempotency_reuse' };
      return { ok: true, response: { ...(JSON.parse(replay.response_json) as SyncV2MutationResponse), replayed: true } };
    }

    const vault = db.query('select current_epoch, sequence, checkpoint from sync_vaults where id = ?').get(auth.vaultId) as {
      current_epoch: number;
      sequence: number;
      checkpoint: string;
    } | null;
    if (
      vault === null ||
      envelope.keyEpoch !== vault.current_epoch ||
      envelope.sequence !== vault.sequence + 1 ||
      envelope.previousCheckpoint.sequence !== vault.sequence ||
      envelope.previousCheckpoint.digest !== vault.checkpoint
    ) {
      return {
        ok: false,
        reason: 'conflict',
        headRevision: currentObjectRevision(db, auth.vaultId, envelope.objectId),
        checkpoint: vault === null ? initialCheckpoint() : { sequence: vault.sequence, digest: vault.checkpoint },
      };
    }
    const headRevision = currentObjectRevision(db, auth.vaultId, envelope.objectId);
    if (headRevision !== baseRevision || envelope.revision !== baseRevision + 1) {
      return {
        ok: false,
        reason: 'conflict',
        headRevision,
        checkpoint: { sequence: vault.sequence, digest: vault.checkpoint },
      };
    }
    if (headRevision === 0) {
      const objectCount = db.query('select count(*) as count from sync_objects where vault_id = ?').get(auth.vaultId) as {
        count: number;
      };
      if (objectCount.count >= maximumObjectsPerVault) return { ok: false, reason: 'quota_exceeded' };
    }
    const historyCount = db.query('select count(*) as count from sync_history where vault_id = ?').get(auth.vaultId) as {
      count: number;
    };
    if (historyCount.count >= maximumHistoryPerVault) return { ok: false, reason: 'quota_exceeded' };
    const duplicateNonce = db.query(
      'select 1 as found from sync_history where vault_id = ? and key_epoch = ? and nonce = ?',
    ).get(auth.vaultId, envelope.keyEpoch, envelope.nonce) as { found: number } | null;
    if (duplicateNonce !== null) return { ok: false, reason: 'nonce_reuse' };

    upsertSyncObject(db, envelope, checkpoint);
    insertSyncHistory(db, envelope, checkpoint, now);
    db.query('update sync_vaults set sequence = ?, checkpoint = ? where id = ?').run(
      checkpoint.sequence,
      checkpoint.digest,
      auth.vaultId,
    );
    const response: SyncV2MutationResponse = {
      revision: envelope.revision,
      sequence: envelope.sequence,
      checkpoint,
      replayed: false,
    };
    db.query(
      `insert into sync_mutations
       (device_row_id, idempotency_key, mutation_digest, response_json, created_at) values (?, ?, ?, ?, ?)`,
    ).run(auth.deviceRowId, envelope.idempotencyKey, mutationDigest, canonicalJson(response), now().toISOString());
    return { ok: true, response };
  });
  return commit();
}

export function listSyncV2Changes(
  db: Database,
  auth: SyncV2DeviceAuth,
  since: number,
  pageSize: number,
): { changes: StoredSyncV2Envelope[]; hasMore: boolean; checkpoint: SyncV2Checkpoint } | null {
  if (since > auth.checkpoint.sequence) return null;
  const rows = db.query(
    `select h.object_id, h.key_epoch, h.revision, h.sequence, h.author_device_id, h.nonce, h.ciphertext,
            h.previous_checkpoint_sequence, h.previous_checkpoint_digest, h.idempotency_key, h.signature, h.checkpoint,
            d.name as device_name, d.agreement_public_key, d.signing_public_key, d.certificate_json
     from sync_history h join devices d on d.sync_device_id = h.author_device_id
     where h.vault_id = ? and h.sequence > ? order by h.sequence asc limit ?`,
  ).all(auth.vaultId, since, pageSize + 1) as RawHistoryRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const changes = page.map((row) => storedEnvelopeFromRow(auth.vaultId, row));
  const checkpoint = changes.at(-1)?.checkpoint ?? checkpointAt(db, auth.vaultId, since);
  return checkpoint === null ? null : { changes, hasMore, checkpoint };
}

export function listSyncV2Devices(
  db: Database,
  auth: SyncV2DeviceAuth,
  cursor: number,
  pageSize: number,
): { devices: SyncV2DeviceRecord[]; cursor: number; hasMore: boolean } {
  const rows = db.query(
    `select id, name, sync_device_id, agreement_public_key, signing_public_key, certificate_json,
            created_at, last_seen_at, revoked_at
     from devices where user_id = ? and sync_device_id is not null and id > ? order by id asc limit ?`,
  ).all(auth.userId, cursor, pageSize + 1) as RawDeviceRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    devices: page.map(deviceRecordFromRow),
    cursor: page.at(-1)?.id ?? cursor,
    hasMore,
  };
}

interface RawPairRequestRow {
  id: string;
  request_token_hash: string;
  device_token_hash: string;
  device_id: string;
  device_name: string;
  agreement_public_key: string;
  signing_public_key: string;
  expires_at: number;
  approval_json: string | null;
  claimed_at: string | null;
  invitation_id: string | null;
  cancelled_at: string | null;
}

interface RawHistoryRow {
  object_id: string;
  key_epoch: number;
  revision: number;
  sequence: number;
  author_device_id: string;
  nonce: string;
  ciphertext: string;
  previous_checkpoint_sequence: number;
  previous_checkpoint_digest: string;
  idempotency_key: string;
  signature: string;
  checkpoint: string;
  device_name: string;
  agreement_public_key: string;
  signing_public_key: string;
  certificate_json: string;
}

interface RawDeviceRow {
  id: number;
  name: string;
  sync_device_id: string;
  agreement_public_key: string;
  signing_public_key: string;
  certificate_json: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

function pairRequestFromRow(row: RawPairRequestRow | null, code: string, now: () => Date): PairRequestRow | null {
  if (row === null || row.expires_at < now().getTime() || row.cancelled_at !== null) return null;
  let approval: SyncV2PairApproval | null = null;
  try {
    approval = row.approval_json === null ? null : JSON.parse(row.approval_json) as SyncV2PairApproval;
  } catch {
    return null;
  }
  return {
    requestId: row.id,
    code,
    deviceId: row.device_id,
    deviceName: row.device_name,
    agreementPublicKey: row.agreement_public_key,
    signingPublicKey: row.signing_public_key,
    expiresAt: new Date(row.expires_at).toISOString(),
    deviceTokenHash: row.device_token_hash,
    requestTokenHash: row.request_token_hash,
    approval,
    claimedAt: row.claimed_at,
    invitationId: row.invitation_id,
  };
}

function currentObjectRevision(db: Database, vaultId: string, objectId: string): number {
  const row = db.query('select revision from sync_objects where vault_id = ? and object_id = ?').get(
    vaultId,
    objectId,
  ) as { revision: number } | null;
  return row?.revision ?? 0;
}

function upsertSyncObject(db: Database, envelope: SyncV2Envelope, checkpoint: SyncV2Checkpoint): void {
  db.query(
    `insert into sync_objects
     (vault_id, object_id, key_epoch, revision, sequence, author_device_id, nonce, ciphertext,
      previous_checkpoint_sequence, previous_checkpoint_digest, idempotency_key, signature, checkpoint)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(vault_id, object_id) do update set
       key_epoch = excluded.key_epoch, revision = excluded.revision, sequence = excluded.sequence,
       author_device_id = excluded.author_device_id, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
       previous_checkpoint_sequence = excluded.previous_checkpoint_sequence,
       previous_checkpoint_digest = excluded.previous_checkpoint_digest,
       idempotency_key = excluded.idempotency_key, signature = excluded.signature, checkpoint = excluded.checkpoint`,
  ).run(...envelopeSqlValues(envelope, checkpoint));
}

function insertSyncHistory(db: Database, envelope: SyncV2Envelope, checkpoint: SyncV2Checkpoint, now: () => Date): void {
  db.query(
    `insert into sync_history
     (vault_id, object_id, key_epoch, revision, sequence, author_device_id, nonce, ciphertext,
      previous_checkpoint_sequence, previous_checkpoint_digest, idempotency_key, signature, checkpoint, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...envelopeSqlValues(envelope, checkpoint), now().toISOString());
}

function envelopeSqlValues(envelope: SyncV2Envelope, checkpoint: SyncV2Checkpoint): Array<string | number> {
  return [
    envelope.vaultId,
    envelope.objectId,
    envelope.keyEpoch,
    envelope.revision,
    envelope.sequence,
    envelope.authorDeviceId,
    envelope.nonce,
    envelope.ciphertext,
    envelope.previousCheckpoint.sequence,
    envelope.previousCheckpoint.digest,
    envelope.idempotencyKey,
    envelope.signature,
    checkpoint.digest,
  ];
}

function storedEnvelopeFromRow(vaultId: string, row: RawHistoryRow): StoredSyncV2Envelope {
  const author: SyncV2DeviceIdentity = {
    deviceId: row.author_device_id,
    deviceName: row.device_name,
    agreementPublicKey: row.agreement_public_key,
    signingPublicKey: row.signing_public_key,
    certificate: JSON.parse(row.certificate_json) as SyncV2DeviceCertificate,
  };
  return {
    protocolVersion: 2,
    suite: syncV2Suite,
    vaultId,
    objectId: row.object_id,
    keyEpoch: row.key_epoch,
    revision: row.revision,
    sequence: row.sequence,
    authorDeviceId: row.author_device_id,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    previousCheckpoint: {
      sequence: row.previous_checkpoint_sequence,
      digest: row.previous_checkpoint_digest,
    },
    idempotencyKey: row.idempotency_key,
    signature: row.signature,
    checkpoint: { sequence: row.sequence, digest: row.checkpoint },
    author,
  };
}

function checkpointAt(db: Database, vaultId: string, sequence: number): SyncV2Checkpoint | null {
  if (sequence === 0) return initialCheckpoint();
  const row = db.query('select checkpoint from sync_history where vault_id = ? and sequence = ?').get(
    vaultId,
    sequence,
  ) as { checkpoint: string } | null;
  return row === null ? null : { sequence, digest: row.checkpoint };
}

function deviceRecordFromRow(row: RawDeviceRow): SyncV2DeviceRecord {
  return {
    deviceId: row.sync_device_id,
    deviceName: row.name,
    agreementPublicKey: row.agreement_public_key,
    signingPublicKey: row.signing_public_key,
    certificate: JSON.parse(row.certificate_json) as SyncV2DeviceCertificate,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

export function deviceTokenHash(token: string): string {
  return hashToken(token);
}

export function mutationDigest(envelope: SyncV2Envelope): string {
  return sha256(Buffer.from(canonicalJson(envelope)));
}
