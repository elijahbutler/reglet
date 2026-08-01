import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configPath, defaultConfig, providerNames, serializeConfig, type ProviderName } from './config.js';
import { ensurePrivateDir } from './fsutil.js';
import { hasLibraryManifest, loadLibraryManifest } from './artifacts/library.js';
import { loadMcpDefinitions, serializeMcpServers, type McpServerDefinition } from './mcp.js';
import { regletHome } from './paths.js';
import type { SecretRef } from './security/secrets.js';

export interface McpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, McpEnvironmentValue>;
  url?: string;
}

export interface McpProcessEnvReference {
  source: 'process-env';
  name: string;
  required?: boolean;
}

export interface McpKeychainReference {
  source: 'keychain';
  id: string;
  required?: boolean;
}

export type McpEnvironmentValue = SecretRef;

export const PROVIDER_RULES_MARKER = '.reglet-provider-overlay';

export interface ResolvedMcpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MasterRule {
  relPath: string;
  content: string;
  targets?: ProviderName[];
}

export interface MasterSkillFile {
  relPath: string;
  absPath: string;
}

export interface MasterSkill {
  name: string;
  files: MasterSkillFile[];
  targets?: ProviderName[];
}

export interface MasterDir {
  rules: MasterRule[];
  providerRules: Record<ProviderName, MasterRule[]>;
  skills: MasterSkill[];
  providerSkills: Record<ProviderName, MasterSkill[]>;
  mcpServers: Record<string, McpServerDef>;
  mcpDefinitions: Record<string, McpServerDefinition>;
  providerMcpDefinitions: Record<ProviderName, Record<string, McpServerDefinition>>;
}

export async function initMasterDir(home = regletHome()): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await mkdir(path.join(home, 'skills'), { recursive: true });
  await mkdir(path.join(home, 'mcp'), { recursive: true });
  await ensurePrivateDir(path.join(home, '.state'));
  await ensurePrivateDir(path.join(home, '.state', 'backups'));

  await writeFileIfMissing(path.join(home, 'mcp', 'servers.json'), serializeMcpServers({}));
  await writeFileIfMissing(
    path.join(home, 'rules', '00-general.md'),
    '# Reglet general rules\n\n<!-- Add shared instructions here. -->\n',
  );

  await writeFileIfMissing(configPath(home), serializeConfig(defaultConfig()));
}

export async function loadMasterDir(home = regletHome()): Promise<MasterDir> {
  const loadedRules = await loadRules(path.join(home, 'rules'));
  const loadedSkills = await loadSkills(path.join(home, 'skills'));
  const loadedMcp = await loadMcpDefinitions(home);
  const master: MasterDir = {
    rules: loadedRules.shared,
    providerRules: loadedRules.providers,
    skills: loadedSkills.shared,
    providerSkills: loadedSkills.providers,
    mcpServers: Object.fromEntries(Object.entries(loadedMcp.shared).map(([id, definition]) => [id, definition.server])),
    mcpDefinitions: loadedMcp.shared,
    providerMcpDefinitions: loadedMcp.providers,
  };
  if (!(await hasLibraryManifest(home))) return master;
  return filterArchivedAndTargetedArtifacts(master, await loadLibraryManifest(home));
}

