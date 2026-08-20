import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  KeyRound,
  Laptop,
  LoaderCircle,
  Pencil,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  isSyncConflictPreview,
  isSyncSnapshot,
  type SyncConflictContent,
  type SyncConflictPreview,
  type SyncDeviceSummary,
  type SyncSnapshot,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { useDialogFocus } from '../../design-system/useDialogFocus.js';

export function SyncOperationsPanel({ client, revision, onRefresh, onError }: {
  client: ManagerClient;
  revision: number;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [sync, setSync] = useState<SyncSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [revokeDevice, setRevokeDevice] = useState<SyncDeviceSummary | null>(null);
  const [conflictPath, setConflictPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.command('sync.snapshot', {});
      if (!isSyncSnapshot(response.data)) throw new Error('Reglet returned an invalid encrypted sync snapshot.');
      setSync(response.data);
    } catch (error) {
      onError(messageFrom(error, 'Reglet could not read encrypted sync state.'));
    } finally {
      setLoading(false);
    }
  }, [client, onError]);

  useEffect(() => { void load(); }, [load, revision]);

  const rename = async (device: SyncDeviceSummary) => {
    const name = deviceName.trim();
    if (name.length === 0) return;
    setDeviceBusy(true);
    try {
      await client.command('sync.device.rename', { deviceId: device.id, name });
      setRenamingId(null);
      await Promise.all([load(), onRefresh()]);
    } catch (error) {
      onError(messageFrom(error, 'Reglet could not rename the device.'));
    } finally {
      setDeviceBusy(false);
    }
  };

  if (loading && sync === null) return <section className="rg-settings-group"><div className="rg-sync-loading" role="status"><LoaderCircle className="rg-spin" size={16} /><span>Loading encrypted sync state</span></div></section>;
  if (sync === null) return null;

  return <>
    {sync.lastError === null ? null : <section className="rg-settings-group"><div className="rg-sync-alert rg-sync-alert--error"><AlertTriangle size={16} /><span><strong>Last sync did not finish</strong><small>{sync.lastError.message}</small><time>{formatDate(sync.lastError.occurredAt)}</time></span></div></section>}
    {sync.keyRotationRequired ? <section className="rg-settings-group"><div className="rg-sync-alert rg-sync-alert--warning"><KeyRound size={16} /><span><strong>Key rotation required</strong><small>A device was revoked. Complete a sync run before trusting new remote changes.</small></span></div></section> : null}
    <section className="rg-settings-group rg-sync-workspace" aria-labelledby="sync-conflicts-title"><div className="rg-settings-group__header"><div><h2 id="sync-conflicts-title">Conflicts</h2><p>Choose the canonical version only after comparing both encrypted copies.</p></div><span className="rg-count-badge">{sync.conflicts.length}</span></div>{sync.conflicts.length === 0 ? <div className="rg-sync-empty"><CheckCircle2 size={16} /><span><strong>No unresolved conflicts</strong><small>The local canonical library agrees with the last encrypted exchange.</small></span></div> : <div className="rg-sync-conflicts">{sync.conflicts.map((path) => <div key={path}><FileWarning size={16} /><span><strong>{fileName(path)}</strong><code>{path}</code></span><Button tone="secondary" onClick={() => setConflictPath(path)}>Review conflict</Button></div>)}</div>}</section>
    <section className="rg-settings-group rg-sync-workspace" aria-labelledby="sync-devices-title"><div className="rg-settings-group__header"><div><h2 id="sync-devices-title">Trusted devices</h2><p>Only active devices can exchange encrypted canonical content.</p></div><span className="rg-count-badge">{sync.devices.filter((device) => device.status === 'active').length}</span></div>{sync.devices.length === 0 ? <div className="rg-sync-empty"><Laptop size={16} /><span><strong>Device list unavailable</strong><small>{sync.compatibility === 'unreachable' ? 'The server could not be reached. Local editing remains available.' : 'No trusted devices were returned.'}</small></span></div> : <div className="rg-sync-devices">{sync.devices.map((device) => <div key={device.id} className={`rg-sync-device rg-sync-device--${device.status}`}><Laptop size={16} /><span><strong>{device.name}{device.current ? <small>Current</small> : null}</strong><small>{device.status === 'revoked' ? `Revoked ${formatDate(device.revokedAt)}` : `Last seen ${formatDate(device.lastSeenAt)}`}</small></span>{renamingId === device.id ? <form onSubmit={(event) => { event.preventDefault(); void rename(device); }}><label className="sr-only" htmlFor={`device-name-${device.id}`}>Device name</label><input id={`device-name-${device.id}`} autoFocus value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /><Button tone="primary" type="submit" disabled={deviceBusy || deviceName.trim().length === 0}>Save</Button><Button tone="quiet" disabled={deviceBusy} onClick={() => setRenamingId(null)}>Cancel</Button></form> : <div className="rg-sync-device__actions">{device.status === 'active' ? <Button tone="quiet" icon={<Pencil size={13} />} onClick={() => { setRenamingId(device.id); setDeviceName(device.name); }}>Rename</Button> : null}{device.status === 'active' && !device.current ? <Button tone="quiet" icon={<Trash2 size={13} />} onClick={() => setRevokeDevice(device)}>Revoke</Button> : null}</div>}</div>)}</div>}</section>
    <ConflictSheet path={conflictPath} client={client} onClose={() => setConflictPath(null)} onResolved={async () => { await Promise.all([load(), onRefresh()]); }} />
    <RevokeDeviceSheet device={revokeDevice} client={client} onClose={() => setRevokeDevice(null)} onRevoked={async () => { await Promise.all([load(), onRefresh()]); }} />
  </>;
}

