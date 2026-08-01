import { Activity, CheckCircle2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ManagerActivityV3, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';

export function ActivityWorkbench({ snapshot }: { snapshot: ManagerSnapshotV3 | null }) {
  const activity = snapshot?.activity ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = useMemo(() => activity.find((item) => item.id === selectedId) ?? activity[0], [activity, selectedId]);
  return (
    <>
      <Pane label="Activity records" className="rg-collection rg-operation-list">
        <PaneHeader><span>Activity</span><span>{activity.length} recent</span></PaneHeader>
        <div className="rg-collection-label">Operations</div>
        <div className="rg-artifact-list">
          {activity.length === 0 ? <div className="rg-collection-message"><Activity size={16} /><span>No operations recorded</span></div> : activity.map((item) => <Row key={item.id} active={selected?.id === item.id} leading={item.outcome === 'success' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />} trailing={<small>{relativeTime(item.occurredAt)}</small>} onClick={() => setSelectedId(item.id)}>{item.action}</Row>)}
        </div>
      </Pane>
      <Pane label="Activity detail" className="rg-operation-canvas">
        <PaneHeader><span>Operation detail</span></PaneHeader>
        {selected === undefined ? <div className="rg-empty-canvas"><Activity size={22} /><strong>No activity yet</strong><span>Edits, Apply units, promotion, sync, and recovery will appear here.</span></div> : <ActivityDetail item={selected} />}
      </Pane>
      <Pane label="Recovery" className="rg-inspector" tone="raised">
        <PaneHeader><span>Recovery</span></PaneHeader>
        <section className="rg-inspector-section"><h2>Durable receipts</h2><div className="rg-artifact-summary"><RotateCcw size={17} /><span><strong>Provider writes are independently recoverable</strong><small>A failed unit rolls back only itself; completed writes keep their receipts.</small></span></div></section>
      </Pane>
    </>
  );
}

function ActivityDetail({ item }: { item: ManagerActivityV3 }) {
  return <div className="rg-detail-document"><header><span className="rg-detail-icon"><Activity size={18} /></span><div><h1>{item.action}</h1><p>{new Date(item.occurredAt).toLocaleString()}</p></div></header><dl className="rg-key-values"><div><dt>Outcome</dt><dd>{item.outcome}</dd></div><div><dt>Artifact</dt><dd><code>{item.artifactId ?? '—'}</code></dd></div><div><dt>Provider</dt><dd>{item.provider ?? '—'}</dd></div></dl></div>;
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}
