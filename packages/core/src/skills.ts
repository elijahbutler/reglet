import { cp, mkdir, lstat, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, saveConfig, setSyncProviders, syncProvidersFor } from './config.js';
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
  syncProviders: ProviderId[];
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

export type SkillScope = { kind: 'shared' } | { kind: 'provider'; provider: ProviderId };

export interface SkillTreeFile {
  path: string;
  bytes: number;
}

export interface ManagedSkillDetail {
  scope: SkillScope;
  name: string;
  path: string;
  hasSkillMd: boolean;
  frontmatterIssues: string[];
  files: SkillTreeFile[];
  shadowsShared: boolean;
  shadowedBy: ProviderId[];
}

export interface SkillFileRead {
  scope: SkillScope;
  name: string;
  path: string;
  content: string;
}

export interface UnmanagedSkillDetail extends Omit<ManagedSkillDetail, 'scope'> {
  scope: { kind: 'unmanaged'; provider: ProviderId };
}

export interface UnmanagedSkillFileRead extends Omit<SkillFileRead, 'scope'> {
  scope: { kind: 'unmanaged'; provider: ProviderId };
}

export interface SkillMutationResult {
  scope: SkillScope;
  name: string;
  path: string;
}

export interface SkillFileMutationResult extends SkillMutationResult {
  filePath: string;
}

