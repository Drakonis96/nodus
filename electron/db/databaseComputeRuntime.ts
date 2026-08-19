// Minimal database runtime for the calculation worker. It deliberately has no
// dependency on Electron or the vault registry: the main process resolves and
// authorizes the exact absolute vault path before spawning the worker.
import Database from 'better-sqlite3';
import path from 'node:path';
import { isMainThread, workerData } from 'node:worker_threads';
import { auditQaDatabaseOpen } from '../qa/databaseAudit';

let database: Database.Database | null = null;

export function getDb(): Database.Database {
  if (database) return database;
  const requested = !isMainThread && workerData && typeof workerData === 'object'
    ? (workerData as { nodusDatabasePath?: unknown }).nodusDatabasePath
    : null;
  if (typeof requested !== 'string' || !path.isAbsolute(requested)) {
    throw new Error('El worker de cálculo no recibió una ruta de vault absoluta.');
  }
  database = new Database(requested, { fileMustExist: true });
  try {
    auditQaDatabaseOpen(requested, 'read-write');
  } catch (error) {
    database.close();
    database = null;
    throw error;
  }
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('synchronous = NORMAL');
  database.pragma('temp_store = MEMORY');
  database.pragma('cache_size = -32768');
  return database;
}
