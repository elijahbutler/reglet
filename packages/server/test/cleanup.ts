import { rm } from 'node:fs/promises';

const WINDOWS_CLEANUP_RETRIES = 10;
const WINDOWS_CLEANUP_RETRY_DELAY_MS = 100;

export async function removeTestDirectory(directory: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!shouldRetryWindowsCleanup(error)) {
        throw error;
      }
      if (attempt >= WINDOWS_CLEANUP_RETRIES) return;
      await delay(WINDOWS_CLEANUP_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

function shouldRetryWindowsCleanup(error: unknown): boolean {
  if (process.platform !== 'win32' || !isNodeError(error)) return false;
  return error.code === 'EBUSY' || error.code === 'ENOTEMPTY' || error.code === 'EPERM';
}

function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
