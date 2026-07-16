import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { regletHome } from '../paths.js';
import { requireSecureSyncServerUrl } from './client.js';
import { SyncV2Client } from './v2-client.js';
import {
  activeSyncV2CredentialId,
  loadPendingSyncV2Secrets,
  loadSyncV2DeviceSecrets,
  pendingSyncV2CredentialId,
  platformSyncV2SecretStore,
  savePendingSyncV2Secrets,
  saveSyncV2DeviceSecrets,
  type SyncV2SecretStore,
} from './v2-credentials.js';
import {
  createSyncV2PairApproval,
  generateSyncV2DeviceKeys,
  generateSyncV2VaultKeys,
  issueSyncV2DeviceCertificate,
  openSyncV2PairApproval,
  syncV2AuthorityPublicKey,
  syncV2AgreementPublicKey,
  syncV2PairingSas,
  syncV2SigningPublicKey,
  verifySyncV2DeviceCertificate,
} from './v2-crypto.js';
import {
  clearSyncV2State,
  loadActiveSyncV2State,
  loadPendingSyncV2State,
  loadSyncV2State,
  newActiveSyncV2State,
  saveSyncV2State,
} from './v2-state.js';
import type {
  SyncV2DeviceRecord,
  SyncV2DevicesResponse,
  SyncV2PairRequest,
} from './v2-types.js';

export interface BootstrapSyncV2Options {
  serverUrl: string;
  bootstrapToken: string;
  deviceName: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}

export interface RequestSyncV2PairingOptions {
  serverUrl: string;
  deviceName: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}

export interface ApproveSyncV2PairingOptions {
  code: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}

export interface PendingSyncV2PairingStatus {
  status: 'pending' | 'approved' | 'claimed';
  sas: string | null;
  deviceName: string;
  expiresAt: string;
}

export async function bootstrapSyncV2(options: BootstrapSyncV2Options): Promise<void> {
  const home = options.home ?? regletHome();
  const serverUrl = requireSecureSyncServerUrl(options.serverUrl);
  requireDeviceName(options.deviceName);
  requireSecret(options.bootstrapToken, 'bootstrap token');
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const client = new SyncV2Client(serverUrl, options.fetchImpl);
  await client.ensureCompatible();
  const existingState = await loadSyncV2State(home);
  if (existingState?.phase === 'pending') throw new Error('This device already has a pending encrypted pairing request');
  if (existingState?.phase === 'active') {
    if (existingState.serverUrl !== serverUrl) throw new Error('This device is already connected to another sync server');
    const existingSecrets = await loadSyncV2DeviceSecrets(existingState.credentialId, store);
    const agreementPublicKey = syncV2AgreementPublicKey(existingSecrets.agreementSecretKey);
    const signingPublicKey = syncV2SigningPublicKey(existingSecrets.signingSecretKey);
    const certificate = issueSyncV2DeviceCertificate(
      {
        vaultId: existingState.vaultId,
        deviceId: existingState.deviceId,
        deviceName: existingState.deviceName,
        agreementPublicKey,
        signingPublicKey,
        issuedAt: new Date().toISOString(),
      },
      existingSecrets.authoritySecretKey,
    );
    await client.bootstrap(options.bootstrapToken, {
      vaultId: existingState.vaultId,
      deviceId: existingState.deviceId,
      deviceName: existingState.deviceName,
      agreementPublicKey,
      signingPublicKey,
      authorityPublicKey: syncV2AuthorityPublicKey(existingSecrets.authoritySecretKey),
      certificate,
    });
    if (existingSecrets.deviceToken !== options.bootstrapToken) {
      await saveSyncV2DeviceSecrets(
        existingState.credentialId,
        { ...existingSecrets, deviceToken: options.bootstrapToken },
        store,
      );
    }
    return;
  }
  const credentialId = activeSyncV2CredentialId(serverUrl);
  if (
    (await store.get(credentialId)) !== null ||
    (await store.get(pendingSyncV2CredentialId(serverUrl))) !== null
  ) {
    throw new Error(
      'Sync credentials exist but local sync state is missing; restore the state file or remove the orphaned operating-system credential before bootstrapping',
    );
  }
  const device = generateSyncV2DeviceKeys();
  const vault = generateSyncV2VaultKeys();
  const issuedAt = new Date().toISOString();
  const certificate = issueSyncV2DeviceCertificate(
    {
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      deviceName: options.deviceName.trim(),
      agreementPublicKey: device.agreementPublicKey,
      signingPublicKey: device.signingPublicKey,
      issuedAt,
    },
    vault.authoritySecretKey,
  );
  await saveSyncV2DeviceSecrets(
    credentialId,
    {
      version: 1,
      vaultId: vault.vaultId,
      rootSecret: vault.rootSecret,
      authoritySecretKey: vault.authoritySecretKey,
      keyEpoch: 1,
      deviceToken: options.bootstrapToken,
      agreementSecretKey: device.agreementSecretKey,
      signingSecretKey: device.signingSecretKey,
    },
    store,
  );
  try {
    await saveSyncV2State(
      newActiveSyncV2State({
        serverUrl,
        vaultId: vault.vaultId,
        deviceId: device.deviceId,
        deviceName: options.deviceName.trim(),
        keyEpoch: 1,
        credentialId,
      }),
      home,
    );
  } catch (error) {
    await store.delete(credentialId).catch(() => undefined);
    throw error;
  }
  await client.bootstrap(options.bootstrapToken, {
    vaultId: vault.vaultId,
    deviceId: device.deviceId,
    deviceName: options.deviceName.trim(),
    agreementPublicKey: device.agreementPublicKey,
    signingPublicKey: device.signingPublicKey,
    authorityPublicKey: vault.authorityPublicKey,
    certificate,
  });
}

