import { randomUUID } from 'node:crypto';
import type { SupersededEntry, SupersededOrigin, SupersededRestoreResult } from '@shared/types';
import { getDb } from './database';
import { identityColumns, identityWhere, quoteIdentifier, tableColumns } from './rowIdentity';

/**
 * The versions a sync merge discarded.
 *
 * Merging two machines resolves every conflict by comparing wall-clock timestamps, and
 * whatever lost used to be overwritten and gone. That is only safe while both clocks are
 * right; a laptop an hour behind loses every comparison it takes part in, silently.
 *
 * Keeping the loser turns that from data loss into a decision the user can review and
 * undo — which is also what makes the coming deletion propagation safe to add, since a
 * remote delete can be reversed the same way.
 */

/** BLOB columns are not duplicated: an archive of scans or lecture recordings would
 *  multiply the database size. The marker records what was there so the UI can say so. */
interface OmittedBlob {
  __nodusOmittedBlob: true;
  bytes: number;
}

function isOmittedBlob(value: unknown): value is OmittedBlob {
  return Boolean(value && typeof value === 'object' && (value as OmittedBlob).__nodusOmittedBlob === true);
}

export function encodeSupersededRow(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        Buffer.isBuffer(value) ? ({ __nodusOmittedBlob: true, bytes: value.byteLength } satisfies OmittedBlob) : value,
      ])
    )
  );
}

