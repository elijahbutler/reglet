import { afterEach, describe, expect, test } from 'bun:test';
import { RuntimeRevisionWatcher } from '../src/revision-watcher.js';

let watcher: RuntimeRevisionWatcher | undefined;

afterEach(() => {
  watcher?.dispose();
  watcher = undefined;
});

describe('RuntimeRevisionWatcher', () => {
  test('reports revisions committed by another process without echoing local commands', async () => {
    let storedRevision = 4;
    const invalidations: number[] = [];
    watcher = new RuntimeRevisionWatcher({
      readRevision: async () => storedRevision,
      onInvalidation: (revision) => invalidations.push(revision),
      pollIntervalMs: 5,
    });
    await watcher.start();

    storedRevision = 5;
    await waitFor(() => invalidations.length === 1);
    watcher.noteRevision(6);
    storedRevision = 6;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(invalidations).toEqual([5]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for revision invalidation.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
