import path from 'node:path';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
import { loadMasterDir, type MasterDir } from '../master.js';
import { listMcpServers, resolveMcpServersEnv } from '../mcp.js';
import { regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ApplyResult, ProviderAdapter, ProviderId } from '../providers/types.js';
import { detectDrift } from './drift.js';
import { beginOperation, recoverPendingOperations, type OperationContext, type OperationReceipt } from './operations.js';
import { removeManagedDirectory, safeWriteDirectory, safeWriteFile } from './writer.js';

export type ApplyContent = ManagedContent;

export interface ApplyAllOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  dryRun?: boolean;
  home?: string;
  reviewedReplacement?: boolean;
  structuredPreviewDigest?: string;
  testHooks?: {
    beforeMutation?: (targetPath: string) => void | Promise<void>;
  };
}

export interface ApplyReport {
  results: ApplyResult[];
  receipt?: OperationReceipt;
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

  if (!dryRun) {
    await recoverPendingOperations(home);
  }

  if (!dryRun && opts.reviewedReplacement !== true) {
    const drift = (await detectDrift(home)).filter((record) => record.status !== 'clean');
    if (drift.length > 0) {
      throw new Error(`Refusing unreviewed provider drift replacement: ${drift.map((record) => record.outputPath).join(', ')}`);
    }
  }

  const operation = dryRun
    ? undefined
    : await beginOperation({
        home,
        providers: opts.providers,
        contents: opts.contents,
        structuredPreviewDigest: opts.structuredPreviewDigest,
      });

  try {
    if (selectedContents.includes('mcp')) {
      await assertValidMcp(home);
    }

    for (const adapter of selectedProviders) {
      const providerConfig = config.providers[adapter.id];
      if (!providerConfig.enabled) {
        results.push(...selectedContents.map((content) => skipped(adapter, content, `${adapter.id} disabled`)));
        continue;
      }

      if (selectedContents.includes('rules')) {
        results.push(
          providerConfig.rules
            ? await applyRules(adapter, master, home, dryRun, operation, opts)
            : skipped(adapter, 'rules', `${adapter.id}:rules unenrolled`),
        );
      }

      if (selectedContents.includes('skills')) {
        results.push(
          ...(providerConfig.skills
            ? await applySkills(adapter, master, home, dryRun, operation, opts)
            : [skipped(adapter, 'skills', `${adapter.id}:skills unenrolled`)]),
        );
      }

      if (selectedContents.includes('mcp')) {
        if (!providerConfig.mcp) {
          results.push(skipped(adapter, 'mcp', `${adapter.id}:mcp unenrolled`));
          continue;
        }

        const mcpResult = adapter.applyMcp(resolveMcpServersEnv(master.mcpServers), { dryRun, home, operation });
        results.push(
          mcpResult === null
            ? skipped(adapter, 'mcp', `${adapter.id}:mcp not implemented`)
            : await mcpResult,
        );
      }
    }

    return operation === undefined ? { results } : { results, receipt: await operation.complete() };
  } catch (error) {
    if (operation !== undefined) {
      await operation.rollback(error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

async function assertValidMcp(home: string): Promise<void> {
  const issues = (await listMcpServers(home)).servers.flatMap((server) =>
    server.issues.map((issue) => `mcp/${server.name}: ${issue}`),
  );
  if (issues.length > 0) {
    throw new Error(`Invalid MCP configuration: ${issues.join('; ')}`);
  }
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

async function applyRules(
  adapter: ProviderAdapter,
  master: MasterDir,
  home: string,
  dryRun: boolean,
  operation: OperationContext | undefined,
  opts: ApplyAllOptions,
): Promise<ApplyResult> {
  const outputPath = adapter.rulesPath();
  if (outputPath === null) {
    return skipped(adapter, 'rules', `${adapter.id}:rules unsupported`);
  }

  await opts.testHooks?.beforeMutation?.(outputPath);
  const writeResult = await safeWriteFile({
    outputPath,
    content: renderRulesFile(adapter.id, [...master.rules, ...master.providerRules[adapter.id]]),
    provider: adapter.id,
    managedContent: 'rules',
    dryRun,
    home,
    operation,
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
  operation: OperationContext | undefined,
  opts: ApplyAllOptions,
): Promise<ApplyResult[]> {
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) {
    return [skipped(adapter, 'skills', `${adapter.id}:skills unsupported`)];
  }

  const skills = resolveSkillsForProvider(master, adapter.id, home);
  const masterSkillNames = new Set(skills.map((skill) => skill.name));
  const results: ApplyResult[] = [];

  for (const skill of skills) {
    const outputPath = path.join(skillsDir, skill.name);
    await opts.testHooks?.beforeMutation?.(outputPath);
    const writeResult = await safeWriteDirectory({
      sourceDir: skill.sourceDir,
      outputPath,
      provider: adapter.id,
      dryRun,
      home,
      operation,
    });
    results.push({ provider: adapter.id, content: 'skills', outputPath, status: writeResult.status });
  }

  const manifest = await loadManifest(home);
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== adapter.id || output.content !== 'skills' || path.dirname(outputPath) !== skillsDir) {
      continue;
    }

    if (!masterSkillNames.has(path.basename(outputPath))) {
      await opts.testHooks?.beforeMutation?.(outputPath);
      const removeResult = await removeManagedDirectory(outputPath, adapter.id, dryRun, home, operation);
      results.push({ provider: adapter.id, content: 'skills', outputPath, status: removeResult.status });
      if (!dryRun) {
        const nextManifest = await loadManifest(home);
        delete nextManifest.outputs[outputPath];
        await saveManifest(nextManifest, home);
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
