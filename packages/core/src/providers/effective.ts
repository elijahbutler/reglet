import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getOutput } from '../manifest.js';
import { providerHome, regletHome } from '../paths.js';
import type { ProjectionIssue } from '../projections/state.js';
import { LocalState } from '../state/database.js';
import { getAdapter } from './registry.js';
import { isNodeError, isRecord, pathExists } from './common.js';
import type { ProviderCapability, ProviderId } from './types.js';

export interface EffectiveProviderConfiguration {
  provider: ProviderId;
  managedProjection: {
    rulesPath: string | null;
    skillsDir: string | null;
    mcpPath: string | null;
  };
  issues: ProjectionIssue[];
  unmanagedMcpEntries: string[];
  unsupportedGlobalCapabilities: Array<{
    capability: ProviderCapability;
    message: string;
  }>;
  knownProjectFiles: Array<{
    rootId: string;
    relativePath: string;
  }>;
}

export async function inspectEffectiveProviderConfiguration(
  provider: ProviderId,
  home = regletHome(),
): Promise<EffectiveProviderConfiguration> {
  const adapter = getAdapter(provider);
  const issues: ProjectionIssue[] = [];
  if (provider === 'codex') {
    const overridePath = path.join(providerHome(), '.codex', 'AGENTS.override.md');
    if (await pathExists(overridePath)) {
      issues.push({
        code: 'shadowed',
        severity: 'warning',
        message:
          'AGENTS.override.md takes precedence over Reglet’s managed AGENTS.md projection.',
        documentationUrl: adapter.documentationUrl,
      });
    }
  }
  const state = await LocalState.open(home);
  let knownProjectFiles: EffectiveProviderConfiguration['knownProjectFiles'];
  try {
    knownProjectFiles = state
      .listDiscoveries()
      .filter((discovery) => discovery.recognizedBy.includes(provider))
      .map((discovery) => ({
        rootId: discovery.rootId,
        relativePath: discovery.relativePath,
      }));
  } finally {
    state.close();
  }

  const unsupportedGlobalCapabilities = adapter.discoveries
    .filter((discovery) => discovery.scope === 'global' && !discovery.supported)
    .map((discovery) => ({
      capability: capabilityForKind(discovery.kind),
      message: discovery.issue ?? 'This global capability is unsupported.',
    }));
  return {
    provider,
    managedProjection: {
      rulesPath: adapter.rulesPath(),
      skillsDir: adapter.skillsDir(),
      mcpPath: adapter.mcpPath(),
    },
    issues,
    unmanagedMcpEntries: await unmanagedMcpEntries(provider, home),
    unsupportedGlobalCapabilities,
    knownProjectFiles,
  };
}

async function unmanagedMcpEntries(
  provider: ProviderId,
  home: string,
): Promise<string[]> {
  const mcpPath = getAdapter(provider).mcpPath();
  if (mcpPath === null || !(await pathExists(mcpPath))) {
    return [];
  }
  const output = await getOutput(mcpPath, home);
  const managed = new Set(output?.managedKeys ?? []);
  try {
    const parsed = JSON.parse(await readFile(mcpPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      return [];
    }
    const container =
      isRecord(parsed.mcpServers)
        ? parsed.mcpServers
        : isRecord(parsed.mcp)
          ? parsed.mcp
          : {};
    return Object.keys(container)
      .filter((name) => !managed.has(name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (
      (isNodeError(error) && error.code === 'ENOENT') ||
      path.extname(mcpPath) === '.toml'
    ) {
      return [];
    }
    throw error;
  }
}

function capabilityForKind(
  kind: 'instruction' | 'skill' | 'mcp',
): ProviderCapability {
  return kind === 'instruction' ? 'instructions' : kind === 'skill' ? 'skills' : 'mcp';
}
