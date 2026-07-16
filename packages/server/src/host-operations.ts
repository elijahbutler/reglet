import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import type { BackupSummary } from './admin-types.js';

const backupNamePattern = /^reglet-\d{8}T\d{6}-\d{3}-[a-f0-9]{16}\.sqlite$/;

export interface HostOperations {
  readonly backupsEnabled: boolean;
  checkIntegrity(): Promise<{ ok: true; checkedAt: string }>;
  listBackups(): Promise<BackupSummary[]>;
  createBackup(): Promise<BackupSummary>;
}

export function createHostOperations(
  database: Database,
  backupDirectory: string | undefined,
  now: () => Date,
): HostOperations {
  const directory = backupDirectory === undefined ? null : path.resolve(backupDirectory);
  let backupQueue = Promise.resolve();

  const requireDirectory = async (): Promise<string> => {
    if (directory === null) throw new Error('Server backups are not configured for this deployment');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Configured backup directory must be a real directory');
    return directory;
  };

  const verifyFile = async (filePath: string): Promise<'verified' | 'failed'> => {
    try {
      const entry = await lstat(filePath);
      if (!entry.isFile() || entry.isSymbolicLink()) return 'failed';
      const backup = new Database(filePath, { readonly: true });
      try {
        return quickCheck(backup) ? 'verified' : 'failed';
      } finally {
        backup.close();
      }
    } catch {
      return 'failed';
    }
  };

  const listBackups = async (): Promise<BackupSummary[]> => {
    const root = await requireDirectory();
    const names = (await readdir(root)).filter((name) => backupNamePattern.test(name)).sort().reverse();
    return Promise.all(names.map(async (name) => {
      const filePath = path.join(root, name);
      const entry = await lstat(filePath);
      return {
        name,
        createdAt: entry.birthtime.toISOString(),
        sizeBytes: entry.size,
        verification: await verifyFile(filePath),
      };
    }));
  };

  const createBackupNow = async (): Promise<BackupSummary> => {
    const root = await requireDirectory();
    if (!quickCheck(database)) throw new Error('Refusing to back up a database that fails quick_check');
    const timestamp = now();
    const name = backupName(timestamp);
    const destination = path.join(root, name);
    database.query('vacuum into ?').run(destination);
    const verification = await verifyFile(destination);
    const metadata = await stat(destination);
    if (verification !== 'verified') throw new Error('Backup verification failed');
    return { name, createdAt: timestamp.toISOString(), sizeBytes: metadata.size, verification };
  };

  return {
    backupsEnabled: directory !== null,
    async checkIntegrity() {
      if (!quickCheck(database)) throw new Error('Live database integrity check failed');
      return { ok: true, checkedAt: now().toISOString() };
    },
    listBackups,
    async createBackup() {
      const task = backupQueue.then(createBackupNow);
      backupQueue = task.then(() => undefined, () => undefined);
      return task;
    },
  };
}

function quickCheck(database: Database): boolean {
  const rows = database.query('pragma quick_check').all() as Array<{ quick_check: string }>;
  return rows.length === 1 && rows[0]?.quick_check === 'ok';
}

function backupName(value: Date): string {
  const compact = value.toISOString().replaceAll(/[-:]/g, '').replace('.', '-').replace('Z', '');
  return `reglet-${compact}-${randomBytes(8).toString('hex')}.sqlite`;
}
