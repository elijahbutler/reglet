import { useEffect, useState } from 'react';
import { ManagerApp, type TauriManagerClient } from '@reglet/manager-ui';
import { tauriConnectLinks } from './deepLinks.js';
import { bootstrapTauriManagerClient } from './runtimeBootstrap.js';
import { desktopHostActions } from './updater.js';

export function DesktopManager() {
  const [client, setClient] = useState<TauriManagerClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void bootstrapTauriManagerClient().then((next) => {
      if (!disposed) setClient(next);
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'The local Manager runtime could not start.');
    });
    return () => { disposed = true; };
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

  if (client !== null) return <ManagerApp client={client} hostActions={desktopHostActions} />;
  return (
    <main className="rg-desktop-bootstrap">
      <span className="rg-desktop-bootstrap__mark" aria-hidden="true">R</span>
      <h1>{error === null ? 'Starting Reglet' : 'Manager runtime unavailable'}</h1>
      <p role={error === null ? undefined : 'alert'}>{error ?? 'Preparing the encrypted local workbench.'}</p>
    </main>
  );
}
