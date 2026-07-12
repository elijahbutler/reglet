import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { closeApp, createApp } from '../src/app.js';

let currentDbDir: string | undefined;
let currentApp: ReturnType<typeof createApp> | undefined;
const strongSingleUserToken = 'reglet-test-token-1234567890';

afterEach(async () => {
  if (currentApp !== undefined) {
    closeApp(currentApp);
    currentApp = undefined;
  }
  if (currentDbDir !== undefined) {
    await rm(currentDbDir, { recursive: true, force: true });
    currentDbDir = undefined;
  }
});

async function tempDbPath(): Promise<string> {
  currentDbDir = await mkdtemp(path.join(tmpdir(), 'reglet-server-'));
  return path.join(currentDbDir, 'reglet.sqlite');
}

describe('sync server API', () => {
  test('registers, logs in, pairs, stores files, reports conflicts, changes, and deletes', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath() }));

    const register = await postJson(app, '/v1/auth/register', {
      email: 'user@example.test',
      password: 'secret',
    });
    expect(register.status).toBe(200);
    expect(typeof register.body.sessionToken).toBe('string');

    const login = await postJson(app, '/v1/auth/login', {
      email: 'user@example.test',
      password: 'secret',
    });
    expect(login.status).toBe(200);
    const sessionToken = String(login.body.sessionToken);

    const pair = await app.request('/v1/pair/start', {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(pair.status).toBe(200);
    const pairBody = (await pair.json()) as { code: string };
    expect(pairBody.code).toHaveLength(6);

    const claim = await postJson(app, '/v1/pair/claim', {
      code: pairBody.code,
      deviceName: 'laptop',
    });
    expect(claim.status).toBe(200);
    const deviceToken = String(claim.body.deviceToken);

    const contentBase64 = Buffer.from('hello').toString('base64');
    const put = await putJson(app, '/v1/files/rules/00-general.md', { baseRevision: 0, contentBase64 }, deviceToken);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ revision: 1 });

    const conflict = await putJson(
      app,
      '/v1/files/rules/00-general.md',
      { baseRevision: 0, contentBase64: Buffer.from('stale').toString('base64') },
      deviceToken,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      error: { code: 'conflict', message: 'file revision conflict' },
      headRevision: 1,
      contentBase64,
    });

    const changes = await app.request('/v1/changes?since=0', {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(changes.status).toBe(200);
    const changesBody = (await changes.json()) as {
      changes: Array<{ path: string; revision: number; deleted: boolean; seq: number }>;
      cursor: number;
    };
    expect(changesBody.changes).toEqual([
      {
        path: 'rules/00-general.md',
        revision: 1,
        hash: expect.any(String),
        deleted: false,
        seq: 1,
      },
    ]);
    expect(changesBody.cursor).toBe(1);

    const file = await app.request('/v1/files/rules/00-general.md', {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(file.status).toBe(200);
    expect(await file.json()).toEqual({
      revision: 1,
      hash: expect.any(String),
      contentBase64,
    });

    const deleted = await deleteJson(app, '/v1/files/rules/00-general.md', { baseRevision: 1 }, deviceToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ revision: 2 });

    const deleteChanges = await app.request('/v1/changes?since=1', {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(deleteChanges.status).toBe(200);
    expect(await deleteChanges.json()).toEqual({
      changes: [
        {
          path: 'rules/00-general.md',
          revision: 2,
          hash: '',
          deleted: true,
          seq: 2,
        },
      ],
      cursor: 2,
    });
  });

  test('accepts single-user token mode without registration', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath(), singleUserToken: strongSingleUserToken }));

    const put = await putJson(
      app,
      '/v1/files/reglet.toml',
      { baseRevision: 0, contentBase64: Buffer.from('[sync]\n').toString('base64') },
      strongSingleUserToken,
    );
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ revision: 1 });

    const unauthorized = await app.request('/v1/changes?since=0', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(unauthorized.status).toBe(401);
  });

  test('serves health and root endpoints', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath() }));

    expect(await (await app.request('/healthz')).json()).toEqual({
      ok: true,
      service: { name: 'reglet-sync-server', version: '0.1.0' },
      protocol: { current: 1, supported: [1] },
    });
    expect(await (await app.request('/')).text()).toContain('Reglet sync server');
  });

  test('serves unauthenticated protocol compatibility metadata', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath(), rateLimit: { max: 1, windowMs: 60_000 } }));

    const first = await app.request('/v1/compatibility');
    const second = await app.request('/v1/compatibility');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({
      service: { name: 'reglet-sync-server', version: '0.1.0' },
      protocol: { current: 1, supported: [1] },
    });
  });

  test('returns structured API errors', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath() }));

    const response = await postJson(app, '/v1/auth/login', { email: 'missing@example.test', password: 'bad' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: 'invalid_credentials', message: 'invalid credentials' } });
  });

  test('rejects unsupported and unsafe sync paths', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath(), singleUserToken: strongSingleUserToken }));
    const body = { baseRevision: 0, contentBase64: Buffer.from('x').toString('base64') };
    const paths = [
      '/v1/files/rules/%2e%2e/secrets.txt',
      '/v1/files/rules/%252e%252e/secrets.txt',
      '/v1/files//tmp/secrets.txt',
      '/v1/files/.state/sync.json',
      '/v1/files/.state/backups/codex/file',
      '/v1/files/rules/00-general.md.bak',
      '/v1/files/rules/00-general.conflict-laptop.md',
      '/v1/files/provider-output/AGENTS.md',
    ];

    for (const unsafePath of paths) {
      const response = await putJson(app, unsafePath, body, strongSingleUserToken);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: { code: 'invalid_path', message: 'path is not in the supported sync scope' },
      });
    }
  });

  test('enforces configurable request body limits with structured 413 errors', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath(), singleUserToken: strongSingleUserToken, bodyLimitBytes: 32 }));

    const response = await putJson(
      app,
      '/v1/files/rules/00-general.md',
      { baseRevision: 0, contentBase64: Buffer.from('too large').toString('base64') },
      strongSingleUserToken,
    );

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { code: 'body_too_large', message: 'request body is too large' } });
  });

  test('validates baseRevision and contentBase64', async () => {
    const app = useApp(createApp({ dbPath: await tempDbPath(), singleUserToken: strongSingleUserToken }));

    const badRevision = await putJson(
      app,
      '/v1/files/rules/00-general.md',
      { baseRevision: -1, contentBase64: Buffer.from('x').toString('base64') },
      strongSingleUserToken,
    );
    expect(badRevision.status).toBe(400);
    expect(badRevision.body).toEqual({
      error: { code: 'invalid_request', message: 'baseRevision and contentBase64 are required' },
    });

    const badBase64 = await putJson(
      app,
      '/v1/files/rules/00-general.md',
      { baseRevision: 0, contentBase64: 'not base64' },
      strongSingleUserToken,
    );
    expect(badBase64.status).toBe(400);
    expect(badBase64.body).toEqual({
      error: { code: 'invalid_base64', message: 'contentBase64 must be strict valid base64' },
    });

    const badDeleteRevision = await deleteJson(
      app,
      '/v1/files/rules/00-general.md',
      { baseRevision: 1.5 },
      strongSingleUserToken,
    );
    expect(badDeleteRevision.status).toBe(400);
    expect(badDeleteRevision.body).toEqual({
      error: { code: 'invalid_request', message: 'baseRevision is required' },
    });
  });

  test('rejects weak single-user tokens during app creation', async () => {
    const dbPath = await tempDbPath();

    expect(() => createApp({ dbPath, singleUserToken: 'dev-token' })).toThrow(
      'REGLET_TOKEN must be at least 20 non-whitespace characters',
    );
  });

  test('rate limits auth and pairing endpoints but not health or compatibility', async () => {
    let timestamp = 1_000;
    const app = useApp(
      createApp({
        dbPath: await tempDbPath(),
        now: () => new Date(timestamp),
        rateLimit: { max: 1, windowMs: 1_000, key: () => 'test-client' },
      }),
    );

    const firstAuth = await postJson(app, '/v1/auth/login', { email: 'missing@example.test', password: 'bad' });
    const limitedAuth = await postJson(app, '/v1/auth/login', { email: 'missing@example.test', password: 'bad' });
    expect(firstAuth.status).toBe(401);
    expect(limitedAuth.status).toBe(429);
    expect(limitedAuth.body).toEqual({ error: { code: 'rate_limited', message: 'Too many requests' } });

    const firstPair = await postJson(app, '/v1/pair/claim', { code: 'bad', deviceName: 'laptop' });
    const limitedPair = await postJson(app, '/v1/pair/claim', { code: 'bad', deviceName: 'laptop' });
    expect(firstPair.status).toBe(404);
    expect(limitedPair.status).toBe(429);

    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/v1/compatibility')).status).toBe(200);

    timestamp += 1_000;
    const resetAuth = await postJson(app, '/v1/auth/login', { email: 'missing@example.test', password: 'bad' });
    expect(resetAuth.status).toBe(401);
  });
});

function useApp(app: ReturnType<typeof createApp>): ReturnType<typeof createApp> {
  currentApp = app;
  return app;
}

async function postJson(app: ReturnType<typeof createApp>, url: string, body: unknown): Promise<JsonResult> {
  return requestJson(app, url, 'POST', body);
}

async function putJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
  token: string,
): Promise<JsonResult> {
  return requestJson(app, url, 'PUT', body, token);
}

async function deleteJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
  token: string,
): Promise<JsonResult> {
  return requestJson(app, url, 'DELETE', body, token);
}

interface JsonResult {
  status: number;
  body: Record<string, unknown>;
}

async function requestJson(
  app: ReturnType<typeof createApp>,
  url: string,
  method: string,
  body: unknown,
  token?: string,
): Promise<JsonResult> {
  const response = await app.request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