function ConflictSheet({ path, client, onClose, onResolved }: { path: string | null; client: ManagerClient; onClose: () => void; onResolved: () => Promise<void> }) {
  const [preview, setPreview] = useState<SyncConflictPreview | null>(null);
  const [choice, setChoice] = useState<'ours' | 'theirs' | null>(null);
  const [phase, setPhase] = useState<'loading' | 'review' | 'resolving' | 'complete'>('loading');
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'loading' || phase === 'resolving';
  const dialog = useDialogFocus<HTMLElement>(path !== null, busy ? undefined : onClose);

  useEffect(() => {
    if (path === null) return;
    let current = true;
    setPreview(null);
    setChoice(null);
    setError(null);
    setPhase('loading');
    void client.command('sync.conflict.preview', { path }).then((response) => {
      if (!isSyncConflictPreview(response.data) || response.data.path !== path) throw new Error('Reglet returned an invalid conflict review.');
      if (!current) return;
      setPreview(response.data);
      setPhase('review');
    }).catch((previewError: unknown) => {
      if (!current) return;
      setError(messageFrom(previewError, 'Reglet could not inspect this conflict.'));
      setPhase('review');
    });
    return () => { current = false; };
  }, [client, path]);

  if (path === null) return null;

  const resolve = async () => {
    if (choice === null || preview?.path !== path) return;
    const reviewedPath = preview.path;
    setPhase('resolving');
    setError(null);
    try {
      const response = await client.command('sync.resolve', { path: reviewedPath, choice });
      if (!isResolution(response.data, reviewedPath, choice)) throw new Error('Reglet could not verify the conflict resolution. Check sync state before trying again.');
      await onResolved();
      setPhase('complete');
    } catch (resolveError) {
      setError(messageFrom(resolveError, 'Reglet could not resolve the conflict.'));
      setPhase('review');
    }
  };

  return <div className="rg-sheet-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}><aside ref={dialog} tabIndex={-1} className="rg-sheet rg-sync-conflict-sheet" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title" onMouseDown={(event) => event.stopPropagation()}><header className="rg-provider-action-sheet__header"><div><p className="rg-eyebrow">Encrypted sync conflict</p><h1 id="sync-conflict-title">Choose the canonical version</h1><code>{path}</code></div><button type="button" className="rg-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></header><div className="rg-sync-conflict-sheet__body">{error === null ? null : <div className="rg-review-notice rg-review-notice--error" role="alert"><AlertTriangle size={16} /><span><strong>Conflict needs attention</strong>{error}</span></div>}{phase === 'loading' ? <div className="rg-review-state" role="status"><LoaderCircle className="rg-spin" size={22} /><strong>Decrypting both versions</strong><span>Reglet is preparing a local-only comparison of this canonical artifact.</span></div> : null}{phase === 'resolving' ? <div className="rg-review-state" role="status"><LoaderCircle className="rg-spin" size={22} /><strong>Resolving reviewed conflict</strong><span>The selected version will become canonical on this device.</span></div> : null}{phase === 'review' && preview !== null ? <div className="rg-sync-conflict-choices" role="radiogroup" aria-label="Canonical conflict version"><ConflictChoice side="ours" title="Keep this device" detail="Preserve the current canonical content on this device." content={preview.local} selected={choice === 'ours'} onSelect={setChoice} /><ConflictChoice side="theirs" title="Use remote version" detail="Replace local canonical content with the encrypted remote version." content={preview.remote} selected={choice === 'theirs'} onSelect={setChoice} /></div> : null}{phase === 'complete' ? <div className="rg-provider-action-complete"><CheckCircle2 size={24} /><span><strong>Conflict resolved</strong><p>{choice === 'ours' ? 'This device remains canonical.' : 'The encrypted remote version is now canonical on this device.'} Provider files were not changed.</p></span></div> : null}</div><footer className="rg-provider-action-sheet__footer">{phase === 'complete' ? <Button tone="primary" onClick={onClose}>Done</Button> : <><Button tone="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button className="rg-review-apply" tone="primary" disabled={choice === null || busy} onClick={() => void resolve()}>Use selected version</Button></>}</footer></aside></div>;
}

