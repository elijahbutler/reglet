import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
import { loadMasterDir, type MasterDir, type MasterSkill } from '../master.js';
import { regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ApplyResult, ProviderAdapter, ProviderId } from '../providers/types.js';
import { inspectSkill } from '../security/skills.js';
import { systemSecretStore, type SecretStore } from '../security/secrets.js';
import { resolveMcpMachineOverrides } from '../projects/mcp-overrides.js';
import { LocalState } from '../state/database.js';
import { syncConflictContents } from '../sync/client.js';
import type { McpServerDefinition } from '../validation/types.js';
import { detectProjectionDrift, type DriftRecord } from './drift.js';
import { removeManagedDirectory, safeWriteDirectory, safeWriteFile } from './writer.js';

export type ApplyContent = ManagedContent;

export interface ApplyAllOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  dryRun?: boolean;
  secretStore?: SecretStore;
  allowOverwriteDrift?: boolean;
  home?: string;
}

export interface ApplyReport {
  results: ApplyResult[];
}

const allContents: ApplyContent[] = ['rules', 'skills', 'mcp'];

export async function applyAll(opts: ApplyAllOptions = {}): Promise<ApplyReport> {
  const home = opts.home ?? regletHome();
  const config = await loadConfig(home);
  const master = await loadMasterDir(home);
  const selectedProviders = opts.providers === undefined ? allAdapters() : opts.providers.map((id) => getAdapter(id));
  const selectedContents = opts.contents ?? allContents;
  const dryRun = opts.dryRun ?? false;
  const results: ApplyResult[] = [];
  const drift = await detectProjectionDrift(home);
  const syncConflicts = await syncConflictContents(home);

  for (const adapter of selectedProviders) {
    const providerConfig = config.providers[adapter.id];
    if (!providerConfig.enabled) {
      results.push(...selectedContents.map((content) => skipped(adapter, content, `${adapter.id} disabled`)));
      continue;
    }

    if (selectedContents.includes('rules')) {
      if (!providerConfig.rules) {
        results.push(skipped(adapter, 'rules', `${adapter.id}:rules unenrolled`));
      } else if (hasSyncConflict(syncConflicts, 'rules')) {
        results.push(blockedForSyncConflict(adapter, 'rules'));
      } else if (
        opts.allowOverwriteDrift !== true &&
        hasDrift(drift, adapter.id, 'rules')
      ) {
        results.push(blockedForDrift(adapter, 'rules'));
      } else {
        try {
          results.push(await applyRules(adapter, master, dryRun, home));
        } catch (error) {
          results.push(failed(adapter, 'rules', error));
        }
      }
    }

    if (selectedContents.includes('skills')) {
      if (!providerConfig.skills) {
        results.push(skipped(adapter, 'skills', `${adapter.id}:skills unenrolled`));
      } else if (
        opts.allowOverwriteDrift !== true &&
        hasDrift(drift, adapter.id, 'skills')
      ) {
        results.push(blockedForDrift(adapter, 'skills'));
      } else {
        try {
          results.push(
            ...(await applySkills(
              adapter,
              master.skills,
              dryRun,
              home,
              syncConflicts.map((conflict) => conflict.path),
            )),
          );
        } catch (error) {
          results.push(failed(adapter, 'skills', error));
        }
      }
    }

    if (selectedContents.includes('mcp')) {
      if (!providerConfig.mcp) {
        results.push(skipped(adapter, 'mcp', `${adapter.id}:mcp unenrolled`));
        continue;
      }
      if (hasSyncConflict(syncConflicts, 'mcp')) {
        results.push(blockedForSyncConflict(adapter, 'mcp'));
        continue;
      }
      if (
        opts.allowOverwriteDrift !== true &&
        hasDrift(drift, adapter.id, 'mcp')
      ) {
        results.push(blockedForDrift(adapter, 'mcp'));
        continue;
      }

      try {
        const mcpServers = Object.fromEntries(
          Object.entries(master.mcpServers).filter(([name]) => {
            const metadata = master.mcpArtifacts[name];
            return metadata === undefined || metadata.targets.includes(adapter.id);
          }),
        );
        const machineOverrides = await materializeMcpMachineOverrides(
          mcpServers,
          master.mcpArtifacts,
          home,
        );
        if (machineOverrides.missing.length > 0) {
          results.push({
            provider: adapter.id,
            content: 'mcp',
            outputPath: adapter.mcpPath() ?? '',
            status: 'blocked',
            message: 'Required MCP machine overrides are not configured.',
            issues: machineOverrides.missing.map((fieldPath) => ({
              code: 'missing-machine-override',
              severity: 'error',
              message: `Machine override is not configured: ${fieldPath}`,
            })),
          });
          continue;
        }
        const materialized = await materializeMcpSecrets(
          machineOverrides.servers,
          opts.secretStore,
        );
        if (materialized.missing.length > 0) {
          results.push({
            provider: adapter.id,
            content: 'mcp',
            outputPath: adapter.mcpPath() ?? '',
            status: 'blocked',
            message: 'Required MCP secrets are not bound on this machine.',
            issues: materialized.missing.map((reference) => ({
              code: 'missing-secret',
              severity: 'error',
              message: `Required secret is not bound: ${reference}`,
            })),
          });
          continue;
        }
        const mcpResult = adapter.applyMcp(materialized.servers, { dryRun, home });
        results.push(
          mcpResult === null
            ? skipped(
                adapter,
                'mcp',
                `${adapter.id}:mcp projection is unsupported by this adapter`,
              )
            : await mcpResult,
        );
      } catch (error) {
        results.push(failed(adapter, 'mcp', error));
      }
    }
  }

  return { results };
}

