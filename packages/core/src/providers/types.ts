import type { ManagedContent } from '../manifest.js';
import type { ResolvedMcpServerDef } from '../master.js';
import type { OperationContext } from '../engine/operations.js';

export type ProviderId = 'claude' | 'codex' | 'cursor' | 'gemini' | 'windsurf' | 'opencode';

export type ApplyStatus = 'written' | 'skipped' | 'unchanged';

export type ProviderCapability = 'instructions' | 'skills' | 'mcp';
export type DiscoveryArtifactKind = 'instruction' | 'skill' | 'mcp';
export type DiscoveryScope = 'global' | 'project';
export type DiscoveryMatcher = 'exact' | 'basename' | 'extension' | 'directory';

export interface ProviderDiscoveryDeclaration {
  kind: DiscoveryArtifactKind;
  scope: DiscoveryScope;
  format: string;
  pattern: string;
  matcher: DiscoveryMatcher;
  hierarchical?: boolean;
  rootOnly?: boolean;
  trustedOnly?: boolean;
  supported: boolean;
  issue?: string;
}

export interface CompatibilityFixture {
  capability: ProviderCapability;
  fixture: string;
  expectedSchemaVersion: number;
}

export interface ApplyResult {
  provider: ProviderId;
  content: ManagedContent;
  outputPath: string;
  status: ApplyStatus;
  message?: string;
  managedKeys?: string[];
}

export interface ApplyContext {
  dryRun: boolean;
  home?: string;
  providerHome?: string;
  operation?: OperationContext;
  masterRevision?: string;
  compositionRevision?: string;
}

export interface ProviderInventory {
  rulesPath: string | null;
  rulesExists: boolean;
  skillsDir: string | null;
  skills: string[];
  mcpPath: string | null;
  mcpServers: string[];
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  documentationUrl: string;
  lastVerifiedAt: string;
  schemaVersion: number;
  discoveries: ProviderDiscoveryDeclaration[];
  compatibilityFixtures: CompatibilityFixture[];
  configuredDiscoveries?(): Promise<ProviderDiscoveryDeclaration[]>;
  detect(): Promise<boolean>;
  rulesPath(providerHome?: string): string | null;
  skillsDir(providerHome?: string): string | null;
  mcpPath(providerHome?: string): string | null;
  applyMcp(servers: Record<string, ResolvedMcpServerDef>, ctx: ApplyContext): Promise<ApplyResult> | null;
  inventory(): Promise<ProviderInventory>;
}
