import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_HEADER, LEGACY_GENERATED_HEADER } from '../header.js';
import { loadManifest } from '../manifest.js';
import { loadMasterDir, type McpServerDef } from '../master.js';
import { deleteMcpServer, isCanonicalMcpServerDef, listEffectiveMcpServers, providerMcpScope, sharedMcpScope, upsertMcpServer, validateMcpServer } from '../mcp.js';
import { regletHome } from '../paths.js';
import { readProviderMcpServers } from '../providers/mcp-read.js';
import type { ProviderId } from '../providers/types.js';
import { detectDrift } from './drift.js';

export interface ImportRulesResult {
  provider: ProviderId;
  sourcePath: string;
  importedPath: string;
}

export interface ImportedSkill {
  name: string;
  sourcePath: string;
  importedPath: string;
}

export interface ImportSkillsResult {
  provider: ProviderId;
  imported: ImportedSkill[];
}

export interface ImportMcpResult {
  provider: ProviderId;
  sourcePath: string;
  importedPath: string;
  importedServers: string[];
  scope: 'shared' | 'provider';
}

export async function importDriftedRules(
  provider: ProviderId,
  home = regletHome(),
  date = new Date(),
): Promise<ImportRulesResult> {
  const manifest = await loadManifest(home);
  const match = Object.entries(manifest.outputs).find(
    ([, output]) => output.provider === provider && output.content === 'rules',
  );
  if (match === undefined) {
    throw new Error(`No managed rules output found for ${provider}`);
  }

  const [sourcePath] = match;
  const content = stripGeneratedHeader(await readFile(sourcePath, 'utf8'), provider);
  const importedPath = path.join(home, 'rules', `imported-${provider}-${formatDate(date)}.md`);
  await mkdir(path.dirname(importedPath), { recursive: true });
  await writeFile(importedPath, content);

  return { provider, sourcePath, importedPath };
}

/**
 * Copies managed skills that drifted in the provider's skills directory back
 * into their master source (provider-scoped when one shadows shared).
 * Missing outputs are skipped: a deleted skill has nothing to import.
 */
export async function importDriftedSkills(provider: ProviderId, home = regletHome()): Promise<ImportSkillsResult> {
  const manifest = await loadManifest(home);
  const managed = Object.entries(manifest.outputs).filter(
    ([, output]) => output.provider === provider && output.content === 'skills',
  );
  if (managed.length === 0) {
    throw new Error(`No managed skills output found for ${provider}`);
  }

  const master = await loadMasterDir(home);
  const providerScoped = new Set(master.providerSkills[provider].map((skill) => skill.name));
  const drift = await detectDrift(home);
  const imported: ImportedSkill[] = [];

  for (const record of drift) {
    if (record.provider !== provider || record.content !== 'skills' || record.status !== 'modified') {
      continue;
    }

    const name = path.basename(record.outputPath);
    const importedPath = providerScoped.has(name)
      ? path.join(home, 'skills', provider, name)
      : path.join(home, 'skills', name);
    await mkdir(path.dirname(importedPath), { recursive: true });
    await cp(record.outputPath, importedPath, { recursive: true, force: true });
    imported.push({ name, sourcePath: record.outputPath, importedPath });
  }

  return { provider, imported };
}

/**
 * Reads the provider's current values for Reglet-managed MCP servers and
 * writes them back into the master servers file. A managed key removed from
 * the provider config is removed from the master too.
 */
export async function importDriftedMcp(provider: ProviderId, home = regletHome(), scope: 'shared' | 'provider' = 'shared'): Promise<ImportMcpResult> {
  const manifest = await loadManifest(home);
  const match = Object.entries(manifest.outputs).find(
    ([, output]) => output.provider === provider && output.content === 'mcp',
  );
  if (match === undefined) {
    throw new Error(`No managed MCP output found for ${provider}`);
  }

  const [sourcePath, output] = match;
  const current = await readProviderMcpServers(provider, sourcePath);
  const effective = await listEffectiveMcpServers(provider, home);
  const byDisplayName = new Map(effective.map((entry) => [entry.displayName, entry]));
  const importedServers: string[] = [];
  const validatedServers = new Map<string, McpServerDef>();

  // Validate the complete import before the first mutation so a later invalid
  // managed entry cannot leave an earlier entry partially persisted.
  for (const key of output.managedKeys ?? []) {
    const server = current[key];
    if (server !== undefined) {
      const validation = validateMcpServer(key, server);
      if (!validation.ok || !isCanonicalMcpServerDef(key, server)) {
        throw new Error(`Cannot import MCP server ${key} from ${provider}: ${validation.issues.join('; ')}`);
      }
      validatedServers.set(key, server);
    } else {
      const existing = byDisplayName.get(key);
      if (scope === 'provider' && existing?.scope.kind !== 'provider') {
        throw new Error(`Cannot import removal of shared MCP server ${key} into provider scope`);
      }
    }
  }

  for (const key of output.managedKeys ?? []) {
    const server = validatedServers.get(key);
    const existing = byDisplayName.get(key);
    if (server !== undefined) {
      await upsertMcpServer(
        existing?.id ?? key,
        server,
        scope === 'provider' ? providerMcpScope(provider) : sharedMcpScope(),
        home,
        key,
      );
      importedServers.push(key);
    } else {
      await deleteMcpServer(
        existing?.id ?? key,
        scope === 'provider' ? providerMcpScope(provider) : sharedMcpScope(),
        home,
      );
    }
  }

  const importedPath = scope === 'provider'
    ? path.join(home, 'mcp', 'providers', provider, 'servers.json')
    : path.join(home, 'mcp', 'servers.json');

  return { provider, sourcePath, importedPath, importedServers, scope };
}

export function stripGeneratedHeader(content: string, provider: ProviderId): string {
  for (const header of [GENERATED_HEADER, LEGACY_GENERATED_HEADER]) {
    const renderedHeader = header.replace('<provider>', provider);
    if (content.startsWith(renderedHeader)) {
      return content.slice(renderedHeader.length).replace(/^\r?\n+/, '');
    }
  }
  return content;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
