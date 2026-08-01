import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  appendRuntimeLog,
  runtimeLogPayload,
} from '../src/logging.js';

let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe('runtime logging', () => {
  test('redacts secret-shaped values and user paths', () => {
    const payload = runtimeLogPayload('request-error', {
      message: 'token=top-secret /Users/example/private/file',
    });
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('[PATH]');
    expect(payload).not.toContain('top-secret');
    expect(payload).not.toContain('/Users/example');
  });

  test('rotates a bounded set of restrictive structured log files', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'reglet-logs-'));
    await mkdir(path.join(directory, '.state'), { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      await appendRuntimeLog(
        directory,
        `${JSON.stringify({ index, message: 'bounded' })}\n`,
        { maxBytes: 35, fileCount: 5 },
      );
    }
    const logDirectory = path.join(directory, '.state', 'logs');
    const files = await readdir(logDirectory);
    expect(files.length).toBeLessThanOrEqual(5);
    expect(await readFile(path.join(logDirectory, 'runtime.log'), 'utf8')).toContain(
      '"index":7',
    );
  });
});
