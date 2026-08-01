(function attachRegletRuntime(global) {
  'use strict';

  const readOnlyCommands = new Set([
    'manager.snapshot',
    'library.list',
    'library.show',
    'library.inspect-skill',
    'providers.status',
    'providers.preview',
    'project.root.list',
    'project.discoveries',
    'project.promotion-preview',
    'history.list',
    'activity.list',
    'search',
    'secret.status',
    'remote.status',
    'sync.status',
    'session.list',
    'external.open',
    'diagnostics',
  ]);

  class RuntimeError extends Error {
    constructor(status, code, message) {
      super(message);
      this.name = 'RuntimeError';
      this.status = status;
      this.code = code;
    }
  }

  class Client {
    constructor(baseUrl, session) {
      this.baseUrl = baseUrl.replace(/\/+$/, '');
      this.session = session;
      this.revision = undefined;
      this.socket = undefined;
      this.closed = false;
    }

    async execute(command, options = {}) {
      const optimistic =
        options.optimistic ??
        (!readOnlyCommands.has(command.type) &&
          !(command.type === 'providers.apply' && command.dryRun === true));
      const response = await fetch(`${this.baseUrl}/v1/commands`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...command,
          ...(optimistic && this.revision !== undefined
            ? { expectedRevision: this.revision }
            : {}),
        }),
      });
      const result = await parseResponse(response);
      if (
        typeof result !== 'object' ||
        result === null ||
        typeof result.revision !== 'number' ||
        typeof result.changed !== 'boolean' ||
        !('data' in result)
      ) {
        throw new RuntimeError(
          response.status,
          'invalid-response',
          'The local runtime returned an invalid command result.',
        );
      }
      this.revision = result.revision;
      return result;
    }

    async snapshot() {
      return (await this.execute(
        { type: 'manager.snapshot' },
        { optimistic: false },
      )).data;
    }

    async showArtifact(artifact) {
      return (await this.execute(
        { type: 'library.show', artifact },
        { optimistic: false },
      )).data;
    }

    async subscribe(onInvalidation, onConnectionChange) {
      this.closed = false;
      const response = await fetch(`${this.baseUrl}/v1/events/ticket`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const ticketResponse = await parseResponse(response);
      if (
        typeof ticketResponse !== 'object' ||
        ticketResponse === null ||
        typeof ticketResponse.ticket !== 'string'
      ) {
        throw new RuntimeError(
          response.status,
          'invalid-response',
          'The runtime returned an invalid event ticket.',
        );
      }
      if (this.closed) return;
      const url = new URL('/v1/events', this.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticketResponse.ticket);
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('open', () => onConnectionChange?.(true));
      socket.addEventListener('message', (event) => {
        let value;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        if (
          typeof value === 'object' &&
          value !== null &&
          (value.type === 'connected' || value.type === 'invalidated')
        ) {
          if (typeof value.revision === 'number') {
            this.revision = value.revision;
          }
          onInvalidation(value);
        }
      });
      socket.addEventListener('close', () => {
        onConnectionChange?.(false);
        if (!this.closed) {
          window.setTimeout(() => {
            void this.subscribe(onInvalidation, onConnectionChange).catch(() =>
              onConnectionChange?.(false),
            );
          }, 1500);
        }
      });
      socket.addEventListener('error', () => onConnectionChange?.(false));
    }

    close() {
      this.closed = true;
      this.socket?.close(1000, 'Manager closed');
    }
  }

  async function bootstrap() {
    const mock =
      location.protocol === 'file:' ||
      new URLSearchParams(location.search).get('mock') === '1';
    if (mock) {
      return { mode: 'mock' };
    }

    const baseUrl = location.origin;
    const pairingCode = pairingCodeFromFragment();
    if (pairingCode !== undefined) {
      await claimPairingCode(baseUrl, pairingCode);
      history.replaceState(
        null,
        '',
        `${location.pathname}${location.search}`,
      );
    }

    const sessionResponse = await fetch(`${baseUrl}/v1/session`, {
      credentials: 'same-origin',
    });
    if (sessionResponse.status === 401) {
      return { mode: 'pairing', baseUrl };
    }
    const sessionPayload = await parseResponse(sessionResponse);
    if (
      typeof sessionPayload !== 'object' ||
      sessionPayload === null ||
      typeof sessionPayload.session !== 'object' ||
      sessionPayload.session === null
    ) {
      throw new RuntimeError(
        sessionResponse.status,
        'invalid-response',
        'The runtime returned an invalid session.',
      );
    }
    return {
      mode: 'live',
      client: new Client(baseUrl, sessionPayload.session),
    };
  }

  async function pair(baseUrl, code) {
    await claimPairingCode(baseUrl, code);
    return bootstrap();
  }

  async function claimPairingCode(baseUrl, code) {
    const response = await fetch(`${baseUrl}/v1/pair/claim`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    await parseResponse(response);
  }

  function pairingCodeFromFragment() {
    if (location.hash.length <= 1) return undefined;
    const code = new URLSearchParams(location.hash.slice(1)).get('pair');
    return code === null || code.trim().length === 0 ? undefined : code;
  }

  async function parseResponse(response) {
    let value;
    try {
      value = await response.json();
    } catch {
      value = undefined;
    }
    if (!response.ok) {
      const error =
        typeof value === 'object' &&
        value !== null &&
        typeof value.error === 'object' &&
        value.error !== null
          ? value.error
          : {};
      throw new RuntimeError(
        response.status,
        typeof error.code === 'string' ? error.code : 'operation-error',
        typeof error.message === 'string'
          ? error.message
          : 'The local runtime request failed.',
      );
    }
    return value;
  }

  global.RegletRuntime = Object.freeze({
    RuntimeError,
    bootstrap,
    pair,
  });
})(window);
