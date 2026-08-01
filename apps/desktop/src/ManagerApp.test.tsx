import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ManagerApp } from '@reglet/manager-ui';
import { FixtureManagerClient, managerFixtureSnapshot } from '@reglet/manager-ui/testing';

describe('shared Manager workbench', () => {
  test('renders the dense library and every primary workflow from the same client contract', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} />);

    expect(await screen.findByRole('navigation', { name: 'Manager destinations' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'General agent instructions content' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project Inbox' }));
    expect(await screen.findByText('Read-only discoveries')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(await screen.findByText('Adapter registry')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('No operations recorded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Canonical library and local runtime status.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  test('blocks legacy content behind explicit reviewed migration onboarding', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.library.migration = { status: 'available', legacyArtifacts: 9 };
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} />);

    expect(await screen.findByRole('dialog', { name: 'Review your canonical library' })).toBeInTheDocument();
    expect(screen.getByText('Provider writes')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Approve 9 artifacts' })).toBeEnabled();
  });
});
