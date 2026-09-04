import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileCode2,
  FileDiff,
  LoaderCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isManagerProjectionReviewV3,
  type ManagerContentId,
  type ManagerProjectionReviewUnitV3,
  type ManagerProjectionReviewV3,
  type ManagerProviderId,
  type ManagerRpcInputs,
  type ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { DiffViewer } from '../../design-system/DiffViewer.js';
import { Shortcut } from '../../design-system/Shortcut.js';

export interface SyncDiffsViewProps {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  commandModifier: string;
  onRefresh: () => Promise<void>;
  onOpenConflictResolver?: (conflictPath: string) => void;
  onOpenSettings?: () => void;
}

type DiffFilter = 'all' | 'drifted' | 'pending';

export function SyncDiffsView({
  client,
  snapshot,
  commandModifier,
  onRefresh,
  onOpenConflictResolver,
  onOpenSettings,
}: SyncDiffsViewProps) {
  const [review, setReview] = useState<ManagerProjectionReviewV3 | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedUnitKey, setSelectedUnitKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [confirmDrift, setConfirmDrift] = useState(false);
  const [filter, setFilter] = useState<DiffFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<{ applied: number; failed: number } | null>(null);

  // Compute all available provider/content pairs from the snapshot
  const requestUnits = useMemo(() => {
    if (!snapshot) return [];
    const units: { provider: ManagerProviderId; content: ManagerContentId }[] = [];
    for (const provider of snapshot.providers) {
      if (!provider.detected) continue;
      for (const source of provider.sources) {
        if (source.content === 'rules' || source.content === 'skills' || source.content === 'mcp') {
          units.push({ provider: provider.id, content: source.content });
        }
      }
    }
    // Fallback if none detected
    if (units.length === 0) {
      const allProviders: ManagerProviderId[] = ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'windsurf'];
      for (const p of allProviders) {
        units.push({ provider: p, content: 'rules' });
        units.push({ provider: p, content: 'skills' });
        units.push({ provider: p, content: 'mcp' });
      }
    }
    return units;
  }, [snapshot]);

  // Load provider review (drift & changes)
  const loadReview = useCallback(async () => {
    if (requestUnits.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await client.command('provider.review', { units: requestUnits });
      if (isManagerProjectionReviewV3(response.data)) {
        setReview(response.data);
        // Default select units that have operations or drift
        const actionable = response.data.units.filter(
          (u) => u.entries.some((e) => e.operation !== 'skip' || e.driftStatus === 'modified' || e.driftStatus === 'unmanaged')
        );
        const keys = new Set(actionable.map((u) => u.key));
        setSelectedKeys(keys);
        if (actionable.length > 0) {
          setSelectedUnitKey((current) => current ?? actionable[0]?.key ?? null);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not fetch provider review.');
    } finally {
      setLoading(false);
    }
  }, [client, requestUnits]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  // Sync now action
  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await client.command('sync.now', {});
      await onRefresh();
      await loadReview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Encrypted sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  // Filtered review units
  const units = useMemo(() => {
    if (!review) return [];
    return review.units.filter((unit) => {
      const hasDrift = unit.entries.some((e) => e.driftStatus === 'modified' || e.driftStatus === 'unmanaged');
      const hasChanges = unit.entries.some((e) => e.operation !== 'skip');
      if (filter === 'drifted') return hasDrift;
      if (filter === 'pending') return hasChanges && !hasDrift;
      return hasChanges || hasDrift;
    });
  }, [review, filter]);

  // Currently active unit
  const activeUnit = useMemo(() => {
    if (!review) return null;
    return review.units.find((u) => u.key === selectedUnitKey) ?? units[0] ?? null;
  }, [review, selectedUnitKey, units]);

  // Drift confirmation requirements
  const selectedUnits = useMemo(() => {
    if (!review) return [];
    return review.units.filter((u) => selectedKeys.has(u.key));
  }, [review, selectedKeys]);

  const requiresDriftConfirmation = selectedUnits.some((u) => u.requiresDriftConfirmation);
  const canApply = selectedUnits.length > 0 && (!requiresDriftConfirmation || confirmDrift) && !applying;

  // Apply reviewed batch
  const handleApply = useCallback(async () => {
    if (!review || !canApply) return;
    setApplying(true);
    setError(null);
    setApplySummary(null);
    try {
      const unitsToApply = selectedUnits.map(({ provider, content, digest }) => ({
        provider,
        content,
        digest,
      }));
      const input: ManagerRpcInputs['provider.apply'] = requiresDriftConfirmation
        ? { batchDigest: review.digest, units: unitsToApply, confirmDrift: true }
        : { batchDigest: review.digest, units: unitsToApply };

      const response = await client.command('provider.apply', input);
      const data = response.data as { summary?: { applied: number; failed: number } };
      setApplySummary(data?.summary ?? { applied: unitsToApply.length, failed: 0 });
      await onRefresh();
      await loadReview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Apply failed.');
    } finally {
      setApplying(false);
    }
  }, [review, canApply, selectedUnits, requiresDriftConfirmation, confirmDrift, client, onRefresh, loadReview]);

  // Global keyboard shortcut: Cmd+Enter / Ctrl+Enter to apply
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (canApply) {
          e.preventDefault();
          void handleApply();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canApply, handleApply]);

  // Open target in external editor (Cursor, VS Code, Zed)
  const handleOpenExternal = async (unit: ManagerProjectionReviewUnitV3) => {
    try {
      await client.command('external.open', {
        target: {
          kind: 'provider',
          provider: unit.provider,
          content: unit.content,
        },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open external editor.');
    }
  };

  // Toggle selection
  const toggleUnit = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const syncState = snapshot?.settings.sync;
  const isConflict = syncState?.state === 'conflict' || (syncState?.conflictCount ?? 0) > 0;

  return (
    <div className="flex flex-col h-full bg-[var(--rg-canvas,#08090b)] text-[var(--rg-text,#f3f3f2)] overflow-hidden font-sans">
      {/* ── Top Status Banner (Vault & Sync Cockpit) ── */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[var(--rg-surface,#101216)] border-b border-[var(--rg-border,rgba(255,255,255,0.08))] shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <h1 className="text-sm font-semibold tracking-tight text-[var(--rg-text,#f3f3f2)] m-0">
              Sync & Diff Cockpit
            </h1>
          </div>

          <span className="text-xs text-[var(--rg-muted,#8a8f98)]">
            Vault: rev {snapshot?.revision ?? 1}
          </span>

          {isConflict && (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-amber-950/40 text-amber-300 border border-amber-800/60 rounded-full text-xs font-medium">
              <AlertTriangle size={13} className="text-amber-400" />
              <span>{syncState?.conflictCount ?? 1} sync conflict(s)</span>
              {onOpenConflictResolver && syncState?.conflicts?.[0] && (
                <button
                  type="button"
                  onClick={() => onOpenConflictResolver(syncState.conflicts[0]!)}
                  className="underline hover:text-white font-semibold ml-1"
                >
                  Resolve
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onOpenSettings && (
            <Button tone="quiet" icon={<Settings size={14} />} onClick={onOpenSettings}>
              Settings
            </Button>
          )}

          <Button
            tone="quiet"
            icon={<RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />}
            onClick={() => void handleSyncNow()}
            disabled={syncing || loading}
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>

          <Button
            tone="primary"
            icon={applying ? <LoaderCircle size={14} className="animate-spin" /> : <Zap size={14} />}
            onClick={() => void handleApply()}
            disabled={!canApply}
          >
            Apply {selectedUnits.length > 0 ? `${selectedUnits.length} Units` : ''}
            <Shortcut keys={[commandModifier, '↵']} className="ml-2 opacity-80" />
          </Button>
        </div>
      </header>

      {/* ── Error or Summary Alerts ── */}
      {error && (
        <div className="px-6 py-2 bg-rose-950/50 border-b border-rose-900/60 text-rose-200 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <CircleAlert size={14} className="text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {applySummary && (
        <div className="px-6 py-2 bg-emerald-950/50 border-b border-emerald-900/60 text-emerald-200 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
            <span>
              Successfully applied {applySummary.applied} unit(s). Provider files are up to date.
            </span>
          </div>
          <button type="button" onClick={() => setApplySummary(null)} className="opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Main Split View ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Units List */}
        <aside className="w-80 border-r border-[var(--rg-border,rgba(255,255,255,0.08))] flex flex-col bg-[var(--rg-surface,#0c0e12)] shrink-0">
          {/* Filter Bar */}
          <div className="p-3 border-b border-[var(--rg-border,rgba(255,255,255,0.08))] flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-[var(--rg-surface,#20242c)] text-white shadow-sm'
                  : 'text-[var(--rg-muted,#8a8f98)] hover:text-white'
              }`}
            >
              All Changes
            </button>
            <button
              type="button"
              onClick={() => setFilter('drifted')}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                filter === 'drifted'
                  ? 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
                  : 'text-[var(--rg-muted,#8a8f98)] hover:text-white'
              }`}
            >
              Drifted
            </button>
            <button
              type="button"
              onClick={() => setFilter('pending')}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                filter === 'pending'
                  ? 'bg-blue-950/40 text-blue-300 border border-blue-800/40'
                  : 'text-[var(--rg-muted,#8a8f98)] hover:text-white'
              }`}
            >
              Pending
            </button>
          </div>

          {/* Unit Items */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {units.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--rg-muted,#8a8f98)] space-y-3">
                <Sparkles size={24} className="mx-auto text-emerald-400/80" />
                <p className="font-medium text-[var(--rg-text,#f3f3f2)]">All providers in sync</p>
                <p className="leading-relaxed">
                  No drift or pending writes detected across Claude Code, Codex, Gemini, OpenCode, Cursor, or Windsurf.
                </p>
              </div>
            ) : (
              units.map((unit) => {
                const isSelected = selectedKeys.has(unit.key);
                const isActive = activeUnit?.key === unit.key;
                const hasDrift = unit.entries.some((e) => e.driftStatus === 'modified' || e.driftStatus === 'unmanaged');
                const primaryEntry = unit.entries[0];

                return (
                  <div
                    key={unit.key}
                    onClick={() => setSelectedUnitKey(unit.key)}
                    className={`group relative p-2.5 rounded-lg border cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[var(--rg-surface,#191d24)] border-emerald-500/50 shadow-sm'
                        : 'border-transparent hover:bg-[var(--rg-surface,#12151b)] hover:border-[var(--rg-border,rgba(255,255,255,0.06))]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleUnit(unit.key);
                        }}
                        className="mt-0.5 rounded border-white/20 bg-black/40 text-emerald-500 focus:ring-0 cursor-pointer"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--rg-muted,#8a8f98)] truncate">
                            {unit.provider} • {unit.content}
                          </span>
                          {hasDrift ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/40 text-[10px] font-medium">
                              Drift
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-400 border border-blue-800/40 text-[10px] font-medium">
                              Update
                            </span>
                          )}
                        </div>

                        <p className="text-xs font-mono text-[var(--rg-text,#f3f3f2)] truncate m-0">
                          {primaryEntry?.path ?? 'Unknown path'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Column: Hero Diff Viewer & Details */}
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--rg-canvas,#08090b)] overflow-hidden">
          {activeUnit ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Unit Header Bar */}
              <div className="flex items-center justify-between px-6 py-3 bg-[var(--rg-surface,#101216)] border-b border-[var(--rg-border,rgba(255,255,255,0.08))] shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 rounded bg-white/5 border border-white/10 text-[var(--rg-text,#f3f3f2)]">
                    <FileCode2 size={16} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xs font-mono font-semibold text-[var(--rg-text,#f3f3f2)] truncate m-0">
                      {activeUnit.entries[0]?.path ?? `${activeUnit.provider} • ${activeUnit.content}`}
                    </h2>
                    <p className="text-[11px] text-[var(--rg-muted,#8a8f98)] truncate m-0">
                      Provider: <strong className="text-white capitalize">{activeUnit.provider}</strong> • Target:{' '}
                      <strong className="text-white capitalize">{activeUnit.content}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    tone="quiet"
                    icon={<ExternalLink size={13} />}
                    onClick={() => void handleOpenExternal(activeUnit)}
                  >
                    Open in Editor
                  </Button>
                </div>
              </div>

              {/* Diff Viewer Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {activeUnit.entries.map((entry) => (
                  <div key={entry.path} className="space-y-2">
                    <DiffViewer
                      diff={entry.diff}
                      path={entry.path}
                      redacted={activeUnit.content === 'mcp'}
                      note={entry.note}
                    />
                  </div>
                ))}
              </div>

              {/* Bottom Action / Drift Confirmation Bar */}
              <footer className="p-4 bg-[var(--rg-surface,#101216)] border-t border-[var(--rg-border,rgba(255,255,255,0.08))] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  {requiresDriftConfirmation ? (
                    <label className="flex items-center gap-2 text-xs text-amber-300 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmDrift}
                        onChange={(e) => setConfirmDrift(e.target.checked)}
                        className="rounded border-amber-500/50 bg-black/40 text-amber-500 focus:ring-0 cursor-pointer"
                      />
                      <span>I understand that Apply will replace external edits made on disk.</span>
                    </label>
                  ) : (
                    <span className="text-xs text-[var(--rg-muted,#8a8f98)]">
                      {selectedUnits.length} unit(s) selected for atomic apply.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    tone="primary"
                    disabled={!canApply}
                    icon={applying ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                    onClick={() => void handleApply()}
                  >
                    Apply Reviewed Changes
                    <Shortcut keys={[commandModifier, '↵']} className="ml-2" />
                  </Button>
                </div>
              </footer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-[var(--rg-muted,#8a8f98)]">
              <FileDiff size={32} className="opacity-30 mb-3" />
              <p className="font-semibold text-sm text-[var(--rg-text,#f3f3f2)]">No Unit Selected</p>
              <p className="max-w-xs mt-1">
                Select a drifted or modified unit from the list on the left to inspect its unified or split diff.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