function filterArchivedAndTargetedArtifacts(
  master: MasterDir,
  manifest: Awaited<ReturnType<typeof loadLibraryManifest>>,
): MasterDir {
  const active = manifest.artifacts.filter((artifact) => artifact.lifecycle === 'active');
  const byLocator = new Map(
    active.map((artifact) => [artifact.locator.path.split(path.sep).join('/'), artifact]),
  );
  const rules = master.rules.flatMap((rule) => {
    const artifact = byLocator.get(path.posix.join('rules', rule.relPath));
    return artifact?.kind === 'instruction' && artifact.scope.kind === 'global'
      ? [{ ...rule, targets: artifact.targets }]
      : [];
  });
  const providerRules = emptyProviderRecords<MasterRule>();
  const providerSkills = emptyProviderRecords<MasterSkill>();
  for (const provider of providerNames) {
    providerRules[provider] = master.providerRules[provider].flatMap((rule) => {
      const artifact = byLocator.get(path.posix.join('rules', rule.relPath));
      return artifact?.kind === 'instruction' && artifact.scope.kind === 'provider-overlay' && artifact.scope.provider === provider
        ? [{ ...rule, targets: [provider] }]
        : [];
    });
    providerSkills[provider] = master.providerSkills[provider].flatMap((skill) => {
      const artifact = byLocator.get(path.posix.join('skills', provider, skill.name));
      return artifact?.kind === 'skill' && artifact.scope.kind === 'provider-overlay' && artifact.scope.provider === provider
        ? [{ ...skill, targets: [provider] }]
        : [];
    });
  }
  const skills = master.skills.flatMap((skill) => {
    const artifact = byLocator.get(path.posix.join('skills', skill.name));
    return artifact?.kind === 'skill' && artifact.scope.kind === 'global'
      ? [{ ...skill, targets: artifact.targets }]
      : [];
  });
  return { ...master, rules, providerRules, skills, providerSkills };
}

interface LoadedRules {
  shared: MasterRule[];
  providers: Record<ProviderName, MasterRule[]>;
}

async function loadRules(rulesDir: string): Promise<LoadedRules> {
  const files = await collectFiles(rulesDir);
  const shared: MasterRule[] = [];
  const providers = emptyProviderRecords<MasterRule>();
  const overlayProviders = new Set(
    providerNames.filter((provider) =>
      files.some((file) => file.relPath === `${provider}/${PROVIDER_RULES_MARKER}`),
    ),
  );

  for (const file of files) {
    if (file.relPath.endsWith(`/${PROVIDER_RULES_MARKER}`)) {
      continue;
    }
    const rule = {
      relPath: file.relPath,
      content: await readFile(file.absPath, 'utf8'),
    };
    const [scope] = file.relPath.split('/');
    if (scope !== undefined && isProviderName(scope) && overlayProviders.has(scope)) {
      providers[scope].push(rule);
    } else {
      shared.push(rule);
    }
  }

  return { shared, providers };
}

interface LoadedSkills {
  shared: MasterSkill[];
  providers: Record<ProviderName, MasterSkill[]>;
}

async function loadSkills(skillsDir: string): Promise<LoadedSkills> {
  let entries: string[];
  try {
    entries = (await readdir(skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return emptyLoadedSkills();
    }
    throw error;
  }

  const shared: MasterSkill[] = [];
  const providers = emptyProviderRecords<MasterSkill>();
  for (const name of entries) {
    if (isProviderName(name)) {
      providers[name] = await loadSkillDirectories(path.join(skillsDir, name));
    } else {
      shared.push(await loadSkillDirectory(skillsDir, name));
    }
  }

  return { shared, providers };
}

async function loadSkillDirectories(parentDir: string): Promise<MasterSkill[]> {
  let entries: string[];
  try {
    entries = (await readdir(parentDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const skills: MasterSkill[] = [];
  for (const name of entries) {
    skills.push(await loadSkillDirectory(parentDir, name));
  }
  return skills;
}

async function loadSkillDirectory(parentDir: string, name: string): Promise<MasterSkill> {
  return {
    name,
    files: await collectFiles(path.join(parentDir, name)),
  };
}

function emptyLoadedSkills(): LoadedSkills {
  return {
    shared: [],
    providers: emptyProviderRecords<MasterSkill>(),
  };
}

function emptyProviderRecords<T>(): Record<ProviderName, T[]> {
  return {
    claude: [],
    codex: [],
    cursor: [],
    gemini: [],
    windsurf: [],
    opencode: [],
  };
}

function isProviderName(value: string): value is ProviderName {
  return (providerNames as readonly string[]).includes(value);
}

async function collectFiles(rootDir: string): Promise<MasterSkillFile[]> {
  const files: MasterSkillFile[] = [];

  async function visit(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
      } else if (entry.isFile()) {
        files.push({
          relPath: normalizeRelativePath(path.relative(rootDir, absPath)),
          absPath,
        });
      }
    }
  }

  await visit(rootDir);
  return files.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { flag: 'wx' });
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
