import { useEffect, useState } from 'react';
import { ManagerApp, type TauriManagerClient } from '@reglet/manager-ui';
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { tauriConnectLinks } from './deepLinks.js';
import { bootstrapTauriManagerClient, subscribeManagerRuntimeTermination } from './runtimeBootstrap.js';
import { desktopHostActions } from './updater.js';

export function DesktopManager() {
  const [client, setClient] = useState<TauriManagerClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  const connect = () => {
    setRetrying(true);
    setClient(null);
    setError(null);
    void bootstrapTauriManagerClient()
      .then((next) => {
        setClient(next);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The local Manager runtime could not start.');
      })
      .finally(() => {
        setRetrying(false);
      });
  };

  useEffect(() => {
    let disposed = false;
    let connectionAttempt = 0;
    const connectInternal = () => {
      const attempt = ++connectionAttempt;
      setClient(null);
      setError(null);
      void bootstrapTauriManagerClient().then((next) => {
        if (!disposed && attempt === connectionAttempt) setClient(next);
      }).catch((cause: unknown) => {
        if (!disposed && attempt === connectionAttempt) {
          setError(cause instanceof Error ? cause.message : 'The local Manager runtime could not start.');
        }
      });
    };
    const unsubscribe = subscribeManagerRuntimeTermination(connectInternal);
    connectInternal();
    return () => { disposed = true; connectionAttempt += 1; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (client === null) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handle = (connectUrl: string) => {
      const fragment = new URLSearchParams(new URL(connectUrl).hash.slice(1));
      const operation = fragment.get('kind') === 'pair' ? 'sync.pair.request' : 'sync.bootstrap.start';
      const input = operation === 'sync.pair.request'
        ? { connectUrl, deviceName: 'Reglet Desktop' }
        : { connectUrl, deviceName: 'Reglet Desktop' };
      void client.command(operation, input).catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'The encrypted sync connection could not start.');
      });
    };
    void tauriConnectLinks.current().then((current) => { if (!disposed && current !== null) handle(current); });
    void tauriConnectLinks.listen(handle).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, [client]);

  const copyCommand = (cmd: string, index: number) => {
    void navigator.clipboard.writeText(cmd);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (client !== null) return <ManagerApp client={client} hostActions={desktopHostActions} />;

  if (error !== null) {
    return (
      <main className="rg-desktop-bootstrap min-h-screen bg-[var(--rg-canvas,#08090b)] text-[var(--rg-text,#f3f3f2)] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-[var(--rg-surface,#101216)] border border-[var(--rg-border,rgba(255,255,255,0.08))] rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="flex items-center gap-3">
            <span className="rg-desktop-bootstrap__mark shrink-0" aria-hidden="true">R</span>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white m-0">Reglet CLI Required</h1>
              <p className="text-xs text-[var(--rg-muted,#8a8f98)] m-0 mt-0.5">Background local runtime was not detected.</p>
            </div>
          </div>

          <p role="alert" className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 m-0 leading-relaxed">
            Reglet Desktop communicates with the encrypted local CLI engine to manage your agents and synced vault. Install the CLI to get started:
          </p>

          <div className="space-y-2">
            <div className="text-[11px] font-medium text-[var(--rg-muted,#8a8f98)] uppercase tracking-wider">
              Installation Options
            </div>

            {[
              { label: 'Homebrew (macOS / Linux)', cmd: 'brew install elijahbutler/tap/reglet' },
              { label: 'Standalone Installer', cmd: 'curl -fsSL https://reglet.cloudview.cc/install.sh -o install.sh && bash install.sh' },
              { label: 'Bun / Node', cmd: 'bun install -g reglet' },
            ].map((option, idx) => (
              <div
                key={option.label}
                className="flex items-center justify-between p-2.5 rounded-lg bg-black/40 border border-white/5 group hover:border-white/10 transition-colors"
              >
                <div className="min-w-0 pr-2">
                  <div className="text-[11px] text-[var(--rg-muted,#8a8f98)]">{option.label}</div>
                  <code className="text-xs text-emerald-400 font-mono truncate block">{option.cmd}</code>
                </div>
                <button
                  type="button"
                  onClick={() => copyCommand(option.cmd, idx)}
                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white transition-colors shrink-0"
                  aria-label={`Copy ${option.label}`}
                >
                  {copiedIndex === idx ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={connect}
              disabled={retrying}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--rg-coral,#ff6b64)] text-black font-semibold text-xs hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} />
              <span>{retrying ? 'Retrying…' : 'Retry Connection'}</span>
            </button>
            <a
              href="https://github.com/elijahbutler/reglet#readme"
              target="_blank"
              rel="noreferrer"
              className="py-2 px-3 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-[var(--rg-muted,#8a8f98)] hover:text-white flex items-center gap-1.5 transition-colors no-underline"
            >
              <ExternalLink size={13} />
              <span>Docs</span>
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="rg-desktop-bootstrap">
      <span className="rg-desktop-bootstrap__mark" aria-hidden="true">R</span>
      <h1>Starting Reglet</h1>
      <p>Preparing the encrypted local workbench.</p>
    </main>
  );
}
