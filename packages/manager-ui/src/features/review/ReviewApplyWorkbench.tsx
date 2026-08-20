import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileMinus2,
  FilePenLine,
  Files,
  History,
  LoaderCircle,
  Minus,
  RefreshCw,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isManagerProjectionReviewV3,
  type JsonValue,
  type ManagerContentId,
  type ManagerProjectionReviewEntryV3,
  type ManagerProjectionReviewUnitV3,
  type ManagerProjectionReviewV3,
  type ManagerProviderId,
  type ManagerRpcInputs,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Shortcut } from '../../design-system/Shortcut.js';

export interface ReviewRequestUnit {
  provider: ManagerProviderId;
  content: ManagerContentId;
}

export interface ReviewRequest {
  sourceTitle: string;
  units: ReviewRequestUnit[];
}

interface ReviewApplyWorkbenchProps {
  client: ManagerClient;
  commandModifier: string;
  request: ReviewRequest;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onOpenActivity: () => void;
  onOpenExecutableSkills: () => void;
  onOpenSettings: () => void;
  onRefresh: () => Promise<void>;
}

type ReviewFilter = 'all' | 'write' | 'remove' | 'blocked';
type ReviewPhase = 'loading' | 'ready' | 'revalidating' | 'applying';

interface ProjectionApplyUnitOutcome {
  key: string;
  provider: ManagerProviderId;
  content: ManagerContentId;
  status: 'applied' | 'blocked' | 'failed';
  issues: string[];
  receiptId?: string;
  completedAt?: string;
}

interface ProjectionApplyResult {
  version: 1;
  units: ProjectionApplyUnitOutcome[];
  summary: {
    applied: number;
    blocked: number;
    failed: number;
  };
}

