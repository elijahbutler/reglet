import { detectDir, inventoryFor, providerPath } from './common.js';
import type { ProviderAdapter } from './types.js';

export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  detect: () => detectDir('.config', 'opencode'),
  rulesPath: () => providerPath('.config', 'opencode', 'AGENTS.md'),
  skillsDir: () => providerPath('.config', 'opencode', 'skills'),
  mcpPath: () => providerPath('.config', 'opencode', 'opencode.json'),
  applyMcp: () => null,
  inventory() {
    return inventoryFor(this.rulesPath(), this.skillsDir(), this.mcpPath(), []);
  },
};
