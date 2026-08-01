import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { inspectEffectiveProviderConfiguration } from '../src/providers/effective.js';

let currentHome: string | undefined;
let providerRoot: string | undefined;

afterEach(async () => {
  for (const target of [currentHome, providerRoot]) {
    if (target !== undefined) {
      await rm(target, { recursive: true, force: true });
    }
  }
  currentHome = undefined;
  providerRoot = undefined;
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

describe('effective provider configuration', () => {
  test('warns when Codex global override shadows the managed projection', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-effective-'));
    providerRoot = await mkdtemp(path.join(tmpdir(), 'reglet-effective-provider-'));
    process.env.REGLET_HOME = currentHome;
    process.env.REGLET_PROVIDER_HOME = providerRoot;
    await mkdir(path.join(providerRoot, '.codex'), { recursive: true });
    await writeFile(
      path.join(providerRoot, '.codex', 'AGENTS.override.md'),
      '# Override\n',
    );

    const configuration = await inspectEffectiveProviderConfiguration('codex');

    expect(configuration.issues[0]?.code).toBe('shadowed');
    expect(configuration.managedProjection.rulesPath).toBe(
      path.join(providerRoot, '.codex', 'AGENTS.md'),
    );
  });
});
