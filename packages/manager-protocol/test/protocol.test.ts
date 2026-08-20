import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import {
  failureResponse,
  isManagerProjectionReviewV3,
  isManagerProviderBackupPurgeResultV3,
  isManagerProviderBackupPurgeReviewV3,
  isManagerProviderDetachResultV3,
  isManagerProviderDetachReviewV3,
  isManagerProviderRestoreResultV3,
  isManagerProviderRestoreReviewV3,
  isManagerRecoveryRestoreResultV3,
  isManagerRecoveryReviewV3,
  isSyncConflictPreview,
  isManagerMutatingOperation,
  managerProtocolErrorCodes,
  managerProtocolOperations,
  managerProtocolV1Operations,
  operationInputSchemas,
  managerRpcRequestValidator,
  managerRpcResponseValidator,
  managerSnapshotV2DtoValidator,
  managerSnapshotV3DtoValidator,
  successResponse,
} from '../src/index.js';

const protocolFixtures = readJson('../fixtures/protocol-v1.json');
const protocolV2Fixtures = readJson('../fixtures/protocol-v2.json');
const snapshotFixture = readJson('../fixtures/snapshot-v2-empty.json');
const snapshotV3Fixture = readJson('../fixtures/snapshot-v3-empty.json');

describe('manager protocol v1', () => {
  test('validates request and response envelopes', () => {
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 1,
      operation: 'snapshot',
      input: { contractVersion: 2 },
    })).toBe(true);

    expect(managerRpcResponseValidator.validate(successResponse('snapshot', { version: 2 }))).toBe(true);
    expect(managerRpcResponseValidator.validate(failureResponse('unknown', 'UNKNOWN_OPERATION', 'No such operation.', false))).toBe(true);
  });

  test('rejects malformed envelopes and non-json values', () => {
    expect(managerRpcRequestValidator.validate({ protocolVersion: 1, operation: 'snapshot', input: undefined })).toBe(true);
    expect(managerRpcRequestValidator.validate({ protocolVersion: 1, operation: 'snapshot', input: Number.NaN })).toBe(false);
    expect(managerRpcRequestValidator.validate({ protocolVersion: 3, operation: 'snapshot' })).toBe(false);
    expect(managerRpcRequestValidator.validate({ protocolVersion: 1, operation: 'missing' })).toBe(false);
  });

  test('keeps operation and error code registries stable', () => {
    expect(managerProtocolOperations).toContain('structured-preview.apply');
    expect(managerProtocolOperations).toContain('legacy-state.clear');
    expect(managerProtocolErrorCodes).toContain('STALE_PLAN');
    expect(isManagerMutatingOperation('library.save')).toBe(true);
    expect(isManagerMutatingOperation('sync.snapshot')).toBe(false);
    expect(isManagerMutatingOperation('sync.pair.status')).toBe(false);
  });

  test('has a valid request fixture for every operation', () => {
    const requests = arrayProperty(protocolFixtures, 'requests');
    expect(requests.every((request) => managerRpcRequestValidator.validate(request))).toBe(true);
    expect(requests.map((request) => objectString(request, 'operation')).sort()).toEqual([...managerProtocolV1Operations].sort());
    const ajv = new Ajv({ strict: false });
    for (const request of requests) {
      if (!isObject(request)) throw new Error('request fixture must be an object');
      const operation = objectString(request, 'operation');
      if (!managerProtocolOperations.includes(operation as (typeof managerProtocolOperations)[number])) throw new Error('unknown fixture operation');
      expect(ajv.validate(operationInputSchemas[operation as (typeof managerProtocolOperations)[number]], request.input ?? {})).toBe(true);
    }
  });

  test('validates success and failure fixtures and rejects malformed operation inputs', () => {
    expect(arrayProperty(protocolFixtures, 'responses').every((response) => managerRpcResponseValidator.validate(response))).toBe(true);
    expect(arrayProperty(protocolFixtures, 'malformed').every((request) => !managerRpcRequestValidator.validate(request))).toBe(true);
    expect(managerRpcResponseValidator.validate({ ...failureResponse('snapshot', 'OPERATION_FAILED', 'failed', true), unexpected: true })).toBe(false);
  });

  test('accepts complete snapshot v2 fixtures and fails closed on partial or unknown snapshots', () => {
    expect(managerSnapshotV2DtoValidator.validate(snapshotFixture)).toBe(true);
    if (!isObject(snapshotFixture)) throw new Error('fixture must be an object');
    const partial = { ...snapshotFixture };
    delete partial.receipts;
    expect(managerSnapshotV2DtoValidator.validate(partial)).toBe(false);
    expect(managerSnapshotV2DtoValidator.validate({ ...snapshotFixture, version: 3 })).toBe(false);
    expect(managerSnapshotV2DtoValidator.validate({ ...snapshotFixture, safety: { localOnly: false, requiresExplicitReview: true } })).toBe(false);
  });
});

