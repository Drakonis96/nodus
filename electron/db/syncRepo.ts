import { getDb } from './database';
import type { SyncLogEntry } from '@shared/types';

export function addSyncLog(mode: string, summary: string): SyncLogEntry {
  const at = new Date().toISOString();
  const info = getDb().prepare('INSERT INTO sync_log (at, mode, summary) VALUES (?, ?, ?)').run(at, mode, summary);
  return { id: Number(info.lastInsertRowid), at, mode, summary };
}

export function getSyncLog(limit = 50): SyncLogEntry[] {
  return getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit) as SyncLogEntry[];
}
