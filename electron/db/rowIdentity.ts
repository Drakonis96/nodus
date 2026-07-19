import type Database from 'better-sqlite3';
import { getDb } from './database';

/**
 * How a row is identified when it is matched against the same row on another machine.
 * Shared by the sync merge and by the restore of a superseded version, so both agree on
 * what "the same row" means — two answers to that question would let a restore write
 * over the wrong record.
 */

export interface TableColumn { name: string; pk: number; notnull: number }

export function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Identificador de tabla no válido.');
  return `"${value}"`;
}

/**
 * Identity for tables SQLite cannot describe: no primary key, and their UNIQUE index is
 * built over an EXPRESSION, so `index_info` reports no column names for it. Without this
 * the timetable's day colours have no key to merge on and would never travel.
 *
 * `describeSyncCoverage()` lists any synced table that has neither a primary key nor an
 * entry here, and the test asserts that list is empty — so a future migration adding
 * another such table fails the build instead of silently becoming unmergeable.
 */
export const IDENTITY_OVERRIDES: Record<string, string[]> = {
  // UNIQUE INDEX ... ON (COALESCE(academic_year_id, ''), day)
  study_schedule_day_styles: ['day', 'academic_year_id'],
};

/** Every helper takes an optional connection: the tombstone triggers are installed
 *  while the database is still being opened, before `getDb()` can return it. */
export function tableColumns(table: string, db: Database.Database = getDb()): TableColumn[] {
  return db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
}

/** The columns that identify a row: primary key, declared override, or a UNIQUE index
 *  whose columns SQLite can name. Empty when the row cannot be matched at all. */
export function identityColumns(table: string, columns?: TableColumn[], db: Database.Database = getDb()): string[] {
  columns = columns ?? tableColumns(table, db);
  const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  if (pk.length > 0) return pk;
  const override = IDENTITY_OVERRIDES[table];
  const names = new Set(columns.map((column) => column.name));
  if (override && override.every((name) => names.has(name))) return override;
  const indexes = db.pragma(`index_list(${quoteIdentifier(table)})`) as { name: string; unique: number }[];
  for (const index of indexes) {
    if (index.unique !== 1) continue;
    const info = db.pragma(`index_info(${JSON.stringify(index.name)})`) as { name: string | null }[];
    if (info.length > 0 && info.every((entry) => typeof entry.name === 'string')) {
      return info.map((entry) => entry.name as string);
    }
  }
  return [];
}

/**
 * `WHERE` clause matching one row by its identity. Nullable identity columns use `IS`
 * (an unscoped timetable has a NULL academic year, and `= NULL` matches nothing); NOT
 * NULL ones keep `=` so primary-key lookups still use their index.
 */
export function identityWhere(columns: TableColumn[], identity: string[]): string {
  const notNull = new Set(columns.filter((column) => column.notnull === 1 || column.pk > 0).map((column) => column.name));
  return identity.map((key) => `${quoteIdentifier(key)} ${notNull.has(key) ? '=' : 'IS'} ?`).join(' AND ');
}
