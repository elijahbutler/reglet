export const syncV2ProtocolVersion = 2 as const;
export const syncV2Suite = 'reglet-xchacha20poly1305-ed25519-x25519-hkdfsha256-v1' as const;
export const initialSyncV2Checkpoint = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;

export interface SyncV2Checkpoint {
  sequence: number;
  digest: string;
}

export interface SyncV2DeviceCertificatePayload {
  protocolVersion: typeof syncV2ProtocolVersion;
  suite: typeof syncV2Suite;
  vaultId: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  issuedAt: string;
}

export interface SyncV2DeviceCertificate extends SyncV2DeviceCertificatePayload {
  authoritySignature: string;
}

export interface SyncV2DeviceIdentity {
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  certificate: SyncV2DeviceCertificate;
}

export interface SyncV2ObjectPlaintext {
  schemaVersion: 1;
  canonicalPath: string;
  contentKind: 'rules' | 'skills' | 'mcp';
  deleted: boolean;
  contentBase64: string;
  contentHash: string;
  createdAt: string;
}

export interface SyncV2EnvelopePayload {
  protocolVersion: typeof syncV2ProtocolVersion;
  suite: typeof syncV2Suite;
  vaultId: string;
  objectId: string;
  keyEpoch: number;
  revision: number;
  sequence: number;
  authorDeviceId: string;
  nonce: string;
  ciphertext: string;
  previousCheckpoint: SyncV2Checkpoint;
  idempotencyKey: string;
}

export interface SyncV2Envelope extends SyncV2EnvelopePayload {
  signature: string;
}

export interface StoredSyncV2Envelope extends SyncV2Envelope {
  checkpoint: SyncV2Checkpoint;
  author: SyncV2DeviceIdentity;
}

export interface SyncV2PairRequest {
  requestId: string;
  code: string;
  deviceId: string;
  deviceName: string;
  agreementPublicKey: string;
  signingPublicKey: string;
  expiresAt: string;
}

export interface SyncV2PairApprovalPayload {
  protocolVersion: typeof syncV2ProtocolVersion;
  suite: typeof syncV2Suite;
  requestId: string;
  vaultId: string;
  approverDeviceId: string;
  approverSigningPublicKey: string;
  newDevice: Omit<SyncV2DeviceIdentity, 'certificate'>;
  certificate: SyncV2DeviceCertificate;
  ephemeralPublicKey: string;
  nonce: string;
  encryptedVaultBundle: string;
  approvedAt: string;
}

export interface SyncV2PairApproval extends SyncV2PairApprovalPayload {
  approvalSignature: string;
}

export interface SyncV2VaultBundle {
  version: 1;
  vaultId: string;
  rootSecret: string;
  authoritySecretKey: string;
  keyEpoch: number;
}

export interface SyncV2DeviceSecrets extends SyncV2VaultBundle {
  deviceToken: string;
  agreementSecretKey: string;
  signingSecretKey: string;
}

export interface PendingSyncV2PairSecrets {
  version: 1;
  requestToken: string;
  deviceToken: string;
  agreementSecretKey: string;
  signingSecretKey: string;
}

export interface SyncV2ChangesResponse {
  changes: StoredSyncV2Envelope[];
  cursor: number;
  checkpoint: SyncV2Checkpoint;
  hasMore: boolean;
}

export interface SyncV2MutationResponse {
  revision: number;
  sequence: number;
  checkpoint: SyncV2Checkpoint;
  replayed: boolean;
}

export interface SyncV2ConflictResponse {
  error: { code: 'conflict'; message: string };
  headRevision: number;
  checkpoint: SyncV2Checkpoint;
}

export interface SyncV2DeviceRecord extends SyncV2DeviceIdentity {
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface SyncV2DevicesResponse {
  currentDeviceId: string;
  devices: SyncV2DeviceRecord[];
  cursor: number;
  hasMore: boolean;
}