export async function listSkills(home = regletHome()): Promise<SkillsOverview> {
  const [master, unmanaged, config] = await Promise.all([loadMasterDir(home), listUnmanagedSkills(home), loadConfig(home)]);
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
      syncProviders: syncProvidersFor(config, 'skills', skill.name),
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

export async function updateSkillSyncProviders(
  name: string,
  providers: readonly ProviderId[],
  home = regletHome(),
): Promise<ProviderId[]> {
  const config = await loadConfig(home);
  setSyncProviders(config, 'skills', name, providers);
  await saveConfig(config, home);
  return syncProvidersFor(config, 'skills', name);
}

export async function listManagedSkillTrees(home = regletHome()): Promise<ManagedSkillDetail[]> {
  const master = await loadMasterDir(home);
  const sharedNames = new Set(master.skills.map((skill) => skill.name));
  const providerByName = new Map<string, ProviderId[]>();
  for (const provider of allAdapters().map((adapter) => adapter.id)) {
    for (const skill of master.providerSkills[provider]) {
      providerByName.set(skill.name, [...(providerByName.get(skill.name) ?? []), provider]);
    }
  }

  const details: ManagedSkillDetail[] = [];
  for (const skill of master.skills) {
    details.push(await describeSkill({ kind: 'shared' }, skill.name, home, false, providerByName.get(skill.name) ?? []));
  }
  for (const provider of allAdapters().map((adapter) => adapter.id)) {
    for (const skill of master.providerSkills[provider]) {
      details.push(await describeSkill({ kind: 'provider', provider }, skill.name, home, sharedNames.has(skill.name), []));
    }
  }
  return details.sort((left, right) => skillSortKey(left).localeCompare(skillSortKey(right)));
}

export async function readSkillFile(scope: SkillScope, name: string, filePath: string, home = regletHome()): Promise<SkillFileRead> {
  const skillRoot = await existingSkillRoot(scope, name, home);
  const target = await safeSkillPath(skillRoot, filePath, { mustExist: true });
  const stats = await lstat(target);
  if (!stats.isFile()) throw new Error(`Skill path is not a file: ${filePath}`);
  return { scope, name, path: normalizeRelativePath(filePath), content: await readFile(target, 'utf8') };
}

export async function createSkill(
  scope: SkillScope,
  name: string,
  skillMd: string,
  home = regletHome(),
): Promise<SkillMutationResult> {
  validateSkillNameForScope(scope, name);
  if (!hasValidSkillFrontmatter(skillMd).ok) {
    throw new Error(`Invalid SKILL.md frontmatter: ${hasValidSkillFrontmatter(skillMd).issues.join('; ')}`);
  }
  const root = skillRoot(scope, name, home);
  if (await pathExists(root)) throw new Error(`Skill already exists: ${name}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'SKILL.md'), skillMd);
  return { scope, name, path: root };
}

export async function writeSkillFile(
  scope: SkillScope,
  name: string,
  filePath: string,
  content: string,
  home = regletHome(),
): Promise<SkillFileMutationResult> {
  const root = await existingMutableSkillRoot(scope, name, home);
  const relPath = normalizeRelativePath(filePath);
  const target = await safeSkillPath(root, relPath, { mustExist: false });
  if (relPath === 'SKILL.md') {
    const validation = hasValidSkillFrontmatter(content);
    if (!validation.ok) throw new Error(`Invalid SKILL.md frontmatter: ${validation.issues.join('; ')}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return { scope, name, path: root, filePath: relPath };
}

export async function renameSkill(
  scope: SkillScope,
  name: string,
  nextName: string,
  home = regletHome(),
): Promise<SkillMutationResult> {
  const root = await existingMutableSkillRoot(scope, name, home);
  validateSkillNameForScope(scope, nextName);
  const nextRoot = skillRoot(scope, nextName, home);
  if (await pathExists(nextRoot)) throw new Error(`Skill already exists: ${nextName}`);
  await rename(root, nextRoot);
  return { scope, name: nextName, path: nextRoot };
}

export async function deleteSkill(scope: SkillScope, name: string, home = regletHome()): Promise<SkillMutationResult> {
  const root = await existingMutableSkillRoot(scope, name, home);
  await rm(root, { recursive: true, force: true });
  return { scope, name, path: root };
}

export async function deleteSkillFile(
  scope: SkillScope,
  name: string,
  filePath: string,
  home = regletHome(),
): Promise<SkillFileMutationResult> {
  const root = await existingMutableSkillRoot(scope, name, home);
  const relPath = normalizeRelativePath(filePath);
  if (relPath === 'SKILL.md') throw new Error('Cannot delete SKILL.md from a mutable skill');
  const target = await safeSkillPath(root, relPath, { mustExist: true });
  await rm(target, { recursive: true, force: false });
  return { scope, name, path: root, filePath: relPath };
}

export async function renameSkillFile(
  scope: SkillScope,
  name: string,
  filePath: string,
  nextFilePath: string,
  home = regletHome(),
): Promise<SkillFileMutationResult> {
  const root = await existingMutableSkillRoot(scope, name, home);
  const current = normalizeRelativePath(filePath);
  const next = normalizeRelativePath(nextFilePath);
  if (current === 'SKILL.md' || next === 'SKILL.md') throw new Error('SKILL.md cannot be renamed');
  const source = await safeSkillPath(root, current, { mustExist: true });
  const destination = await safeSkillPath(root, next, { mustExist: false });
  if (await pathExists(destination)) throw new Error(`Skill file already exists: ${next}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  return { scope, name, path: root, filePath: next };
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

export async function describeUnmanagedSkill(provider: ProviderId, name: string): Promise<UnmanagedSkillDetail> {
  const root = await existingUnmanagedSkillRoot(provider, name);
  const files = await collectSkillFiles(root);
  const skillMd = await readOptionalFile(path.join(root, 'SKILL.md'));
  const validation = skillMd === null ? { ok: true, issues: [] } : hasValidSkillFrontmatter(skillMd);
  return {
    scope: { kind: 'unmanaged', provider },
    name,
    path: root,
    hasSkillMd: skillMd !== null,
    frontmatterIssues: validation.issues,
    files,
    shadowsShared: false,
    shadowedBy: [],
  };
}

export async function readUnmanagedSkillFile(
  provider: ProviderId,
  name: string,
  filePath: string,
): Promise<UnmanagedSkillFileRead> {
  const root = await existingUnmanagedSkillRoot(provider, name);
  const target = await safeSkillPath(root, filePath, { mustExist: true });
  const stats = await lstat(target);
  if (!stats.isFile()) throw new Error(`Skill path is not a file: ${filePath}`);
  return {
    scope: { kind: 'unmanaged', provider },
    name,
    path: normalizeRelativePath(filePath),
    content: await readFile(target, 'utf8'),
  };
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

function validateSkillNameForScope(scope: SkillScope, name: string): void {
  if (!isSkillName(name)) throw new Error(`Invalid skill name: ${name}`);
  if (scope.kind === 'shared' && allAdapters().some((adapter) => adapter.id === name)) {
    throw new Error(`Skill name collides with provider namespace: ${name}`);
  }
}

async function describeSkill(
  scope: SkillScope,
  name: string,
  home: string,
  shadowsShared: boolean,
  shadowedBy: ProviderId[],
): Promise<ManagedSkillDetail> {
  const root = skillRoot(scope, name, home);
  const master = scope.kind === 'shared'
    ? (await loadMasterDir(home)).skills.find((skill) => skill.name === name)
    : (await loadMasterDir(home)).providerSkills[scope.provider].find((skill) => skill.name === name);
  const files = await Promise.all((master?.files ?? []).map(async (file) => ({
    path: file.relPath,
    bytes: (await stat(file.absPath)).size,
  })));
  const skillMdPath = path.join(root, 'SKILL.md');
  const skillMd = await readOptionalFile(skillMdPath);
  const validation = skillMd === null ? { ok: true, issues: [] } : hasValidSkillFrontmatter(skillMd);
  return {
    scope,
    name,
    path: root,
    hasSkillMd: skillMd !== null,
    frontmatterIssues: validation.issues,
    files,
    shadowsShared,
    shadowedBy,
  };
}

async function existingUnmanagedSkillRoot(provider: ProviderId, name: string): Promise<string> {
  if (!isSkillName(name)) throw new Error(`Invalid skill name: ${name}`);
  const skillsDir = getAdapter(provider).skillsDir();
  if (skillsDir === null) throw new Error(`${provider} does not support skills`);
  const root = path.join(skillsDir, name);
  const skillsReal = await realpath(skillsDir);
  const rootReal = await realpath(root);
  if (!isInside(rootReal, skillsReal)) throw new Error(`Skill path escapes provider skills root: ${name}`);
  return root;
}

async function collectSkillFiles(root: string): Promise<SkillTreeFile[]> {
  const files: SkillTreeFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          path: normalizeRelativePath(path.relative(root, absolutePath)),
          bytes: (await stat(absolutePath)).size,
        });
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function skillRoot(scope: SkillScope, name: string, home: string): string {
  return scope.kind === 'shared' ? path.join(home, 'skills', name) : path.join(home, 'skills', scope.provider, name);
}

async function existingSkillRoot(scope: SkillScope, name: string, home: string): Promise<string> {
  validateSkillNameForScope(scope, name);
  const root = skillRoot(scope, name, home);
  const rootReal = await realpathRoot(path.join(home, 'skills'));
  const currentReal = await realpath(root);
  if (!isInside(currentReal, rootReal)) throw new Error(`Skill path escapes master skills root: ${name}`);
  return root;
}

async function existingMutableSkillRoot(scope: SkillScope, name: string, home: string): Promise<string> {
  const root = await existingSkillRoot(scope, name, home);
  if (!(await pathExists(path.join(root, 'SKILL.md')))) {
    throw new Error('Legacy skills without SKILL.md are readable but cannot be structurally modified');
  }
  return root;
}

async function safeSkillPath(root: string, relativePath: string, options: { mustExist: boolean }): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error(`Absolute skill paths are not allowed: ${relativePath}`);
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.length === 0 || normalized === '.' || normalized.split('/').includes('..')) {
    throw new Error(`Traversal skill paths are not allowed: ${relativePath}`);
  }
  const target = path.join(root, normalized);
  await rejectSymlinkComponents(root, target);
  const rootReal = await realpath(root);
  const targetReal = options.mustExist ? await realpath(target) : await realpathParent(target);
  if (!isInside(targetReal, rootReal)) throw new Error(`Skill path escapes skill root: ${relativePath}`);
  return target;
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink skill paths are not allowed: ${relative}`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function realpathRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return realpath(root);
}

async function realpathParent(target: string): Promise<string> {
  let current = path.dirname(target);
  while (!(await pathExists(current))) current = path.dirname(current);
  return realpath(current);
}

function isInside(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function hasValidSkillFrontmatter(content: string): { ok: boolean; issues: string[] } {
  if (!content.startsWith('---\n')) return { ok: true, issues: [] };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { ok: false, issues: ['frontmatter is not closed'] };
  const issues: string[] = [];
  for (const [index, line] of content.slice(4, end).split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (!/^[A-Za-z0-9_-]+:\s*(.*)$/.test(trimmed)) {
      issues.push(`line ${index + 1} is not key: value`);
    }
  }
  return { ok: issues.length === 0, issues };
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function skillSortKey(skill: ManagedSkillDetail): string {
  return `${skill.scope.kind === 'shared' ? '0' : `1:${skill.scope.provider}`}:${skill.name}`;
}
