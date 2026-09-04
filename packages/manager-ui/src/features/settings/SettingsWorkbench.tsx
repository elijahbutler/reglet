import { AlertTriangle, CheckCircle2, Database, Download, FileCode2, FolderRoot, KeyRound, Laptop, LoaderCircle, Radio, RefreshCw, Settings, Shield, ShieldAlert, ShieldCheck, Stethoscope, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { JsonValue, ManagerProviderId, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerHostActions, ManagerUpdateDownloadEvent, ManagerUpdateStatus } from '../../app/ManagerApp.js';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';
import { SyncConnectionPanel } from './SyncConnectionPanel.js';
import { SyncOperationsPanel } from './SyncOperationsPanel.js';

const sections = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'roots', label: 'Project roots', icon: FolderRoot },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'executable-skills', label: 'Executable skills', icon: ShieldCheck },
  { id: 'sync', label: 'Sync & devices', icon: Laptop },
  { id: 'remote', label: 'Remote access', icon: Radio },
  { id: 'backups', label: 'Backups', icon: Database },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope },
] as const;

export type SettingsSection = (typeof sections)[number]['id'];

export function SettingsWorkbench({ client, hostActions, updateStatus, onUpdateStatus, section, onSection, snapshot, onRefresh, onError, onRunSetup }: {
  client: ManagerClient;
  hostActions?: ManagerHostActions;
  updateStatus: ManagerUpdateStatus | null;
  onUpdateStatus: (status: ManagerUpdateStatus | null) => void;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  snapshot: ManagerSnapshotV3 | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onRunSetup?: () => void;
}) {
  const [rootPath, setRootPath] = useState('');
  const [secretId, setSecretId] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { onError(error instanceof Error ? error.message : 'Settings operation failed.'); } finally { setBusy(false); }
  };

  return (
    <>
      <Pane label="Settings sections" className="rg-collection rg-operation-list">
        <PaneHeader><span>Settings</span></PaneHeader>
        <div className="rg-collection-label">Local manager</div>
        <div className="rg-artifact-list">{sections.map(({ id, label, icon: Icon }) => <Row key={id} active={section === id} leading={<Icon size={15} />} onClick={() => onSection(id)}>{label}</Row>)}</div>
      </Pane>
      <Pane label="Settings detail" className="rg-operation-canvas">
        <PaneHeader><span>{sections.find((candidate) => candidate.id === section)?.label}</span></PaneHeader>
        <div className="rg-detail-document">
          {section === 'general' ? <GeneralSettings hostActions={hostActions} updateStatus={updateStatus} onUpdateStatus={onUpdateStatus} snapshot={snapshot} onRunSetup={onRunSetup} /> : null}
          {section === 'roots' ? <RootsSettings snapshot={snapshot} rootPath={rootPath} onRootPath={setRootPath} busy={busy} onAdd={() => void run(async () => {
            await client.command('project.root.add', { path: rootPath });
            setRootPath('');
            await onRefresh();
          })} /> : null}
          {section === 'secrets' ? <SecretSettings
            snapshot={snapshot}
            id={secretId}
            value={secretValue}
            busy={busy}
            onId={setSecretId}
            onValue={setSecretValue}
            onBind={() => void run(async () => {
              await client.command('secret.set', { id: secretId, value: secretValue });
              setSecretValue('');
              await onRefresh();
            })}
            onDelete={(idToDelete) => void run(async () => {
              await client.command('secret.delete', { id: idToDelete });
              await onRefresh();
            })}
          /> : null}
          {section === 'executable-skills' ? <ExecutableSkillsSettings client={client} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /> : null}
          {section === 'sync' ? <SyncSettings client={client} snapshot={snapshot} busy={busy} onRefresh={onRefresh} onError={onError} onDisable={() => void run(async () => { await client.command('sync.disable', {}); await onRefresh(); })} /> : null}
          {section === 'remote' ? <RemoteSettings snapshot={snapshot} busy={busy} onDisable={() => void run(async () => { await client.command('remote.disable', {}); await onRefresh(); })} /> : null}
          {section === 'backups' ? <BackupsSettings /> : null}
          {section === 'diagnostics' ? <DiagnosticsSettings snapshot={snapshot} /> : null}
        </div>
      </Pane>
      <Pane label="Settings security boundary" className="rg-inspector" tone="raised">
        <PaneHeader><span>Security boundary</span></PaneHeader>
        <section className="rg-inspector-section"><h2>Local by default</h2><div className="rg-artifact-summary"><Shield size={17} /><span><strong>Admin scope required</strong><small>Roots, secrets, executable approvals, sessions, sync endpoints, and network settings are excluded from remote write sessions.</small></span></div></section>
        <section className="rg-inspector-section"><h2>Current session</h2><dl className="rg-key-values"><div><dt>Scope</dt><dd>{snapshot?.permissions.scope ?? 'Unavailable'}</dd></div><div><dt>Admin</dt><dd>{snapshot?.permissions.canAdmin ? 'Yes' : 'No'}</dd></div></dl></section>
      </Pane>
    </>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <header><span className="rg-detail-icon"><Settings size={18} /></span><div><h1>{title}</h1><p>{description}</p></div></header>;
}

