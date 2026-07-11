import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { providerHome } from '../paths.js';
import type { ProviderInventory } from './types.js';

export function providerPath(...parts: string[]): string {
  return path.join(providerHome(), ...parts);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function detectDir(...parts: string[]): Promise<boolean> {
  const targetPath = providerPath(...parts);
  try {
    return (await stat(targetPath)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function listChildDirs(dirPath: string | null): Promise<string[]> {
  if (dirPath === null) {
    return [];
  }

  try {
    return (await readdir(dirPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function inventoryFor(
  rulesPath: string | null,
  skillsDir: string | null,
  mcpPath: string | null,
  mcpServers: string[],
): Promise<ProviderInventory> {
  return {
    rulesPath,
    rulesExists: rulesPath === null ? false : await pathExists(rulesPath),
    skillsDir,
    skills: await listChildDirs(skillsDir),
    mcpPath,
    mcpServers,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
