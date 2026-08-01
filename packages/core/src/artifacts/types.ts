import type { ProviderId } from '../providers/types.js';

export type ArtifactId = string;
export type ArtifactKind = 'instruction' | 'skill' | 'mcp';
export type ArtifactLifecycle = 'active' | 'archived';

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

export type ArtifactLocator =
  | FileArtifactLocator
  | DirectoryArtifactLocator
  | McpArtifactLocator;

export interface LibraryArtifactMetadata {
  id: ArtifactId;
  kind: ArtifactKind;
  lifecycle: ArtifactLifecycle;
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

export const artifactSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
