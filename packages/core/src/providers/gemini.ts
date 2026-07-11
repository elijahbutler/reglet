import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
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
