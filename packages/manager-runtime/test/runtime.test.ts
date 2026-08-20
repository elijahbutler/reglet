import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  beginOperation,
  listOperationReceipts,
  LocalState,
  saveLibraryManifest,
} from '@reglet/core';
import {
  isManagerSnapshotV3,
  managerRpcResponseValidator,
  type ManagerRpcResponse,
} from '@reglet/manager-protocol';
import {
  createManagerRuntime,
  serveManagerRuntime,
  validateManagerRuntimeBinding,
} from '../src/index.js';

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

async function runtimeFixture(scope: 'read' | 'write' | 'admin' = 'admin') {
  home = await mkdtemp(path.join(tmpdir(), 'reglet-runtime-'));
  await mkdir(home, { recursive: true });
  const runtime = createManagerRuntime({ home, watchProjects: false, watchExternalChanges: false });
  const state = await LocalState.open(home);
  const pairing = state.createPairingCredential(scope);
  state.close();
  const claimed = await runtime.app.request('/v2/pair/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pairing.code }),
  });
  const payload = await claimed.json() as { token: string };
  return { runtime, token: payload.token, code: pairing.code };
}

function commandRequest(token: string, body: unknown): Request {
  return new Request('http://localhost/v2/commands', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('manager runtime', () => {
  test('uses one-use pairing and returns validated protocol responses', async () => {
    const { runtime, token, code } = await runtimeFixture();
    const secondClaim = await runtime.app.request('/v2/pair/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(secondClaim.status).toBe(401);

    const response = await runtime.app.fetch(commandRequest(token, {
      protocolVersion: 2,
      operation: 'snapshot',
      input: { contractVersion: 3 },
    }));
    const envelope = await response.json() as ManagerRpcResponse;
    expect(response.status).toBe(200);
    expect(managerRpcResponseValidator.validate(envelope)).toBe(true);
    expect(envelope.ok).toBe(true);
    if (envelope.ok && typeof envelope.result === 'object' && envelope.result !== null && !Array.isArray(envelope.result)) {
      expect(isManagerSnapshotV3(envelope.result.data)).toBe(true);
    }
    await runtime.dispose();
  });

  test('rejects unknown fields before dispatch', async () => {
    const { runtime, token } = await runtimeFixture();
    const response = await runtime.app.fetch(commandRequest(token, {
      protocolVersion: 2,
      operation: 'snapshot',
      input: {},
      unexpected: true,
    }));
    const envelope = await response.json() as ManagerRpcResponse;

    expect(response.status).toBe(400);
    expect(managerRpcResponseValidator.validate(envelope)).toBe(true);
    expect(envelope.ok).toBe(false);
    await runtime.dispose();
  });

  test('records the redacted underlying command error in local diagnostics', async () => {
    const { runtime, token } = await runtimeFixture();
    const response = await runtime.app.fetch(commandRequest(token, {
      protocolVersion: 2,
      operation: 'provider.preview',
      input: {
        artifact: 'token=diagnostic-secret',
        provider: 'codex',
      },
    }));

    expect(response.status).toBe(500);
    const logPath = path.join(home ?? '', '.state', 'logs', 'runtime.log');
    let log = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await Bun.file(logPath).exists()) {
        log = await readFile(logPath, 'utf8');
        if (log.includes('Unknown artifact')) break;
      }
      await Bun.sleep(10);
    }

    const entry = JSON.parse(log.trim().split('\n').at(-1) ?? '{}') as {
      errorName?: string;
      errorMessage?: string;
    };
    expect(entry).toMatchObject({
      errorName: 'Error',
      errorMessage: 'Unknown artifact: [REDACTED]',
    });
    await runtime.dispose();
  });

  test('enforces the same session scope over HTTP commands and event tickets', async () => {
    const { runtime, token } = await runtimeFixture('read');
    const mutation = await runtime.app.fetch(commandRequest(token, {
      protocolVersion: 2,
      operation: 'library.archive',
      input: { artifact: 'missing' },
    }));
    const mutationEnvelope = await mutation.json() as ManagerRpcResponse;
    const ticket = await runtime.app.request('/v2/events/ticket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(mutation.status).toBe(403);
    expect(mutationEnvelope.operation).toBe('library.archive');
    expect(mutationEnvelope.ok).toBe(false);
    expect(ticket.status).toBe(201);
    await runtime.dispose();
  });

  test('keeps readiness independent from optional keychain availability', async () => {
    const { runtime } = await runtimeFixture();
    const response = await runtime.app.request('/readyz');
    const readiness = await response.json() as { ready: boolean; database: boolean };

    expect(response.status).toBe(200);
    expect(readiness).toMatchObject({ ready: true, database: true });
    await runtime.dispose();
  });

  test('refuses remote and wildcard bindings unless each security boundary is explicit', () => {
    expect(() => validateManagerRuntimeBinding('192.168.1.25', {})).toThrow('disabled');
    expect(() => validateManagerRuntimeBinding('192.168.1.25', { allowRemote: true })).toThrow('HTTPS');
    expect(() => validateManagerRuntimeBinding('192.168.1.25', { allowRemote: true, allowInsecureLanHttp: true })).not.toThrow();
    expect(() => validateManagerRuntimeBinding('0.0.0.0', { allowRemote: true, allowInsecureLanHttp: true })).toThrow('wildcard');
    expect(() => validateManagerRuntimeBinding('0.0.0.0', {
      allowRemote: true,
      allowInsecureLanHttp: true,
      allowPublicWildcard: true,
    })).not.toThrow();
  });

  test('reports ready in under two seconds with 500 canonical artifacts', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-runtime-scale-'));
    const artifacts = Array.from({ length: 500 }, (_, index) => ({
      id: `artifact-${index}`,
      kind: 'instruction' as const,
      lifecycle: 'active' as const,
      scope: { kind: 'global' as const },
      slug: `instruction-${index}`,
      title: `Instruction ${index}`,
      tags: [],
      targets: [],
      locator: { type: 'file' as const, path: `rules/instruction-${index}.md` },
    }));
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await Promise.all(artifacts.map((artifact) => writeFile(path.join(home ?? '', artifact.locator.path), `# ${artifact.title}\n`)));
    await saveLibraryManifest({ schemaVersion: 2, artifacts, tombstones: [] }, home);
    const startedAt = performance.now();
    const runtime = createManagerRuntime({ home, watchProjects: false, watchExternalChanges: false });
    const response = await runtime.app.request('/readyz');
    const elapsedMs = performance.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(2_000);
    await runtime.dispose();
  });

  test('recovers an unfinished filesystem operation before accepting requests', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'reglet-runtime-recovery-'));
    const target = path.join(home, 'provider-target.md');
    await writeFile(target, 'before\n');
    const operation = await beginOperation({ home });
    await operation.snapshotTarget(target);
    await writeFile(target, 'interrupted\n');

    const runtime = await serveManagerRuntime({
      home,
      port: 0,
      watchProjects: false,
      watchExternalChanges: false,
    });

    expect(await readFile(target, 'utf8')).toBe('before\n');
    expect(await listOperationReceipts(home)).toContainEqual(expect.objectContaining({
      id: operation.id,
      lifecycle: 'rolled-back',
      recovery: expect.objectContaining({ recovered: true }),
    }));
    await runtime.stop();
  });
});
