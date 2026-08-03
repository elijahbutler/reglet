import { Channel, invoke } from '@tauri-apps/api/core';
import type { ManagerHostActions, ManagerUpdateDownloadEvent, ManagerUpdateStatus } from '@reglet/manager-ui';

export const desktopHostActions: ManagerHostActions = {
  async checkForUpdates() {
    return parseUpdateStatus(await invoke<unknown>('check_for_updates'));
  },
  async installUpdate(onProgress) {
    const onEvent = new Channel<unknown>((value) => onProgress(parseUpdateDownloadEvent(value)));
    await invoke('install_update', { onEvent });
  },
};

export function parseUpdateStatus(value: unknown): ManagerUpdateStatus {
  if (!isRecord(value) || typeof value.status !== 'string') return invalidUpdateResponse();
  if (value.status === 'disabled' && hasExactlyKeys(value, ['status', 'currentVersion', 'reason']) && typeof value.currentVersion === 'string' && typeof value.reason === 'string') {
    return { status: 'disabled', currentVersion: value.currentVersion, reason: value.reason };
  }
  if (value.status === 'current' && hasExactlyKeys(value, ['status', 'currentVersion']) && typeof value.currentVersion === 'string') {
    return { status: 'current', currentVersion: value.currentVersion };
  }
  if (value.status === 'available' && hasExactlyKeys(value, ['status', 'currentVersion', 'latestVersion', 'notes']) && typeof value.currentVersion === 'string' && typeof value.latestVersion === 'string' && (typeof value.notes === 'string' || value.notes === null)) {
    return { status: 'available', currentVersion: value.currentVersion, latestVersion: value.latestVersion, notes: value.notes };
  }
  return invalidUpdateResponse();
}

export function parseUpdateDownloadEvent(value: unknown): ManagerUpdateDownloadEvent {
  if (!isRecord(value) || typeof value.event !== 'string') return invalidUpdateEvent();
  if (value.event === 'started' && hasExactlyKeys(value, ['event', 'contentLength']) && (isNonNegativeInteger(value.contentLength) || value.contentLength === null)) {
    return { event: 'started', contentLength: value.contentLength };
  }
  if (value.event === 'progress' && hasExactlyKeys(value, ['event', 'chunkLength']) && isNonNegativeInteger(value.chunkLength)) {
    return { event: 'progress', chunkLength: value.chunkLength };
  }
  if (value.event === 'finished' && hasExactlyKeys(value, ['event'])) return { event: 'finished' };
  return invalidUpdateEvent();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalidUpdateResponse(): never {
  throw new Error('The desktop updater returned an invalid response.');
}

function invalidUpdateEvent(): never {
  throw new Error('The desktop updater returned an invalid progress event.');
}
