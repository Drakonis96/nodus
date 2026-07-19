import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations, SCHEMA_VERSION } from './migrations';
import { ensureTombstoneTriggers, pruneTombstones } from './tombstones';
import { activeVaultDbPath } from '../vaults/vaultRegistry';

let db: Database.Database | null = null;

export function dbPath(): string {
  return activeVaultDbPath();
}

/** Cosine similarity between two Float32 BLOBs, computed inside SQLite. */
function vecCosine(a: Buffer | null, b: Buffer | null): number {
  if (!a || !b) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    dot += fa[i] * fb[i];
    na += fa[i] * fa[i];
    nb += fb[i] * fb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function openDatabase(file: string): Database.Database {
  const next = new Database(file);
  runMigrations(next);
  // Deletion tombstones are written by triggers, which are regenerated here rather than
  // created by a migration: the set of synced tables is decided in code, so a migration
  // could only ever capture the shape it had on the day it was written.
  ensureTombstoneTriggers(next);
  pruneTombstones(next);
  next.pragma('busy_timeout = 5000');
  next.pragma('synchronous = NORMAL');
  next.pragma('temp_store = MEMORY');
  next.pragma('cache_size = -32768');
  next.pragma('mmap_size = 268435456');
  next.pragma('wal_autocheckpoint = 1000');
  next.function('vec_cosine', vecCosine);
  const optimizeTimer = setTimeout(() => {
    try {
      if (next.open) next.pragma('optimize');
    } catch {
      // The vault may have been switched/closed before the idle maintenance ran.
    }
  }, 2_000);
  optimizeTimer.unref();
  return next;
}

export function getDb(): Database.Database {
  if (!db) {
    const target = dbPath();
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    db = openDatabase(target);
  }
  return db;
}

/**
 * The database file the live connection actually has open, or null when none is. This is
 * NOT always dbPath(): the connection is cached and only re-opened on an explicit
 * closeDb(), while dbPath() re-reads the vault registry from disk on every call. A second
 * Nodus instance switching vaults rewrites that registry underneath this process, so a
 * caller that reports which vault it is serving must ask here rather than trust the
 * registry.
 */
export function openDbPath(): string | null {
  return db ? db.name : null;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Replace the live DB file with an imported one and re-open. Used by import. */
export function replaceDbFile(sourceFile: string): void {
  closeDb();
  const target = dbPath();
  fs.copyFileSync(sourceFile, target);
  db = openDatabase(target); // brings an older import up to the current schema
}

export function currentSchemaVersion(): number {
  return getDb().pragma('user_version', { simple: true }) as number;
}

export { SCHEMA_VERSION };
