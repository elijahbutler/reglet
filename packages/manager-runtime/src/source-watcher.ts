import path from 'node:path';
import { allAdapters, providerHome } from '@reglet/core';
import { watch, type FSWatcher } from 'chokidar';

export interface ManagedSourceWatcherOptions {
  home: string;
  providerRoot?: string;
  debounceMs?: number;
  onInvalidation: () => void | Promise<void>;
}

/** Watches the canonical library and exact global provider paths for direct edits. */
export class ManagedSourceWatcher {
  private readonly options: ManagedSourceWatcherOptions;
  private readonly debounceMs: number;
  private watchers: FSWatcher[] = [];
  private startPromise: Promise<void> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private disposed = false;

  constructor(options: ManagedSourceWatcherOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? 250;
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    this.startPromise ??= this.startWatching();
    await this.startPromise;
  }

  private async startWatching(): Promise<void> {
    const [canonicalPath, ...providerPaths] = sourceWatchPaths(this.options.home, this.options.providerRoot);
    if (canonicalPath === undefined) return;
    const commonOptions = {
      ignoreInitial: true,
      persistent: false,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 20,
      },
    } as const;
    const canonicalWatcher = watch(canonicalPath, {
      ...commonOptions,
      ignored: (watchPath) => isIgnoredCanonicalPath(this.options.home, watchPath),
    });
    const providerWatcher = watch(providerPaths, commonOptions);
    this.watchers = [canonicalWatcher, providerWatcher];
    for (const watcher of this.watchers) {
      watcher.on('all', () => this.schedule());
      watcher.on('error', () => { this.ready = false; });
    }
    const readiness = await Promise.all(this.watchers.map(waitUntilReady));
    this.ready = readiness.every(Boolean);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.debounce = undefined;
    const watchers = this.watchers;
    this.watchers = [];
    await Promise.all(watchers.map((watcher) => watcher.close()));
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void Promise.resolve(this.options.onInvalidation()).catch(() => {
        // A later filesystem event can recover from a transient database lock.
      });
    }, this.debounceMs);
    this.debounce.unref?.();
  }
}

function waitUntilReady(watcher: FSWatcher): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    watcher.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve(true);
    });
    watcher.once('error', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
  });
}

export function sourceWatchPaths(home: string, providerRoot = providerHome()): string[] {
  const paths = [home];
  for (const adapter of allAdapters()) {
    const candidates = [
      adapter.rulesPath(providerRoot),
      adapter.skillsDir(providerRoot),
      adapter.mcpPath(providerRoot),
    ];
    for (const candidate of candidates) if (candidate !== null) paths.push(candidate);
    if (adapter.id === 'codex') {
      const rulesPath = adapter.rulesPath(providerRoot);
      if (rulesPath !== null) paths.push(path.join(path.dirname(rulesPath), 'AGENTS.override.md'));
    }
  }
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

function isIgnoredCanonicalPath(home: string, watchPath: string): boolean {
  const relative = path.relative(path.resolve(home), path.resolve(watchPath));
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const [topLevel] = relative.split(path.sep);
  return topLevel === '.state';
}
