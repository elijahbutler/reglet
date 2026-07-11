import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { closeApp, createApp } from '../src/app.js';

let currentDbDir: string | undefined;
let currentApp: ReturnType<typeof createApp> | undefined;

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
    expect(conflict.body).toEqual({ headRevision: 1, contentBase64 });

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
    const app = useApp(createApp({ dbPath: await tempDbPath(), singleUserToken: 'dev-token' }));

    const put = await putJson(
      app,
      '/v1/files/reglet.toml',
      { baseRevision: 0, contentBase64: Buffer.from('[sync]\n').toString('base64') },
      'dev-token',
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

    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true });
    expect(await (await app.request('/')).text()).toContain('Reglet sync server');
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
