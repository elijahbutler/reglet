import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFileEnsuringDir(filePath: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256String(await readFile(filePath));
}

export function sha256String(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function copyDirRecursive(sourceDir: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
      continue;
    }

    const sourceStats = await stat(sourcePath);
    if (sourceStats.isFile()) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    }
  }
}
