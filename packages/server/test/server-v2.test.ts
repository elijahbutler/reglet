import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalBytes,
  createSyncV2Envelope,
  createSyncV2PairApproval,
  decryptSyncV2Envelope,
  encodeBase64Url,
  generateSyncV2DeviceKeys,
  generateSyncV2VaultKeys,
  initialCheckpoint,
  issueSyncV2DeviceCertificate,
  openSyncV2PairApproval,
  syncV2PairingSas,
  verifyStoredSyncV2Envelope,
  type StoredSyncV2Envelope,
  type SyncV2Envelope,
  type SyncV2PairApproval,
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

describe('encrypted sync protocol v2 server', () => {
  test('bootstraps, pairs, syncs authenticated ciphertext, and keeps legacy plaintext routes closed', async () => {
    const databasePath = path.join(await tempDirectory(), 'reglet.sqlite');
    const bootstrapToken = 'homeserver-bootstrap-token-with-entropy-123';
    const app = useApp(createApp({
      dbPath: databasePath,
      singleUserToken: bootstrapToken,
      enableLegacyV1: false,
      rateLimit: false,
    }));
    const request = appRequest(app);
    const first = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const firstCertificate = issueSyncV2DeviceCertificate(
      {
        vaultId: vault.vaultId,
        deviceId: first.deviceId,
        deviceName: 'MacBook',
        agreementPublicKey: first.agreementPublicKey,
        signingPublicKey: first.signingPublicKey,
        issuedAt: '2026-07-15T12:00:00.000Z',
      },
      vault.authoritySecretKey,
    );

    const compatibility = await request('/v2/compatibility');
    expect(compatibility.status).toBe(200);
    expect((await compatibility.json() as { protocol: { supported: number[] } }).protocol.supported).toEqual([2]);
    expect((await request('/readyz')).status).toBe(200);
    expect((await request('/v1/compatibility')).status).toBe(404);

    const bootstrap = await request('/v2/bootstrap', {
      method: 'POST',
      headers: auth(bootstrapToken),
      body: JSON.stringify({
        vaultId: vault.vaultId,
        deviceId: first.deviceId,
        deviceName: 'MacBook',
        agreementPublicKey: first.agreementPublicKey,
        signingPublicKey: first.signingPublicKey,
        authorityPublicKey: vault.authorityPublicKey,
        certificate: firstCertificate,
      }),
    });
    expect(bootstrap.status).toBe(200);

    const joining = generateSyncV2DeviceKeys();
    const joiningToken = randomBytes(24).toString('base64url');
    const pairResponse = await request('/v2/pair/requests', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        requestId: 'pair-request-windows-01',
        deviceTokenHash: sha256Hex(joiningToken),
        deviceId: joining.deviceId,
        deviceName: 'Windows PC',
        agreementPublicKey: joining.agreementPublicKey,
        signingPublicKey: joining.signingPublicKey,
      }),
    });
    expect(pairResponse.status).toBe(201);
    const pair = await pairResponse.json() as SyncV2PairRequest & { requestToken: string };

    const inspectResponse = await request('/v2/pair/inspect', {
      method: 'POST',
      headers: auth(bootstrapToken),
      body: JSON.stringify({ code: pair.code }),
    });
    expect(inspectResponse.status).toBe(200);
    const inspected = await inspectResponse.json() as SyncV2PairRequest;
    const approval = createSyncV2PairApproval(
      inspected,
      {
        deviceId: first.deviceId,
        signingSecretKey: first.signingSecretKey,
        signingPublicKey: first.signingPublicKey,
      },
      {
        version: 1,
        vaultId: vault.vaultId,
        rootSecret: vault.rootSecret,
        authoritySecretKey: vault.authoritySecretKey,
        keyEpoch: 1,
      },
      vault.authoritySecretKey,
      '2026-07-15T12:01:00.000Z',
    );
    const approve = await request('/v2/pair/approve', {
      method: 'POST',
      headers: auth(bootstrapToken),
      body: JSON.stringify({ code: pair.code, approval }),
    });
    expect(approve.status).toBe(200);

    const statusResponse = await request(`/v2/pair/status?requestId=${encodeURIComponent(pair.requestId)}`, {
      headers: { authorization: `Pairing ${pair.requestToken}` },
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json() as { status: string; approval: SyncV2PairApproval };
    expect(status.status).toBe('approved');
    expect(syncV2PairingSas(status.approval)).toBe(syncV2PairingSas(approval));
    expect(openSyncV2PairApproval(status.approval, pair, joining.agreementSecretKey).rootSecret).toBe(vault.rootSecret);

    const claim = await request('/v2/pair/claim', {
      method: 'POST',
      headers: { ...jsonHeaders(), authorization: `Pairing ${pair.requestToken}` },
      body: JSON.stringify({ requestId: pair.requestId }),
    });
    expect(claim.status).toBe(200);

    const envelope = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'skills/shared/homeserver/SKILL.md',
      content: Buffer.from('private synced skill\n'),
      deleted: false,
      revision: 1,
      sequence: 1,
      authorDeviceId: first.deviceId,
      signingSecretKey: first.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
      idempotencyKey: 'mutation-one-unique-key',
      createdAt: '2026-07-15T12:02:00.000Z',
    });
    const mutation = await request(`/v2/objects/${envelope.objectId}`, {
      method: 'PUT',
      headers: auth(bootstrapToken),
      body: JSON.stringify({ baseRevision: 0, envelope }),
    });
    expect(mutation.status).toBe(200);
    expect(await mutation.json()).toMatchObject({ revision: 1, sequence: 1, replayed: false });

    const replay = await request(`/v2/objects/${envelope.objectId}`, {
      method: 'PUT',
      headers: auth(bootstrapToken),
      body: JSON.stringify({ baseRevision: 0, envelope }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ revision: 1, sequence: 1, replayed: true });

    const changesResponse = await request('/v2/changes?since=0', { headers: auth(joiningToken) });
    expect(changesResponse.status).toBe(200);
    const changes = await changesResponse.json() as { changes: StoredSyncV2Envelope[] };
    expect(changes.changes).toHaveLength(1);
    verifyStoredSyncV2Envelope(changes.changes[0]!, vault.authorityPublicKey, initialCheckpoint());
    expect(decryptSyncV2Envelope(changes.changes[0]!, vault.rootSecret).canonicalPath).toBe(
      'skills/shared/homeserver/SKILL.md',
    );

    const devices = await request('/v2/devices', { headers: auth(joiningToken) });
    expect(devices.status).toBe(200);
    expect((await devices.json() as { devices: unknown[] }).devices).toHaveLength(2);

    const revoke = await request(`/v2/devices/${joining.deviceId}`, {
      method: 'DELETE',
      headers: auth(bootstrapToken),
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ revoked: true, keyRotationRequired: true });
    expect((await request('/v2/devices', { headers: auth(joiningToken) })).status).toBe(401);

    closeApp(app);
    apps.splice(apps.indexOf(app), 1);
    const database = new Database(databasePath, { readonly: true });
    const stored = database.query(
      'select object_id, nonce, ciphertext, signature from sync_history',
    ).all() as Array<Record<string, string>>;
    database.close();
    const serializedStorage = JSON.stringify(stored);
    expect(serializedStorage).not.toContain('skills/shared/homeserver/SKILL.md');
    expect(serializedStorage).not.toContain('private synced skill');
  });

  test('rejects forged signatures, stale checkpoints, reused idempotency keys, and nonces', async () => {
    const { request, token, device, vault } = await bootstrappedServer();
    const first = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'rules/00-general.md',
      content: Buffer.from('one\n'),
      deleted: false,
      revision: 1,
      sequence: 1,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
      idempotencyKey: 'fixed-idempotency-key',
    });
    const forged = { ...first, ciphertext: mutate(first.ciphertext) };
    expect((await put(request, token, forged, 0)).status).toBe(400);
    expect((await put(request, token, first, 0)).status).toBe(200);

    const checkpoint = (await (await request('/v2/changes?since=0', { headers: auth(token) })).json() as {
      checkpoint: { sequence: number; digest: string };
    }).checkpoint;
    const nonceReuse: SyncV2Envelope = {
      ...first,
      revision: 2,
      sequence: 2,
      previousCheckpoint: checkpoint,
      idempotencyKey: 'nonce-reuse-idempotency-key',
    };
    const unsignedNonceReuse: Partial<SyncV2Envelope> = { ...nonceReuse };
    delete unsignedNonceReuse.signature;
    nonceReuse.signature = encodeBase64Url(
      ed25519.sign(canonicalBytes(unsignedNonceReuse), Buffer.from(device.signingSecretKey, 'base64url')),
    );
    const nonceReuseResponse = await put(request, token, nonceReuse, 1);
    expect(nonceReuseResponse.status).toBe(409);
    expect(await nonceReuseResponse.json()).toMatchObject({ error: { code: 'nonce_reuse' } });

    const reusedKey = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'rules/01-other.md',
      content: Buffer.from('two\n'),
      deleted: false,
      revision: 1,
      sequence: 2,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: checkpoint,
      idempotencyKey: 'fixed-idempotency-key',
    });
    expect((await put(request, token, reusedKey, 0)).status).toBe(409);

    const stale = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'rules/02-stale.md',
      content: Buffer.from('stale\n'),
      deleted: false,
      revision: 1,
      sequence: 2,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
      idempotencyKey: 'different-idempotency-key',
    });
    expect((await put(request, token, stale, 0)).status).toBe(409);
  });

  test('refuses forward-incompatible schemas and produces integrity-checked online backups', async () => {
    const futurePath = path.join(await tempDirectory(), 'future.sqlite');
    const future = new Database(futurePath);
    future.exec('create table schema_migrations (version integer primary key, applied_at text not null)');
    future.query('insert into schema_migrations (version, applied_at) values (99, ?)').run(new Date().toISOString());
    future.close();
    expect(() => createApp({ dbPath: futurePath, enableLegacyV1: false })).toThrow('newer than this server supports');

    const sourcePath = path.join(await tempDirectory(), 'source.sqlite');
    const backupPath = path.join(await tempDirectory(), 'backup.sqlite');
    const app = createApp({
      dbPath: sourcePath,
      singleUserToken: 'backup-test-token-with-enough-entropy-123',
      enableLegacyV1: false,
    });
    closeApp(app);
    const processResult = Bun.spawn(
      [process.execPath, path.resolve('packages/server/src/admin.ts'), 'backup', backupPath],
      {
        cwd: path.resolve('.'),
        env: { ...process.env, REGLET_DB: sourcePath },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      processResult.exited,
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(stdout).toContain('backup\tverified');
    const backup = new Database(backupPath, { readonly: true });
    expect((backup.query('pragma quick_check').get() as { quick_check: string }).quick_check).toBe('ok');
    backup.close();
  });
});

