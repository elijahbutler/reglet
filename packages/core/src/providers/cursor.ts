import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';
export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  documentationUrl: 'https://docs.cursor.com/context/rules',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'cursor-user-settings',
      matcher: 'exact',
      pattern: '.cursor/user-rules',
      supported: false,
      issue: 'Cursor global user rules are settings-owned and not safely file-manageable.',
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.cursor/skills',
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'mcp-json',
      matcher: 'exact',
      pattern: '.cursor/mcp.json',
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'cursor-mdc',
      matcher: 'extension',
      pattern: '.cursor/rules/**/*.mdc',
      hierarchical: true,
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'cursor-legacy',
      matcher: 'exact',
      pattern: '.cursorrules',
      rootOnly: true,
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'agents-markdown',
      matcher: 'exact',
      pattern: 'AGENTS.md',
      rootOnly: true,
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'claude-markdown',
      matcher: 'exact',
      pattern: 'CLAUDE.md',
      rootOnly: true,
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'project',
      format: 'mcp-json',
      matcher: 'exact',
      pattern: '.cursor/mcp.json',
      rootOnly: true,
      supported: true,
    },
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'cursor/project-rules', expectedSchemaVersion: 2 },
    { capability: 'skills', fixture: 'shared/skill', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'cursor/mcp', expectedSchemaVersion: 2 },
  ],
  detect: () => detectDir('.cursor'),
  rulesPath: () => null,
  skillsDir: () => providerPath('.cursor', 'skills'),
  mcpPath: () => providerPath('.cursor', 'mcp.json'),
  applyMcp(servers, ctx) {
    return applyJsonMcp('cursor', this.mcpPath() ?? providerPath('.cursor', 'mcp.json'), servers, ctx);
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readJsonMcpServerNames(mcpPath));
  },
};
