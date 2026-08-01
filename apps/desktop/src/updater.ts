import { invoke } from '@tauri-apps/api/core';
import type { ManagerHostActions, ManagerUpdateStatus } from '@reglet/manager-ui';

export const desktopHostActions: ManagerHostActions = {
  async checkForUpdates() {
    return parseUpdateStatus(await invoke<unknown>('check_for_updates'));
  },
  async openRelease() {
    await invoke('open_release');
  },
};

export function parseUpdateStatus(value: unknown): ManagerUpdateStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, ['currentVersion', 'latestVersion', 'available', 'releaseUrl']) ||
    typeof value.currentVersion !== 'string' || typeof value.latestVersion !== 'string' ||
    typeof value.available !== 'boolean' || typeof value.releaseUrl !== 'string' ||
    !value.releaseUrl.startsWith('https://github.com/elijahbutler/reglet/releases/')) {
    throw new Error('The desktop updater returned an invalid response.');
  }
  return {
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    available: value.available,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}
