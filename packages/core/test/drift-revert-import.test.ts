import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig, type ProviderName } from '../src/config.js';
import { applyAll } from '../src/engine/apply.js';
import { appendDriftEvent, clearDriftEvents, detectDrift, listDriftEvents } from '../src/engine/drift.js';
import { importDriftedMcp, importDriftedRules, importDriftedSkills, stripGeneratedHeader } from '../src/engine/import.js';
import { revert, restore } from '../src/engine/revert.js';
import { GENERATED_HEADER, LEGACY_GENERATED_HEADER } from '../src/header.js';
import { loadManifest } from '../src/manifest.js';

let currentHome: string | undefined;
let currentProviderHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  if (currentProviderHome !== undefined) {
    await rm(currentProviderHome, { recursive: true, force: true });
    currentProviderHome = undefined;
  }
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function useTempHomes(): Promise<{ home: string; providerHome: string }> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-drift-home-'));
  currentProviderHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-drift-provider-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentProviderHome;
  return { home: currentHome, providerHome: currentProviderHome };
}

async function enableProviders(home: string, providers: ProviderName[]): Promise<void> {
  const config = defaultConfig();
  for (const provider of providers) {
    config.providers[provider].enabled = true;
  }
  await saveConfig(config, home);
}

async function writeMasterRule(home: string): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await writeFile(path.join(home, 'rules', '00-general.md'), '# General\n\nBe concise.\n');
}

