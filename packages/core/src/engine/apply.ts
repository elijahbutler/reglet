import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
import { loadMasterDir, type MasterDir, type MasterSkill } from '../master.js';
import { regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ApplyResult, ProviderAdapter, ProviderId } from '../providers/types.js';
import { removeManagedDirectory, safeWriteDirectory, safeWriteFile } from './writer.js';

export type ApplyContent = ManagedContent;

export interface ApplyAllOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  dryRun?: boolean;
}

export interface ApplyReport {
  results: ApplyResult[];
}

const allContents: ApplyContent[] = ['rules', 'skills', 'mcp'];

export async function applyAll(opts: ApplyAllOptions = {}): Promise<ApplyReport> {
  const home = regletHome();
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
          ? await applySkills(adapter, master.skills, dryRun)
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

async function applySkills(adapter: ProviderAdapter, masterSkills: MasterSkill[], dryRun: boolean): Promise<ApplyResult[]> {
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) {
    return [skipped(adapter, 'skills', `${adapter.id}:skills unsupported`)];
  }

  if (!dryRun) {
    await mkdir(skillsDir, { recursive: true });
  }

  const masterSkillNames = new Set(masterSkills.map((skill) => skill.name));
  const results: ApplyResult[] = [];

  for (const skill of masterSkills) {
    const outputPath = path.join(skillsDir, skill.name);
    const sourceDir = path.join(regletHome(), 'skills', skill.name);
    const writeResult = await safeWriteDirectory({
      sourceDir,
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

function skipped(adapter: ProviderAdapter, content: ManagedContent, message: string): ApplyResult {
  return {
    provider: adapter.id,
    content,
    outputPath: '',
    status: 'skipped',
    message,
  };
}
