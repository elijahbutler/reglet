import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileInput,
  LoaderCircle,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isManagerProviderDetachReviewV3,
  isManagerProviderDetachResultV3,
  type JsonValue,
  type ManagerContentId,
  type ManagerProjectionIssueV3,
  type ManagerProviderDetachReviewV3,
  type ManagerProviderId,
  type ManagerProviderSourceItemV3,
  type ManagerProviderSourceV3,
  type ManagerProviderV3,
  type ManagerRpcInputs,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { useDialogFocus } from '../../design-system/useDialogFocus.js';

export type ProviderSourceAction = {
  kind: 'adopt';
  provider: ManagerProviderV3;
  source: ManagerProviderSourceV3;
  item: ManagerProviderSourceItemV3;
} | {
  kind: 'detach';
  provider: ManagerProviderV3;
  source: ManagerProviderSourceV3;
};

interface ProviderSourceActionSheetProps {
  action: ProviderSourceAction | null;
  client: ManagerClient;
  providers: ManagerProviderV3[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onReview: (provider: ManagerProviderId, content: ManagerContentId) => void;
}

interface ProviderSourcePreview {
  version: 1;
  digest: string;
  provider: ManagerProviderId;
  content: ManagerContentId;
  source: {
    path: string;
    name?: string;
    revision: string;
    ownership: 'unmanaged' | 'managed' | 'unknown';
  };
  artifact: {
    kind: 'instruction' | 'skill' | 'mcp';
    slug: string;
    title: string;
    scope: { kind: 'global' } | { kind: 'provider-overlay'; provider: ManagerProviderId };
    targets: ManagerProviderId[];
  };
  contentText?: string;
  skillInspection?: {
    revision: string;
    requiresExecutableConfirmation: boolean;
    promotionBlocked: boolean;
  };
  issues: ManagerProjectionIssueV3[];
  blocked: boolean;
}

export function ProviderSourceActionSheet({ action, client, providers, onClose, onRefresh, onReview }: ProviderSourceActionSheetProps) {
  const [destination, setDestination] = useState<'provider' | 'shared'>('provider');
  const [targets, setTargets] = useState<Set<ManagerProviderId>>(() => new Set());
  const [preview, setPreview] = useState<ProviderSourcePreview | null>(null);
  const [detachReview, setDetachReview] = useState<ManagerProviderDetachReviewV3 | null>(null);
  const [phase, setPhase] = useState<'configure' | 'loading' | 'review' | 'complete'>('configure');
  const [confirmedExecutable, setConfirmedExecutable] = useState(false);
  const [confirmedDetach, setConfirmedDetach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const busy = phase === 'loading';
  const dialog = useDialogFocus<HTMLElement>(action !== null, busy ? undefined : onClose);

  useEffect(() => {
    previewRequestRef.current += 1;
    if (action === null) return;
    let current = true;
    setDestination('provider');
    setTargets(new Set([action.provider.id]));
    setPreview(null);
    setDetachReview(null);
    setPhase(action.kind === 'detach' ? 'loading' : 'configure');
    setConfirmedExecutable(false);
    setConfirmedDetach(false);
    setError(null);
    if (action.kind === 'detach') {
      void client.command('provider.source.stop-managing.preview', {
        provider: action.provider.id,
        content: action.source.content,
      }).then((response) => {
        if (!isManagerProviderDetachReviewV3(response.data) || response.data.provider !== action.provider.id ||
          response.data.content !== action.source.content) throw new Error('Reglet returned an invalid stop-managing review.');
        if (!current) return;
        setDetachReview(response.data);
        setPhase('review');
      }).catch((detachError: unknown) => {
        if (!current) return;
        setError(messageFrom(detachError));
        setPhase('review');
      });
    }
    return () => { current = false; };
  }, [action, client]);

  const selectedTargets = useMemo(() => providers.filter((provider) => targets.has(provider.id)).map((provider) => provider.id), [providers, targets]);
  if (action === null) return null;
  const title = action.kind === 'adopt' ? `Adopt ${action.item.label}` : `Stop managing ${contentLabel(action.source.content)}`;

  const prepareAdoption = async () => {
    if (action.kind !== 'adopt') return;
    const requestId = ++previewRequestRef.current;
    setPhase('loading');
    setError(null);
    try {
      const input: ManagerRpcInputs['provider.source.preview'] = {
        provider: action.provider.id,
        content: action.source.content,
        name: action.item.label,
        destination,
        ...(destination === 'shared' ? { targets: selectedTargets } : {}),
      };
      const response = await client.command('provider.source.preview', input);
      const next = readProviderSourcePreview(response.data);
      if (next === null) throw new Error('Reglet returned an invalid provider adoption review.');
      if (requestId !== previewRequestRef.current) return;
      setPreview(next);
      setConfirmedExecutable(false);
      setPhase('review');
    } catch (previewError) {
      if (requestId !== previewRequestRef.current) return;
      setError(messageFrom(previewError));
      setPhase('configure');
    }
  };

  const adopt = async () => {
    if (action.kind !== 'adopt' || preview === null ||
      !providerSourcePreviewMatches(preview, action, destination, selectedTargets)) return;
    setPhase('loading');
    setError(null);
    try {
      const input: ManagerRpcInputs['provider.source.adopt'] = {
        provider: action.provider.id,
        content: action.source.content,
        name: action.item.label,
        destination,
        ...(destination === 'shared' ? { targets: selectedTargets } : {}),
        previewDigest: preview.digest,
        ...(preview.skillInspection?.requiresExecutableConfirmation === true
          ? { confirmedExecutableRevision: preview.skillInspection.revision }
          : {}),
      };
      await client.command('provider.source.adopt', input);
      await onRefresh();
      setPhase('complete');
    } catch (adoptionError) {
      setError(messageFrom(adoptionError));
      setPhase('review');
    }
  };

  const detach = async () => {
    if (action.kind !== 'detach' || detachReview === null || detachReview.provider !== action.provider.id ||
      detachReview.content !== action.source.content) return;
    setPhase('loading');
    setError(null);
    try {
      const response = await client.command('provider.source.stop-managing', {
        provider: action.provider.id,
        content: action.source.content,
        digest: detachReview.digest,
        confirmed: true,
      });
      if (!isManagerProviderDetachResultV3(response.data)) throw new Error('Reglet could not verify the stop-managing result.');
      await onRefresh();
      setPhase('complete');
    } catch (detachError) {
      setError(messageFrom(detachError));
      setPhase('review');
    }
  };

  const executableConfirmationRequired = preview?.skillInspection?.requiresExecutableConfirmation === true;
  const canAdopt = action.kind === 'adopt' && preview !== null && !preview.blocked &&
    providerSourcePreviewMatches(preview, action, destination, selectedTargets) &&
    (!executableConfirmationRequired || confirmedExecutable);
  const canDetach = action.kind === 'detach' && detachReview?.status === 'ready' &&
    detachReview.provider === action.provider.id && detachReview.content === action.source.content && confirmedDetach;

  return (
    <div className="rg-sheet-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <aside ref={dialog} tabIndex={-1} className="rg-sheet rg-provider-action-sheet" role="dialog" aria-modal="true" aria-labelledby="provider-action-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="rg-provider-action-sheet__header">
          <div><p className="rg-eyebrow">{action.provider.displayName} · {contentLabel(action.source.content)}</p><h1 id="provider-action-title">{title}</h1></div>
          <button type="button" className="rg-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="rg-provider-action-sheet__body">
          {error === null ? null : <div className="rg-review-notice rg-review-notice--error" role="alert"><AlertTriangle size={16} /><span><strong>Action needs attention</strong>{error}</span></div>}
          {busy ? <div className="rg-review-state" role="status"><LoaderCircle className="rg-spin" size={22} /><strong>{action.kind === 'adopt' ? 'Inspecting the provider source' : 'Preparing the exact ownership change'}</strong><span>Reglet is checking the current source and binding this review to its exact revision.</span></div> : null}
          {!busy && action.kind === 'adopt' && phase === 'configure' ? <AdoptionConfiguration provider={action.provider.id} destination={destination} targets={targets} providers={providers} onDestination={(next) => { setDestination(next); setPreview(null); }} onTargets={setTargets} /> : null}
          {!busy && action.kind === 'adopt' && phase === 'review' && preview !== null ? <AdoptionReview preview={preview} confirmedExecutable={confirmedExecutable} onConfirmedExecutable={setConfirmedExecutable} /> : null}
          {!busy && action.kind === 'detach' && phase === 'review' ? <DetachReview review={detachReview} confirmed={confirmedDetach} onConfirmed={setConfirmedDetach} /> : null}
          {!busy && phase === 'complete' ? <div className="rg-provider-action-complete"><CheckCircle2 size={24} /><span><strong>{action.kind === 'adopt' ? 'Canonical artifact created' : 'Provider content is no longer managed'}</strong><p>{action.kind === 'adopt' ? 'The provider source was left unchanged. Review the resulting canonical projection before writing any provider file.' : 'Reglet left the provider content in place and removed its management record.'}</p></span></div> : null}
        </div>
        <footer className="rg-provider-action-sheet__footer">
          {phase === 'complete' ? <><Button tone="secondary" onClick={onClose}>Done</Button>{action.kind === 'adopt' ? <Button className="rg-review-apply" tone="primary" icon={<FileCheck2 size={15} />} onClick={() => { onClose(); onReview(action.provider.id, action.source.content); }}>Review projection</Button> : null}</> : <>
            <Button tone="secondary" onClick={phase === 'review' && action.kind === 'adopt' ? () => { setPreview(null); setPhase('configure'); } : onClose} disabled={busy}>{phase === 'review' && action.kind === 'adopt' ? 'Back' : 'Cancel'}</Button>
            {action.kind === 'adopt' && phase === 'configure' ? <Button className="rg-review-apply" tone="primary" icon={<FileInput size={15} />} disabled={destination === 'shared' && selectedTargets.length === 0} onClick={() => void prepareAdoption()}>Review adoption</Button> : null}
            {action.kind === 'adopt' && phase === 'review' ? <Button className="rg-review-apply" tone="primary" icon={<FileInput size={15} />} disabled={!canAdopt} onClick={() => void adopt()}>Adopt into library</Button> : null}
            {action.kind === 'detach' && phase === 'review' ? <Button tone="danger" icon={<ShieldAlert size={15} />} disabled={!canDetach} onClick={() => void detach()}>Stop managing</Button> : null}
          </>}
        </footer>
      </aside>
    </div>
  );
}

function AdoptionConfiguration({ provider, destination, targets, providers, onDestination, onTargets }: {
  provider: ManagerProviderId;
  destination: 'provider' | 'shared';
  targets: Set<ManagerProviderId>;
  providers: ManagerProviderV3[];
  onDestination: (destination: 'provider' | 'shared') => void;
  onTargets: (targets: Set<ManagerProviderId>) => void;
}) {
  return <div className="rg-provider-action-content"><section><h2>Canonical scope</h2><p>Adoption reads this exact provider item and creates canonical content. It does not rewrite or remove the source.</p><div className="rg-provider-scope-options" role="radiogroup" aria-label="Canonical scope"><label><input type="radio" name="provider-scope" checked={destination === 'provider'} onChange={() => onDestination('provider')} /><span><strong>Provider-specific</strong><small>Keep the adopted content scoped to {providerLabel(provider)}.</small></span></label><label><input type="radio" name="provider-scope" checked={destination === 'shared'} onChange={() => onDestination('shared')} /><span><strong>Shared</strong><small>Make the artifact available to selected providers.</small></span></label></div></section>{destination === 'shared' ? <section><h2>Target providers</h2><div className="rg-provider-target-picker">{providers.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={targets.has(candidate.id)} disabled={!candidate.detected && candidate.id !== provider} onChange={() => { const next = new Set(targets); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); onTargets(next); }} /><span><strong>{candidate.displayName}</strong><small>{candidate.detected ? 'Detected' : 'Not detected'}</small></span></label>)}</div></section> : null}</div>;
}

