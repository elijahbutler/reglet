import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
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
