import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import {
  detectDir,
  inventoryFor,
  isNodeError,
  isRecord,
  providerPath,
} from './common.js';
import { applyCodexMcp, readCodexMcpServerNames } from './codex-mcp.js';
import type {
  ProviderAdapter,
  ProviderDiscoveryDeclaration,
} from './types.js';

export async function codexConfiguredProjectDiscoveries(): Promise<
  ProviderDiscoveryDeclaration[]
> {
  let value: unknown;
  try {
    value = parse(await readFile(providerPath('.codex', 'config.toml'), 'utf8'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  if (!isRecord(value) || !Array.isArray(value.project_doc_fallback_filenames)) {
    return [];
  }
  const reserved = new Set(['AGENTS.md', 'AGENTS.override.md']);
  return [
    ...new Set(
      value.project_doc_fallback_filenames.filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.length > 0 &&
          !item.includes('/') &&
          !item.includes('\\') &&
          item !== '.' &&
          item !== '..' &&
          !reserved.has(item),
      ),
    ),
  ].map((filename) => ({
    kind: 'instruction',
    scope: 'project',
    format: 'codex-fallback-markdown',
    matcher: 'basename',
    pattern: filename,
    hierarchical: true,
    supported: true,
  }));
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: 'Codex',
  documentationUrl: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'agents-markdown',
      matcher: 'exact',
      pattern: '.codex/AGENTS.override.md',
      supported: false,
      issue: 'An unmanaged global override shadows the managed AGENTS.md projection.',
    },
    {
      kind: 'instruction',
      scope: 'global',
      format: 'agents-markdown',
      matcher: 'exact',
      pattern: '.codex/AGENTS.md',
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.agents/skills',
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'codex-toml',
      matcher: 'exact',
      pattern: '.codex/config.toml',
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'agents-override-markdown',
      matcher: 'basename',
      pattern: 'AGENTS.override.md',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'agents-markdown',
      matcher: 'basename',
      pattern: 'AGENTS.md',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'project',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.agents/skills',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'project',
      format: 'codex-toml',
      matcher: 'exact',
      pattern: '.codex/config.toml',
      hierarchical: true,
      trustedOnly: true,
      supported: true,
    },
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'codex/precedence', expectedSchemaVersion: 2 },
    { capability: 'skills', fixture: 'shared/skill', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'codex/mcp-toml', expectedSchemaVersion: 2 },
  ],
  configuredDiscoveries: codexConfiguredProjectDiscoveries,
  detect: () => detectDir('.codex'),
  rulesPath: () => providerPath('.codex', 'AGENTS.md'),
  skillsDir: () => providerPath('.agents', 'skills'),
  mcpPath: () => providerPath('.codex', 'config.toml'),
  applyMcp(servers, ctx) {
    return applyCodexMcp(
      this.mcpPath() ?? providerPath('.codex', 'config.toml'),
      servers,
      ctx,
    );
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readCodexMcpServerNames(mcpPath));
  },
};
