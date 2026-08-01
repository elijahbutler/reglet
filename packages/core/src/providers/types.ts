import type { ManagedContent } from '../manifest.js';
import type { McpServerDef } from '../master.js';

export type ProviderId = 'claude' | 'codex' | 'cursor' | 'gemini' | 'windsurf' | 'opencode';

export type ApplyStatus = 'written' | 'skipped' | 'unchanged' | 'blocked' | 'error';

export type ProviderCapability = 'instructions' | 'skills' | 'mcp';
export type DiscoveryArtifactKind = 'instruction' | 'skill' | 'mcp';
export type DiscoveryScope = 'global' | 'project';
export type DiscoveryMatcher = 'exact' | 'basename' | 'directory' | 'extension';

export interface ProviderDiscoveryDeclaration {
  kind: DiscoveryArtifactKind;
  scope: DiscoveryScope;
  format: string;
  matcher: DiscoveryMatcher;
  pattern: string;
  hierarchical?: boolean;
  rootOnly?: boolean;
  trustedOnly?: boolean;
  supported: boolean;
  issue?: string;
}

export interface ProviderCompatibilityFixture {
  capability: ProviderCapability;
  fixture: string;
  expectedSchemaVersion: number;
}

export interface ApplyResult {
  provider: ProviderId;
  content: ManagedContent;
  outputPath: string;
  status: ApplyStatus;
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
  appliedAt?: string;
  message?: string;
  managedKeys?: string[];
  issues?: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
  }>;
}

export interface ApplyContext {
  dryRun: boolean;
  home: string;
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
  compatibilityFixtures: ProviderCompatibilityFixture[];
  configuredDiscoveries?(): Promise<ProviderDiscoveryDeclaration[]>;
  detect(): Promise<boolean>;
  rulesPath(): string | null;
  skillsDir(): string | null;
  mcpPath(): string | null;
  applyMcp(servers: Record<string, McpServerDef>, ctx: ApplyContext): Promise<ApplyResult> | null;
  inventory(): Promise<ProviderInventory>;
}
