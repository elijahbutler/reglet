import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  isCanonicalSyncPath,
  parseSyncSnapshot,
  type SyncTransportFile,
  type SyncTransportSnapshot,
  type SyncTransportUpdate,
} from '@reglet/core';
import { Hono } from 'hono';

export interface SyncServerOptions {
  dataDirectory: string;
  token: string;
  fileLimitBytes?: number;
  retainedRevisions?: number;
}

export interface SyncServeOptions extends SyncServerOptions {
  hostname?: string;
  port?: number;
  allowPublicWildcard?: boolean;
  tlsCertificate?: string;
  tlsPrivateKey?: string;
}

interface SyncServerState {
  revision: number;
  updatedAt: string;
}

export function createSyncApp(options: SyncServerOptions): Hono {
  if (options.token.length < 24) {
    throw new Error('Sync server token must contain at least 24 characters.');
  }
  const store = new SyncSnapshotStore(options);
  const app = new Hono();

  app.get('/healthz', (context) => context.json({ status: 'ok' }));
  app.get('/readyz', async (context) => {
    try {
      await store.initialize();
      return context.json({ ready: true });
    } catch {
      return context.json({ ready: false }, 503);
    }
  });
  app.use('/v1/sync/*', async (context, next) => {
    const token = bearerToken(context.req.header('Authorization'));
    if (token === undefined || !credentialsEqual(token, options.token)) {
      return context.json(
        {
          error: {
            code: 'authentication-failed',
            message: 'Sync server authentication failed.',
          },
        },
        401,
      );
    }
    await next();
  });
  app.get('/v1/sync/snapshot', async (context) =>
    context.json(await store.snapshot()),
  );
  app.put('/v1/sync/snapshot', async (context) => {
    const value = await context.req.json<unknown>();
    if (
      typeof value !== 'object' ||
      value === null ||
      !('baseRevision' in value) ||
      typeof value.baseRevision !== 'number'
    ) {
      return context.json(
        {
          error: {
            code: 'invalid-request',
            message: 'A base revision and canonical files are required.',
          },
        },
        400,
      );
    }
    let parsed: SyncTransportSnapshot;
    try {
      parsed = parseSyncSnapshot(
        {
          revision: value.baseRevision,
          files: 'files' in value ? value.files : undefined,
        },
        options.fileLimitBytes,
      );
    } catch (error) {
      return context.json(
        {
          error: {
            code: 'invalid-snapshot',
            message:
              error instanceof Error
                ? error.message
                : 'Sync snapshot is invalid.',
          },
        },
        400,
      );
    }
    const update: SyncTransportUpdate = {
      baseRevision: parsed.revision,
      files: parsed.files,
    };
    const result = await store.update(update);
    if (!result.updated) {
      return context.json(
        {
          error: {
            code: 'revision-conflict',
            message: 'The sync snapshot changed on another machine.',
          },
          currentRevision: result.currentRevision,
        },
        409,
      );
    }
    return context.json({ revision: result.revision }, 200);
  });
  return app;
}

export function serveSync(
  options: SyncServeOptions,
): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? '127.0.0.1';
  if (isWildcardHost(hostname) && options.allowPublicWildcard !== true) {
    throw new Error(
      'Public wildcard sync binding is refused without the explicit override.',
    );
  }
  const app = createSyncApp(options);
  return Bun.serve({
    hostname,
    port: options.port ?? 4766,
    fetch: app.fetch,
    ...(options.tlsCertificate !== undefined &&
    options.tlsPrivateKey !== undefined
      ? {
          tls: {
            cert: options.tlsCertificate,
            key: options.tlsPrivateKey,
          },
        }
      : {}),
  });
}

