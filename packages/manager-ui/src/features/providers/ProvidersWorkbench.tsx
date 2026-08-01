import { Box, CheckCircle2, CircleDashed, ExternalLink, FileCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JsonValue, ManagerProviderV3, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';
import { StatusBadge } from '../../design-system/StatusBadge.js';

export function ProvidersWorkbench({ client, snapshot, onError }: {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onError: (message: string) => void;
}) {
  const providers = snapshot?.providers ?? [];
  const [selectedId, setSelectedId] = useState<ManagerProviderV3['id']>();
  const [effective, setEffective] = useState<JsonValue>();
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId) ?? providers[0], [providers, selectedId]);

  useEffect(() => {
    setEffective(undefined);
    if (selected === undefined) return;
    void client.command('provider.effective', { provider: selected.id })
      .then((result) => setEffective(result.data))
      .catch((error: unknown) => onError(error instanceof Error ? error.message : 'Provider inspection failed.'));
  }, [client, onError, selected]);

  return (
    <>
      <Pane label="Providers" className="rg-collection rg-operation-list">
        <PaneHeader><span>Providers</span><span>{providers.filter((provider) => provider.detected).length} detected</span></PaneHeader>
        <div className="rg-collection-label">Adapter registry</div>
        <div className="rg-artifact-list">
          {providers.map((provider) => <Row
            key={provider.id}
            active={selected?.id === provider.id}
            leading={<Box size={15} />}
            trailing={provider.detected ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
            onClick={() => setSelectedId(provider.id)}
          >{provider.displayName}</Row>)}
        </div>
      </Pane>
      <Pane label="Effective provider configuration" className="rg-operation-canvas">
        <PaneHeader><span>Effective configuration</span><span>{selected?.id ?? '—'}</span></PaneHeader>
        {selected === undefined ? null : <div className="rg-detail-document">
          <header><span className="rg-detail-icon"><FileCog size={18} /></span><div><h1>{selected.displayName}</h1><p>{selected.detected ? 'Detected on this machine' : 'Adapter available; provider not detected'}</p></div></header>
          <section className="rg-detail-section"><h2>Capabilities</h2><CapabilityRows provider={selected} /></section>
          <section className="rg-detail-section"><h2>Effective composition</h2><pre className="rg-json-preview">{effective === undefined ? 'Loading…' : JSON.stringify(effective, null, 2)}</pre></section>
        </div>}
      </Pane>
      <Pane label="Provider projection inspector" className="rg-inspector" tone="raised">
        <PaneHeader><span>Projection inspector</span></PaneHeader>
        <section className="rg-inspector-section"><h2>Projection states</h2><div className="rg-projection-list">
          {(selected?.projections ?? []).length === 0 ? <span className="rg-inspector-empty">No recorded projections.</span> : null}
          {selected?.projections.map((projection) => <div className="rg-projection-row" key={`${projection.artifactId}:${projection.provider}`}><code>{projection.artifactId.slice(0, 10)}</code><StatusBadge status={projection.status} /></div>)}
        </div></section>
        {selected === undefined ? null : <section className="rg-inspector-section"><h2>Adapter contract</h2><dl className="rg-key-values"><div><dt>Schema</dt><dd>v{selected.schemaVersion}</dd></div><div><dt>Verified</dt><dd>{selected.lastVerifiedAt}</dd></div></dl><Button tone="secondary" icon={<ExternalLink size={14} />} onClick={() => window.open(selected.documentationUrl, '_blank', 'noopener,noreferrer')}>Documentation</Button></section>}
      </Pane>
    </>
  );
}

function CapabilityRows({ provider }: { provider: ManagerProviderV3 }) {
  return <div className="rg-capability-list">{Object.entries(provider.capabilities).map(([name, capability]) => <div key={name}><span>{name}</span><strong>{capability.supported ? 'Supported' : 'Blocked'}</strong>{capability.issue === undefined ? null : <small>{capability.issue}</small>}</div>)}</div>;
}
