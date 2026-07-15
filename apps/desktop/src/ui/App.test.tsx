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
    };
    render(<App bridge={failing} />);
    expect(await screen.findByText('invalid RPC envelope')).toBeInTheDocument();
  });

  test('previews exact onboarding files before staging', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockResolvedValue({
      version: 1,
      reads: [{ provider: 'claude', content: 'rules', path: '/tmp/CLAUDE.md' }],
      writes: [{ provider: 'claude', content: 'rules', path: '/tmp/reglet/rules/claude.md' }],
      reconciliation: { rules: [{ provider: 'claude', state: 'different', preview: '# Existing' }] },
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review onboarding' }));
    expect(await screen.findByLabelText('Onboarding file preview')).toHaveTextContent('/tmp/CLAUDE.md');
    fireEvent.click(screen.getByRole('button', { name: 'Stage reviewed' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Stage onboarding');
  });

  test('prompts onboarding on first install and preselects detected providers', async () => {
    render(<App bridge={bridge(firstRunSnapshot())} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Set up Reglet');
    expect(dialog).toHaveTextContent('found 2 local AI tools');
    expect(dialog).toHaveTextContent('review every file before Reglet writes anything');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Begin onboarding' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Claude Code' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Codex CLI' })).toBeChecked();
  });

  test('browses rule documents and only offers discovered AI runners', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation): Promise<JsonValue> => {
      if (operation === 'rules.list') return { version: 1, documents: [{ path: 'team.md', scope: { kind: 'shared' } }] };
      if (operation === 'rules.merge-runners') return { version: 1, runners: [{ id: 'codex', displayName: 'Codex CLI' }] };
      if (operation === 'rules.read') return { version: 1, path: 'team.md', content: '# Team rules' };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load documents' }));
    fireEvent.click(await screen.findByRole('button', { name: /shared · team.md/ }));
    await waitFor(() => expect(screen.getByLabelText('Rule content')).toHaveValue('# Team rules'));
    fireEvent.click(screen.getByRole('button', { name: 'Merge with Codex CLI' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('will read local rule files');
    expect(screen.queryByRole('button', { name: /Gemini/ })).not.toBeInTheDocument();
  });

  test('browses managed and unmanaged skills and confirms conflicting adoption', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation, input): Promise<JsonValue> => {
      if (operation === 'skills.list') return {
        version: 1,
        shared: [{ name: 'review', fileCount: 1 }],
        providerScoped: [],
        unmanaged: [{ provider: 'claude', name: 'local-skill', sharedConflict: 'destination-exists', providerConflict: 'none' }],
      };
      if (operation === 'skills.tree') return { version: 1, tree: { files: [{ path: 'SKILL.md', bytes: 22 }] } };
      if (operation === 'skills.read') return { version: 1, document: { content: '# Managed skill' } };
      if (operation === 'skills.inspect' && input !== undefined && 'path' in input) return { version: 1, document: { content: '# Unmanaged notes' } };
      if (operation === 'skills.inspect') return { version: 1, tree: { files: [{ path: 'README.md', bytes: 17 }] } };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load skills' }));
    fireEvent.click(await screen.findByRole('button', { name: /review.*shared.*1 files/ }));
    expect(await screen.findByLabelText('Skill file')).toHaveValue('# Managed skill');
    fireEvent.click(screen.getByRole('button', { name: /local-skill.*unmanaged/ }));
    await waitFor(() => expect(screen.getByLabelText('Skill name')).toHaveValue('local-skill'));
    fireEvent.click(await screen.findByRole('button', { name: /README.md · 17 B/ }));
    await waitFor(() => expect(screen.getByLabelText('Skill file')).toHaveValue('# Unmanaged notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('destination exists');
  });

  test('loads MCP servers and requires confirmation for digest-backed apply', async () => {
    const rpc = vi.fn<ManagerBridge['rpc']>().mockImplementation(async (operation): Promise<JsonValue> => {
      if (operation === 'mcp.list') return { version: 1, servers: [{ id: 'local', displayName: 'Local', server: { command: 'node', args: [] }, issues: [] }] };
      if (operation === 'structured-preview.preview') return { version: 1, digest: 'digest-1', entries: [{ provider: 'claude', content: 'rules', operation: 'write', path: '/tmp/rules', diff: '+new' }] };
      return { version: 1 };
    });
    render(<App bridge={bridge(snapshotFixture(), rpc)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'MCP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load servers' }));
    fireEvent.click(await screen.findByRole('button', { name: /Local.*local/ }));
    expect((screen.getByLabelText('Server JSON') as HTMLTextAreaElement).value).toContain('"command": "node"');
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
