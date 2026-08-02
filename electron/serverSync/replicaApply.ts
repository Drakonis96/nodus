import type Database from 'better-sqlite3';
import { quoteIdentifier, identityColumns, tableColumns } from '../db/rowIdentity';
import { MUTABLE_TABLES, withOutboxSuppressed } from './outboxTriggers';

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
        const statement = insertStatement(db, table, columns);
        const counts = { inserted: 0, updated: 0, kept: 0 };
        for (const row of rows) {
          const key = identity.map((column) => row[column] ?? null);
          const local = find.get(...key) as Record<string, unknown> | undefined;
          if (!local) {
            statement.run(columns.map((column) => (row[column] === undefined ? null : row[column])));
            counts.inserted += 1;
            continue;
          }
          if (timestampOf(row) > timestampOf(local)) {
            statement.run(columns.map((column) => (row[column] === undefined ? null : row[column])));
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
