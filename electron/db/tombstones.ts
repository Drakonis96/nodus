import type Database from 'better-sqlite3';
import { identityColumns, quoteIdentifier } from './rowIdentity';
import { syncedTableNames } from './syncTables';

/**
 * Deletions, recorded so they stop coming back.
 *
 * A sync package carries rows, not their absence. Deleting a note on one machine and
 * importing any package built before the other heard about it re-inserted the note with
 * its original timestamps — and did so again on every future sync, in both directions.
 *
 * A tombstone is written by a trigger rather than by repository code: there are ~70
 * repositories issuing DELETEs, and any one of them forgetting would produce a row that
 * silently resurrects. The triggers are generated from the same registry that decides
 * what syncs, so a table added by a later migration is covered automatically.
 *
 * The INSERT trigger matters as much as the DELETE one. Several repositories save by
 * clearing and rewriting — the timetable deletes every period for a year and re-inserts
 * them with the same ids — so without clearing the tombstone on insert, an ordinary save
 * would leave a tombstone claiming the row was deleted, and the next sync would apply
 * that deletion to the other machine.
 */

/** Long enough that a machine left off over a summer still learns about a deletion.
 *  Beyond it a tombstone is dropped, and a package older than this is flagged on import
 *  because its deletions can no longer be trusted to stick. */
export const TOMBSTONE_HORIZON_DAYS = 180;

const DELETE_PREFIX = 'nodus_tomb_del_';
const INSERT_PREFIX = 'nodus_tomb_ins_';

/** `json_array(OLD."a", OLD."b")` — byte-identical to the `JSON.stringify(values)` the
 *  merge produces, so a key written by SQL and one written by JS compare equal. */
function keyExpression(alias: 'OLD' | 'NEW', identity: string[]): string {
  return `json_array(${identity.map((column) => `${alias}.${quoteIdentifier(column)}`).join(', ')})`;
}

function triggerSql(table: string, identity: string[]): { name: string; sql: string }[] {
  const literal = `'${table.replace(/'/g, "''")}'`;
  return [
    {
      name: `${DELETE_PREFIX}${table}`,
      sql:
        `CREATE TRIGGER ${quoteIdentifier(`${DELETE_PREFIX}${table}`)} AFTER DELETE ON ${quoteIdentifier(table)} BEGIN ` +
        `INSERT INTO sync_tombstones (table_name, row_key, deleted_at) ` +
        `VALUES (${literal}, ${keyExpression('OLD', identity)}, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ` +
        `ON CONFLICT(table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at; END`,
    },
    {
      name: `${INSERT_PREFIX}${table}`,
      sql:
        `CREATE TRIGGER ${quoteIdentifier(`${INSERT_PREFIX}${table}`)} AFTER INSERT ON ${quoteIdentifier(table)} BEGIN ` +
        `DELETE FROM sync_tombstones WHERE table_name = ${literal} AND row_key = ${keyExpression('NEW', identity)}; END`,
    },
  ];
}

/**
 * Bring the triggers in line with the current registry and schema. Runs on every open:
 * existing triggers whose SQL already matches are left alone, so this is a few reads in
 * the common case, and a table that stops syncing loses its triggers rather than
 * accumulating tombstones nobody consults.
 */
export function ensureTombstoneTriggers(db: Database.Database): void {
  const existing = new Map(
    (db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'nodus_tomb_del_%' OR name LIKE 'nodus_tomb_ins_%')")
      .all() as { name: string; sql: string | null }[]).map((row) => [row.name, row.sql ?? ''])
  );
  const wanted = new Map<string, string>();

  for (const table of syncedTableNames(db)) {
    if (table === 'sync_tombstones') continue; // a tombstone's own deletion is not news
    let identity: string[];
    try {
      identity = identityColumns(table, undefined, db);
    } catch {
      continue;
    }
    // A row that cannot be identified cannot be tombstoned either; describeSyncCoverage
    // already reports these as unmergeable and the test keeps that list empty.
    if (identity.length === 0) continue;
    for (const trigger of triggerSql(table, identity)) wanted.set(trigger.name, trigger.sql);
  }

  const tx = db.transaction(() => {
    for (const [name, sql] of wanted) {
      if (existing.get(name) === sql) continue;
      db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)}`);
      db.exec(sql);
    }
    for (const name of existing.keys()) {
      if (!wanted.has(name)) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)}`);
    }
  });
  tx();
}

export interface TombstoneRow {
  table_name: string;
  row_key: string;
  deleted_at: string;
}

/**
 * Forget deletions older than the horizon. Necessary — a tombstone table that only grows
 * would outlive the data it describes — but it is also the one operation here that can
 * cause a resurrection, so the horizon is generous and `packageIsOlderThanHorizon`
 * warns when a package predates it.
 */
export function pruneTombstones(db: Database.Database, horizonDays = TOMBSTONE_HORIZON_DAYS): number {
  const cutoff = new Date(Date.now() - horizonDays * 86400_000).toISOString();
  return db.prepare('DELETE FROM sync_tombstones WHERE deleted_at < ?').run(cutoff).changes;
}

/**
 * How far the other machine's clock appears to be AHEAD of this one, in milliseconds.
 *
 * Only this direction is measurable from a one-way file. A package dated three days ago
 * is indistinguishable from a package made by a computer whose clock is three days slow,
 * and no amount of inspection will separate them — but a package dated in the FUTURE can
 * only mean the sender's clock is ahead, and that is the dangerous case: every comparison
 * it takes part in, it wins.
 *
 * Returns 0 when there is nothing to report.
 */
export function measureClockSkewAhead(packageDate: string | null, now = Date.now()): number {
  if (!packageDate) return 0;
  const built = Date.parse(packageDate);
  if (Number.isNaN(built)) return 0;
  return Math.max(0, built - now);
}

/** A package built before the horizon may be missing deletions this machine has already
 *  forgotten, so rows it carries can legitimately come back. Worth saying out loud. */
export function packageIsOlderThanHorizon(packageDate: string | null, horizonDays = TOMBSTONE_HORIZON_DAYS): boolean {
  if (!packageDate) return false;
  const built = Date.parse(packageDate);
  if (Number.isNaN(built)) return false;
  return Date.now() - built > horizonDays * 86400_000;
}
