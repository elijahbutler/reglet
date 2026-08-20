import { CheckCircle2, Copy, Download, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { JsonValue, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';

const installGuideUrl = 'https://github.com/elijahbutler/reglet/blob/main/docs/sync-server.md';

interface PendingConnection {
  method: 'bootstrap' | 'pair';
  status: 'pending' | 'approved' | 'claimed' | 'cancelled' | 'expired';
  code: string | null;
  fingerprint: string | null;
  expiresAt: string;
}

export function SyncConnectionPanel({ client, snapshot, onRefresh, onError, onConnected }: {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3 | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onConnected?: () => void;
}) {
  const [connectUrl, setConnectUrl] = useState('');
  const [deviceName, setDeviceName] = useState('Reglet Desktop');
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const sync = snapshot?.settings.sync;

  const loadConnection = useCallback(async () => {
    try {
      const result = await client.command('sync.snapshot', {});
      const connection = pendingFromSnapshot(result.data);
      setPending(connection);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Reglet could not read the encrypted sync connection.');
    }
  }, [client, onError]);

  useEffect(() => { void loadConnection(); }, [loadConnection]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) {
      onError(error instanceof Error ? error.message : 'The encrypted sync operation failed.');
    } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const kind = connectionKind(connectUrl);
    const result = kind === 'pair'
      ? await client.command('sync.pair.request', { connectUrl: connectUrl.trim(), deviceName: deviceName.trim() })
      : await client.command('sync.bootstrap.start', { connectUrl: connectUrl.trim(), deviceName: deviceName.trim() });
    setPending(pendingFromStart(result.data, kind));
    await onRefresh();
  });

  const check = () => run(async () => {
    const result = await client.command('sync.pair.status', {});
    setPending(pendingFromStatus(result.data));
  });

  const finish = () => run(async () => {
    if (pending?.fingerprint === null || pending?.fingerprint === undefined) return;
    await client.command('sync.pair.complete', { fingerprint: pending.fingerprint });
    setPending(null);
    await onRefresh();
    onConnected?.();
  });

  const syncNow = () => run(async () => {
    await client.command('sync.run', {});
    await onRefresh();
  });

  const cancel = () => run(async () => {
    await client.command('sync.pair.cancel', {});
    setPending(null);
    await onRefresh();
  });

  if (sync?.phase === 'active') {
    return <div className="rg-sync-connection rg-sync-connection--connected">
      <div className="rg-connection-summary"><CheckCircle2 size={18} /><span><strong>Encrypted server connected</strong><small>{sync.lastCompletedAt === undefined ? 'Initial sync is still required.' : `Last synced ${new Date(sync.lastCompletedAt).toLocaleString()}`}</small></span></div>
      <Button disabled={busy} icon={<RefreshCw className={busy ? 'rg-spin' : undefined} size={14} />} onClick={() => void syncNow()}>{busy ? 'Syncing…' : sync.lastCompletedAt === undefined ? 'Run initial sync' : 'Sync now'}</Button>
    </div>;
  }

  if (pending !== null) {
    const ready = (pending.status === 'approved' || pending.status === 'claimed') && pending.fingerprint !== null;
    const expired = pending.status === 'expired';
    return <div className="rg-sync-connection rg-sync-pending" aria-live="polite">
      <div className="rg-connection-summary"><ShieldCheck size={18} /><span><strong>{expired ? 'This connection request expired' : pending.method === 'bootstrap' ? 'Approve this device in the owner dashboard' : 'Approve this device from a connected Reglet device'}</strong><small>{expired ? 'Clear it before starting a new encrypted connection.' : 'The fingerprint must match before Reglet accepts encryption keys.'}</small></span></div>
      {pending.code === null ? null : <ConnectionValue label="Request code" value={pending.code} />}
      {pending.fingerprint === null ? null : <ConnectionValue label="Fingerprint" value={pending.fingerprint} />}
      <small className="rg-connection-expiry">Expires {new Date(pending.expiresAt).toLocaleString()}</small>
      <div className="rg-connection-actions">
        {expired ? null : <Button tone="secondary" disabled={busy} icon={<RefreshCw size={14} />} onClick={() => void check()}>Check approval</Button>}
        {expired ? null : <Button tone="primary" disabled={busy || !ready} onClick={() => void finish()}>Confirm fingerprint</Button>}
        <Button tone="secondary" disabled={busy} onClick={() => void cancel()}>{expired ? 'Clear expired request' : 'Cancel connection'}</Button>
      </div>
    </div>;
  }

  return <div className="rg-sync-options">
    <section className="rg-sync-option">
      <div className="rg-connection-summary"><Server size={18} /><span><strong>Connect an existing server</strong><small>Paste a short-lived invitation from your self-hosted Reglet server or another trusted device.</small></span></div>
      <label className="rg-field"><span>Secure invitation URL</span><input value={connectUrl} onChange={(event) => setConnectUrl(event.currentTarget.value)} placeholder="https://sync.example.com/connect#…" /></label>
      <label className="rg-field"><span>This device</span><input value={deviceName} onChange={(event) => setDeviceName(event.currentTarget.value)} /></label>
      <Button tone="primary" disabled={busy || connectUrl.trim().length === 0 || deviceName.trim().length === 0} onClick={() => void start()}>{busy ? 'Connecting…' : 'Connect securely'}</Button>
    </section>
    <section className="rg-sync-option">
      <div className="rg-connection-summary"><Download size={18} /><span><strong>Install your own server</strong><small>Deploy the single-owner encrypted homeserver with Docker, then return with its invitation URL.</small></span></div>
      <code className="rg-install-command">docker compose up -d --build</code>
      <Button tone="secondary" icon={<Download size={14} />} onClick={() => window.open(installGuideUrl, '_blank', 'noopener,noreferrer')}>Open installation guide</Button>
    </section>
  </div>;
}

