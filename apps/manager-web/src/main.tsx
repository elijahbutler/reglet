import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpManagerClient, ManagerApp } from '@reglet/manager-ui';
import '@reglet/manager-ui/styles.css';
import './styles.css';

type BootstrapState =
  | { status: 'loading' }
  | { status: 'pairing'; message?: string }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function BrowserManager() {
  const client = useMemo(() => new HttpManagerClient({ baseUrl: window.location.origin }), []);
  const [state, setState] = useState<BootstrapState>({ status: 'loading' });
  const [pairingCode, setPairingCode] = useState('');

  useEffect(() => {
    let disposed = false;
    const fragmentCode = new URLSearchParams(window.location.hash.slice(1)).get('pair');
    const bootstrap = async () => {
      try {
        if (fragmentCode !== null && fragmentCode.trim().length > 0) {
          await client.pair(fragmentCode);
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
        await client.snapshot();
        if (!disposed) setState({ status: 'ready' });
      } catch (error) {
        if (!disposed) setState({
          status: 'pairing',
          message: fragmentCode === null ? undefined : messageFrom(error),
        });
      }
    };
    void bootstrap();
    return () => { disposed = true; };
  }, [client]);

  const pair = async () => {
    setState({ status: 'loading' });
    try {
      await client.pair(pairingCode);
      await client.snapshot();
      setState({ status: 'ready' });
    } catch (error) {
      setState({ status: 'pairing', message: messageFrom(error) });
    }
  };

  if (state.status === 'ready') return <ManagerApp client={client} />;
  return (
    <main className="rg-bootstrap">
      <section className="rg-pairing" aria-labelledby="pairing-title">
        <span className="rg-pairing__mark" aria-hidden="true">R</span>
        <p className="rg-pairing__eyebrow">Local Manager</p>
        <h1 id="pairing-title">{state.status === 'loading' ? 'Connecting to Reglet' : 'Pair this browser'}</h1>
        <p>{state.status === 'loading'
          ? 'Validating the local runtime and encrypted session.'
          : 'Enter a one-use pairing code from the Reglet desktop or CLI. Codes expire after ten minutes.'}</p>
        {state.status === 'pairing' ? (
          <form onSubmit={(event) => { event.preventDefault(); void pair(); }}>
            <label htmlFor="pairing-code">Pairing code</label>
            <input
              id="pairing-code"
              autoComplete="one-time-code"
              autoFocus
              value={pairingCode}
              onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase())}
            />
            <button type="submit" disabled={pairingCode.trim().length === 0}>Pair browser</button>
          </form>
        ) : <span className="rg-pairing__progress" aria-label="Connecting" />}
        {'message' in state && state.message !== undefined ? <p className="rg-pairing__error" role="alert">{state.message}</p> : null}
        <small>Project paths, drafts, and credentials remain on this machine.</small>
      </section>
    </main>
  );
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : 'The local runtime could not be reached.';
}

const root = document.getElementById('root');
if (root === null) throw new Error('Manager root element is unavailable.');
createRoot(root).render(<StrictMode><BrowserManager /></StrictMode>);
