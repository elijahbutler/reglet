import { randomBytes, randomUUID } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { requireAllowedEncryptedSyncPath } from './v2-path.js';
import {
  initialSyncV2Checkpoint,
  syncV2ProtocolVersion,
  syncV2Suite,
  type StoredSyncV2Envelope,
  type SyncV2Checkpoint,
  type SyncV2DeviceCertificate,
  type SyncV2DeviceCertificatePayload,
  type SyncV2Envelope,
  type SyncV2EnvelopePayload,
  type SyncV2ObjectPlaintext,
  type SyncV2PairApproval,
  type SyncV2PairApprovalPayload,
  type SyncV2PairRequest,
  type SyncV2VaultBundle,
} from './v2-types.js';

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

export interface DeviceKeyPair {
  deviceId: string;
  agreementSecretKey: string;
  agreementPublicKey: string;
  signingSecretKey: string;
  signingPublicKey: string;
}

export interface VaultKeyMaterial {
  vaultId: string;
  rootSecret: string;
  authoritySecretKey: string;
  authorityPublicKey: string;
  keyEpoch: number;
}

export interface CreateEnvelopeOptions {
  vaultId: string;
  rootSecret: string;
  keyEpoch: number;
  path: string;
  content: Uint8Array;
  deleted: boolean;
  revision: number;
  sequence: number;
  authorDeviceId: string;
  signingSecretKey: string;
  previousCheckpoint: SyncV2Checkpoint;
  idempotencyKey?: string;
  createdAt?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const keyBytes = 32;
const nonceBytes = 24;
const signatureBytes = 64;
const syncV2ObjectMaximumBytes = 2 * 1024 * 1024;
const syncV2CiphertextMaximumBytes = Math.ceil((syncV2ObjectMaximumBytes * 4) / 3) + 32 * 1024;
const syncV2CiphertextStringMaximumLength = Math.ceil((syncV2CiphertextMaximumBytes * 4) / 3) + 4096;

export function generateSyncV2DeviceKeys(): DeviceKeyPair {
  const agreement = x25519.keygen();
  const signing = ed25519.keygen();
  return {
    deviceId: randomUUID(),
    agreementSecretKey: encodeBase64Url(agreement.secretKey),
    agreementPublicKey: encodeBase64Url(agreement.publicKey),
    signingSecretKey: encodeBase64Url(signing.secretKey),
    signingPublicKey: encodeBase64Url(signing.publicKey),
  };
}

export function generateSyncV2VaultKeys(): VaultKeyMaterial {
  const authority = ed25519.keygen();
  return {
    vaultId: randomUUID(),
    rootSecret: encodeBase64Url(randomBytes(keyBytes)),
    authoritySecretKey: encodeBase64Url(authority.secretKey),
    authorityPublicKey: encodeBase64Url(authority.publicKey),
    keyEpoch: 1,
  };
}

export function issueSyncV2DeviceCertificate(
  payload: Omit<SyncV2DeviceCertificatePayload, 'protocolVersion' | 'suite'>,
  authoritySecretKey: string,
): SyncV2DeviceCertificate {
  const certificatePayload: SyncV2DeviceCertificatePayload = {
    protocolVersion: syncV2ProtocolVersion,
    suite: syncV2Suite,
    ...payload,
  };
  const signature = ed25519.sign(canonicalBytes(certificatePayload), decodeKey(authoritySecretKey));
  return { ...certificatePayload, authoritySignature: encodeBase64Url(signature) };
}

export function verifySyncV2DeviceCertificate(
  certificate: SyncV2DeviceCertificate,
  authorityPublicKey: string,
): boolean {
  try {
    const { authoritySignature, ...payload } = certificate;
    return (
      isDeviceCertificatePayload(payload) &&
      ed25519.verify(
        decodeFixedBase64Url(authoritySignature, signatureBytes),
        canonicalBytes(payload),
        decodeFixedBase64Url(authorityPublicKey, keyBytes),
        { zip215: false },
      )
    );
  } catch {
    return false;
  }
}

export function createSyncV2Envelope(options: CreateEnvelopeOptions): SyncV2Envelope {
  const canonicalPath = requireAllowedEncryptedSyncPath(options.path);
  if (options.content.byteLength > syncV2ObjectMaximumBytes) {
    throw new Error(`Sync object exceeds ${syncV2ObjectMaximumBytes} bytes`);
  }
  requirePositiveSafeInteger(options.revision, 'revision');
  requirePositiveSafeInteger(options.sequence, 'sequence');
  requireKeyEpoch(options.keyEpoch);
  requireCheckpoint(options.previousCheckpoint);

  const rootSecret = decodeFixedBase64Url(options.rootSecret, keyBytes);
  const nonce = randomBytes(nonceBytes);
  const objectId = syncV2ObjectId(rootSecret, options.vaultId, options.keyEpoch, canonicalPath);
  const plaintext: SyncV2ObjectPlaintext = {
    schemaVersion: 1,
    canonicalPath,
    contentKind: contentKind(canonicalPath),
    deleted: options.deleted,
    contentBase64: options.deleted ? '' : encodeBase64(options.content),
    contentHash: options.deleted ? '' : encodeBase64Url(sha256(options.content)),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  const aadPayload = {
    protocolVersion: syncV2ProtocolVersion,
    suite: syncV2Suite,
    vaultId: options.vaultId,
    objectId,
    keyEpoch: options.keyEpoch,
    revision: options.revision,
    sequence: options.sequence,
    authorDeviceId: options.authorDeviceId,
    previousCheckpoint: options.previousCheckpoint,
    idempotencyKey: options.idempotencyKey ?? randomId(),
  };
  const key = deriveEpochKey(rootSecret, options.vaultId, options.keyEpoch, 'content');
  const ciphertext = xchacha20poly1305(key, nonce, canonicalBytes(aadPayload)).encrypt(canonicalBytes(plaintext));
  key.fill(0);
  rootSecret.fill(0);

  const payload: SyncV2EnvelopePayload = {
    ...aadPayload,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(ciphertext),
  };
  const signature = ed25519.sign(canonicalBytes(payload), decodeKey(options.signingSecretKey));
  return { ...payload, signature: encodeBase64Url(signature) };
}

export function decryptSyncV2Envelope(envelope: SyncV2Envelope, rootSecretValue: string): SyncV2ObjectPlaintext {
  requireSyncV2Envelope(envelope);
  const rootSecret = decodeFixedBase64Url(rootSecretValue, keyBytes);
  const aadPayload = envelopeAad(envelope);
  const key = deriveEpochKey(rootSecret, envelope.vaultId, envelope.keyEpoch, 'content');
  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = xchacha20poly1305(
      key,
      decodeFixedBase64Url(envelope.nonce, nonceBytes),
      canonicalBytes(aadPayload),
    ).decrypt(decodeBase64Url(envelope.ciphertext));
  } catch {
    throw new Error('Sync rejected an object that failed authenticated decryption');
  } finally {
    key.fill(0);
    rootSecret.fill(0);
  }

  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(plaintextBytes)) as unknown;
  } catch {
    throw new Error('Sync rejected invalid encrypted object JSON');
  }
  if (!isSyncV2ObjectPlaintext(value)) throw new Error('Sync rejected an invalid encrypted object');
  const canonicalPath = requireAllowedEncryptedSyncPath(value.canonicalPath);
  const expectedId = syncV2ObjectId(decodeFixedBase64Url(rootSecretValue, keyBytes), envelope.vaultId, envelope.keyEpoch, canonicalPath);
  if (expectedId !== envelope.objectId || value.contentKind !== contentKind(canonicalPath)) {
    throw new Error('Sync rejected an object whose encrypted identity does not match its routing identity');
  }
  const content = value.deleted ? new Uint8Array() : decodeStrictBase64(value.contentBase64);
  if (content.byteLength > syncV2ObjectMaximumBytes) throw new Error('Sync rejected an oversized decrypted object');
  const expectedHash = value.deleted ? '' : encodeBase64Url(sha256(content));
  if (value.contentHash !== expectedHash || (value.deleted && value.contentBase64 !== '')) {
    throw new Error('Sync rejected an object with inconsistent encrypted content');
  }
  return value;
}

