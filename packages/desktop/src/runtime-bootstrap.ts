export interface RuntimeStartup {
  listening: true;
  url: string;
  managerUrl: string;
  pairingExpiresAt?: string;
  remote: boolean;
}

export function parseRuntimeStartup(value: string): RuntimeStartup | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'listening' in parsed &&
      parsed.listening === true &&
      'url' in parsed &&
      typeof parsed.url === 'string' &&
      'managerUrl' in parsed &&
      typeof parsed.managerUrl === 'string' &&
      'remote' in parsed &&
      typeof parsed.remote === 'boolean'
    ) {
      return {
        listening: true,
        url: parsed.url,
        managerUrl: parsed.managerUrl,
        pairingExpiresAt:
          'pairingExpiresAt' in parsed &&
          typeof parsed.pairingExpiresAt === 'string'
            ? parsed.pairingExpiresAt
            : undefined,
        remote: parsed.remote,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function validateRuntimeStartup(startup: RuntimeStartup): void {
  const runtimeUrl = new URL(startup.url);
  const managerUrl = new URL(startup.managerUrl);
  if (
    runtimeUrl.protocol !== 'http:' ||
    runtimeUrl.hostname !== '127.0.0.1' ||
    managerUrl.origin !== runtimeUrl.origin ||
    managerUrl.pathname !== '/manager/' ||
    managerUrl.hash.length === 0 ||
    startup.remote
  ) {
    throw new Error('The desktop runtime returned an unsafe bootstrap URL.');
  }
}

export function redactRuntimeError(value: string): string {
  return value
    .replace(
      /(?:secret|token|password|credential|authorization|api[-_]?key)\s*[=:]\s*[^\s,;]+/gi,
      '[REDACTED]',
    )
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s,;]+/g, '[PATH]');
}
