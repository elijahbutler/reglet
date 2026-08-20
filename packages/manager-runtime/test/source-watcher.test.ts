import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { getAdapter } from '@reglet/core';
import { ManagedSourceWatcher, sourceWatchPaths } from '../src/source-watcher.js';

let root: string | undefined;
let watcher: ManagedSourceWatcher | undefined;

afterEach(async () => {
  await watcher?.dispose();
  watcher = undefined;
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('ManagedSourceWatcher', () => {
  test('watches the canonical library and exact provider sources', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reglet-source-watcher-'));
    const home = path.join(root, 'reglet');
    const providerRoot = path.join(root, 'providers');
    const canonicalRule = path.join(home, 'rules', 'shared.md');
    const providerRule = getAdapter('codex').rulesPath(providerRoot);
    if (providerRule === null) throw new Error('Codex rules path is unavailable.');
    await mkdir(path.dirname(canonicalRule), { recursive: true });
    await mkdir(path.dirname(providerRule), { recursive: true });
    await writeFile(canonicalRule, '# Shared\n');
    await writeFile(providerRule, '# Codex\n');

    let invalidations = 0;
    watcher = new ManagedSourceWatcher({
      home,
      providerRoot,
      debounceMs: 10,
      onInvalidation: () => { invalidations += 1; },
    });
    await watcher.start();

    await writeFile(canonicalRule, '# Shared changed\n');
    await waitFor(() => invalidations === 1);
    await writeFile(providerRule, '# Codex changed\n');
    await waitFor(() => invalidations === 2);

    expect(watcher.isReady()).toBe(true);
    expect(sourceWatchPaths(home, providerRoot)).toContain(providerRule);
    expect(sourceWatchPaths(home, providerRoot)).toContain(path.join(providerRoot, '.codex', 'AGENTS.override.md'));
  });

  test('ignores Reglet internal state churn', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reglet-source-watcher-'));
    const home = path.join(root, 'reglet');
    const providerRoot = path.join(root, 'providers');
    const stateFile = path.join(home, '.state', 'runtime.log');
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, 'before\n');

    let invalidations = 0;
    watcher = new ManagedSourceWatcher({
      home,
      providerRoot,
      debounceMs: 10,
      onInvalidation: () => { invalidations += 1; },
    });
    await watcher.start();
    await writeFile(stateFile, 'after\n');
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(invalidations).toBe(0);
  });

  test('retries a rejected source invalidation without another filesystem event', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reglet-source-watcher-'));
    const home = path.join(root, 'reglet');
    const providerRoot = path.join(root, 'providers');
    const canonicalRule = path.join(home, 'rules', 'shared.md');
    await mkdir(path.dirname(canonicalRule), { recursive: true });
    await writeFile(canonicalRule, '# Shared\n');

    let attempts = 0;
    watcher = new ManagedSourceWatcher({
      home,
      providerRoot,
      debounceMs: 10,
      onInvalidation: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary database lock');
      },
    });
    await watcher.start();
    await writeFile(canonicalRule, '# Shared changed\n');

    await waitFor(() => attempts === 2);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for source invalidation.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
