import {
  BookOpen,
  Box,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileCheck2,
  FileInput,
  FileText,
  LoaderCircle,
  Network,
  Play,
  ShieldOff,
  Sparkles,
  FolderOpen,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  JsonValue,
  ManagerContentId,
  ManagerProviderId,
  ManagerProviderSourceItemV3,
  ManagerProviderSourceV3,
  ManagerProviderV3,
  ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';
import { StatusBadge } from '../../design-system/StatusBadge.js';
import { ProviderSourceActionSheet, type ProviderSourceAction } from './ProviderSourceActionSheet.js';

const contentIds: readonly ManagerContentId[] = ['rules', 'skills', 'mcp'];

export function ProvidersWorkbench({ client, snapshot, onError, onRefresh, onReview }: {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
  onReview: (provider: ManagerProviderId, content: ManagerContentId) => void;
}) {
  const providers = snapshot?.providers ?? [];
  const [selectedId, setSelectedId] = useState<ManagerProviderV3['id']>();
  const [effective, setEffective] = useState<JsonValue>();
  const [action, setAction] = useState<ProviderSourceAction | null>(null);
  const [busySource, setBusySource] = useState<string | null>(null);
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId) ?? providers[0], [providers, selectedId]);

  useEffect(() => {
    setEffective(undefined);
    if (selected === undefined) return;
    void client.command('provider.effective', { provider: selected.id })
      .then((result) => setEffective(result.data))
      .catch((error: unknown) => onError(error instanceof Error ? error.message : 'Provider inspection failed.'));
  }, [client, onError, selected]);

  const resumeManaging = async (provider: ManagerProviderId, content: ManagerContentId) => {
    const key = `${provider}:${content}`;
    setBusySource(key);
    try {
      await client.command('provider.source.start-managing', { provider, content });
      await onRefresh();
      onReview(provider, content);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Reglet could not resume provider management.');
    } finally {
      setBusySource(null);
    }
  };

  const revealSource = (provider: ManagerProviderId, content: ManagerContentId) => {
    void client.command('external.reveal', {
      target: { kind: 'provider', provider, content },
    }).catch((revealError: unknown) => {
      onError(revealError instanceof Error ? revealError.message : 'Could not reveal provider path in filesystem.');
    });
  };

  return (
    <>
      <Pane label="Providers" className="rg-collection rg-operation-list">
        <PaneHeader><span>Providers</span><span>{providers.filter((provider) => provider.detected).length} detected</span></PaneHeader>
        <div className="rg-collection-label">This machine</div>
        <div className="rg-artifact-list">
          {providers.map((provider) => <Row
            key={provider.id}
            active={selected?.id === provider.id}
            leading={<span className="rg-provider-glyph">{providerInitial(provider.id)}</span>}
            trailing={provider.detected ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
            onClick={() => setSelectedId(provider.id)}
          >{provider.displayName}</Row>)}
        </div>
      </Pane>

      <Pane label="Provider sources and outputs" className="rg-operation-canvas rg-provider-workspace">
        <PaneHeader><span>Sources and outputs</span><span>{selected?.id ?? 'No provider'}</span></PaneHeader>
        {selected === undefined ? <div className="rg-empty-canvas"><Box size={22} /><strong>No providers available</strong><span>Reglet will list supported adapters after the local runtime is ready.</span></div> : (
          <div className="rg-provider-document">
            <header className="rg-provider-hero">
              <span className="rg-provider-glyph" aria-hidden="true">{providerInitial(selected.id)}</span>
              <div><p className="rg-eyebrow">Provider adapter</p><h1>{selected.displayName}</h1><p>{selected.detected ? 'Detected on this machine. Inspect what the provider reads and which content Reglet owns.' : 'The adapter is available, but this provider was not detected on this machine.'}</p></div>
              <span className={`rg-provider-presence rg-provider-presence--${selected.detected ? 'detected' : 'missing'}`}>{selected.detected ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}{selected.detected ? 'Detected' : 'Not detected'}</span>
            </header>

            <section className="rg-provider-sources" aria-labelledby="provider-sources-title">
              <header><div><h2 id="provider-sources-title">Content ownership</h2><p>Provider files are sources or reviewed outputs. The canonical library remains authoritative.</p></div></header>
              {contentIds.map((content) => {
                const source = sourceFor(selected, content);
                const supported = capabilityFor(selected, content).supported;
                const hasProjection = selected.projections.some((projection) => contentForArtifact(snapshot, projection.artifactId) === content && projection.status !== 'not-targeted');
                return <ProviderSourceRow
                  key={content}
                  provider={selected}
                  source={source}
                  supported={supported}
                  hasProjection={hasProjection}
                  busy={busySource === `${selected.id}:${content}`}
                  onAction={setAction}
                  onReview={() => onReview(selected.id, content)}
                  onResume={() => void resumeManaging(selected.id, content)}
                  onReveal={() => revealSource(selected.id, content)}
                />;
              })}
            </section>
          </div>
        )}
      </Pane>

      <Pane label="Provider evidence" className="rg-inspector rg-provider-inspector" tone="raised">
        <PaneHeader><span>Provider evidence</span></PaneHeader>
        {selected === undefined ? null : <>
          <section className="rg-inspector-section"><h2>Projection summary</h2><div className="rg-provider-projection-summary">{projectionSummary(selected).map(({ status, count }) => <div key={status}><StatusBadge status={status} /><strong>{count}</strong></div>)}{selected.projections.length === 0 ? <span className="rg-muted">No recorded projections.</span> : null}</div></section>
          <section className="rg-inspector-section"><h2>Adapter contract</h2><dl className="rg-key-values"><div><dt>Schema</dt><dd>v{selected.schemaVersion}</dd></div><div><dt>Verified</dt><dd>{selected.lastVerifiedAt}</dd></div></dl><CapabilityRows provider={selected} /><Button tone="secondary" icon={<ExternalLink size={14} />} onClick={() => window.open(selected.documentationUrl, '_blank', 'noopener,noreferrer')}>Documentation</Button></section>
          <section className="rg-inspector-section"><h2>Effective composition</h2><details className="rg-provider-effective"><summary>{effective === undefined ? 'Loading current composition…' : 'Inspect redacted composition'}</summary>{effective === undefined ? <span className="rg-muted">Reading provider state.</span> : <pre>{JSON.stringify(effective, null, 2)}</pre>}</details></section>
        </>}
      </Pane>

      <ProviderSourceActionSheet action={action} client={client} providers={providers} onClose={() => setAction(null)} onRefresh={onRefresh} onReview={onReview} />
    </>
  );
}