export async function requestSyncV2Pairing(options: RequestSyncV2PairingOptions): Promise<SyncV2PairRequest> {
  const home = options.home ?? regletHome();
  const serverUrl = requireSecureSyncServerUrl(options.serverUrl);
  if ((await loadSyncV2State(home)) !== null) throw new Error('Encrypted sync is already configured on this device');
  requireDeviceName(options.deviceName);
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const client = new SyncV2Client(serverUrl, options.fetchImpl);
  await client.ensureCompatible();
  const credentialId = pendingSyncV2CredentialId(serverUrl);
  if (
    (await store.get(credentialId)) !== null ||
    (await store.get(activeSyncV2CredentialId(serverUrl))) !== null
  ) {
    throw new Error(
      'Sync credentials exist but local sync state is missing; restore the state file or remove the orphaned operating-system credential before pairing',
    );
  }
  const device = generateSyncV2DeviceKeys();
  const deviceToken = randomBytes(24).toString('base64url');
  const response = await client.requestPairing({
    requestId: randomUUID(),
    deviceTokenHash: createHash('sha256').update(deviceToken).digest('hex'),
    deviceId: device.deviceId,
    deviceName: options.deviceName.trim(),
    agreementPublicKey: device.agreementPublicKey,
    signingPublicKey: device.signingPublicKey,
  });
  if (
    response.deviceId !== device.deviceId ||
    response.deviceName !== options.deviceName.trim() ||
    response.agreementPublicKey !== device.agreementPublicKey ||
    response.signingPublicKey !== device.signingPublicKey
  ) {
    throw new Error('Sync server substituted the pending device identity');
  }
  await savePendingSyncV2Secrets(
    credentialId,
    {
      version: 1,
      requestToken: response.requestToken,
      deviceToken,
      agreementSecretKey: device.agreementSecretKey,
      signingSecretKey: device.signingSecretKey,
    },
    store,
  );
  const request: SyncV2PairRequest = {
    requestId: response.requestId,
    code: response.code,
    deviceId: response.deviceId,
    deviceName: response.deviceName,
    agreementPublicKey: response.agreementPublicKey,
    signingPublicKey: response.signingPublicKey,
    expiresAt: response.expiresAt,
  };
  try {
    await saveSyncV2State({ version: 2, phase: 'pending', serverUrl, credentialId, request }, home);
    return request;
  } catch (error) {
    await store.delete(credentialId).catch(() => undefined);
    throw error;
  }
}