async function materializeMcpMachineOverrides(
  servers: MasterDir['mcpServers'],
  artifacts: MasterDir['mcpArtifacts'],
  home: string,
): Promise<{ servers: MasterDir['mcpServers']; missing: string[] }> {
  if (!JSON.stringify(servers).includes('reglet://machine-override/')) {
    return { servers, missing: [] };
  }
  const state = await LocalState.open(home);
  try {
    const output: MasterDir['mcpServers'] = {};
    const missing: string[] = [];
    for (const [name, server] of Object.entries(servers)) {
      const artifact = artifacts[name];
      const values = new Map(
        (artifact === undefined ? [] : state.mcpMachineOverrides(artifact.artifactId)).map(
          (override) => [override.fieldPath, override.value],
        ),
      );
      const resolved = resolveMcpMachineOverrides(
        normalizeMcpServerDefinition(server),
        values,
      );
      output[name] = resolved.definition;
      missing.push(...resolved.missing.map((fieldPath) => `${name}:${fieldPath}`));
    }
    return { servers: output, missing };
  } finally {
    state.close();
  }
}

function normalizeMcpServerDefinition(
  server: MasterDir['mcpServers'][string],
): McpServerDefinition {
  if (server.transport === 'http' || (server.url !== undefined && server.command === undefined)) {
    return {
      transport: 'http',
      url: server.url ?? '',
      headers: server.headers ?? {},
      secretHeaders: server.secretHeaders ?? {},
    };
  }
  return {
    transport: 'stdio',
    command: server.command ?? '',
    args: server.args ?? [],
    cwd: server.cwd,
    env: server.env ?? {},
    secretEnv: server.secretEnv ?? {},
  };
}

function hasDrift(
  records: DriftRecord[],
  provider: ProviderId,
  content: ManagedContent,
): boolean {
  return records.some(
    (record) =>
      record.provider === provider &&
      record.content === content &&
      (record.state === 'drifted' || record.state === 'missing'),
  );
}

function blockedForDrift(
  adapter: ProviderAdapter,
  content: ManagedContent,
): ApplyResult {
  return {
    provider: adapter.id,
    content,
    outputPath:
      content === 'rules'
        ? (adapter.rulesPath() ?? '')
        : content === 'skills'
          ? (adapter.skillsDir() ?? '')
          : (adapter.mcpPath() ?? ''),
    status: 'blocked',
    message: 'Provider output has drifted. Reapply requires explicit confirmation.',
    issues: [
      {
        code: 'external-drift',
        severity: 'error',
        message: 'Provider output changed after the last successful apply.',
      },
    ],
  };
}

