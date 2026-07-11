import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { getOutput, loadManifest, recordOutput } from '../src/manifest.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function useTempHome(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-manifest-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentHome;
  return currentHome;
}

describe('manifest', () => {
  test('round-trips outputs', async () => {
    const home = await useTempHome();
    const outputPath = path.join(home, 'provider-output.md');
    const output = {
      provider: 'claude',
      content: 'rules' as const,
      hash: 'abc123',
      appliedAt: '2026-07-10T00:00:00.000Z',
      backedUpTo: null,
      managedKeys: ['serverA'],
    };

    await recordOutput(outputPath, output, home);

    expect(await loadManifest(home)).toEqual({ version: 1, outputs: { [outputPath]: output } });
    expect(await getOutput(outputPath, home)).toEqual(output);
  });
});
