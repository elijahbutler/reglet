export interface RuntimeRevisionWatcherOptions {
  readRevision: () => Promise<number>;
  onInvalidation: (revision: number) => void;
  pollIntervalMs?: number;
}

/** Detects commands committed by another Reglet process against the same home. */
export class RuntimeRevisionWatcher {
  private readonly options: RuntimeRevisionWatcherOptions;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private revision: number | undefined;
  private polling = false;
  private disposed = false;

  constructor(options: RuntimeRevisionWatcherOptions) {
    this.options = options;
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
  }

  async start(): Promise<void> {
    if (this.disposed || this.timer !== undefined) return;
    await this.poll(false);
    if (this.disposed) return;
    this.timer = setInterval(() => void this.poll(true), this.pollIntervalMs);
    this.timer.unref?.();
  }

  noteRevision(revision: number): void {
    this.revision = revision;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(emit: boolean): Promise<void> {
    if (this.disposed || this.polling) return;
    this.polling = true;
    try {
      const revision = await this.options.readRevision();
      const changed = this.revision !== undefined && revision !== this.revision;
      this.revision = revision;
      if (emit && changed) this.options.onInvalidation(revision);
    } catch {
      // A later poll can recover from a transient database lock or migration.
    } finally {
      this.polling = false;
    }
  }
}