function AdoptionReview({ preview, confirmedExecutable, onConfirmedExecutable }: { preview: ProviderSourcePreview; confirmedExecutable: boolean; onConfirmedExecutable: (confirmed: boolean) => void }) {
  return <div className="rg-provider-action-content"><section><h2>Canonical artifact</h2><dl className="rg-key-values"><div><dt>Title</dt><dd>{preview.artifact.title}</dd></div><div><dt>Slug</dt><dd><code>{preview.artifact.slug}</code></dd></div><div><dt>Scope</dt><dd>{preview.artifact.scope.kind === 'global' ? 'Shared' : providerLabel(preview.artifact.scope.provider)}</dd></div><div><dt>Targets</dt><dd>{preview.artifact.targets.map(providerLabel).join(', ')}</dd></div></dl></section><section><h2>Exact source</h2><dl className="rg-key-values"><div><dt>Path</dt><dd><code>{preview.source.path}</code></dd></div><div><dt>Revision</dt><dd><code>{shortHash(preview.source.revision)}</code></dd></div></dl></section>{preview.contentText === undefined ? null : <section><h2>Sanitized canonical content</h2><pre className="rg-provider-content-preview">{preview.contentText}</pre></section>}{preview.issues.length === 0 ? null : <section><h2>Review findings</h2><ul className="rg-provider-issue-list">{preview.issues.map((issue) => <li className={`rg-provider-issue rg-provider-issue--${issue.severity}`} key={`${issue.code}:${issue.message}`}><AlertTriangle size={14} /><span><strong>{issue.code}</strong><small>{issue.message}</small></span></li>)}</ul></section>}{preview.skillInspection?.requiresExecutableConfirmation === true ? <section className="rg-provider-executable-confirmation"><h2>Executable skill files</h2><p>This skill contains executable files. Confirm the exact inspected revision before adoption.</p><label><input type="checkbox" checked={confirmedExecutable} onChange={(event) => onConfirmedExecutable(event.target.checked)} /><span>I reviewed revision <code>{shortHash(preview.skillInspection.revision)}</code> and approve its executable files.</span></label></section> : null}</div>;
}

