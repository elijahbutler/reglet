import type { ProviderId } from '../providers/types.js';

export type ValidationSeverity = 'info' | 'warning' | 'error';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  path?: string;
  field?: string;
}

export interface ProviderCompatibilityResult {
  provider: ProviderId;
  supported: boolean;
  canProject: boolean;
  issues: ValidationIssue[];
}

export interface ArtifactValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  compatibility: ProviderCompatibilityResult[];
}

export interface SecretRef {
  id: string;
  required?: boolean;
}

export type McpServerDefinition =
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
      secretEnv: Record<string, SecretRef>;
    }
  | {
      transport: 'http';
      url: string;
      headers: Record<string, string>;
      secretHeaders: Record<string, SecretRef>;
    };

export interface SecretBindingStatus {
  reference: SecretRef;
  bound: boolean;
}