async function materializeMcpSecrets(
  servers: MasterDir['mcpServers'],
  injectedStore?: SecretStore,
): Promise<{ servers: MasterDir['mcpServers']; missing: string[] }> {
  const references = new Set<string>();
  for (const server of Object.values(servers)) {
    for (const reference of [
      ...Object.values(server.secretEnv ?? {}),
      ...Object.values(server.secretHeaders ?? {}),
    ]) {
      if (reference.required !== false) {
        references.add(reference.id);
      }
    }
  }
  if (references.size === 0) {
    return { servers, missing: [] };
  }
  const secretStore = injectedStore ?? systemSecretStore();
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const reference of references) {
    const value = await secretStore.resolve(reference);
    if (value === undefined) {
      missing.push(reference);
    } else {
      resolved.set(reference, value);
    }
  }
  if (missing.length > 0) {
    return { servers, missing };
  }
  return {
    servers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        {
          ...server,
          env: {
            ...(server.env ?? {}),
            ...resolvedSecretFields(server.secretEnv ?? {}, resolved),
          },
          headers: {
            ...(server.headers ?? {}),
            ...resolvedSecretFields(server.secretHeaders ?? {}, resolved),
          },
          secretEnv: {},
          secretHeaders: {},
        },
      ]),
    ),
    missing: [],
  };
}

function resolvedSecretFields(
  references: Record<string, { id: string; required?: boolean }>,
  resolved: Map<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(references)
      .filter(([, reference]) => resolved.has(reference.id))
      .map(([key, reference]) => [key, resolved.get(reference.id) ?? '']),
  );
}

async function applyRules(
  adapter: ProviderAdapter,
  master: MasterDir,
  dryRun: boolean,
  home: string,
): Promise<ApplyResult> {
  const outputPath = adapter.rulesPath();
  if (outputPath === null) {
    return skipped(adapter, 'rules', `${adapter.id}:rules unsupported`);
  }

  const writeResult = await safeWriteFile({
    outputPath,
    content: renderRulesFile(
      adapter.id,
      master.rules.filter(
        (rule) => rule.targets === undefined || rule.targets.includes(adapter.id),
      ),
    ),
    provider: adapter.id,
    managedContent: 'rules',
    dryRun,
    home,
  });

  return {
    provider: adapter.id,
    content: 'rules',
    outputPath,
    status: writeResult.status,
    ...(dryRun ? projectionHashes(writeResult) : {}),
  };
}

async function applySkills(
  adapter: ProviderAdapter,
  masterSkills: MasterSkill[],
  dryRun: boolean,
  home: string,
  syncConflictPaths: string[],
): Promise<ApplyResult[]> {
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) {
    return [skipped(adapter, 'skills', `${adapter.id}:skills unsupported`)];
  }

  if (!dryRun) {
    await mkdir(skillsDir, { recursive: true });
  }

  const targetedSkills = masterSkills.filter(
    (skill) => skill.targets === undefined || skill.targets.includes(adapter.id),
  );
  const masterSkillNames = new Set(targetedSkills.map((skill) => skill.name));
  const results: ApplyResult[] = [];

  for (const skill of targetedSkills) {
    const outputPath = path.join(skillsDir, skill.name);
    if (
      syncConflictPaths.includes('library.json') ||
      syncConflictPaths.some((conflictPath) =>
        conflictPath.startsWith(`skills/${skill.name}/`),
      )
    ) {
      results.push(blockedForSyncConflict(adapter, 'skills', outputPath));
      continue;
    }
    const sourceDir = path.join(home, 'skills', skill.name);
    const trustIssue = await skillTrustIssue(
      sourceDir,
      skill.artifactId,
      home,
    );
    if (trustIssue !== undefined) {
      results.push({
        provider: adapter.id,
        content: 'skills',
        outputPath,
        status: 'blocked',
        message: trustIssue,
        issues: [
          {
            code: 'skill-trust-required',
            severity: 'error',
            message: trustIssue,
          },
        ],
      });
      continue;
    }
    const writeResult = await safeWriteDirectory({
      sourceDir,
      outputPath,
      provider: adapter.id,
      dryRun,
      home,
    });
    results.push({
      provider: adapter.id,
      content: 'skills',
      outputPath,
      status: writeResult.status,
      ...(dryRun ? projectionHashes(writeResult) : {}),
    });
  }

  const manifest = await loadManifest(home);
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== adapter.id || output.content !== 'skills' || path.dirname(outputPath) !== skillsDir) {
      continue;
    }

    if (!masterSkillNames.has(path.basename(outputPath))) {
      const skillName = path.basename(outputPath);
      if (
        syncConflictPaths.includes('library.json') ||
        syncConflictPaths.some((conflictPath) =>
          conflictPath.startsWith(`skills/${skillName}/`),
        )
      ) {
        results.push(blockedForSyncConflict(adapter, 'skills', outputPath));
        continue;
      }
      const removeResult = await removeManagedDirectory(outputPath, adapter.id, dryRun, home);
      results.push({
        provider: adapter.id,
        content: 'skills',
        outputPath,
        status: removeResult.status,
        ...(dryRun ? projectionHashes(removeResult) : {}),
      });
      if (!dryRun) {
        const nextManifest = await loadManifest(home);
        delete nextManifest.outputs[outputPath];
        await saveManifest(nextManifest, home);
      }
    }
  }

  return results.length === 0 ? [skipped(adapter, 'skills', `${adapter.id}:skills no master skills`)] : results;
}

