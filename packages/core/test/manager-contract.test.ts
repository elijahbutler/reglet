import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import {
  managerContractSchemas,
  managerErrorFromUnknown,
  managerSnapshotV2Schema,
  redactManagerValue,
  type ManagerSnapshotV2,
} from '../src/manager-contract.js';

const fixturesDir = path.join(import.meta.dir, 'fixtures', 'manager-contract');

describe('manager contract v2 schemas', () => {
  test('all checked-in fixtures validate against the JSON Schema and runtime guard', async () => {
    const files = (await readdir(fixturesDir)).filter((file) => file.endsWith('.json')).sort();
    const schema = JSON.parse(
      await readFile(path.join(import.meta.dir, '..', 'schemas', 'manager-snapshot-v2.schema.json'), 'utf8'),
    ) as Parameters<Ajv['compile']>[0];
    const validateJsonSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);
    expect(files).toEqual([
      'all-six-providers.json',
      'empty-state.json',
      'interrupted-operation-recovery.json',
      'legacy-state.json',
      'needs-attention-content.json',
      'partial-failure.json',
    ]);

    for (const file of files) {
      const fixture = JSON.parse(await readFile(path.join(fixturesDir, file), 'utf8')) as unknown;
      expect(managerSnapshotV2Schema.validate(fixture), file).toBe(true);
      expect(validateJsonSchema(fixture), `${file}: ${JSON.stringify(validateJsonSchema.errors)}`).toBe(true);
    }
  });

  test('receipt details reject malformed targets', async () => {
    const fixture = JSON.parse(
      await readFile(path.join(fixturesDir, 'legacy-state.json'), 'utf8'),
    ) as ManagerSnapshotV2;
    const malformed = structuredClone(fixture);
    const detail = malformed.receipts.details[0];
    if (detail === undefined) throw new Error('legacy fixture is missing receipt detail');
    detail.targets = [{ path: '/tmp/provider', snapshot: null } as OperationReceiptTarget];

    expect(managerSnapshotV2Schema.validate(malformed)).toBe(false);
  });

  test('component schemas cover the manager read model sections', async () => {
    const fixture = JSON.parse(
      await readFile(path.join(fixturesDir, 'all-six-providers.json'), 'utf8'),
    ) as ManagerSnapshotV2;

    expect(managerContractSchemas.providerDiscovery.validate(fixture.providerDiscovery[0])).toBe(true);
    expect(managerContractSchemas.sourceInventory.validate(fixture.sourceInventory[0])).toBe(true);
    expect(managerContractSchemas.enrollmentCell.validate(fixture.enrollmentMatrix[0]?.cells.rules)).toBe(true);
    expect(managerContractSchemas.masterSummary.validate(fixture.master)).toBe(true);
    expect(managerContractSchemas.effectiveProviderComposition.validate(fixture.effectiveProviders[0])).toBe(true);
    expect(managerContractSchemas.structuredPlanSummary.validate(fixture.structuredPlan)).toBe(true);
  });

  test('source-only providers are absent from destination composition summaries', async () => {
    const fixture = JSON.parse(
      await readFile(path.join(fixturesDir, 'all-six-providers.json'), 'utf8'),
    ) as ManagerSnapshotV2;

    expect(fixture.sourceInventory.some((source) => source.provider === 'codex')).toBe(true);
    expect(fixture.effectiveProviders.map((provider) => provider.provider)).toEqual(['claude']);
  });

  test('needs-attention and unsupported content are explicit cell states', async () => {
    const allProviders = JSON.parse(
      await readFile(path.join(fixturesDir, 'all-six-providers.json'), 'utf8'),
    ) as ManagerSnapshotV2;
    const attention = JSON.parse(
      await readFile(path.join(fixturesDir, 'needs-attention-content.json'), 'utf8'),
    ) as ManagerSnapshotV2;

    expect(allProviders.providerDiscovery.map((provider) => provider.provider).sort()).toEqual([
      'claude',
      'codex',
      'cursor',
      'gemini',
      'opencode',
      'windsurf',
    ]);
    expect(allProviders.providerDiscovery.find((provider) => provider.provider === 'windsurf')?.capabilities.skills)
      .toEqual({ state: 'unsupported', reason: 'provider has no skills directory' });
    expect(attention.providerDiscovery[0]?.capabilities.mcp).toEqual({ state: 'needs-attention', reason: 'invalid JSON' });
    expect(attention.enrollmentMatrix[0]?.cells.mcp.enrolled).toBe(false);
    expect(attention.problems).toContainEqual(expect.objectContaining({ code: 'PARTIAL_SNAPSHOT' }));
    expect(attention.problems).toContainEqual(expect.objectContaining({ code: 'INVALID_CONTENT', content: 'mcp' }));
  });

  test('partial failures and interrupted operations are typed without relying on prose', async () => {
    const partial = JSON.parse(
      await readFile(path.join(fixturesDir, 'partial-failure.json'), 'utf8'),
    ) as ManagerSnapshotV2;
    const interrupted = JSON.parse(
      await readFile(path.join(fixturesDir, 'interrupted-operation-recovery.json'), 'utf8'),
    ) as ManagerSnapshotV2;

    expect(partial.problems).toContainEqual(expect.objectContaining({ code: 'PARTIAL_SNAPSHOT' }));
    expect(partial.problems).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_SOURCE', provider: 'claude', content: 'mcp' }));
    expect(interrupted.problems[0]).toMatchObject({ code: 'INTERRUPTED_OPERATION_RECOVERED', operationId: 'operation-1' });
  });

  test('snapshot values and structured manager errors redact environment secret canaries', () => {
    const canary = 'manager-secret-canary-value';
    const env: NodeJS.ProcessEnv = { REGLET_TEST_SECRET: canary };
    const snapshotValue = redactManagerValue({ problem: `read failed: ${canary}` }, env);
    const errorValue = redactManagerValue(managerErrorFromUnknown(new Error(`stale plan: ${canary}`), 'apply-structured.apply'), env);

    expect(JSON.stringify(snapshotValue)).not.toContain(canary);
    expect(JSON.stringify(errorValue)).not.toContain(canary);
    expect(errorValue.error.code).toBe('STALE_PLAN');
  });
});

type OperationReceiptTarget = ManagerSnapshotV2['receipts']['details'][number]['targets'][number];
