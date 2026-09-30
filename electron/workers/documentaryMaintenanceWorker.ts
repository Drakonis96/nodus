import Database from 'better-sqlite3';
import { parentPort } from './backgroundParentPort';

/** One VACUUM of the documentary store, away from the main process. Its own connection
 * holds the write lock for the duration; readers keep working through the WAL, and the
 * main process holds its writers off until this answers. */
parentPort?.once('message', (input: { filename: string }) => {
  try {
    const db = new Database(input.filename, { fileMustExist: true });
    try {
      db.pragma('busy_timeout = 30000');
      db.exec('VACUUM');
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally { db.close(); }
    parentPort!.postMessage({ ok: true });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
