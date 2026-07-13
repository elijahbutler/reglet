import { readFile } from 'node:fs/promises';
import { stripGeneratedHeader } from './import.js';
import { beginOperation, replacePathFromText, type OperationReceipt } from './operations.js';
import { loadManifest, saveManifest, type ManagedContent } from '../manifest.js';
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
  const operation = await beginOperation({
    home,
    providers: [provider],
    ...(content === undefined ? {} : { contents: [content] }),
  });

  try {
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

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
