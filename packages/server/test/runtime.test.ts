import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { LocalState, RegletApplication } from '@reglet/core';
import {
  createRuntimeApp,
  isRelevantProjectPath,
  ProjectRootWatcher,
  serveRuntime,
} from '../src/index.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  delete process.env.REGLET_PROVIDER_HOME;
});

async function fixtureHome(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-runtime-'));
  await new RegletApplication(currentHome).execute({ type: 'initialize' });
  return currentHome;
}

describe('local runtime', () => {
  test('classifies only provider discovery paths as watcher inputs', () => {
    expect(isRelevantProjectPath('AGENTS.md')).toBe(true);
    expect(isRelevantProjectPath('packages/api/.agents/skills/release/SKILL.md')).toBe(
      true,
    );
    expect(isRelevantProjectPath('.cursor/rules/typescript.mdc')).toBe(true);
    expect(
      isRelevantProjectPath(
        'packages/api/TEAM_GUIDE.md',
        new Set(['TEAM_GUIDE.md']),
      ),
    ).toBe(true);
    expect(isRelevantProjectPath('src/index.ts')).toBe(false);
    expect(isRelevantProjectPath('node_modules/tool/AGENTS.md')).toBe(false);
  });

  test('coalesces relevant filesystem events into a project rescan', async () => {
    const home = await fixtureHome();
    const root = path.join(home, 'project');
    await mkdir(root, { recursive: true });
    const application = new RegletApplication(home);
    await application.execute({ type: 'project.root.add', path: root });
    const watcher = new ProjectRootWatcher({
      home,
      application,
      debounceMs: 20,
    });
    await watcher.start();
    try {
      await writeFile(path.join(root, 'AGENTS.md'), '# Project guidance\n');
      const found = await waitUntil(async () => {
        const state = await LocalState.open(home);
        try {
          return state.listDiscoveries().some(
            (discovery) => discovery.relativePath === 'AGENTS.md',
          );
        } finally {
          state.close();
        }
      });
      expect(found).toBe(true);
      expect(watcher.isReady()).toBe(true);
    } finally {
      await watcher.dispose();
    }
  });

  test('serves the reviewed manager with restrictive browser headers', async () => {
    currentHome = await mkdtemp(
      path.join(tmpdir(), 'reglet-runtime-manager-'),
    );
    const runtime = createRuntimeApp({
      home: currentHome,
    });

    const response = await runtime.app.request('/manager/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(html).toContain('Reglet Manager');
    expect(html).toContain('Preview data');
    expect(
      (
        await runtime.app.request('/manager/src/runtime.js')
      ).headers.get('content-type'),
    ).toContain('text/javascript');
  });

  test('keeps liveness separate from readiness', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-runtime-'));
    const runtime = createRuntimeApp({
      home: path.join(currentHome, 'missing'),
      watcherReady: () => false,
    });

    expect((await runtime.app.request('/healthz')).status).toBe(200);
    const readiness = await runtime.app.request('/readyz');
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toMatchObject({
      ready: false,
      watcher: false,
      canonicalDirectory: false,
    });
  });

  test('uses one-use pairing credentials and hashed session authorization', async () => {
    const home = await fixtureHome();
    const state = await LocalState.open(home);
    const pairing = state.createPairingCredential('read');
    state.close();
    const runtime = createRuntimeApp({ home });

    const claim = await runtime.app.request('/v1/pair/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(claim.status).toBe(201);
    const claimed = (await claim.json()) as {
      token: string;
      session: { scope: string };
    };
    expect(claimed.session.scope).toBe('read');
    const sessionCookie = claim.headers.get('set-cookie');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Strict');

    const browserSession = await runtime.app.request('/v1/session', {
      headers: { Cookie: sessionCookie ?? '' },
    });
    expect(browserSession.status).toBe(200);

    const library = await runtime.app.request('/v1/library', {
      headers: { Authorization: `Bearer ${claimed.token}` },
    });
    expect(library.status).toBe(200);

    const reused = await runtime.app.request('/v1/pair/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(reused.status).toBe(401);
  });

  test('read and write sessions cannot perform admin operations', async () => {
    const home = await fixtureHome();
    await mkdir(path.join(home, 'project'), { recursive: true });
    const state = await LocalState.open(home);
    const readPairing = state.createPairingCredential('read');
    const writePairing = state.createPairingCredential('write');
    state.close();
    const runtime = createRuntimeApp({ home });
    const readToken = await claim(runtime, readPairing.code);
    const writeToken = await claim(runtime, writePairing.code);

    const readMutation = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'library.create',
        kind: 'instruction',
        slug: 'blocked',
        title: 'Blocked',
        content: '# Blocked',
      }),
    });
    expect(readMutation.status).toBe(403);

    const rootMutation = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'project.root.add',
        path: path.join(home, 'project'),
      }),
    });
    expect(rootMutation.status).toBe(403);

    const rootRead = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'project.root.list' }),
    });
    expect(rootRead.status).toBe(403);

    const writeSnapshot = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'manager.snapshot' }),
    });
    expect(writeSnapshot.status).toBe(200);
    expect(await writeSnapshot.json()).toMatchObject({
      data: {
        projectRoots: [],
        discoveries: [],
        sessions: [],
      },
    });
  });

  test('rejects malformed command payloads at the HTTP boundary', async () => {
    const home = await fixtureHome();
    const state = await LocalState.open(home);
    const pairing = state.createPairingCredential('admin');
    state.close();
    const runtime = createRuntimeApp({ home });
    const token = await claim(runtime, pairing.code);

    const malformed = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'external.open',
        target: {
          kind: 'provider',
          provider: 'unknown-provider',
          content: 'rules',
        },
      }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: 'command-invalid' },
    });

    const invalidJson = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
  });

  test('serves an admin manager snapshot and one-use websocket tickets', async () => {
    const home = await fixtureHome();
    process.env.REGLET_PROVIDER_HOME = path.join(home, 'providers');
    const state = await LocalState.open(home);
    const pairing = state.createPairingCredential('admin');
    state.close();
    const runtime = createRuntimeApp({ home });
    const token = await claim(runtime, pairing.code);

    const snapshot = await runtime.app.request('/v1/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'manager.snapshot' }),
    });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      data: {
        artifacts: expect.any(Array),
        providers: expect.any(Array),
        sessions: expect.any(Array),
      },
    });

    const ticket = await runtime.app.request('/v1/events/ticket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ticket.status).toBe(201);
    expect(await ticket.json()).toMatchObject({
      ticket: expect.any(String),
      expiresInMs: 30_000,
    });
  });

  test('refuses public wildcard binding without an explicit override', () => {
    expect(() =>
      serveRuntime({ hostname: '0.0.0.0', allowPublicWildcard: false }),
    ).toThrow('Public wildcard binding is refused');
  });
});

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function claim(
  runtime: ReturnType<typeof createRuntimeApp>,
  code: string,
): Promise<string> {
  const response = await runtime.app.request('/v1/pair/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = (await response.json()) as { token: string };
  return body.token;
}
