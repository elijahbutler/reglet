import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  ManagerApp,
  ManagerTransportError,
  type ManagerCommandOptions,
  type ManagerCommandResult,
  type ManagerHostActions,
} from '@reglet/manager-ui';
import type {
  ManagerProtocolOperation,
  ManagerRpcInputs,
} from '@reglet/manager-protocol';
import { FixtureManagerClient, managerFixtureSnapshot } from '@reglet/manager-ui/testing';

describe('shared Manager workbench', () => {
  test('renders the dense library and every primary workflow from the same client contract', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} />);

    expect(await screen.findByRole('navigation', { name: 'Manager destinations' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'One source of truth, with every provider accounted for' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(await screen.findByRole('textbox', { name: 'General agent instructions content' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project Inbox' }));
    expect(await screen.findByText('Read-only discoveries')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Current location')).getByText('Project Inbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(await screen.findByRole('heading', { name: 'Content ownership' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('No operations recorded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Canonical library and local runtime status.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  }, 30_000);

  test('requires explicit acknowledgement before promoting an executable project skill', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.projectInbox = {
      roots: [{
        id: 'fixture-project-root',
        label: 'Fixture project',
        path: '/fixture/project',
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
      discoveries: [{
        id: 'fixture-executable-discovery',
        rootId: 'fixture-project-root',
        relativePath: '.agents/skills/reviewed-runner',
        kind: 'skill',
        sourceHash: 'fixture-project-skill-source',
        size: 256,
        recognizedBy: ['codex'],
        providerFormats: ['skill-directory'],
        scopeSummary: 'Project-scoped executable skill',
        state: 'new',
        changedSincePromotion: false,
        skillRisks: ['Executable file: scripts/run.sh'],
      }],
    };
    class ProjectPromotionClient extends FixtureManagerClient {
      promotedInput: ManagerRpcInputs['project.promote'] | undefined;

      override async command<Operation extends ManagerProtocolOperation>(
        operation: Operation,
        input?: ManagerRpcInputs[Operation],
        options?: ManagerCommandOptions,
      ): Promise<ManagerCommandResult> {
        if (operation === 'project.promotion-preview') {
          return {
            revision: snapshot.revision,
            changed: false,
            data: {
              kind: 'skill',
              sourceHash: 'fixture-project-skill-source',
              inspection: {
                revision: 'fixture-project-skill-revision',
                requiresExecutableConfirmation: true,
                promotionBlocked: false,
              },
              candidates: [],
            },
          };
        }
        if (operation === 'project.promote') {
          this.promotedInput = input as ManagerRpcInputs['project.promote'];
        }
        return super.command(operation, input, options);
      }
    }
    const client = new ProjectPromotionClient(snapshot);
    render(<ManagerApp client={client} initialDestination="projects" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Preview promotion' }));
    const promote = await screen.findByRole('button', { name: 'Promote reviewed' });
    const firstConfirmation = await screen.findByRole('checkbox', {
      name: /I reviewed the executable files in revision fixture-project-skill-revision/u,
    });
    expect(firstConfirmation).not.toBeChecked();
    expect(promote).toBeDisabled();

    fireEvent.click(firstConfirmation);
    expect(promote).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview promotion' }));
    const resetConfirmation = await screen.findByRole('checkbox', {
      name: /I reviewed the executable files in revision fixture-project-skill-revision/u,
    });
    expect(resetConfirmation).not.toBeChecked();
    expect(promote).toBeDisabled();

    fireEvent.click(resetConfirmation);
    fireEvent.click(promote);
    await waitFor(() => expect(client.promotedInput).toMatchObject({
      discoveryId: 'fixture-executable-discovery',
      confirmedExecutableRevision: 'fixture-project-skill-revision',
    }));
  });

  test('discards a promotion preview after selecting another discovery', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.projectInbox = {
      roots: [{
        id: 'fixture-project-root',
        label: 'Fixture project',
        path: '/fixture/project',
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
      discoveries: [{
        id: 'fixture-slow-discovery',
        rootId: 'fixture-project-root',
        relativePath: '.agents/skills/slow-runner',
        kind: 'skill',
        sourceHash: 'fixture-slow-source',
        size: 256,
        recognizedBy: ['codex'],
        providerFormats: ['skill-directory'],
        scopeSummary: 'First project skill',
        state: 'new',
        changedSincePromotion: false,
        skillRisks: ['Executable file: scripts/run.sh'],
      }, {
        id: 'fixture-current-discovery',
        rootId: 'fixture-project-root',
        relativePath: '.agents/skills/current-runner',
        kind: 'skill',
        sourceHash: 'fixture-current-source',
        size: 128,
        recognizedBy: ['claude'],
        providerFormats: ['skill-directory'],
        scopeSummary: 'Current project skill',
        state: 'new',
        changedSincePromotion: false,
        skillRisks: [],
      }],
    };
    let resolvePreview: ((result: ManagerCommandResult) => void) | undefined;
    const pendingPreview = new Promise<ManagerCommandResult>((resolve) => {
      resolvePreview = resolve;
    });
    class DeferredProjectPromotionClient extends FixtureManagerClient {
      previewRequests = 0;

      override async command<Operation extends ManagerProtocolOperation>(
        operation: Operation,
        input?: ManagerRpcInputs[Operation],
        options?: ManagerCommandOptions,
      ): Promise<ManagerCommandResult> {
        if (operation === 'project.promotion-preview') {
          this.previewRequests += 1;
          return pendingPreview;
        }
        return super.command(operation, input, options);
      }
    }
    const client = new DeferredProjectPromotionClient(snapshot);
    render(<ManagerApp client={client} initialDestination="projects" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Preview promotion' }));
    expect(client.previewRequests).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /\.agents\/skills\/current-runner/u }));
    expect(await screen.findByRole('heading', { name: '.agents/skills/current-runner' })).toBeInTheDocument();

    if (resolvePreview === undefined) throw new Error('Deferred project preview was not requested.');
    await act(async () => {
      resolvePreview?.({
        revision: snapshot.revision,
        changed: false,
        data: {
          kind: 'skill',
          sourceHash: 'fixture-slow-source',
          inspection: {
            revision: 'fixture-stale-executable-revision',
            requiresExecutableConfirmation: true,
            promotionBlocked: false,
          },
          candidates: [],
        },
      });
      await pendingPreview;
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview promotion' })).toBeEnabled());
    expect(screen.queryByText('fixture-stale-executable-revision')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proposed canonical artifact' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote reviewed' })).toBeDisabled();
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
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} initialDestination="library" />);

    expect(await screen.findByRole('button', { name: 'Global 9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Codex machine override')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Provider-specific 1' }));
    expect((await screen.findAllByText('Codex machine override')).length).toBeGreaterThan(0);
  });

  test('keeps the Library editor mounted while switching narrow-window panels', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} initialDestination="library" />);

    const panels = await screen.findByRole('navigation', { name: 'Library panels' });
    expect(within(panels).getByRole('button', { name: 'Library' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panels).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Artifact editor')).toHaveClass('rg-library-mobile-pane--active');
    const editor = await screen.findByRole('textbox', { name: 'General agent instructions content' });
    fireEvent.click(within(panels).getByRole('button', { name: 'Details' }));
    expect(screen.getByLabelText('Projection inspector')).toHaveClass('rg-library-mobile-pane--active');
    expect(editor).toBeInTheDocument();
    fireEvent.click(within(panels).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'General agent instructions content' })).toBe(editor);
  });

  test('routes an executable skill block to revision-specific approval', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    const source = snapshot.library.artifacts[0];
    if (source === undefined) throw new Error('Fixture needs a source artifact.');
    snapshot.library.artifacts = [{
      ...source,
      metadata: {
        ...source.metadata,
        id: 'artifact-impeccable',
        kind: 'skill',
        slug: 'impeccable',
        title: 'Impeccable',
        targets: ['codex'],
        locator: { type: 'directory', path: 'skills/impeccable' },
      },
      projections: [],
    }];
    snapshot.library.counts = { active: 1, archived: 0, drafts: 0 };
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} initialDestination="library" />);

    const trigger = (await screen.findAllByRole('button', { name: 'Review changes' }))[0];
    if (trigger === undefined) throw new Error('Review trigger is missing.');
    fireEvent.click(trigger);
    expect(await screen.findByText(/Executable skill reglet-skill has not been approved/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review executable skills' }));

    expect(await screen.findByRole('heading', { name: 'Executable skills' })).toBeInTheDocument();
    expect(screen.getByText(/Reglet inventories and copies these files/u)).toBeInTheDocument();
    expect(await screen.findByText('scripts/check.mjs')).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve this revision' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the executable files in revision/u }));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  test('reviews exact provider operations, confirms drift, and applies the selected batch', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} initialDestination="library" />);

    const trigger = (await screen.findAllByRole('button', { name: 'Review changes' }))[0];
    if (trigger === undefined) throw new Error('Review trigger is missing.');
    fireEvent.click(trigger);

    expect(await screen.findByRole('heading', { name: 'Review and apply' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Manager destinations' })).not.toBeInTheDocument();
    expect(screen.getByText('The OpenCode target directory is not writable.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Exact unified diff for ~\/.claude\/CLAUDE.md/u })).toHaveTextContent('Use the canonical Reglet library.');

    const apply = screen.getByRole('button', { name: 'Apply 3 ready units' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand that Apply will replace/u }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    expect(await screen.findByRole('heading', { name: 'Provider files are updated' })).toBeInTheDocument();
    expect(screen.getByText('3 applied, 0 blocked, 0 failed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const restoredTrigger = (await screen.findAllByRole('button', { name: 'Review changes' }))[0];
    await waitFor(() => expect(restoredTrigger).toHaveFocus());
  });

  test('ends an unconfirmed Apply state and requires a fresh review before retrying', async () => {
    class TimedOutApplyClient extends FixtureManagerClient {
      override async command<Operation extends ManagerProtocolOperation>(
        operation: Operation,
        input?: ManagerRpcInputs[Operation],
        options?: ManagerCommandOptions,
      ): Promise<ManagerCommandResult> {
        if (operation === 'provider.apply') {
          throw new ManagerTransportError(
            0,
            'REQUEST_TIMEOUT',
            'Manager runtime did not answer within 30 seconds.',
            true,
          );
        }
        return super.command(operation, input, options);
      }
    }
    render(<ManagerApp client={new TimedOutApplyClient()} initialDestination="library" />);

    const trigger = (await screen.findAllByRole('button', { name: 'Review changes' }))[0];
    if (trigger === undefined) throw new Error('Review trigger is missing.');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand that Apply will replace/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 3 ready units' }));

    expect(await screen.findByText(/could not confirm whether the batch completed/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh before retrying' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
    expect(await screen.findByRole('button', { name: 'Apply 3 ready units' })).toBeDisabled();
  });

  test('adopts one exact unmanaged provider source without rewriting it', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    const codex = snapshot.providers.find((provider) => provider.id === 'codex');
    if (codex === undefined) throw new Error('Fixture needs the Codex provider.');
    codex.sources = [{
      provider: 'codex',
      content: 'rules',
      path: '~/.codex/AGENTS.md',
      exists: true,
      readable: true,
      ownership: 'unmanaged',
      items: [{ id: 'codex-rules', label: 'AGENTS.md', ownership: 'unmanaged' }],
      issues: [],
    }];
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} initialDestination="providers" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Codex' }));
    expect((await screen.findAllByText('Unmanaged')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adopt AGENTS.md' });
    expect(within(dialog).getByRole('radio', { name: /Provider-specific/u })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review adoption' }));
    expect(await within(dialog).findByText('Imported provider instructions')).toBeInTheDocument();
    expect(within(dialog).getByText('~/.codex/AGENTS.md')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adopt into library' }));
    expect(await within(dialog).findByText('Canonical artifact created')).toBeInTheDocument();
    expect(within(dialog).getByText(/provider source was left unchanged/u)).toBeInTheDocument();
  });

  test('reviews exact recovery targets and creates an undo receipt', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} initialDestination="activity" />);

    fireEvent.click(within(await screen.findByRole('group', { name: 'Activity view' })).getByRole('button', { name: 'Recovery' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review recovery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review exact recovery' });
    expect(await within(dialog).findByText('~/.claude/CLAUDE.md')).toBeInTheDocument();
    expect(within(dialog).getByText('This restores prior target contents. It does not rerun the original provider operation.')).toBeInTheDocument();
    const restore = within(dialog).getByRole('button', { name: 'Restore 1 targets' });
    expect(restore).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I reviewed every target/u }));
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    expect(await within(dialog).findByText('1 target restored')).toBeInTheDocument();
    expect(within(dialog).getByText('fixture-recovery-undo')).toBeInTheDocument();
  });

  test('compares both encrypted versions before resolving a sync conflict', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.settings.sync = {
      enabled: true,
      phase: 'active',
      state: 'conflict',
      conflictCount: 1,
      conflicts: ['rules/00-general.md'],
      lastError: { occurredAt: '2026-08-19T17:00:00.000Z', message: 'Server temporarily unavailable.' },
    };
    render(<ManagerApp client={new FixtureManagerClient(snapshot)} initialDestination="settings" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync & devices' }));
    expect(await screen.findByText('Server temporarily unavailable.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Review conflict' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose the canonical version' });
    expect(await within(dialog).findByText('# Local canonical instructions')).toBeInTheDocument();
    expect(within(dialog).getByText('# Remote canonical instructions')).toBeInTheDocument();
    const resolve = within(dialog).getByRole('button', { name: 'Use selected version' });
    expect(resolve).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Use remote version/u }));
    expect(resolve).toBeEnabled();
    fireEvent.click(resolve);
    expect(await within(dialog).findByText('Conflict resolved')).toBeInTheDocument();
    expect(within(dialog).getByText('The encrypted remote version is now canonical on this device. Provider files were not changed.')).toBeInTheDocument();
  });

  test('keeps modal focus contained and returns it to the command trigger', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} initialDestination="library" />);

    const trigger = await screen.findByRole('button', { name: 'Search or run a command' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const search = within(dialog).getByPlaceholderText('Search commands…');
    await waitFor(() => expect(search).toHaveFocus());
    const background = document.querySelector('main');
    if (!(background instanceof HTMLElement)) throw new Error('Manager background is missing.');
    const supportsInert = Reflect.has(background, 'inert');
    if (supportsInert) {
      expect(background).toHaveProperty('inert', true);
    } else {
      expect(background).toHaveAttribute('aria-hidden', 'true');
      expect(background).toHaveStyle({ pointerEvents: 'none' });
    }

    const lastCommand = within(dialog).getByRole('button', { name: 'Open Settings' });
    lastCommand.focus();
    fireEvent.keyDown(lastCommand, { key: 'Tab' });
    expect(search).toHaveFocus();

    trigger.focus();
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    if (supportsInert) {
      expect(background).toHaveProperty('inert', false);
    } else {
      expect(background).not.toHaveAttribute('aria-hidden');
      expect(background.style.pointerEvents).toBe('');
    }
  });

  test('runs truthful global shortcuts without hijacking editor input', async () => {
    render(<ManagerApp client={new FixtureManagerClient()} initialDestination="library" />);

    const editor = await screen.findByRole('textbox', { name: 'General agent instructions content' });
    const artifactSearch = screen.getByRole('textbox', { name: 'Search artifacts' });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(artifactSearch).toHaveFocus();

    editor.focus();
    fireEvent.keyDown(editor, { key: 'n', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'New artifact' })).not.toBeInTheDocument();

    artifactSearch.blur();
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'New artifact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filter artifacts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editor actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspector options' })).not.toBeInTheDocument();
  });

  test('keeps initial sync visible until the first exchange completes', async () => {
    const snapshot = structuredClone(managerFixtureSnapshot);
    snapshot.settings.sync = { enabled: true, phase: 'active', state: 'idle', conflictCount: 0, conflicts: [] };
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