function decodeSupersededRow(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export interface RecordSupersededInput {
  tableName: string;
  rowKey: unknown[];
  origin: SupersededOrigin;
  row: Record<string, unknown>;
  rowStamp?: string | null;
  winnerStamp?: string | null;
  packageDate?: string | null;
}

/**
 * Keep one discarded version. Returns whether it was actually stored: an identical
 * entry already present is not stored again. Never throws — this is a safety net, and a
 * failure to record must not abort a merge that is otherwise succeeding, which would
 * trade a recoverable conflict for a failed import.
 */
export function recordSuperseded(input: RecordSupersededInput): boolean {
  try {
    const db = getDb();
    const rowKey = JSON.stringify(input.rowKey);
    const rowJson = encodeSupersededRow(input.row);
    // Syncing is recurrent, and a version that loses once loses on every future import
    // of the same package. Without this the list would grow by a duplicate per sync
    // until the genuine conflicts were impossible to find.
    const existing = db
      .prepare('SELECT row_json FROM sync_superseded WHERE table_name = ? AND row_key = ? AND origin = ?')
      .all(input.tableName, rowKey, input.origin) as { row_json: string }[];
    if (existing.some((candidate) => candidate.row_json === rowJson)) return false;
    db
      .prepare(
        `INSERT INTO sync_superseded (id, table_name, row_key, origin, row_json, row_stamp, winner_stamp, package_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.tableName,
        rowKey,
        input.origin,
        rowJson,
        input.rowStamp ?? null,
        input.winnerStamp ?? null,
        input.packageDate ?? null,
        new Date().toISOString()
      );
    return true;
  } catch {
    /* the merge result matters more than its audit trail */
    return false;
  }
}

interface SupersededRow {
  id: string;
  table_name: string;
  row_key: string;
  origin: SupersededOrigin;
  row_json: string;
  row_stamp: string | null;
  winner_stamp: string | null;
  package_date: string | null;
  created_at: string;
}

function toEntry(row: SupersededRow): SupersededEntry {
  const decoded = decodeSupersededRow(row.row_json);
  const fields = Object.entries(decoded).map(([name, value]) => ({
    name,
    // Rendered for display only. The stored JSON stays authoritative for restoring.
    value: isOmittedBlob(value) ? `⟨${value.bytes} bytes⟩` : value === null ? '—' : String(value),
    omittedBlob: isOmittedBlob(value),
  }));
  let rowKey: unknown[] = [];
  try {
    const parsed = JSON.parse(row.row_key);
    if (Array.isArray(parsed)) rowKey = parsed;
  } catch {
    /* a malformed key still lists, it just cannot be restored */
  }
  return {
    id: row.id,
    tableName: row.table_name,
    rowKey: rowKey.map((value) => (value === null || value === undefined ? '—' : String(value))),
    origin: row.origin,
    fields,
    rowStamp: row.row_stamp,
    winnerStamp: row.winner_stamp,
    packageDate: row.package_date,
    createdAt: row.created_at,
    hasOmittedBlobs: fields.some((field) => field.omittedBlob),
  };
}

export function countSuperseded(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM sync_superseded').get() as { n: number }).n;
}

export function listSuperseded(limit = 100, offset = 0): SupersededEntry[] {
  return (
    getDb()
      .prepare('SELECT * FROM sync_superseded ORDER BY created_at DESC, id LIMIT ? OFFSET ?')
      .all(Math.max(1, Math.min(500, limit)), Math.max(0, offset)) as SupersededRow[]
  ).map(toEntry);
}

/**
 * Put a superseded version back.
 *
 * The version currently in place is recorded first, so promoting the wrong one is itself
 * undoable — a restore must never be the operation that finally loses something.
 * BLOB columns were not stored, so they are left exactly as they are rather than being
 * nulled; the caller is told when that happened.
 */
export function restoreSuperseded(id: string): SupersededRestoreResult {
  const db = getDb();
  const stored = db.prepare('SELECT * FROM sync_superseded WHERE id = ?').get(id) as SupersededRow | undefined;
  if (!stored) return { ok: false, message: 'Esta versión ya no está disponible.' };

  let rowKey: unknown[];
  try {
    const parsed = JSON.parse(stored.row_key);
    if (!Array.isArray(parsed)) throw new Error('bad key');
    rowKey = parsed;
  } catch {
    return { ok: false, message: 'La versión guardada no tiene una clave válida y no puede restaurarse.' };
  }

  const table = stored.table_name;
  let columns;
  try {
    columns = tableColumns(table);
  } catch {
    return { ok: false, message: `La tabla «${table}» ya no existe en esta versión de Nodus.` };
  }
  if (columns.length === 0) return { ok: false, message: `La tabla «${table}» ya no existe en esta versión de Nodus.` };

  const identity = identityColumns(table, columns);
  if (identity.length === 0 || identity.length !== rowKey.length) {
    return { ok: false, message: 'La identidad de la fila ha cambiado y no puede localizarse.' };
  }

  const stampColumn = columns.some((column) => column.name === 'updated_at') ? 'updated_at' : null;
  const values = decodeSupersededRow(stored.row_json);
  // Only columns that still exist, and never the omitted blobs.
  const present = new Set(columns.map((column) => column.name));
  const writable = Object.entries(values).filter(([name, value]) => present.has(name) && !isOmittedBlob(value));
  if (writable.length === 0) return { ok: false, message: 'La versión guardada no conserva ningún campo restaurable.' };
  const omitted = Object.entries(values).filter(([name, value]) => present.has(name) && isOmittedBlob(value)).map(([name]) => name);

  const where = identityWhere(columns, identity);
  try {
    const result = db.transaction(() => {
      const current = db
        .prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`)
        .get(...(rowKey as (string | number | null)[])) as Record<string, unknown> | undefined;

      if (current) {
        // Reversible: what is being replaced becomes a superseded version in its turn.
        recordSuperseded({
          tableName: table,
          rowKey,
          origin: 'restored',
          row: current,
          rowStamp: typeof current.updated_at === 'string' ? current.updated_at : null,
          winnerStamp: stored.row_stamp,
        });
        const assignable = new Map(writable.filter(([name]) => !identity.includes(name)));
        if (assignable.size === 0) return { changed: false, inserted: false };
        // Same reason as the insert below: the promoted version has to be the newest one
        // so it survives the next sync instead of being reverted by the other machine.
        if (stampColumn && !identity.includes(stampColumn)) assignable.set(stampColumn, new Date().toISOString());
        const assignableNames = [...assignable.keys()];
        db.prepare(
          `UPDATE ${quoteIdentifier(table)} SET ${assignableNames.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${where}`
        ).run(...assignableNames.map((name) => assignable.get(name) as string | number | null), ...(rowKey as (string | number | null)[]));
        return { changed: true, inserted: false };
      }

      // Bringing a row back is the latest fact about it. Without a fresh timestamp the
      // restored row stays older than the tombstone that removed it, so the very next
      // sync from the other machine would delete it again and the user would watch their
      // recovery undo itself. The INSERT also clears the local tombstone via its trigger.
      const revived = new Map(writable);
      if (stampColumn) revived.set(stampColumn, new Date().toISOString());
      const names = [...revived.keys()];
      db.prepare(
        `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
      ).run(...names.map((name) => revived.get(name) as string | number | null));
      return { changed: true, inserted: true };
    })();

    if (!result.changed) return { ok: false, message: 'La versión guardada solo contiene la clave; no hay nada que restaurar.' };
    // The entry is consumed: what it held is now live, and the replaced version was
    // recorded in its place, so nothing is lost by removing it.
    db.prepare('DELETE FROM sync_superseded WHERE id = ?').run(id);

    const notes: string[] = [];
    if (result.inserted) notes.push('La fila no existía y se ha vuelto a crear.');
    if (omitted.length > 0) notes.push(`No se restauraron los archivos adjuntos (${omitted.join(', ')}): se conservan los actuales.`);
    if (stampColumn && !writable.some(([name]) => name === stampColumn)) notes.push('La marca de tiempo no formaba parte de la versión guardada.');
    return { ok: true, message: ['Versión restaurada.', ...notes].join(' ') };
  } catch (error) {
    return {
      ok: false,
      message: `No se pudo restaurar: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Discard stored versions. Only ever explicit: this data IS the safety net, so nothing
 *  removes it on a timer behind the user's back. */
export function clearSuperseded(ids?: string[]): number {
  const db = getDb();
  if (!ids || ids.length === 0) {
    const n = countSuperseded();
    db.prepare('DELETE FROM sync_superseded').run();
    return n;
  }
  const statement = db.prepare('DELETE FROM sync_superseded WHERE id = ?');
  let removed = 0;
  const tx = db.transaction(() => {
    for (const id of ids) removed += statement.run(id).changes;
  });
  tx();
  return removed;
}
