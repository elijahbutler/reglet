import { detectDir, inventoryFor, providerPath } from './common.js';
import type { ProviderAdapter } from './types.js';

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  detect: () => detectDir('.cursor'),
  rulesPath: () => null,
  skillsDir: () => providerPath('.cursor', 'skills'),
  mcpPath: () => providerPath('.cursor', 'mcp.json'),
  applyMcp: () => null,
  inventory() {
    return inventoryFor(this.rulesPath(), this.skillsDir(), this.mcpPath(), []);
  },
};
