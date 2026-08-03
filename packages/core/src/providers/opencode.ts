import { detectDir, inventoryFor, providerPathAt } from './common.js';
import { applyOpenCodeMcp, readOpenCodeMcpServerNames } from './opencode-mcp.js';
import type { ProviderAdapter } from './types.js';
export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  documentationUrl: 'https://opencode.ai/docs/skills',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'agents-markdown',
      matcher: 'exact',
      pattern: '.config/opencode/AGENTS.md',
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.config/opencode/skills',
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'opencode-json',
      matcher: 'exact',
      pattern: '.config/opencode/opencode.json',
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
      kind: 'instruction',
      scope: 'project',
      format: 'claude-markdown-fallback',
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
      pattern: '.opencode/skills',
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
      format: 'opencode-json',
      matcher: 'basename',
      pattern: 'opencode.json',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'project',
      format: 'opencode-jsonc',
      matcher: 'basename',
      pattern: 'opencode.jsonc',
      hierarchical: true,
      supported: true,
    },
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'opencode/instructions', expectedSchemaVersion: 2 },
    { capability: 'skills', fixture: 'opencode/skill-discovery', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'opencode/mcp', expectedSchemaVersion: 2 },
  ],
  detect: () => detectDir('.config', 'opencode'),
  rulesPath: (root) => providerPathAt(root, '.config', 'opencode', 'AGENTS.md'),
  skillsDir: (root) => providerPathAt(root, '.config', 'opencode', 'skills'),
  mcpPath: (root) => providerPathAt(root, '.config', 'opencode', 'opencode.json'),
  applyMcp(servers, ctx) {
    return applyOpenCodeMcp(
      this.mcpPath(ctx.providerHome) ?? providerPathAt(ctx.providerHome, '.config', 'opencode', 'opencode.json'),
      servers,
      ctx,
    );
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readOpenCodeMcpServerNames(mcpPath));
  },
};
