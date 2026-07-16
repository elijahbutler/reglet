import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { JsonValue, ManagerProtocolOperation, ManagerRpcInputs, ManagerSnapshotV2 } from '@reglet/manager-protocol';
import { App } from './App.js';
import { snapshotFixture } from '../test/fixtures.js';
import type { ManagerBridge } from '../managerBridge.js';

describe('Reglet desktop app', () => {
  test('shows loading then snapshot summary', async () => {
    render(<App bridge={bridge(snapshotFixture())} />);
    expect(screen.getByText(/Loading Manager snapshot/)).toBeInTheDocument();
    expect(await screen.findByText('/tmp/reglet')).toBeInTheDocument();
  });

  test('renders empty drift and recovery states', async () => {
    render(<App bridge={bridge(snapshotFixture())} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity & Drift' }));
    expect(screen.getByText('No drift')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
    expect(screen.getByText('No receipts')).toBeInTheDocument();
  });

  test('renders blocked snapshot problems', async () => {
    render(<App bridge={bridge(snapshotFixture({ state: { state: 'blocked', reasons: ['requiredMcpEnvironmentMissing'] }, problems: [{ code: 'MISSING_MCP_ENVIRONMENT', severity: 'error', message: 'Missing env', recoverable: true }] }))} />);
    expect(await screen.findByText('blocked')).toBeInTheDocument();
  });

  test('renders drift import destructive confirmation', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockResolvedValue({ version: 1 });
    render(<App bridge={bridge(snapshotFixture({ driftInbox: [{ provider: 'claude', content: 'rules', outputPath: '/tmp/out', status: 'modified' }] }), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity & Drift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import drift' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Replace master rules with drift from claude');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import drift' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('import-drift', { provider: 'claude', content: 'rules' }));
  });

  test('blocks stale plan apply with visible warning', async () => {
    render(<App bridge={bridge(snapshotFixture({ problems: [{ code: 'STALE_PLAN', severity: 'error', message: 'Stale', recoverable: false }] }))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity & Drift' }));
    expect(screen.getByText(/stale plan was detected/i)).toBeInTheDocument();
  });

  test('asks before discarding unsaved edits', async () => {
    render(<App bridge={bridge(snapshotFixture())} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    fireEvent.change(screen.getByLabelText('Rule content'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Discard unsaved edits');
  });

  test('runs recovery restore through RPC', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockResolvedValue({ version: 1 });
    const snapshot = snapshotFixture({ receipts: { list: [{ id: 'receipt-1', lifecycle: 'completed', startedAt: 'now', completedAt: 'later', targetCount: 1 }], details: [] } });
    render(<App bridge={bridge(snapshot, rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recovery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore receipt' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('operation.restore', { id: 'receipt-1' }));
  });

  test('reports protocol rejection from bridge', async () => {
    const failing: ManagerBridge = {
      rpc: vi.fn(),
      snapshot: vi.fn().mockRejectedValue(new Error('invalid RPC envelope')),
      checkForUpdates: vi.fn(),
      openRelease: vi.fn(),
      openFileLocation: vi.fn(),
    };
    render(<App bridge={failing} />);
    expect(await screen.findByText('invalid RPC envelope')).toBeInTheDocument();
  });

  test('runs multi-page onboarding and keeps the provider preview condensed', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation): Promise<JsonValue> => {
      if (operation === 'plan') return {
        version: 1,
        reconciliation: { rules: [{ provider: 'claude', state: 'different', preview: '# Existing' }] },
      };
      if (operation === 'rules.merge-runners') return { version: 1, runners: [] };
      if (operation === 'skills.list') return {
        version: 1,
        shared: [{ name: 'review', fileCount: 1 }],
        providerScoped: [{ provider: 'codex', name: 'codex-only', fileCount: 1 }],
        unmanaged: [],
      };
      if (operation === 'structured-preview.preview') return {
        version: 1,
        digest: 'onboarding-digest',
        validationIssues: [],
        entries: [
          { provider: 'claude', content: 'rules', operation: 'write', path: '/tmp/.claude/CLAUDE.md', diff: '+new', expectedTargetHash: null, resultingTargetHash: 'after' },
          { provider: 'claude', content: 'skills', operation: 'write', path: '/tmp/.claude/skills/review', diff: '+changed', expectedTargetHash: 'before', resultingTargetHash: 'after' },
          { provider: 'claude', content: 'skills', operation: 'remove', path: '/tmp/.claude/skills/retired', diff: '-old', expectedTargetHash: 'before', resultingTargetHash: null },
        ],
      };
      return { version: 1 };
    });
    const baseSnapshot = snapshotFixture();
    const enrollmentMatrix: ManagerSnapshotV2['enrollmentMatrix'] = baseSnapshot.enrollmentMatrix.map((provider) => provider.provider === 'codex'
      ? {
          ...provider,
          cells: {
            ...provider.cells,
            mcp: { ...provider.cells.mcp, capability: { state: 'unsupported', reason: 'No MCP destination' }, destinationPath: null },
          },
        }
      : provider);
    render(<App bridge={bridge(snapshotFixture({ enrollmentMatrix }), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Choose what Reglet manages' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Create one AGENT.md' })).toBeInTheDocument();
    expect(screen.getByLabelText('Unified AGENT.md')).toHaveValue('# Existing\n');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Preview setup' })).toBeInTheDocument();
    expect(screen.getByLabelText('Unified Reglet source')).toHaveTextContent('AGENT.md');
    expect(screen.getByText('AGENT.md → CLAUDE.md')).toBeInTheDocument();
    expect(screen.getAllByText('review')).toHaveLength(2);
    const claudeDisclosure = screen.getByText('Claude').closest('details');
    const codexDisclosure = screen.getByText('Codex').closest('details');
    expect(claudeDisclosure).not.toBeNull();
    expect(codexDisclosure).not.toBeNull();
    expect(within(claudeDisclosure as HTMLElement).queryByText('codex-only')).not.toBeInTheDocument();
    expect(within(codexDisclosure as HTMLElement).getByText('codex-only')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/.claude/skills/review')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(await screen.findByRole('heading', { name: 'Review changes' })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('unenroll', { provider: 'codex', content: 'mcp' });
    const condensed = screen.getByLabelText('Condensed provider changes');
    expect(condensed).toHaveTextContent('AGENT.md → CLAUDE.md');
    expect(condensed).toHaveTextContent('review');
    expect(condensed).toHaveTextContent('retired');
    expect(condensed).toHaveTextContent('New');
    expect(condensed).toHaveTextContent('Updated');
    expect(condensed).toHaveTextContent('Removed');
    expect(condensed).not.toHaveTextContent('/tmp/');
  });

  test('prompts onboarding on first install and preselects detected providers', async () => {
    render(<App bridge={bridge(firstRunSnapshot())} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Set up Reglet');
    expect(dialog).toHaveTextContent('Set up Reglet without surprises');
    expect(dialog).toHaveTextContent('Every write is reviewed');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('checkbox', { name: 'Select Claude' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Codex' })).toBeChecked();
  });

  test('keeps AI drafting opt-in and shows unmanaged skills without file paths', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation, input): Promise<JsonValue> => {
      if (operation === 'plan') return {
        version: 1,
        reconciliation: {
          rules: [
            { provider: 'claude', state: 'different', preview: '# Claude rules', sourcePath: '/private/CLAUDE.md' },
            { provider: 'codex', state: 'different', preview: '# Codex rules', sourcePath: '/private/AGENTS.md' },
          ],
        },
      };
      if (operation === 'rules.merge-runners') return { version: 1, runners: [{ id: 'codex', displayName: 'Codex CLI' }] };
      if (operation === 'rules.source-read' && input !== undefined && 'provider' in input) {
        const provider = input.provider;
        return provider === 'claude'
          ? { version: 1, provider, fileName: 'CLAUDE.md', content: '# Full Claude rules\n\nUse pnpm.\n' }
          : { version: 1, provider: 'codex', fileName: 'AGENTS.md', content: '# Full Codex rules\n' };
      }
      if (operation === 'rules.merge-draft') return { version: 1, draft: '# AI unified draft\n' };
      if (operation === 'skills.list') return {
        version: 1,
        shared: [],
        providerScoped: [],
        unmanaged: [{ provider: 'claude', name: 'local-review', sourcePath: '/private/.claude/skills/local-review', sharedConflict: 'none' }],
      };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Create one AGENT.md' })).toBeInTheDocument();
    const claudeSummary = screen.getByText('CLAUDE.md').closest('summary');
    expect(claudeSummary).not.toBeNull();
    fireEvent.click(claudeSummary as HTMLElement);
    const sourceEditor = await screen.findByLabelText('Claude CLAUDE.md contents');
    expect(sourceEditor).toHaveValue('# Full Claude rules\n\nUse pnpm.\n');
    expect(screen.queryByText('/private/CLAUDE.md')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Insert at cursor' }));
    expect(screen.getByLabelText('Unified AGENT.md')).toHaveValue('# Full Claude rules\n\nUse pnpm.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Full Claude rules\n\nUse pnpm.\n'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Additional drafting guidance'), {
      target: { value: 'Include package manager preferences. Exclude personal biography.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft merge' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Nothing is applied until the final review');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('additional guidance');
    expect(rpc).not.toHaveBeenCalledWith('rules.merge-draft', expect.anything());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Draft merge' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Generate draft' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rules.merge-draft', {
      providers: ['claude', 'codex'],
      runner: 'codex',
      steeringPrompt: 'Include package manager preferences. Exclude personal biography.',
    }));
    expect(screen.getByLabelText('Unified AGENT.md')).toHaveValue('# AI unified draft\n');

    fireEvent.change(screen.getByLabelText('Unified AGENT.md'), { target: { value: '# Unified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Choose unified skills' })).toBeInTheDocument();
    expect(screen.getByText('local-review')).toBeInTheDocument();
    expect(screen.queryByText('/private/.claude/skills/local-review')).not.toBeInTheDocument();
  });

  test('browses rule documents and only offers discovered AI runners', async () => {
    const openFileLocation = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation): Promise<JsonValue> => {
      if (operation === 'rules.list') return {
        version: 1,
        documents: [
          { path: 'team.md', scope: { kind: 'shared' } },
          { path: 'claude/00-imported.md', scope: { kind: 'provider', provider: 'claude' } },
        ],
      };
      if (operation === 'rules.merge-runners') return { version: 1, runners: [{ id: 'codex', displayName: 'Codex CLI' }] };
      if (operation === 'rules.read') return { version: 1, path: 'team.md', content: '# Team rules' };
      return { version: 1 };
    });
    const testBridge = bridge(snapshotFixture(), rpc);
    testBridge.openFileLocation = openFileLocation;
    render(<App bridge={testBridge} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    await waitFor(() => expect(screen.getByLabelText('Rule content')).toHaveValue('# Team rules'));
    expect(screen.getByLabelText('Agent markdown')).toHaveValue('shared:shared:team.md');
    expect(screen.getByRole('button', { name: /Edit Claude rules/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Rule path')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open file location for Claude rules/ }));
    expect(openFileLocation).toHaveBeenCalledWith('/tmp/reglet/rules/claude/00-imported.md');
    fireEvent.click(screen.getByRole('button', { name: 'Merge with Codex CLI' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('will read local rule files');
    expect(screen.queryByRole('button', { name: /Gemini/ })).not.toBeInTheDocument();
  });

  test('separates unified and provider-local skills while saving per-skill sync targets', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation, input): Promise<JsonValue> => {
      if (operation === 'skills.list') return {
        version: 1,
        shared: [{ name: 'review', path: '/tmp/reglet/skills/review', fileCount: 1, syncProviders: ['claude', 'codex'] }],
        providerScoped: [{ provider: 'claude', name: 'claude-only', path: '/tmp/reglet/skills/claude/claude-only', fileCount: 1 }],
        unmanaged: [{ provider: 'claude', name: 'local-skill', sharedConflict: 'destination-exists', providerConflict: 'none' }],
      };
      if (operation === 'skills.read') return { version: 1, document: { content: '# Managed skill' } };
      if (operation === 'skills.inspect' && input !== undefined && 'path' in input) return { version: 1, document: { content: '# Unmanaged notes' } };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skills' }));
    expect(await screen.findByRole('region', { name: 'Unified skills' })).toHaveTextContent('review');
    expect(screen.getByRole('region', { name: 'Limited and provider-only skills' })).toHaveTextContent('claude-only');
    expect(screen.getByRole('region', { name: 'Provider-local skills' })).toHaveTextContent('local-skill');
    fireEvent.click(screen.getByText('review', { exact: true }));
    expect(await screen.findByLabelText('Skill content')).toHaveValue('# Managed skill');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('skills.update-sync', { name: 'review', providers: ['claude'] }));
    fireEvent.click(screen.getByText('local-skill', { exact: true }));
    await waitFor(() => expect(screen.getByLabelText('Skill content')).toHaveValue('# Unmanaged notes'));
    expect(screen.getByLabelText('Skill content')).toHaveAttribute('readonly');
  });

  test('separates unified and provider-only MCP servers and requires confirmation for digest-backed apply', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation, input): Promise<JsonValue> => {
      if (operation === 'mcp.list') {
        if (input !== undefined && 'scope' in input && input.scope === 'provider' && input.provider === 'claude') {
          return { version: 1, path: '/tmp/reglet/mcp/providers/claude/servers.json', servers: [{ id: 'claude-only', displayName: 'Claude only', scope: { kind: 'provider', provider: 'claude' }, server: { command: 'claude-node' }, issues: [] }] };
        }
        if (input !== undefined && 'scope' in input && input.scope === 'provider') return { version: 1, path: '/tmp/reglet/mcp/providers/codex/servers.json', servers: [] };
        return { version: 1, path: '/tmp/reglet/mcp/servers.json', servers: [{ id: 'local', displayName: 'Local', scope: { kind: 'shared' }, syncProviders: ['claude', 'codex'], server: { command: 'node', args: [] }, issues: [] }] };
      }
      if (operation === 'structured-preview.preview') return { version: 1, digest: 'digest-1', entries: [{ provider: 'claude', content: 'rules', operation: 'write', path: '/tmp/rules', diff: '+new' }] };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'MCP' }));
    expect(await screen.findByRole('region', { name: 'Unified MCP servers' })).toHaveTextContent('Local');
    expect(screen.getByRole('region', { name: 'Limited and provider-only MCP servers' })).toHaveTextContent('Claude only');
    fireEvent.click(screen.getByText('Local', { exact: true }));
    expect((screen.getByLabelText('Server JSON') as HTMLTextAreaElement).value).toContain('"command": "node"');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('mcp.update-sync', { id: 'local', providers: ['claude'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Activity & Drift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review & Apply' }));
    expect(await screen.findByText('+new')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('digest-backed changes');
  });

  test('keeps automatic update checks off on clean installs and supports manual checks', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue({ currentVersion: '0.1.0', latestVersion: '0.2.0', available: true, releaseUrl: 'https://github.com/elijahbutler/reglet/releases/latest' });
    const testBridge = bridge(snapshotFixture());
    testBridge.checkForUpdates = checkForUpdates;
    render(<App bridge={testBridge} />);
    await screen.findByText('/tmp/reglet');
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Opt in to automatic update checks' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates manually' }));
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Open 0.2.0' })).toBeInTheDocument();
  });

  test('runs an automatic update check only after explicit opt-in', async () => {
    window.localStorage.setItem('reglet.autoUpdateChecks', 'true');
    const checkForUpdates = vi.fn().mockResolvedValue({ currentVersion: '0.1.0', latestVersion: '0.1.0', available: false, releaseUrl: 'https://github.com/elijahbutler/reglet/releases/latest' });
    const testBridge = bridge(snapshotFixture());
    testBridge.checkForUpdates = checkForUpdates;
    render(<App bridge={testBridge} />);
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(screen.getByRole('checkbox', { name: 'Opt in to automatic update checks' })).toBeChecked();
  });
});

function bridge(snapshot: ManagerSnapshotV2, rpc: ManagerBridge['rpc'] = defaultRpc): ManagerBridge {
  return {
    rpc,
    snapshot: vi.fn().mockResolvedValue(snapshot),
    checkForUpdates: vi.fn().mockResolvedValue({ currentVersion: '0.1.0', latestVersion: '0.1.0', available: false, releaseUrl: 'https://github.com/elijahbutler/reglet/releases/latest' }),
    openRelease: vi.fn().mockResolvedValue(undefined),
    openFileLocation: vi.fn().mockResolvedValue(undefined),
  };
}

function firstRunSnapshot(): ManagerSnapshotV2 {
  const snapshot = snapshotFixture();
  return {
    ...snapshot,
    state: { state: 'draftOnly', reasons: ['noDestinationsEnrolled'] },
    enrollmentMatrix: snapshot.enrollmentMatrix.map((provider) => ({
      ...provider,
      enabled: false,
      cells: {
        rules: { ...provider.cells.rules, enrolled: false },
        skills: { ...provider.cells.skills, enrolled: false },
        mcp: { ...provider.cells.mcp, enrolled: false },
      },
    })),
  };
}

async function defaultRpc<Operation extends ManagerProtocolOperation>(
  _operation: Operation,
  _input?: ManagerRpcInputs[Operation],
): Promise<JsonValue> {
  return { version: 1 };
}