async function skillTrustIssue(
  sourceDir: string,
  artifactId: string | undefined,
  home: string,
): Promise<string | undefined> {
  const inspection = await inspectSkill(sourceDir);
  if (!inspection.requiresExecutableConfirmation) {
    return undefined;
  }
  if (artifactId === undefined) {
    return 'Executable skill content requires an explicit local trust decision.';
  }
  const state = await LocalState.open(home);
  try {
    const decision = state.trustDecision(artifactId);
    if (decision === undefined) {
      return 'Executable skill content requires an explicit local trust decision.';
    }
    if (decision.revision !== inspection.revision) {
      return 'Executable skill content changed after trust approval. Review and trust the new revision before apply.';
    }
    return undefined;
  } finally {
    state.close();
  }
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

function failed(
  adapter: ProviderAdapter,
  content: ManagedContent,
  error: unknown,
): ApplyResult {
  return {
    provider: adapter.id,
    content,
    outputPath:
      content === 'rules'
        ? (adapter.rulesPath() ?? '')
        : content === 'skills'
          ? (adapter.skillsDir() ?? '')
          : (adapter.mcpPath() ?? ''),
    status: 'error',
    message: error instanceof Error ? error.message : 'Unknown provider apply error',
    issues: [
      {
        code: 'filesystem-operation-failed',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Unknown provider apply error',
      },
    ],
  };
}

function hasSyncConflict(
  conflicts: Array<{ path: string }>,
  content: ManagedContent,
): boolean {
  const root =
    content === 'rules' ? 'rules/' : content === 'skills' ? 'skills/' : 'mcp/';
  return conflicts.some(
    (conflict) =>
      conflict.path === 'library.json' || conflict.path.startsWith(root),
  );
}

function blockedForSyncConflict(
  adapter: ProviderAdapter,
  content: ManagedContent,
  outputPath?: string,
): ApplyResult {
  return {
    provider: adapter.id,
    content,
    outputPath:
      outputPath ??
      (content === 'rules'
        ? (adapter.rulesPath() ?? '')
        : content === 'skills'
          ? (adapter.skillsDir() ?? '')
          : (adapter.mcpPath() ?? '')),
    status: 'blocked',
    message: 'A canonical sync conflict must be resolved before applying this projection.',
    issues: [
      {
        code: 'sync-conflict',
        severity: 'error',
        message:
          'Resolve the affected canonical file in Sync & Devices before applying.',
      },
    ],
  };
}

function projectionHashes(
  result: Awaited<ReturnType<typeof safeWriteFile>>,
): Pick<
  ApplyResult,
  'desiredHash' | 'appliedHash' | 'observedHash' | 'appliedAt'
> {
  return {
    desiredHash: result.hash,
    appliedHash: result.appliedHash,
    observedHash: result.observedHash,
    appliedAt: result.appliedAt,
  };
}