export function ReviewApplyWorkbench({
  client,
  commandModifier,
  request,
  onBusyChange,
  onClose,
  onOpenActivity,
  onOpenExecutableSkills,
  onOpenSettings,
  onRefresh,
}: ReviewApplyWorkbenchProps) {
  const [review, setReview] = useState<ManagerProjectionReviewV3 | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [phase, setPhase] = useState<ReviewPhase>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUnconfirmed, setResultUnconfirmed] = useState(false);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [confirmDrift, setConfirmDrift] = useState(false);
  const [result, setResult] = useState<ProjectionApplyResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadReview = useCallback(async () => {
    setPhase('loading');
    setError(null);
    setResultUnconfirmed(false);
    setStaleMessage(null);
    setResult(null);
    try {
      const response = await client.command('provider.review', {
        units: request.units.map(({ provider, content }) => ({ provider, content })),
      });
      if (!isManagerProjectionReviewV3(response.data)) {
        throw new Error('Reglet returned an invalid provider review. No files were changed.');
      }
      const next = response.data;
      setReview(next);
      setSelectedKeys(defaultSelectedKeys(next));
      setExpandedEntries(defaultExpandedEntries(next));
      setConfirmDrift(false);
    } catch (reviewError) {
      setReview(null);
      setError(messageFrom(reviewError));
    } finally {
      setPhase('ready');
    }
  }, [client, request]);

  useEffect(() => {
    void loadReview();
  }, [loadAttempt, loadReview]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const busy = phase === 'revalidating' || phase === 'applying';
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const selectedUnits = useMemo(
    () => review?.units.filter((unit) => selectedKeys.has(unit.key) && isActionable(unit)) ?? [],
    [review, selectedKeys],
  );
  const requiresDriftConfirmation = selectedUnits.some((unit) => unit.requiresDriftConfirmation);
  const canApply = phase === 'ready' && result === null && selectedUnits.length > 0 &&
    (!requiresDriftConfirmation || confirmDrift);

  const applyReviewedUnits = useCallback(async () => {
    if (review === null || !canApply) return;
    const visibleUnits = selectedUnits;
    let applyRequested = false;
    setError(null);
    setResultUnconfirmed(false);
    setStaleMessage(null);
    setPhase('revalidating');
    try {
      const response = await client.command('provider.review', {
        units: visibleUnits.map(({ provider, content }) => ({ provider, content })),
      });
      if (!isManagerProjectionReviewV3(response.data)) {
        throw new Error('Reglet returned an invalid provider review. No files were changed.');
      }
      const fresh = response.data;
      if (!reviewsMatch(visibleUnits, fresh.units)) {
        setReview(fresh);
        setSelectedKeys(defaultSelectedKeys(fresh));
        setExpandedEntries(defaultExpandedEntries(fresh));
        setConfirmDrift(false);
        setStaleMessage('The provider plan changed while you were reviewing it. Reglet refreshed the ledger and did not write any files. Review the updated rows, then apply again.');
        setPhase('ready');
        return;
      }

      const units = fresh.units.filter(isActionable);
      const applyInputBase = {
        batchDigest: fresh.digest,
        units: units.map(({ provider, content, digest }) => ({ provider, content, digest })),
      };
      const applyInput: ManagerRpcInputs['provider.apply'] = requiresDriftConfirmation
        ? { ...applyInputBase, confirmDrift: true }
        : applyInputBase;
      setPhase('applying');
      applyRequested = true;
      const applyResponse = await client.command('provider.apply', applyInput);
      const nextResult = readProjectionApplyResult(applyResponse.data);
      if (nextResult === null) {
        throw new Error('Reglet could not verify the apply result. Check Activity before trying again.');
      }
      setResult(nextResult);
      await onRefresh();
    } catch (applyError) {
      const detail = messageFrom(applyError);
      if (applyRequested && !detail.toLocaleLowerCase().includes('stale')) {
        setResultUnconfirmed(true);
        setError(`Reglet could not confirm whether the batch completed. Check Activity before trying again. ${detail}`);
      } else {
        setError(detail);
      }
    } finally {
      setPhase('ready');
    }
  }, [canApply, client, onRefresh, requiresDriftConfirmation, review, selectedUnits]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && canApply) {
        event.preventDefault();
        void applyReviewedUnits();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyReviewedUnits, busy, canApply, onClose]);

  const counts = useMemo(() => reviewCounts(review), [review]);
  const visibleUnits = useMemo(
    () => review?.units.filter((unit) => unitMatchesFilter(unit, filter)) ?? [],
    [filter, review],
  );

  const toggleUnit = (unit: ManagerProjectionReviewUnitV3) => {
    if (!isActionable(unit) || busy || result !== null) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(unit.key)) next.delete(unit.key);
      else next.add(unit.key);
      return next;
    });
  };

  const toggleEntry = (entryId: string) => {
    setExpandedEntries((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return (
    <section className="rg-review-workbench" aria-labelledby="review-heading">
      <div className="rg-review-layout">
        <div className="rg-review-ledger">
          <header className="rg-review-heading">
            <div>
              <p className="rg-eyebrow">Exact provider operations</p>
              <h1 id="review-heading" ref={headingRef} tabIndex={-1}>Review and apply</h1>
              <p>Confirm every file operation derived from <strong>{request.sourceTitle}</strong>. Nothing is written until you apply the selected units.</p>
            </div>
            {review === null ? null : <code title={review.digest}>Batch {shortHash(review.digest)}</code>}
          </header>

          {staleMessage === null ? null : (
            <div className="rg-review-notice rg-review-notice--warning" role="status">
              <RefreshCw size={16} aria-hidden="true" />
              <span><strong>Review refreshed</strong>{staleMessage}</span>
            </div>
          )}
          {error === null ? null : (
            <div className="rg-review-notice rg-review-notice--error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span><strong>Review needs attention</strong>{error}</span>
              {resultUnconfirmed ? <Button tone="secondary" icon={<History size={14} />} onClick={onOpenActivity}>Open activity</Button> : null}
              <Button tone="secondary" icon={<RefreshCw size={14} />} onClick={() => setLoadAttempt((attempt) => attempt + 1)} disabled={busy}>Refresh review</Button>
            </div>
          )}

          {phase === 'loading' ? (
            <div className="rg-review-state" role="status">
              <LoaderCircle className="rg-spin" size={22} aria-hidden="true" />
              <strong>Preparing the exact file ledger</strong>
              <span>Reglet is reading the current provider targets and validating each planned operation.</span>
            </div>
          ) : review === null ? (
            <div className="rg-review-state">
              <CircleAlert size={22} aria-hidden="true" />
              <strong>The review could not be prepared</strong>
              <span>No files were changed. Refresh the review or return to the library.</span>
            </div>
          ) : (
            <>
              <div className="rg-review-toolbar">
                <div className="rg-review-filters" role="group" aria-label="Filter file operations">
                  <ReviewFilterButton label="All" count={review.units.length} value="all" active={filter === 'all'} onFilter={setFilter} />
                  <ReviewFilterButton label="Writes" count={counts.writes} value="write" active={filter === 'write'} onFilter={setFilter} />
                  <ReviewFilterButton label="Removals" count={counts.removals} value="remove" active={filter === 'remove'} onFilter={setFilter} />
                  <ReviewFilterButton label="Blocked" count={counts.blocked} value="blocked" active={filter === 'blocked'} onFilter={setFilter} />
                </div>
                <span>{selectedUnits.length} of {counts.actionable} ready selected</span>
              </div>

              <div className="rg-review-units">
                {visibleUnits.length === 0 ? (
                  <div className="rg-review-state rg-review-state--compact">
                    <Files size={20} aria-hidden="true" />
                    <strong>No operations match this filter</strong>
                    <span>Choose another filter to see the rest of the reviewed ledger.</span>
                  </div>
                ) : visibleUnits.map((unit) => {
                  const actionable = isActionable(unit);
                  const selected = selectedKeys.has(unit.key);
                  const entries = entriesForFilter(unit, filter);
                  const unitCounts = entryCounts(unit.entries);
                  const executableApprovalRequired = unit.content === 'skills' &&
                    unit.validationIssues.some((issue) => issue.startsWith('Executable skill '));
                  return (
                    <section className={`rg-review-unit rg-review-unit--${unit.status}`} key={unit.key} aria-labelledby={`review-unit-${safeId(unit.key)}`}>
                      <header className="rg-review-unit__header">
                        <label className="rg-review-unit__selection">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!actionable || busy || result !== null}
                            onChange={() => toggleUnit(unit)}
                          />
                          <span className="rg-provider-glyph" aria-hidden="true">{providerInitial(unit.provider)}</span>
                          <span>
                            <strong id={`review-unit-${safeId(unit.key)}`}>{providerLabel(unit.provider)}</strong>
                            <small>{contentLabel(unit.content)} · revision {shortHash(unit.masterRevision)}</small>
                          </span>
                        </label>
                        <div className="rg-review-unit__status">
                          {unit.status === 'blocked'
                            ? <span className="rg-review-badge rg-review-badge--blocked"><CircleAlert size={13} /> Blocked</span>
                            : actionable
                              ? <span className="rg-review-badge rg-review-badge--ready"><Check size={13} /> Ready</span>
                              : <span className="rg-review-badge"><Check size={13} /> Current</span>}
                          <small>{unitCounts.writes} write · {unitCounts.removals} remove</small>
                        </div>
                      </header>

                      {unit.validationIssues.length === 0 ? null : (
                        <div className="rg-review-validation" role="status">
                          <AlertTriangle size={15} aria-hidden="true" />
                          <div>
                            <strong>This unit will not be written</strong>
                            <ul>{unit.validationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                          </div>
                          <Button
                            tone="secondary"
                            icon={executableApprovalRequired ? <ShieldCheck size={14} /> : <Settings size={14} />}
                            onClick={executableApprovalRequired ? onOpenExecutableSkills : onOpenSettings}
                          >{executableApprovalRequired ? 'Review executable skills' : 'Open settings'}</Button>
                        </div>
                      )}

                      <div className="rg-review-entries">
                        {entries.map(({ entry, index }) => {
                          const entryId = `${unit.key}:${index}`;
                          const expanded = expandedEntries.has(entryId);
                          const lines = changedLineCounts(entry.diff);
                          return (
                            <div className={`rg-review-entry rg-review-entry--${entry.operation}`} key={entryId}>
                              <button
                                type="button"
                                className="rg-review-entry__toggle"
                                aria-expanded={expanded}
                                aria-controls={`review-diff-${safeId(entryId)}`}
                                onClick={() => toggleEntry(entryId)}
                              >
                                {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                <OperationIcon operation={entry.operation} />
                                <span className="rg-review-entry__path"><code>{entry.path}</code><small>{entry.note ?? operationDescription(entry)}</small></span>
                                <span className="rg-review-entry__meta">
                                  <span className={`rg-review-operation rg-review-operation--${entry.operation}`}>{operationLabel(entry.operation)}</span>
                                  {entry.driftStatus === 'clean' || entry.driftStatus === 'not-applicable' ? null : <span className="rg-review-drift">{driftLabel(entry.driftStatus)}</span>}
                                  {lines.added === 0 ? null : <span className="rg-review-lines rg-review-lines--added">+{lines.added}</span>}
                                  {lines.removed === 0 ? null : <span className="rg-review-lines rg-review-lines--removed">-{lines.removed}</span>}
                                </span>
                              </button>
                              {expanded ? <div id={`review-diff-${safeId(entryId)}`}><UnifiedDiff entry={entry} redacted={unit.content === 'mcp'} /></div> : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <aside className="rg-review-summary" aria-label="Apply summary">
          {result === null ? (
            <>
              <header>
                <p className="rg-eyebrow">Apply summary</p>
                <h2>{counts.actionable === 0 ? 'Nothing ready to apply' : `${selectedUnits.length} ready unit${selectedUnits.length === 1 ? '' : 's'} selected`}</h2>
                <p>Only checked, ready units are included in the final digest check.</p>
              </header>
              <dl className="rg-review-counts">
                <div><dt>Ready</dt><dd>{counts.actionable}</dd></div>
                <div><dt>Blocked</dt><dd>{counts.blocked}</dd></div>
                <div><dt>Writes</dt><dd>{counts.writes}</dd></div>
                <div><dt>Removals</dt><dd>{counts.removals}</dd></div>
              </dl>
              <section>
                <h3>Selected targets</h3>
                {selectedUnits.length === 0 ? <p className="rg-muted">Select at least one ready unit in the ledger.</p> : (
                  <ul className="rg-review-targets">
                    {selectedUnits.map((unit) => <li key={unit.key}><span className="rg-provider-glyph" aria-hidden="true">{providerInitial(unit.provider)}</span><span><strong>{providerLabel(unit.provider)}</strong><small>{contentLabel(unit.content)}</small></span><CheckCircle2 size={15} aria-hidden="true" /></li>)}
                  </ul>
                )}
              </section>
              {requiresDriftConfirmation ? (
                <section className="rg-review-drift-confirmation">
                  <h3><AlertTriangle size={15} aria-hidden="true" /> External changes detected</h3>
                  <p>At least one selected provider file changed outside Reglet.</p>
                  <label>
                    <input type="checkbox" checked={confirmDrift} onChange={(event) => setConfirmDrift(event.target.checked)} disabled={busy} />
                    <span>I understand that Apply will replace the reviewed provider state.</span>
                  </label>
                </section>
              ) : null}
              <section className="rg-review-recovery-copy">
                <h3><ShieldCheck size={15} aria-hidden="true" /> Recovery is recorded</h3>
                <p>Reglet snapshots each existing target before writing and records absent targets. Completed units receive individual recovery receipts.</p>
              </section>
            </>
          ) : <ApplyResultSummary result={result} onOpenActivity={onOpenActivity} />}
        </aside>
      </div>

      <footer className="rg-review-action-bar">
        <div>
          {review === null ? <span>No reviewed batch</span> : <span>Batch <code title={review.digest}>{shortHash(review.digest)}</code></span>}
          <Shortcut keys={[commandModifier, 'Enter']} label="Apply selected" />
        </div>
        <div>
          <Button tone="secondary" onClick={onClose} disabled={busy}>{result === null ? 'Back' : 'Done'}</Button>
          {result === null ? (
            <Button
              className="rg-review-apply"
              tone="primary"
              aria-keyshortcuts="Meta+Enter Control+Enter"
              disabled={!canApply}
              icon={busy ? <LoaderCircle className="rg-spin" size={15} /> : <Check size={15} />}
              onClick={() => void applyReviewedUnits()}
            >
              {phase === 'revalidating' ? 'Checking for changes…' : phase === 'applying' ? 'Applying…' : selectedUnits.length === 0 ? 'Select a ready unit' : `Apply ${selectedUnits.length} ready unit${selectedUnits.length === 1 ? '' : 's'}`}
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function ReviewFilterButton({ label, count, value, active, onFilter }: {
  label: string;
  count: number;
  value: ReviewFilter;
  active: boolean;
  onFilter: (filter: ReviewFilter) => void;
}) {
  return <button type="button" aria-pressed={active} onClick={() => onFilter(value)}><span>{label}</span><small>{count}</small></button>;
}

function OperationIcon({ operation }: { operation: ManagerProjectionReviewEntryV3['operation'] }) {
  if (operation === 'write') return <FilePenLine className="rg-review-entry__icon" size={15} aria-hidden="true" />;
  if (operation === 'remove') return <FileMinus2 className="rg-review-entry__icon" size={15} aria-hidden="true" />;
  return <Minus className="rg-review-entry__icon" size={15} aria-hidden="true" />;
}

function UnifiedDiff({ entry, redacted }: { entry: ManagerProjectionReviewEntryV3; redacted: boolean }) {
  const lines = useMemo(() => entry.diff.split('\n'), [entry.diff]);
  if (entry.diff.length === 0) {
    return <div className="rg-review-diff rg-review-diff--empty" role="region" aria-label={`${redacted ? 'Redacted' : 'Exact'} diff for ${entry.path}`}>{entry.note ?? 'No textual difference is available for this operation.'}</div>;
  }
  return (
    <div className="rg-review-diff" role="region" aria-label={`${redacted ? 'Redacted' : 'Exact'} unified diff for ${entry.path}`} tabIndex={0}>
      {redacted ? <p className="rg-review-diff__notice">Credential-like MCP values are hidden in this preview.</p> : null}
      <pre><code>{lines.map((line, index) => <span className={diffLineClass(line)} key={`${index}:${line}`}>{line.length === 0 ? ' ' : line}</span>)}</code></pre>
    </div>
  );
}

function ApplyResultSummary({ result, onOpenActivity }: { result: ProjectionApplyResult; onOpenActivity: () => void }) {
  const hasFailures = result.summary.failed > 0 || result.summary.blocked > 0;
  return (
    <>
      <header className="rg-review-result-heading">
        {hasFailures ? <CircleAlert size={24} aria-hidden="true" /> : <CheckCircle2 size={24} aria-hidden="true" />}
        <div>
          <p className="rg-eyebrow">Apply complete</p>
          <h2>{hasFailures ? 'Some units need attention' : 'Provider files are updated'}</h2>
          <p>{result.summary.applied} applied, {result.summary.blocked} blocked, {result.summary.failed} failed.</p>
        </div>
      </header>
      <ul className="rg-review-outcomes">
        {result.units.map((unit) => (
          <li key={unit.key}>
            {unit.status === 'applied' ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
            <span>
              <strong>{providerLabel(unit.provider)} · {contentLabel(unit.content)}</strong>
              <small>{capitalize(unit.status)}{unit.receiptId === undefined ? '' : ` · receipt ${shortHash(unit.receiptId)}`}</small>
              {unit.issues.length === 0 ? null : <ul>{unit.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
            </span>
          </li>
        ))}
      </ul>
      <section className="rg-review-recovery-copy">
        <h3><History size={15} aria-hidden="true" /> Review receipts and recovery</h3>
        <p>Activity records each outcome. Successful units with receipts can be inspected and restored independently.</p>
        <Button tone="secondary" icon={<History size={14} />} onClick={onOpenActivity}>Open activity</Button>
      </section>
    </>
  );
}

function defaultSelectedKeys(review: ManagerProjectionReviewV3): Set<string> {
  return new Set(review.units.filter(isActionable).map((unit) => unit.key));
}

function defaultExpandedEntries(review: ManagerProjectionReviewV3): Set<string> {
  for (const unit of review.units) {
    const index = unit.entries.findIndex((entry) => entry.operation !== 'skip');
    if (index >= 0) return new Set([`${unit.key}:${index}`]);
  }
  return new Set();
}

function isActionable(unit: ManagerProjectionReviewUnitV3): boolean {
  return unit.status === 'ready' && unit.entries.some((entry) => entry.operation === 'write' || entry.operation === 'remove');
}

function reviewsMatch(visible: ManagerProjectionReviewUnitV3[], fresh: ManagerProjectionReviewUnitV3[]): boolean {
  if (visible.length !== fresh.length) return false;
  const freshUnits = new Map(fresh.map((unit) => [unit.key, unit]));
  return visible.every((unit) => {
    const next = freshUnits.get(unit.key);
    return next?.digest === unit.digest && next.status === unit.status && isActionable(next) === isActionable(unit) &&
      next.requiresDriftConfirmation === unit.requiresDriftConfirmation;
  });
}

function entriesForFilter(unit: ManagerProjectionReviewUnitV3, filter: ReviewFilter) {
  return unit.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => filter === 'all' || filter === 'blocked' || entry.operation === filter);
}

function unitMatchesFilter(unit: ManagerProjectionReviewUnitV3, filter: ReviewFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'blocked') return unit.status === 'blocked';
  return unit.entries.some((entry) => entry.operation === filter);
}

function entryCounts(entries: ManagerProjectionReviewEntryV3[]) {
  return entries.reduce((counts, entry) => ({
    writes: counts.writes + (entry.operation === 'write' ? 1 : 0),
    removals: counts.removals + (entry.operation === 'remove' ? 1 : 0),
  }), { writes: 0, removals: 0 });
}

function reviewCounts(review: ManagerProjectionReviewV3 | null) {
  if (review === null) return { actionable: 0, blocked: 0, writes: 0, removals: 0 };
  return review.units.reduce((counts, unit) => {
    const entries = entryCounts(unit.entries);
    return {
      actionable: counts.actionable + (isActionable(unit) ? 1 : 0),
      blocked: counts.blocked + (unit.status === 'blocked' ? 1 : 0),
      writes: counts.writes + entries.writes,
      removals: counts.removals + entries.removals,
    };
  }, { actionable: 0, blocked: 0, writes: 0, removals: 0 });
}

function changedLineCounts(diff: string) {
  return diff.split('\n').reduce((counts, line) => ({
    added: counts.added + (line.startsWith('+') && !line.startsWith('+++') ? 1 : 0),
    removed: counts.removed + (line.startsWith('-') && !line.startsWith('---') ? 1 : 0),
  }), { added: 0, removed: 0 });
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'rg-review-diff__line rg-review-diff__line--added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'rg-review-diff__line rg-review-diff__line--removed';
  if (line.startsWith('@@')) return 'rg-review-diff__line rg-review-diff__line--hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'rg-review-diff__line rg-review-diff__line--file';
  return 'rg-review-diff__line';
}

function operationDescription(entry: ManagerProjectionReviewEntryV3): string {
  if (entry.operation === 'skip') return 'No file change required';
  if (entry.snapshotBehavior === 'snapshot-before-write') return 'Snapshot current target before changing it';
  if (entry.snapshotBehavior === 'record-absence') return 'Record that the target did not exist';
  return entry.operation === 'remove' ? 'Remove the reviewed provider target' : 'Write the reviewed provider target';
}

function operationLabel(operation: ManagerProjectionReviewEntryV3['operation']): string {
  return operation === 'write' ? 'Write' : operation === 'remove' ? 'Remove' : 'No change';
}

function driftLabel(drift: ManagerProjectionReviewEntryV3['driftStatus']): string {
  return drift === 'modified' ? 'Modified outside Reglet'
    : drift === 'missing' ? 'Missing target'
      : drift === 'unmanaged' ? 'Unmanaged target'
        : drift === 'not-applicable' ? 'Not applicable'
          : 'Clean';
}

function providerLabel(provider: ManagerProviderId): string {
  const labels: Record<ManagerProviderId, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    gemini: 'Gemini CLI',
    windsurf: 'Windsurf',
    opencode: 'OpenCode',
  };
  return labels[provider];
}

function providerInitial(provider: ManagerProviderId): string {
  return providerLabel(provider).slice(0, 1).toLocaleUpperCase();
}

function contentLabel(content: ManagerContentId): string {
  return content === 'rules' ? 'Instructions' : content === 'skills' ? 'Skills' : 'MCP servers';
}

function shortHash(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

function safeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/gu, '-');
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : 'The manager operation failed.';
}

function readProjectionApplyResult(value: JsonValue): ProjectionApplyResult | null {
  if (!isJsonRecord(value) || value.version !== 1 || !Array.isArray(value.units) || !isJsonRecord(value.summary)) return null;
  const units: ProjectionApplyUnitOutcome[] = [];
  const keys = new Set<string>();
  for (const unit of value.units) {
    if (!isJsonRecord(unit) || typeof unit.key !== 'string' || !isProvider(unit.provider) || !isContent(unit.content) ||
      unit.key !== `${unit.provider}:${unit.content}` || keys.has(unit.key) ||
      (unit.status !== 'applied' && unit.status !== 'blocked' && unit.status !== 'failed') ||
      !Array.isArray(unit.issues) || !unit.issues.every((issue) => typeof issue === 'string') ||
      (unit.receiptId !== undefined && typeof unit.receiptId !== 'string') ||
      (unit.completedAt !== undefined && typeof unit.completedAt !== 'string')) return null;
    keys.add(unit.key);
    units.push({
      key: unit.key,
      provider: unit.provider,
      content: unit.content,
      status: unit.status,
      issues: unit.issues,
      ...(typeof unit.receiptId === 'string' ? { receiptId: unit.receiptId } : {}),
      ...(typeof unit.completedAt === 'string' ? { completedAt: unit.completedAt } : {}),
    });
  }
  const { applied, blocked, failed } = value.summary;
  if (!isCount(applied) || !isCount(blocked) || !isCount(failed)) return null;
  const observed = units.reduce((counts, unit) => ({
    applied: counts.applied + (unit.status === 'applied' ? 1 : 0),
    blocked: counts.blocked + (unit.status === 'blocked' ? 1 : 0),
    failed: counts.failed + (unit.status === 'failed' ? 1 : 0),
  }), { applied: 0, blocked: 0, failed: 0 });
  if (observed.applied !== applied || observed.blocked !== blocked || observed.failed !== failed) return null;
  return { version: 1, units, summary: { applied, blocked, failed } };
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isProvider(value: JsonValue | undefined): value is ManagerProviderId {
  return typeof value === 'string' && ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'].includes(value);
}

function isContent(value: JsonValue | undefined): value is ManagerContentId {
  return value === 'rules' || value === 'skills' || value === 'mcp';
}

function isJsonRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
