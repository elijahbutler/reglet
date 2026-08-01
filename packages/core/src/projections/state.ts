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

export type ProjectionIssueCode =
  | 'shadowed'
  | 'missing-secret'
  | 'lossy-conversion'
  | 'provider-limit'
  | 'invalid-source'
  | 'permission-denied'
  | 'unsupported-field';

export interface ProjectionIssue {
  code: ProjectionIssueCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
  documentationUrl?: string;
}

export interface ProjectionHashes {
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
}

export interface ProjectionStateInput extends ProjectionHashes {
  targeted: boolean;
  supported: boolean;
  outputExists: boolean;
  blocked?: boolean;
  operationError?: boolean;
}

export interface ArtifactProjectionState extends ProjectionHashes {
  provider: ProviderId;
  status: ProjectionStatus;
  issues: ProjectionIssue[];
  destinationPath?: string;
  appliedAt?: string;
}

/**
 * Derives the primary projection status without allowing a pending canonical
 * edit to hide external drift. Operation errors and render blockers take
 * precedence because no safe filesystem comparison can repair them.
 */
export function deriveProjectionStatus(input: ProjectionStateInput): ProjectionStatus {
  if (!input.targeted) {
    return 'not-targeted';
  }
  if (!input.supported) {
    return 'unsupported';
  }
  if (input.operationError === true) {
    return 'error';
  }
  if (input.blocked === true) {
    return 'blocked';
  }

  const wasApplied = input.appliedHash !== undefined;
  if (wasApplied && !input.outputExists) {
    return 'missing';
  }

  if (
    wasApplied &&
    input.outputExists &&
    input.observedHash !== undefined &&
    input.observedHash !== input.appliedHash
  ) {
    return 'drifted';
  }

  if (input.desiredHash !== input.appliedHash) {
    return 'pending';
  }

  if (
    input.desiredHash !== undefined &&
    input.desiredHash === input.appliedHash &&
    input.observedHash === input.appliedHash
  ) {
    return 'applied';
  }

  return 'pending';
}

export function hasBlockingProjectionIssue(issues: ProjectionIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

