import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { quoteIdentifier, identityColumns, tableColumns } from '../db/rowIdentity';
import { MUTABLE_TABLES, withOutboxSuppressed } from './outboxTriggers';
import { ASSET_SOURCES, type SnapshotAssetRef } from './serverSnapshot';

/**
 * Write a published snapshot into a replica's database.
 *
 * Two kinds of table, two rules, and the distinction is the whole design:
 *
 *   • CORPUS tables (works, ideas, edges, evidence, passages…) are derived by the owner's
 *     analysis pipeline. A replica has no pipeline of its own and can never legitimately
 *     edit them, so the server is simply authoritative: the local copy is replaced. Doing
 *     anything cleverer would mean carrying rows the owner has deleted forever.
 *
 *   • AUTHORED tables (notes, drafts, immersion sessions…) are the ones a reader writes in.
 *     Replacing those would delete their own work every time a colleague republished, so
 *     these are merged row by row, newest wins by updated_at.
 *
 * Both happen with the outbox triggers detached. Otherwise applying a publication would
 * queue every row it just delivered and the replica would try to send the corpus back.
 */

const AUTHORED = new Set<string>(MUTABLE_TABLES);

export interface SnapshotApplySummary {
  replaced: Record<string, number>;
  merged: Record<string, { inserted: number; updated: number; kept: number }>;
  skipped: string[];
}

