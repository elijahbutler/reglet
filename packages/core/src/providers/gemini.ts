import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';
export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  documentationUrl: 'https://geminicli.com/docs/cli/gemini-md/',
  lastVerifiedAt: '2026-07-30',
  schemaVersion: 2,
  discoveries: [
    {
      kind: 'instruction',
      scope: 'global',
      format: 'gemini-markdown',
      matcher: 'exact',
      pattern: '.gemini/GEMINI.md',
      supported: true,
    },
    {
      kind: 'skill',
      scope: 'global',
      format: 'agent-skill',
      matcher: 'directory',
      pattern: '.gemini/skills',
      supported: true,
    },
    {
      kind: 'mcp',
      scope: 'global',
      format: 'gemini-settings',
      matcher: 'exact',
      pattern: '.gemini/settings.json',
      supported: true,
    },
    {
      kind: 'instruction',
      scope: 'project',
      format: 'gemini-markdown',
      matcher: 'basename',
      pattern: 'GEMINI.md',
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
      format: 'gemini-settings',
      matcher: 'exact',
      pattern: '.gemini/settings.json',
      rootOnly: true,
      supported: true,
    },
  ],
  compatibilityFixtures: [
    { capability: 'instructions', fixture: 'gemini/instructions', expectedSchemaVersion: 2 },
    { capability: 'skills', fixture: 'shared/skill', expectedSchemaVersion: 2 },
    { capability: 'mcp', fixture: 'gemini/mcp', expectedSchemaVersion: 2 },
  ],
  detect: () => detectDir('.gemini'),
  rulesPath: () => providerPath('.gemini', 'GEMINI.md'),
  skillsDir: () => providerPath('.gemini', 'skills'),
  mcpPath: () => providerPath('.gemini', 'settings.json'),
  applyMcp(servers, ctx) {
    return applyJsonMcp('gemini', this.mcpPath() ?? providerPath('.gemini', 'settings.json'), servers, ctx);
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readJsonMcpServerNames(mcpPath));
  },
};
