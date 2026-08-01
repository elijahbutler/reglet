import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';
export const windsurfAdapter: ProviderAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
  documentationUrl: 'https://docs.windsurf.com/windsurf/cascade/agents-md',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'windsurf-global-rules',
      matcher: 'exact',
      pattern: '.codeium/windsurf/memories/global_rules.md',
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.codeium/windsurf/skills',
      supported: false,
      issue: 'Global skill projection is disabled until its path and schema are verified.',
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'mcp-json',
      matcher: 'exact',
      pattern: '.codeium/windsurf/mcp_config.json',
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'windsurf-rule',
      matcher: 'extension',
      pattern: '.windsurf/rules/**/*.md',
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
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'windsurf/rules', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'windsurf/mcp', expectedSchemaVersion: 2 },
  ],
  detect: () => detectDir('.codeium', 'windsurf'),
  rulesPath: () => providerPath('.codeium', 'windsurf', 'memories', 'global_rules.md'),
  skillsDir: () => null,
  mcpPath: () => providerPath('.codeium', 'windsurf', 'mcp_config.json'),
  applyMcp(servers, ctx) {
    return applyJsonMcp(
      'windsurf',
      this.mcpPath() ?? providerPath('.codeium', 'windsurf', 'mcp_config.json'),
      servers,
      ctx,
    );
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readJsonMcpServerNames(mcpPath));
  },
};
