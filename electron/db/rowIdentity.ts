import type Database from 'better-sqlite3';
import { getDb } from './database';
import {
  IDENTITY_OVERRIDES,
  identityColumnsInDatabase,
  identityWhere,
  quoteIdentifier,
  tableColumnsInDatabase,
  type TableColumn,
} from './rowIdentityCore';

export { IDENTITY_OVERRIDES, identityWhere, quoteIdentifier, type TableColumn };

/**
 * How a row is identified when it is matched against the same row on another machine.
 * Shared by the sync merge and by the restore of a superseded version, so both agree on
 * what "the same row" means — two answers to that question would let a restore write
 * over the wrong record.
 */

/**
 * Identity for tables SQLite cannot describe: no primary key, and their UNIQUE index is
 * built over an EXPRESSION, so `index_info` reports no column names for it. Without this
 * the timetable's day colours have no key to merge on and would never travel.
 *
 * `describeSyncCoverage()` lists any synced table that has neither a primary key nor an
 * entry here, and the test asserts that list is empty — so a future migration adding
 * another such table fails the build instead of silently becoming unmergeable.
 */
/** Every helper takes an optional connection: the tombstone triggers are installed
 *  while the database is still being opened, before `getDb()` can return it. */
export function tableColumns(table: string, db: Database.Database = getDb()): TableColumn[] {
  return tableColumnsInDatabase(db, table);
}

/** The columns that identify a row: primary key, declared override, or a UNIQUE index
 *  whose columns SQLite can name. Empty when the row cannot be matched at all. */
export function identityColumns(table: string, columns?: TableColumn[], db: Database.Database = getDb()): string[] {
  return identityColumnsInDatabase(db, table, columns);
}
