import { CheckCircle2, Database, Download, FolderRoot, KeyRound, Laptop, Radio, RefreshCw, Settings, Shield, ShieldAlert, ShieldCheck, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerHostActions, ManagerUpdateDownloadEvent, ManagerUpdateStatus } from '../../app/ManagerApp.js';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';
import { SyncConnectionPanel } from './SyncConnectionPanel.js';

const sections = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'roots', label: 'Project roots', icon: FolderRoot },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'sync', label: 'Sync & devices', icon: Laptop },
  { id: 'remote', label: 'Remote access', icon: Radio },
  { id: 'backups', label: 'Backups', icon: Database },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope },
] as const;

type SettingsSection = (typeof sections)[number]['id'];

export function SettingsWorkbench({ client, hostActions, updateStatus, onUpdateStatus, snapshot, onRefresh, onError }: {
  client: ManagerClient;
  hostActions?: ManagerHostActions;
  updateStatus: ManagerUpdateStatus | null;
  onUpdateStatus: (status: ManagerUpdateStatus | null) => void;
  snapshot: ManagerSnapshotV3 | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>('general');
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
        <div className="rg-artifact-list">{sections.map(({ id, label, icon: Icon }) => <Row key={id} active={section === id} leading={<Icon size={15} />} onClick={() => setSection(id)}>{label}</Row>)}</div>
      </Pane>
      <Pane label="Settings detail" className="rg-operation-canvas">
        <PaneHeader><span>{sections.find((candidate) => candidate.id === section)?.label}</span></PaneHeader>
        <div className="rg-detail-document">
          {section === 'general' ? <GeneralSettings hostActions={hostActions} updateStatus={updateStatus} onUpdateStatus={onUpdateStatus} snapshot={snapshot} /> : null}
          {section === 'roots' ? <RootsSettings snapshot={snapshot} rootPath={rootPath} onRootPath={setRootPath} busy={busy} onAdd={() => void run(async () => {
            await client.command('project.root.add', { path: rootPath });
            setRootPath('');
            await onRefresh();
          })} /> : null}
          {section === 'secrets' ? <SecretSettings snapshot={snapshot} id={secretId} value={secretValue} busy={busy} onId={setSecretId} onValue={setSecretValue} onBind={() => void run(async () => {
            await client.command('secret.set', { id: secretId, value: secretValue });
            setSecretValue('');
            await onRefresh();
          })} /> : null}
          {section === 'sync' ? <SyncSettings client={client} snapshot={snapshot} busy={busy} onRefresh={onRefresh} onError={onError} onDisable={() => void run(async () => { await client.command('sync.disable', {}); await onRefresh(); })} /> : null}
          {section === 'remote' ? <RemoteSettings snapshot={snapshot} busy={busy} onDisable={() => void run(async () => { await client.command('remote.disable', {}); await onRefresh(); })} /> : null}
          {section === 'backups' ? <BackupsSettings /> : null}
          {section === 'diagnostics' ? <DiagnosticsSettings snapshot={snapshot} /> : null}
        </div>
      </Pane>
      <Pane label="Settings security boundary" className="rg-inspector" tone="raised">
        <PaneHeader><span>Security boundary</span></PaneHeader>
        <section className="rg-inspector-section"><h2>Local by default</h2><div className="rg-artifact-summary"><Shield size={17} /><span><strong>Admin scope required</strong><small>Roots, secrets, sessions, sync endpoints, and network settings are excluded from remote write sessions.</small></span></div></section>
        <section className="rg-inspector-section"><h2>Current session</h2><dl className="rg-key-values"><div><dt>Scope</dt><dd>{snapshot?.permissions.scope ?? '—'}</dd></div><div><dt>Admin</dt><dd>{snapshot?.permissions.canAdmin ? 'Yes' : 'No'}</dd></div></dl></section>
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

function GeneralSettings({ hostActions, updateStatus, onUpdateStatus, snapshot }: {
  hostActions?: ManagerHostActions;
  updateStatus: ManagerUpdateStatus | null;
  onUpdateStatus: (status: ManagerUpdateStatus | null) => void;
  snapshot: ManagerSnapshotV3 | null;
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
  return <><SectionHeader title="General" description="Canonical library and local runtime status." /><dl className="rg-key-values"><div><dt>Library schema</dt><dd>v{snapshot?.library.schemaVersion ?? '—'}</dd></div><div><dt>Protocol</dt><dd>v{snapshot?.protocolVersion ?? '—'}</dd></div><div><dt>Revision</dt><dd>{snapshot?.revision ?? '—'}</dd></div><div><dt>Migration</dt><dd>{snapshot?.library.migration.status ?? '—'}</dd></div></dl>{hostActions?.checkForUpdates !== undefined ? <section className="rg-settings-group rg-update-panel" aria-labelledby="desktop-updates-title">
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

function SecretSettings({ snapshot, id, value, busy, onId, onValue, onBind }: { snapshot: ManagerSnapshotV3 | null; id: string; value: string; busy: boolean; onId: (value: string) => void; onValue: (value: string) => void; onBind: () => void }) {
  return <><SectionHeader title="Secrets" description="Values remain in the native keychain and never enter APIs or canonical content." /><label className="rg-field"><span>Reference ID</span><input value={id} onChange={(event) => onId(event.target.value)} autoComplete="off" /></label><label className="rg-field"><span>Secret value</span><input type="password" value={value} onChange={(event) => onValue(event.target.value)} autoComplete="new-password" /></label><Button disabled={busy || id.trim().length === 0 || value.length === 0} onClick={onBind}>Bind locally</Button><div className="rg-settings-list">{snapshot?.settings.secretBindings.map((binding) => <div key={binding.id}><strong>{binding.id}</strong><span>{binding.bound ? 'Bound' : 'Unbound'}</span></div>)}</div></>;
}

function SyncSettings({ client, snapshot, busy, onRefresh, onError, onDisable }: { client: ManagerClient; snapshot: ManagerSnapshotV3 | null; busy: boolean; onRefresh: () => Promise<void>; onError: (message: string) => void; onDisable: () => void }) {
  const sync = snapshot?.settings.sync;
  return <><SectionHeader title="Sync & devices" description="Optional, self-hosted, end-to-end encrypted canonical-library sync." /><dl className="rg-key-values"><div><dt>Status</dt><dd>{sync?.state ?? 'disabled'}</dd></div><div><dt>Conflicts</dt><dd>{sync?.conflictCount ?? 0}</dd></div><div><dt>Manager sessions</dt><dd>{snapshot?.settings.sessions?.length ?? 0}</dd></div></dl><section className="rg-settings-group"><h2>Server connection</h2><SyncConnectionPanel client={client} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /></section>{sync?.enabled ? <section className="rg-settings-group"><h2>Disconnect</h2><p>Local editing and provider Apply remain available after disconnecting.</p><Button tone="danger" disabled={busy} onClick={onDisable}>Disable sync</Button></section> : null}</>;
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
