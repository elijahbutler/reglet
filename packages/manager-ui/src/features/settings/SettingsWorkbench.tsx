import { Database, FolderRoot, KeyRound, Laptop, Radio, Settings, Shield, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import type { ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerHostActions, ManagerUpdateStatus } from '../../app/ManagerApp.js';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { Pane, PaneHeader } from '../../design-system/Pane.js';
import { Row } from '../../design-system/Row.js';

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

export function SettingsWorkbench({ client, hostActions, snapshot, onRefresh, onError }: {
  client: ManagerClient;
  hostActions?: ManagerHostActions;
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
          {section === 'general' ? <GeneralSettings hostActions={hostActions} snapshot={snapshot} onError={onError} /> : null}
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
          {section === 'sync' ? <SyncSettings snapshot={snapshot} busy={busy} onDisable={() => void run(async () => { await client.command('sync.disable', {}); await onRefresh(); })} /> : null}
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

function GeneralSettings({ hostActions, snapshot, onError }: { hostActions?: ManagerHostActions; snapshot: ManagerSnapshotV3 | null; onError: (message: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<ManagerUpdateStatus | null>(null);
  const check = async () => {
    if (hostActions?.checkForUpdates === undefined) return;
    setChecking(true);
    try { setUpdate(await hostActions.checkForUpdates()); } catch (error) { onError(error instanceof Error ? error.message : 'The update check failed.'); } finally { setChecking(false); }
  };
  return <><SectionHeader title="General" description="Canonical library and local runtime status." /><dl className="rg-key-values"><div><dt>Library schema</dt><dd>v{snapshot?.library.schemaVersion ?? '—'}</dd></div><div><dt>Protocol</dt><dd>v{snapshot?.protocolVersion ?? '—'}</dd></div><div><dt>Revision</dt><dd>{snapshot?.revision ?? '—'}</dd></div><div><dt>Migration</dt><dd>{snapshot?.library.migration.status ?? '—'}</dd></div></dl>{hostActions?.checkForUpdates !== undefined ? <section className="rg-settings-group"><h2>Desktop updates</h2><Button disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check for updates'}</Button>{update === null ? null : <div className="rg-inline-notice"><span>{update.available ? `Reglet ${update.latestVersion} is available. You have ${update.currentVersion}.` : `Reglet ${update.currentVersion} is current.`}</span>{update.available && hostActions.openRelease !== undefined ? <Button onClick={() => void hostActions.openRelease?.().catch((error: unknown) => onError(error instanceof Error ? error.message : 'The release page could not be opened.'))}>Open release</Button> : null}</div>}</section> : null}</>;
}

function RootsSettings({ snapshot, rootPath, onRootPath, busy, onAdd }: { snapshot: ManagerSnapshotV3 | null; rootPath: string; onRootPath: (value: string) => void; busy: boolean; onAdd: () => void }) {
  return <><SectionHeader title="Project roots" description="Read-only directories scanned for provider guidance." /><label className="rg-field"><span>Absolute root path</span><input value={rootPath} onChange={(event) => onRootPath(event.target.value)} placeholder="/Users/me/Code" /></label><Button disabled={busy || rootPath.trim().length === 0} onClick={onAdd}>Add root</Button><div className="rg-settings-list">{(snapshot?.projectInbox?.roots ?? []).map((root) => <div key={root.id}><strong>{root.label}</strong><code>{root.path}</code></div>)}</div></>;
}

function SecretSettings({ snapshot, id, value, busy, onId, onValue, onBind }: { snapshot: ManagerSnapshotV3 | null; id: string; value: string; busy: boolean; onId: (value: string) => void; onValue: (value: string) => void; onBind: () => void }) {
  return <><SectionHeader title="Secrets" description="Values remain in the native keychain and never enter APIs or canonical content." /><label className="rg-field"><span>Reference ID</span><input value={id} onChange={(event) => onId(event.target.value)} autoComplete="off" /></label><label className="rg-field"><span>Secret value</span><input type="password" value={value} onChange={(event) => onValue(event.target.value)} autoComplete="new-password" /></label><Button disabled={busy || id.trim().length === 0 || value.length === 0} onClick={onBind}>Bind locally</Button><div className="rg-settings-list">{snapshot?.settings.secretBindings.map((binding) => <div key={binding.id}><strong>{binding.id}</strong><span>{binding.bound ? 'Bound' : 'Unbound'}</span></div>)}</div></>;
}

function SyncSettings({ snapshot, busy, onDisable }: { snapshot: ManagerSnapshotV3 | null; busy: boolean; onDisable: () => void }) {
  const sync = snapshot?.settings.sync;
  return <><SectionHeader title="Sync & devices" description="Optional, self-hosted, end-to-end encrypted canonical-library sync." /><dl className="rg-key-values"><div><dt>Status</dt><dd>{sync?.state ?? 'disabled'}</dd></div><div><dt>Conflicts</dt><dd>{sync?.conflictCount ?? 0}</dd></div><div><dt>Manager sessions</dt><dd>{snapshot?.settings.sessions?.length ?? 0}</dd></div></dl>{sync?.enabled ? <Button tone="danger" disabled={busy} onClick={onDisable}>Disable sync</Button> : <div className="rg-inline-notice"><Shield size={15} /><span>Sync is disabled. All manager workflows remain available.</span></div>}</>;
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