interface InstallProgress {
  phase: 'idle' | 'downloading' | 'installing';
  downloadedBytes: number;
  totalBytes: number | null;
}

function GeneralSettings({ hostActions, updateStatus, onUpdateStatus, snapshot, onRunSetup }: {
  hostActions?: ManagerHostActions;
  updateStatus: ManagerUpdateStatus | null;
  onUpdateStatus: (status: ManagerUpdateStatus | null) => void;
  snapshot: ManagerSnapshotV3 | null;
  onRunSetup?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress>({ phase: 'idle', downloadedBytes: 0, totalBytes: null });
  const check = async () => {
    if (hostActions?.checkForUpdates === undefined) return;
    setChecking(true);
    setUpdateError(null);
    setInstallProgress({ phase: 'idle', downloadedBytes: 0, totalBytes: null });
    try { onUpdateStatus(await hostActions.checkForUpdates()); } catch (error) { onUpdateStatus(null); setUpdateError(updateMessageFrom(error, 'The secure update check failed. Check your connection and retry.')); } finally { setChecking(false); }
  };
  const install = async () => {
    if (hostActions?.installUpdate === undefined || updateStatus?.status !== 'available') return;
    setUpdateError(null);
    setInstallProgress({ phase: 'downloading', downloadedBytes: 0, totalBytes: null });
    try {
      await hostActions.installUpdate((event) => setInstallProgress((progress) => progressFromEvent(progress, event)));
    } catch (error) {
      setInstallProgress({ phase: 'idle', downloadedBytes: 0, totalBytes: null });
      onUpdateStatus(null);
      setUpdateError(updateMessageFrom(error, 'Reglet could not verify or install the update. Check again and retry.'));
    }
  };
  const installing = installProgress.phase !== 'idle';
  return <><SectionHeader title="General" description="Canonical library and local runtime status." /><dl className="rg-key-values"><div><dt>Library schema</dt><dd>{snapshot === null ? 'Unavailable' : `v${snapshot.library.schemaVersion}`}</dd></div><div><dt>Protocol</dt><dd>{snapshot === null ? 'Unavailable' : `v${snapshot.protocolVersion}`}</dd></div><div><dt>Revision</dt><dd>{snapshot?.revision ?? 'Unavailable'}</dd></div><div><dt>Migration</dt><dd>{snapshot?.library.migration.status ?? 'Unavailable'}</dd></div></dl>{onRunSetup !== undefined ? <section className="rg-settings-group" aria-labelledby="desktop-walkthrough-title">
    <div className="rg-update-panel__header">
      <div>
        <h2 id="desktop-walkthrough-title">Guided setup walkthrough</h2>
        <p>Re-run the initial onboarding flow to detect new providers or reconfigure project scanning.</p>
      </div>
      <Button tone="secondary" onClick={onRunSetup}>Re-run walkthrough</Button>
    </div>
  </section> : null}{hostActions?.checkForUpdates !== undefined ? <section className="rg-settings-group rg-update-panel" aria-labelledby="desktop-updates-title">
    <div className="rg-update-panel__header"><div><h2 id="desktop-updates-title">Desktop updates</h2><p>Updates are downloaded from Reglet Releases and verified before installation.</p></div><Button disabled={checking || installing} icon={<RefreshCw className={checking ? 'rg-spin' : undefined} size={14} />} onClick={() => void check()}>{checking ? 'Checking…' : updateStatus === null ? 'Check for updates' : 'Check again'}</Button></div>
    <div className="rg-update-state" aria-live="polite">
      {checking ? <UpdateSummary icon={<ShieldCheck size={18} />} title="Checking for a signed update…" detail="Reglet is comparing this installation with the latest desktop release." /> : null}
      {!checking && updateStatus === null && updateError === null ? <UpdateSummary icon={<ShieldCheck size={18} />} title="Automatic checks are ready" detail="Reglet checks quietly after launch. You stay in control of installation." /> : null}
      {!checking && updateStatus?.status === 'current' ? <UpdateSummary tone="success" icon={<CheckCircle2 size={18} />} title={`Reglet ${updateStatus.currentVersion} is current`} detail="No newer signed desktop release is available." /> : null}
      {!checking && updateStatus?.status === 'disabled' ? <UpdateSummary tone="warning" icon={<ShieldAlert size={18} />} title="Automatic updates are unavailable in this build" detail={updateStatus.reason} /> : null}
      {!checking && updateStatus?.status === 'available' ? <div className="rg-update-available"><UpdateSummary tone="accent" icon={<Download size={18} />} title={`Reglet ${updateStatus.latestVersion} is ready`} detail={`You are running ${updateStatus.currentVersion}. Installation will relaunch Reglet.`} />{updateStatus.notes === null || updateStatus.notes.trim().length === 0 ? null : <p className="rg-update-notes">{updateStatus.notes}</p>}{installing ? <UpdateProgress progress={installProgress} /> : <Button tone="primary" disabled={hostActions.installUpdate === undefined} onClick={() => void install()}>Install and restart</Button>}</div> : null}
      {updateError === null ? null : <div className="rg-update-error" role="alert"><ShieldAlert size={17} /><span><strong>Update interrupted</strong><small>{updateError}</small></span></div>}
    </div>
  </section> : null}</>;
}

function UpdateSummary({ detail, icon, title, tone = 'neutral' }: { detail: string; icon: ReactNode; title: string; tone?: 'neutral' | 'success' | 'warning' | 'accent' }) {
  return <div className={`rg-update-summary rg-update-summary--${tone}`}>{icon}<span><strong>{title}</strong><small>{detail}</small></span></div>;
}

function UpdateProgress({ progress }: { progress: InstallProgress }) {
  const percent = progress.totalBytes === null || progress.totalBytes === 0 ? null : Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  const installing = progress.phase === 'installing';
  return <div className="rg-update-progress"><div><strong>{installing ? 'Installing verified update…' : 'Downloading update…'}</strong><span>{installing ? 'Reglet will relaunch when installation finishes.' : percent === null ? formatBytes(progress.downloadedBytes) : `${percent}% · ${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes ?? 0)}`}</span></div><progress max={progress.totalBytes ?? undefined} value={progress.totalBytes === null ? undefined : progress.downloadedBytes} aria-label={installing ? 'Installing update' : 'Downloading update'} /></div>;
}

function progressFromEvent(progress: InstallProgress, event: ManagerUpdateDownloadEvent): InstallProgress {
  if (event.event === 'started') return { phase: 'downloading', downloadedBytes: 0, totalBytes: event.contentLength };
  if (event.event === 'progress') return { ...progress, phase: 'downloading', downloadedBytes: progress.downloadedBytes + event.chunkLength };
  return { ...progress, phase: 'installing' };
}

function updateMessageFrom(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.length > 0) return value.message;
  if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string' && value.message.length > 0) return value.message;
  return fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RootsSettings({ snapshot, rootPath, onRootPath, busy, onAdd }: { snapshot: ManagerSnapshotV3 | null; rootPath: string; onRootPath: (value: string) => void; busy: boolean; onAdd: () => void }) {
  return <><SectionHeader title="Project roots" description="Read-only directories scanned for provider guidance." /><label className="rg-field"><span>Absolute root path</span><input value={rootPath} onChange={(event) => onRootPath(event.target.value)} placeholder="Absolute path to your projects" /></label><Button disabled={busy || rootPath.trim().length === 0} onClick={onAdd}>Add root</Button><div className="rg-settings-list">{(snapshot?.projectInbox?.roots ?? []).map((root) => <div key={root.id}><strong>{root.label}</strong><code>{root.path}</code></div>)}</div></>;
}

function SecretSettings({
  snapshot,
  id,
  value,
  busy,
  onId,
  onValue,
  onBind,
  onDelete,
}: {
  snapshot: ManagerSnapshotV3 | null;
  id: string;
  value: string;
  busy: boolean;
  onId: (value: string) => void;
  onValue: (value: string) => void;
  onBind: () => void;
  onDelete?: (id: string) => void;
}) {
  const bindings = snapshot?.settings.secretBindings ?? [];
  return (
    <>
      <SectionHeader
        title="Secrets & Credentials"
        description="Encrypted in the native OS keychain. Automatically resolved during apply without persisting raw credentials to provider files."
      />
      <div className="rg-settings-group">
        <h2>Add or Update Secret</h2>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', opacity: 0.7 }}>Presets:</span>
          {['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onId(preset)}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'inherit',
                fontFamily: 'monospace',
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <label className="rg-field">
          <span>Reference ID</span>
          <input
            value={id}
            onChange={(event) => onId(event.target.value)}
            autoComplete="off"
            placeholder="e.g. GITHUB_TOKEN"
          />
        </label>
        <label className="rg-field">
          <span>Secret value</span>
          <input
            type="password"
            value={value}
            onChange={(event) => onValue(event.target.value)}
            autoComplete="new-password"
            placeholder="Enter token value…"
          />
        </label>
        <Button
          tone="primary"
          disabled={busy || id.trim().length === 0 || value.length === 0}
          onClick={onBind}
        >
          {busy ? 'Saving…' : 'Bind locally'}
        </Button>
      </div>

      <div className="rg-settings-group">
        <h2>Vaulted Secrets ({bindings.length})</h2>
        {bindings.length === 0 ? (
          <p style={{ fontSize: '13px', opacity: 0.7 }}>No secrets configured in local keychain.</p>
        ) : (
          <div className="rg-settings-list">
            {bindings.map((binding) => (
              <div
                key={binding.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={15} style={{ opacity: 0.8 }} />
                  <strong>{binding.id}</strong>
                  <span>{binding.bound ? 'Bound' : 'Unbound'}</span>
                </div>
                {onDelete ? (
                  <Button
                    tone="quiet"
                    icon={<Trash2 size={13} />}
                    onClick={() => onDelete(binding.id)}
                    aria-label={`Delete ${binding.id}`}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

type SkillTrustState = 'not-required' | 'untrusted' | 'changed' | 'trusted' | 'blocked';

interface ExecutableSkillInspection {
  artifact: {
    id: string;
    title: string;
    slug: string;
    targets: ManagerProviderId[];
  };
  revision: string;
  totalBytes: number;
  files: Array<{
    relPath: string;
    size: number;
    executable: boolean;
    binary: boolean;
    contentHash?: string;
  }>;
  risks: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    relPath: string;
    message: string;
  }>;
  promotionBlocked: boolean;
  requiresExecutableConfirmation: boolean;
  trust: {
    state: SkillTrustState;
    revision?: string;
    trustedAt?: string;
  };
}

function ExecutableSkillsSettings({ client, snapshot, onRefresh, onError }: {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [inspections, setInspections] = useState<ExecutableSkillInspection[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [approving, setApproving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const skills = useMemo(
    () => snapshot?.library.artifacts.filter((artifact) => artifact.metadata.kind === 'skill' && artifact.metadata.lifecycle === 'active') ?? [],
    [snapshot],
  );

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    const loadInspections = async () => {
      const settled: PromiseSettledResult<ExecutableSkillInspection>[] = [];
      for (let index = 0; index < skills.length; index += 4) {
        const batch = skills.slice(index, index + 4);
        settled.push(...await Promise.allSettled(batch.map(async (skill) => {
          try {
            const result = await client.command('skill.inspect', { artifact: skill.metadata.id });
            const inspection = readExecutableSkillInspection(result.data);
            if (inspection === null) throw new Error('Reglet returned an invalid inspection.');
            return inspection;
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Executable skill inspection failed.';
            throw new Error(`${skill.metadata.title}: ${detail}`);
          }
        })));
      }
      if (!current) return;
      const ready = settled.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []);
      const failures = settled.flatMap((entry) => entry.status === 'rejected'
        ? [entry.reason instanceof Error ? entry.reason.message : 'Executable skill inspection failed.']
        : []);
      setInspections(ready.sort((left, right) => left.artifact.title.localeCompare(right.artifact.title)));
      setLoadError(failures.length === 0 ? null : failures.join(' '));
    };
    void loadInspections().catch((error: unknown) => {
      if (!current) return;
      setInspections([]);
      setLoadError(error instanceof Error ? error.message : 'Executable skill inspection failed.');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client, loadAttempt, snapshot?.revision]);

  const executableSkills = inspections.filter((inspection) =>
    inspection.requiresExecutableConfirmation || inspection.promotionBlocked);
  const needsReview = executableSkills.filter((inspection) =>
    inspection.trust.state === 'untrusted' || inspection.trust.state === 'changed').length;

  const approve = async (inspection: ExecutableSkillInspection) => {
    setApproving(inspection.artifact.id);
    try {
      await client.command('skill.trust', {
        artifact: inspection.artifact.id,
        revision: inspection.revision,
        confirmed: true,
      });
      setConfirmed((current) => {
        const next = new Set(current);
        next.delete(inspection.artifact.id);
        return next;
      });
      await onRefresh();
      setLoadAttempt((attempt) => attempt + 1);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Reglet could not approve this skill revision.');
      setLoadAttempt((attempt) => attempt + 1);
    } finally {
      setApproving(null);
    }
  };

  return <>
    <SectionHeader title="Executable skills" description="Review executable files before Reglet copies them into provider skill directories." />
    <div className="rg-executable-boundary">
      <ShieldCheck size={18} aria-hidden="true" />
      <span><strong>Approval is revision-specific</strong><small>Reglet inventories and copies these files. It does not execute them. Any file change invalidates approval and requires another review.</small></span>
    </div>
    {loading ? <div className="rg-settings-state" role="status"><LoaderCircle className="rg-spin" size={18} /><span><strong>Inspecting canonical skills</strong><small>No skill code is executed during inspection.</small></span></div> : null}
    {!loading && loadError !== null ? <div className="rg-settings-state rg-settings-state--error" role="alert"><AlertTriangle size={18} /><span><strong>Inspection needs attention</strong><small>{loadError}</small></span><Button tone="secondary" icon={<RefreshCw size={14} />} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</Button></div> : null}
    {!loading && loadError === null && executableSkills.length === 0 ? <div className="rg-settings-state"><CheckCircle2 size={18} /><span><strong>No executable approvals needed</strong><small>{skills.length === 0 ? 'Your canonical library has no active skills.' : 'Active skills contain no executable files.'}</small></span></div> : null}
    {!loading && executableSkills.length > 0 ? <section className="rg-executable-skills" aria-label="Executable skill approvals">
      <div className="rg-executable-skills__summary"><span><strong>{executableSkills.length}</strong> executable skill{executableSkills.length === 1 ? '' : 's'}</span><span><strong>{needsReview}</strong> need{needsReview === 1 ? 's' : ''} review</span></div>
      {executableSkills.map((inspection) => {
        const state = inspection.trust.state;
        const reviewRequired = state === 'untrusted' || state === 'changed';
        const executableFiles = inspection.files.filter((file) => file.executable);
        const additionalRisks = inspection.risks.filter((risk) => risk.code !== 'executable');
        const checked = confirmed.has(inspection.artifact.id);
        const isApproving = approving === inspection.artifact.id;
        return <article className={`rg-executable-skill rg-executable-skill--${state}`} key={inspection.artifact.id}>
          <header>
            <span className="rg-executable-skill__icon"><FileCode2 size={17} aria-hidden="true" /></span>
            <div><h2>{inspection.artifact.title}</h2><p><code>{inspection.artifact.slug}</code> · {inspection.artifact.targets.map(providerLabelForSettings).join(', ') || 'No provider targets'}</p></div>
            <span className={`rg-executable-status rg-executable-status--${state}`}>{skillTrustLabel(state)}</span>
          </header>
          <dl className="rg-executable-metadata">
            <div><dt>Current revision</dt><dd><code title={inspection.revision}>{shortRevision(inspection.revision)}</code></dd></div>
            <div><dt>Executable files</dt><dd>{executableFiles.length}</dd></div>
            <div><dt>Total size</dt><dd>{formatBytes(inspection.totalBytes)}</dd></div>
            {inspection.trust.trustedAt === undefined ? null : <div><dt>Last approved</dt><dd>{formatTrustDate(inspection.trust.trustedAt)}</dd></div>}
          </dl>
          {state === 'changed' ? <div className="rg-executable-skill__notice"><AlertTriangle size={15} /><span><strong>This skill changed after approval.</strong> Review the current revision before syncing it again.</span></div> : null}
          {state === 'blocked' ? <div className="rg-executable-skill__notice rg-executable-skill__notice--error"><ShieldAlert size={15} /><span><strong>This skill cannot be approved.</strong> Resolve the blocking filesystem risks first.</span></div> : null}
          <details open={reviewRequired || state === 'blocked'}>
            <summary>Review {executableFiles.length} executable file{executableFiles.length === 1 ? '' : 's'}</summary>
            <div className="rg-executable-files">{executableFiles.map((file) => <div key={file.relPath}><code>{file.relPath}</code><span>{formatBytes(file.size)}{file.binary ? ' · binary' : ''}{file.contentHash === undefined ? '' : ` · ${shortRevision(file.contentHash)}`}</span></div>)}</div>
          </details>
          {additionalRisks.length === 0 ? null : <details open={inspection.promotionBlocked}><summary>Review {additionalRisks.length} additional finding{additionalRisks.length === 1 ? '' : 's'}</summary><ul className="rg-executable-risks">{additionalRisks.map((risk) => <li key={`${risk.code}:${risk.relPath}`}><AlertTriangle size={14} /><span><strong>{risk.relPath}</strong><small>{risk.message}</small></span></li>)}</ul></details>}
          {reviewRequired ? <footer>
            <label><input type="checkbox" checked={checked} disabled={isApproving} onChange={(event) => setConfirmed((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(inspection.artifact.id);
              else next.delete(inspection.artifact.id);
              return next;
            })} /><span>I reviewed the executable files in revision <code>{shortRevision(inspection.revision)}</code>.</span></label>
            <Button tone="primary" disabled={!checked || isApproving} icon={isApproving ? <LoaderCircle className="rg-spin" size={14} /> : <ShieldCheck size={14} />} onClick={() => void approve(inspection)}>{isApproving ? 'Approving…' : 'Approve this revision'}</Button>
          </footer> : null}
        </article>;
      })}
    </section> : null}
  </>;
}

function readExecutableSkillInspection(value: JsonValue): ExecutableSkillInspection | null {
  if (!isJsonRecord(value) || !isJsonRecord(value.artifact) || !isJsonRecord(value.trust) ||
    typeof value.artifact.id !== 'string' || typeof value.artifact.title !== 'string' ||
    typeof value.artifact.slug !== 'string' || !Array.isArray(value.artifact.targets) ||
    !value.artifact.targets.every(isManagerProviderId) || typeof value.revision !== 'string' ||
    typeof value.totalBytes !== 'number' || !Array.isArray(value.files) || !Array.isArray(value.risks) ||
    typeof value.promotionBlocked !== 'boolean' || typeof value.requiresExecutableConfirmation !== 'boolean' ||
    !isSkillTrustState(value.trust.state)) return null;
  const files = value.files.map(readSkillFile);
  const risks = value.risks.map(readSkillRisk);
  if (files.some((file) => file === null) || risks.some((risk) => risk === null)) return null;
  return {
    artifact: {
      id: value.artifact.id,
      title: value.artifact.title,
      slug: value.artifact.slug,
      targets: value.artifact.targets,
    },
    revision: value.revision,
    totalBytes: value.totalBytes,
    files: files.filter((file): file is NonNullable<typeof file> => file !== null),
    risks: risks.filter((risk): risk is NonNullable<typeof risk> => risk !== null),
    promotionBlocked: value.promotionBlocked,
    requiresExecutableConfirmation: value.requiresExecutableConfirmation,
    trust: {
      state: value.trust.state,
      ...(typeof value.trust.revision === 'string' ? { revision: value.trust.revision } : {}),
      ...(typeof value.trust.trustedAt === 'string' ? { trustedAt: value.trust.trustedAt } : {}),
    },
  };
}

function readSkillFile(value: JsonValue) {
  if (!isJsonRecord(value) || typeof value.relPath !== 'string' || typeof value.size !== 'number' ||
    typeof value.executable !== 'boolean' || typeof value.binary !== 'boolean') return null;
  return {
    relPath: value.relPath,
    size: value.size,
    executable: value.executable,
    binary: value.binary,
    ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
  };
}

function readSkillRisk(value: JsonValue) {
  if (!isJsonRecord(value) || typeof value.code !== 'string' || !isRiskSeverity(value.severity) ||
    typeof value.relPath !== 'string' || typeof value.message !== 'string') return null;
  return { code: value.code, severity: value.severity, relPath: value.relPath, message: value.message };
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManagerProviderId(value: JsonValue): value is ManagerProviderId {
  return value === 'claude' || value === 'codex' || value === 'cursor' || value === 'gemini' || value === 'windsurf' || value === 'opencode';
}

function isSkillTrustState(value: JsonValue | undefined): value is SkillTrustState {
  return value === 'not-required' || value === 'untrusted' || value === 'changed' || value === 'trusted' || value === 'blocked';
}

function isRiskSeverity(value: JsonValue | undefined): value is 'info' | 'warning' | 'error' {
  return value === 'info' || value === 'warning' || value === 'error';
}

function skillTrustLabel(state: SkillTrustState): string {
  if (state === 'trusted') return 'Approved';
  if (state === 'changed') return 'Changed';
  if (state === 'blocked') return 'Blocked';
  if (state === 'not-required') return 'No approval needed';
  return 'Needs review';
}

function providerLabelForSettings(provider: ManagerProviderId): string {
  const labels: Record<ManagerProviderId, string> = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', windsurf: 'Windsurf', opencode: 'OpenCode' };
  return labels[provider];
}

function shortRevision(revision: string): string {
  return revision.slice(0, 12);
}

function formatTrustDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function SyncSettings({ client, snapshot, busy, onRefresh, onError, onDisable }: { client: ManagerClient; snapshot: ManagerSnapshotV3 | null; busy: boolean; onRefresh: () => Promise<void>; onError: (message: string) => void; onDisable: () => void }) {
  const sync = snapshot?.settings.sync;
  return <><SectionHeader title="Sync & devices" description="Optional, self-hosted, end-to-end encrypted canonical-library sync." /><dl className="rg-key-values"><div><dt>Status</dt><dd>{sync?.state ?? 'disabled'}</dd></div><div><dt>Conflicts</dt><dd>{sync?.conflictCount ?? 0}</dd></div><div><dt>Manager sessions</dt><dd>{snapshot?.settings.sessions?.length ?? 0}</dd></div></dl><section className="rg-settings-group"><h2>Server connection</h2><SyncConnectionPanel client={client} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /></section>{sync?.phase === 'active' ? <SyncOperationsPanel client={client} revision={snapshot?.revision ?? 0} onRefresh={onRefresh} onError={onError} /> : null}{sync?.enabled ? <section className="rg-settings-group"><h2>Disconnect</h2><p>Local editing and provider Apply remain available after disconnecting.</p><Button tone="danger" disabled={busy} onClick={onDisable}>Disable sync</Button></section> : null}</>;
}

function RemoteSettings({ snapshot, busy, onDisable }: { snapshot: ManagerSnapshotV3 | null; busy: boolean; onDisable: () => void }) {
  const remote = snapshot?.settings.remote;
  return <><SectionHeader title="Remote access" description="Disabled by default. Tailnet and custom HTTPS are supported remote paths." /><dl className="rg-key-values"><div><dt>Status</dt><dd>{remote?.enabled ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Endpoint</dt><dd><code>{remote?.endpoint ?? 'Loopback only'}</code></dd></div></dl>{remote?.enabled ? <Button tone="danger" disabled={busy} onClick={onDisable}>Disable remote access</Button> : null}</>;
}

function BackupsSettings() {
  return <><SectionHeader title="Backups" description="Provider backups, operation receipts, and canonical history stay filesystem-backed." /><div className="rg-inline-notice"><Database size={15} /><span>Restore actions are contextual to provider Apply receipts so successful units remain independently recoverable.</span></div></>;
}

function DiagnosticsSettings({ snapshot }: { snapshot: ManagerSnapshotV3 | null }) {
  return <><SectionHeader title="Diagnostics" description="Redacted health information excludes secrets, artifact bodies, and project paths." /><dl className="rg-key-values"><div><dt>Health</dt><dd>{snapshot?.diagnostics.healthy ? 'Healthy' : 'Attention required'}</dd></div></dl><div className="rg-settings-list">{snapshot?.diagnostics.issues.map((issue) => <div key={`${issue.code}:${issue.message}`}><strong>{issue.code}</strong><span>{issue.message}</span></div>)}</div></>;
}
