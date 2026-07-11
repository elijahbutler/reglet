import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyCodexMcp, readCodexMcpServerNames } from './codex-mcp.js';
import type { ProviderAdapter } from './types.js';

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: 'Codex',
  detect: () => detectDir('.codex'),
  rulesPath: () => providerPath('.codex', 'AGENTS.md'),
  skillsDir: () => providerPath('.agents', 'skills'),
  mcpPath: () => providerPath('.codex', 'config.toml'),
  applyMcp(servers, ctx) {
    return applyCodexMcp(this.mcpPath() ?? providerPath('.codex', 'config.toml'), servers, ctx);
  },
  async inventory() {
    const mcpPath = this.mcpPath();
    return inventoryFor(this.rulesPath(), this.skillsDir(), mcpPath, await readCodexMcpServerNames(mcpPath));
  },
};
