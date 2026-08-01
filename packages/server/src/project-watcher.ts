import { access } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import {
  LocalState,
  RegletApplication,
  codexConfiguredProjectDiscoveries,
  type ApplicationCommandResult,
  type ProjectRootRecord,
} from '@reglet/core';

export interface ProjectWatcherOptions {
  home: string;
  application: RegletApplication;
  debounceMs?: number;
  onInvalidation?: (revision: number) => void;
}

interface WatchedRoot {
  record: ProjectRootRecord;
  watcher: FSWatcher;
  debounce?: ReturnType<typeof setTimeout>;
}

/**
 * Watches configured development roots without reading project content itself.
 * Relevant events are coalesced per repository, then routed through the same
 * serialized application command used by the CLI and manager.
 */
export class ProjectRootWatcher {
  private readonly home: string;
  private readonly application: RegletApplication;
  private readonly debounceMs: number;
  private readonly onInvalidation?: (revision: number) => void;
  private readonly roots = new Map<string, WatchedRoot>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private ready = false;
  private disposed = false;
  private fallbackInstructionNames = new Set<string>();
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(options: ProjectWatcherOptions) {
    this.home = options.home;
    this.application = options.application;
    this.debounceMs = options.debounceMs ?? 350;
    this.onInvalidation = options.onInvalidation;
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    try {
      await access(this.home);
    } catch {
      this.ready = false;
      return;
    }
    await this.refresh();
    if (this.disposed) return;
    this.heartbeat = setInterval(() => {
      void this.persistStatus();
    }, 10_000);
    this.heartbeat.unref?.();
  }

  refresh(): Promise<void> {
    this.refreshQueue = this.refreshQueue.then(
      () => this.refreshNow(),
      () => this.refreshNow(),
    );
    return this.refreshQueue;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    for (const watched of this.roots.values()) {
      if (watched.debounce !== undefined) clearTimeout(watched.debounce);
      watched.watcher.close();
    }
    this.roots.clear();
    await this.persistStatus('Project watcher stopped.');
  }

  private async refreshNow(): Promise<void> {
    if (this.disposed) return;
    const state = await LocalState.open(this.home);
    const configuredRoots = state.listProjectRoots();
    state.close();
    this.fallbackInstructionNames = new Set(
      (await codexConfiguredProjectDiscoveries()).map(
        (declaration) => declaration.pattern,
      ),
    );
    const configuredIds = new Set(configuredRoots.map((root) => root.id));

    for (const [rootId, watched] of this.roots) {
      const current = configuredRoots.find((root) => root.id === rootId);
      if (current !== undefined && current.path === watched.record.path) continue;
      if (watched.debounce !== undefined) clearTimeout(watched.debounce);
      watched.watcher.close();
      this.roots.delete(rootId);
    }

    let failureCount = 0;
    for (const root of configuredRoots) {
      if (this.roots.has(root.id)) continue;
      try {
        const watcher = watch(
          root.path,
          { recursive: true, persistent: false },
          (_eventType, filename) => {
            const relativePath = normalizeFilename(filename);
            if (
              relativePath === undefined ||
              !isRelevantProjectPath(relativePath, this.fallbackInstructionNames)
            ) {
              return;
            }
            this.scheduleScan(root.id);
          },
        );
        watcher.on('error', () => {
          this.ready = false;
          void this.persistStatus('A development root watcher reported an error.');
        });
        watcher.unref?.();
        this.roots.set(root.id, { record: root, watcher });
      } catch {
        failureCount += 1;
      }
    }

    for (const rootId of this.roots.keys()) {
      if (!configuredIds.has(rootId)) this.roots.delete(rootId);
    }
    this.ready = failureCount === 0;
    await this.persistStatus(
      failureCount === 0
        ? `${this.roots.size} development ${this.roots.size === 1 ? 'root is' : 'roots are'} watched with per-repository event coalescing.`
        : `${failureCount} development ${failureCount === 1 ? 'root could' : 'roots could'} not be watched.`,
    );
  }

  private scheduleScan(rootId: string): void {
    const watched = this.roots.get(rootId);
    if (watched === undefined || this.disposed) return;
    if (watched.debounce !== undefined) clearTimeout(watched.debounce);
    watched.debounce = setTimeout(() => {
      watched.debounce = undefined;
      void this.scan(rootId);
    }, this.debounceMs);
    watched.debounce.unref?.();
  }

  private async scan(rootId: string): Promise<void> {
    if (this.disposed || !this.roots.has(rootId)) return;
    try {
      const result: ApplicationCommandResult = await this.application.execute({
        type: 'project.scan',
        rootId,
        reappearChangedIgnored: true,
      });
      this.ready = true;
      this.onInvalidation?.(result.revision);
      await this.persistStatus();
    } catch {
      this.ready = false;
      await this.persistStatus('A coalesced project rescan failed.');
    }
  }

  private async persistStatus(detail?: string): Promise<void> {
    try {
      const state = await LocalState.open(this.home);
      state.setSetting('watcher.mode', 'filesystem-events');
      state.setSetting('watcher.ready', String(this.ready));
      state.setSetting('watcher.root-count', String(this.roots.size));
      state.setSetting('watcher.heartbeat-at', new Date().toISOString());
      state.setSetting(
        'watcher.detail',
        detail ??
          `${this.roots.size} development ${this.roots.size === 1 ? 'root is' : 'roots are'} watched with per-repository event coalescing.`,
      );
      state.close();
    } catch {
      this.ready = false;
    }
  }
}

function normalizeFilename(filename: string | Buffer | null): string | undefined {
  if (filename === null) return undefined;
  const value = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename;
  const normalized = value.split(path.sep).join('/').replace(/^\.\//, '');
  return normalized.length > 0 ? normalized : undefined;
}

export function isRelevantProjectPath(
  relativePath: string,
  fallbackInstructionNames: ReadonlySet<string> = new Set(),
): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  if (
    /(^|\/)(?:\.git|node_modules|\.next|dist|build|coverage)(\/|$)/.test(
      normalized,
    )
  ) {
    return false;
  }
  const basename = path.posix.basename(normalized);
  if (fallbackInstructionNames.has(basename)) return true;
  if (
    /^(?:AGENTS(?:\.override)?\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.mcp\.json|opencode\.jsonc?)$/.test(
      basename,
    )
  ) {
    return true;
  }
  return (
    /(^|\/)\.(?:agents|claude|opencode)\/skills(\/|$)/.test(normalized) ||
    /(^|\/)\.cursor\/rules\/.*\.mdc$/.test(normalized) ||
    /(^|\/)\.windsurf\/rules\/.*\.md$/.test(normalized) ||
    /(^|\/)\.(?:codex)\/config\.toml$/.test(normalized) ||
    /(^|\/)\.(?:cursor)\/mcp\.json$/.test(normalized) ||
    /(^|\/)\.gemini\/settings\.json$/.test(normalized)
  );
}
