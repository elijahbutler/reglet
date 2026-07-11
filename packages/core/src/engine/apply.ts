import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
import { loadMasterDir, type MasterDir } from '../master.js';
import { regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ApplyResult, ProviderAdapter, ProviderId } from '../providers/types.js';
import { removeManagedDirectory, safeWriteDirectory, safeWriteFile } from './writer.js';

export type ApplyContent = ManagedContent;

export interface ApplyAllOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  dryRun?: boolean;
  home?: string;
}

export interface ApplyReport {
  results: ApplyResult[];
}

const allContents: ApplyContent[] = ['rules', 'skills', 'mcp'];

export async function applyAll(opts: ApplyAllOptions = {}): Promise<ApplyReport> {
  const home = opts.home ?? regletHome();
  if (opts.home !== undefined) {
    return withRegletHome(home, () => applyAllWithHome(opts, home));
  }
  return applyAllWithHome(opts, home);
}

async function applyAllWithHome(opts: ApplyAllOptions, home: string): Promise<ApplyReport> {
  const config = await loadConfig(home);
  const master = await loadMasterDir(home);
  const selectedProviders = opts.providers === undefined ? allAdapters() : opts.providers.map((id) => getAdapter(id));
  const selectedContents = opts.contents ?? allContents;
  const dryRun = opts.dryRun ?? false;
  const results: ApplyResult[] = [];

  for (const adapter of selectedProviders) {
    const providerConfig = config.providers[adapter.id];
    if (!providerConfig.enabled) {
      results.push(...selectedContents.map((content) => skipped(adapter, content, `${adapter.id} disabled`)));
      continue;
    }

    if (selectedContents.includes('rules')) {
      results.push(
        providerConfig.rules
          ? await applyRules(adapter, master, dryRun)
          : skipped(adapter, 'rules', `${adapter.id}:rules unenrolled`),
      );
    }

    if (selectedContents.includes('skills')) {
      results.push(
        ...(providerConfig.skills
          ? await applySkills(adapter, master, home, dryRun)
          : [skipped(adapter, 'skills', `${adapter.id}:skills unenrolled`)]),
      );
    }

    if (selectedContents.includes('mcp')) {
      if (!providerConfig.mcp) {
        results.push(skipped(adapter, 'mcp', `${adapter.id}:mcp unenrolled`));
        continue;
      }

      const mcpResult = adapter.applyMcp(master.mcpServers, { dryRun });
      results.push(
        mcpResult === null
          ? skipped(adapter, 'mcp', `${adapter.id}:mcp not implemented`)
          : await mcpResult,
      );
    }
  }

  return { results };
}

async function withRegletHome<T>(home: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.REGLET_HOME;
  process.env.REGLET_HOME = home;
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.REGLET_HOME;
    } else {
      process.env.REGLET_HOME = previous;
    }
  }
}

async function applyRules(adapter: ProviderAdapter, master: MasterDir, dryRun: boolean): Promise<ApplyResult> {
  const outputPath = adapter.rulesPath();
  if (outputPath === null) {
    return skipped(adapter, 'rules', `${adapter.id}:rules unsupported`);
  }

  const writeResult = await safeWriteFile({
    outputPath,
    content: renderRulesFile(adapter.id, master.rules),
    provider: adapter.id,
    managedContent: 'rules',
    dryRun,
  });

  return { provider: adapter.id, content: 'rules', outputPath, status: writeResult.status };
}

interface SkillApplyEntry {
  name: string;
  sourceDir: string;
}

async function applySkills(
  adapter: ProviderAdapter,
  master: MasterDir,
  home: string,
  dryRun: boolean,
): Promise<ApplyResult[]> {
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) {
    return [skipped(adapter, 'skills', `${adapter.id}:skills unsupported`)];
  }

  if (!dryRun) {
    await mkdir(skillsDir, { recursive: true });
  }

  const skills = resolveSkillsForProvider(master, adapter.id, home);
  const masterSkillNames = new Set(skills.map((skill) => skill.name));
  const results: ApplyResult[] = [];

  for (const skill of skills) {
    const outputPath = path.join(skillsDir, skill.name);
    const writeResult = await safeWriteDirectory({
      sourceDir: skill.sourceDir,
      outputPath,
      provider: adapter.id,
      dryRun,
    });
    results.push({ provider: adapter.id, content: 'skills', outputPath, status: writeResult.status });
  }

  const manifest = await loadManifest();
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== adapter.id || output.content !== 'skills' || path.dirname(outputPath) !== skillsDir) {
      continue;
    }

    if (!masterSkillNames.has(path.basename(outputPath))) {
      const removeResult = await removeManagedDirectory(outputPath, adapter.id, dryRun);
      results.push({ provider: adapter.id, content: 'skills', outputPath, status: removeResult.status });
      if (!dryRun) {
        const nextManifest = await loadManifest();
        delete nextManifest.outputs[outputPath];
        await saveManifest(nextManifest);
      }
    }
  }

  return results.length === 0 ? [skipped(adapter, 'skills', `${adapter.id}:skills no master skills`)] : results;
}

function resolveSkillsForProvider(master: MasterDir, provider: ProviderId, home: string): SkillApplyEntry[] {
  const resolved = new Map<string, SkillApplyEntry>();

  for (const skill of master.skills) {
    resolved.set(skill.name, {
      name: skill.name,
      sourceDir: path.join(home, 'skills', skill.name),
    });
  }

  for (const skill of master.providerSkills[provider]) {
    resolved.set(skill.name, {
      name: skill.name,
      sourceDir: path.join(home, 'skills', provider, skill.name),
    });
  }

  return Array.from(resolved.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function skipped(adapter: ProviderAdapter, content: ManagedContent, message: string): ApplyResult {
  return {
    provider: adapter.id,
    content,
    outputPath: '',
    status: 'skipped',
    message,
  };
}
