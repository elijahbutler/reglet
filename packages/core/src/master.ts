import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configPath, defaultConfig, serializeConfig } from './config.js';
import { regletHome } from './paths.js';
import {
  libraryManifestPath,
  loadLibraryManifest,
  migrateLibraryToV2,
} from './artifacts/library.js';
import type { ArtifactId } from './artifacts/types.js';
import type { ProviderId } from './providers/types.js';

export interface McpServerDef {
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretEnv?: Record<string, { id: string; required?: boolean }>;
  url?: string;
  headers?: Record<string, string>;
  secretHeaders?: Record<string, { id: string; required?: boolean }>;
}

export interface MasterRule {
  relPath: string;
  content: string;
  artifactId?: ArtifactId;
  targets?: ProviderId[];
}

export interface MasterSkillFile {
  relPath: string;
  absPath: string;
}

export interface MasterSkill {
  name: string;
  files: MasterSkillFile[];
  artifactId?: ArtifactId;
  targets?: ProviderId[];
}

export interface MasterMcpArtifact {
  artifactId: ArtifactId;
  targets: ProviderId[];
}

export interface MasterDir {
  rules: MasterRule[];
  skills: MasterSkill[];
  mcpServers: Record<string, McpServerDef>;
  mcpArtifacts: Record<string, MasterMcpArtifact>;
}

interface McpServersFile {
  mcpServers?: Record<string, McpServerDef>;
}

export async function initMasterDir(home = regletHome()): Promise<void> {
  await mkdir(path.join(home, 'rules'), { recursive: true });
  await mkdir(path.join(home, 'skills'), { recursive: true });
  await mkdir(path.join(home, 'mcp'), { recursive: true });
  await mkdir(path.join(home, '.state', 'backups'), { recursive: true });
  await mkdir(path.join(home, '.state', 'sync-base'), { recursive: true });

  await writeFileIfMissing(path.join(home, 'mcp', 'servers.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  await writeFileIfMissing(
    path.join(home, 'rules', '00-general.md'),
    '# Reglet general rules\n\n<!-- Add shared instructions here. -->\n',
  );

  await writeFileIfMissing(configPath(home), serializeConfig(defaultConfig()));
  await migrateLibraryToV2(home);
}

export async function loadMasterDir(home = regletHome()): Promise<MasterDir> {
  const hasV2Library = await pathExists(libraryManifestPath(home));
  const library = hasV2Library ? await loadLibraryManifest(home) : undefined;
  return {
    rules:
      library === undefined
        ? await loadRules(path.join(home, 'rules'))
        : await loadLibraryRules(home, library.artifacts),
    skills:
      library === undefined
        ? await loadSkills(path.join(home, 'skills'))
        : await loadLibrarySkills(home, library.artifacts),
    ...(await loadLibraryMcp(
      path.join(home, 'mcp', 'servers.json'),
      library?.artifacts,
    )),
  };
}

async function loadLibraryRules(
  home: string,
  artifacts: Awaited<ReturnType<typeof loadLibraryManifest>>['artifacts'],
): Promise<MasterRule[]> {
  const rules: MasterRule[] = [];
  for (const artifact of artifacts) {
    if (
      artifact.kind !== 'instruction' ||
      artifact.lifecycle !== 'active' ||
      artifact.locator.type !== 'file'
    ) {
      continue;
    }
    rules.push({
      relPath: artifact.locator.path,
      content: await readFile(path.join(home, artifact.locator.path), 'utf8'),
      artifactId: artifact.id,
      targets: artifact.targets,
    });
  }
  return rules.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

async function loadLibrarySkills(
  home: string,
  artifacts: Awaited<ReturnType<typeof loadLibraryManifest>>['artifacts'],
): Promise<MasterSkill[]> {
  const skills: MasterSkill[] = [];
  for (const artifact of artifacts) {
    if (
      artifact.kind !== 'skill' ||
      artifact.lifecycle !== 'active' ||
      artifact.locator.type !== 'directory'
    ) {
      continue;
    }
    const skillDir = path.join(home, artifact.locator.path);
    skills.push({
      name: artifact.slug,
      files: await collectFiles(skillDir),
      artifactId: artifact.id,
      targets: artifact.targets,
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadLibraryMcp(
  serversPath: string,
  artifacts:
    | Awaited<ReturnType<typeof loadLibraryManifest>>['artifacts']
    | undefined,
): Promise<{
  mcpServers: Record<string, McpServerDef>;
  mcpArtifacts: Record<string, MasterMcpArtifact>;
}> {
  const allServers = await loadMcpServers(serversPath);
  if (artifacts === undefined) {
    return { mcpServers: allServers, mcpArtifacts: {} };
  }
  const mcpServers: Record<string, McpServerDef> = {};
  const mcpArtifacts: Record<string, MasterMcpArtifact> = {};
  for (const artifact of artifacts) {
    if (
      artifact.kind !== 'mcp' ||
      artifact.lifecycle !== 'active' ||
      artifact.locator.type !== 'mcp-server'
    ) {
      continue;
    }
    const definition = allServers[artifact.locator.serverName];
    if (definition === undefined) {
      continue;
    }
    mcpServers[artifact.locator.serverName] = definition;
    mcpArtifacts[artifact.locator.serverName] = {
      artifactId: artifact.id,
      targets: artifact.targets,
    };
  }
  return { mcpServers, mcpArtifacts };
}

async function loadRules(rulesDir: string): Promise<MasterRule[]> {
  const files = await collectFiles(rulesDir);
  const rules: MasterRule[] = [];

  for (const file of files) {
    rules.push({
      relPath: file.relPath,
      content: await readFile(file.absPath, 'utf8'),
    });
  }

  return rules;
}

async function loadSkills(skillsDir: string): Promise<MasterSkill[]> {
  let entries: string[];
  try {
    entries = (await readdir(skillsDir, { withFileTypes: true }))
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
    const skillDir = path.join(skillsDir, name);
    skills.push({
      name,
      files: await collectFiles(skillDir),
    });
  }

  return skills;
}

async function loadMcpServers(serversPath: string): Promise<Record<string, McpServerDef>> {
  try {
    const parsed = JSON.parse(await readFile(serversPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord((parsed as McpServersFile).mcpServers)) {
      return {};
    }

    const servers: Record<string, McpServerDef> = {};
    for (const [name, server] of Object.entries((parsed as McpServersFile).mcpServers ?? {})) {
      if (isMcpServerDef(server)) {
        servers[name] = server;
      }
    }
    return servers;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
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
          relPath: path.relative(rootDir, absPath),
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

function isMcpServerDef(value: unknown): value is McpServerDef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    readOptionalString(value.command) &&
    readOptionalStringArray(value.args) &&
    readOptionalString(value.cwd) &&
    readOptionalStringRecord(value.env) &&
    readOptionalSecretRecord(value.secretEnv) &&
    readOptionalString(value.url) &&
    readOptionalStringRecord(value.headers) &&
    readOptionalSecretRecord(value.secretHeaders) &&
    (value.transport === undefined || value.transport === 'stdio' || value.transport === 'http')
  );
}

function readOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function readOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function readOptionalStringRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && Object.values(value).every((item) => typeof item === 'string'))
  );
}

function readOptionalSecretRecord(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      (item.required === undefined || typeof item.required === 'boolean'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