function ConnectionValue({ label, value }: { label: string; value: string }) {
  return <div className="rg-connection-value"><span>{label}</span><code>{value}</code><button type="button" aria-label={`Copy ${label.toLocaleLowerCase()}`} onClick={() => void navigator.clipboard.writeText(value)}><Copy size={14} /></button></div>;
}

function connectionKind(value: string): 'bootstrap' | 'pair' {
  try {
    return new URLSearchParams(new URL(value.trim()).hash.slice(1)).get('kind') === 'pair' ? 'pair' : 'bootstrap';
  } catch {
    return 'bootstrap';
  }
}

function pendingFromSnapshot(value: JsonValue): PendingConnection | null {
  if (!isRecord(value) || value.phase !== 'pending' || !isRecord(value.pending)) return null;
  return pendingFromStatus(value.pending);
}

function pendingFromStart(value: JsonValue, method: 'bootstrap' | 'pair'): PendingConnection {
  if (!isRecord(value)) throw new Error('The sync server returned an invalid connection response.');
  return {
    method,
    status: 'pending',
    code: readNullableString(value.code),
    fingerprint: readNullableString(value.fingerprint),
    expiresAt: readString(value.expiresAt, 'Connection expiry'),
  };
}

function pendingFromStatus(value: JsonValue): PendingConnection {
  if (!isRecord(value) || (value.method !== 'bootstrap' && value.method !== 'pair')) {
    throw new Error('The sync server returned an invalid approval status.');
  }
  const statuses = ['pending', 'approved', 'claimed', 'cancelled', 'expired'] as const;
  const status = statuses.find((candidate) => candidate === value.status);
  if (status === undefined) throw new Error('The sync server returned an unknown approval state.');
  return {
    method: value.method,
    status,
    code: readNullableString(value.code),
    fingerprint: readNullableString(value.fingerprint),
    expiresAt: readString(value.expiresAt, 'Connection expiry'),
  };
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`);
  return value;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, JsonValue | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
