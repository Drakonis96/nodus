import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { runMigrations, SCHEMA_VERSION } from './migrations';

let db: Database.Database | null = null;

export function dbPath(): string {
  return path.join(app.getPath('userData'), 'nodus.sqlite');
}

export function getDb(): Database.Database {
  if (!db) {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(dbPath());
    runMigrations(db);
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
