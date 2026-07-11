import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';
import { initMasterDir, loadMasterDir } from '../src/master.js';

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
  test('loads rules, skills, and mcp servers from fixture tree', async () => {
    const home = await useTempHome();
    await mkdir(path.join(home, 'rules'), { recursive: true });
    await mkdir(path.join(home, 'skills', 'alpha', 'assets'), { recursive: true });
    await mkdir(path.join(home, 'mcp'), { recursive: true });
    await writeFile(path.join(home, 'rules', '02-second.md'), 'second');
    await writeFile(path.join(home, 'rules', '01-first.md'), 'first');
    await writeFile(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'skill');
    await writeFile(path.join(home, 'skills', 'alpha', 'assets', 'note.txt'), 'note');
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      JSON.stringify({ mcpServers: { local: { command: 'node', args: ['server.js'], env: { A: 'B' } } } }),
    );

    const master = await loadMasterDir(home);

    expect(master.rules.map((rule) => rule.relPath)).toEqual(['01-first.md', '02-second.md']);
    expect(master.rules.map((rule) => rule.content)).toEqual(['first', 'second']);
    expect(master.skills).toEqual([
      {
        name: 'alpha',
        files: [
          { relPath: 'assets/note.txt', absPath: path.join(home, 'skills', 'alpha', 'assets', 'note.txt') },
          { relPath: 'SKILL.md', absPath: path.join(home, 'skills', 'alpha', 'SKILL.md') },
        ].sort((left, right) => left.relPath.localeCompare(right.relPath)),
      },
    ]);
    expect(master.mcpServers).toEqual({ local: { command: 'node', args: ['server.js'], env: { A: 'B' } } });
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
  });
});
