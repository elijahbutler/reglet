import { detectDir, inventoryFor, providerPath } from './common.js';
import type { ProviderAdapter } from './types.js';

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: 'Codex',
  detect: () => detectDir('.codex'),
  rulesPath: () => providerPath('.codex', 'AGENTS.md'),
  skillsDir: () => providerPath('.agents', 'skills'),
  mcpPath: () => providerPath('.codex', 'config.toml'),
  applyMcp: () => null,
  inventory() {
    return inventoryFor(this.rulesPath(), this.skillsDir(), this.mcpPath(), []);
  },
};
