import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  createSyncV2PairApproval,
  generateSyncV2DeviceKeys,
  generateSyncV2VaultKeys,
  issueSyncV2DeviceCertificate,
  type SyncV2PairRequest,
} from '@reglet/core';
import { closeApp, createApp } from '../src/app.js';

const apps: Array<ReturnType<typeof createApp>> = [];
const directories: string[] = [];

afterEach(async () => {
  for (const app of apps) closeApp(app);
  apps.length = 0;
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe('owner dashboard and connection grants', () => {
  test('claims once, enforces origin and CSRF, and renews a secure session', async () => {
    const links: string[] = [];
    const app = useApp(createApp({
      publicUrl: 'https://reglet.test',
      onOwnerClaimLink: (link) => links.push(link),
      rateLimit: false,
    }));
    expect(links).toHaveLength(1);
    const token = new URL(links[0]!).hash.slice('#claim='.length);

    const missingOrigin = await app.request('/api/admin/v1/claim', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ token, email: 'owner@example.com', password: 'correct horse battery staple' }),
    });
    expect(missingOrigin.status).toBe(403);

    const claimed = await claim(app, token);
    expect(claimed.response.status).toBe(200);
    expect(claimed.cookie).toContain('HttpOnly');
    expect(claimed.cookie).toContain('Secure');
    expect(claimed.cookie).toContain('SameSite=Strict');

    const replay = await claim(app, token);
    expect(replay.response.status).toBe(404);
    expect((await app.request('/api/admin/v1/overview', { headers: { cookie: claimed.cookie } })).status).toBe(200);
    expect((await app.request('/api/admin/v1/connections', {
      method: 'POST',
      headers: { ...originHeaders(), cookie: claimed.cookie },
    })).status).toBe(401);

    const renewed = await app.request('/api/admin/v1/session', { headers: { cookie: claimed.cookie } });
    expect(renewed.status).toBe(200);
    const renewedBody = await renewed.json() as { csrfToken: string };
    expect(renewedBody.csrfToken).not.toBe(claimed.csrfToken);
    expect((await app.request('/api/admin/v1/connections', {
      method: 'POST',
      headers: { ...originHeaders(), cookie: claimed.cookie, 'x-reglet-csrf': claimed.csrfToken },
    })).status).toBe(401);
    expect((await app.request('/api/admin/v1/connections', {
      method: 'POST',
      headers: { ...originHeaders(), cookie: claimed.cookie, 'x-reglet-csrf': renewedBody.csrfToken },
    })).status).toBe(201);
  });

  test('initializes the first encrypted device atomically without exposing its token or vault keys', async () => {
    const { app, cookie, csrfToken } = await claimedServer();
    const grantResponse = await adminRequest(app, cookie, csrfToken, '/api/admin/v1/connections', { method: 'POST' });
    expect(grantResponse.status).toBe(201);
    const grant = await grantResponse.json() as { id: string; kind: string; connectUrl: string };
    expect(grant.kind).toBe('bootstrap');
    expect(new URLSearchParams(new URL(grant.connectUrl).hash.slice(1)).get('kind')).toBe('bootstrap');
    expect(JSON.stringify(grant)).not.toContain('token');
    expect(new URL(grant.connectUrl).search).toBe('');
    const grantToken = new URLSearchParams(new URL(grant.connectUrl).hash.slice(1)).get('grant')!;

    const device = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const deviceToken = randomBytes(24).toString('base64url');
    const certificate = issueSyncV2DeviceCertificate({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      deviceName: 'Owner Mac',
      agreementPublicKey: device.agreementPublicKey,
      signingPublicKey: device.signingPublicKey,
      issuedAt: '2026-07-16T12:00:00.000Z',
    }, vault.authoritySecretKey);
    const connection = await app.request('/v2/bootstrap/requests', {
      method: 'POST',
      headers: { ...jsonHeaders(), authorization: `Connection ${grantToken}` },
      body: JSON.stringify({
        vaultId: vault.vaultId,
        deviceId: device.deviceId,
        deviceName: 'Owner Mac',
        deviceTokenHash: sha256(deviceToken),
        agreementPublicKey: device.agreementPublicKey,
        signingPublicKey: device.signingPublicKey,
        authorityPublicKey: vault.authorityPublicKey,
        certificate,
      }),
    });
    expect(connection.status).toBe(201);
    const pending = await connection.json() as { fingerprint: string };
    expect(pending.fingerprint.split(' ')).toHaveLength(16);

    const dashboardPending = await app.request('/api/admin/v1/connections', { headers: { cookie } });
    const pendingBody = await dashboardPending.json() as { connections: Array<{ fingerprint: string }> };
    expect(pendingBody.connections[0]?.fingerprint).toBe(pending.fingerprint);
    expect(JSON.stringify(pendingBody)).not.toContain(deviceToken);
    expect(JSON.stringify(pendingBody)).not.toContain(vault.rootSecret);
    expect(JSON.stringify(pendingBody)).not.toContain(vault.authoritySecretKey);

    const approved = await adminRequest(app, cookie, csrfToken, `/api/admin/v1/connections/${grant.id}/approve`, { method: 'POST' });
    expect(approved.status).toBe(200);
    const status = await app.request(`/v2/bootstrap/requests/${grant.id}`, {
      headers: { authorization: `Connection ${grantToken}` },
    });
    expect(await status.json()).toMatchObject({ status: 'approved', fingerprint: pending.fingerprint });
    expect((await app.request('/v2/devices', { headers: auth(deviceToken) })).status).toBe(200);
    expect((await app.request(`/v2/bootstrap/requests/${grant.id}/claim`, {
      method: 'POST',
      headers: { authorization: `Connection ${grantToken}` },
    })).status).toBe(200);
  });

  test('requires device approval for later invitations and supports cancellation', async () => {
    const setup = await bootstrappedDashboard();
    const invitationResponse = await adminRequest(
      setup.app,
      setup.cookie,
      setup.csrfToken,
      '/api/admin/v1/connections',
      { method: 'POST' },
    );
    const invitation = await invitationResponse.json() as { id: string; kind: string; connectUrl: string };
    expect(invitation.kind).toBe('pair');
    expect(new URLSearchParams(new URL(invitation.connectUrl).hash.slice(1)).get('kind')).toBe('pair');
    const invitationToken = new URLSearchParams(new URL(invitation.connectUrl).hash.slice(1)).get('grant')!;
    const joining = generateSyncV2DeviceKeys();
    const joiningToken = randomBytes(24).toString('base64url');
    const requestId = 'invited-windows-request';
    const pairResponse = await setup.app.request('/v2/invitations/requests', {
      method: 'POST',
      headers: { ...jsonHeaders(), authorization: `Connection ${invitationToken}` },
      body: JSON.stringify({
        requestId,
        deviceTokenHash: sha256(joiningToken),
        deviceId: joining.deviceId,
        deviceName: 'Windows PC',
        agreementPublicKey: joining.agreementPublicKey,
        signingPublicKey: joining.signingPublicKey,
      }),
    });
    expect(pairResponse.status).toBe(201);
    const pair = await pairResponse.json() as SyncV2PairRequest & { requestToken: string };

    const dashboardApproval = await adminRequest(
      setup.app,
      setup.cookie,
      setup.csrfToken,
      `/api/admin/v1/connections/${invitation.id}/approve`,
      { method: 'POST' },
    );
    expect(dashboardApproval.status).toBe(403);
    expect(await dashboardApproval.json()).toMatchObject({ error: { code: 'device_approval_required' } });

    const inspectedResponse = await setup.app.request('/v2/pair/inspect', {
      method: 'POST',
      headers: auth(setup.deviceToken),
      body: JSON.stringify({ code: pair.code }),
    });
    const inspected = await inspectedResponse.json() as SyncV2PairRequest;
    const approval = createSyncV2PairApproval(
      inspected,
      {
        deviceId: setup.device.deviceId,
        signingSecretKey: setup.device.signingSecretKey,
        signingPublicKey: setup.device.signingPublicKey,
      },
      {
        version: 1,
        vaultId: setup.vault.vaultId,
        rootSecret: setup.vault.rootSecret,
        authoritySecretKey: setup.vault.authoritySecretKey,
        keyEpoch: 1,
      },
      setup.vault.authoritySecretKey,
    );
    expect((await setup.app.request('/v2/pair/approve', {
      method: 'POST',
      headers: auth(setup.deviceToken),
      body: JSON.stringify({ code: pair.code, approval }),
    })).status).toBe(200);
    expect((await setup.app.request('/v2/pair/requests/' + requestId, {
      method: 'DELETE',
      headers: { authorization: `Pairing ${pair.requestToken}` },
    })).status).toBe(200);
    expect((await setup.app.request(`/v2/pair/status?requestId=${requestId}`, {
      headers: { authorization: `Pairing ${pair.requestToken}` },
    })).status).toBe(404);
    expect((await setup.app.request('/v2/pair/claim', {
      method: 'POST',
      headers: { ...jsonHeaders(), authorization: `Pairing ${pair.requestToken}` },
      body: JSON.stringify({ requestId }),
    })).status).toBe(409);
  });

  test('serializes verified backups, reports corrupt entries, and checks live integrity', async () => {
    const backupDirectory = await mkdtemp(path.join(tmpdir(), 'reglet-backups-'));
    directories.push(backupDirectory);
    const setup = await claimedServer(backupDirectory);
    const overview = await setup.app.request('/api/admin/v1/overview', { headers: { cookie: setup.cookie } });
    expect(await overview.json()).toMatchObject({ capabilities: { serverBackups: true, liveIntegrityCheck: true, liveRestore: false } });

    const [first, second] = await Promise.all([
      adminRequest(setup.app, setup.cookie, setup.csrfToken, '/api/admin/v1/backups', { method: 'POST' }),
      adminRequest(setup.app, setup.cookie, setup.csrfToken, '/api/admin/v1/backups', { method: 'POST' }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const created = await Promise.all([first.json(), second.json()]) as Array<{ name: string; verification: string }>;
    expect(new Set(created.map((backup) => backup.name)).size).toBe(2);
    expect(created.every((backup) => backup.verification === 'verified')).toBe(true);

    const corruptName = 'reglet-20260716T120000-000-deadbeefdeadbeef.sqlite';
    await writeFile(path.join(backupDirectory, corruptName), 'not sqlite');
    const linkedName = 'reglet-20260716T120001-000-deadbeefdeadbeef.sqlite';
    await symlink(path.join(backupDirectory, corruptName), path.join(backupDirectory, linkedName));
    const listed = await setup.app.request('/api/admin/v1/backups', { headers: { cookie: setup.cookie } });
    const list = await listed.json() as { backups: Array<{ name: string; verification: string }> };
    expect(list.backups.find((backup) => backup.name === corruptName)?.verification).toBe('failed');
    expect(list.backups.find((backup) => backup.name === linkedName)?.verification).toBe('failed');

    const integrity = await adminRequest(setup.app, setup.cookie, setup.csrfToken, '/api/admin/v1/integrity-check', { method: 'POST' });
    expect(integrity.status).toBe(200);
    expect(await integrity.json()).toMatchObject({ ok: true });
  });
});

async function claimedServer(backupDirectory?: string): Promise<{ app: ReturnType<typeof createApp>; cookie: string; csrfToken: string }> {
  const links: string[] = [];
  const app = useApp(createApp({
    publicUrl: 'https://reglet.test',
    onOwnerClaimLink: (link) => links.push(link),
    rateLimit: false,
    enableLegacyV1: false,
    backupDirectory,
  }));
  const claimed = await claim(app, new URL(links[0]!).hash.slice('#claim='.length));
  return { app, cookie: claimed.cookie, csrfToken: claimed.csrfToken };
}

async function bootstrappedDashboard(): Promise<{
  app: ReturnType<typeof createApp>;
  cookie: string;
  csrfToken: string;
  deviceToken: string;
  device: ReturnType<typeof generateSyncV2DeviceKeys>;
  vault: ReturnType<typeof generateSyncV2VaultKeys>;
}> {
  const setup = await claimedServer();
  const grant = await (await adminRequest(setup.app, setup.cookie, setup.csrfToken, '/api/admin/v1/connections', { method: 'POST' })).json() as { id: string; connectUrl: string };
  const grantToken = new URLSearchParams(new URL(grant.connectUrl).hash.slice(1)).get('grant')!;
  const device = generateSyncV2DeviceKeys();
  const vault = generateSyncV2VaultKeys();
  const deviceToken = randomBytes(24).toString('base64url');
  const certificate = issueSyncV2DeviceCertificate({
    vaultId: vault.vaultId,
    deviceId: device.deviceId,
    deviceName: 'Mac',
    agreementPublicKey: device.agreementPublicKey,
    signingPublicKey: device.signingPublicKey,
    issuedAt: new Date().toISOString(),
  }, vault.authoritySecretKey);
  await setup.app.request('/v2/bootstrap/requests', {
    method: 'POST',
    headers: { ...jsonHeaders(), authorization: `Connection ${grantToken}` },
    body: JSON.stringify({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      deviceName: 'Mac',
      deviceTokenHash: sha256(deviceToken),
      agreementPublicKey: device.agreementPublicKey,
      signingPublicKey: device.signingPublicKey,
      authorityPublicKey: vault.authorityPublicKey,
      certificate,
    }),
  });
  const approved = await adminRequest(setup.app, setup.cookie, setup.csrfToken, `/api/admin/v1/connections/${grant.id}/approve`, { method: 'POST' });
  expect(approved.status).toBe(200);
  return { ...setup, deviceToken, device, vault };
}

async function claim(app: ReturnType<typeof createApp>, token: string): Promise<{ response: Response; cookie: string; csrfToken: string }> {
  const response = await app.request('/api/admin/v1/claim', {
    method: 'POST',
    headers: originHeaders(),
    body: JSON.stringify({ token, email: 'owner@example.com', password: 'correct horse battery staple' }),
  });
  const body = await response.clone().json().catch(() => ({})) as { csrfToken?: string };
  return { response, cookie: response.headers.get('set-cookie') ?? '', csrfToken: body.csrfToken ?? '' };
}

function adminRequest(
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrfToken: string,
  route: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(route, {
    ...init,
    headers: { ...originHeaders(), cookie, 'x-reglet-csrf': csrfToken, ...init.headers },
  });
}

function auth(token: string): Record<string, string> { return { ...jsonHeaders(), authorization: `Bearer ${token}` }; }
function jsonHeaders(): Record<string, string> { return { 'content-type': 'application/json' }; }
function originHeaders(): Record<string, string> { return { ...jsonHeaders(), origin: 'https://reglet.test' }; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function useApp(app: ReturnType<typeof createApp>): ReturnType<typeof createApp> { apps.push(app); return app; }
