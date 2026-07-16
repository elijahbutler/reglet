import {
  Check,
  Clipboard,
  Cloud,
  KeyRound,
  Laptop,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  isSyncInvitation,
  isSyncRunResult,
  isSyncSnapshot,
  type JsonValue,
  type SyncDeviceSummary,
  type SyncInvitation,
  type SyncPendingConnection,
  type SyncRunResult,
  type SyncSnapshot,
} from '@reglet/manager-protocol';
import type { ManagerBridge } from '../../managerBridge.js';
import { ModalDialog } from '../ModalDialog.js';

interface SyncViewProps {
  bridge: ManagerBridge;
  incomingLink: string | null;
  onConsumedLink: () => void;
  onReview: () => void;
}

type Confirmation =
  | { kind: 'cancel' }
  | { kind: 'revoke'; device: SyncDeviceSummary }
  | { kind: 'disconnect' }
  | { kind: 'local-only' };

export function SyncView({ bridge, incomingLink, onConsumedLink, onReview }: SyncViewProps) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [mode, setMode] = useState<'link' | 'request'>('link');
  const [connectUrl, setConnectUrl] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [pending, setPending] = useState<SyncPendingConnection | null>(null);
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [approveCode, setApproveCode] = useState('');
  const [invitation, setInvitation] = useState<SyncInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastRun, setLastRun] = useState<SyncRunResult | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const refresh = useCallback(async () => {
    const value = await bridge.rpc('sync.snapshot', {});
    if (!isSyncSnapshot(value)) throw new Error('Reglet returned an invalid encrypted sync snapshot.');
    setSnapshot(value);
    setPending(value.pending);
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void refresh().catch((cause: unknown) => {
      if (active) setError(errorMessage(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (incomingLink === null) return;
    setConnectUrl(incomingLink);
    setMode('link');
    onConsumedLink();
  }, [incomingLink, onConsumedLink]);

  const pollStatus = useCallback(async () => {
    const value = await bridge.rpc('sync.pair.status', {});
    const status = pendingConnection(value);
    setPending(status);
  }, [bridge]);

  useEffect(() => {
    if (snapshot?.phase !== 'pending' || pending === null || isExpired(pending.expiresAt) || pending.status !== 'pending') return;
    void pollStatus().catch((cause: unknown) => setError(errorMessage(cause)));
    const timer = window.setInterval(() => {
      void pollStatus().catch((cause: unknown) => setError(errorMessage(cause)));
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [pending?.expiresAt, pending?.status, pollStatus, snapshot?.phase]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const enablePreview = () => run(async () => {
    const value = await bridge.rpc('sync.preview.set', { acknowledged: true });
    if (!isSyncSnapshot(value)) throw new Error('Reglet returned an invalid encrypted sync snapshot.');
    setSnapshot(value);
  });

  const startConnection = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const kind = connectionKind(connectUrl);
      const value = kind === 'bootstrap'
        ? await bridge.rpc('sync.bootstrap.start', { connectUrl, deviceName })
        : await bridge.rpc('sync.pair.request', { connectUrl, deviceName });
      pendingConnectionStart(value);
      await refresh();
    });
  };

  const requestByCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await bridge.rpc('sync.pair.request', { serverUrl, deviceName });
      await refresh();
    });
  };

  const completeConnection = () => run(async () => {
    if (pending?.fingerprint === null || pending === null) throw new Error('The approval fingerprint is not available yet.');
    await bridge.rpc('sync.pair.complete', { fingerprint: pending.fingerprint });
    setFingerprintConfirmed(false);
    await refresh();
  });

  const syncNow = () => run(async () => {
    const value = await bridge.rpc('sync.run', {});
    if (!isSyncRunResult(value)) throw new Error('Reglet returned an invalid sync result.');
    setLastRun(value);
    await refresh();
  });

  const createInvitation = () => run(async () => {
    const value = await bridge.rpc('sync.invitation.create', {});
    if (!isSyncInvitation(value)) throw new Error('Reglet returned an invalid invitation.');
    setInvitation(value);
    setCopied(false);
  });

  const approvePairing = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await bridge.rpc('sync.pair.approve', { code: approveCode.trim().toUpperCase() });
      setApproveCode('');
    });
  };

  const confirmAction = () => run(async () => {
    const action = confirmation;
    if (action === null) return;
    setConfirmation(null);
    if (action.kind === 'cancel') {
      await bridge.rpc('sync.pair.cancel', {});
    } else if (action.kind === 'revoke') {
      await bridge.rpc('sync.device.revoke', { deviceId: action.device.id });
    } else {
      await bridge.rpc('sync.disconnect', { localOnly: action.kind === 'local-only' });
    }
    await refresh();
  });

  if (loading) return <SyncShell><div className="sync-empty" role="status"><LoaderCircle className="animate-spin" /> Loading encrypted sync state...</div></SyncShell>;
  if (snapshot === null) return <SyncShell><SyncError message={error ?? 'Encrypted sync state is unavailable.'} /></SyncShell>;

  return (
    <SyncShell
      action={snapshot.phase === 'connected'
        ? <button className="icon-button" aria-label="Refresh encrypted sync status" onClick={() => void run(refresh)} disabled={busy}><RefreshCw size={17} /></button>
        : undefined}
    >
      {error !== null && <SyncError message={error} onDismiss={() => setError(null)} />}
      {snapshot.keyRotationRequired && (
        <div className="sync-warning" role="alert"><ShieldAlert size={18} /><div><strong>Vault key rotation is required</strong><p>Revocation blocks server access but does not remove keys already held by that device.</p></div></div>
      )}
      {snapshot.phase === 'disabled' && (
        <PreviewOptIn checked={acknowledged} onChecked={setAcknowledged} onEnable={() => void enablePreview()} busy={busy} />
      )}
      {snapshot.phase === 'disconnected' && (
        <DisconnectedView
          mode={mode}
          setMode={setMode}
          connectUrl={connectUrl}
          setConnectUrl={setConnectUrl}
          serverUrl={serverUrl}
          setServerUrl={setServerUrl}
          deviceName={deviceName}
          setDeviceName={setDeviceName}
          onLinkSubmit={startConnection}
          onRequestSubmit={requestByCode}
          busy={busy}
        />
      )}
      {snapshot.phase === 'pending' && pending !== null && (
        <PendingView
          pending={pending}
          confirmed={fingerprintConfirmed}
          onConfirmed={setFingerprintConfirmed}
          onComplete={() => void completeConnection()}
          onCancel={() => setConfirmation({ kind: 'cancel' })}
          busy={busy}
        />
      )}
      {snapshot.phase === 'connected' && (
        <ConnectedView
          snapshot={snapshot}
          lastRun={lastRun}
          invitation={invitation}
          copied={copied}
          approveCode={approveCode}
          setApproveCode={setApproveCode}
          onSync={() => void syncNow()}
          onReview={onReview}
          onInvite={() => void createInvitation()}
          onCopy={() => invitation === null ? undefined : void navigator.clipboard.writeText(invitation.connectUrl).then(() => setCopied(true))}
          onCloseInvitation={() => setInvitation(null)}
          onApprove={approvePairing}
          onRename={(deviceId, name) => void run(async () => {
            await bridge.rpc('sync.device.rename', { deviceId, name });
            await refresh();
          })}
          onRevoke={(device) => setConfirmation({ kind: 'revoke', device })}
          onDisconnect={() => setConfirmation({ kind: 'disconnect' })}
          onLocalOnly={() => setConfirmation({ kind: 'local-only' })}
          busy={busy}
        />
      )}
      {confirmation !== null && <ConfirmationDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => void confirmAction()} busy={busy} />}
    </SyncShell>
  );
}

