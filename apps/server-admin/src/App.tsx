import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronRight,
  Clipboard,
  DatabaseBackup,
  Eye,
  EyeOff,
  Gauge,
  HardDrive,
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
  BackupSummary,
  ConnectionGrant,
  DeviceSummary,
  PendingConnection,
} from '../../../packages/server/src/admin-types.js';

interface DashboardData {
  overview: AdminOverview;
  connections: PendingConnection[];
  devices: DeviceSummary[];
  backups: BackupSummary[];
}

interface SessionResponse {
  session: AdminSession;
  csrfToken: string;
}

type AdminSection = 'overview' | 'connections' | 'devices' | 'host';

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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (claim !== null && password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both password fields are identical.');
      return;
    }
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
          <label>
            Password
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                autoComplete={claim === null ? 'current-password' : 'new-password'}
                type={showPassword ? 'text' : 'password'}
                minLength={12}
                maxLength={1024}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ width: '100%', paddingRight: '40px' }}
                required
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '4px', opacity: 0.7 }}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {claim !== null && (
            <label>
              Confirm password
              <input
                autoComplete="new-password"
                type={showPassword ? 'text' : 'password'}
                minLength={12}
                maxLength={1024}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
          )}
          {error !== '' && <ErrorNotice message={error} />}
          <button className="primary" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
            {claim === null ? 'Sign in' : 'Set owner access'}
          </button>
          {claim === null && (
            <p style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '16px', lineHeight: 1.4, textAlign: 'center' }}>
              Forgot password? Run inside your server container terminal:<br />
              <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>bun packages/server/src/admin.ts set-password &lt;new-password&gt;</code>
            </p>
          )}
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
  const [integrityCheckedAt, setIntegrityCheckedAt] = useState('');
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');

  const load = useCallback(async () => {
    props.setError('');
    try {
      const overview = await api<AdminOverview>('/api/admin/v1/overview');
      const [connections, devices, backups] = await Promise.all([
        api<{ connections: PendingConnection[] }>('/api/admin/v1/connections'),
        api<{ devices: DeviceSummary[] }>('/api/admin/v1/devices'),
        overview.capabilities.serverBackups
          ? api<{ backups: BackupSummary[] }>('/api/admin/v1/backups')
          : Promise.resolve({ backups: [] }),
      ]);
      setData({ overview, connections: connections.connections, devices: devices.devices, backups: backups.backups });
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

  const checkIntegrity = async (): Promise<void> => {
    setBusy('integrity');
    props.setError('');
    try {
      const result = await api<{ ok: true; checkedAt: string }>('/api/admin/v1/integrity-check', {
        method: 'POST',
        headers: { 'x-reglet-csrf': props.csrfToken },
      });
      setIntegrityCheckedAt(result.checkedAt);
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
        <div className="breadcrumb" aria-label="Current location">
          <span>Sync server</span>
          <ChevronRight aria-hidden="true" />
          <strong>Owner console</strong>
        </div>
        <div className="topbar-actions">
          <span className="owner-email">{props.session.email}</span>
          <button className="icon-button" title="Refresh" aria-label="Refresh dashboard" onClick={() => void load()}><RefreshCw aria-hidden="true" /></button>
          <button className="icon-button" title="Sign out" aria-label="Sign out" disabled={busy === 'logout'} onClick={() => void logout()}><LogOut aria-hidden="true" /></button>
        </div>
      </header>
      <div className="admin-workbench">
        <AdminNavigation
          activeSection={activeSection}
          pendingConnections={data?.overview.vault.pendingConnections ?? 0}
          onNavigate={setActiveSection}
        />
        <main className="dashboard-content">
          <section className="overview-section" id="overview" aria-labelledby="overview-title">
            <div className="page-heading">
              <div><h1 id="overview-title">Encrypted sync</h1><p>Server access and host health. Vault contents remain device-only.</p></div>
              <button className="primary" disabled={busy === 'grant'} onClick={() => void createGrant()}>
                {busy === 'grant' ? <LoaderCircle className="spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                Add device
              </button>
            </div>
            {props.error !== '' && <ErrorNotice message={props.error} />}
            {data === null ? <DashboardSkeleton /> : <HealthStrip overview={data.overview} />}
          </section>
          {data !== null && <>
            {grant !== null && <InvitationPanel grant={grant} copied={copied} onCopy={() => void navigator.clipboard.writeText(grant.connectUrl).then(() => setCopied(true))} onClose={() => setGrant(null)} />}
            <PendingLedger connections={data.connections} busy={busy} onApprove={(id) => void mutate(`approve:${id}`, `/api/admin/v1/connections/${encodeURIComponent(id)}/approve`, { method: 'POST' })} onCancel={(id) => void mutate(`cancel:${id}`, `/api/admin/v1/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })} />
            <DeviceLedger devices={data.devices} busy={busy} onRename={(id, name) => void mutate(`rename:${id}`, `/api/admin/v1/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })} onRevoke={(id) => void mutate(`revoke:${id}`, `/api/admin/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })} />
            <HostOperations
              overview={data.overview}
              backups={data.backups}
              busy={busy}
              integrityCheckedAt={integrityCheckedAt}
              onBackup={() => void mutate('backup', '/api/admin/v1/backups', { method: 'POST' })}
              onIntegrity={() => void checkIntegrity()}
            />
          </>}
        </main>
      </div>
      <footer className="status-bar">
        <span><i className="status-dot" aria-hidden="true" />Owner session active</span>
        <span>Encrypted envelopes only</span>
        <span className="status-bar-end">{data === null ? 'Connecting' : `Schema ${data.overview.schema.current} · ${data.overview.vault.activeDevices} active device${data.overview.vault.activeDevices === 1 ? '' : 's'}`}</span>
      </footer>
    </div>
  );
}

function AdminNavigation({ activeSection, pendingConnections, onNavigate }: {
  activeSection: AdminSection;
  pendingConnections: number;
  onNavigate: (section: AdminSection) => void;
}): JSX.Element {
  const items: Array<{ id: AdminSection; label: string; icon: JSX.Element; count?: number }> = [
    { id: 'overview', label: 'Overview', icon: <Gauge /> },
    { id: 'connections', label: 'Connections', icon: <Link2 />, count: pendingConnections },
    { id: 'devices', label: 'Devices', icon: <Laptop /> },
    { id: 'host', label: 'Host operations', icon: <HardDrive /> },
  ];
  return (
    <aside className="admin-navigation" aria-label="Owner console sections">
      <nav>
        {items.map((item) => <a
          className={`nav-row ${activeSection === item.id ? 'nav-row-active' : ''}`}
          href={`#${item.id}`}
          aria-current={activeSection === item.id ? 'location' : undefined}
          onClick={() => onNavigate(item.id)}
          key={item.id}
        >
          <span className="nav-row-icon" aria-hidden="true">{item.icon}</span>
          <span className="nav-row-label">{item.label}</span>
          {item.count === undefined || item.count === 0 ? null : <small>{item.count}</small>}
        </a>)}
      </nav>
      <div className="boundary-note">
        <ShieldCheck aria-hidden="true" />
        <div><strong>Device-only vault</strong><span>This server stores authenticated ciphertext, never vault keys.</span></div>
      </div>
    </aside>
  );
}

function HostOperations({ overview, backups, busy, integrityCheckedAt, onBackup, onIntegrity }: {
  overview: AdminOverview;
  backups: BackupSummary[];
  busy: string;
  integrityCheckedAt: string;
  onBackup: () => void;
  onIntegrity: () => void;
}): JSX.Element {
  return <section className="ledger-section host-operations" id="host">
    <div className="section-heading"><div><h2>Host operations</h2><p>Verified snapshots and live SQLite integrity.</p></div><div className="row-actions"><button className="secondary" onClick={onIntegrity} disabled={busy !== ''}>{busy === 'integrity' ? <LoaderCircle className="spin" /> : <HardDrive />}Check database</button>{overview.capabilities.serverBackups && <button className="secondary" onClick={onBackup} disabled={busy !== ''}>{busy === 'backup' ? <LoaderCircle className="spin" /> : <DatabaseBackup />}Create backup</button>}</div></div>
    {integrityCheckedAt !== '' && <div className="integrity-result" role="status"><ShieldCheck />Live database passed quick_check at {formatDate(integrityCheckedAt)}.</div>}
    {overview.capabilities.serverBackups ? <div className="ledger backup-ledger">{backups.length === 0 ? <div className="empty-ledger"><DatabaseBackup /><div><strong>No backups yet</strong><p>Create the first verified server snapshot.</p></div></div> : backups.map((backup) => <div className="ledger-row" key={backup.name}><DatabaseBackup /><div className="ledger-primary"><strong>{backup.name}</strong><span>{formatDate(backup.createdAt)} · {formatBytes(backup.sizeBytes)}</span></div><span className={`badge ${backup.verification === 'verified' ? 'active' : 'revoked'}`}>{backup.verification}</span></div>)}</div> : <div className="empty-ledger"><DatabaseBackup /><div><strong>Backup directory not configured</strong><p>Set REGLET_BACKUP_DIR to a dedicated mounted directory.</p></div></div>}
    <div className="restore-guard"><ShieldAlert /><div><strong>Restore stays offline</strong><p>Stop the service, preserve the current database and WAL files, replace the database from a verified backup, then require readiness and a two-device sync check. The dashboard never performs a live restore.</p><p>For upgrades, retain a verified backup, update the image or checkout, recreate the service, and confirm schema readiness before reconnecting clients.</p></div></div>
  </section>;
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
  const [copiedCmd, setCopiedCmd] = useState(false);
  const cliCommand = `reglet connect "${grant.connectUrl}"`;
  return (
    <section className="invitation-panel" aria-labelledby="invitation-title">
      <div>
        <h2 id="invitation-title">{grant.kind === 'bootstrap' ? 'Connect the first device' : 'Add a trusted device'}</h2>
        <p>Expires {formatDate(grant.expiresAt)}. Run this command on your device terminal:</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{cliCommand}</code>
        <div className="row-actions" style={{ marginTop: '4px' }}>
          <button
            className="primary"
            onClick={() => void navigator.clipboard.writeText(cliCommand).then(() => {
              setCopiedCmd(true);
              setTimeout(() => setCopiedCmd(false), 3000);
            })}
          >
            {copiedCmd ? <Check /> : <Clipboard />}
            {copiedCmd ? 'Copied command!' : 'Copy CLI command'}
          </button>
          <button className="secondary" onClick={onCopy}>
            {copied ? <Check /> : <Link2 />}
            {copied ? 'Copied link' : 'Copy link only'}
          </button>
          <button className="icon-button" title="Close invitation" aria-label="Close invitation" onClick={onClose}><X /></button>
        </div>
      </div>
    </section>
  );
}

function PendingLedger({ connections, busy, onApprove, onCancel }: { connections: PendingConnection[]; busy: string; onApprove: (id: string) => void; onCancel: (id: string) => void }): JSX.Element {
  return (
    <section className="ledger-section" id="connections">
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
    <section className="ledger-section" id="devices">
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
  const params = new URLSearchParams(window.location.hash.slice(1));
  const grant = params.get('grant');
  const kind = params.get('kind');
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const invitation = window.location.href;
  const cliCommand = `reglet connect "${invitation}"`;
  const deepLink = grant === null ? '' : `reglet://connect#grant=${encodeURIComponent(grant)}&server=${encodeURIComponent(window.location.origin)}${kind === 'bootstrap' || kind === 'pair' ? `&kind=${kind}` : ''}`;
  return (
    <main className="handoff-shell">
      <section className="handoff-panel">
        <Brand />
        <div className="handoff-icon"><Link2 /></div>
        <h1>Connect to {window.location.hostname}</h1>
        <p>This invitation gives Reglet permission to request encrypted sync access.</p>
        {grant === null ? (
          <ErrorNotice message="This invitation link is incomplete." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', alignItems: 'center' }}>
            <code style={{ userSelect: 'all', wordBreak: 'break-all', textAlign: 'left', padding: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', width: '100%' }}>
              {cliCommand}
            </code>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                className="primary"
                onClick={() => void navigator.clipboard.writeText(cliCommand).then(() => {
                  setCopiedCmd(true);
                  setTimeout(() => setCopiedCmd(false), 3000);
                })}
              >
                {copiedCmd ? <Check /> : <Clipboard />}
                {copiedCmd ? 'Copied CLI Command!' : 'Copy CLI Command'}
              </button>
              <a className="secondary link-button" href={deepLink}>Open Desktop App<ChevronRight /></a>
              <button className="secondary" onClick={() => void navigator.clipboard.writeText(invitation).then(() => setCopied(true))}>
                {copied ? <Check /> : <Link2 />}
                {copied ? 'Copied link' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
        <p className="boundary"><ShieldCheck />The server cannot read vault content or transfer vault keys.</p>
      </section>
    </main>
  );
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
function formatBytes(value: number): string { return new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 2 }).format(value / 1_000_000); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
