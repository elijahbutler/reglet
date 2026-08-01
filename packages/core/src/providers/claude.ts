import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';
export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  documentationUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'markdown',
      matcher: 'exact',
      pattern: '.claude/CLAUDE.md',
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.claude/skills',
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'claude-user-settings',
      matcher: 'exact',
      pattern: '.claude.json',
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'claude-markdown',
      matcher: 'basename',
      pattern: 'CLAUDE.md',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'project',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.claude/skills',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'project',
      format: 'mcp-json',
      matcher: 'exact',
      pattern: '.mcp.json',
      rootOnly: true,
      supported: true,
    },
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'claude/instructions', expectedSchemaVersion: 2 },
    { capability: 'skills', fixture: 'shared/skill', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'claude/mcp', expectedSchemaVersion: 2 },
  ],
  detect: () => detectDir('.claude'),
  rulesPath: () => providerPath('.claude', 'CLAUDE.md'),
  skillsDir: () => providerPath('.claude', 'skills'),
  mcpPath: () => providerPath('.claude.json'),
  applyMcp(servers, ctx) {
    return applyJsonMcp('claude', this.mcpPath() ?? providerPath('.claude.json'), servers, ctx);
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readJsonMcpServerNames(mcpPath));
  },
};