describe('drift, import, and revert', () => {
  test('strips current and legacy generated headers', () => {
    const body = '# Keep this rule\n';
    expect(stripGeneratedHeader(`${GENERATED_HEADER.replace('<provider>', 'claude')}\n\n${body}`, 'claude')).toBe(body);
    expect(stripGeneratedHeader(`${LEGACY_GENERATED_HEADER.replace('<provider>', 'claude')}\n\n${body}`, 'claude')).toBe(body);
  });

  test('detectDrift reports clean, modified, and missing managed outputs', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);

    await applyAll({ providers: ['claude'], contents: ['rules'] });
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    expect(await detectDrift(home)).toEqual([{ outputPath, provider: 'claude', content: 'rules', status: 'clean' }]);

    await writeFile(outputPath, `${await readFile(outputPath, 'utf8')}\nHand edit.\n`);
    expect(await detectDrift(home)).toEqual([{ outputPath, provider: 'claude', content: 'rules', status: 'modified' }]);

    await rm(outputPath);
    expect(await detectDrift(home)).toEqual([{ outputPath, provider: 'claude', content: 'rules', status: 'missing' }]);
  });

  test('detectDrift ignores unmanaged mcp edits and reports managed mcp edits', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node', args: ['server.js'] } } }, null, 2)}\n`,
    );
    await enableProviders(home, ['claude']);
    await applyAll({ providers: ['claude'], contents: ['mcp'] });

    const outputPath = path.join(providerHome, '.claude.json');
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          mcpServers: {
            managed: { command: 'node', args: ['server.js'] },
            user: { command: 'python' },
          },
        },
        null,
        2,
      )}\n`,
    );
    expect(await detectDrift(home)).toEqual([{ outputPath, provider: 'claude', content: 'mcp', status: 'clean' }]);

    await writeFile(
      outputPath,
      `${JSON.stringify({ mcpServers: { managed: { command: 'ruby' }, user: { command: 'python' } } }, null, 2)}\n`,
    );
    expect(await detectDrift(home)).toEqual([{ outputPath, provider: 'claude', content: 'mcp', status: 'modified' }]);
  });

  test('importDriftedRules writes stripped provider rules into the master rules dir', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude']);
    await applyAll({ providers: ['claude'], contents: ['rules'] });

    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await writeFile(outputPath, `${GENERATED_HEADER.replace('<provider>', 'claude')}\n\nImported body.\n`);

    const result = await importDriftedRules('claude', home, new Date('2026-07-10T12:00:00.000Z'));

    expect(result.importedPath).toBe(path.join(home, 'rules', 'imported-claude-2026-07-10.md'));
    expect(await readFile(result.importedPath, 'utf8')).toBe('Imported body.\n');
  });

  test('importDriftedSkills copies modified managed skills back to their master source', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'shared-skill'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'shared-skill', 'SKILL.md'), 'original shared\n');
    await mkdir(path.join(home, 'skills', 'claude', 'scoped-skill'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'claude', 'scoped-skill', 'SKILL.md'), 'original scoped\n');
    await enableProviders(home, ['claude']);
    await applyAll({ providers: ['claude'], contents: ['skills'] });

    const sharedOutput = path.join(providerHome, '.claude', 'skills', 'shared-skill', 'SKILL.md');
    const scopedOutput = path.join(providerHome, '.claude', 'skills', 'scoped-skill', 'SKILL.md');
    await writeFile(sharedOutput, 'edited shared\n');
    await writeFile(scopedOutput, 'edited scoped\n');

    const result = await importDriftedSkills('claude', home);

    expect(result.imported.map((skill) => skill.name).sort()).toEqual(['scoped-skill', 'shared-skill']);
    expect(await readFile(path.join(home, 'skills', 'shared-skill', 'SKILL.md'), 'utf8')).toBe('edited shared\n');
    expect(await readFile(path.join(home, 'skills', 'claude', 'scoped-skill', 'SKILL.md'), 'utf8')).toBe('edited scoped\n');

    // A second import finds nothing new only after re-apply refreshes hashes.
    await applyAll({ providers: ['claude'], contents: ['skills'], reviewedReplacement: true });
    expect((await importDriftedSkills('claude', home)).imported).toEqual([]);
  });

  test('importDriftedMcp writes managed provider server values back into the master file', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node', args: ['server.js'] } } }, null, 2)}\n`,
    );
    await enableProviders(home, ['claude']);
    await applyAll({ providers: ['claude'], contents: ['mcp'] });

    const outputPath = path.join(providerHome, '.claude.json');
    await writeFile(
      outputPath,
      `${JSON.stringify({ mcpServers: { managed: { command: 'ruby' }, user: { command: 'python' } } }, null, 2)}\n`,
    );

    const result = await importDriftedMcp('claude', home);

    expect(result.importedServers).toEqual(['managed']);
    const master = JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(master.mcpServers.managed).toEqual({ command: 'ruby' });
    expect(master.mcpServers.user).toBeUndefined();
  });

  test('importDriftedMcp rejects raw provider env values without persisting them', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await enableProviders(home, ['claude']);
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node' } } }, null, 2)}\n`,
    );
    await applyAll({ providers: ['claude'], contents: ['mcp'] });
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node', env: { TOKEN: 'secret' } } } }, null, 2)}\n`,
    );

    await expect(importDriftedMcp('claude', home)).rejects.toThrow('raw env values');
    const master = JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(master.mcpServers.managed).toEqual({ command: 'node' });
  });

  test('importDriftedMcp imports removal of a managed server', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await enableProviders(home, ['claude']);
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { managed: { command: 'node' } } }, null, 2)}\n`,
    );
    await applyAll({ providers: ['claude'], contents: ['mcp'] }, home);
    await writeFile(path.join(providerHome, '.claude.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);

    const result = await importDriftedMcp('claude', home);
    const master = JSON.parse(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };

    expect(result.importedServers).toEqual([]);
    expect(master.mcpServers.managed).toBeUndefined();
  });

  test('imports a renamed managed server into provider scope without rewriting shared definitions', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await enableProviders(home, ['claude']);
    const sharedPath = path.join(home, 'mcp', 'servers.json');
    const shared = `${JSON.stringify({
      mcpServers: { stable: { displayName: 'provider-output', server: { command: 'node' } } },
    }, null, 2)}\n`;
    await writeFile(sharedPath, shared);
    await applyAll({ providers: ['claude'], contents: ['mcp'] });
    await writeFile(
      path.join(providerHome, '.claude.json'),
      `${JSON.stringify({ mcpServers: { 'provider-output': { command: 'ruby' } } }, null, 2)}\n`,
    );

    const result = await importDriftedMcp('claude', home, 'provider');

    expect(result).toMatchObject({ scope: 'provider', importedServers: ['provider-output'] });
    expect(result.importedPath).toBe(path.join(home, 'mcp', 'providers', 'claude', 'servers.json'));
    expect(await readFile(sharedPath, 'utf8')).toBe(shared);
    const scoped = JSON.parse(await readFile(result.importedPath, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(scoped.mcpServers).toEqual({
      stable: { displayName: 'provider-output', server: { command: 'ruby' } },
    });
  });

  test('rejects provider-scope removal of a shared server without changing either scope', async () => {
    const { home, providerHome } = await useTempHomes();
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await enableProviders(home, ['claude']);
    const sharedPath = path.join(home, 'mcp', 'servers.json');
    const shared = '{"mcpServers":{"managed":{"command":"node"}}}\n';
    await writeFile(sharedPath, shared);
    await applyAll({ providers: ['claude'], contents: ['mcp'] });
    await writeFile(path.join(providerHome, '.claude.json'), '{"mcpServers":{}}\n');

    await expect(importDriftedMcp('claude', home, 'provider'))
      .rejects.toThrow('Cannot import removal of shared MCP server managed into provider scope');
    expect(await readFile(sharedPath, 'utf8')).toBe(shared);
    expect(await Bun.file(path.join(home, 'mcp', 'providers', 'claude', 'servers.json')).exists()).toBe(false);
  });

  test('revert restores backed-up originals byte-identically and removes created outputs', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude', 'gemini']);
    const claudePath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(claudePath), { recursive: true });
    await writeFile(claudePath, 'original claude\n');

    await applyAll({ providers: ['claude', 'gemini'], contents: ['rules'] });
    const geminiPath = path.join(providerHome, '.gemini', 'GEMINI.md');

    const results = await revert(undefined, home);

    expect(results).toContainEqual({ outputPath: claudePath, provider: 'claude', action: 'restored' });
    expect(results).toContainEqual({ outputPath: geminiPath, provider: 'gemini', action: 'removed' });
    expect(await readFile(claudePath, 'utf8')).toBe('original claude\n');
    await expect(readFile(geminiPath, 'utf8')).rejects.toThrow();
    expect(await loadManifest(home)).toEqual({ version: 1, outputs: {} });
  });

  test('restore can target one provider and leaves other manifest entries intact', async () => {
    const { home, providerHome } = await useTempHomes();
    await writeMasterRule(home);
    await enableProviders(home, ['claude', 'gemini']);
    await applyAll({ providers: ['claude', 'gemini'], contents: ['rules'] });

    await restore('claude', home);

    const manifest = await loadManifest(home);
    expect(manifest.outputs[path.join(providerHome, '.claude', 'CLAUDE.md')]).toBeUndefined();
    expect(manifest.outputs[path.join(providerHome, '.gemini', 'GEMINI.md')]).toBeDefined();
  });

  test('drift queue helpers append, list, and clear events', async () => {
    const { home } = await useTempHomes();
    const record = { outputPath: '/tmp/generated', provider: 'claude', content: 'rules' as const, status: 'modified' as const };

    await appendDriftEvent(record, home);
    expect((await listDriftEvents(home)).events).toHaveLength(1);

    await clearDriftEvents(home);
    expect(await listDriftEvents(home)).toEqual({ version: 1, events: [] });
  });
});
