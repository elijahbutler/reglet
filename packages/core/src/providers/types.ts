import type { ManagedContent } from '../manifest.js';
import type { ResolvedMcpServerDef } from '../master.js';
import type { OperationContext } from '../engine/operations.js';

export type ProviderId = 'claude' | 'codex' | 'cursor' | 'gemini' | 'windsurf' | 'opencode';

export type ApplyStatus = 'written' | 'skipped' | 'unchanged';

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
  operation?: OperationContext;
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
  detect(): Promise<boolean>;
  rulesPath(): string | null;
  skillsDir(): string | null;
  mcpPath(): string | null;
  applyMcp(servers: Record<string, ResolvedMcpServerDef>, ctx: ApplyContext): Promise<ApplyResult> | null;
  inventory(): Promise<ProviderInventory>;
}