function DetachReview({ review, confirmed, onConfirmed }: { review: ManagerProviderDetachReviewV3 | null; confirmed: boolean; onConfirmed: (confirmed: boolean) => void }) {
  if (review === null) return <div className="rg-review-state rg-review-state--compact"><AlertTriangle size={21} /><strong>The ownership review is unavailable</strong><span>Close this panel and retry after the provider source is readable.</span></div>;
  return <div className="rg-provider-action-content"><section><h2>Exact provider targets</h2><p>Stopping management leaves provider content in place. Generated instruction headers may be removed before Reglet detaches its records.</p><div className="rg-provider-detach-targets">{review.targets.map((target) => <div key={target.path}><span><strong>{target.operation === 'rewrite' ? 'Rewrite and detach' : 'Detach only'}</strong><code>{target.path}</code></span><small>{target.current.kind} · {formatSize(target.current.size)}</small>{target.diff.length === 0 ? null : <pre>{target.diff}</pre>}</div>)}</div></section>{review.issues.length === 0 ? null : <section><h2>Blocking issues</h2><ul className="rg-provider-issue-list">{review.issues.map((issue) => <li className="rg-provider-issue rg-provider-issue--error" key={issue}><AlertTriangle size={14} /><span><small>{issue}</small></span></li>)}</ul></section>}<section className="rg-provider-detach-confirmation"><label><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} disabled={review.status === 'blocked'} /><span>I understand that future canonical changes will no longer update this provider content.</span></label></section></div>;
}

