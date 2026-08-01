import { AlertTriangle, FileSearch, FolderPlus, Inbox, ScanSearch, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JsonValue, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';

export interface ProjectInboxWorkbenchProps {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}

export function ProjectInboxWorkbench({ client, snapshot, onRefresh, onError }: ProjectInboxWorkbenchProps) {
  const discoveries = snapshot?.projectInbox?.discoveries ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<JsonValue>();
  const [busy, setBusy] = useState(false);
  const selected = useMemo(
    () => discoveries.find((discovery) => discovery.id === selectedId) ?? discoveries[0],
    [discoveries, selectedId],
  );

  useEffect(() => { setPreview(undefined); }, [selected?.id]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { onError(messageFrom(error)); } finally { setBusy(false); }
  };

  const previewPromotion = () => run(async () => {
    if (selected === undefined) return;
    setPreview((await client.command('project.promotion-preview', { discoveryId: selected.id })).data);
  });

  const promote = () => run(async () => {
    if (selected === undefined) return;
    await client.command('project.promote', {
      discoveryId: selected.id,
      targets: selected.recognizedBy,
      confirmExecutables: true,
      ...(firstServerName(preview) === undefined ? {} : { serverName: firstServerName(preview) }),
    });
    setPreview(undefined);
    await onRefresh();
  });

  return (
    <>
      <Pane label="Project discoveries" className="rg-collection rg-operation-list">
        <PaneHeader><span>Project Inbox</span><Button tone="quiet" icon={<ScanSearch size={15} />} disabled={busy} onClick={() => void run(async () => {
          await client.command('project.scan', {});
          await onRefresh();
        })}>Scan</Button></PaneHeader>
        <div className="rg-collection-label">Read-only discoveries</div>
        <div className="rg-artifact-list">
          {discoveries.length === 0 ? <EmptyInbox /> : discoveries.map((discovery) => (
            <Row
              key={discovery.id}
              active={selected?.id === discovery.id}
              leading={<FileSearch size={15} />}
              trailing={<small>{discovery.state}</small>}
              onClick={() => setSelectedId(discovery.id)}
            >
              {discovery.relativePath}
            </Row>
          ))}
        </div>
      </Pane>
      <Pane label="Promotion review" className="rg-operation-canvas">
        <PaneHeader><span>Promotion review</span><span>{selected?.kind ?? 'No selection'}</span></PaneHeader>
        {selected === undefined ? <EmptyInbox /> : (
          <div className="rg-detail-document">
            <header><span className="rg-detail-icon"><Inbox size={18} /></span><div><h1>{selected.relativePath}</h1><p>{selected.scopeSummary}</p></div></header>
            <dl className="rg-key-values">
              <div><dt>State</dt><dd>{selected.state}</dd></div>
              <div><dt>Recognized by</dt><dd>{selected.recognizedBy.join(', ')}</dd></div>
              <div><dt>Formats</dt><dd>{selected.providerFormats.join(', ') || 'Unknown'}</dd></div>
              <div><dt>Source</dt><dd><code>{selected.sourceHash.slice(0, 16)}</code></dd></div>
              <div><dt>Size</dt><dd>{selected.size.toLocaleString()} bytes</dd></div>
            </dl>
            {selected.skillRisks.length === 0 ? null : (
              <div className="rg-inline-notice"><AlertTriangle size={15} /><span>{selected.skillRisks.join(', ')}</span></div>
            )}
            <section className="rg-detail-section">
              <h2>Scope decision</h2>
              <p>Reglet will recommend Global instruction only for root-level, always-active guidance. Scoped or nested guidance becomes a skill by default.</p>
              <Button tone="secondary" disabled={busy} onClick={() => void previewPromotion()}>Preview promotion</Button>
            </section>
            {preview === undefined ? null : <PromotionSummary preview={preview} />}
          </div>
        )}
      </Pane>
      <Pane label="Promotion inspector" className="rg-inspector" tone="raised">
        <PaneHeader><span>Promotion inspector</span></PaneHeader>
        <section className="rg-inspector-section">
          <h2>Safety boundary</h2>
          <div className="rg-artifact-summary"><ShieldCheck size={17} /><span><strong>Project files stay read-only</strong><small>Only deliberately promoted canonical content can sync or project.</small></span></div>
        </section>
        <section className="rg-inspector-section">
          <h2>Actions</h2>
          <div className="rg-action-stack">
            <Button tone="secondary" disabled={busy || selected === undefined} onClick={() => void previewPromotion()}>Preview</Button>
            <Button tone="primary" disabled={busy || selected === undefined || preview === undefined} onClick={() => void promote()}>Promote reviewed</Button>
          </div>
        </section>
      </Pane>
    </>
  );
}

function PromotionSummary({ preview }: { preview: JsonValue }) {
  return (
    <section className="rg-detail-section">
      <h2>Proposed canonical artifact</h2>
      <dl className="rg-key-values">
        <div><dt>Kind</dt><dd>{readString(preview, 'kind') || 'Unknown'}</dd></div>
        <div><dt>Mode</dt><dd>{readString(preview, 'mode') || 'Normalized MCP'}</dd></div>
        <div><dt>Server</dt><dd>{firstServerName(preview) ?? '—'}</dd></div>
      </dl>
    </section>
  );
}

function EmptyInbox() {
  return <div className="rg-empty-canvas"><FolderPlus size={22} /><strong>No project discoveries</strong><span>Add a development root in Settings, then scan for provider guidance.</span></div>;
}

function firstServerName(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.servers)) return undefined;
  const first = value.servers[0];
  return isRecord(first) && typeof first.name === 'string' ? first.name : undefined;
}

function readString(value: JsonValue, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : '';
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Project Inbox operation failed.';
}
