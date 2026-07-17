#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { issueOwnerReset, resetEmptySyncVault } from './admin-storage.js';
import { initializeSchema } from './storage.js';

const databasePath = path.resolve(process.env.REGLET_DB ?? './reglet.sqlite');
const command = process.argv[2];

if (command === 'owner-reset-link') {
  const publicUrl = new URL(process.env.REGLET_PUBLIC_URL ?? 'http://127.0.0.1:3000');
  const database = new Database(databasePath);
  try {
    initializeSchema(database);
    const token = issueOwnerReset(database, () => new Date());
    console.log(`${publicUrl.toString().replace(/\/$/, '')}/admin#reset=${encodeURIComponent(token)}`);
  } finally {
    database.close();
  }
} else if (command === 'check') {
  const database = new Database(databasePath, { readonly: true });
  try {
    const result = database.query('pragma quick_check').get() as { quick_check: string } | null;
    if (result?.quick_check !== 'ok') throw new Error('database integrity check failed');
    console.log('database\tok');
  } finally {
    database.close();
  }
} else if (command === 'backup') {
  const destinationValue = process.argv[3];
  if (destinationValue === undefined) throw new Error('Usage: admin.ts backup <destination.sqlite>');
  const destination = path.resolve(destinationValue);
  if (destination === databasePath) throw new Error('Backup destination must differ from REGLET_DB');
  try {
    await stat(destination);
    throw new Error('Backup destination already exists');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const database = new Database(databasePath);
  try {
    const check = database.query('pragma quick_check').get() as { quick_check: string } | null;
    if (check?.quick_check !== 'ok') throw new Error('Refusing to back up a database that fails quick_check');
    database.query('vacuum into ?').run(destination);
  } finally {
    database.close();
  }
  const backup = new Database(destination, { readonly: true });
  try {
    const check = backup.query('pragma quick_check').get() as { quick_check: string } | null;
    if (check?.quick_check !== 'ok') throw new Error('Backup verification failed');
  } finally {
    backup.close();
  }
  console.log(`backup\tverified\t${destination}`);
} else if (command === 'reset-empty-vault') {
  if (process.argv[3] !== '--confirm-empty-vault') {
    throw new Error('Usage: admin.ts reset-empty-vault --confirm-empty-vault');
  }
  const database = new Database(databasePath);
  try {
    initializeSchema(database);
    const reset = resetEmptySyncVault(database, () => new Date());
    console.log(`vault\treset\t${reset.vaultId}\tdevices=${reset.removedDevices}`);
  } finally {
    database.close();
  }
} else {
  throw new Error('Usage: admin.ts <owner-reset-link|check|backup|reset-empty-vault> [argument]');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