export async function approveSyncV2Pairing(
  options: ApproveSyncV2PairingOptions,
): Promise<{ request: SyncV2PairRequest; sas: string }> {
  const home = options.home ?? regletHome();
  const state = await loadActiveSyncV2State(home);
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const secrets = await loadSyncV2DeviceSecrets(state.credentialId, store);
  requireSecretsMatchState(state.vaultId, state.keyEpoch, secrets.vaultId, secrets.keyEpoch);
  const client = new SyncV2Client(state.serverUrl, options.fetchImpl);
  await client.ensureCompatible();
  const request = await client.inspectPairing(secrets.deviceToken, options.code);
  const approval = createSyncV2PairApproval(
    request,
    {
      deviceId: state.deviceId,
      signingSecretKey: secrets.signingSecretKey,
      signingPublicKey: syncV2SigningPublicKey(secrets.signingSecretKey),
    },
    {
      version: 1,
      vaultId: state.vaultId,
      rootSecret: secrets.rootSecret,
      authoritySecretKey: secrets.authoritySecretKey,
      keyEpoch: state.keyEpoch,
    },
    secrets.authoritySecretKey,
  );
  await client.approvePairing(secrets.deviceToken, options.code, approval);
  return { request, sas: syncV2PairingSas(approval) };
}

export async function pendingSyncV2PairingStatus(options: {
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
} = {}): Promise<PendingSyncV2PairingStatus> {
  const home = options.home ?? regletHome();
  const state = await loadPendingSyncV2State(home);
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const secrets = await loadPendingSyncV2Secrets(state.credentialId, store);
  const client = new SyncV2Client(state.serverUrl, options.fetchImpl);
  const status = await client.pairingStatus(state.request.requestId, secrets.requestToken);
  if (!samePairRequestIdentity(status.request, state.request)) throw new Error('Sync server substituted the pending device identity');
  if (status.approval === null) {
    return { status: status.status, sas: null, deviceName: state.request.deviceName, expiresAt: state.request.expiresAt };
  }
  openSyncV2PairApproval(status.approval, state.request, secrets.agreementSecretKey);
  return {
    status: status.status,
    sas: syncV2PairingSas(status.approval),
    deviceName: state.request.deviceName,
    expiresAt: state.request.expiresAt,
  };
}

export async function completeSyncV2Pairing(options: {
  confirmedSas: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}): Promise<void> {
  const home = options.home ?? regletHome();
  const state = await loadPendingSyncV2State(home);
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const pendingSecrets = await loadPendingSyncV2Secrets(state.credentialId, store);
  const client = new SyncV2Client(state.serverUrl, options.fetchImpl);
  const status = await client.pairingStatus(state.request.requestId, pendingSecrets.requestToken);
  if (status.approval === null || status.status === 'pending') throw new Error('Pairing has not been approved yet');
  if (!samePairRequestIdentity(status.request, state.request)) throw new Error('Sync server substituted the pending device identity');
  const sas = syncV2PairingSas(status.approval);
  if (normalizeSas(options.confirmedSas) !== normalizeSas(sas)) {
    throw new Error('Pairing fingerprint confirmation does not match; no keys were accepted');
  }
  const bundle = openSyncV2PairApproval(status.approval, state.request, pendingSecrets.agreementSecretKey);
  const activeCredentialId = activeSyncV2CredentialId(state.serverUrl);
  await saveSyncV2DeviceSecrets(
    activeCredentialId,
    {
      ...bundle,
      deviceToken: pendingSecrets.deviceToken,
      agreementSecretKey: pendingSecrets.agreementSecretKey,
      signingSecretKey: pendingSecrets.signingSecretKey,
    },
    store,
  );
  try {
    await client.claimPairing(state.request.requestId, pendingSecrets.requestToken);
    await saveSyncV2State(
      newActiveSyncV2State({
        serverUrl: state.serverUrl,
        vaultId: bundle.vaultId,
        deviceId: state.request.deviceId,
        deviceName: state.request.deviceName,
        keyEpoch: bundle.keyEpoch,
        credentialId: activeCredentialId,
      }),
      home,
    );
    await store.delete(state.credentialId);
  } catch (error) {
    // Keep pending credentials/state so an interrupted, idempotent claim can
    // be completed again. The deterministic active credential is overwritten.
    throw error;
  }
}

