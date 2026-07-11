import { providerNames } from '../config.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { geminiAdapter } from './gemini.js';
import { opencodeAdapter } from './opencode.js';
import type { ProviderAdapter, ProviderId } from './types.js';
import { windsurfAdapter } from './windsurf.js';

const adapters: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  windsurf: windsurfAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(id: ProviderId): ProviderAdapter {
  return adapters[id];
}

export function allAdapters(): ProviderAdapter[] {
  return providerNames.map((name) => adapters[name]);
}