function providerSourcePreviewMatches(
  preview: ProviderSourcePreview,
  action: Extract<ProviderSourceAction, { kind: 'adopt' }>,
  destination: 'provider' | 'shared',
  selectedTargets: ManagerProviderId[],
): boolean {
  if (preview.provider !== action.provider.id || preview.content !== action.source.content) return false;
  if (destination === 'provider') {
    return preview.artifact.scope.kind === 'provider-overlay' &&
      preview.artifact.scope.provider === action.provider.id &&
      preview.artifact.targets.length === 1 && preview.artifact.targets[0] === action.provider.id;
  }
  if (preview.artifact.scope.kind !== 'global') return false;
  const reviewedTargets = [...preview.artifact.targets].sort();
  const currentTargets = [...selectedTargets].sort();
  return reviewedTargets.length === currentTargets.length &&
    reviewedTargets.every((provider, index) => provider === currentTargets[index]);
}

function readProviderSourcePreview(value: JsonValue): ProviderSourcePreview | null {
  if (!isJsonRecord(value) || value.version !== 1 || typeof value.digest !== 'string' || !isProvider(value.provider) || !isContent(value.content) ||
    !isJsonRecord(value.source) || typeof value.source.path !== 'string' || typeof value.source.revision !== 'string' ||
    (value.source.ownership !== 'unmanaged' && value.source.ownership !== 'managed' && value.source.ownership !== 'unknown') ||
    !isJsonRecord(value.artifact) || !isArtifactKind(value.artifact.kind) || typeof value.artifact.slug !== 'string' || typeof value.artifact.title !== 'string' ||
    !isArtifactScope(value.artifact.scope) || !Array.isArray(value.artifact.targets) || !value.artifact.targets.every(isProvider) ||
    !Array.isArray(value.issues) || !value.issues.every(isProjectionIssue) || typeof value.blocked !== 'boolean' ||
    (value.contentText !== undefined && typeof value.contentText !== 'string')) return null;
  const skillInspection = readSkillInspection(value.skillInspection);
  if (value.skillInspection !== undefined && skillInspection === null) return null;
  return {
    version: 1,
    digest: value.digest,
    provider: value.provider,
    content: value.content,
    source: {
      path: value.source.path,
      ...(typeof value.source.name === 'string' ? { name: value.source.name } : {}),
      revision: value.source.revision,
      ownership: value.source.ownership,
    },
    artifact: {
      kind: value.artifact.kind,
      slug: value.artifact.slug,
      title: value.artifact.title,
      scope: value.artifact.scope,
      targets: value.artifact.targets,
    },
    ...(typeof value.contentText === 'string' ? { contentText: value.contentText } : {}),
    ...(skillInspection === null ? {} : { skillInspection }),
    issues: value.issues,
    blocked: value.blocked,
  };
}