function timestampOf(row: Record<string, unknown>): number {
  for (const column of ['updated_at', 'created_at']) {
    const value = row[column];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function insertStatement(db: Database.Database, table: string, columns: string[]) {
  return db.prepare(
    `INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) ` +
    `VALUES (${columns.map(() => '?').join(', ')})`
  );
}

/** Only the columns the local schema actually has: an older replica simply drops the rest. */
function usableColumns(db: Database.Database, table: string, rows: Record<string, unknown>[]): string[] {
  const local = new Set(tableColumns(table, db).map((column) => column.name));
  const seen = new Set<string>();
  for (const row of rows) for (const column of Object.keys(row)) if (local.has(column)) seen.add(column);
  return [...seen];
}

export function applySnapshotToReplica(db: Database.Database, snapshot: { tables?: Record<string, unknown> }): SnapshotApplySummary {
  const summary: SnapshotApplySummary = { replaced: {}, merged: {}, skipped: [] };
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  withOutboxSuppressed(db, () => {
    db.transaction(() => {
      // Children can arrive before parents, so constraints wait until the whole
      // publication is in place — the same discipline mergeSyncPackage uses.
      db.pragma('defer_foreign_keys = ON');

      for (const [table, value] of Object.entries(snapshot.tables ?? {})) {
        if (!Array.isArray(value)) continue;
        if (!present.has(table)) { summary.skipped.push(table); continue; }
        const rows = value as Record<string, unknown>[];

        if (!AUTHORED.has(table)) {
          db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
          if (rows.length > 0) {
            const columns = usableColumns(db, table, rows);
            if (columns.length === 0) { summary.skipped.push(table); continue; }
            const statement = insertStatement(db, table, columns);
            for (const row of rows) statement.run(columns.map((column) => (row[column] === undefined ? null : row[column])));
          }
          summary.replaced[table] = rows.length;
          continue;
        }

        // Authored table: newest wins, and a purely local row is never touched.
        const identity = identityColumns(table, undefined, db);
        if (identity.length === 0) { summary.skipped.push(table); continue; }
        const columns = usableColumns(db, table, rows);
        if (columns.length === 0) { summary.merged[table] = { inserted: 0, updated: 0, kept: 0 }; continue; }
        const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
        const find = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`);
        const insert = insertStatement(db, table, columns);
        // An existing row is UPDATED column by column rather than replaced. A publication
        // never carries binary, so INSERT OR REPLACE would blank the illustration bytes a
        // previous pull had downloaded — every report losing its image on the next sync.
        const assignable = columns.filter((column) => !identity.includes(column));
        const update = assignable.length > 0
          ? db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${assignable.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
          : null;
        const counts = { inserted: 0, updated: 0, kept: 0 };
        for (const row of rows) {
          const key = identity.map((column) => row[column] ?? null);
          const local = find.get(...key) as Record<string, unknown> | undefined;
          if (!local) {
            insert.run(columns.map((column) => (row[column] === undefined ? null : row[column])));
            counts.inserted += 1;
            continue;
          }
          if (timestampOf(row) > timestampOf(local) && update) {
            update.run([...assignable.map((column) => (row[column] === undefined ? null : row[column])), ...key]);
            counts.updated += 1;
          } else {
            counts.kept += 1;
          }
        }
        summary.merged[table] = counts;
      }
    })();
  });

  return summary;
}

/**
 * Fetch the images a publication references and put their bytes back in the database.
 *
 * A snapshot carries no binary at all — that invariant is what keeps documents off the
 * server — so the rows arrive with `status = 'ready'` and an empty `image_blob`. Without
 * this pass every Deep Research report in a replica shows a broken illustration while
 * claiming to have one, which is worse than having none.
 *
 * Only what is missing is fetched: an image already present keeps its bytes, so a routine
 * pull of an unchanged corpus costs nothing.
 */
export async function downloadReplicaAssets(
  db: Database.Database,
  assets: SnapshotAssetRef[],
  fetchAsset: (hash: string) => Promise<Buffer | null>,
): Promise<{ downloaded: number; bytes: number; skipped: number }> {
  const result = { downloaded: 0, bytes: 0, skipped: 0 };
  if (!assets?.length) return result;
  const sources = new Map<string, (typeof ASSET_SOURCES)[number]>(ASSET_SOURCES.map((source) => [source.table, source]));
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  // Three phases on purpose: decide what is missing, fetch it, then write it. Keeping the
  // network out of the middle phase means the write pass is short and synchronous, which is
  // what lets it run with the queue triggers detached without holding them off across I/O.
  interface Pending { table: string; key: readonly string[]; blobColumn: string; mimeColumn: string | null; hash: string; mime: string | null }
  const pending: Pending[] = [];

  for (const asset of assets) {
    const source = sources.get(asset.table);
    // A table this vault type does not publish still has its images uploaded, so the row
    // may simply not be here. Nothing to attach them to; skip rather than invent a row.
    if (!source || !present.has(asset.table)) { result.skipped += 1; continue; }
    const where = source.keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
    const local = db.prepare(`SELECT * FROM ${quoteIdentifier(asset.table)} WHERE ${where}`).get(...asset.key) as Record<string, unknown> | undefined;
    if (!local) { result.skipped += 1; continue; }

    for (const [hash, blobColumn, mimeColumn, mime] of [
      [asset.hash, source.blobColumn, source.mimeColumn, asset.mime],
      [asset.thumbHash, source.thumbColumn, source.thumbMimeColumn, asset.thumbMime],
    ] as [string | null, string, string, string | null][]) {
      if (!hash) continue;
      const existing = local[blobColumn];
      // Length is checked before the digest so an unchanged replica does not read megabytes
      // through sha256 on every single pull.
      if (Buffer.isBuffer(existing) && existing.length > 0 && createHash('sha256').update(existing).digest('hex') === hash) continue;
      pending.push({
        table: asset.table,
        key: asset.key,
        blobColumn,
        mimeColumn: Object.prototype.hasOwnProperty.call(local, mimeColumn) ? mimeColumn : null,
        hash,
        mime,
      });
    }
  }
  if (pending.length === 0) return result;

  const fetched: (Pending & { bytes: Buffer })[] = [];
  for (const item of pending) {
    const bytes = await fetchAsset(item.hash);
    if (!bytes) continue;
    // Verify before storing. Content addressing is only a guarantee if it is checked.
    if (createHash('sha256').update(bytes).digest('hex') !== item.hash) continue;
    fetched.push({ ...item, bytes });
  }
  if (fetched.length === 0) return result;

  // Suppressed, and this is not optional: `decorative_images` is a table a writer replica
  // may queue changes from, so storing the owner's own illustrations without this would
  // enqueue every one of them and try to send the images straight back where they came from.
  withOutboxSuppressed(db, () => {
    db.transaction(() => {
      for (const item of fetched) {
        const where = (sources.get(item.table)!).keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
        const columns = [item.blobColumn, ...(item.mimeColumn && item.mime ? [item.mimeColumn] : [])];
        const values: unknown[] = [item.bytes, ...(columns.length > 1 ? [item.mime] : [])];
        db.prepare(`UPDATE ${quoteIdentifier(item.table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
          .run([...values, ...item.key]);
        result.downloaded += 1;
        result.bytes += item.bytes.length;
      }
    })();
  });
  return result;
}
