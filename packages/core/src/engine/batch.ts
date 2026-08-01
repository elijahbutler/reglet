import { sha256String } from '../fsutil.js';
import { allAdapters } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import {
  applyStructuredPreview,
  previewApplyStructured,
  type StructuredApplyPreviewEntry,
} from './preview.js';
import type { ApplyContent } from './apply.js';
import type { OperationReceipt } from './operations.js';

export type ProjectionUnitStatus = 'ready' | 'blocked' | 'applied' | 'failed';

export interface ProjectionUnitPreview {
  key: string;
  provider: ProviderId;
  content: ApplyContent;
  digest: string;
  masterRevision: string;
  status: 'ready' | 'blocked';
  validationIssues: string[];
  entries: StructuredApplyPreviewEntry[];
}

export interface ProjectionBatchPreview {
  version: 1;
  digest: string;
  units: ProjectionUnitPreview[];
}

export interface ProjectionUnitApplyResult {
  key: string;
  provider: ProviderId;
  content: ApplyContent;
  status: 'applied' | 'blocked' | 'failed';
  receipt?: OperationReceipt;
  issues: string[];
}

export interface ProjectionBatchApplyResult {
  version: 1;
  preview: ProjectionBatchPreview;
  units: ProjectionUnitApplyResult[];
  summary: {
    applied: number;
    blocked: number;
    failed: number;
  };
}

export interface ProjectionBatchOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  home?: string;
  unitIssues?: Readonly<Record<string, readonly string[]>>;
}

export interface ApplyProjectionBatchOptions extends ProjectionBatchOptions {
  batchDigest: string;
  unitDigests?: Readonly<Record<string, string>>;
  confirmDrift?: boolean;
  testHooks?: {
    beforeUnit?: (unit: ProjectionUnitPreview) => void | Promise<void>;
  };
}

const defaultContents: ApplyContent[] = ['rules', 'skills', 'mcp'];

export async function previewProjectionBatch(
  options: ProjectionBatchOptions = {},
): Promise<ProjectionBatchPreview> {
  const providers = options.providers ?? allAdapters().map((adapter) => adapter.id);
  const contents = options.contents ?? defaultContents;
  const units: ProjectionUnitPreview[] = [];

  for (const provider of providers) {
    for (const content of contents) {
      const preview = await previewApplyStructured({
        providers: [provider],
        contents: [content],
        home: options.home,
      });
      const key = projectionUnitKey(provider, content);
      const validationIssues = [...preview.validationIssues, ...(options.unitIssues?.[key] ?? [])];
      units.push({
        key,
        provider,
        content,
        digest: validationIssues.length === preview.validationIssues.length
          ? preview.digest
          : sha256String(JSON.stringify({ previewDigest: preview.digest, validationIssues })),
        masterRevision: preview.masterRevision,
        status: validationIssues.length === 0 ? 'ready' : 'blocked',
        validationIssues,
        entries: preview.entries,
      });
    }
  }

  return {
    version: 1,
    digest: batchDigest(units),
    units,
  };
}

export async function applyProjectionBatch(
  options: ApplyProjectionBatchOptions,
): Promise<ProjectionBatchApplyResult> {
  const preview = await previewProjectionBatch(options);
  if (preview.digest !== options.batchDigest) {
    throw new Error(
      `Projection batch is stale: expected ${options.batchDigest}, got ${preview.digest}`,
    );
  }

  for (const unit of preview.units) {
    const expectedUnitDigest = options.unitDigests?.[unit.key];
    if (expectedUnitDigest !== undefined && expectedUnitDigest !== unit.digest) {
      throw new Error(
        `Projection unit is stale: ${unit.key} expected ${expectedUnitDigest}, got ${unit.digest}`,
      );
    }
  }

  const results: ProjectionUnitApplyResult[] = [];
  for (const unit of preview.units) {
    if (unit.status === 'blocked') {
      results.push({
        key: unit.key,
        provider: unit.provider,
        content: unit.content,
        status: 'blocked',
        issues: unit.validationIssues,
      });
      continue;
    }
    const driftedPaths = unit.entries
      .filter((entry) => entry.driftStatus !== 'clean' && entry.driftStatus !== 'unmanaged' && entry.driftStatus !== 'not-applicable')
      .map((entry) => entry.path);
    if (driftedPaths.length > 0 && options.confirmDrift !== true) {
      results.push({
        key: unit.key,
        provider: unit.provider,
        content: unit.content,
        status: 'blocked',
        issues: [`Explicit confirmation is required to replace drift: ${driftedPaths.join(', ')}`],
      });
      continue;
    }
    try {
      await options.testHooks?.beforeUnit?.(unit);
      const applied = await applyStructuredPreview(unit.digest, {
        providers: [unit.provider],
        contents: [unit.content],
        home: options.home,
      });
      results.push({
        key: unit.key,
        provider: unit.provider,
        content: unit.content,
        status: 'applied',
        receipt: applied.receipt,
        issues: [],
      });
    } catch (error) {
      results.push({
        key: unit.key,
        provider: unit.provider,
        content: unit.content,
        status: 'failed',
        issues: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return {
    version: 1,
    preview,
    units: results,
    summary: {
      applied: results.filter((result) => result.status === 'applied').length,
      blocked: results.filter((result) => result.status === 'blocked').length,
      failed: results.filter((result) => result.status === 'failed').length,
    },
  };
}

export function projectionUnitKey(provider: ProviderId, content: ApplyContent): string {
  return `${provider}:${content}`;
}

function batchDigest(units: readonly ProjectionUnitPreview[]): string {
  return sha256String(JSON.stringify({
    version: 1,
    units: units.map((unit) => ({
      key: unit.key,
      digest: unit.digest,
      masterRevision: unit.masterRevision,
    })),
  }));
}