export function verifySyncV2EnvelopeSignature(envelope: SyncV2Envelope, signingPublicKey: string): boolean {
  try {
    requireSyncV2Envelope(envelope);
    return ed25519.verify(
      decodeFixedBase64Url(envelope.signature, signatureBytes),
      canonicalBytes(envelopePayload(envelope)),
      decodeFixedBase64Url(signingPublicKey, keyBytes),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function syncV2CheckpointForEnvelope(envelope: SyncV2Envelope): SyncV2Checkpoint {
  requireSyncV2Envelope(envelope);
  return {
    sequence: envelope.sequence,
    digest: encodeBase64Url(sha256(canonicalBytes({ ...envelopePayload(envelope), signature: envelope.signature }))),
  };
}

export function verifyStoredSyncV2Envelope(
  stored: StoredSyncV2Envelope,
  authorityPublicKey: string,
  expectedPrevious: SyncV2Checkpoint,
): void {
  requireSyncV2Envelope(stored);
  if (!sameCheckpoint(stored.previousCheckpoint, expectedPrevious) || stored.sequence !== expectedPrevious.sequence + 1) {
    throw new Error('Sync rejected a skipped or rolled-back checkpoint chain');
  }
  const certificate = stored.author.certificate;
  if (
    stored.author.deviceId !== stored.authorDeviceId ||
    certificate.deviceId !== stored.author.deviceId ||
    certificate.signingPublicKey !== stored.author.signingPublicKey ||
    certificate.agreementPublicKey !== stored.author.agreementPublicKey ||
    certificate.vaultId !== stored.vaultId ||
    !verifySyncV2DeviceCertificate(certificate, authorityPublicKey)
  ) {
    throw new Error('Sync rejected an unauthorized author identity');
  }
  if (!verifySyncV2EnvelopeSignature(stored, stored.author.signingPublicKey)) {
    throw new Error('Sync rejected an invalid object signature');
  }
  const checkpoint = syncV2CheckpointForEnvelope(stored);
  if (!sameCheckpoint(stored.checkpoint, checkpoint)) throw new Error('Sync rejected an invalid object checkpoint');
}

export function createSyncV2PairApproval(
  request: SyncV2PairRequest,
  approver: { deviceId: string; signingSecretKey: string; signingPublicKey: string },
  bundle: SyncV2VaultBundle,
  authoritySecretKey: string,
  approvedAt = new Date().toISOString(),
): SyncV2PairApproval {
  const ephemeral = x25519.keygen();
  const certificate = issueSyncV2DeviceCertificate(
    {
      vaultId: bundle.vaultId,
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      agreementPublicKey: request.agreementPublicKey,
      signingPublicKey: request.signingPublicKey,
      issuedAt: approvedAt,
    },
    authoritySecretKey,
  );
  const approvalBase = {
    protocolVersion: syncV2ProtocolVersion,
    suite: syncV2Suite,
    requestId: request.requestId,
    vaultId: bundle.vaultId,
    approverDeviceId: approver.deviceId,
    approverSigningPublicKey: approver.signingPublicKey,
    newDevice: {
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      agreementPublicKey: request.agreementPublicKey,
      signingPublicKey: request.signingPublicKey,
    },
    certificate,
    ephemeralPublicKey: encodeBase64Url(ephemeral.publicKey),
    approvedAt,
  };
  const nonce = randomBytes(nonceBytes);
  const shared = x25519.getSharedSecret(ephemeral.secretKey, decodeFixedBase64Url(request.agreementPublicKey, keyBytes));
  const wrapKey = derivePairingKey(shared, approvalBase);
  const ciphertext = xchacha20poly1305(wrapKey, nonce, canonicalBytes(approvalBase)).encrypt(canonicalBytes(bundle));
  shared.fill(0);
  wrapKey.fill(0);
  ephemeral.secretKey.fill(0);
  const payload: SyncV2PairApprovalPayload = {
    ...approvalBase,
    nonce: encodeBase64Url(nonce),
    encryptedVaultBundle: encodeBase64Url(ciphertext),
  };
  return {
    ...payload,
    approvalSignature: encodeBase64Url(ed25519.sign(canonicalBytes(payload), decodeKey(approver.signingSecretKey))),
  };
}

export function openSyncV2PairApproval(
  approval: SyncV2PairApproval,
  request: SyncV2PairRequest,
  agreementSecretKey: string,
): SyncV2VaultBundle {
  requirePairApproval(approval, request);
  const { approvalSignature, nonce, encryptedVaultBundle, ...approvalBase } = approval;
  const payload: SyncV2PairApprovalPayload = { ...approvalBase, nonce, encryptedVaultBundle };
  if (!ed25519.verify(
    decodeFixedBase64Url(approvalSignature, signatureBytes),
    canonicalBytes(payload),
    decodeFixedBase64Url(approval.approverSigningPublicKey, keyBytes),
    { zip215: false },
  )) {
    throw new Error('Pairing approval signature is invalid');
  }
  const shared = x25519.getSharedSecret(
    decodeFixedBase64Url(agreementSecretKey, keyBytes),
    decodeFixedBase64Url(approval.ephemeralPublicKey, keyBytes),
  );
  const wrapKey = derivePairingKey(shared, approvalBase);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(
      wrapKey,
      decodeFixedBase64Url(approval.nonce, nonceBytes),
      canonicalBytes(approvalBase),
    ).decrypt(decodeBase64Url(approval.encryptedVaultBundle));
  } catch {
    throw new Error('Pairing vault keys failed authenticated decryption');
  } finally {
    shared.fill(0);
    wrapKey.fill(0);
  }
  let bundle: unknown;
  try {
    bundle = JSON.parse(decoder.decode(plaintext)) as unknown;
  } catch {
    throw new Error('Pairing vault bundle is invalid');
  }
  if (!isVaultBundle(bundle) || bundle.vaultId !== approval.vaultId) throw new Error('Pairing vault bundle is invalid');
  const authorityPublicKey = encodeBase64Url(ed25519.getPublicKey(decodeKey(bundle.authoritySecretKey)));
  if (!verifySyncV2DeviceCertificate(approval.certificate, authorityPublicKey)) {
    throw new Error('Pairing device authorization is invalid');
  }
  if (approval.certificate.signingPublicKey !== request.signingPublicKey) {
    throw new Error('Pairing authorization does not match this device');
  }
  decodeFixedBase64Url(bundle.rootSecret, keyBytes);
  requireKeyEpoch(bundle.keyEpoch);
  return bundle;
}

export function verifySyncV2PairApprovalSignature(approval: SyncV2PairApproval): boolean {
  try {
    const { approvalSignature, ...payload } = approval;
    return ed25519.verify(
      decodeFixedBase64Url(approvalSignature, signatureBytes),
      canonicalBytes(payload),
      decodeFixedBase64Url(approval.approverSigningPublicKey, keyBytes),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function syncV2PairingSas(approval: SyncV2PairApproval): string {
  const digest = Buffer.from(sha256(canonicalBytes({
    requestId: approval.requestId,
    vaultId: approval.vaultId,
    approverDeviceId: approval.approverDeviceId,
    approverSigningPublicKey: approval.approverSigningPublicKey,
    newDevice: approval.newDevice,
  }))).toString('hex').slice(0, 24).toUpperCase();
  return digest.match(/.{4}/g)?.join(' ') ?? digest;
}

export function syncV2ObjectId(rootSecret: Uint8Array, vaultId: string, epoch: number, canonicalPath: string): string {
  const indexKey = deriveEpochKey(rootSecret, vaultId, epoch, 'index');
  const id = encodeBase64Url(hmac(sha256, indexKey, encoder.encode(canonicalPath)));
  indexKey.fill(0);
  return id;
}

export function syncV2AuthorityPublicKey(authoritySecretKey: string): string {
  return encodeBase64Url(ed25519.getPublicKey(decodeKey(authoritySecretKey)));
}

export function syncV2SigningPublicKey(signingSecretKey: string): string {
  return encodeBase64Url(ed25519.getPublicKey(decodeKey(signingSecretKey)));
}

export function syncV2AgreementPublicKey(agreementSecretKey: string): string {
  return encodeBase64Url(x25519.getPublicKey(decodeKey(agreementSecretKey)));
}

export function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Invalid base64url value');
  return decoded;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

export function requireSyncV2Envelope(value: SyncV2Envelope): void {
  if (
    value.protocolVersion !== syncV2ProtocolVersion ||
    value.suite !== syncV2Suite ||
    !isIdentifier(value.vaultId) ||
    !isBase64UrlBytes(value.objectId, 32) ||
    !isIdentifier(value.authorDeviceId) ||
    !isPositiveSafeInteger(value.keyEpoch) ||
    !isPositiveSafeInteger(value.revision) ||
    !isPositiveSafeInteger(value.sequence) ||
    !isBase64UrlBytes(value.nonce, nonceBytes) ||
    !isBoundedCiphertext(value.ciphertext) ||
    !isIdentifier(value.idempotencyKey) ||
    !isBase64UrlBytes(value.signature, signatureBytes)
  ) {
    throw new Error('Invalid protocol-v2 envelope');
  }
  requireCheckpoint(value.previousCheckpoint);
}

export function isSyncV2Checkpoint(value: unknown): value is SyncV2Checkpoint {
  return isRecord(value) && isNonNegativeSafeInteger(value.sequence) && isBase64UrlBytes(value.digest, 32);
}

export function sameCheckpoint(left: SyncV2Checkpoint, right: SyncV2Checkpoint): boolean {
  return left.sequence === right.sequence && left.digest === right.digest;
}

export function initialCheckpoint(): SyncV2Checkpoint {
  return { sequence: 0, digest: initialSyncV2Checkpoint };
}

function envelopeAad(envelope: SyncV2Envelope): Omit<SyncV2EnvelopePayload, 'nonce' | 'ciphertext'> {
  return {
    protocolVersion: envelope.protocolVersion,
    suite: envelope.suite,
    vaultId: envelope.vaultId,
    objectId: envelope.objectId,
    keyEpoch: envelope.keyEpoch,
    revision: envelope.revision,
    sequence: envelope.sequence,
    authorDeviceId: envelope.authorDeviceId,
    previousCheckpoint: envelope.previousCheckpoint,
    idempotencyKey: envelope.idempotencyKey,
  };
}

function envelopePayload(envelope: SyncV2Envelope): SyncV2EnvelopePayload {
  return {
    ...envelopeAad(envelope),
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  };
}

function deriveEpochKey(rootSecret: Uint8Array, vaultId: string, epoch: number, purpose: 'content' | 'index'): Uint8Array {
  return hkdf(
    sha256,
    rootSecret,
    sha256(encoder.encode(`${syncV2Suite}:${vaultId}:${epoch}`)),
    encoder.encode(`reglet-sync-v2:${purpose}`),
    keyBytes,
  );
}

function derivePairingKey(sharedSecret: Uint8Array, context: unknown): Uint8Array {
  const contextHash = sha256(canonicalBytes(context));
  return hkdf(sha256, sharedSecret, contextHash, encoder.encode('reglet-sync-v2:pairing-wrap'), keyBytes);
}

function contentKind(filePath: string): SyncV2ObjectPlaintext['contentKind'] {
  if (filePath.startsWith('rules/')) return 'rules';
  if (filePath.startsWith('skills/')) return 'skills';
  return 'mcp';
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function decodeStrictBase64(value: string): Uint8Array {
  if (value === '') return new Uint8Array();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid base64 content');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('Invalid base64 content');
  return decoded;
}

function decodeKey(value: string): Uint8Array {
  return decodeFixedBase64Url(value, keyBytes);
}

function decodeFixedBase64Url(value: string, length: number): Uint8Array {
  const decoded = decodeBase64Url(value);
  if (decoded.byteLength !== length) throw new Error(`Expected ${length} bytes`);
  return decoded;
}

function randomId(): string {
  return encodeBase64Url(randomBytes(18));
}

function isSyncV2ObjectPlaintext(value: unknown): value is SyncV2ObjectPlaintext {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.canonicalPath === 'string' &&
    (value.contentKind === 'rules' || value.contentKind === 'skills' || value.contentKind === 'mcp') &&
    typeof value.deleted === 'boolean' &&
    typeof value.contentBase64 === 'string' &&
    typeof value.contentHash === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function isVaultBundle(value: unknown): value is SyncV2VaultBundle {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isIdentifier(value.vaultId) &&
    isBase64UrlBytes(value.rootSecret, keyBytes) &&
    isBase64UrlBytes(value.authoritySecretKey, keyBytes) &&
    isPositiveSafeInteger(value.keyEpoch)
  );
}

function isDeviceCertificatePayload(value: unknown): value is SyncV2DeviceCertificatePayload {
  return (
    isRecord(value) &&
    value.protocolVersion === syncV2ProtocolVersion &&
    value.suite === syncV2Suite &&
    isIdentifier(value.vaultId) &&
    isIdentifier(value.deviceId) &&
    typeof value.deviceName === 'string' &&
    value.deviceName.length > 0 &&
    value.deviceName.length <= 80 &&
    isBase64UrlBytes(value.agreementPublicKey, keyBytes) &&
    isBase64UrlBytes(value.signingPublicKey, keyBytes) &&
    typeof value.issuedAt === 'string' &&
    Number.isFinite(Date.parse(value.issuedAt))
  );
}

function requirePairApproval(approval: SyncV2PairApproval, request: SyncV2PairRequest): void {
  if (
    approval.protocolVersion !== syncV2ProtocolVersion ||
    approval.suite !== syncV2Suite ||
    approval.requestId !== request.requestId ||
    approval.newDevice.deviceId !== request.deviceId ||
    approval.newDevice.deviceName !== request.deviceName ||
    approval.newDevice.agreementPublicKey !== request.agreementPublicKey ||
    approval.newDevice.signingPublicKey !== request.signingPublicKey ||
    !isBase64UrlBytes(approval.approverSigningPublicKey, keyBytes) ||
    !isBase64UrlBytes(approval.ephemeralPublicKey, keyBytes) ||
    !isBase64UrlBytes(approval.nonce, nonceBytes) ||
    !isBase64UrlBytes(approval.approvalSignature, signatureBytes) ||
    typeof approval.encryptedVaultBundle !== 'string' ||
    approval.encryptedVaultBundle.length > 4096
  ) {
    throw new Error('Pairing approval does not match this device');
  }
}

function requireCheckpoint(value: SyncV2Checkpoint): void {
  if (!isSyncV2Checkpoint(value)) throw new Error('Invalid sync checkpoint');
}

function requireKeyEpoch(value: number): void {
  requirePositiveSafeInteger(value, 'key epoch');
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!isPositiveSafeInteger(value)) throw new Error(`Invalid ${label}`);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isBase64UrlBytes(value: unknown, length: number): value is string {
  if (typeof value !== 'string') return false;
  try {
    return decodeBase64Url(value).byteLength === length;
  } catch {
    return false;
  }
}

function isBoundedCiphertext(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > syncV2CiphertextStringMaximumLength) return false;
  try {
    return decodeBase64Url(value).byteLength <= syncV2CiphertextMaximumBytes;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Canonical JSON only accepts safe integers');
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalValue);
  if (typeof value === 'object' && value !== null) {
    const output: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw new Error('Canonical JSON does not accept undefined');
      output[key] = toCanonicalValue(child);
    }
    return output;
  }
  throw new Error(`Canonical JSON does not accept ${typeof value}`);
}
