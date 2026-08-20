import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig, type ProviderName } from '../src/config.js';
import { applyProjectionBatch, previewProjectionBatch } from '../src/engine/batch.js';
import { detectDrift } from '../src/engine/drift.js';
import { saveManifest } from '../src/manifest.js';
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
  delete process.env.REGLET_BATCH_TOKEN;
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

  test('previews an exact unit list without expanding it into a provider-content cross product', async () => {
    const { home } = await prepare();

    const preview = await previewProjectionBatch({
      home,
      unitSelections: [
        { provider: 'claude', content: 'rules' },
        { provider: 'codex', content: 'mcp' },
      ],
    });

    expect(preview.units.map((unit) => unit.key)).toEqual(['claude:rules', 'codex:mcp']);
  });

  test('previews rules when an unrelated MCP credential is unavailable', async () => {
    const { home } = await prepare();
    const outputPath = path.join(currentProviderHome ?? '', '.claude.json');
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({
        mcpServers: {
          managed: {
            command: 'node',
          },
          github: {
            displayName: 'Github',
            server: {
              command: 'node',
              env: {
                TOKEN: { source: 'process-env', name: 'REGLET_BATCH_TOKEN', required: true },
              },
            },
          },
        },
      }, null, 2)}\n`,
    );
    await writeFile(
      outputPath,
      `${JSON.stringify({ mcpServers: { managed: { command: 'node' } } }, null, 2)}\n`,
    );
    await saveManifest({
      version: 1,
      outputs: {
        [outputPath]: {
          provider: 'claude',
          content: 'mcp',
          hash: 'previous-hash',
          appliedAt: '2026-08-20T00:00:00.000Z',
          backedUpTo: null,
          managedKeys: ['managed'],
        },
      },
    }, home);
    delete process.env.REGLET_BATCH_TOKEN;

    const rules = await previewProjectionBatch({
      home,
      unitSelections: [{ provider: 'claude', content: 'rules' }],
    });
    const mcp = await previewProjectionBatch({
      home,
      unitSelections: [{ provider: 'claude', content: 'mcp' }],
    });
    const drift = await detectDrift(home, { providers: ['claude'], contents: ['mcp'] });

    expect(rules.units).toEqual([
      expect.objectContaining({ key: 'claude:rules', status: 'ready' }),
    ]);
    expect(mcp.units).toEqual([
      expect.objectContaining({
        key: 'claude:mcp',
        status: 'blocked',
        validationIssues: [expect.stringContaining('Missing process environment for MCP server Github')],
      }),
    ]);
    expect(drift).toEqual([{
      outputPath,
      provider: 'claude',
      content: 'mcp',
      status: 'clean',
    }]);
  });
});
