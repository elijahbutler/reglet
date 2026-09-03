#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { issueOwnerReset, resetEmptySyncVault } from './admin-storage.js';
import { hashSecret } from './security.js';
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
} else if (command === 'set-password' || command === 'reset-password') {
  const newPassword = process.argv[3];
  if (!newPassword || newPassword.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  const database = new Database(databasePath);
  try {
    initializeSchema(database);
    const owner = database.query('select id, email from admin_owners limit 1').get() as { id: number; email: string } | null;
    if (!owner) throw new Error('No owner account found. Use set-owner <email> <password> to configure one.');
    const passwordHash = await hashSecret(newPassword);
    database.query('update admin_owners set password_hash = ?, updated_at = ? where id = ?').run(
      passwordHash,
      new Date().toISOString(),
      owner.id,
    );
    database.query('delete from admin_sessions where owner_id = ?').run(owner.id);
    console.log(`Password updated successfully for owner: ${owner.email}`);
  } finally {
    database.close();
  }
} else if (command === 'set-owner') {
  const email = process.argv[3];
  const newPassword = process.argv[4];
  if (!email || !email.includes('@')) throw new Error('Valid email required: admin.ts set-owner <email> <password>');
  if (!newPassword || newPassword.length < 12) throw new Error('Password must be at least 12 characters');
  const database = new Database(databasePath);
  try {
    initializeSchema(database);
    const passwordHash = await hashSecret(newPassword);
    const now = new Date().toISOString();
    const owner = database.query('select id from admin_owners limit 1').get() as { id: number } | null;
    if (owner) {
      database.query('update admin_owners set email = ?, password_hash = ?, updated_at = ? where id = ?').run(
        email,
        passwordHash,
        now,
        owner.id,
      );
      database.query('delete from admin_sessions where owner_id = ?').run(owner.id);
      console.log(`Updated owner to ${email}`);
    } else {
      const existingUser = database.query('select id from users where email = ?').get(email) as { id: number } | null;
      let userId: number;
      if (existingUser !== null) {
        userId = existingUser.id;
      } else {
        const anyUser = database.query('select id from users order by id asc limit 1').get() as { id: number } | null;
        if (anyUser !== null) {
          userId = anyUser.id;
        } else {
          const userResult = database.query('insert into users (email, pass_hash) values (?, ?)').run(email, passwordHash);
          userId = Number(userResult.lastInsertRowid);
        }
      }
      database.query(
        'insert into admin_owners (user_id, email, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)',
      ).run(userId, email, passwordHash, now, now);
      console.log(`Created owner account for ${email}`);
    }
  } finally {
    database.close();
  }
} else if (command === 'show-owner' || command === 'status') {
  const database = new Database(databasePath);
  try {
    initializeSchema(database);
    const owner = database.query('select id, email, created_at, updated_at from admin_owners limit 1').get() as {
      id: number;
      email: string;
      created_at: string;
      updated_at: string;
    } | null;
    if (!owner) {
      console.log('No owner configured (unclaimed server)');
    } else {
      const deviceCount = (database.query('select count(*) as count from devices where revoked_at is null').get() as { count: number }).count;
      console.log(`Owner: ${owner.email}`);
      console.log(`Configured: ${owner.updated_at || owner.created_at}`);
      console.log(`Active devices: ${deviceCount}`);
    }
  } finally {
    database.close();
  }
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
  throw new Error('Usage: admin.ts <set-password|set-owner|show-owner|owner-reset-link|check|backup|reset-empty-vault> [argument]');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
