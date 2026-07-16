import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronRight,
  Clipboard,
  KeyRound,
  Laptop,
  Link2,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AdminOverview,
  AdminSession,
  ConnectionGrant,
  DeviceSummary,
  PendingConnection,
} from '../../../packages/server/src/admin-types.js';

interface DashboardData {
  overview: AdminOverview;
  connections: PendingConnection[];
  devices: DeviceSummary[];
}

interface SessionResponse {
  session: AdminSession;
  csrfToken: string;
}

export function App(): JSX.Element {
  if (window.location.pathname === '/connect') return <ConnectionHandoff />;
  return <AdminApp />;
}

function AdminApp(): JSX.Element {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<SessionResponse>('/api/admin/v1/session')
      .then((value) => {
        setSession(value.session);
        setCsrfToken(value.csrfToken);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen />;
  if (session === null) {
    return <AuthScreen onAuthenticated={(value) => {
      setSession(value.session);
      setCsrfToken(value.csrfToken);
      setError('');
    }} />;
  }
  return (
    <Dashboard
      session={session}
      csrfToken={csrfToken}
      error={error}
      setError={setError}
      onLoggedOut={() => {
        setSession(null);
        setCsrfToken('');
      }}
    />
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (value: SessionResponse) => void }): JSX.Element {
  const claim = claimFromHash();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = claim === null ? '/api/admin/v1/login' : '/api/admin/v1/claim';
      const value = await api<SessionResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(claim === null ? {} : { token: claim.token }) }),
      });
      history.replaceState(null, '', '/admin');
      onAuthenticated(value);
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <Brand />
        <div className="auth-heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h1 id="auth-title">{claim === null ? 'Owner sign in' : claim.kind === 'claim' ? 'Claim this server' : 'Reset owner access'}</h1>
            <p>{claim === null ? 'Manage encrypted relay access and host operations.' : 'Set the only owner account for this self-hosted server.'}</p>
          </div>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>Email<input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input autoComplete={claim === null ? 'current-password' : 'new-password'} type="password" minLength={12} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error !== '' && <ErrorNotice message={error} />}
          <button className="primary" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
            {claim === null ? 'Sign in' : 'Set owner access'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard(props: {
  session: AdminSession;
  csrfToken: string;
  error: string;
  setError: (value: string) => void;
  onLoggedOut: () => void;
}): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState('');
  const [grant, setGrant] = useState<ConnectionGrant | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    props.setError('');
    try {
      const [overview, connections, devices] = await Promise.all([
        api<AdminOverview>('/api/admin/v1/overview'),
        api<{ connections: PendingConnection[] }>('/api/admin/v1/connections'),
        api<{ devices: DeviceSummary[] }>('/api/admin/v1/devices'),
      ]);
      setData({ overview, connections: connections.connections, devices: devices.devices });
    } catch (requestError) {
      props.setError(message(requestError));
    }
  }, [props.setError]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (key: string, route: string, init: RequestInit): Promise<void> => {
    setBusy(key);
    props.setError('');
    try {
      await api(route, { ...init, headers: { ...init.headers, 'x-reglet-csrf': props.csrfToken } });
      await load();
    } catch (requestError) {
      props.setError(message(requestError));
    } finally {
      setBusy('');
    }
  };

  const createGrant = async (): Promise<void> => {
    setBusy('grant');
    try {
      const next = await api<ConnectionGrant>('/api/admin/v1/connections', {
        method: 'POST',
        headers: { 'x-reglet-csrf': props.csrfToken },
      });
      setGrant(next);
      setCopied(false);
    } catch (requestError) {
      props.setError(message(requestError));
    } finally {
      setBusy('');
    }
  };

  const logout = async (): Promise<void> => {
    setBusy('logout');
    try {
      await api('/api/admin/v1/logout', { method: 'POST', headers: { 'x-reglet-csrf': props.csrfToken } });
      props.onLoggedOut();
    } catch (requestError) {
      props.setError(message(requestError));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="owner-email">{props.session.email}</span>
          <button className="icon-button" title="Refresh" aria-label="Refresh dashboard" onClick={() => void load()}><RefreshCw aria-hidden="true" /></button>
          <button className="icon-button" title="Sign out" aria-label="Sign out" disabled={busy === 'logout'} onClick={() => void logout()}><LogOut aria-hidden="true" /></button>
        </div>
      </header>
      <main className="dashboard-content">
        <div className="page-heading">
          <div><h1>Encrypted sync</h1><p>Server access and host health. Vault contents remain device-only.</p></div>
          <button className="primary" disabled={busy === 'grant'} onClick={() => void createGrant()}>
            {busy === 'grant' ? <LoaderCircle className="spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            Add device
          </button>
        </div>
        {props.error !== '' && <ErrorNotice message={props.error} />}
        {data === null ? <DashboardSkeleton /> : <>
          <HealthStrip overview={data.overview} />
          {grant !== null && <InvitationPanel grant={grant} copied={copied} onCopy={() => void navigator.clipboard.writeText(grant.connectUrl).then(() => setCopied(true))} onClose={() => setGrant(null)} />}
          <PendingLedger connections={data.connections} busy={busy} onApprove={(id) => void mutate(`approve:${id}`, `/api/admin/v1/connections/${encodeURIComponent(id)}/approve`, { method: 'POST' })} onCancel={(id) => void mutate(`cancel:${id}`, `/api/admin/v1/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })} />
          <DeviceLedger devices={data.devices} busy={busy} onRename={(id, name) => void mutate(`rename:${id}`, `/api/admin/v1/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })} onRevoke={(id) => void mutate(`revoke:${id}`, `/api/admin/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })} />
        </>}
      </main>
    </div>
  );
}

function HealthStrip({ overview }: { overview: AdminOverview }): JSX.Element {
  return (
    <section className="health-strip" aria-label="Server status">
      <Status icon={<Server />} label="Server" value={`v${overview.service.version}`} tone="ok" />
      <Status icon={<ShieldCheck />} label="Schema" value={`${overview.schema.current} ready`} tone={overview.schema.ready ? 'ok' : 'warn'} />
      <Status icon={<Laptop />} label="Devices" value={String(overview.vault.activeDevices)} tone="neutral" />
      <Status icon={<Link2 />} label="Pending" value={String(overview.vault.pendingConnections)} tone={overview.vault.pendingConnections > 0 ? 'info' : 'neutral'} />
    </section>
  );
}

function Status({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone: string }): JSX.Element {
  return <div className={`status ${tone}`}>{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function InvitationPanel({ grant, copied, onCopy, onClose }: { grant: ConnectionGrant; copied: boolean; onCopy: () => void; onClose: () => void }): JSX.Element {
  return (
    <section className="invitation-panel" aria-labelledby="invitation-title">
      <div><h2 id="invitation-title">{grant.kind === 'bootstrap' ? 'Connect the first device' : 'Add a trusted device'}</h2><p>Expires {formatDate(grant.expiresAt)}. The bearer remains in the link fragment.</p></div>
      <code>{grant.connectUrl}</code>
      <div className="row-actions"><button className="secondary" onClick={onCopy}>{copied ? <Check /> : <Clipboard />}{copied ? 'Copied' : 'Copy link'}</button><button className="icon-button" title="Close invitation" aria-label="Close invitation" onClick={onClose}><X /></button></div>
    </section>
  );
}

function PendingLedger({ connections, busy, onApprove, onCancel }: { connections: PendingConnection[]; busy: string; onApprove: (id: string) => void; onCancel: (id: string) => void }): JSX.Element {
  return (
    <section className="ledger-section">
      <div className="section-heading"><div><h2>Pending connections</h2><p>First-device setup may be approved here. Later devices require a trusted Reglet device.</p></div></div>
      {connections.length === 0 ? <EmptyLedger icon={<Link2 />} title="No devices waiting" detail="New connection requests appear here until they expire." /> : <div className="ledger">
        {connections.map((item) => <div className="ledger-row" key={item.id}>
          <Smartphone aria-hidden="true" /><div className="ledger-primary"><strong>{item.deviceName}</strong><span>{item.kind === 'bootstrap' ? 'First device' : 'Trusted-device pairing'} · expires {formatDate(item.expiresAt)}</span><code>{item.fingerprint}</code></div>
          <span className={`badge ${item.status}`}>{item.status}</span>
          <div className="row-actions">{item.kind === 'bootstrap' && item.status === 'pending' && <button className="secondary" disabled={busy !== ''} onClick={() => onApprove(item.id)}>{busy === `approve:${item.id}` ? <LoaderCircle className="spin" /> : <ShieldCheck />}Approve</button>}<button className="icon-button danger" title="Cancel connection" aria-label={`Cancel connection for ${item.deviceName}`} disabled={busy !== ''} onClick={() => onCancel(item.id)}><X /></button></div>
        </div>)}
      </div>}
    </section>
  );
}

function DeviceLedger({ devices, busy, onRename, onRevoke }: { devices: DeviceSummary[]; busy: string; onRename: (id: string, name: string) => void; onRevoke: (id: string) => void }): JSX.Element {
  return (
    <section className="ledger-section">
      <div className="section-heading"><div><h2>Device access</h2><p>Revocation blocks server access but does not rotate the vault key.</p></div><ShieldAlert className="warning-icon" aria-label="Key rotation warning" /></div>
      {devices.length === 0 ? <EmptyLedger icon={<Laptop />} title="No connected devices" detail="Create an invitation to connect the first Reglet device." /> : <div className="ledger">
        {devices.map((device) => <DeviceRow key={device.id} device={device} busy={busy} onRename={onRename} onRevoke={onRevoke} />)}
      </div>}
    </section>
  );
}

function DeviceRow({ device, busy, onRename, onRevoke }: { device: DeviceSummary; busy: string; onRename: (id: string, name: string) => void; onRevoke: (id: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  return <div className="ledger-row">
    <Laptop aria-hidden="true" />
    <div className="ledger-primary">{editing ? <form className="inline-edit" onSubmit={(event) => { event.preventDefault(); onRename(device.id, name); setEditing(false); }}><input aria-label="Device name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /><button className="icon-button" title="Save name" aria-label="Save device name" type="submit"><Check /></button></form> : <strong>{device.name}</strong>}<span>Added {formatDate(device.createdAt)} · last seen {device.lastSeenAt === null ? 'never' : formatDate(device.lastSeenAt)}</span></div>
    <span className={`badge ${device.status}`}>{device.status}</span>
    <div className="row-actions">{device.status === 'active' && <><button className="secondary" disabled={busy !== ''} onClick={() => setEditing(true)}>Rename</button><button className="icon-button danger" title="Revoke device" aria-label={`Revoke ${device.name}`} disabled={busy !== ''} onClick={() => onRevoke(device.id)}>{busy === `revoke:${device.id}` ? <LoaderCircle className="spin" /> : <Trash2 />}</button></>}</div>
  </div>;
}

function ConnectionHandoff(): JSX.Element {
  const grant = new URLSearchParams(window.location.hash.slice(1)).get('grant');
  const [copied, setCopied] = useState(false);
  const invitation = window.location.href;
  const deepLink = grant === null ? '' : `reglet://connect#grant=${encodeURIComponent(grant)}&server=${encodeURIComponent(window.location.origin)}`;
  return <main className="handoff-shell"><section className="handoff-panel"><Brand /><div className="handoff-icon"><Link2 /></div><h1>Connect to {window.location.hostname}</h1><p>This invitation gives Reglet permission to request encrypted sync access. A trusted device must approve later-device membership.</p>{grant === null ? <ErrorNotice message="This invitation link is incomplete." /> : <><a className="primary link-button" href={deepLink}>Open Reglet<ChevronRight /></a><button className="secondary" onClick={() => void navigator.clipboard.writeText(invitation).then(() => setCopied(true))}>{copied ? <Check /> : <Clipboard />}{copied ? 'Copied invitation' : 'Copy for Reglet'}</button></>}<p className="boundary"><ShieldCheck />The server cannot read vault content or transfer vault keys.</p></section></main>;
}

function Brand(): JSX.Element { return <div className="brand"><span aria-hidden="true">R</span><strong>Reglet</strong><small>server</small></div>; }
function LoadingScreen(): JSX.Element { return <main className="loading-screen"><LoaderCircle className="spin" aria-label="Loading" /></main>; }
function DashboardSkeleton(): JSX.Element { return <div className="skeleton-stack" aria-label="Loading dashboard"><div /><div /><div /></div>; }
function ErrorNotice({ message: value }: { message: string }): JSX.Element { return <div className="error-notice" role="alert"><ShieldAlert aria-hidden="true" /><span>{value}</span></div>; }
function EmptyLedger({ icon, title, detail }: { icon: JSX.Element; title: string; detail: string }): JSX.Element { return <div className="empty-ledger">{icon}<div><strong>{title}</strong><p>{detail}</p></div></div>; }

async function api<T = object>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(route, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new Error(apiError(body));
  return body as T;
}

function apiError(value: unknown): string {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'message' in value.error
    ? String(value.error.message)
    : 'The server could not complete this request.';
}

function claimFromHash(): { kind: 'claim' | 'reset'; token: string } | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const claim = params.get('claim');
  if (claim !== null) return { kind: 'claim', token: claim };
  const reset = params.get('reset');
  return reset === null ? null : { kind: 'reset', token: reset };
}

function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
