import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileClock,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  isManagerRecoveryReceiptV3,
  isManagerRecoveryRestoreResultV3,
  isManagerRecoveryReviewV3,
  type ManagerActivityV3,
  type ManagerRecoveryReceiptV3,
  type ManagerRecoveryRestoreResultV3,
  type ManagerRecoveryReviewV3,
  type ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';
import { useDialogFocus } from '../../design-system/useDialogFocus.js';

interface ActivityWorkbenchProps {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
}

export function ActivityWorkbench({ client, snapshot, onError, onRefresh }: ActivityWorkbenchProps) {
  const activity = snapshot?.activity ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<'operations' | 'recovery'>('operations');
  const [receipts, setReceipts] = useState<ManagerRecoveryReceiptV3[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>();
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [recoveryReceipt, setRecoveryReceipt] = useState<ManagerRecoveryReceiptV3 | null>(null);
  const selected = useMemo(() => activity.find((item) => item.id === selectedId) ?? activity[0], [activity, selectedId]);
  const selectedReceipt = useMemo(() => receipts.find((item) => item.id === selectedReceiptId) ?? receipts[0], [receipts, selectedReceiptId]);

  const loadReceipts = async () => {
    setReceiptLoading(true);
    try {
      const response = await client.command('recovery.list', { limit: 50 });
      if (!Array.isArray(response.data)) {
        throw new Error('Reglet returned invalid recovery receipts.');
      }
      const nextReceipts: ManagerRecoveryReceiptV3[] = [];
      for (const entry of response.data) {
        if (!isManagerRecoveryReceiptV3(entry)) throw new Error('Reglet returned invalid recovery receipts.');
        nextReceipts.push(entry);
      }
      setReceipts(nextReceipts);
    } catch (error) {
      onError(messageFrom(error));
    } finally {
      setReceiptLoading(false);
    }
  };

  useEffect(() => {
    void loadReceipts();
  }, [client]);

  return (
    <>
      <Pane label="Activity records" className="rg-collection rg-operation-list rg-activity-list">
        <PaneHeader><span>Activity</span><span>{mode === 'operations' ? `${activity.length} recent` : `${receipts.length} receipts`}</span></PaneHeader>
        <div className="rg-activity-modes" role="group" aria-label="Activity view"><button type="button" aria-pressed={mode === 'operations'} onClick={() => setMode('operations')}>Operations</button><button type="button" aria-pressed={mode === 'recovery'} onClick={() => setMode('recovery')}>Recovery</button></div>
        <div className="rg-collection-label">{mode === 'operations' ? 'Operations' : 'Durable receipts'}</div>
        <div className="rg-artifact-list">
          {mode === 'operations' ? activity.length === 0 ? <div className="rg-collection-message"><Activity size={16} /><span>No operations recorded</span></div> : activity.map((item) => <Row key={item.id} active={selected?.id === item.id} leading={item.outcome === 'success' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />} trailing={<small>{relativeTime(item.occurredAt)}</small>} onClick={() => setSelectedId(item.id)}>{item.action}</Row>) : receiptLoading ? <div className="rg-collection-message" role="status"><LoaderCircle className="rg-spin" size={15} /><span>Loading receipts</span></div> : receipts.length === 0 ? <div className="rg-collection-message"><FileClock size={15} /><span>No recovery receipts</span></div> : receipts.map((receipt) => <Row key={receipt.id} active={selectedReceipt?.id === receipt.id} leading={<RotateCcw size={15} />} trailing={<small>{receipt.lifecycle}</small>} onClick={() => setSelectedReceiptId(receipt.id)}>{receipt.providers.length === 0 ? 'Local operation' : receipt.providers.map(providerLabel).join(', ')}</Row>)}
        </div>
      </Pane>
      <Pane label={mode === 'operations' ? 'Activity detail' : 'Recovery detail'} className="rg-operation-canvas">
        <PaneHeader><span>{mode === 'operations' ? 'Operation detail' : 'Recovery detail'}</span></PaneHeader>
        {mode === 'operations' ? selected === undefined ? <div className="rg-empty-canvas"><Activity size={22} /><strong>No activity yet</strong><span>Edits, Apply units, promotion, sync, and recovery will appear here.</span></div> : <ActivityDetail item={selected} /> : selectedReceipt === undefined ? <div className="rg-empty-canvas"><FileClock size={22} /><strong>No recovery receipts</strong><span>Reviewed provider writes will create independently recoverable receipts.</span></div> : <RecoveryReceiptDetail receipt={selectedReceipt} onReview={() => setRecoveryReceipt(selectedReceipt)} />}
      </Pane>
      <Pane label="Recovery receipts" className="rg-inspector rg-recovery-inspector" tone="raised">
        <PaneHeader><span>Recovery</span><span>{receipts.length}</span></PaneHeader>
        <section className="rg-inspector-section"><h2>Durable receipts</h2><p>Review the exact prior filesystem state before restoring it. Reglet never retries an operation from a receipt.</p></section>
        <section className="rg-inspector-section"><div className="rg-artifact-summary"><ShieldCheck size={17} /><span><strong>Exact state, not operation replay</strong><small>Restore reviews current paths against captured fingerprints and creates its own undo receipt.</small></span></div></section>
        <section className="rg-inspector-section"><Button tone="secondary" icon={<RotateCcw size={14} />} onClick={() => setMode('recovery')}>Browse recovery receipts</Button></section>
      </Pane>
      <RecoverySheet receipt={recoveryReceipt} client={client} onClose={() => setRecoveryReceipt(null)} onRefresh={async () => { await Promise.all([onRefresh(), loadReceipts()]); }} />
    </>
  );
}

function RecoveryReceiptDetail({ receipt, onReview }: { receipt: ManagerRecoveryReceiptV3; onReview: () => void }) {
  return <div className="rg-detail-document rg-recovery-document"><header><span className="rg-detail-icon"><RotateCcw size={18} /></span><div><h1>{receipt.providers.length === 0 ? 'Local operation' : receipt.providers.map(providerLabel).join(', ')}</h1><p>{receipt.contents.length === 0 ? 'Filesystem recovery receipt' : receipt.contents.map(contentLabel).join(', ')}</p></div></header><dl className="rg-key-values"><div><dt>Lifecycle</dt><dd>{receipt.lifecycle}</dd></div><div><dt>Targets</dt><dd>{receipt.targetCount}</dd></div><div><dt>Started</dt><dd>{formatDate(receipt.startedAt)}</dd></div><div><dt>Receipt</dt><dd><code>{receipt.id}</code></dd></div></dl><section className="rg-detail-section">{receipt.restorable ? <><h2>Review before restoring</h2><p>Compare every current target with the captured state before Reglet replaces filesystem contents.</p><Button tone="primary" icon={<RotateCcw size={14} />} onClick={onReview}>Review recovery</Button></> : <div className="rg-recovery-refusal"><ShieldCheck size={15} /><span><strong>Restore unavailable</strong><small>{receipt.reason}</small></span></div>}</section></div>;
}

function RecoverySheet({ receipt, client, onClose, onRefresh }: {
  receipt: ManagerRecoveryReceiptV3 | null;
  client: ManagerClient;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [review, setReview] = useState<ManagerRecoveryReviewV3 | null>(null);
  const [result, setResult] = useState<ManagerRecoveryRestoreResultV3 | null>(null);
  const [phase, setPhase] = useState<'loading' | 'review' | 'restoring' | 'complete'>('loading');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'loading' || phase === 'restoring';
  const dialog = useDialogFocus<HTMLElement>(receipt !== null, busy ? undefined : onClose);

  useEffect(() => {
    if (receipt === null) return;
    setReview(null);
    setResult(null);
    setConfirmed(false);
    setError(null);
    setPhase('loading');
    void client.command('recovery.preview', { receiptId: receipt.id }).then((response) => {
      if (!isManagerRecoveryReviewV3(response.data) || response.data.receipt.id !== receipt.id) {
        throw new Error('Reglet returned an invalid recovery review.');
      }
      setReview(response.data);
      setPhase('review');
    }).catch((previewError: unknown) => {
      setError(messageFrom(previewError));
      setPhase('review');
    });
  }, [client, receipt]);

  if (receipt === null) return null;

  const restore = async () => {
    if (review === null || !confirmed) return;
    setPhase('restoring');
    setError(null);
    try {
      const response = await client.command('recovery.restore', { receiptId: receipt.id, digest: review.digest, confirmed: true });
      if (!isManagerRecoveryRestoreResultV3(response.data) || response.data.receiptId !== receipt.id) {
        throw new Error('Reglet could not verify the recovery result. Check Activity before trying again.');
      }
      setResult(response.data);
      await onRefresh();
      setPhase('complete');
    } catch (restoreError) {
      setError(messageFrom(restoreError));
      setPhase('review');
    }
  };

  return <div className="rg-sheet-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
    <aside ref={dialog} tabIndex={-1} className="rg-sheet rg-provider-action-sheet rg-recovery-sheet" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="rg-provider-action-sheet__header"><div><p className="rg-eyebrow">Filesystem recovery</p><h1 id="recovery-title">Review exact recovery</h1></div><button type="button" className="rg-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></header>
      <div className="rg-provider-action-sheet__body">
        {error === null ? null : <div className="rg-review-notice rg-review-notice--error" role="alert"><AlertTriangle size={16} /><span><strong>Recovery needs attention</strong>{error}</span></div>}
        {phase === 'loading' ? <div className="rg-review-state" role="status"><LoaderCircle className="rg-spin" size={22} /><strong>Checking every recovery target</strong><span>Reglet is comparing the current filesystem with the state captured by this receipt.</span></div> : null}
        {phase === 'restoring' ? <div className="rg-review-state" role="status"><LoaderCircle className="rg-spin" size={22} /><strong>Restoring reviewed targets</strong><span>Each target is being restored to the exact state shown in this review.</span></div> : null}
        {phase === 'review' && review !== null ? <RecoveryReview review={review} confirmed={confirmed} onConfirmed={setConfirmed} /> : null}
        {phase === 'review' && review === null && error === null ? <div className="rg-review-state rg-review-state--compact"><AlertTriangle size={21} /><strong>The recovery review is unavailable</strong><span>Close this panel and inspect the receipt again.</span></div> : null}
        {phase === 'complete' && result !== null ? <div className="rg-provider-action-complete"><CheckCircle2 size={24} /><span><strong>{result.actions.length} target{result.actions.length === 1 ? '' : 's'} restored</strong><p>A new undo receipt was created. You can review it from Recovery if this restoration needs to be reversed.</p><code>{result.undoReceiptId}</code></span></div> : null}
      </div>
      <footer className="rg-provider-action-sheet__footer">{phase === 'complete' ? <Button tone="primary" onClick={onClose}>Done</Button> : <><Button tone="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button className="rg-review-apply" tone="primary" icon={<RotateCcw size={15} />} disabled={review === null || !confirmed || busy} onClick={() => void restore()}>Restore {review?.targets.length ?? 0} targets</Button></>}</footer>
    </aside>
  </div>;
}

function RecoveryReview({ review, confirmed, onConfirmed }: { review: ManagerRecoveryReviewV3; confirmed: boolean; onConfirmed: (confirmed: boolean) => void }) {
  return <div className="rg-provider-action-content"><section><h2>Captured operation</h2><p>This restores prior target contents. It does not rerun the original provider operation.</p><dl className="rg-key-values"><div><dt>Providers</dt><dd>{review.receipt.providers.length === 0 ? 'Local' : review.receipt.providers.map(providerLabel).join(', ')}</dd></div><div><dt>Content</dt><dd>{review.receipt.contents.length === 0 ? 'Unspecified' : review.receipt.contents.map(contentLabel).join(', ')}</dd></div><div><dt>Receipt</dt><dd><code>{shortId(review.receipt.id)}</code></dd></div></dl></section><section><h2>Exact target changes</h2><div className="rg-recovery-targets">{review.targets.map((target) => <article key={target.path}><header><span><strong>{target.action === 'removed' ? 'Remove created target' : 'Restore prior target'}</strong><code>{target.path}</code></span><RotateCcw size={15} /></header><div><Fingerprint label="Current" fingerprint={target.current} /><span aria-hidden="true">→</span><Fingerprint label="Restored" fingerprint={target.restored} /></div></article>)}</div></section><section className="rg-provider-detach-confirmation"><label><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} /><span>I reviewed every target and understand that current filesystem contents will be replaced by the captured state.</span></label></section></div>;
}

function Fingerprint({ label, fingerprint }: { label: string; fingerprint: ManagerRecoveryReviewV3['targets'][number]['current'] }) {
  return <span><small>{label}</small><strong>{fingerprint.kind}</strong><code>{fingerprint.hash === null ? 'No content' : `${shortId(fingerprint.hash)} · ${formatSize(fingerprint.size)}`}</code></span>;
}

function ActivityDetail({ item }: { item: ManagerActivityV3 }) {
  return <div className="rg-detail-document"><header><span className="rg-detail-icon"><Activity size={18} /></span><div><h1>{item.action}</h1><p>{new Date(item.occurredAt).toLocaleString()}</p></div></header><dl className="rg-key-values"><div><dt>Outcome</dt><dd>{item.outcome}</dd></div><div><dt>Artifact</dt><dd><code>{item.artifactId ?? 'None'}</code></dd></div><div><dt>Provider</dt><dd>{item.provider ?? 'None'}</dd></div></dl></div>;
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function providerLabel(value: ManagerRecoveryReceiptV3['providers'][number]): string {
  const labels: Record<ManagerRecoveryReceiptV3['providers'][number], string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', windsurf: 'Windsurf', opencode: 'OpenCode' };
  return labels[value];
}

function contentLabel(value: ManagerRecoveryReceiptV3['contents'][number]): string {
  return value === 'rules' ? 'Instructions' : value === 'skills' ? 'Skills' : 'MCP servers';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function formatSize(value: number | null): string {
  if (value === null) return 'Not available';
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(1)} KB`;
}

function shortId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Recovery failed unexpectedly.';
}