describe('manager protocol v2', () => {
  test('validates every canonical command fixture and rejects V2 commands on V1', () => {
    const requests = arrayProperty(protocolV2Fixtures, 'requests');
    expect(requests.every((request) => managerRpcRequestValidator.validate(request))).toBe(true);
    const canonicalOperations = managerProtocolOperations.filter(
      (operation) => !managerProtocolV1Operations.includes(operation as (typeof managerProtocolV1Operations)[number]),
    );
    const fixtureOperations = requests.map((request) => objectString(request, 'operation'));
    expect(canonicalOperations.every((operation) => fixtureOperations.includes(operation))).toBe(true);
    expect(managerRpcRequestValidator.validate({ protocolVersion: 1, operation: 'library.list', input: {} })).toBe(false);
  });

  test('validates strict inputs and response envelopes', () => {
    const ajv = new Ajv({ strict: false });
    for (const request of arrayProperty(protocolV2Fixtures, 'requests')) {
      if (!isObject(request)) throw new Error('request fixture must be an object');
      const operation = objectString(request, 'operation');
      if (!managerProtocolOperations.includes(operation as (typeof managerProtocolOperations)[number])) {
        throw new Error('unknown fixture operation');
      }
      expect(ajv.validate(operationInputSchemas[operation as (typeof managerProtocolOperations)[number]], request.input ?? {})).toBe(true);
    }
    expect(arrayProperty(protocolV2Fixtures, 'responses').every((response) => managerRpcResponseValidator.validate(response))).toBe(true);
    expect(arrayProperty(protocolV2Fixtures, 'malformed').every((request) => !managerRpcRequestValidator.validate(request))).toBe(true);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'provider.apply',
      input: {
        batchDigest: 'digest',
        units: [
          { provider: 'codex', content: 'rules', digest: 'first' },
          { provider: 'codex', content: 'rules', digest: 'second' },
        ],
      },
    })).toBe(false);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'provider.review',
      input: {
        units: [
          { provider: 'codex', content: 'rules' },
          { provider: 'codex', content: 'rules' },
        ],
      },
    })).toBe(false);
  });

  test('validates the redacted projection review contract', () => {
    const review = {
      version: 1,
      digest: 'batch-digest',
      units: [{
        key: 'codex:rules',
        provider: 'codex',
        content: 'rules',
        digest: 'unit-digest',
        masterRevision: 'master-revision',
        status: 'ready',
        validationIssues: [],
        entries: [{
          operation: 'write',
          path: '/provider/AGENTS.md',
          diff: '@@ -1 +1 @@',
          driftStatus: 'clean',
          expectedTargetHash: 'before-hash',
          resultingTargetHash: 'after-hash',
          snapshotBehavior: 'snapshot-before-write',
          backupBehavior: 'backup-before-write',
        }],
        artifacts: [{ id: 'artifact-id', title: 'General rules', kind: 'instruction' }],
        requiresDriftConfirmation: false,
      }],
    };
    expect(isManagerProjectionReviewV3(review)).toBe(true);
    expect(isManagerProjectionReviewV3({
      ...review,
      units: [{
        ...review.units[0],
        entries: [{ ...review.units[0]?.entries[0], before: 'private provider content' }],
      }],
    })).toBe(false);
    expect(isManagerProjectionReviewV3({
      ...review,
      units: [{ ...review.units[0], requiresDriftConfirmation: true }],
    })).toBe(false);
  });

  test('validates exact sync conflict comparisons', () => {
    const preview = {
      version: 1,
      path: 'rules/AGENTS.md',
      local: { state: 'text', content: 'local\n', size: 6, hash: 'local-hash' },
      remote: { state: 'deleted', content: null, size: 0, hash: null },
    };
    expect(isSyncConflictPreview(preview)).toBe(true);
    expect(isSyncConflictPreview({
      ...preview,
      local: { ...preview.local, size: 5 },
    })).toBe(false);
    expect(isSyncConflictPreview({
      ...preview,
      remote: { state: 'binary', content: 'raw', size: 3, hash: 'hash' },
    })).toBe(false);
  });

  test('validates exact receipt-bound recovery contracts', () => {
    const review = {
      version: 1,
      receipt: {
        id: 'receipt-id',
        lifecycle: 'completed',
        startedAt: '2026-08-19T12:00:00.000Z',
        completedAt: '2026-08-19T12:00:01.000Z',
        providers: ['codex'],
        contents: ['rules'],
        targetCount: 1,
        restorable: true,
      },
      digest: 'review-digest',
      targets: [{
        path: '/provider/AGENTS.md',
        action: 'restored',
        current: { kind: 'file', hash: 'current-hash', size: 12 },
        restored: { kind: 'file', hash: 'restored-hash', size: 10 },
      }],
    };
    expect(isManagerRecoveryReviewV3(review)).toBe(true);
    expect(isManagerRecoveryReviewV3({
      ...review,
      targets: [{ ...review.targets[0], snapshot: '/private/snapshot' }],
    })).toBe(false);
    expect(isManagerRecoveryReviewV3({
      ...review,
      receipt: { ...review.receipt, targetCount: 2 },
    })).toBe(false);
    expect(isManagerRecoveryRestoreResultV3({
      version: 1,
      receiptId: 'receipt-id',
      undoReceiptId: 'undo-receipt-id',
      actions: [{ path: '/provider/AGENTS.md', action: 'restored' }],
    })).toBe(true);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'recovery.restore',
      input: { receiptId: 'receipt-id', digest: 'review-digest', confirmed: false },
    })).toBe(false);
  });

  test('validates exact provider restore contracts', () => {
    const review = {
      version: 1,
      provider: 'codex',
      digest: 'restore-digest',
      status: 'ready',
      issues: [],
      targets: [{
        path: '/provider/AGENTS.md',
        content: 'rules',
        action: 'restored',
        current: { kind: 'file', hash: 'current-hash', size: 20 },
        restored: { kind: 'file', hash: 'original-hash', size: 12 },
      }],
    };
    expect(isManagerProviderRestoreReviewV3(review)).toBe(true);
    expect(isManagerProviderRestoreReviewV3({ ...review, backupPath: '/private/backup' })).toBe(false);
    expect(isManagerProviderRestoreReviewV3({ ...review, status: 'blocked' })).toBe(false);
    expect(isManagerProviderRestoreResultV3({
      version: 1,
      provider: 'codex',
      receiptId: 'receipt-id',
      results: [{ path: '/provider/AGENTS.md', action: 'restored' }],
    })).toBe(true);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'provider.restore',
      input: { provider: 'codex', confirmed: true },
    })).toBe(false);
  });

  test('validates exact provider detachment contracts', () => {
    const review = {
      version: 1,
      provider: 'codex',
      content: 'rules',
      digest: 'detach-digest',
      status: 'ready',
      issues: [],
      targets: [{
        path: '/provider/AGENTS.md',
        content: 'rules',
        operation: 'rewrite',
        diff: '--- before\n+++ after\n-generated header\n',
        current: { kind: 'file', hash: 'current-hash', size: 20 },
        resulting: { kind: 'file', hash: 'result-hash', size: 12 },
      }],
    };
    expect(isManagerProviderDetachReviewV3(review)).toBe(true);
    expect(isManagerProviderDetachReviewV3({
      ...review,
      targets: [{ ...review.targets[0], before: 'private provider content' }],
    })).toBe(false);
    expect(isManagerProviderDetachResultV3({
      version: 1,
      provider: 'codex',
      content: 'rules',
      receiptId: 'receipt-id',
      detached: [{ path: '/provider/AGENTS.md', headerRemoved: true }],
    })).toBe(true);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'provider.source.stop-managing',
      input: { provider: 'codex', content: 'rules', confirmed: true },
    })).toBe(false);
  });

  test('validates exact provider backup purge contracts', () => {
    const review = {
      version: 1,
      provider: 'codex',
      digest: 'purge-digest',
      backup: { kind: 'directory', hash: 'backup-hash', size: 42 },
      detachedOutputs: ['/provider/AGENTS.md'],
    };
    expect(isManagerProviderBackupPurgeReviewV3(review)).toBe(true);
    expect(isManagerProviderBackupPurgeReviewV3({ ...review, backupPath: '/private/backups' })).toBe(false);
    expect(isManagerProviderBackupPurgeResultV3({
      version: 1,
      provider: 'codex',
      removed: true,
      detachedOutputs: ['/provider/AGENTS.md'],
    })).toBe(true);
    expect(managerRpcRequestValidator.validate({
      protocolVersion: 2,
      operation: 'provider.purge-backups',
      input: { provider: 'codex', confirmed: true },
    })).toBe(false);
  });

  test('accepts Snapshot V3, rejects unknown fields, and keeps Snapshot V2 readable', () => {
    expect(managerSnapshotV3DtoValidator.validate(snapshotV3Fixture)).toBe(true);
    expect(managerSnapshotV2DtoValidator.validate(snapshotFixture)).toBe(true);
    if (!isObject(snapshotV3Fixture)) throw new Error('fixture must be an object');
    expect(managerSnapshotV3DtoValidator.validate({ ...snapshotV3Fixture, extra: true })).toBe(false);
    expect(managerSnapshotV3DtoValidator.validate({ ...snapshotV3Fixture, protocolVersion: 1 })).toBe(false);
    expect(managerSnapshotV3DtoValidator.validate({
      ...snapshotV3Fixture,
      permissions: { scope: 'read', canMutate: true, canAdmin: false },
    })).toBe(false);
  });
});

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayProperty(value: unknown, key: string): unknown[] {
  if (!isObject(value) || !Array.isArray(value[key])) throw new Error(`fixture ${key} must be an array`);
  return value[key];
}

function objectString(value: unknown, key: string): string {
  if (!isObject(value) || typeof value[key] !== 'string') throw new Error(`fixture ${key} must be a string`);
  return value[key];
}
