import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SyncDiffsView } from '@reglet/manager-ui';
import { FixtureManagerClient, managerFixtureSnapshot } from '@reglet/manager-ui/testing';
import type { ManagerProtocolOperation, ManagerRpcInputs } from '@reglet/manager-protocol';

describe('SyncDiffsView', () => {
  test('renders the sync cockpit banner, vault revision, and changed units', async () => {
    const client = new FixtureManagerClient();
    const onRefresh = vi.fn(async () => {});

    render(
      <SyncDiffsView
        client={client}
        snapshot={managerFixtureSnapshot}
        commandModifier="⌘"
        onRefresh={onRefresh}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Sync & Diff Cockpit' })).toBeInTheDocument();
    expect(screen.getByText(/Vault: rev/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync Now/i })).toBeInTheDocument();

    // Changed / review unit rendered in the list
    expect(await screen.findByText(/claude • rules/i)).toBeInTheDocument();
  });

  test('triggers sync now and reloads review', async () => {
    class TrackingClient extends FixtureManagerClient {
      syncCalls = 0;
      override async command<Operation extends ManagerProtocolOperation>(
        operation: Operation,
        input?: ManagerRpcInputs[Operation],
        options?: import('@reglet/manager-ui').ManagerCommandOptions,
      ) {
        if (operation === 'sync.now') {
          this.syncCalls += 1;
        }
        return super.command(operation, input, options);
      }
    }

    const client = new TrackingClient();
    const onRefresh = vi.fn(async () => {});

    render(
      <SyncDiffsView
        client={client}
        snapshot={managerFixtureSnapshot}
        commandModifier="⌘"
        onRefresh={onRefresh}
      />,
    );

    const syncButton = await screen.findByRole('button', { name: /Sync Now/i });
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(client.syncCalls).toBe(1);
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  test('enables Apply after checking drift confirmation when drift is detected', async () => {
    const client = new FixtureManagerClient();
    const onRefresh = vi.fn(async () => {});

    render(
      <SyncDiffsView
        client={client}
        snapshot={managerFixtureSnapshot}
        commandModifier="⌘"
        onRefresh={onRefresh}
      />,
    );

    expect(await screen.findByText(/claude • rules/i)).toBeInTheDocument();

    // Check drift acknowledgment checkbox
    const checkbox = await screen.findByRole('checkbox', {
      name: /I understand that Apply will replace external edits made on disk/i,
    });
    expect(checkbox).not.toBeChecked();

    const applyButton = screen.getByRole('button', { name: /Apply Reviewed Changes/i });
    expect(applyButton).toBeDisabled();

    fireEvent.click(checkbox);
    expect(applyButton).toBeEnabled();

    fireEvent.click(applyButton);
    expect(await screen.findByText(/Successfully applied/i)).toBeInTheDocument();
  });

  test('preserves user deselection when switching active unit', async () => {
    const client = new FixtureManagerClient();
    const onRefresh = vi.fn(async () => {});

    render(
      <SyncDiffsView
        client={client}
        snapshot={managerFixtureSnapshot}
        commandModifier="⌘"
        onRefresh={onRefresh}
      />,
    );

    expect(await screen.findByText(/claude • rules/i)).toBeInTheDocument();
    expect(screen.getByText(/cursor • rules/i)).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    const firstCheckbox = checkboxes[0];
    expect(firstCheckbox).toBeDefined();
    if (!firstCheckbox) throw new Error('Expected at least one checkbox');
    expect(firstCheckbox).toBeChecked();

    // Deselect first unit
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).not.toBeChecked();

    // Click on another unit card to activate it
    const otherUnit = screen.getByText(/cursor • rules/i);
    fireEvent.click(otherUnit);

    // Verify first unit checkbox is still unchecked
    expect(firstCheckbox).not.toBeChecked();
  });
});
