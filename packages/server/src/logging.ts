import {
  appendFile,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

const defaultMaxBytes = 10 * 1024 * 1024;
const defaultFileCount = 5;
const queues = new Map<string, Promise<void>>();

export interface RuntimeLogOptions {
  maxBytes?: number;
  fileCount?: number;
}

export function recordRuntimeLog(
  home: string,
  event: string,
  metadata: Record<string, string | number | boolean>,
): void {
  const payload = runtimeLogPayload(event, metadata);
  console.error(payload.trimEnd());
  const previous = queues.get(home) ?? Promise.resolve();
  const next = previous
    .then(() => appendRuntimeLog(home, payload))
    .catch(() => undefined);
  queues.set(home, next);
}

export async function appendRuntimeLog(
  home: string,
  payload: string,
  options: RuntimeLogOptions = {},
): Promise<void> {
  const directory = path.join(home, '.state', 'logs');
  const logPath = path.join(directory, 'runtime.log');
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const fileCount = Math.max(1, options.fileCount ?? defaultFileCount);
  await mkdir(directory, { recursive: true });
  const currentBytes = await fileSize(logPath);
  if (
    currentBytes > 0 &&
    currentBytes + Buffer.byteLength(payload) > maxBytes
  ) {
    await rotateLogs(logPath, fileCount);
  }
  await appendFile(logPath, payload, { encoding: 'utf8', mode: 0o600 });
}

export function runtimeLogPayload(
  event: string,
  metadata: Record<string, string | number | boolean>,
): string {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: redactLogValue(event),
    ...Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactLogValue(value) : value,
      ]),
    ),
  })}\n`;
}

export function redactLogValue(value: string): string {
  return value
    .replace(
      /(?:secret|token|password|credential|authorization|api[-_]?key)\s*[=:]\s*[^\s,;]+/gi,
      '[REDACTED]',
    )
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s,;]+/g, '[PATH]');
}

async function rotateLogs(logPath: string, fileCount: number): Promise<void> {
  if (fileCount === 1) {
    await rm(logPath, { force: true });
    return;
  }
  await rm(`${logPath}.${fileCount - 1}`, { force: true });
  for (let index = fileCount - 2; index >= 1; index -= 1) {
    await renameIfPresent(`${logPath}.${index}`, `${logPath}.${index + 1}`);
  }
  await renameIfPresent(logPath, `${logPath}.1`);
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
