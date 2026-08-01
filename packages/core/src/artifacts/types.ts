import type { ProviderId } from '../providers/types.js';

export type ArtifactId = string;
export type ArtifactKind = 'instruction' | 'skill' | 'mcp';
export type ArtifactLifecycle = 'active' | 'archived';

export type ArtifactScope =
  | { kind: 'global' }
  | { kind: 'provider-overlay'; provider: ProviderId };

export interface FileArtifactLocator {
  type: 'file';
  path: string;
}

export interface DirectoryArtifactLocator {
  type: 'directory';
  path: string;
}

export interface McpArtifactLocator {
  type: 'mcp-server';
  path: string;
  serverName: string;
}

export type ArtifactLocator = FileArtifactLocator | DirectoryArtifactLocator | McpArtifactLocator;

export interface LibraryArtifactMetadata {
  id: ArtifactId;
  kind: ArtifactKind;
  lifecycle: ArtifactLifecycle;
  scope: ArtifactScope;
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  targets: ProviderId[];
  locator: ArtifactLocator;
}

export interface DeletedArtifactTombstone {
  id: ArtifactId;
  kind: ArtifactKind;
  slug: string;
  deletedAt: string;
  recoverableUntil: string;
  locator: ArtifactLocator;
  historyRevision?: string;
}

export interface LibraryManifest {
  schemaVersion: 2;
  artifacts: LibraryArtifactMetadata[];
  tombstones: DeletedArtifactTombstone[];
}

export interface ArtifactDraft {
  artifactId: ArtifactId;
  content: string;
  updatedAt: string;
  validationIssues: DraftValidationIssue[];
}

export interface DraftValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ArtifactHistoryRevision {
  revision: string;
  artifactId: ArtifactId;
  createdAt: string;
  reason: 'edit' | 'rename' | 'archive' | 'delete' | 'restore';
  objectPath: string;
  locator: ArtifactLocator;
  metadata?: LibraryArtifactMetadata;
}

export interface ArtifactHistoryIndex {
  artifactId: ArtifactId;
  revisions: ArtifactHistoryRevision[];
}

export interface LibraryMigrationInventoryItem {
  artifact: LibraryArtifactMetadata;
  sourceExists: boolean;
}

export interface LibraryMigrationPreview {
  version: 1;
  migration: 'library-v2';
  required: boolean;
  digest: string;
  manifestPath: string;
  artifacts: LibraryMigrationInventoryItem[];
}

export interface LibraryMigrationReceipt {
  version: 1;
  id: string;
  migration: 'library-v2';
  digest: string;
  appliedAt: string;
  manifestPath: string;
  manifestBackupPath: string | null;
  metadataBackupPath: string | null;
  createdManifest: boolean;
  artifactCount: number;
  reversible: true;
}

export interface LibraryMigrationStatus {
  state: 'not-needed' | 'available' | 'applied';
  artifactCount: number;
  receipt?: LibraryMigrationReceipt;
}

export const artifactSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
