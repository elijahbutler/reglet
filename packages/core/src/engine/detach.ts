import { readFile } from 'node:fs/promises';
import { stripGeneratedHeader } from './import.js';
import {
  beginOperation,
  fingerprintOperationPath,
  replacePathFromText,
  type OperationPathFingerprint,
  type OperationReceipt,
} from './operations.js';
import { sha256String } from '../fsutil.js';
import { loadManifest, saveManifest, type ManagedContent, type ManifestOutput } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';

export interface DetachedOutput {
  outputPath: string;
  content: ManagedContent;
  headerRemoved: boolean;
}

export interface DetachResult {
  provider: ProviderId;
  content?: ManagedContent;
  detached: DetachedOutput[];
  receipt: OperationReceipt;
}

export interface DetachManagedContentPreviewTarget {
  path: string;
  content: ManagedContent;
  operation: 'rewrite' | 'detach-only';
  diff: string;
  current: OperationPathFingerprint;
  resulting: OperationPathFingerprint;
}

export interface DetachManagedContentPreview {
  version: 1;
  provider: ProviderId;
  content: ManagedContent;
  digest: string;
  status: 'ready' | 'blocked';
  issues: string[];
  targets: DetachManagedContentPreviewTarget[];
}

export async function previewDetachManagedContent(
  provider: ProviderId,
  content: ManagedContent,
  home = regletHome(),
): Promise<DetachManagedContentPreview> {
  const manifest = await loadManifest(home);
  const selected = Object.entries(manifest.outputs)
    .filter(([, output]) => output.provider === provider && output.content === content)
    .sort(([left], [right]) => left.localeCompare(right));
  const issues: string[] = [];
  const targets: DetachManagedContentPreviewTarget[] = [];
  for (const [outputPath] of selected) {
    const current = await fingerprintOperationPath(outputPath);
    if (content !== 'rules' || current.kind === 'missing') {
      targets.push({ path: outputPath, content, operation: 'detach-only', diff: '', current, resulting: current });
      continue;
    }
    if (current.kind !== 'file') {
      issues.push(`Managed rules output is ${current.kind}, not a file: ${outputPath}`);
      targets.push({ path: outputPath, content, operation: 'detach-only', diff: '', current, resulting: current });
      continue;
    }
    const currentText = await readFile(outputPath, 'utf8');
    const resultingText = stripGeneratedHeader(currentText, provider);
    const resulting = fingerprintText(resultingText);
    targets.push({
      path: outputPath,
      content,
      operation: currentText === resultingText ? 'detach-only' : 'rewrite',
      diff: unifiedTextDiff(currentText, resultingText, outputPath),
      current,
      resulting,
    });
  }
  return {
    version: 1,
    provider,
    content,
    digest: detachDigest(provider, content, selected, targets),
    status: issues.length === 0 ? 'ready' : 'blocked',
    issues,
    targets,
  };
}

export async function detachReviewedManagedContent(
  provider: ProviderId,
  content: ManagedContent,
  digest: string,
  home = regletHome(),
): Promise<DetachResult> {
  const preview = await previewDetachManagedContent(provider, content, home);
  assertReadyDetach(preview);
  if (preview.digest !== digest) {
    throw new Error(`Provider detach preview is stale: expected ${digest}, got ${preview.digest}`);
  }
  return detachManagedContentInternal(provider, content, home, preview.digest);
}

/**
 * Stops managing provider outputs without deleting the provider's current
 * content. Generated rule headers are removed so the remaining file no
 * longer directs tools back to Reglet.
 */
export async function detachManagedContent(
  provider: ProviderId,
  content?: ManagedContent,
  home = regletHome(),
): Promise<DetachResult> {
  return detachManagedContentInternal(provider, content, home);
}

async function detachManagedContentInternal(
  provider: ProviderId,
  content: ManagedContent | undefined,
  home: string,
  expectedDigest?: string,
): Promise<DetachResult> {
  const operation = await beginOperation({
    home,
    providers: [provider],
    ...(content === undefined ? {} : { contents: [content] }),
    restorePolicy: {
      allowed: false,
      reason: 'Use start managing, then review and apply the current canonical projection.',
    },
  });

  try {
    if (expectedDigest !== undefined && content !== undefined) {
      const currentPreview = await previewDetachManagedContent(provider, content, home);
      assertReadyDetach(currentPreview);
      if (currentPreview.digest !== expectedDigest) {
        throw new Error('Provider detach preview became stale before detachment started.');
      }
    }
    const manifest = await loadManifest(home);
    const detached: DetachedOutput[] = [];
    const matches = Object.entries(manifest.outputs)
      .filter(([, output]) => output.provider === provider && (content === undefined || output.content === content))
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [outputPath, output] of matches) {
      let headerRemoved = false;
      if (output.content === 'rules') {
        const current = await readOptionalFile(outputPath);
        if (current !== null) {
          const detachedContent = stripGeneratedHeader(current, provider);
          if (detachedContent !== current) {
            await operation.snapshotTarget(outputPath);
            await replacePathFromText(detachedContent, outputPath);
            headerRemoved = true;
          }
        }
      }

      delete manifest.outputs[outputPath];
      detached.push({ outputPath, content: output.content, headerRemoved });
    }

    await saveManifest(manifest, home);
    return { provider, ...(content === undefined ? {} : { content }), detached, receipt: await operation.complete() };
  } catch (error) {
    await operation.rollback(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function assertReadyDetach(preview: DetachManagedContentPreview): void {
  if (preview.status === 'blocked') throw new Error(preview.issues.join('; '));
}

function detachDigest(
  provider: ProviderId,
  content: ManagedContent,
  selected: Array<[string, ManifestOutput]>,
  targets: DetachManagedContentPreviewTarget[],
): string {
  return sha256String(JSON.stringify({
    version: 1,
    provider,
    content,
    outputs: selected.map(([outputPath, output]) => ({ outputPath, output })),
    targets,
  }));
}

function fingerprintText(content: string): OperationPathFingerprint {
  return { kind: 'file', hash: sha256String(content), size: Buffer.byteLength(content) };
}

function unifiedTextDiff(before: string, after: string, label: string): string {
  if (before === after) return '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines = [`--- ${label}`, `+++ ${label}`];
  for (const line of beforeLines) if (!afterLines.includes(line)) lines.push(`-${line}`);
  for (const line of afterLines) if (!beforeLines.includes(line)) lines.push(`+${line}`);
  return `${lines.join('\n')}\n`;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
