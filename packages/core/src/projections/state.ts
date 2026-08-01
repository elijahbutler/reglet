import type { ProviderId } from '../providers/types.js';

export type ProjectionStatus =
  | 'not-targeted'
  | 'unsupported'
  | 'pending'
  | 'applied'
  | 'drifted'
  | 'missing'
  | 'blocked'
  | 'error';

export interface ProjectionIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  documentationUrl?: string;
}

export interface ArtifactProjectionState {
  artifactId: string;
  provider: ProviderId;
  status: ProjectionStatus;
  destinationPath?: string;
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
  appliedRevision?: string;
  appliedAt?: string;
  issues: ProjectionIssue[];
}

export interface ProjectionStateInput {
  targeted: boolean;
  supported: boolean;
  outputExists: boolean;
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
  blocked?: boolean;
  operationError?: boolean;
}

/** External drift takes precedence over pending canonical edits. */
export function deriveProjectionStatus(input: ProjectionStateInput): ProjectionStatus {
  if (!input.targeted) return 'not-targeted';
  if (!input.supported) return 'unsupported';
  if (input.operationError === true) return 'error';
  if (input.blocked === true) return 'blocked';
  if (input.appliedHash !== undefined && !input.outputExists) return 'missing';
  if (
    input.appliedHash !== undefined &&
    input.outputExists &&
    input.observedHash !== undefined &&
    input.observedHash !== input.appliedHash
  ) {
    return 'drifted';
  }
  if (input.desiredHash !== input.appliedHash) return 'pending';
  if (
    input.desiredHash !== undefined &&
    input.desiredHash === input.appliedHash &&
    input.observedHash === input.appliedHash
  ) {
    return 'applied';
  }
  return 'pending';
}

export function hasBlockingProjectionIssue(issues: readonly ProjectionIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