function readSkillInspection(value: JsonValue | undefined): ProviderSourcePreview['skillInspection'] | null {
  if (value === undefined) return null;
  if (!isJsonRecord(value) || typeof value.revision !== 'string' || typeof value.requiresExecutableConfirmation !== 'boolean' || typeof value.promotionBlocked !== 'boolean') return null;
  return { revision: value.revision, requiresExecutableConfirmation: value.requiresExecutableConfirmation, promotionBlocked: value.promotionBlocked };
}

function isProjectionIssue(value: JsonValue): value is ManagerProjectionIssueV3 & { [key: string]: JsonValue } {
  return isJsonRecord(value) && typeof value.code === 'string' && (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') && typeof value.message === 'string';
}

function isArtifactScope(value: JsonValue | undefined): value is ProviderSourcePreview['artifact']['scope'] {
  return isJsonRecord(value) && (value.kind === 'global' || (value.kind === 'provider-overlay' && isProvider(value.provider)));
}

function isArtifactKind(value: JsonValue | undefined): value is ProviderSourcePreview['artifact']['kind'] {
  return value === 'instruction' || value === 'skill' || value === 'mcp';
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

function contentLabel(content: ManagerContentId): string {
  return content === 'rules' ? 'Instructions' : content === 'skills' ? 'Skills' : 'MCP servers';
}

function providerLabel(provider: ManagerProviderId): string {
  const labels: Record<ManagerProviderId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', windsurf: 'Windsurf', opencode: 'OpenCode' };
  return labels[provider];
}

function shortHash(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

function formatSize(value: number | null): string {
  if (value === null) return 'not present';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : 'The provider operation failed.';
}