function ProviderSourceRow({ provider, source, supported, hasProjection, busy, onAction, onReview, onResume, onReveal }: {
  provider: ManagerProviderV3;
  source: ManagerProviderSourceV3;
  supported: boolean;
  hasProjection: boolean;
  busy: boolean;
  onAction: (action: ProviderSourceAction) => void;
  onReview: () => void;
  onResume: () => void;
  onReveal?: () => void;
}) {
  const unmanaged = source.items.filter((item) => item.ownership === 'unmanaged');
  const managed = source.ownership === 'managed' || source.ownership === 'mixed';
  const canResume = supported && source.exists && source.ownership === 'unmanaged' && hasProjection;
  const Icon = source.content === 'rules' ? BookOpen : source.content === 'skills' ? Sparkles : Network;
  return <article className={`rg-provider-source rg-provider-source--${source.ownership}`}>
    <header>
      <span className="rg-provider-source__icon"><Icon size={17} aria-hidden="true" /></span>
      <span><strong>{contentLabel(source.content)}</strong><small>{source.path ?? 'No provider path detected'}</small></span>
      <OwnershipBadge source={source} supported={supported} />
      {source.path && onReveal ? (
        <Button tone="quiet" icon={<FolderOpen size={13} />} onClick={onReveal} aria-label={`Reveal ${source.path}`}>
          Reveal
        </Button>
      ) : null}
    </header>
    {source.issues.length === 0 ? null : <div className="rg-provider-source__issues">{source.issues.map((issue) => <span key={`${issue.code}:${issue.message}`}><FileText size={13} /><span><strong>{issue.code}</strong>{issue.message}</span></span>)}</div>}
    <div className="rg-provider-source__items">
      {!supported ? <div className="rg-provider-source__empty">{capabilityIssue(provider, source.content) ?? `${contentLabel(source.content)} is not supported by this adapter.`}</div> : source.items.length === 0 ? <div className="rg-provider-source__empty">{source.exists ? 'No source items were found at this provider path.' : 'No existing provider source. A reviewed canonical projection can create it.'}</div> : source.items.map((item) => <SourceItem key={item.id} provider={provider} source={source} item={item} onAdopt={() => onAction({ kind: 'adopt', provider, source, item })} />)}
    </div>
    <footer>
      {managed ? <><Button data-review-trigger="providers" tone="secondary" icon={<FileCheck2 size={14} />} onClick={onReview}>Review changes</Button><Button tone="quiet" icon={<ShieldOff size={14} />} onClick={() => onAction({ kind: 'detach', provider, source })}>Stop managing</Button></> : null}
      {canResume ? <Button tone="secondary" icon={busy ? <LoaderCircle className="rg-spin" size={14} /> : <Play size={14} />} disabled={busy} onClick={onResume}>{busy ? 'Resuming…' : 'Resume managing'}</Button> : null}
      {!source.exists && supported && hasProjection ? <Button data-review-trigger="providers" tone="secondary" icon={<FileCheck2 size={14} />} onClick={onReview}>Review creation</Button> : null}
      {unmanaged.length > 0 && !canResume ? <span>Adopt an item to preserve provider-only content in the canonical library.</span> : null}
    </footer>
  </article>;
}