async function bootstrappedServer(): Promise<{
  request: ReturnType<typeof appRequest>;
  token: string;
  device: ReturnType<typeof generateSyncV2DeviceKeys>;
  vault: ReturnType<typeof generateSyncV2VaultKeys>;
}> {
  const databasePath = path.join(await tempDirectory(), 'reglet.sqlite');
  const token = 'another-bootstrap-token-with-entropy-456';
  const app = useApp(createApp({ dbPath: databasePath, singleUserToken: token, enableLegacyV1: false, rateLimit: false }));
  const request = appRequest(app);
  const device = generateSyncV2DeviceKeys();
  const vault = generateSyncV2VaultKeys();
  const certificate = issueSyncV2DeviceCertificate(
    {
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      deviceName: 'Mac',
      agreementPublicKey: device.agreementPublicKey,
      signingPublicKey: device.signingPublicKey,
      issuedAt: new Date().toISOString(),
    },
    vault.authoritySecretKey,
  );
  const response = await request('/v2/bootstrap', {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      deviceName: 'Mac',
      agreementPublicKey: device.agreementPublicKey,
      signingPublicKey: device.signingPublicKey,
      authorityPublicKey: vault.authorityPublicKey,
      certificate,
    }),
  });
  expect(response.status).toBe(200);
  return { request, token, device, vault };
}

function appRequest(app: ReturnType<typeof createApp>) {
  return (route: string, init?: RequestInit): Promise<Response> => app.request(`https://reglet.test${route}`, init);
}

function put(
  request: ReturnType<typeof appRequest>,
  token: string,
  envelope: ReturnType<typeof createSyncV2Envelope>,
  baseRevision: number,
): Promise<Response> {
  return request(`/v2/objects/${envelope.objectId}`, {
    method: 'PUT',
    headers: auth(token),
    body: JSON.stringify({ baseRevision, envelope }),
  });
}

function auth(token: string): Record<string, string> {
  return { ...jsonHeaders(), authorization: `Bearer ${token}` };
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mutate(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

function useApp(app: ReturnType<typeof createApp>): ReturnType<typeof createApp> {
  apps.push(app);
  return app;
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'reglet-server-v2-'));
  directories.push(directory);
  return directory;
}
