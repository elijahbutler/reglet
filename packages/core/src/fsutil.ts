import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFileEnsuringDir(filePath: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

export async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
  if (hasPosixModes()) {
    await chmod(dirPath, 0o700);
    await assertMode(dirPath, 0o700);
  }
}

export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateDir(path.dirname(filePath));
  const stagePath = `${filePath}.reglet-stage-${randomUUID()}`;
  try {
    await writeFile(stagePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    if (hasPosixModes()) {
      await chmod(stagePath, 0o600);
      await assertMode(stagePath, 0o600);
    }
    await rename(stagePath, filePath);
    if (hasPosixModes()) {
      await assertMode(filePath, 0o600);
    }
  } finally {
    await rm(stagePath, { force: true });
  }
}

export async function assertPrivateFile(filePath: string): Promise<void> {
  if (hasPosixModes()) {
    await assertMode(filePath, 0o600);
  }
}

export function hasPosixModes(): boolean {
  return process.platform !== 'win32';
}

async function assertMode(targetPath: string, expected: number): Promise<void> {
  const actual = (await stat(targetPath)).mode & 0o777;
  if (actual !== expected) {
    throw new Error(`Refusing to use insecure private state permissions for ${targetPath}: expected ${expected.toString(8)}, got ${actual.toString(8)}`);
  }
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
