import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import {
  failureResponse,
  managerProtocolErrorCodes,
  managerProtocolOperations,
  operationInputSchemas,
  managerRpcRequestValidator,
  managerRpcResponseValidator,
  managerSnapshotV2DtoValidator,
  successResponse,
} from '../src/index.js';

const protocolFixtures = readJson('../fixtures/protocol-v1.json');
const snapshotFixture = readJson('../fixtures/snapshot-v2-empty.json');

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
    expect(managerRpcRequestValidator.validate({ protocolVersion: 2, operation: 'snapshot' })).toBe(false);
    expect(managerRpcRequestValidator.validate({ protocolVersion: 1, operation: 'missing' })).toBe(false);
  });

  test('keeps operation and error code registries stable', () => {
    expect(managerProtocolOperations).toContain('structured-preview.apply');
    expect(managerProtocolOperations).toContain('legacy-state.clear');
    expect(managerProtocolErrorCodes).toContain('STALE_PLAN');
  });

  test('has a valid request fixture for every operation', () => {
    const requests = arrayProperty(protocolFixtures, 'requests');
    expect(requests.every((request) => managerRpcRequestValidator.validate(request))).toBe(true);
    expect(requests.map((request) => objectString(request, 'operation')).sort()).toEqual([...managerProtocolOperations].sort());
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
