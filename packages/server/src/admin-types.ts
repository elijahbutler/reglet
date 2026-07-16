export interface AdminSession {
  ownerId: number;
  userId: number;
  email: string;
  expiresAt: string;
}

export interface ConnectionGrant {
  id: string;
  kind: 'bootstrap' | 'pair';
  status: 'open' | 'pending' | 'approved' | 'cancelled' | 'claimed';
  connectUrl: string;
  fingerprint: string | null;
  expiresAt: string;
}

export interface PendingConnection {
  id: string;
  kind: 'bootstrap' | 'pair';
  status: 'pending' | 'approved';
  deviceName: string;
  fingerprint: string;
  inviterDeviceId: string | null;
  expiresAt: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  current: boolean;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface BackupSummary {
  name: string;
  createdAt: string;
  sizeBytes: number;
  verification: 'verified' | 'failed';
}

export interface HostCapabilities {
  ownerDashboard: true;
  connectionGrants: true;
  pairingInvitations: true;
  serverBackups: boolean;
  liveIntegrityCheck: boolean;
  liveRestore: false;
  backgroundSync: false;
}

export interface AdminOverview {
  service: { name: 'reglet-sync-server'; version: string };
  schema: { current: number; supported: number; ready: boolean };
  vault: { initialized: boolean; activeDevices: number; pendingConnections: number };
  capabilities: HostCapabilities;
}
