import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { adoptSkill, listSkills, listUnmanagedSkills, recordOutput } from '../src/index.js';

let home: string | undefined;
let providerHome: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  if (providerHome !== undefined) await rm(providerHome, { recursive: true, force: true });
  home = undefined;
  providerHome = undefined;
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function setup(): Promise<{ home: string; providerHome: string }> {
  home = await mkdtemp(path.join(tmpdir(), 'reglet-skills-home-'));
  providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-skills-provider-'));
  process.env.REGLET_HOME = home;
  process.env.REGLET_PROVIDER_HOME = providerHome;
  await mkdir(path.join(home, 'skills'), { recursive: true });
  await writeFile(
    path.join(home, 'reglet.toml'),
    '[providers.claude]\nenabled = true\nrules = true\nskills = true\nmcp = true\n\n[providers.windsurf]\nenabled = true\nrules = true\nskills = true\nmcp = true\n',
  );
  return { home, providerHome };
}

describe('provider-local skill adoption', () => {
  test('lists unmanaged skills and excludes manifest-owned outputs', async () => {
    const paths = await setup();
    const skillsDir = path.join(paths.providerHome, '.claude', 'skills');
    await mkdir(path.join(skillsDir, 'local-skill'), { recursive: true });
    await mkdir(path.join(skillsDir, 'managed-skill'), { recursive: true });
    await writeFile(path.join(skillsDir, 'local-skill', 'SKILL.md'), 'local');
    await writeFile(path.join(skillsDir, 'managed-skill', 'SKILL.md'), 'managed');
    await recordOutput(
      path.join(skillsDir, 'managed-skill'),
      { provider: 'claude', content: 'skills', hash: 'hash', appliedAt: new Date().toISOString(), backedUpTo: null },
      paths.home,
    );

    const skills = await listUnmanagedSkills(paths.home);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      provider: 'claude',
      name: 'local-skill',
      sharedConflict: 'none',
      providerConflict: 'none',
      affectedProviders: ['claude'],
    });
  });

  test('adopts a skill into shared or provider scope without removing its source', async () => {
    const paths = await setup();
    const source = path.join(paths.providerHome, '.claude', 'skills', 'alpha');
    await mkdir(path.join(source, 'assets'), { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), 'alpha');
    await writeFile(path.join(source, 'assets', 'note.txt'), 'asset');

    const shared = await adoptSkill({ provider: 'claude', name: 'alpha', scope: 'shared', home: paths.home });
    expect(shared.destination).toBe(path.join(paths.home, 'skills', 'alpha'));
    expect(await readFile(path.join(shared.destination, 'assets', 'note.txt'), 'utf8')).toBe('asset');
    expect(await readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe('alpha');

    await expect(
      adoptSkill({ provider: 'claude', name: 'alpha', scope: 'shared', home: paths.home }),
    ).rejects.toThrow('destination already exists');
    const provider = await adoptSkill({ provider: 'claude', name: 'alpha', scope: 'provider', home: paths.home });
    expect(provider.destination).toBe(path.join(paths.home, 'skills', 'claude', 'alpha'));
  });
});

