import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Box,
  CheckCircle2,
  Cloud,
  FileCheck2,
  Files,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type {
  ManagerArtifactKind,
  ManagerContentId,
  ManagerProjectionStatusV3,
  ManagerProviderId,
  ManagerProviderV3,
  ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import { Button } from '../../design-system/Button.js';
import { StatusBadge } from '../../design-system/StatusBadge.js';
import type { ReviewRequestUnit } from '../review/ReviewApplyWorkbench.js';

interface OverviewWorkbenchProps {
  snapshot: ManagerSnapshotV3 | null;
  onOpenActivity: () => void;
  onOpenLibrary: () => void;
  onOpenProviders: () => void;
  onReview: (units: ReviewRequestUnit[]) => void;
}

const reviewStatuses = new Set<ManagerProjectionStatusV3>(['pending', 'drifted', 'missing', 'blocked', 'error']);
const attentionStatuses = new Set<ManagerProjectionStatusV3>(['drifted', 'missing', 'blocked', 'error']);
const statusPriority: ManagerProjectionStatusV3[] = ['error', 'blocked', 'drifted', 'missing', 'pending', 'applied', 'unsupported', 'not-targeted'];

export function OverviewWorkbench({ snapshot, onOpenActivity, onOpenLibrary, onOpenProviders, onReview }: OverviewWorkbenchProps) {
  const reviewUnits = useMemo(() => projectionReviewUnits(snapshot), [snapshot]);
  const attentionItems = useMemo(() => projectionAttention(snapshot), [snapshot]);
  const providers = snapshot?.providers ?? [];
  const artifacts = snapshot?.library.artifacts ?? [];
  const activeArtifacts = artifacts.filter((artifact) => artifact.metadata.lifecycle === 'active');
  const detectedProviders = providers.filter((provider) => provider.detected).length;
  const diagnosticIssues = snapshot?.diagnostics.issues ?? [];
  const healthy = snapshot?.diagnostics.healthy !== false && attentionItems.length === 0;
  const activity = snapshot?.activity.slice(0, 5) ?? [];

  return (
    <section className="rg-overview" aria-labelledby="overview-heading">
      <header className="rg-overview-hero">
        <div>
          <p className="rg-eyebrow">Canonical library status</p>
          <h1 id="overview-heading">One source of truth, with every provider accounted for</h1>
          <p>Reglet keeps canonical instructions, skills, and MCP definitions separate from the provider files they generate.</p>
        </div>
        <div className={`rg-overview-health rg-overview-health--${healthy ? 'healthy' : 'attention'}`}>
          {snapshot === null ? <RefreshCw className="rg-spin" size={18} aria-hidden="true" /> : healthy ? <CheckCircle2 size={18} aria-hidden="true" /> : <ShieldAlert size={18} aria-hidden="true" />}
          <span>
            <strong>{snapshot === null ? 'Reading local state' : healthy ? 'Local state is healthy' : 'Attention is required'}</strong>
            <small>{snapshot === null ? 'Waiting for the current manager snapshot.' : reviewUnits.length === 0 ? 'No provider units are waiting for review.' : `${reviewUnits.length} provider unit${reviewUnits.length === 1 ? '' : 's'} waiting for review.`}</small>
          </span>
        </div>
      </header>

      <div className="rg-overview-metrics" aria-label="Workspace summary">
        <OverviewMetric icon={<BookOpen size={17} />} label="Canonical artifacts" value={activeArtifacts.length} detail={`${countKind(activeArtifacts, 'instruction')} instructions · ${countKind(activeArtifacts, 'skill')} skills · ${countKind(activeArtifacts, 'mcp')} MCPs`} onClick={onOpenLibrary} />
        <OverviewMetric icon={<Box size={17} />} label="Providers detected" value={`${detectedProviders}/${providers.length}`} detail={providers.length === 0 ? 'No adapter data available' : `${providers.length - detectedProviders} not detected on this machine`} onClick={onOpenProviders} />
        <OverviewMetric icon={<FileCheck2 size={17} />} label="Units to review" value={reviewUnits.length} detail={reviewUnits.length === 0 ? 'Provider outputs are current' : `${attentionItems.length} need attention`} onClick={reviewUnits.length === 0 ? onOpenProviders : () => onReview(reviewUnits)} accent={reviewUnits.length > 0} />
        <OverviewMetric icon={<Cloud size={17} />} label="Encrypted sync" value={syncLabel(snapshot)} detail={syncDetail(snapshot)} />
      </div>

      <div className="rg-overview-grid">
        <section className="rg-overview-section rg-overview-review" aria-labelledby="overview-review-title">
          <header>
            <div><p className="rg-eyebrow">Review queue</p><h2 id="overview-review-title">Provider changes</h2></div>
            {reviewUnits.length === 0 ? null : <Button data-review-trigger="overview" className="rg-overview-review-button" tone="primary" onClick={() => onReview(reviewUnits)}>Review {reviewUnits.length} unit{reviewUnits.length === 1 ? '' : 's'}</Button>}
          </header>
          {reviewUnits.length === 0 ? (
            <div className="rg-overview-empty"><CheckCircle2 size={20} aria-hidden="true" /><span><strong>Provider outputs are current</strong><small>Canonical edits and external provider changes will appear here.</small></span></div>
          ) : (
            <div className="rg-overview-review-list">
              {reviewUnits.map((unit) => {
                const state = unitState(snapshot, unit);
                return <button type="button" key={`${unit.provider}:${unit.content}`} onClick={() => onReview([unit])}><span className="rg-provider-glyph" aria-hidden="true">{providerInitial(unit.provider)}</span><span><strong>{providerLabel(unit.provider)}</strong><small>{contentLabel(unit.content)} · {stateDetail(state)}</small></span><StatusBadge status={state} /><ArrowRight size={15} aria-hidden="true" /></button>;
              })}
            </div>
          )}
        </section>

        <section className="rg-overview-section rg-overview-attention" aria-labelledby="overview-attention-title">
          <header><div><p className="rg-eyebrow">Outside Reglet</p><h2 id="overview-attention-title">Drift and blocked outputs</h2></div><span>{attentionItems.length}</span></header>
          {attentionItems.length === 0 ? (
            <div className="rg-overview-empty"><Files size={20} aria-hidden="true" /><span><strong>No drift detected</strong><small>Managed provider targets match their recorded state.</small></span></div>
          ) : (
            <ul className="rg-overview-attention-list">
              {attentionItems.slice(0, 6).map((item) => <li key={`${item.artifactId}:${item.provider}`}><AlertTriangle size={16} aria-hidden="true" /><span><strong>{item.title}</strong><small>{providerLabel(item.provider)} · {stateDetail(item.status)}</small></span><Button tone="quiet" onClick={() => onReview([{ provider: item.provider, content: item.content }])}>Review</Button></li>)}
            </ul>
          )}
          {diagnosticIssues.length === 0 ? null : <div className="rg-overview-diagnostics"><strong>{diagnosticIssues.length} diagnostic issue{diagnosticIssues.length === 1 ? '' : 's'}</strong>{diagnosticIssues.slice(0, 2).map((issue) => <span key={`${issue.code}:${issue.message}`}>{issue.message}</span>)}</div>}
        </section>

        <section className="rg-overview-section rg-overview-provider-matrix" aria-labelledby="provider-coverage-title">
          <header><div><p className="rg-eyebrow">Provider coverage</p><h2 id="provider-coverage-title">What each provider reads</h2></div><Button tone="quiet" onClick={onOpenProviders}>Open providers <ArrowRight size={14} /></Button></header>
          <div className="rg-overview-matrix" role="table" aria-label="Provider content status">
            <div className="rg-overview-matrix__heading" role="row"><span role="columnheader">Provider</span><span role="columnheader">Instructions</span><span role="columnheader">Skills</span><span role="columnheader">MCP</span></div>
            {providers.map((provider) => <button type="button" role="row" key={provider.id} onClick={onOpenProviders}><span role="cell"><span className="rg-provider-glyph" aria-hidden="true">{providerInitial(provider.id)}</span><span><strong>{provider.displayName}</strong><small>{provider.detected ? 'Detected' : 'Not detected'}</small></span></span>{(['rules', 'skills', 'mcp'] as const).map((content) => <span role="cell" key={content}><StatusBadge status={providerContentState(snapshot, provider, content)} /></span>)}</button>)}
          </div>
        </section>

        <section className="rg-overview-section rg-overview-activity" aria-labelledby="recent-activity-title">
          <header><div><p className="rg-eyebrow">Receipts and changes</p><h2 id="recent-activity-title">Recent activity</h2></div><Button tone="quiet" onClick={onOpenActivity}>Open activity <ArrowRight size={14} /></Button></header>
          {activity.length === 0 ? <div className="rg-overview-empty"><Activity size={20} aria-hidden="true" /><span><strong>No operations recorded</strong><small>Reviewed writes, sync, adoption, and recovery will appear here.</small></span></div> : <ul className="rg-overview-activity-list">{activity.map((item) => <li key={item.id}>{item.outcome === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}<span><strong>{activityLabel(item.action)}</strong><small>{item.provider === undefined ? 'Canonical library' : providerLabel(item.provider)} · {relativeTime(item.occurredAt)}</small></span></li>)}</ul>}
        </section>
      </div>
    </section>
  );
}

function OverviewMetric({ icon, label, value, detail, onClick, accent = false }: {
  icon: ReactNode;
  label: string;
  value: number | string;
  detail: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const content = <>{icon}<span><small>{label}</small><strong>{value}</strong><span>{detail}</span></span>{onClick === undefined ? null : <ArrowRight size={15} aria-hidden="true" />}</>;
  return onClick === undefined
    ? <div className={`rg-overview-metric${accent ? ' rg-overview-metric--accent' : ''}`}>{content}</div>
    : <button type="button" className={`rg-overview-metric${accent ? ' rg-overview-metric--accent' : ''}`} onClick={onClick}>{content}</button>;
}

function projectionReviewUnits(snapshot: ManagerSnapshotV3 | null): ReviewRequestUnit[] {
  const units = new Map<string, ReviewRequestUnit>();
  for (const artifact of snapshot?.library.artifacts ?? []) {
    if (artifact.metadata.lifecycle !== 'active') continue;
    const content = contentForKind(artifact.metadata.kind);
    for (const projection of artifact.projections) {
      if (!reviewStatuses.has(projection.status)) continue;
      units.set(`${projection.provider}:${content}`, { provider: projection.provider, content });
    }
  }
  return [...units.values()];
}

function projectionAttention(snapshot: ManagerSnapshotV3 | null) {
  return (snapshot?.library.artifacts ?? []).flatMap((artifact) => artifact.projections
    .filter((projection) => attentionStatuses.has(projection.status))
    .map((projection) => ({
      artifactId: artifact.metadata.id,
      title: artifact.metadata.title,
      provider: projection.provider,
      content: contentForKind(artifact.metadata.kind),
      status: projection.status,
    })));
}

function providerContentState(snapshot: ManagerSnapshotV3 | null, provider: ManagerProviderV3, content: ManagerContentId): ManagerProjectionStatusV3 {
  const capability = content === 'rules' ? provider.capabilities.instructions : content === 'skills' ? provider.capabilities.skills : provider.capabilities.mcp;
  if (!capability.supported) return 'unsupported';
  const statuses = (snapshot?.library.artifacts ?? []).flatMap((artifact) => contentForKind(artifact.metadata.kind) === content
    ? artifact.projections.filter((projection) => projection.provider === provider.id).map((projection) => projection.status)
    : []);
  return statusPriority.find((status) => statuses.includes(status)) ?? 'not-targeted';
}

function unitState(snapshot: ManagerSnapshotV3 | null, unit: ReviewRequestUnit): ManagerProjectionStatusV3 {
  const provider = snapshot?.providers.find((candidate) => candidate.id === unit.provider);
  return provider === undefined ? 'error' : providerContentState(snapshot, provider, unit.content);
}

function countKind(artifacts: ManagerSnapshotV3['library']['artifacts'], kind: ManagerArtifactKind): number {
  return artifacts.filter((artifact) => artifact.metadata.kind === kind).length;
}

function contentForKind(kind: ManagerArtifactKind): ManagerContentId {
  return kind === 'instruction' ? 'rules' : kind === 'skill' ? 'skills' : 'mcp';
}

function providerLabel(provider: ManagerProviderId): string {
  const labels: Record<ManagerProviderId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', windsurf: 'Windsurf', opencode: 'OpenCode' };
  return labels[provider];
}

function providerInitial(provider: ManagerProviderId): string {
  return providerLabel(provider).slice(0, 1).toLocaleUpperCase();
}

function contentLabel(content: ManagerContentId): string {
  return content === 'rules' ? 'Instructions' : content === 'skills' ? 'Skills' : 'MCP servers';
}

function stateDetail(status: ManagerProjectionStatusV3): string {
  return status === 'pending' ? 'Canonical changes are ready'
    : status === 'drifted' ? 'Provider file changed outside Reglet'
      : status === 'missing' ? 'Managed provider target is missing'
        : status === 'blocked' ? 'Validation is blocking this unit'
          : status === 'error' ? 'The last operation failed'
            : status === 'applied' ? 'Current'
              : status === 'unsupported' ? 'Not supported'
                : 'Not targeted';
}

function syncLabel(snapshot: ManagerSnapshotV3 | null): string {
  const sync = snapshot?.settings.sync;
  if (sync === undefined || !sync.enabled) return 'Off';
  return sync.state === 'idle' ? 'Current' : capitalize(sync.state);
}

function syncDetail(snapshot: ManagerSnapshotV3 | null): string {
  const sync = snapshot?.settings.sync;
  if (sync === undefined || !sync.enabled) return 'Canonical content stays on this device';
  if (sync.conflictCount > 0) return `${sync.conflictCount} conflict${sync.conflictCount === 1 ? '' : 's'} waiting for resolution`;
  if (sync.lastError !== undefined) return `Last run failed ${relativeTime(sync.lastError.occurredAt)}`;
  return sync.lastCompletedAt === undefined ? 'Initial exchange required' : `Last completed ${relativeTime(sync.lastCompletedAt)}`;
}

function activityLabel(action: string): string {
  return action.split('.').map(capitalize).join(' ');
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
