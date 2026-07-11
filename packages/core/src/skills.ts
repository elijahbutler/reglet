import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { loadManifest } from './manifest.js';
import { loadMasterDir } from './master.js';
import { regletHome } from './paths.js';
import { allAdapters, getAdapter } from './providers/registry.js';
import type { ProviderId } from './providers/types.js';

export type SkillAdoptionScope = 'shared' | 'provider';
export type SkillConflict = 'none' | 'destination-exists';

export interface UnmanagedSkill {
  provider: ProviderId;
  name: string;
  sourcePath: string;
  sharedDestination: string;
  providerDestination: string;
  sharedConflict: SkillConflict;
  providerConflict: SkillConflict;
  affectedProviders: ProviderId[];
}

export interface AdoptSkillOptions {
  provider: ProviderId;
  name: string;
  scope: SkillAdoptionScope;
  overwrite?: boolean;
  home?: string;
}

export interface AdoptedSkill {
  provider: ProviderId;
  name: string;
  scope: SkillAdoptionScope;
  sourcePath: string;
  destination: string;
  overwritten: boolean;
  affectedProviders: ProviderId[];
}

export interface SharedSkillSummary {
  name: string;
  path: string;
  fileCount: number;
  shadowedBy: ProviderId[];
}

export interface ProviderScopedSkillSummary {
  provider: ProviderId;
  name: string;
  path: string;
  fileCount: number;
  shadowsShared: boolean;
}

export interface SkillsOverview {
  shared: SharedSkillSummary[];
  providerScoped: ProviderScopedSkillSummary[];
  unmanaged: UnmanagedSkill[];
}

export async function listSkills(home = regletHome()): Promise<SkillsOverview> {
  const [master, unmanaged] = await Promise.all([loadMasterDir(home), listUnmanagedSkills(home)]);
  const sharedNames = new Set(master.skills.map((skill) => skill.name));
  const shadowedBy = new Map<string, ProviderId[]>();
  const providerScoped: ProviderScopedSkillSummary[] = [];

  for (const adapter of allAdapters()) {
    const providerSkills = master.providerSkills[adapter.id];
    for (const skill of providerSkills) {
      providerScoped.push({
        provider: adapter.id,
        name: skill.name,
        path: path.join(home, 'skills', adapter.id, skill.name),
        fileCount: skill.files.length,
        shadowsShared: sharedNames.has(skill.name),
      });
      if (sharedNames.has(skill.name)) {
        shadowedBy.set(skill.name, [...(shadowedBy.get(skill.name) ?? []), adapter.id]);
      }
    }
  }

  const shared = master.skills
    .map((skill) => ({
      name: skill.name,
      path: path.join(home, 'skills', skill.name),
      fileCount: skill.files.length,
      shadowedBy: shadowedBy.get(skill.name) ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    shared,
    providerScoped: providerScoped.sort((left, right) =>
      left.provider === right.provider ? left.name.localeCompare(right.name) : left.provider.localeCompare(right.provider),
    ),
    unmanaged,
  };
}

export async function listUnmanagedSkills(home = regletHome()): Promise<UnmanagedSkill[]> {
  const [config, manifest] = await Promise.all([loadConfig(home), loadManifest(home)]);
  const enabledSkillProviders = allAdapters()
    .filter(
      (adapter) =>
        adapter.skillsDir() !== null && config.providers[adapter.id].enabled && config.providers[adapter.id].skills,
    )
    .map((adapter) => adapter.id);
  const skills: UnmanagedSkill[] = [];

  for (const adapter of allAdapters()) {
    const skillsDir = adapter.skillsDir();
    if (skillsDir === null) continue;

    const inventory = await adapter.inventory();
    for (const name of inventory.skills) {
      const sourcePath = path.join(skillsDir, name);
      const output = manifest.outputs[sourcePath];
      if (output?.provider === adapter.id && output.content === 'skills') continue;

      const sharedDestination = path.join(home, 'skills', name);
      const providerDestination = path.join(home, 'skills', adapter.id, name);
      skills.push({
        provider: adapter.id,
        name,
        sourcePath,
        sharedDestination,
        providerDestination,
        sharedConflict: (await pathExists(sharedDestination)) ? 'destination-exists' : 'none',
        providerConflict: (await pathExists(providerDestination)) ? 'destination-exists' : 'none',
        affectedProviders: enabledSkillProviders,
      });
    }
  }

  return skills.sort((left, right) =>
    left.provider === right.provider ? left.name.localeCompare(right.name) : left.provider.localeCompare(right.provider),
  );
}

export async function adoptSkill(options: AdoptSkillOptions): Promise<AdoptedSkill> {
  const home = options.home ?? regletHome();
  const adapter = getAdapter(options.provider);
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) throw new Error(`${options.provider} does not support skills`);
  if (!isSkillName(options.name)) throw new Error(`Invalid skill name: ${options.name}`);

  const sourcePath = path.join(skillsDir, options.name);
  if (!(await pathExists(sourcePath))) throw new Error(`Provider skill does not exist: ${sourcePath}`);

  const destination =
    options.scope === 'shared'
      ? path.join(home, 'skills', options.name)
      : path.join(home, 'skills', options.provider, options.name);
  const overwritten = await pathExists(destination);
  if (overwritten && options.overwrite !== true) {
    throw new Error(`Adoption destination already exists: ${destination}. Pass --overwrite to replace it.`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourcePath, destination, { recursive: true, force: options.overwrite === true });

  const config = await loadConfig(home);
  const affectedProviders =
    options.scope === 'provider'
      ? [options.provider]
      : allAdapters()
          .filter(
            (candidate) =>
              candidate.skillsDir() !== null &&
              config.providers[candidate.id].enabled &&
              config.providers[candidate.id].skills,
          )
          .map((candidate) => candidate.id);

  return {
    provider: options.provider,
    name: options.name,
    scope: options.scope,
    sourcePath,
    destination,
    overwritten,
    affectedProviders,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isSkillName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}