describe('skills overview', () => {
  test('lists an empty master', async () => {
    const paths = await setup();

    const overview = await listSkills(paths.home);

    expect(overview).toEqual({
      shared: [],
      providerScoped: [],
      unmanaged: [],
    });
  });

  test('lists shared skills sorted by name', async () => {
    const paths = await setup();
    await mkdir(path.join(paths.home, 'skills', 'beta', 'assets'), { recursive: true });
    await mkdir(path.join(paths.home, 'skills', 'alpha'), { recursive: true });
    await writeFile(path.join(paths.home, 'skills', 'beta', 'SKILL.md'), 'beta');
    await writeFile(path.join(paths.home, 'skills', 'beta', 'assets', 'note.txt'), 'asset');
    await writeFile(path.join(paths.home, 'skills', 'alpha', 'SKILL.md'), 'alpha');

    const overview = await listSkills(paths.home);

    expect(overview.shared).toEqual([
      {
        name: 'alpha',
        path: path.join(paths.home, 'skills', 'alpha'),
        fileCount: 1,
        shadowedBy: [],
      },
      {
        name: 'beta',
        path: path.join(paths.home, 'skills', 'beta'),
        fileCount: 2,
        shadowedBy: [],
      },
    ]);
    expect(overview.providerScoped).toEqual([]);
    expect(overview.unmanaged).toEqual([]);
  });

  test('marks provider-scoped skills that shadow shared skills', async () => {
    const paths = await setup();
    await mkdir(path.join(paths.home, 'skills', 'shared'), { recursive: true });
    await mkdir(path.join(paths.home, 'skills', 'claude', 'shared'), { recursive: true });
    await mkdir(path.join(paths.home, 'skills', 'windsurf', 'shared'), { recursive: true });
    await mkdir(path.join(paths.home, 'skills', 'claude', 'claude-only'), { recursive: true });
    await writeFile(path.join(paths.home, 'skills', 'shared', 'SKILL.md'), 'shared');
    await writeFile(path.join(paths.home, 'skills', 'claude', 'shared', 'SKILL.md'), 'claude shared');
    await writeFile(path.join(paths.home, 'skills', 'windsurf', 'shared', 'SKILL.md'), 'windsurf shared');
    await writeFile(path.join(paths.home, 'skills', 'claude', 'claude-only', 'SKILL.md'), 'claude only');

    const overview = await listSkills(paths.home);

    expect(overview.shared).toEqual([
      {
        name: 'shared',
        path: path.join(paths.home, 'skills', 'shared'),
        fileCount: 1,
        shadowedBy: ['claude', 'windsurf'],
      },
    ]);
    expect(overview.providerScoped).toEqual([
      {
        provider: 'claude',
        name: 'claude-only',
        path: path.join(paths.home, 'skills', 'claude', 'claude-only'),
        fileCount: 1,
        shadowsShared: false,
      },
      {
        provider: 'claude',
        name: 'shared',
        path: path.join(paths.home, 'skills', 'claude', 'shared'),
        fileCount: 1,
        shadowsShared: true,
      },
      {
        provider: 'windsurf',
        name: 'shared',
        path: path.join(paths.home, 'skills', 'windsurf', 'shared'),
        fileCount: 1,
        shadowsShared: true,
      },
    ]);
    expect(overview.unmanaged).toEqual([]);
  });

  test('lists unmanaged skills alongside managed skills', async () => {
    const paths = await setup();
    const source = path.join(paths.providerHome, '.claude', 'skills', 'local-alpha');
    await mkdir(path.join(paths.home, 'skills', 'managed-shared'), { recursive: true });
    await mkdir(path.join(paths.home, 'skills', 'claude', 'managed-scoped'), { recursive: true });
    await mkdir(source, { recursive: true });
    await writeFile(path.join(paths.home, 'skills', 'managed-shared', 'SKILL.md'), 'shared');
    await writeFile(path.join(paths.home, 'skills', 'claude', 'managed-scoped', 'SKILL.md'), 'scoped');
    await writeFile(path.join(source, 'SKILL.md'), 'local');

    const overview = await listSkills(paths.home);

    expect(overview.shared).toEqual([
      {
        name: 'managed-shared',
        path: path.join(paths.home, 'skills', 'managed-shared'),
        fileCount: 1,
        shadowedBy: [],
      },
    ]);
    expect(overview.providerScoped).toEqual([
      {
        provider: 'claude',
        name: 'managed-scoped',
        path: path.join(paths.home, 'skills', 'claude', 'managed-scoped'),
        fileCount: 1,
        shadowsShared: false,
      },
    ]);
    expect(overview.unmanaged).toHaveLength(1);
    expect(overview.unmanaged[0]).toMatchObject({
      provider: 'claude',
      name: 'local-alpha',
      sourcePath: source,
      sharedConflict: 'none',
      providerConflict: 'none',
    });
  });
});
