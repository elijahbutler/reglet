import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyOpenCodeMcp, readOpenCodeMcpServerNames } from './opencode-mcp.js';
import type { ProviderAdapter } from './types.js';

export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  detect: () => detectDir('.config', 'opencode'),
  rulesPath: () => providerPath('.config', 'opencode', 'AGENTS.md'),
  skillsDir: () => providerPath('.config', 'opencode', 'skills'),
  mcpPath: () => providerPath('.config', 'opencode', 'opencode.json'),
  applyMcp(servers, ctx) {
    return applyOpenCodeMcp(this.mcpPath() ?? providerPath('.config', 'opencode', 'opencode.json'), servers, ctx);
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readOpenCodeMcpServerNames(mcpPath));
  },
};
