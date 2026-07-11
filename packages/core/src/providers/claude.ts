import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
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
