import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ManagerApp } from '@reglet/manager-ui';
import type { ManagerHostActions } from '@reglet/manager-ui';
import { FixtureManagerClient, managerFixtureSnapshot } from '@reglet/manager-ui/testing';

describe('shared Manager workbench', () => {
  test('renders the dense library and every primary workflow from the same client contract', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} />);

    expect(await screen.findByRole('navigation', { name: 'Manager destinations' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'General agent instructions content' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project Inbox' }));
    expect(await screen.findByText('Read-only discoveries')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Current location')).getByText('Project Inbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(await screen.findByText('Adapter registry')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('No operations recorded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Canonical library and local runtime status.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  test('starts with the global library and reveals provider-specific artifacts on demand', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    const source = snapshot.library.artifacts[0];
    if (source === undefined) throw new Error('Fixture needs a source artifact.');
    snapshot.library.artifacts.push({
      ...structuredClone(source),
      metadata: {
        ...structuredClone(source.metadata),
        id: 'artifact-codex-overlay',
        title: 'Codex machine override',
        slug: 'codex-machine-override',
        scope: { kind: 'provider-overlay', provider: 'codex' },
      },
    });
    snapshot.library.counts.active += 1;
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} />);

    expect(await screen.findByRole('tab', { name: 'Global 9' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Codex machine override')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Provider-specific 1' }));
    expect((await screen.findAllByText('Codex machine override')).length).toBeGreaterThan(0);
  });

  test('keeps initial sync visible until the first exchange completes', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.settings.sync = { enabled: true, state: 'idle', conflictCount: 0 };
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} />);

    expect(await screen.findByRole('status')).toHaveTextContent('Initial sync required');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  test('guides first-run machine, global library, and connection setup', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.settings.setup.completed = false;
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} />);

    expect(await screen.findByRole('dialog', { name: 'Set up this machine' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Create your global defaults' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Connect your library anywhere' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('blocks legacy content behind explicit reviewed migration onboarding', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.library.migration = { status: 'available', legacyArtifacts: 9 };
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} />);

    expect(await screen.findByRole('dialog', { name: 'Review your canonical library' })).toBeInTheDocument();
    expect(screen.getByText('Provider writes')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Approve 9 artifacts' })).toBeEnabled();
  });

  test('checks, downloads, and installs a signed update from Settings', async () => {
    const installUpdate = vi.fn<NonNullable<ManagerHostActions['installUpdate']>>(async (onProgress) => {
      onProgress({ event: 'started', contentLength: 4096 });
      onProgress({ event: 'progress', chunkLength: 2048 });
      onProgress({ event: 'finished' });
    });
    const hostActions: ManagerHostActions = {
      checkForUpdates: vi.fn(async () => ({
        status: 'available' as const,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        notes: 'Improves desktop update reliability.',
      })),
      installUpdate,
    };
    render(<ManagerApp client={new FixtureManagerClient()} hostActions={hostActions} initialDestination="settings" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Reglet 1.1.0 is ready')).toBeInTheDocument();
    expect(screen.getByText('Improves desktop update reliability.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
    expect(screen.getByText('Installing verified update…')).toBeInTheDocument();
  });

  test('explains local builds without an update key and keeps check failures recoverable', async () => {
    const disabledActions: ManagerHostActions = {
      checkForUpdates: vi.fn(async () => ({ status: 'disabled' as const, currentVersion: '1.0.0', reason: 'This build has no embedded update verification key.' })),
    };
    const view = render(<ManagerApp client={new FixtureManagerClient()} hostActions={disabledActions} initialDestination="settings" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Automatic updates are unavailable in this build')).toBeInTheDocument();
    view.unmount();

    const failingActions: ManagerHostActions = {
      checkForUpdates: vi.fn(async () => Promise.reject({ message: 'The release service is unreachable.' })),
    };
    render(<ManagerApp client={new FixtureManagerClient()} hostActions={failingActions} initialDestination="settings" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Update interrupted')).toBeInTheDocument();
    expect(screen.getByText('The release service is unreachable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  });
});
