import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { LocalState, type ProjectRootRecord } from '@reglet/core';
import { RegletApplication } from '@reglet/manager-application';

interface WatchedRoot {
  record: ProjectRootRecord;
  watcher: FSWatcher;
  debounce?: ReturnType<typeof setTimeout>;
}

export interface ProjectRootWatcherOptions {
  home: string;
  application: RegletApplication;
  debounceMs?: number;
  onInvalidation?: (revision: number) => void;
}

/** Coalesces relevant filesystem events per configured repository. */
export class ProjectRootWatcher {
  private readonly roots = new Map<string, WatchedRoot>();
  private readonly debounceMs: number;
  private readonly options: ProjectRootWatcherOptions;
  private ready = false;
  private disposed = false;

  constructor(options: ProjectRootWatcherOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? 350;
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const state = await LocalState.open(this.options.home);
    const configured = state.listProjectRoots();
    state.close();
    const configuredIds = new Set(configured.map((root) => root.id));
    for (const [id, watched] of this.roots) {
      if (configuredIds.has(id)) continue;
      if (watched.debounce !== undefined) clearTimeout(watched.debounce);
      watched.watcher.close();
      this.roots.delete(id);
    }
    let failures = 0;
    for (const root of configured) {
      if (this.roots.has(root.id)) continue;
      try {
        const watcher = watch(root.path, { recursive: true, persistent: false }, (_event, filename) => {
          const relativePath = normalizeFilename(filename);
          if (relativePath !== undefined && isRelevantProjectPath(relativePath)) this.schedule(root.id);
        });
        watcher.on('error', () => { this.ready = false; });
        watcher.unref?.();
        this.roots.set(root.id, { record: root, watcher });
      } catch {
        failures += 1;
      }
    }
    this.ready = failures === 0;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
    for (const watched of this.roots.values()) {
      if (watched.debounce !== undefined) clearTimeout(watched.debounce);
      watched.watcher.close();
    }
    this.roots.clear();
  }

  private schedule(rootId: string): void {
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
    try {
      const result = await this.options.application.execute(
        { operation: 'project.scan', input: { rootId, reappearChangedIgnored: true } },
        { scope: 'admin' },
      );
      this.ready = true;
      this.options.onInvalidation?.(result.revision);
    } catch {
      this.ready = false;
    }
  }
}

function normalizeFilename(filename: string | Buffer | null): string | undefined {
  if (filename === null) return undefined;
  const value = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename;
  const normalized = value.split(path.sep).join('/').replace(/^\.\//, '');
  return normalized.length === 0 ? undefined : normalized;
}

export function isRelevantProjectPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  if (/(^|\/)(?:\.git|node_modules|\.next|dist|build|coverage)(\/|$)/.test(normalized)) return false;
  const basename = path.posix.basename(normalized);
  return /^(?:AGENTS(?:\.override)?\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.mcp\.json|opencode\.jsonc?)$/.test(basename) ||
    /(^|\/)\.(?:agents|claude|opencode)\/skills(\/|$)/.test(normalized) ||
    /(^|\/)\.cursor\/rules\/.*\.mdc$/.test(normalized) ||
    /(^|\/)\.windsurf\/rules\/.*\.md$/.test(normalized) ||
    /(^|\/)\.codex\/config\.toml$/.test(normalized) ||
    /(^|\/)\.cursor\/mcp\.json$/.test(normalized) ||
    /(^|\/)\.gemini\/settings\.json$/.test(normalized);
}