export async function listManagedSyncV2Devices(options: {
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
} = {}): Promise<SyncV2DevicesResponse> {
  const state = await loadActiveSyncV2State(options.home ?? regletHome());
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const secrets = await loadSyncV2DeviceSecrets(state.credentialId, store);
  const client = new SyncV2Client(state.serverUrl, options.fetchImpl);
  const response = await client.devices(secrets.deviceToken);
  const authorityPublicKey = syncV2AuthorityPublicKey(secrets.authoritySecretKey);
  for (const device of response.devices) validateManagedDevice(device, state.vaultId, authorityPublicKey);
  if (response.currentDeviceId !== state.deviceId) throw new Error('Sync server substituted the current device identity');
  return response;
}

export async function renameManagedSyncV2Device(options: {
  deviceId: string;
  name: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}): Promise<void> {
  const state = await loadActiveSyncV2State(options.home ?? regletHome());
  const secrets = await loadSyncV2DeviceSecrets(
    state.credentialId,
    options.secretStore ?? platformSyncV2SecretStore(),
  );
  await new SyncV2Client(state.serverUrl, options.fetchImpl).renameDevice(
    secrets.deviceToken,
    options.deviceId,
    options.name,
  );
}

export async function revokeManagedSyncV2Device(options: {
  deviceId: string;
  home?: string;
  fetchImpl?: typeof fetch;
  secretStore?: SyncV2SecretStore;
}): Promise<{ keyRotationRequired: true }> {
  const state = await loadActiveSyncV2State(options.home ?? regletHome());
  if (options.deviceId === state.deviceId) throw new Error('Use local logout instead of revoking the current preview device');
  const secrets = await loadSyncV2DeviceSecrets(
    state.credentialId,
    options.secretStore ?? platformSyncV2SecretStore(),
  );
  await new SyncV2Client(state.serverUrl, options.fetchImpl).revokeDevice(secrets.deviceToken, options.deviceId);
  return { keyRotationRequired: true };
}

export async function logoutSyncV2(options: {
  home?: string;
  secretStore?: SyncV2SecretStore;
} = {}): Promise<void> {
  const home = options.home ?? regletHome();
  const state = await loadSyncV2State(home);
  if (state === null) return;
  const store = options.secretStore ?? platformSyncV2SecretStore();
  const credentialIds = new Set([
    state.credentialId,
    activeSyncV2CredentialId(state.serverUrl),
    pendingSyncV2CredentialId(state.serverUrl),
  ]);
  for (const credentialId of credentialIds) await store.delete(credentialId);
  await clearSyncV2State(home);
  await rm(path.join(home, '.state', 'sync-v2-bases'), { recursive: true, force: true });
}

function requireSecretsMatchState(
  stateVaultId: string,
  stateEpoch: number,
  secretVaultId: string,
  secretEpoch: number,
): void {
  if (stateVaultId !== secretVaultId || stateEpoch !== secretEpoch) {
    throw new Error('Sync state does not match the operating system credential store');
  }
}

function validateManagedDevice(device: SyncV2DeviceRecord, vaultId: string, authorityPublicKey: string): void {
  if (
    device.certificate.vaultId !== vaultId ||
    device.certificate.deviceId !== device.deviceId ||
    device.certificate.agreementPublicKey !== device.agreementPublicKey ||
    device.certificate.signingPublicKey !== device.signingPublicKey ||
    !verifySyncV2DeviceCertificate(device.certificate, authorityPublicKey)
  ) {
    throw new Error('Sync server returned an unauthorized device identity');
  }
}

function samePairRequestIdentity(left: SyncV2PairRequest, right: SyncV2PairRequest): boolean {
  return (
    left.requestId === right.requestId &&
    left.deviceId === right.deviceId &&
    left.deviceName === right.deviceName &&
    left.agreementPublicKey === right.agreementPublicKey &&
    left.signingPublicKey === right.signingPublicKey &&
    left.expiresAt === right.expiresAt
  );
}

function requireDeviceName(value: string): void {
  const name = value.trim();
  if (name.length === 0 || name.length > 80 || /[\0-\x1f\x7f]/.test(name)) throw new Error('Device name is invalid');
}

function requireSecret(value: string, label: string): void {
  if (value.length < 20) throw new Error(`${label} is too short`);
}

function normalizeSas(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]/g, '').toUpperCase();
}
