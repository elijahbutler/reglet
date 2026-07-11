import { detectDir, inventoryFor, providerPath } from './common.js';
import { applyJsonMcp, readJsonMcpServerNames } from './json-mcp.js';
import type { ProviderAdapter } from './types.js';

export const windsurfAdapter: ProviderAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
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