function ConflictChoice({ side, title, detail, content, selected, onSelect }: { side: 'ours' | 'theirs'; title: string; detail: string; content: SyncConflictContent; selected: boolean; onSelect: (side: 'ours' | 'theirs') => void }) {
  return <label className={selected ? 'rg-sync-conflict-choice rg-sync-conflict-choice--selected' : 'rg-sync-conflict-choice'}><header><input type="radio" name="sync-conflict-choice" checked={selected} onChange={() => onSelect(side)} /><span><strong>{title}</strong><small>{detail}</small></span></header><dl><div><dt>State</dt><dd>{content.state}</dd></div><div><dt>Size</dt><dd>{formatBytes(content.size)}</dd></div><div><dt>Hash</dt><dd><code>{content.hash === null ? 'None' : shortHash(content.hash)}</code></dd></div></dl>{content.state === 'text' ? <pre>{content.content}</pre> : <div className="rg-sync-content-unavailable"><FileWarning size={16} /><span>{content.state === 'deleted' ? 'This version deletes the canonical artifact.' : content.state === 'binary' ? 'Binary content cannot be shown as text.' : 'This version is too large for an inline preview.'}</span></div>}</label>;
}

function RevokeDeviceSheet({ device, client, onClose, onRevoked }: { device: SyncDeviceSummary | null; client: ManagerClient; onClose: () => void; onRevoked: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useDialogFocus<HTMLElement>(device !== null, busy ? undefined : onClose);
  useEffect(() => { setConfirmed(false); setError(null); }, [device]);
  if (device === null) return null;
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.command('sync.device.revoke', { deviceId: device.id });
      await onRevoked();
      onClose();
    } catch (revokeError) {
      setError(messageFrom(revokeError, 'Reglet could not revoke the device.'));
    } finally {
      setBusy(false);
    }
  };
  return <div className="rg-sheet-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}><aside ref={dialog} tabIndex={-1} className="rg-sheet rg-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="revoke-device-title" onMouseDown={(event) => event.stopPropagation()}><header className="rg-provider-action-sheet__header"><div><p className="rg-eyebrow">Trusted device</p><h1 id="revoke-device-title">Revoke {device.name}</h1></div><button type="button" className="rg-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></header><div className="rg-confirm-sheet__body">{error === null ? null : <div className="rg-review-notice rg-review-notice--error" role="alert"><AlertTriangle size={16} /><span><strong>Revocation needs attention</strong>{error}</span></div>}<ShieldAlert size={24} /><div><strong>This device will lose sync access</strong><p>Its local library stays intact. Reglet may require encryption key rotation before the next trusted exchange.</p></div><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that {device.name} will no longer exchange encrypted canonical content.</span></label></div><footer className="rg-provider-action-sheet__footer"><Button tone="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button tone="danger" disabled={busy || !confirmed} onClick={() => void revoke()}>{busy ? 'Revoking…' : 'Revoke device'}</Button></footer></aside></div>;
}

function isResolution(value: unknown, path: string, choice: 'ours' | 'theirs'): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'path' in value && value.path === path && 'choice' in value && value.choice === choice && 'resolved' in value && value.resolved === true;
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function shortHash(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(1)} KB`;
}

function formatDate(value: string | null): string {
  if (value === null) return 'Never';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
