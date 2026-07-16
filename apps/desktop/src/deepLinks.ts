import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

export interface ConnectLinkSource {
  current(): Promise<string | null>;
  listen(handler: (url: string) => void): Promise<() => void>;
}

export const noConnectLinks: ConnectLinkSource = {
  async current() { return null; },
  async listen() { return () => undefined; },
};

export const tauriConnectLinks: ConnectLinkSource = {
  async current() {
    const urls = await getCurrent();
    if (urls === null) return null;
    return urls.map(validRegletConnectLink).find((url) => url !== null) ?? null;
  },
  async listen(handler) {
    return onOpenUrl((urls) => {
      const url = urls.map(validRegletConnectLink).find((candidate) => candidate !== null);
      if (url !== undefined && url !== null) handler(url);
    });
  },
};

export function validRegletConnectLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'reglet:' || url.hostname !== 'connect' || (url.pathname !== '' && url.pathname !== '/')) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(fragment.get('grant') ?? '')) return null;
  const server = fragment.get('server');
  if (server === null || !safeServerOrigin(server)) return null;
  const kind = fragment.get('kind');
  if (kind !== null && kind !== 'bootstrap' && kind !== 'pair') return null;
  const keys = [...fragment.keys()];
  if (keys.some((key) => key !== 'grant' && key !== 'server' && key !== 'kind')) return null;
  if (keys.filter((key) => key === 'grant').length !== 1 || keys.filter((key) => key === 'server').length !== 1) return null;
  return value;
}

function safeServerOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value.replace(/\/$/, '') && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
