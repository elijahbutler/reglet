import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ManagerProtocolOperation, SyncSnapshot } from '@reglet/manager-protocol';
import type { ManagerBridge } from '../../managerBridge.js';
import { SyncView } from './SyncView.js';

describe('encrypted sync view', () => {
  test('makes no lifecycle request before explicit preview acknowledgement', async () => {
    const rpc = vi.fn().mockImplementation(async (operation: ManagerProtocolOperation) => {
      if (operation === 'sync.snapshot') return disabledSnapshot();
      if (operation === 'sync.preview.set') return disconnectedSnapshot();
      throw new Error(`unexpected operation: ${operation}`);
    });
    renderView(bridge(rpc));

    expect(await screen.findByRole('heading', { name: 'Encrypted Sync' })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith('sync.snapshot', {});
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enable encrypted sync' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('sync.preview.set', { acknowledged: true }));
  });

  test('starts and tears down pending polling with the visible view', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const rpc = vi.fn().mockImplementation(async (operation: ManagerProtocolOperation) => {
      if (operation === 'sync.snapshot') return pendingSnapshot();
      if (operation === 'sync.pair.status') return pendingSnapshot().pending ?? {};
      throw new Error(`unexpected operation: ${operation}`);
    });
    const view = renderView(bridge(rpc));
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalled());
    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  test('recovers an approved first-device connection after invitation expiry', async () => {
    let snapshotCalls = 0;
    const rpc = vi.fn().mockImplementation(async (operation: ManagerProtocolOperation) => {
      if (operation === 'sync.snapshot') return snapshotCalls++ === 0 ? expiredBootstrapSnapshot() : connectedSnapshot();
      if (operation === 'sync.pair.status') return { ...expiredBootstrapSnapshot().pending, status: 'approved' };
      if (operation === 'sync.pair.complete') return connectedSnapshot();
      throw new Error(`unexpected operation: ${operation}`);
    });
    renderView(bridge(rpc));

    expect(await screen.findByText('Approval received')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /fingerprint matches/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish connection' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('sync.pair.complete', {
      fingerprint: expiredBootstrapSnapshot().pending?.fingerprint,
    }));
    expect(await screen.findByText('sync.example')).toBeInTheDocument();
  });

  test('requires destructive confirmation before disconnecting', async () => {
    const rpc = vi.fn().mockImplementation(async (operation: ManagerProtocolOperation) => {
      if (operation === 'sync.snapshot') return connectedSnapshot();
      if (operation === 'sync.disconnect') return disconnectedSnapshot();
      throw new Error(`unexpected operation: ${operation}`);
    });
    renderView(bridge(rpc));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(rpc).not.toHaveBeenCalledWith('sync.disconnect', expect.anything());
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('revoke this device on the server');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('sync.disconnect', { localOnly: false }));
  });

  test('refreshes cleared local state when remote cancellation fails', async () => {
    let snapshotCalls = 0;
    const rpc = vi.fn().mockImplementation(async (operation: ManagerProtocolOperation) => {
      if (operation === 'sync.snapshot') return snapshotCalls++ === 0 ? pendingSnapshot() : disconnectedSnapshot();
      if (operation === 'sync.pair.status') return pendingSnapshot().pending ?? {};
      if (operation === 'sync.pair.cancel') throw new Error('Sync server is offline.');
      throw new Error(`unexpected operation: ${operation}`);
    });
    renderView(bridge(rpc));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel request' }));

    expect(await screen.findByText('Sync server is offline.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Invitation link' })).toBeInTheDocument();
    expect(snapshotCalls).toBe(2);
  });
});

function renderView(syncBridge: ManagerBridge) {
  return render(<SyncView bridge={syncBridge} incomingLink={null} onConsumedLink={() => undefined} onReview={() => undefined} />);
}

function bridge(rpcMock: ReturnType<typeof vi.fn>): ManagerBridge {
  return {
    rpc: rpcMock as ManagerBridge['rpc'],
    snapshot: vi.fn(),
    checkForUpdates: vi.fn(),
    openRelease: vi.fn(),
    openFileLocation: vi.fn(),
  };
}

function disabledSnapshot(): SyncSnapshot {
  return baseSnapshot({ previewAcknowledged: false, phase: 'disabled' });
}

function disconnectedSnapshot(): SyncSnapshot {
  return baseSnapshot({ phase: 'disconnected' });
}

function pendingSnapshot(): SyncSnapshot {
  return baseSnapshot({
    phase: 'pending',
    serverUrl: 'https://sync.example',
    serverHost: 'sync.example',
    currentDeviceId: 'device-new',
    currentDeviceName: 'Mac',
    pending: {
      method: 'pair',
      status: 'pending',
      deviceName: 'Mac',
      code: 'AB12CD34',
      fingerprint: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  });
}

function expiredBootstrapSnapshot(): SyncSnapshot {
  return baseSnapshot({
    phase: 'pending',
    serverUrl: 'https://sync.example',
    serverHost: 'sync.example',
    currentDeviceId: 'device-new',
    currentDeviceName: 'Mac',
    pending: {
      method: 'bootstrap',
      status: 'pending',
      deviceName: 'Mac',
      code: null,
      fingerprint: '1111 2222 3333 4444',
      expiresAt: '2020-01-01T00:00:00.000Z',
    },
  });
}

function connectedSnapshot(): SyncSnapshot {
  return baseSnapshot({
    phase: 'connected',
    serverUrl: 'https://sync.example',
    serverHost: 'sync.example',
    compatibility: 'compatible',
    currentDeviceId: 'device-1',
    currentDeviceName: 'Mac',
    devices: [{
      id: 'device-1',
      name: 'Mac',
      current: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      revokedAt: null,
    }],
  });
}

function baseSnapshot(overrides: Partial<SyncSnapshot>): SyncSnapshot {
  return {
    version: 1,
    previewAcknowledged: true,
    phase: 'disconnected',
    serverUrl: null,
    serverHost: null,
    compatibility: 'unknown',
    currentDeviceId: null,
    currentDeviceName: null,
    pending: null,
    devices: [],
    lastSync: null,
    keyRotationRequired: false,
    ...overrides,
  };
}
