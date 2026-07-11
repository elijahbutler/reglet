import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configPath, defaultConfig, serializeConfig } from './config.js';
import { regletHome } from './paths.js';

export interface McpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MasterRule {
  relPath: string;
  content: string;
}

export interface MasterSkillFile {
  relPath: string;
  absPath: string;
}

export interface MasterSkill {
  name: string;
  files: MasterSkillFile[];
}

export interface MasterDir {
  rules: MasterRule[];
  skills: MasterSkill[];
  mcpServers: Record<string, McpServerDef>;
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
}

export async function loadMasterDir(home = regletHome()): Promise<MasterDir> {
  return {
    rules: await loadRules(path.join(home, 'rules')),
    skills: await loadSkills(path.join(home, 'skills')),
    mcpServers: await loadMcpServers(path.join(home, 'mcp', 'servers.json')),
  };
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
    readOptionalStringRecord(value.env) &&
    readOptionalString(value.url)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