function SyncShell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="sync-view" aria-labelledby="sync-title"><div className="sync-titlebar"><div><div className="sync-eyebrow"><Cloud size={14} /> Preview</div><h2 id="sync-title">Encrypted Sync</h2></div>{action}</div>{children}</section>;
}

function PreviewOptIn(props: { checked: boolean; onChecked: (value: boolean) => void; onEnable: () => void; busy: boolean }) {
  return <div className="sync-guided"><div className="sync-guided-icon"><KeyRound size={24} /></div><div><h3>Keep your Reglet source encrypted across devices</h3><p>Keys and plaintext remain on your devices. Sync is manual, and pulled provider changes still require local Review & Apply.</p></div><label className="sync-ack"><input type="checkbox" checked={props.checked} onChange={(event) => props.onChecked(event.currentTarget.checked)} />I understand this preview does not yet rotate vault keys after revocation.</label><button className="primary-button w-fit" disabled={!props.checked || props.busy} onClick={props.onEnable}>Enable encrypted sync</button></div>;
}

function DisconnectedView(props: {
  mode: 'link' | 'request'; setMode: (mode: 'link' | 'request') => void;
  connectUrl: string; setConnectUrl: (value: string) => void;
  serverUrl: string; setServerUrl: (value: string) => void;
  deviceName: string; setDeviceName: (value: string) => void;
  onLinkSubmit: (event: FormEvent) => void; onRequestSubmit: (event: FormEvent) => void; busy: boolean;
}) {
  return <div className="sync-guided"><div className="sync-mode" role="tablist" aria-label="Connection method"><button role="tab" aria-selected={props.mode === 'link'} className={props.mode === 'link' ? 'active' : ''} onClick={() => props.setMode('link')}><Link2 size={16} />Invitation link</button><button role="tab" aria-selected={props.mode === 'request'} className={props.mode === 'request' ? 'active' : ''} onClick={() => props.setMode('request')}><Server size={16} />Request a code</button></div>{props.mode === 'link' ? <form className="sync-form" onSubmit={props.onLinkSubmit}><label className="field-label">Invitation link<input className="text-input" type="url" required value={props.connectUrl} onChange={(event) => props.setConnectUrl(event.currentTarget.value)} placeholder="https://sync.example/connect#grant=..." /></label><DeviceName value={props.deviceName} onChange={props.setDeviceName} /><button className="primary-button w-fit" disabled={props.busy}>{props.busy ? <LoaderCircle className="animate-spin" size={16} /> : <Link2 size={16} />}Connect</button></form> : <form className="sync-form" onSubmit={props.onRequestSubmit}><label className="field-label">Sync server<input className="text-input" type="url" required value={props.serverUrl} onChange={(event) => props.setServerUrl(event.currentTarget.value)} placeholder="https://sync.example" /></label><DeviceName value={props.deviceName} onChange={props.setDeviceName} /><button className="primary-button w-fit" disabled={props.busy}>{props.busy ? <LoaderCircle className="animate-spin" size={16} /> : <KeyRound size={16} />}Request access code</button></form>}</div>;
}

