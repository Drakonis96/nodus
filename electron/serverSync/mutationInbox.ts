import type Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../db/migrations';
import { identityColumns, quoteIdentifier, tableColumns } from '../db/rowIdentity';
import { MUTABLE_TABLES } from './outboxTriggers';

/**
 * The owner's side of the relay: take what collaborators wrote, apply it to the canonical
 * vault, and acknowledge.
 *
 * The server never interprets a mutation — it validates a shape and appends. Every decision
 * about what the vault actually contains is made here, on the one machine that knows the
 * schema, has run the migrations, and holds the real database.
 *
 * Conflict policy is the one the rest of Nodus already uses: newest wins by updated_at (or
 * created_at), and a local row that is newer than the incoming one is kept. Nothing here
 * silently drops a change without saying so — a refusal is reported and, crucially, NOT
 * acknowledged, so the ledger keeps it until the reason is fixed.
 */

const APPLICABLE = new Set<string>(MUTABLE_TABLES);

export interface IncomingMutation {
  id: string;
  seq: number;
  clientId?: string;
  kind: 'upsert' | 'delete';
  table: string;
  key: unknown[];
  row?: Record<string, unknown> | null;
  schemaVersion?: number;
  createdAt?: string;
}

export interface InboxSummary {
  applied: number;
  deleted: number;
  keptLocal: number;
  refused: { id: string; reason: string }[];
  /** Highest sequence number safe to acknowledge; everything above it is still owed. */
  cursor: number;
}

function timestampOf(row: Record<string, unknown> | null | undefined, fallback?: string): number {
  for (const column of ['updated_at', 'created_at']) {
    const value = row?.[column];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  const parsedFallback = fallback ? Date.parse(fallback) : NaN;
  return Number.isFinite(parsedFallback) ? parsedFallback : 0;
}

/**
 * Apply a batch, stopping at the first mutation that cannot be applied.
 *
 * Stopping matters: acknowledging past a refusal would drop it from the ledger forever, and
 * the collaborator who wrote it would never learn it had not landed. The cursor therefore
 * only ever advances over mutations that were genuinely handled.
 */
export function applyIncomingMutations(db: Database.Database, mutations: IncomingMutation[]): InboxSummary {
  const summary: InboxSummary = { applied: 0, deleted: 0, keptLocal: 0, refused: [], cursor: 0 };
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  for (const mutation of mutations.slice().sort((a, b) => Number(a.seq) - Number(b.seq))) {
    // A mutation written against a newer schema carries columns this build does not know.
    // Applying it anyway would DROP them, and because the truncated row keeps the newer
    // timestamp the loss would then propagate — the same reasoning mergeSyncPackage uses to
    // refuse a newer package outright.
    if (Number(mutation.schemaVersion) > SCHEMA_VERSION) {
      summary.refused.push({ id: mutation.id, reason: `Procede de un esquema más reciente (v${mutation.schemaVersion} frente a v${SCHEMA_VERSION}). Actualiza Nodus para recibir estos cambios.` });
      break;
    }
    if (!APPLICABLE.has(mutation.table) || !present.has(mutation.table)) {
      summary.refused.push({ id: mutation.id, reason: `La tabla ${mutation.table} no se acepta desde una réplica.` });
      break;
    }

    const identity = identityColumns(mutation.table, undefined, db);
    if (identity.length !== mutation.key.length) {
      summary.refused.push({ id: mutation.id, reason: 'La clave de fila no coincide con la identidad de esa tabla.' });
      break;
    }
    const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
    const key = mutation.key.map((value) => (value === undefined ? null : value));

    try {
      db.transaction(() => {
        db.pragma('defer_foreign_keys = ON');
        const local = db.prepare(`SELECT * FROM ${quoteIdentifier(mutation.table)} WHERE ${where}`).get(...key) as Record<string, unknown> | undefined;

        if (mutation.kind === 'delete') {
          // A local edit made after the remote deletion is the more recent fact, so the row
          // stays — the rule applyIncomingTombstones already applies to package imports.
          if (local && timestampOf(local) > timestampOf(null, mutation.createdAt)) {
            summary.keptLocal += 1;
            return;
          }
          db.prepare(`DELETE FROM ${quoteIdentifier(mutation.table)} WHERE ${where}`).run(...key);
          summary.deleted += 1;
          return;
        }

        const incoming = mutation.row ?? {};
        if (local && timestampOf(local) > timestampOf(incoming, mutation.createdAt)) {
          summary.keptLocal += 1;
          return;
        }
        const localColumns = new Set(tableColumns(mutation.table, db).map((column) => column.name));
        const columns = Object.keys(incoming).filter((column) => localColumns.has(column));
        if (columns.length === 0) {
          summary.keptLocal += 1;
          return;
        }
        if (local) {
          // UPDATE the columns the mutation carries, never INSERT OR REPLACE.
          //
          // A mutation never carries binary — images travel on their own channel — so
          // replacing the whole row blanks every column it left out. In practice that meant
          // a collaborator touching a Deep Research report's metadata silently destroyed the
          // owner's copy of its illustration. Measured, not hypothetical: it happened.
          const assignable = columns.filter((column) => !identity.includes(column));
          if (assignable.length === 0) {
            summary.keptLocal += 1;
            return;
          }
          db.prepare(
            `UPDATE ${quoteIdentifier(mutation.table)} SET ${assignable.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`
          ).run([...assignable.map((column) => (incoming[column] === undefined ? null : incoming[column])), ...key]);
        } else {
          db.prepare(
            `INSERT INTO ${quoteIdentifier(mutation.table)} (${columns.map(quoteIdentifier).join(', ')}) ` +
            `VALUES (${columns.map(() => '?').join(', ')})`
          ).run(columns.map((column) => (incoming[column] === undefined ? null : incoming[column])));
        }
        summary.applied += 1;
      })();
      summary.cursor = Number(mutation.seq);
    } catch (error) {
      summary.refused.push({ id: mutation.id, reason: error instanceof Error ? error.message : String(error) });
      break;
    }
  }

  return summary;
}
