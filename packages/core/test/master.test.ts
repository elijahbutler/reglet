import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';
import { initMasterDir, loadMasterDir, PROVIDER_RULES_MARKER } from '../src/master.js';
import { clearLegacySyncState, inspectLegacySyncState, publicReleaseCapabilities } from '../src/release.js';

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
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-master-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentHome;
  return currentHome;
}

describe('master dir', () => {
  test('exposes an immutable local-only public release capability gate', () => {
    expect(publicReleaseCapabilities).toEqual({
      mode: 'public-v1',
      localOnly: true,
      sync: false,
      disabledCommands: ['login', 'register', 'pair', 'sync'],
    });
    expect(Object.isFrozen(publicReleaseCapabilities)).toBe(true);
    expect(Object.isFrozen(publicReleaseCapabilities.disabledCommands)).toBe(true);
  });

  test('loads rules, skills, and mcp servers from fixture tree', async () => {
    const home = await useTempHome();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'alpha', 'assets'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(path.join(home, 'rules', '02-second.md'), 'second');
    await writeFile(path.join(home, 'rules', '01-first.md'), 'first');
    await mkdir(path.join(home, 'rules', 'codex'), { recursive: true });
    await writeFile(path.join(home, 'rules', 'codex', PROVIDER_RULES_MARKER), 'v1\n');
    await writeFile(path.join(home, 'rules', 'codex', '10-codex.md'), 'codex only');
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'skill');
    await writeFile(path.join(home, 'skills', 'alpha', 'assets', 'note.txt'), 'note');
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      JSON.stringify({ mcpServers: { local: { command: 'node', args: ['server.js'], env: { A: { source: 'process-env', name: 'LOCAL_A' } } } } }),
    );

    const master = await loadMasterDir(home);

    expect(master.rules.map((rule) => rule.relPath)).toEqual(['01-first.md', '02-second.md']);
    expect(master.rules.map((rule) => rule.content)).toEqual(['first', 'second']);
    expect(master.providerRules.codex).toEqual([
      { relPath: 'codex/10-codex.md', content: 'codex only' },
    ]);
    expect(master.providerRules.claude).toEqual([]);
    expect(master.skills).toEqual([
      {
        name: 'alpha',
        files: [
          { relPath: 'assets/note.txt', absPath: path.join(home, 'skills', 'alpha', 'assets', 'note.txt') },
          { relPath: 'SKILL.md', absPath: path.join(home, 'skills', 'alpha', 'SKILL.md') },
        ].sort((left, right) => left.relPath.localeCompare(right.relPath)),
      },
    ]);
    expect(master.providerSkills.claude).toEqual([]);
    expect(master.providerSkills.codex).toEqual([]);
    expect(master.mcpServers).toEqual({ local: { command: 'node', args: ['server.js'], env: { A: { source: 'process-env', name: 'LOCAL_A' } } } });
  });

  test('loads provider-specific skills separately from shared skills', async () => {
    const home = await useTempHome();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'shared'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'codex', 'codex-only', 'assets'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'claude', 'claude-only'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'shared', 'SKILL.md'), 'shared');
    await writeFile(path.join(home, 'skills', 'codex', 'codex-only', 'SKILL.md'), 'codex');
    await writeFile(path.join(home, 'skills', 'codex', 'codex-only', 'assets', 'note.txt'), 'note');
    await writeFile(path.join(home, 'skills', 'claude', 'claude-only', 'SKILL.md'), 'claude');

    const master = await loadMasterDir(home);

    expect(master.skills.map((skill) => skill.name)).toEqual(['shared']);
    expect(master.providerSkills.codex).toEqual([
      {
        name: 'codex-only',
        files: [
          {
            relPath: 'assets/note.txt',
            absPath: path.join(home, 'skills', 'codex', 'codex-only', 'assets', 'note.txt'),
          },
          { relPath: 'SKILL.md', absPath: path.join(home, 'skills', 'codex', 'codex-only', 'SKILL.md') },
        ].sort((left, right) => left.relPath.localeCompare(right.relPath)),
      },
    ]);
    expect(master.providerSkills.claude.map((skill) => skill.name)).toEqual(['claude-only']);
    expect(master.providerSkills.gemini).toEqual([]);
  });

  test('keeps unmarked provider-named rule directories shared for compatibility', async () => {
    const home = await useTempHome();
    await mkdir(path.join(home, 'rules', 'codex'), { recursive: true });
    await writeFile(path.join(home, 'rules', 'codex', 'legacy-shared.md'), 'still shared');

    const master = await loadMasterDir(home);

    expect(master.rules).toEqual([{ relPath: 'codex/legacy-shared.md', content: 'still shared' }]);
    expect(master.providerRules.codex).toEqual([]);
  });

  test('initMasterDir creates skeleton and is idempotent', async () => {
    const home = await useTempHome();

    await initMasterDir(home);
    await writeFile(path.join(home, 'rules', '00-general.md'), 'custom');
    await writeFile(path.join(home, 'reglet.toml'), `[providers.claude]\nenabled = true\nrules = true\nskills = true\nmcp = true\n`);
    await initMasterDir(home);

    expect(await readFile(path.join(home, 'rules', '00-general.md'), 'utf8')).toBe('custom');
    expect(await readFile(path.join(home, 'mcp', 'servers.json'), 'utf8')).toBe('{\n  "mcpServers": {}\n}\n');
    expect((await loadConfig(home)).providers.claude.enabled).toBe(true);
    expect(await readFile(path.join(home, 'reglet.toml'), 'utf8')).not.toContain('[sync]');
    expect(await Bun.file(path.join(home, '.state', 'sync-base')).exists()).toBe(false);
  });

  test('legacy sync state remains inert until explicitly cleared', async () => {
    const home = await useTempHome();
    await initMasterDir(home);
    await mkdir(path.join(home, '.state', 'sync-base'), { recursive: true });
    await writeFile(path.join(home, '.state', 'sync.json'), '{"deviceToken":"legacy-secret"}\n');

    const status = await inspectLegacySyncState(home);
    expect(status.present).toBe(true);
    expect(status.paths).toHaveLength(2);
    expect(await readFile(path.join(home, '.state', 'sync.json'), 'utf8')).toContain('legacy-secret');

    expect(await clearLegacySyncState(home)).toEqual({ present: false, paths: [] });
    expect(await Bun.file(path.join(home, '.state', 'sync.json')).exists()).toBe(false);
    expect(await Bun.file(path.join(home, '.state', 'sync-base')).exists()).toBe(false);
  });
});