class SyncSnapshotStore {
  private readonly dataDirectory: string;
  private readonly fileLimitBytes: number;
  private readonly retainedRevisions: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SyncServerOptions) {
    this.dataDirectory = path.resolve(options.dataDirectory);
    this.fileLimitBytes = options.fileLimitBytes ?? 25 * 1024 * 1024;
    this.retainedRevisions = options.retainedRevisions ?? 50;
  }

  async initialize(): Promise<void> {
    await mkdir(this.currentDirectory(), { recursive: true });
    try {
      await readFile(this.statePath(), 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        await writeJsonAtomic(this.statePath(), {
          revision: 0,
          updatedAt: new Date().toISOString(),
        } satisfies SyncServerState);
        return;
      }
      throw error;
    }
  }

  async snapshot(): Promise<SyncTransportSnapshot> {
    await this.queue;
    await this.initialize();
    const state = await this.readState();
    return {
      revision: state.revision,
      files: await readSnapshotFiles(
        this.currentDirectory(),
        this.fileLimitBytes,
      ),
    };
  }

  update(
    update: SyncTransportUpdate,
  ): Promise<
    | { updated: true; revision: number }
    | { updated: false; currentRevision: number }
  > {
    const operation = this.queue.then(async (): Promise<
      | { updated: true; revision: number }
      | { updated: false; currentRevision: number }
    > => {
      await this.initialize();
      const state = await this.readState();
      if (state.revision !== update.baseRevision) {
        return {
          updated: false,
          currentRevision: state.revision,
        };
      }
      const nextRevision = state.revision + 1;
      await this.replaceSnapshot(update.files, nextRevision);
      return { updated: true, revision: nextRevision };
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async replaceSnapshot(
    files: SyncTransportFile[],
    revision: number,
  ): Promise<void> {
    const temporary = path.join(
      this.dataDirectory,
      `.next-${randomUUID()}`,
    );
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of files) {
        if (!isCanonicalSyncPath(file.path)) {
          throw new Error(`Unsafe canonical sync path: ${file.path}`);
        }
        const target = path.join(temporary, ...file.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.contentBase64, 'base64'), {
          mode: 0o600,
        });
      }
      const current = this.currentDirectory();
      if ((await statIfPresent(current)) !== undefined) {
        const history = path.join(
          this.dataDirectory,
          'history',
          String(revision - 1).padStart(12, '0'),
        );
        await mkdir(path.dirname(history), { recursive: true });
        await cp(current, history, { recursive: true });
      }
      const previous = path.join(
        this.dataDirectory,
        `.previous-${randomUUID()}`,
      );
      await rename(current, previous);
      try {
        await rename(temporary, current);
      } catch (error) {
        await rename(previous, current);
        throw error;
      }
      await rm(previous, { recursive: true, force: true });
      await writeJsonAtomic(this.statePath(), {
        revision,
        updatedAt: new Date().toISOString(),
      } satisfies SyncServerState);
      await this.pruneHistory();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async pruneHistory(): Promise<void> {
    const historyDirectory = path.join(this.dataDirectory, 'history');
    let entries;
    try {
      entries = await readdir(historyDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
    const revisions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const revision of revisions.slice(this.retainedRevisions)) {
      await rm(path.join(historyDirectory, revision), {
        recursive: true,
        force: true,
      });
    }
  }

  private async readState(): Promise<SyncServerState> {
    const value = JSON.parse(await readFile(this.statePath(), 'utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('revision' in value) ||
      typeof value.revision !== 'number' ||
      !('updatedAt' in value) ||
      typeof value.updatedAt !== 'string'
    ) {
      throw new Error('Sync server state is invalid.');
    }
    return { revision: value.revision, updatedAt: value.updatedAt };
  }

  private currentDirectory(): string {
    return path.join(this.dataDirectory, 'current');
  }

  private statePath(): string {
    return path.join(this.dataDirectory, 'state.json');
  }
}

async function readSnapshotFiles(
  root: string,
  fileLimitBytes: number,
): Promise<SyncTransportFile[]> {
  const files: SyncTransportFile[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const content = await readFile(target);
        if (content.byteLength > fileLimitBytes) {
          throw new Error('Stored sync file exceeds the configured limit.');
        }
        const relativePath = path.relative(root, target).split(path.sep).join('/');
        if (!isCanonicalSyncPath(relativePath)) {
          throw new Error(`Stored sync path is invalid: ${relativePath}`);
        }
        files.push({
          path: relativePath,
          hash: createHash('sha256').update(content).digest('hex'),
          size: content.byteLength,
          contentBase64: content.toString('base64'),
        });
      }
    }
  }
  await visit(root);
  return files;
}

async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, targetPath);
}

async function statIfPresent(
  targetPath: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  const value = header.slice('Bearer '.length).trim();
  return value.length > 0 ? value : undefined;
}

function credentialsEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isWildcardHost(hostname: string): boolean {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
