// Electron-side wrappers around the pure idea-dedupe logic, bound to the app
// database. `backupDatabase` snapshots the live DB before a destructive merge so
// the whole operation is reversible by restoring one file.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './database';
import { findDuplicateIdeaGroups, mergeIdeas as mergeIn } from './ideaDedupe';
import type { DuplicateIdeaGroup } from '@shared/types';

export function listDuplicateIdeas(): DuplicateIdeaGroup[] {
  return findDuplicateIdeaGroups(getDb());
}

export function mergeIdeas(canonicalId: string, duplicateIds: string[]): { merged: number } {
  return { merged: mergeIn(getDb(), canonicalId, duplicateIds) };
}

/**
 * Consistent snapshot of the live DB into userData/backups/ before a destructive
 * maintenance action. Uses SQLite's online backup, so WAL contents are included
 * even while the app holds the database open. Returns the backup file path.
 */
export async function backupDatabase(reason = 'pre-idea-merge'): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `nodus-${stamp}-${reason}.sqlite`);
  await getDb().backup(dest);
  return dest;
}