function DeviceName({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="field-label">Device name<input className="text-input" required maxLength={80} value={value} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function PendingView(props: { pending: SyncPendingConnection; confirmed: boolean; onConfirmed: (value: boolean) => void; onComplete: () => void; onCancel: () => void; busy: boolean }) {
  const expired = isExpired(props.pending.expiresAt);
  const ready = props.pending.status === 'approved' || props.pending.status === 'claimed';
  return <div className="sync-guided"><div className="sync-pending-heading"><LoaderCircle className={ready || expired ? '' : 'animate-spin'} size={22} /><div><h3>{expired ? 'Connection expired' : ready ? 'Approval received' : 'Waiting for approval'}</h3><p>{props.pending.method === 'bootstrap' ? 'Approve the matching fingerprint in the owner dashboard.' : 'Enter this code on a connected Reglet device.'}</p></div></div>{props.pending.code !== null && <output className="sync-code" aria-label="Pairing code">{props.pending.code}</output>}{props.pending.fingerprint !== null && <output className="sync-fingerprint" aria-label="Connection fingerprint">{props.pending.fingerprint}</output>}<p className="text-xs text-reglet-muted">Expires {formatDate(props.pending.expiresAt)}</p>{ready && props.pending.fingerprint !== null && <label className="sync-ack"><input type="checkbox" checked={props.confirmed} onChange={(event) => props.onConfirmed(event.currentTarget.checked)} />The fingerprint matches the approving dashboard or device.</label>}<div className="flex gap-2">{ready && <button className="primary-button" disabled={!props.confirmed || props.busy} onClick={props.onComplete}><Check size={16} />Finish connection</button>}<button className="danger-button" disabled={props.busy} onClick={props.onCancel}><X size={16} />Cancel request</button></div></div>;
}

function ConnectedView(props: {
  snapshot: SyncSnapshot; lastRun: SyncRunResult | null; invitation: SyncInvitation | null; copied: boolean;
  approveCode: string; setApproveCode: (value: string) => void; onSync: () => void; onReview: () => void;
  onInvite: () => void; onCopy: () => void; onCloseInvitation: () => void; onApprove: (event: FormEvent) => void;
  onRename: (id: string, name: string) => void; onRevoke: (device: SyncDeviceSummary) => void;
  onDisconnect: () => void; onLocalOnly: () => void; busy: boolean;
}) {
  const run = props.lastRun ?? summaryAsRun(props.snapshot.lastSync);
  return <div className="sync-connected"><div className="sync-health"><div><span>Server</span><strong>{props.snapshot.serverHost}</strong></div><div><span>Status</span><strong className={`sync-health-${props.snapshot.compatibility}`}>{compatibilityLabel(props.snapshot.compatibility)}</strong></div><div><span>This device</span><strong>{props.snapshot.currentDeviceName}</strong></div><div><span>Last sync</span><strong>{props.snapshot.lastSync === null ? 'Never' : formatDate(props.snapshot.lastSync.completedAt)}</strong></div></div><div className="sync-actions"><button className="primary-button" disabled={props.busy || props.snapshot.compatibility !== 'compatible'} onClick={props.onSync}><RefreshCw size={16} />Sync now</button>{run?.providerReviewRequired === true && <button className="secondary-button" onClick={props.onReview}>Review &amp; Apply</button>}</div>{run !== null && <RunSummary run={run} />}<section className="sync-section" aria-labelledby="devices-title"><div className="sync-section-heading"><div><h3 id="devices-title">Devices</h3><p>One encrypted vault, with server access tracked per device.</p></div><button className="secondary-button" onClick={props.onInvite} disabled={props.busy}><Plus size={16} />Add device</button></div>{props.invitation !== null && <Invitation invitation={props.invitation} copied={props.copied} onCopy={props.onCopy} onClose={props.onCloseInvitation} />}<form className="sync-code-entry" onSubmit={props.onApprove}><label className="field-label">Approve by code<input className="text-input font-mono uppercase" minLength={8} maxLength={8} value={props.approveCode} onChange={(event) => props.setApproveCode(event.currentTarget.value)} placeholder="AB12CD34" /></label><button className="secondary-button" disabled={props.busy || props.approveCode.trim().length !== 8}><KeyRound size={16} />Inspect request</button></form><div className="sync-ledger">{props.snapshot.devices.length === 0 ? <div className="sync-empty"><Laptop size={20} />Device registry unavailable.</div> : props.snapshot.devices.map((device) => <DeviceRow key={device.id} device={device} onRename={props.onRename} onRevoke={props.onRevoke} busy={props.busy} />)}</div></section><section className="sync-section sync-disconnect"><div><h3>Disconnect this device</h3><p>Remote disconnect revokes server access before local credentials are removed.</p></div><div className="flex flex-wrap gap-2"><button className="danger-button" onClick={props.onDisconnect} disabled={props.busy}><Unplug size={16} />Disconnect</button><button className="secondary-button" onClick={props.onLocalOnly} disabled={props.busy}>Remove locally only</button></div></section></div>;
}

function DeviceRow({ device, onRename, onRevoke, busy }: { device: SyncDeviceSummary; onRename: (id: string, name: string) => void; onRevoke: (device: SyncDeviceSummary) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  return <div className="sync-ledger-row"><Laptop size={18} /><div className="sync-ledger-primary">{editing ? <form onSubmit={(event) => { event.preventDefault(); onRename(device.id, name); setEditing(false); }}><input className="text-input" aria-label={`Rename ${device.name}`} value={name} maxLength={80} onChange={(event) => setName(event.currentTarget.value)} autoFocus /><button className="icon-button" aria-label="Save device name"><Check size={15} /></button></form> : <><strong>{device.name}{device.current ? ' (this device)' : ''}</strong><span>Added {formatDate(device.createdAt)} · last seen {device.lastSeenAt === null ? 'never' : formatDate(device.lastSeenAt)}</span></>} </div><span className={`sync-device-status ${device.status}`}>{device.status}</span>{device.status === 'active' && <div className="sync-row-actions"><button className="icon-button" aria-label={`Rename ${device.name}`} title="Rename device" disabled={busy} onClick={() => setEditing(true)}><Pencil size={15} /></button>{!device.current && <button className="icon-button sync-danger-icon" aria-label={`Revoke ${device.name}`} title="Revoke device" disabled={busy} onClick={() => onRevoke(device)}><Trash2 size={15} /></button>}</div>}</div>;
}

function Invitation({ invitation, copied, onCopy, onClose }: { invitation: SyncInvitation; copied: boolean; onCopy: () => void; onClose: () => void }) {
  return <div className="sync-invitation"><div className="sync-qr"><QRCodeSVG value={invitation.connectUrl} size={128} level="M" /></div><div className="min-w-0"><strong>Device invitation</strong><p>Expires {formatDate(invitation.expiresAt)}</p><code>{invitation.connectUrl}</code><div className="mt-3 flex gap-2"><button className="secondary-button" onClick={onCopy}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? 'Copied' : 'Copy link'}</button><button className="icon-button" aria-label="Close invitation" onClick={onClose}><X size={16} /></button></div></div></div>;
}

function RunSummary({ run }: { run: SyncRunResult }) {
  const values = [['Pulled', run.pulled.length], ['Pushed', run.pushed.length], ['Merged', run.merged.length], ['Deleted', run.deleted.length], ['Conflicts', run.conflicts.length]] as const;
  return <div className="sync-run" aria-label="Last sync result">{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function ConfirmationDialog({ confirmation, onCancel, onConfirm, busy }: { confirmation: Confirmation; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  const content = confirmationCopy(confirmation);
  return <ModalDialog labelledBy="sync-confirm-title" describedBy="sync-confirm-body" onClose={onCancel} closeDisabled={busy} role="alertdialog"><h2 id="sync-confirm-title" className="text-lg font-semibold">{content.title}</h2><p id="sync-confirm-body" className="mt-2 text-sm text-reglet-muted">{content.body}</p><div className="mt-5 flex justify-end gap-2"><button data-dialog-autofocus className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{content.action}</button></div></ModalDialog>;
}

function SyncError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div className="sync-error" role="alert"><ShieldAlert size={17} /><span>{message}</span>{onDismiss !== undefined && <button onClick={onDismiss}>Dismiss</button>}</div>;
}

function pendingConnection(value: JsonValue): SyncPendingConnection {
  if (!isRecord(value) || (value.method !== 'bootstrap' && value.method !== 'pair') ||
    (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'claimed' && value.status !== 'cancelled') ||
    typeof value.deviceName !== 'string' || !nullableString(value.code) || !nullableString(value.fingerprint) || typeof value.expiresAt !== 'string') {
    throw new Error('Reglet returned an invalid pairing status.');
  }
  return { method: value.method, status: value.status, deviceName: value.deviceName, code: value.code, fingerprint: value.fingerprint, expiresAt: value.expiresAt };
}

function pendingConnectionStart(value: JsonValue): void {
  if (!isRecord(value)) throw new Error('Reglet returned an invalid connection response.');
}

function connectionKind(value: string): 'bootstrap' | 'pair' {
  try {
    const kind = new URLSearchParams(new URL(value).hash.slice(1)).get('kind');
    if (kind === 'bootstrap' || kind === 'pair') return kind;
  } catch {
    // The Manager RPC validates the full link and returns the actionable error.
  }
  throw new Error('This invitation does not identify whether it creates or joins a vault. Create a new invitation.');
}

function summaryAsRun(value: SyncSnapshot['lastSync']): SyncRunResult | null {
  if (value === null) return null;
  return { completedAt: value.completedAt, pulled: Array(value.pulled).fill(''), pushed: Array(value.pushed).fill(''), merged: Array(value.merged).fill(''), conflicts: Array(value.conflicts).fill(''), deleted: Array(value.deleted).fill(''), providerReviewRequired: value.providerReviewRequired };
}

function confirmationCopy(value: Confirmation): { title: string; body: string; action: string } {
  if (value.kind === 'cancel') return { title: 'Cancel connection request', body: 'The invitation or access request will no longer be usable on this device.', action: 'Cancel request' };
  if (value.kind === 'revoke') return { title: `Revoke ${value.device.name}`, body: 'This blocks future server access. The vault key must still be rotated before the device loses access to data it already holds.', action: 'Revoke device' };
  if (value.kind === 'local-only') return { title: 'Remove local credentials only', body: 'Use this only while the server is offline. This device will remain authorized remotely until another device or the owner dashboard revokes it.', action: 'Remove locally' };
  return { title: 'Disconnect this device', body: 'Reglet will revoke this device on the server, then remove its local sync credentials and derived merge bases.', action: 'Disconnect' };
}

function compatibilityLabel(value: SyncSnapshot['compatibility']): string {
  if (value === 'compatible') return 'Compatible';
  if (value === 'revoked') return 'Access revoked';
  if (value === 'unreachable') return 'Unreachable';
  return 'Not checked';
}

function defaultDeviceName(): string {
  const platform = navigator.platform.toLowerCase();
  return platform.includes('win') ? 'Windows PC' : platform.includes('mac') ? 'Mac' : 'Reglet device';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function isExpired(value: string): boolean { return Date.parse(value) <= Date.now(); }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
