import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig, type ProviderName } from '../src/config.js';
import { applyProjectionBatch, previewProjectionBatch } from '../src/engine/batch.js';
import { getAdapter } from '../src/providers/registry.js';

let currentHome: string | undefined;
let currentProviderHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) await rm(currentHome, { recursive: true, force: true });
  if (currentProviderHome !== undefined) await rm(currentProviderHome, { recursive: true, force: true });
  currentHome = undefined;
  currentProviderHome = undefined;
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function prepare(): Promise<{ home: string; providers: ProviderName[] }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-batch-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-batch-provider-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentProviderHome;
  await mkdir(path.join(currentHome, 'rules'), { recursive: true });
  await writeFile(path.join(currentHome, 'rules', '00-general.md'), '# General\n\nBe concise.\n');
  const providers: ProviderName[] = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'];
  const config = defaultConfig();
  for (const provider of providers) {
    config.providers[provider].enabled = true;
    config.providers[provider].rules = true;
  }
  await saveConfig(config, currentHome);
  return { home: currentHome, providers };
}

describe('projection batches', () => {
  test('keeps four successful provider units applied when two units fail', async () => {
    const { home, providers } = await prepare();
    const preview = await previewProjectionBatch({ home, providers, contents: ['rules'] });

    const result = await applyProjectionBatch({
      home,
      providers,
      contents: ['rules'],
      batchDigest: preview.digest,
      unitDigests: Object.fromEntries(preview.units.map((unit) => [unit.key, unit.digest])),
      testHooks: {
        beforeUnit: (unit) => {
          if (unit.provider === 'cursor' || unit.provider === 'windsurf') {
            throw new Error(`simulated ${unit.provider} failure`);
          }
        },
      },
    });

    expect(result.summary).toEqual({ applied: 4, blocked: 0, failed: 2 });
    expect(result.units.filter((unit) => unit.status === 'applied').every((unit) => unit.receipt !== undefined)).toBe(true);
    for (const provider of providers.filter((provider) => provider !== 'cursor' && provider !== 'windsurf')) {
      const outputPath = getAdapter(provider).rulesPath();
      expect(outputPath).not.toBeNull();
      expect(await readFile(outputPath ?? '', 'utf8')).toContain('# General');
    }
  });

  test('rejects a stale batch before mutating any unit', async () => {
    const { home } = await prepare();
    const preview = await previewProjectionBatch({ home, providers: ['codex'], contents: ['rules'] });
    await writeFile(path.join(home, 'rules', '00-general.md'), '# Changed\n');

    await expect(applyProjectionBatch({
      home,
      providers: ['codex'],
      contents: ['rules'],
      batchDigest: preview.digest,
    })).rejects.toThrow('Projection batch is stale');
  });
});
