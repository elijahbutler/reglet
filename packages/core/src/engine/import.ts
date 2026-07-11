import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_HEADER } from '../header.js';
import { loadManifest } from '../manifest.js';
import { regletHome } from '../paths.js';
import type { ProviderId } from '../providers/types.js';

export interface ImportRulesResult {
  provider: ProviderId;
  sourcePath: string;
  importedPath: string;
}

export async function importDriftedRules(
  provider: ProviderId,
  home = regletHome(),
  date = new Date(),
): Promise<ImportRulesResult> {
  const manifest = await loadManifest(home);
  const match = Object.entries(manifest.outputs).find(
    ([, output]) => output.provider === provider && output.content === 'rules',
  );
  if (match === undefined) {
    throw new Error(`No managed rules output found for ${provider}`);
  }

  const [sourcePath] = match;
  const content = stripGeneratedHeader(await readFile(sourcePath, 'utf8'), provider);
  const importedPath = path.join(home, 'rules', `imported-${provider}-${formatDate(date)}.md`);
  await mkdir(path.dirname(importedPath), { recursive: true });
  await writeFile(importedPath, content);

  return { provider, sourcePath, importedPath };
}

export function stripGeneratedHeader(content: string, provider: ProviderId): string {
  const renderedHeader = GENERATED_HEADER.replace('<provider>', provider);
  if (content.startsWith(renderedHeader)) {
    return content.slice(renderedHeader.length).replace(/^\r?\n+/, '');
  }
  return content;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
