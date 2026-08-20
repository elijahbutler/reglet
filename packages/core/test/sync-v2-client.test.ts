import { describe, expect, test } from 'bun:test';
import { SyncV2Client } from '../src/index.js';

describe('SyncV2Client request bounds', () => {
  test('aborts a stalled request at the configured timeout', async () => {
    let requestSignal: AbortSignal | null = null;
    const stalledFetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }) as typeof fetch;
    const client = new SyncV2Client('https://sync.example.test', stalledFetch, 10);

    await expect(client.ensureCompatible()).rejects.toThrow('timed out after 10ms');
    expect(requestSignal?.aborted).toBe(true);
  });
});
