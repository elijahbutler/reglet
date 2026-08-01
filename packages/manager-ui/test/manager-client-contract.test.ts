import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { LocalState } from '@reglet/core';
import { createManagerRuntime } from '@reglet/manager-runtime';
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
      const runtime = createManagerRuntime({ home, watchProjects: false });
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
  });
}
