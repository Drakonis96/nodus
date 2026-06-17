import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { runMigrations, SCHEMA_VERSION } from './migrations';

let db: Database.Database | null = null;

export function dbPath(): string {
  return path.join(app.getPath('userData'), 'nodus.sqlite');
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

export function getDb(): Database.Database {
  if (!db) {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(dbPath());
    runMigrations(db);
    db.function('vec_cosine', vecCosine);
  }
  return db;
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
  db = new Database(target);
  runMigrations(db); // brings an older import up to the current schema
}

export function currentSchemaVersion(): number {
  return getDb().pragma('user_version', { simple: true }) as number;
}

export { SCHEMA_VERSION };
