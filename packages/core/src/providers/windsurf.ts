import { detectDir, inventoryFor, providerPath } from './common.js';
import type { ProviderAdapter } from './types.js';

export const windsurfAdapter: ProviderAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
  detect: () => detectDir('.codeium', 'windsurf'),
  rulesPath: () => providerPath('.codeium', 'windsurf', 'memories', 'global_rules.md'),
  skillsDir: () => null,
  mcpPath: () => providerPath('.codeium', 'windsurf', 'mcp_config.json'),
  applyMcp: () => null,
  inventory() {
    return inventoryFor(this.rulesPath(), this.skillsDir(), this.mcpPath(), []);
  },
};
