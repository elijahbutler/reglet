import path from 'node:path';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
import { loadMasterDir, type MasterDir } from '../master.js';
import { listEffectiveMcpServers, listMcpServers, providerMcpScope, resolveEffectiveMcpServersEnv } from '../mcp.js';
import { regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ApplyResult, ProviderAdapter, ProviderId } from '../providers/types.js';
import { compositionRevisionKey, deriveMasterRevisions, type MasterRevisionSet } from '../revisions.js';
import { detectDrift } from './drift.js';
import { beginOperation, recoverPendingOperations, type OperationContext, type OperationReceipt } from './operations.js';
import { removeManagedDirectory, safeWriteDirectory, safeWriteFile } from './writer.js';

export type ApplyContent = ManagedContent;

export interface ApplyAllOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  dryRun?: boolean;
  home?: string;
  providerHome?: string;
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
  return applyAllWithHome(opts, home);
}

async function applyAllWithHome(opts: ApplyAllOptions, home: string): Promise<ApplyReport> {
  const config = await loadConfig(home);
  const master = await loadMasterDir(home);
  const revisions = await deriveMasterRevisions(master, config);
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
        masterRevision: revisions.masterRevision,
        compositionRevisions: appliedCompositionRevisions(config, revisions, selectedProviders, selectedContents, opts.providerHome),
      });

  try {
    if (selectedContents.includes('mcp')) {
      await assertValidMcp(home, selectedProviders);
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
            ? await applyRules(adapter, master, home, dryRun, operation, opts, revisions.masterRevision, revisions.compositionRevisions[adapter.id].rules)
            : skipped(adapter, 'rules', `${adapter.id}:rules unenrolled`),
        );
      }

      if (selectedContents.includes('skills')) {
        results.push(
          ...(providerConfig.skills
            ? await applySkills(adapter, master, config, home, dryRun, operation, opts, revisions.masterRevision, revisions.compositionRevisions[adapter.id].skills)
            : [skipped(adapter, 'skills', `${adapter.id}:skills unenrolled`)]),
        );
      }

      if (selectedContents.includes('mcp')) {
        if (!providerConfig.mcp) {
          results.push(skipped(adapter, 'mcp', `${adapter.id}:mcp unenrolled`));
          continue;
        }

        const mcpResult = adapter.applyMcp(
          await resolveEffectiveMcpServersEnv(adapter.id, home, process.env, undefined, { lenient: true }),
          {
          dryRun,
          home,
          providerHome: opts.providerHome,
          operation,
          masterRevision: revisions.masterRevision,
          compositionRevision: revisions.compositionRevisions[adapter.id].mcp,
        });
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

function appliedCompositionRevisions(
  config: Awaited<ReturnType<typeof loadConfig>>,
  revisions: MasterRevisionSet,
  providers: readonly ProviderAdapter[],
  contents: readonly ApplyContent[],
  providerHome: string | undefined,
): Record<string, string> {
  const applied: Record<string, string> = {};
  for (const adapter of providers) {
    const providerConfig = config.providers[adapter.id];
    if (!providerConfig.enabled) continue;
    for (const content of contents) {
      const destination = content === 'rules'
        ? adapter.rulesPath(providerHome)
        : content === 'skills'
          ? adapter.skillsDir(providerHome)
          : adapter.mcpPath(providerHome);
      if (providerConfig[content] && destination !== null) {
        applied[compositionRevisionKey(adapter.id, content)] = revisions.compositionRevisions[adapter.id][content];
      }
    }
  }
  return applied;
}

async function assertValidMcp(home: string, providers: readonly ProviderAdapter[]): Promise<void> {
  const issues = (await listMcpServers(home)).servers.flatMap((server) =>
    server.issues.map((issue) => `mcp/${server.id}: ${issue}`),
  );
  for (const provider of providers) {
    issues.push(
      ...(await listMcpServers(providerMcpScope(provider.id), home)).servers.flatMap((server) =>
        server.issues.map((issue) => `mcp/${provider.id}/${server.id}: ${issue}`),
      ),
    );
    const conflict = (await listEffectiveMcpServers(provider.id, home)).find((entry) => entry.conflictStatus.state === 'conflict');
    if (conflict !== undefined && conflict.conflictStatus.state === 'conflict') {
      issues.push(`mcp/${provider.id}: display-name conflict ${conflict.conflictStatus.displayName} (${conflict.conflictStatus.conflictingIds.join(', ')})`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid MCP configuration: ${issues.join('; ')}`);
  }
}

async function applyRules(
  adapter: ProviderAdapter,
  master: MasterDir,
  home: string,
  dryRun: boolean,
  operation: OperationContext | undefined,
  opts: ApplyAllOptions,
  masterRevision: string,
  compositionRevision: string,
): Promise<ApplyResult> {
  const outputPath = adapter.rulesPath(opts.providerHome);
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
    masterRevision,
    compositionRevision,
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
  config: Awaited<ReturnType<typeof loadConfig>>,
  home: string,
  dryRun: boolean,
  operation: OperationContext | undefined,
  opts: ApplyAllOptions,
  masterRevision: string,
  compositionRevision: string,
): Promise<ApplyResult[]> {
  const skillsDir = adapter.skillsDir(opts.providerHome);
  if (skillsDir === null) {
    return [skipped(adapter, 'skills', `${adapter.id}:skills unsupported`)];
  }

  const skills = resolveSkillsForProvider(master, config, adapter.id, home);
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
      masterRevision,
      compositionRevision,
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

function resolveSkillsForProvider(
  master: MasterDir,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: ProviderId,
  home: string,
): SkillApplyEntry[] {
  const resolved = new Map<string, SkillApplyEntry>();

  for (const skill of master.skills) {
    const configuredTargets = skill.targets ?? config.contentSync.skills[skill.name];
    if (configuredTargets !== undefined && !configuredTargets.includes(provider)) continue;
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
