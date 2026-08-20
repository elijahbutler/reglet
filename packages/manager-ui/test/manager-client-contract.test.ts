import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { LocalState } from '@reglet/core';
import { createManagerRuntime } from '@reglet/manager-runtime';
import { managerFixtureSnapshot } from '../src/testing/fixtureSnapshot.js';
import { HttpManagerClient, TauriManagerClient } from '../src/client/HttpManagerClient.js';

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

for (const [name, Client] of [
  ['browser', HttpManagerClient],
  ['tauri', TauriManagerClient],
] as const) {
  describe(`${name} ManagerClient contract`, () => {
    test('pairs, validates Snapshot V3, and carries optimistic revisions', async () => {
      home = await mkdtemp(path.join(tmpdir(), `reglet-${name}-client-`));
      const runtime = createManagerRuntime({ home, watchProjects: false, watchExternalChanges: false });
      const state = await LocalState.open(home);
      const pairing = state.createPairingCredential('admin');
      state.close();
      const fetcher: typeof globalThis.fetch = (input, init) => runtime.app.fetch(new Request(input, init));
      const client = new Client({ baseUrl: 'http://localhost', fetch: fetcher });

      const session = await client.pair(pairing.code);
      const first = await client.snapshot();
      const disabled = await client.command('remote.disable', {});
      const second = await client.snapshot();

      expect(session.scope).toBe('admin');
      expect(first.contract).toBe('manager-snapshot');
      expect(disabled.revision).toBe(first.revision + 1);
      expect(second.revision).toBe(disabled.revision);
      await runtime.dispose();
    });

    test('does not attach a stale optimistic revision to read commands', async () => {
      home = await mkdtemp(path.join(tmpdir(), `reglet-${name}-read-client-`));
      const runtime = createManagerRuntime({ home, watchProjects: false, watchExternalChanges: false });
      const state = await LocalState.open(home);
      const pairing = state.createPairingCredential('admin');
      state.close();
      const fetcher: typeof globalThis.fetch = (input, init) => runtime.app.fetch(new Request(input, init));
      const client = new Client({ baseUrl: 'http://localhost', fetch: fetcher });

      await client.pair(pairing.code);
      const snapshot = await client.snapshot();
      const externalState = await LocalState.open(home);
      const externalRevision = externalState.advanceCommandRevision(snapshot.revision);
      externalState.close();

      const syncSnapshot = await client.command('sync.snapshot', {});

      expect(syncSnapshot.revision).toBe(externalRevision);
      expect(syncSnapshot.changed).toBe(false);
      await runtime.dispose();
    });

    test('never regresses its optimistic revision after a delayed read response', async () => {
      const requests: Request[] = [];
      const snapshot = structuredClone(managerFixtureSnapshot);
      snapshot.revision = 5;
      const responses = [
        successEnvelope('snapshot', 5, snapshot),
        successEnvelope('sync.snapshot', 3, {}),
        successEnvelope('remote.disable', 6, { enabled: false }),
      ];
      const fetcher: typeof globalThis.fetch = async (input, init) => {
        requests.push(new Request(input, init));
        const response = responses.shift();
        if (response === undefined) throw new Error('Unexpected Manager request.');
        return Response.json(response);
      };
      const client = new Client({ baseUrl: 'http://localhost', fetch: fetcher });

      await client.snapshot();
      await client.command('sync.snapshot', {});
      await client.command('remote.disable', {});

      expect(requests[2]?.headers.get('X-Reglet-Revision')).toBe('5');
    });
  });
}

function successEnvelope(operation: string, revision: number, data: unknown) {
  return {
    protocolVersion: 2,
    operation,
    ok: true,
    result: { revision, changed: false, data },
  };
}
