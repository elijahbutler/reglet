import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const maximumLogBytes = 10 * 1024 * 1024;
const retainedLogFiles = 5;
const queues = new Map<string, Promise<void>>();

export function recordRuntimeLog(
  home: string,
  event: string,
  metadata: Record<string, string | number | boolean>,
): void {
  const payload = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: redactRuntimeValue(event),
    ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactRuntimeValue(value) : value,
    ])),
  })}\n`;
  const previous = queues.get(home) ?? Promise.resolve();
  const next = previous.then(() => appendRuntimeLog(home, payload)).catch(() => undefined);
  queues.set(home, next);
}

export function redactRuntimeValue(value: string): string {
  return value
    .replace(/(?:secret|token|password|credential|authorization|api[-_]?key)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s,;]+/g, '[PATH]');
}

async function appendRuntimeLog(home: string, payload: string): Promise<void> {
  const directory = path.join(home, '.state', 'logs');
  const logPath = path.join(directory, 'runtime.log');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const currentBytes = await fileSize(logPath);
  if (currentBytes > 0 && currentBytes + Buffer.byteLength(payload) > maximumLogBytes) {
    await rotateLogs(logPath);
  }
  await appendFile(logPath, payload, { encoding: 'utf8', mode: 0o600 });
}

async function rotateLogs(logPath: string): Promise<void> {
  await rm(`${logPath}.${retainedLogFiles - 1}`, { force: true });
  for (let index = retainedLogFiles - 2; index >= 1; index -= 1) {
    await renameIfPresent(`${logPath}.${index}`, `${logPath}.${index + 1}`);
  }
  await renameIfPresent(logPath, `${logPath}.1`);
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return 0;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
