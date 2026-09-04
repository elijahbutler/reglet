import { describe, expect, test } from 'bun:test';
import {
  createSyncV2Envelope,
  createSyncV2PairApproval,
  decryptSyncV2Envelope,
  generateSyncV2DeviceKeys,
  generateSyncV2VaultKeys,
  initialCheckpoint,
  issueSyncV2DeviceCertificate,
  openSyncV2PairApproval,
  syncV2AuthorityPublicKey,
  syncV2CheckpointForEnvelope,
  syncV2PairingSas,
  verifyStoredSyncV2Envelope,
  verifySyncV2EnvelopeSignature,
} from '../src/sync/v2-crypto.js';
import { isAllowedEncryptedSyncPath } from '../src/sync/v2-path.js';
import { syncV2ProtocolVersion, syncV2Suite, type SyncV2PairRequest } from '../src/sync/v2-types.js';

describe('sync protocol v2 cryptography', () => {
  test('encrypts paths and content while authenticating author, metadata, and checkpoints', () => {
    const device = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const certificate = issueSyncV2DeviceCertificate(
      {
        vaultId: vault.vaultId,
        deviceId: device.deviceId,
        deviceName: 'MacBook',
        agreementPublicKey: device.agreementPublicKey,
        signingPublicKey: device.signingPublicKey,
        issuedAt: '2026-07-15T12:00:00.000Z',
      },
      vault.authoritySecretKey,
    );
    const envelope = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'skills/shared/review/SKILL.md',
      content: Buffer.from('secret skill contents\n'),
      deleted: false,
      revision: 1,
      sequence: 1,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
      idempotencyKey: 'test-idempotency-key',
      createdAt: '2026-07-15T12:00:00.000Z',
    });
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain('skills/shared/review/SKILL.md');
    expect(serialized).not.toContain('secret skill contents');
    expect(verifySyncV2EnvelopeSignature(envelope, device.signingPublicKey)).toBe(true);
    expect(decryptSyncV2Envelope(envelope, vault.rootSecret)).toMatchObject({
      canonicalPath: 'skills/shared/review/SKILL.md',
      contentBase64: Buffer.from('secret skill contents\n').toString('base64'),
      deleted: false,
    });

    const checkpoint = syncV2CheckpointForEnvelope(envelope);
    verifyStoredSyncV2Envelope(
      {
        ...envelope,
        checkpoint,
        author: {
          deviceId: device.deviceId,
          deviceName: 'MacBook',
          agreementPublicKey: device.agreementPublicKey,
          signingPublicKey: device.signingPublicKey,
          certificate,
        },
      },
      vault.authorityPublicKey,
      initialCheckpoint(),
    );
  });

  test('rejects modified routing metadata, ciphertext, signatures, and identity substitutions', () => {
    const device = generateSyncV2DeviceKeys();
    const attacker = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const envelope = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'rules/00-general.md',
      content: Buffer.from('rules\n'),
      deleted: false,
      revision: 1,
      sequence: 1,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
    });

    expect(verifySyncV2EnvelopeSignature({ ...envelope, revision: 2 }, device.signingPublicKey)).toBe(false);
    expect(verifySyncV2EnvelopeSignature(envelope, attacker.signingPublicKey)).toBe(false);
    expect(() => decryptSyncV2Envelope({ ...envelope, ciphertext: mutate(envelope.ciphertext) }, vault.rootSecret)).toThrow(
      'authenticated decryption',
    );
  });

  test('pairs a device with signed authorization, encrypted vault keys, and matching SAS', () => {
    const existing = generateSyncV2DeviceKeys();
    const joining = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const request: SyncV2PairRequest = {
      requestId: 'pair-request-123',
      code: 'ABCD1234',
      deviceId: joining.deviceId,
      deviceName: 'Windows PC',
      agreementPublicKey: joining.agreementPublicKey,
      signingPublicKey: joining.signingPublicKey,
      expiresAt: '2026-07-15T12:10:00.000Z',
    };
    const bundle = {
      version: 1 as const,
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      authoritySecretKey: vault.authoritySecretKey,
      keyEpoch: 1,
    };
    const approval = createSyncV2PairApproval(
      request,
      {
        deviceId: existing.deviceId,
        signingSecretKey: existing.signingSecretKey,
        signingPublicKey: existing.signingPublicKey,
      },
      bundle,
      vault.authoritySecretKey,
      '2026-07-15T12:01:00.000Z',
    );

    expect(syncV2PairingSas(approval).split(' ')).toHaveLength(6);
    expect(openSyncV2PairApproval(approval, request, joining.agreementSecretKey)).toEqual(bundle);
    expect(syncV2AuthorityPublicKey(vault.authoritySecretKey)).toBe(vault.authorityPublicKey);
    expect(() => openSyncV2PairApproval({ ...approval, encryptedVaultBundle: mutate(approval.encryptedVaultBundle) }, request, joining.agreementSecretKey)).toThrow();
  });

  test('keeps machine-local config and local artifacts out of encrypted sync', () => {
    expect(isAllowedEncryptedSyncPath('rules/00-general.md')).toBe(true);
    expect(isAllowedEncryptedSyncPath('skills/codex/my-skill/SKILL.md')).toBe(true);
    expect(isAllowedEncryptedSyncPath('mcp/providers/claude/servers.json')).toBe(true);
    expect(isAllowedEncryptedSyncPath('library.json')).toBe(true);
    expect(isAllowedEncryptedSyncPath('reglet.toml')).toBe(false);
    expect(isAllowedEncryptedSyncPath('.state/sync-v2.json')).toBe(false);
    expect(isAllowedEncryptedSyncPath('rules/file.conflict-device.md')).toBe(false);
    expect(syncV2ProtocolVersion).toBe(2);
    expect(syncV2Suite).toContain('xchacha20poly1305');
  });

  test('supports sync objects larger than 128KB up to 2MB, and rejects objects exceeding 2MB', () => {
    const device = generateSyncV2DeviceKeys();
    const vault = generateSyncV2VaultKeys();
    const largeContent = Buffer.alloc(300 * 1024, 'a');

    const envelope = createSyncV2Envelope({
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      keyEpoch: 1,
      path: 'mcp/servers.json',
      content: largeContent,
      deleted: false,
      revision: 1,
      sequence: 1,
      authorDeviceId: device.deviceId,
      signingSecretKey: device.signingSecretKey,
      previousCheckpoint: initialCheckpoint(),
    });

    const decrypted = decryptSyncV2Envelope(envelope, vault.rootSecret);
    expect(decrypted.canonicalPath).toBe('mcp/servers.json');
    expect(Buffer.from(decrypted.contentBase64, 'base64').byteLength).toBe(300 * 1024);

    const oversizedContent = Buffer.alloc(2 * 1024 * 1024 + 1, 'b');
    expect(() =>
      createSyncV2Envelope({
        vaultId: vault.vaultId,
        rootSecret: vault.rootSecret,
        keyEpoch: 1,
        path: 'mcp/servers.json',
        content: oversizedContent,
        deleted: false,
        revision: 1,
        sequence: 1,
        authorDeviceId: device.deviceId,
        signingSecretKey: device.signingSecretKey,
        previousCheckpoint: initialCheckpoint(),
      }),
    ).toThrow('Sync object exceeds 2097152 bytes');
  });
});

function mutate(value: string): string {
  const replacement = value[0] === 'A' ? 'B' : 'A';
  return `${replacement}${value.slice(1)}`;
}