function SourceItem({ provider, source, item, onAdopt }: { provider: ManagerProviderV3; source: ManagerProviderSourceV3; item: ManagerProviderSourceItemV3; onAdopt: () => void }) {
  return <div className="rg-provider-source-item"><span className={`rg-source-dot rg-source-dot--${item.ownership}`} aria-hidden="true" /><span><strong>{item.label}</strong><small>{ownershipLabel(item.ownership)}</small></span>{item.ownership === 'unmanaged' ? <Button tone="secondary" icon={<FileInput size={14} />} onClick={onAdopt}>Adopt</Button> : item.ownership === 'managed' ? <span className="rg-provider-source-item__owner">Owned by Reglet</span> : <span className="rg-provider-source-item__owner">Ownership unknown</span>}<span className="sr-only">{provider.displayName} {contentLabel(source.content)}</span></div>;
}

function OwnershipBadge({ source, supported }: { source: ManagerProviderSourceV3; supported: boolean }) {
  const state = supported ? source.ownership : 'unsupported';
  return <span className={`rg-ownership-badge rg-ownership-badge--${state}`}>{state === 'managed' ? <CheckCircle2 size={13} /> : state === 'empty' ? <CircleDashed size={13} /> : state === 'unsupported' ? <ShieldOff size={13} /> : <Box size={13} />}{state === 'unsupported' ? 'Unsupported' : ownershipLabel(source.ownership)}</span>;
}

function CapabilityRows({ provider }: { provider: ManagerProviderV3 }) {
  const labels: Record<keyof ManagerProviderV3['capabilities'], string> = {
    instructions: 'Instructions',
    skills: 'Skills',
    mcp: 'MCP servers',
  };
  return <div className="rg-capability-list">{Object.entries(provider.capabilities).map(([name, capability]) => <div key={name}><span>{labels[name as keyof typeof labels]}</span><strong>{capability.supported ? 'Supported' : 'Blocked'}</strong>{capability.issue === undefined ? null : <small>{capability.issue}</small>}</div>)}</div>;
}

function sourceFor(provider: ManagerProviderV3, content: ManagerContentId): ManagerProviderSourceV3 {
  return provider.sources.find((source) => source.content === content) ?? { provider: provider.id, content, path: null, exists: false, readable: true, ownership: 'empty', items: [], issues: [] };
}

function capabilityFor(provider: ManagerProviderV3, content: ManagerContentId) {
  return content === 'rules' ? provider.capabilities.instructions : content === 'skills' ? provider.capabilities.skills : provider.capabilities.mcp;
}

function capabilityIssue(provider: ManagerProviderV3, content: ManagerContentId): string | undefined {
  return capabilityFor(provider, content).issue;
}

function contentForArtifact(snapshot: ManagerSnapshotV3 | null, artifactId: string): ManagerContentId | undefined {
  const kind = snapshot?.library.artifacts.find((artifact) => artifact.metadata.id === artifactId)?.metadata.kind;
  return kind === 'instruction' ? 'rules' : kind === 'skill' ? 'skills' : kind === 'mcp' ? 'mcp' : undefined;
}

function projectionSummary(provider: ManagerProviderV3) {
  const states = ['error', 'blocked', 'drifted', 'missing', 'pending', 'applied'] as const;
  return states.map((status) => ({ status, count: provider.projections.filter((projection) => projection.status === status).length })).filter((entry) => entry.count > 0);
}

function contentLabel(content: ManagerContentId): string {
  return content === 'rules' ? 'Instructions' : content === 'skills' ? 'Skills' : 'MCP servers';
}

function ownershipLabel(ownership: ManagerProviderSourceV3['ownership'] | ManagerProviderSourceItemV3['ownership']): string {
  return ownership === 'empty' ? 'Empty' : ownership === 'managed' ? 'Managed' : ownership === 'unmanaged' ? 'Unmanaged' : ownership === 'mixed' ? 'Mixed ownership' : 'Unknown';
}

function providerInitial(provider: ManagerProviderId): string {
  const labels: Record<ManagerProviderId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', windsurf: 'Windsurf', opencode: 'OpenCode' };
  return labels[provider].slice(0, 1).toLocaleUpperCase();
}
