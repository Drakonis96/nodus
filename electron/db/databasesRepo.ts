// "Databases" mode store: Notion-like databases with typed columns and EAV cells.
// All typed meaning lives in shared/databases.ts — this repo only moves strings in
// and out of SQLite. Everything is per-vault (one DB file per vault) so it travels
// in backups and .nodussync with no extra plumbing.

import { getDb } from './database';
import { searchEntitiesAcrossVaults, resolveEntityLabel } from './crossVault';
import { v4 as uuid } from 'uuid';
import {
  newDatabaseShortId,
  normalizeCellValue,
  decodeMultiSelect,
  encodeMultiSelect,
  columnTypeDef,
  entryPercent,
  aggregateRollup,
  type RollupFunction,
} from '@shared/databases';
import { splitMultiValue, normalizeCsvValue, typeStoresImportedText } from '@shared/databaseCsv';
import { comparisonMajorityValue, comparisonSourceColumns } from '@shared/databaseComparison';
import { computeFormulas } from '@shared/databaseFormulaEval';
import type { FormulaSpec } from '@shared/databaseFormula';
import type { DatabaseFilterState, DatabaseSavedView, SavedViewInput, SortRule } from '@shared/databaseFilters';
import type {
  DatabaseAttachment,
  DatabaseColumn,
  DatabaseColumnConfig,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRelation,
  DatabaseRow,
  DatabaseRowHit,
  DatabaseRowSort,
  DatabaseSearchHit,
  DatabaseSelectOption,
  DatabaseSummary,
  RelationTarget,
  RelationTargetKind,
} from '@shared/databases';

export type { DatabaseRowSort };

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Databases ────────────────────────────────────────────────────────────────

interface DatabaseRowMeta {
  id: string;
  short_id: string;
  name: string;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function rowToSummary(row: DatabaseRowMeta, rowCount: number): DatabaseSummary {
  return {
    id: row.id,
    shortId: row.short_id,
    name: row.name,
    icon: row.icon,
    position: row.position,
    rowCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Generate a short id not already taken (retries on the rare collision). */
function uniqueShortId(): string {
  const db = getDb();
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = newDatabaseShortId();
    const clash = db.prepare('SELECT 1 FROM db_databases WHERE short_id = ?').get(candidate);
    if (!clash) return candidate;
  }
  // Astronomically unlikely; fall back to a uuid-tail suffix.
  return `DB-${uuid().slice(0, 6).toUpperCase()}`;
}

export function createDatabase(name: string, icon: string | null = null): DatabaseSummary {
  const db = getDb();
  const id = newId('db');
  const ts = now();
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_databases').get() as { n: number }).n;
  db.prepare(
    'INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, uniqueShortId(), name.trim() || 'Base de datos', icon, position, ts, ts);
  return getDatabase(id)!;
}

function rowCountOf(databaseId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM db_rows WHERE database_id = ?').get(databaseId) as { c: number }).c;
}

export function getDatabase(id: string): DatabaseSummary | null {
  const row = getDb().prepare('SELECT * FROM db_databases WHERE id = ?').get(id) as DatabaseRowMeta | undefined;
  return row ? rowToSummary(row, rowCountOf(id)) : null;
}

export function listDatabases(): DatabaseSummary[] {
  const rows = getDb().prepare('SELECT * FROM db_databases ORDER BY position, created_at').all() as DatabaseRowMeta[];
  return rows.map((r) => rowToSummary(r, rowCountOf(r.id)));
}

const likeEscape = (s: string) => s.replace(/[%_\\]/g, (m) => `\\${m}`);

/**
 * SQL condition (+ params) matching a query against a cell's `value_text`: plain text,
 * AND select/multi-select option ids whose LABEL matches (those cells store ids, not
 * the visible label, so a bare text match would miss them). Alias the cells table `c`.
 */
function contentMatchClause(qLower: string): { sql: string; params: string[] } {
  const like = `%${likeEscape(qLower)}%`;
  const opts = getDb().prepare(`SELECT id FROM db_select_options WHERE lower(label) LIKE ? ESCAPE '\\'`).all(like) as { id: string }[];
  const clauses = [`(c.value_text IS NOT NULL AND lower(c.value_text) LIKE ? ESCAPE '\\')`];
  const params: string[] = [like];
  for (const o of opts) {
    clauses.push(`c.value_text LIKE ? ESCAPE '\\'`);
    params.push(`%${likeEscape(o.id)}%`);
  }
  return { sql: clauses.join(' OR '), params };
}

/**
 * Search across every database. Always matches the database name; when
 * `includeContent` is set, also counts rows whose cells contain the query (text or a
 * matching select-option label) so the sidebar can surface databases matched by their
 * data. Empty query → no results.
 */
export function searchDatabases(query: string, includeContent: boolean): DatabaseSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = getDb();
  const contentCounts = new Map<string, number>();
  if (includeContent) {
    const clause = contentMatchClause(q);
    const rows = db
      .prepare(
        `SELECT r.database_id AS dbId, COUNT(DISTINCT c.row_id) AS n
         FROM db_cells c JOIN db_rows r ON r.id = c.row_id
         WHERE ${clause.sql}
         GROUP BY r.database_id`
      )
      .all(...clause.params) as { dbId: string; n: number }[];
    for (const r of rows) contentCounts.set(r.dbId, r.n);
  }
  return listDatabases()
    .map((d): DatabaseSearchHit => ({
      id: d.id,
      shortId: d.shortId,
      name: d.name,
      icon: d.icon,
      rowCount: d.rowCount,
      titleMatch: d.name.toLowerCase().includes(q),
      contentMatches: contentCounts.get(d.id) ?? 0,
    }))
    .filter((h) => h.titleMatch || h.contentMatches > 0)
    // Title matches first, then by number of content matches.
    .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.contentMatches - a.contentMatches);
}

/** A short context snippet around the first occurrence of `qLower` in `text`. */
function snippetAround(text: string, qLower: string, radius = 42): string {
  const idx = text.toLowerCase().indexOf(qLower);
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trim()}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + qLower.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Full-text search over every row of every database, for the dedicated search view.
 * Returns one hit per matching row (first matching cell wins), with the row's title,
 * the column the match was in and a snippet around it.
 */
export function searchDatabaseRows(query: string, limit = 60): DatabaseRowHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = getDb();
  const clause = contentMatchClause(q);
  const cells = db
    .prepare(
      `SELECT c.row_id AS rowId, r.database_id AS dbId, d.name AS dbName, d.short_id AS dbShort, col.name AS colName, col.type AS colType, c.value_text AS val
       FROM db_cells c
       JOIN db_rows r ON r.id = c.row_id
       JOIN db_databases d ON d.id = r.database_id
       JOIN db_columns col ON col.id = c.column_id
       WHERE ${clause.sql}
       ORDER BY d.position, r.position
       LIMIT ?`
    )
    .all(...clause.params, limit) as {
    rowId: string;
    dbId: string;
    dbName: string;
    dbShort: string;
    colName: string;
    colType: string;
    val: string;
  }[];
  const seen = new Set<string>();
  const primary = cells.filter((c) => (seen.has(c.rowId) ? false : (seen.add(c.rowId), true)));
  // Resolve each matched row's Title-column value in a single query.
  const titles = new Map<string, string>();
  const rowIds = primary.map((c) => c.rowId);
  if (rowIds.length) {
    const trows = db
      .prepare(
        `SELECT c.row_id AS rowId, c.value_text AS val
         FROM db_cells c JOIN db_columns col ON col.id = c.column_id
         WHERE col.type = 'title' AND c.row_id IN (${rowIds.map(() => '?').join(',')})`
      )
      .all(...rowIds) as { rowId: string; val: string | null }[];
    for (const t of trows) if (t.val && !titles.has(t.rowId)) titles.set(t.rowId, t.val);
  }
  // Option labels for select/multi-select snippets (loaded once, only if needed).
  let optLabels: Map<string, string> | null = null;
  const labelFor = (id: string): string => {
    if (!optLabels) optLabels = new Map((db.prepare('SELECT id, label FROM db_select_options').all() as { id: string; label: string }[]).map((o) => [o.id, o.label]));
    return optLabels.get(id) ?? id;
  };
  const snippetFor = (c: { colType: string; val: string }): string => {
    if (c.colType === 'select') return labelFor(c.val);
    if (c.colType === 'multi_select') return decodeMultiSelect(c.val).map(labelFor).join(', ');
    return snippetAround(c.val, q);
  };
  return primary.map((c) => ({
    databaseId: c.dbId,
    databaseName: c.dbName,
    databaseShortId: c.dbShort,
    rowId: c.rowId,
    title: titles.get(c.rowId) ?? '',
    columnName: c.colName,
    snippet: snippetFor(c),
  }));
}

export function renameDatabase(id: string, name: string): DatabaseSummary | null {
  getDb()
    .prepare('UPDATE db_databases SET name = ?, updated_at = ? WHERE id = ?')
    .run(name.trim() || 'Base de datos', now(), id);
  return getDatabase(id);
}

export function setDatabaseIcon(id: string, icon: string | null): DatabaseSummary | null {
  getDb().prepare('UPDATE db_databases SET icon = ?, updated_at = ? WHERE id = ?').run(icon, now(), id);
  return getDatabase(id);
}

export function deleteDatabase(id: string): void {
  // Columns, options, rows and cells cascade via FKs.
  getDb().prepare('DELETE FROM db_databases WHERE id = ?').run(id);
}

export function reorderDatabases(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE db_databases SET position = ? WHERE id = ?');
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id)));
  tx();
}

/** Total rows across every database in the vault — the denominator for the % header. */
export function vaultRowTotal(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM db_rows').get() as { c: number }).c;
}

export function databaseStats(databaseId: string): { rowCount: number; vaultTotal: number; percent: number } {
  const rowCount = rowCountOf(databaseId);
  const vaultTotal = vaultRowTotal();
  return { rowCount, vaultTotal, percent: entryPercent(rowCount, vaultTotal) };
}

// ── Columns ──────────────────────────────────────────────────────────────────

interface ColumnRow {
  id: string;
  database_id: string;
  name: string;
  type: string;
  position: number;
  config_json: string | null;
  created_at: string;
}

function parseConfig(json: string | null): DatabaseColumnConfig {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as DatabaseColumnConfig) : {};
  } catch {
    return {};
  }
}

function rowToColumn(row: ColumnRow): DatabaseColumn {
  const def = columnTypeDef(row.type);
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    type: def.id,
    position: row.position,
    config: parseConfig(row.config_json),
    options: def.hasOptions ? getOptions(row.id) : [],
  };
}

export function createColumn(
  databaseId: string,
  name: string,
  type: DatabaseColumnType,
  config: DatabaseColumnConfig = {}
): DatabaseColumn {
  const db = getDb();
  const id = newId('dcol');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_columns WHERE database_id = ?').get(databaseId) as {
      n: number;
    }
  ).n;
  db.prepare(
    'INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, databaseId, name.trim() || 'Columna', columnTypeDef(type).id, position, JSON.stringify(config), now());
  touchDatabase(databaseId);
  return getColumn(id)!;
}

export function getColumn(id: string): DatabaseColumn | null {
  const row = getDb().prepare('SELECT * FROM db_columns WHERE id = ?').get(id) as ColumnRow | undefined;
  return row ? rowToColumn(row) : null;
}

export function getColumns(databaseId: string): DatabaseColumn[] {
  const rows = getDb()
    .prepare('SELECT * FROM db_columns WHERE database_id = ? ORDER BY position, created_at')
    .all(databaseId) as ColumnRow[];
  return rows.map(rowToColumn);
}

export function updateColumn(
  id: string,
  patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }
): DatabaseColumn | null {
  const existing = getColumn(id);
  if (!existing) return null;
  const name = patch.name?.trim() ?? existing.name;
  const type = patch.type ? columnTypeDef(patch.type).id : existing.type;
  const config = patch.config !== undefined ? patch.config : existing.config;
  getDb()
    .prepare('UPDATE db_columns SET name = ?, type = ?, config_json = ? WHERE id = ?')
    .run(name || 'Columna', type, JSON.stringify(config), id);
  touchDatabase(existing.databaseId);
  return getColumn(id);
}

export function deleteColumn(id: string): void {
  const col = getColumn(id);
  // Options and cells for this column cascade via FKs.
  getDb().prepare('DELETE FROM db_columns WHERE id = ?').run(id);
  if (col) touchDatabase(col.databaseId);
}

export function reorderColumns(databaseId: string, orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE db_columns SET position = ? WHERE id = ? AND database_id = ?');
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id, databaseId)));
  tx();
  touchDatabase(databaseId);
}

// ── Select options ─────────────────────────────────────────────────────────────

interface OptionRow {
  id: string;
  column_id: string;
  label: string;
  color: string | null;
  position: number;
}

function rowToOption(row: OptionRow): DatabaseSelectOption {
  return { id: row.id, label: row.label, color: row.color, position: row.position };
}

export function getOptions(columnId: string): DatabaseSelectOption[] {
  return (
    getDb().prepare('SELECT * FROM db_select_options WHERE column_id = ? ORDER BY position, label').all(columnId) as OptionRow[]
  ).map(rowToOption);
}

export function addOption(columnId: string, label: string, color: string | null = null): DatabaseSelectOption {
  const db = getDb();
  const id = newId('dopt');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_select_options WHERE column_id = ?').get(columnId) as {
      n: number;
    }
  ).n;
  db.prepare('INSERT INTO db_select_options (id, column_id, label, color, position) VALUES (?, ?, ?, ?, ?)').run(
    id,
    columnId,
    label.trim() || 'Opción',
    color,
    position
  );
  return getOptions(columnId).find((o) => o.id === id)!;
}

export function updateOption(id: string, patch: { label?: string; color?: string | null }): void {
  const existing = getDb().prepare('SELECT * FROM db_select_options WHERE id = ?').get(id) as OptionRow | undefined;
  if (!existing) return;
  const label = patch.label?.trim() ?? existing.label;
  const color = patch.color !== undefined ? patch.color : existing.color;
  getDb().prepare('UPDATE db_select_options SET label = ?, color = ? WHERE id = ?').run(label || 'Opción', color, id);
}

/** Delete an option and purge its id from every cell that referenced it. */
export function deleteOption(id: string): void {
  const db = getDb();
  const opt = db.prepare('SELECT column_id FROM db_select_options WHERE id = ?').get(id) as
    | { column_id: string }
    | undefined;
  if (!opt) return;
  const col = getColumn(opt.column_id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM db_select_options WHERE id = ?').run(id);
    if (!col) return;
    const cells = db.prepare('SELECT row_id, value_text FROM db_cells WHERE column_id = ?').all(opt.column_id) as {
      row_id: string;
      value_text: string | null;
    }[];
    for (const cell of cells) {
      if (col.type === 'select') {
        if (cell.value_text === id) db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(cell.row_id, opt.column_id);
      } else if (col.type === 'multi_select') {
        const ids = decodeMultiSelect(cell.value_text).filter((v) => v !== id);
        const next = encodeMultiSelect(ids);
        if (next == null) db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(cell.row_id, opt.column_id);
        else db.prepare('UPDATE db_cells SET value_text = ? WHERE row_id = ? AND column_id = ?').run(next, cell.row_id, opt.column_id);
      }
    }
  });
  tx();
}

export function reorderOptions(columnId: string, orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE db_select_options SET position = ? WHERE id = ? AND column_id = ?');
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id, columnId)));
  tx();
}

// ── Rows & cells ─────────────────────────────────────────────────────────────

function touchDatabase(databaseId: string): void {
  getDb().prepare('UPDATE db_databases SET updated_at = ? WHERE id = ?').run(now(), databaseId);
}

function touchRow(rowId: string): void {
  getDb().prepare('UPDATE db_rows SET updated_at = ? WHERE id = ?').run(now(), rowId);
}

export function createRow(databaseId: string): DatabaseRow {
  const db = getDb();
  const id = newId('drow');
  const ts = now();
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_rows WHERE database_id = ?').get(databaseId) as {
      n: number;
    }
  ).n;
  db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    databaseId,
    position,
    ts,
    ts
  );
  touchDatabase(databaseId);
  return { id, databaseId, position, cells: {}, createdAt: ts, updatedAt: ts };
}

function orderClause(sort: DatabaseRowSort): string {
  switch (sort) {
    case 'createdAsc':
      return 'r.created_at ASC, r.id';
    case 'createdDesc':
      return 'r.created_at DESC, r.id';
    case 'updatedDesc':
      return 'r.updated_at DESC, r.id';
    case 'position':
    default:
      return 'r.position ASC, r.id';
  }
}

/**
 * Rows for a database with their cells, assembled from the EAV tables in one pass.
 * Column-value sorting/filtering is Phase 5; Phase 1 sorts by row metadata.
 */
export function listRows(
  databaseId: string,
  opts: { sort?: DatabaseRowSort; limit?: number; offset?: number } = {}
): DatabaseRow[] {
  const db = getDb();
  const order = orderClause(opts.sort ?? 'position');
  const limitClause = opts.limit != null ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '';
  const offsetClause = opts.offset != null ? ` OFFSET ${Math.max(0, Math.floor(opts.offset))}` : '';
  const metaRows = db
    .prepare(`SELECT id, database_id, position, created_at, updated_at FROM db_rows r WHERE database_id = ? ORDER BY ${order}${limitClause}${offsetClause}`)
    .all(databaseId) as { id: string; database_id: string; position: number; created_at: string; updated_at: string }[];
  if (metaRows.length === 0) return [];
  const rowIndex = new Map<string, DatabaseRow>();
  const out: DatabaseRow[] = metaRows.map((m) => {
    const row: DatabaseRow = {
      id: m.id,
      databaseId: m.database_id,
      position: m.position,
      cells: {},
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
    rowIndex.set(m.id, row);
    return row;
  });
  const placeholders = metaRows.map(() => '?').join(',');
  const cells = db
    .prepare(`SELECT row_id, column_id, value_text FROM db_cells WHERE row_id IN (${placeholders})`)
    .all(...metaRows.map((m) => m.id)) as { row_id: string; column_id: string; value_text: string | null }[];
  for (const cell of cells) {
    const row = rowIndex.get(cell.row_id);
    if (row) row.cells[cell.column_id] = cell.value_text;
  }
  const attByRow = attachmentsForRows(metaRows.map((m) => m.id));
  for (const [rowId, byCol] of attByRow) {
    const row = rowIndex.get(rowId);
    if (row) row.attachments = byCol;
  }
  const relByRow = relationCountsForRows(metaRows.map((m) => m.id));
  for (const [rowId, byCol] of relByRow) {
    const row = rowIndex.get(rowId);
    if (row) row.relationCounts = byCol;
  }
  const columns = getColumns(databaseId);
  computeRollups(out, columns);
  // Formulas run last: one may read a rollup, and they resolve their own inter-dependencies.
  if (columns.some((c) => c.type === 'formula')) {
    // Column statistics are defined over the whole table, so a caller asking for one page must
    // not get a "% of total" measured against that page. Reload the full set for them — the
    // recursive call is unpaginated, so it takes the cheap branch and cannot recurse again.
    const paginated = opts.limit != null || opts.offset != null;
    computeFormulas(out, columns, paginated ? listRows(databaseId) : out);
  }
  return out;
}

/**
 * Fill each row's `rollups` for the database's rollup columns. A rollup aggregates a
 * property from the rows a db_row relation column links to: gather the related target
 * rows, read the chosen target column's value (resolving select labels), then apply the
 * rollup function. Only db_row relations are rollable (Notion's model). Read-only.
 */
function computeRollups(rows: DatabaseRow[], columns: DatabaseColumn[]): void {
  const rollupCols = columns.filter((c) => c.type === 'rollup');
  if (rollupCols.length === 0 || rows.length === 0) return;
  const db = getDb();
  const rowIds = rows.map((r) => r.id);
  const inRows = `(${rowIds.map(() => '?').join(',')})`;
  for (const rc of rollupCols) {
    const relColId = rc.config.rollupRelationColumnId as string | undefined;
    const fn = (rc.config.rollupFunction as RollupFunction) ?? 'show';
    const relCol = relColId ? columns.find((c) => c.id === relColId) : undefined;
    const targetDbId = relCol?.config.relationTargetDatabaseId as string | undefined;
    if (!relCol || relCol.type !== 'relation' || relCol.config.relationTargetKind !== 'db_row' || !targetDbId) {
      for (const r of rows) (r.rollups ??= {})[rc.id] = '';
      continue;
    }
    // Related target-row ids per source row.
    const rels = db
      .prepare(`SELECT row_id, target_id FROM db_relations WHERE column_id = ? AND target_kind = 'db_row' AND row_id IN ${inRows}`)
      .all(relColId, ...rowIds) as { row_id: string; target_id: string }[];
    const relatedByRow = new Map<string, string[]>();
    const allTargetIds = new Set<string>();
    for (const r of rels) {
      let arr = relatedByRow.get(r.row_id);
      if (!arr) relatedByRow.set(r.row_id, (arr = []));
      arr.push(r.target_id);
      allTargetIds.add(r.target_id);
    }
    // The target column ('__title__' → the related db's Title column).
    const targetColId = rc.config.rollupTargetColumnId as string | undefined;
    const targetCols = getColumns(targetDbId);
    const targetCol =
      !targetColId || targetColId === '__title__' ? targetCols.find((c) => c.type === 'title') ?? targetCols[0] : targetCols.find((c) => c.id === targetColId);
    // Target values for every related row, in one query.
    const valueByRow = new Map<string, string | null>();
    if (targetCol && allTargetIds.size) {
      const ids = [...allTargetIds];
      const cells = db
        .prepare(`SELECT row_id, value_text FROM db_cells WHERE column_id = ? AND row_id IN (${ids.map(() => '?').join(',')})`)
        .all(targetCol.id, ...ids) as { row_id: string; value_text: string | null }[];
      for (const c of cells) valueByRow.set(c.row_id, c.value_text);
    }
    let optLabels: Map<string, string> | null = null;
    const asLabel = (raw: string | null): string | null => {
      if (raw == null) return null;
      if (targetCol?.type === 'select') {
        optLabels ??= new Map((targetCol.options ?? []).map((o) => [o.id, o.label]));
        return optLabels.get(raw) ?? raw;
      }
      if (targetCol?.type === 'multi_select') {
        optLabels ??= new Map((targetCol.options ?? []).map((o) => [o.id, o.label]));
        return decodeMultiSelect(raw).map((id) => optLabels!.get(id) ?? id).join(', ');
      }
      return raw;
    };
    for (const r of rows) {
      const values = (relatedByRow.get(r.id) ?? []).map((tid) => asLabel(valueByRow.get(tid) ?? null));
      (r.rollups ??= {})[rc.id] = aggregateRollup(fn, values);
    }
  }
}

export function getRow(rowId: string): DatabaseRow | null {
  const db = getDb();
  const meta = db.prepare('SELECT * FROM db_rows WHERE id = ?').get(rowId) as
    | { id: string; database_id: string; position: number; created_at: string; updated_at: string }
    | undefined;
  if (!meta) return null;
  const cells = db.prepare('SELECT column_id, value_text FROM db_cells WHERE row_id = ?').all(rowId) as {
    column_id: string;
    value_text: string | null;
  }[];
  const cellMap: Record<string, string | null> = {};
  for (const c of cells) cellMap[c.column_id] = c.value_text;
  const row: DatabaseRow = {
    id: meta.id,
    databaseId: meta.database_id,
    position: meta.position,
    cells: cellMap,
    attachments: attachmentsForRows([rowId]).get(rowId) ?? {},
    relationCounts: relationCountsForRows([rowId]).get(rowId) ?? {},
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
  const columns = getColumns(meta.database_id);
  computeRollups([row], columns);
  if (columns.some((c) => c.type === 'formula')) {
    // getRow runs after every cell edit, so only reload the table when a formula genuinely
    // needs it: a column statistic is the only recipe that looks beyond its own row.
    const needsTable = columns.some(
      (c) => c.type === 'formula' && (c.config.formula as FormulaSpec | undefined)?.kind === 'columnStat'
    );
    computeFormulas([row], columns, needsTable ? listRows(meta.database_id) : [row]);
  }
  return row;
}

export function deleteRow(rowId: string): void {
  const db = getDb();
  const meta = db.prepare('SELECT database_id FROM db_rows WHERE id = ?').get(rowId) as
    | { database_id: string }
    | undefined;
  db.prepare('DELETE FROM db_rows WHERE id = ?').run(rowId); // cells cascade
  if (meta) touchDatabase(meta.database_id);
}

/**
 * Write one cell. The raw value is normalized for the column's type; an empty value
 * deletes the cell so "no value" is a missing row, never a stray empty string.
 */
export function setCell(rowId: string, columnId: string, raw: string | null): DatabaseRow | null {
  const db = getDb();
  const col = getColumn(columnId);
  if (!col) return getRow(rowId);
  const normalized = normalizeCellValue(col.type, raw);
  if (normalized == null) {
    db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(rowId, columnId);
  } else {
    db.prepare(
      'INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?) ON CONFLICT(row_id, column_id) DO UPDATE SET value_text = excluded.value_text'
    ).run(rowId, columnId, normalized);
  }
  touchRow(rowId);
  touchDatabase(col.databaseId);
  return getRow(rowId);
}

// ── Comparison cells ────────────────────────────────────────────────────────

/** Recompute one comparison cell from the configured source columns. */
export function runComparisonCell(rowId: string, columnId: string): DatabaseRow | null {
  const column = getColumn(columnId);
  const row = getRow(rowId);
  if (!column || column.type !== 'comparison' || !row || row.databaseId !== column.databaseId) return row;
  const columns = getColumns(column.databaseId);
  if (comparisonSourceColumns(column, columns).length < 2) return row;
  return setCell(rowId, columnId, comparisonMajorityValue(column, columns, row));
}

/**
 * Recompute a complete comparison column in bounded transactions. Unlike calling setCell
 * for every row, this avoids reloading formulas and rollups N times; yielding between batches
 * keeps navigation and vault switching responsive on large databases.
 */
export async function runComparisonColumn(
  databaseId: string,
  columnId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ done: number }> {
  const column = getColumn(columnId);
  if (!column || column.type !== 'comparison' || column.databaseId !== databaseId) return { done: 0 };
  const columns = getColumns(databaseId);
  if (comparisonSourceColumns(column, columns).length < 2) return { done: 0 };
  const rows = listRows(databaseId, { sort: 'position' });
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?) ON CONFLICT(row_id, column_id) DO UPDATE SET value_text = excluded.value_text'
  );
  const clear = db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?');
  const touch = db.prepare('UPDATE db_rows SET updated_at = ? WHERE id = ?');
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const ts = now();
    db.transaction(() => {
      for (const row of batch) {
        const result = comparisonMajorityValue(column, columns, row);
        if (result == null) clear.run(row.id, columnId);
        else upsert.run(row.id, columnId, result);
        touch.run(ts, row.id);
      }
    })();
    onProgress?.(Math.min(start + batch.length, rows.length), rows.length);
    // Let navigation and a vault switch be handled between batches. The scoped database
    // remains pinned to this job's source vault across the yield.
    if (start + batch.length < rows.length) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  touchDatabase(databaseId);
  return { done: rows.length };
}

// ── Attachments ──────────────────────────────────────────────────────────────

interface AttachmentMetaRow {
  id: string;
  row_id: string;
  column_id: string;
  file_name: string | null;
  mime_type: string | null;
  bytes: number;
  has_blob: number;
  content_hash: string | null;
  extracted_text: string | null;
  description: string | null;
  ai_generated: number;
  ai_prompt: string | null;
  position: number;
  created_at: string;
}

const ATTACHMENT_META_COLS = `id, row_id, column_id, file_name, mime_type, bytes,
  (blob IS NOT NULL) AS has_blob, content_hash, extracted_text, description,
  ai_generated, ai_prompt, position, created_at`;

function rowToAttachment(row: AttachmentMetaRow): DatabaseAttachment {
  return {
    id: row.id,
    rowId: row.row_id,
    columnId: row.column_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    hasBlob: Boolean(row.has_blob),
    contentHash: row.content_hash,
    extractedText: row.extracted_text,
    description: row.description,
    aiGenerated: Boolean(row.ai_generated),
    aiPrompt: row.ai_prompt,
    position: row.position,
    createdAt: row.created_at,
  };
}

export interface AddAttachmentInput {
  rowId: string;
  columnId: string;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  blob: Uint8Array;
  contentHash?: string | null;
  extractedText?: string | null;
  description?: string | null;
  aiGenerated?: boolean;
  aiPrompt?: string | null;
  /** Downscaled preview for the grid/gallery; null for non-images. */
  thumb?: Uint8Array | null;
}

export function addAttachment(input: AddAttachmentInput): DatabaseAttachment {
  const db = getDb();
  const id = newId('datt');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_attachments WHERE row_id = ? AND column_id = ?').get(
      input.rowId,
      input.columnId
    ) as { n: number }
  ).n;
  db.prepare(
    `INSERT INTO db_attachments (id, row_id, column_id, file_name, mime_type, bytes, blob, content_hash, extracted_text, description, ai_generated, ai_prompt, thumb, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.rowId,
    input.columnId,
    input.fileName,
    input.mimeType,
    input.bytes,
    Buffer.from(input.blob),
    input.contentHash ?? null,
    input.extractedText ?? null,
    input.description ?? null,
    input.aiGenerated ? 1 : 0,
    input.aiPrompt ?? null,
    input.thumb ? Buffer.from(input.thumb) : null,
    position,
    now()
  );
  touchRow(input.rowId);
  const col = getColumn(input.columnId);
  if (col) touchDatabase(col.databaseId);
  return getAttachment(id)!;
}

export function getAttachment(id: string): DatabaseAttachment | null {
  const row = getDb().prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE id = ?`).get(id) as
    | AttachmentMetaRow
    | undefined;
  return row ? rowToAttachment(row) : null;
}

export function getAttachmentBlob(id: string): Buffer | null {
  const row = getDb().prepare('SELECT blob FROM db_attachments WHERE id = ?').get(id) as
    | { blob: Buffer | null }
    | undefined;
  return row?.blob ?? null;
}

/**
 * The mime type of a stored thumb. attachmentThumb.ts encodes every preview as JPEG; it is
 * named here rather than imported from there because that module pulls in Electron's
 * nativeImage, and this repo has to stay importable from the pure-DB paths (and their
 * esbuild bundles, e.g. the .nodussync package) that run outside the Electron runtime.
 */
const THUMB_MIME = 'image/jpeg';

/**
 * The attachment's preview image, falling back to the original when there is no thumb
 * (non-image files, or attachments stored before thumbs existed). Reports the returned
 * bytes' own mime type — a generated thumb is always JPEG whatever the original was, so
 * the caller cannot infer it from the attachment's mime_type.
 */
export function getAttachmentThumb(id: string): { bytes: Buffer; mimeType: string | null } | null {
  const row = getDb().prepare('SELECT thumb, blob, mime_type FROM db_attachments WHERE id = ?').get(id) as
    | { thumb: Buffer | null; blob: Buffer | null; mime_type: string | null }
    | undefined;
  if (!row) return null;
  if (row.thumb) return { bytes: row.thumb, mimeType: THUMB_MIME };
  return row.blob ? { bytes: row.blob, mimeType: row.mime_type } : null;
}

export function listAttachments(rowId: string, columnId: string): DatabaseAttachment[] {
  return (
    getDb()
      .prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE row_id = ? AND column_id = ? ORDER BY position, created_at`)
      .all(rowId, columnId) as AttachmentMetaRow[]
  ).map(rowToAttachment);
}

/** Is this exact file already attached to this cell? (dedupe on re-add). */
export function attachmentExists(rowId: string, columnId: string, contentHash: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM db_attachments WHERE row_id = ? AND column_id = ? AND content_hash = ? LIMIT 1')
      .get(rowId, columnId, contentHash)
  );
}

export function deleteAttachment(id: string): void {
  const att = getAttachment(id);
  getDb().prepare('DELETE FROM db_attachments WHERE id = ?').run(id);
  if (att) {
    touchRow(att.rowId);
    const col = getColumn(att.columnId);
    if (col) touchDatabase(col.databaseId);
  }
}

/** Relation counts per (row, column) for a set of rows — cheap (no label resolution). */
function relationCountsForRows(rowIds: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (rowIds.length === 0) return out;
  const placeholders = rowIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT row_id, column_id, COUNT(*) AS n FROM db_relations WHERE row_id IN (${placeholders}) GROUP BY row_id, column_id`)
    .all(...rowIds) as { row_id: string; column_id: string; n: number }[];
  for (const r of rows) {
    const byCol = out.get(r.row_id) ?? {};
    byCol[r.column_id] = r.n;
    out.set(r.row_id, byCol);
  }
  return out;
}

/** Attachment metadata for a set of rows, grouped by row then column. */
function attachmentsForRows(rowIds: string[]): Map<string, Record<string, DatabaseAttachment[]>> {
  const out = new Map<string, Record<string, DatabaseAttachment[]>>();
  if (rowIds.length === 0) return out;
  const placeholders = rowIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE row_id IN (${placeholders}) ORDER BY position, created_at`)
    .all(...rowIds) as AttachmentMetaRow[];
  for (const r of rows) {
    const att = rowToAttachment(r);
    const byCol = out.get(att.rowId) ?? {};
    (byCol[att.columnId] ??= []).push(att);
    out.set(att.rowId, byCol);
  }
  return out;
}

// ── Relations ────────────────────────────────────────────────────────────────

/** Resolve a relation target's display label, vault name and broken-ness (best-effort).
 *  db_row is local; entity kinds resolve in `targetVaultId`'s vault (cross-vault). */
function resolveRelation(
  kind: RelationTargetKind,
  id: string,
  targetVaultId: string | null
): { label: string; vaultName?: string; broken: boolean } {
  if (kind === 'db_row') {
    try {
      const row = getRow(id);
      if (!row) return { label: id, broken: true };
      const cols = getColumns(row.databaseId);
      const titleCol = cols.find((c) => c.type === 'title') ?? cols[0];
      const label = (titleCol ? (row.cells[titleCol.id] ?? '').trim() : '') || id;
      return { label, broken: false };
    } catch {
      return { label: id, broken: true };
    }
  }
  return resolveEntityLabel(kind, id, targetVaultId);
}

interface RelationRow {
  id: string;
  row_id: string;
  column_id: string;
  target_kind: RelationTargetKind;
  target_id: string;
  target_vault_id: string | null;
  position: number;
  created_at: string;
}

function rowToRelation(r: RelationRow): DatabaseRelation {
  const resolved = resolveRelation(r.target_kind, r.target_id, r.target_vault_id ?? null);
  return {
    id: r.id,
    rowId: r.row_id,
    columnId: r.column_id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    targetVaultId: r.target_vault_id ?? null,
    label: resolved.label,
    vaultName: resolved.vaultName,
    broken: resolved.broken,
    position: r.position,
    createdAt: r.created_at,
  };
}

export function addRelation(
  rowId: string,
  columnId: string,
  targetKind: RelationTargetKind,
  targetId: string,
  targetVaultId: string | null = null
): DatabaseRelation {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM db_relations WHERE row_id = ? AND column_id = ? AND target_kind = ? AND target_id = ?')
    .get(rowId, columnId, targetKind, targetId) as { id: string } | undefined;
  if (existing) return getRelation(existing.id)!;
  const id = newId('drel');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_relations WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as {
      n: number;
    }
  ).n;
  db.prepare(
    'INSERT INTO db_relations (id, row_id, column_id, target_kind, target_id, target_vault_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, rowId, columnId, targetKind, targetId, targetVaultId, position, now());
  touchRow(rowId);
  const col = getColumn(columnId);
  if (col) touchDatabase(col.databaseId);
  return getRelation(id)!;
}

function getRelation(id: string): DatabaseRelation | null {
  const r = getDb().prepare('SELECT * FROM db_relations WHERE id = ?').get(id) as RelationRow | undefined;
  return r ? rowToRelation(r) : null;
}

export function listRelations(rowId: string, columnId: string): DatabaseRelation[] {
  return (
    getDb().prepare('SELECT * FROM db_relations WHERE row_id = ? AND column_id = ? ORDER BY position, created_at').all(rowId, columnId) as RelationRow[]
  ).map(rowToRelation);
}

export function removeRelation(id: string): void {
  const rel = getRelation(id);
  getDb().prepare('DELETE FROM db_relations WHERE id = ?').run(id);
  if (rel) {
    touchRow(rel.rowId);
    const col = getColumn(rel.columnId);
    if (col) touchDatabase(col.databaseId);
  }
}

/** Candidate targets for the relation picker, filtered by a query. */
export function searchRelationTargets(
  kind: RelationTargetKind,
  query: string,
  opts: { databaseId?: string; limit?: number } = {}
): RelationTarget[] {
  const limit = opts.limit ?? 20;
  if (kind === 'db_row') {
    if (!opts.databaseId) return [];
    const rows = listRows(opts.databaseId).map((r) => ({ id: r.id, label: resolveRelation('db_row', r.id, null).label }));
    const filtered = query.trim() ? rows.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase())) : rows;
    return filtered.slice(0, limit).map((r) => ({ kind, id: r.id, label: r.label }));
  }
  // Entity kinds (idea/gap/work/author/person) are searched across ALL vaults.
  return searchEntitiesAcrossVaults(kind, query, limit).map((h) => ({
    kind,
    id: h.id,
    label: h.label,
    vaultId: h.vaultId,
    vaultName: h.vaultName,
    sublabel: h.vaultName || undefined,
  }));
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function getDatabaseDetail(id: string): DatabaseDetail | null {
  const database = getDatabase(id);
  if (!database) return null;
  return { database, columns: getColumns(id) };
}

// ── Sync serialization (.nodussync) ──────────────────────────────────────────
// Databases no longer travel as whole trees. They used to: a newer `updated_at` on
// either side replaced the peer's entire database via DELETE + re-insert, so one row
// added here could erase fifty added there. `electron/export/syncPackage.ts` now
// merges every db_* table row by row from the live schema, which also means new
// columns are carried automatically instead of needing this file to be updated.


// ── Saved views ──────────────────────────────────────────────────────────────

interface ViewRow {
  id: string;
  database_id: string;
  name: string;
  layout: string;
  filter_json: string | null;
  sort_json: string | null;
  position: number;
  created_at: string;
}

function parseFilter(json: string | null): DatabaseFilterState {
  if (!json) return { conjunction: 'and', conditions: [] };
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object' || !Array.isArray(p.conditions)) return { conjunction: 'and', conditions: [] };
    return {
      conjunction: p.conjunction === 'or' ? 'or' : 'and',
      conditions: p.conditions,
      groups: Array.isArray(p.groups) ? p.groups : undefined,
    };
  } catch {
    return { conjunction: 'and', conditions: [] };
  }
}

function parseSorts(json: string | null): SortRule[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function rowToView(r: ViewRow): DatabaseSavedView {
  return {
    id: r.id,
    databaseId: r.database_id,
    name: r.name,
    layout: r.layout === 'gallery' ? 'gallery' : 'table',
    filter: parseFilter(r.filter_json),
    sorts: parseSorts(r.sort_json),
    position: r.position,
    createdAt: r.created_at,
  };
}

export function createView(databaseId: string, input: SavedViewInput): DatabaseSavedView {
  const db = getDb();
  const id = newId('dview');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_views WHERE database_id = ?').get(databaseId) as { n: number }
  ).n;
  db.prepare(
    'INSERT INTO db_views (id, database_id, name, layout, filter_json, sort_json, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    databaseId,
    input.name.trim() || 'Vista',
    input.layout === 'gallery' ? 'gallery' : 'table',
    JSON.stringify(input.filter ?? { conjunction: 'and', conditions: [] }),
    JSON.stringify(input.sorts ?? []),
    position,
    now()
  );
  return getView(id)!;
}

function getView(id: string): DatabaseSavedView | null {
  const r = getDb().prepare('SELECT * FROM db_views WHERE id = ?').get(id) as ViewRow | undefined;
  return r ? rowToView(r) : null;
}

export function listViews(databaseId: string): DatabaseSavedView[] {
  return (
    getDb().prepare('SELECT * FROM db_views WHERE database_id = ? ORDER BY position, created_at').all(databaseId) as ViewRow[]
  ).map(rowToView);
}

export function updateView(id: string, patch: Partial<SavedViewInput>): DatabaseSavedView | null {
  const existing = getView(id);
  if (!existing) return null;
  const name = patch.name?.trim() ?? existing.name;
  const layout = patch.layout ?? existing.layout;
  const filter = patch.filter ?? existing.filter;
  const sorts = patch.sorts ?? existing.sorts;
  getDb()
    .prepare('UPDATE db_views SET name = ?, layout = ?, filter_json = ?, sort_json = ? WHERE id = ?')
    .run(name || 'Vista', layout === 'gallery' ? 'gallery' : 'table', JSON.stringify(filter), JSON.stringify(sorts), id);
  return getView(id);
}

export function deleteView(id: string): void {
  getDb().prepare('DELETE FROM db_views WHERE id = ?').run(id);
}

// ── CSV import ───────────────────────────────────────────────────────────────

const IMPORT_OPTION_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

/**
 * Create a database from parsed CSV rows with a per-column type mapping. Select /
 * multi-select columns build their options from the distinct values encountered.
 *
 * Columns whose type is null are skipped (the user discarded them in the import modal).
 *
 * This is a bulk path, so it deliberately bypasses createRow/addOption/setCell: those
 * are tuned for single edits and each re-compiles its SQL, re-reads the column, bumps
 * both timestamps and re-reads the whole row. At ~180k cells that overhead dominated
 * (a 7k-row import took ~40s of blocked event loop). Here every statement is prepared
 * once, positions come from a counter instead of SELECT MAX(position), and timestamps
 * are stamped once for the batch.
 */
export function createDatabaseFromCsv(
  name: string,
  headers: string[],
  rows: string[][],
  types: (DatabaseColumnType | null)[],
  onProgress?: (done: number, total: number) => void
): DatabaseSummary {
  const db = getDb();
  const database = createDatabase(name);
  // Keep the source column index alongside the created column so skipped columns don't
  // shift the mapping between a row's cells and the columns we created.
  const cols = headers
    .map((h, i) => ({ sourceIndex: i, type: types[i] }))
    .filter((c): c is { sourceIndex: number; type: DatabaseColumnType } => c.type != null)
    .map((c) => ({ sourceIndex: c.sourceIndex, column: createColumn(database.id, headers[c.sourceIndex], c.type) }));

  const insRow = db.prepare(
    'INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insCell = db.prepare('INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?)');
  const insOption = db.prepare(
    'INSERT INTO db_select_options (id, column_id, label, color, position) VALUES (?, ?, ?, ?, ?)'
  );

  // For option columns, remember label→optionId as we go.
  const optionMaps = cols.map((c) =>
    c.column.type === 'select' || c.column.type === 'multi_select' ? new Map<string, string>() : null
  );
  const optionId = (colIdx: number, label: string): string => {
    const map = optionMaps[colIdx]!;
    const key = label.toLowerCase();
    let id = map.get(key);
    if (!id) {
      const color = IMPORT_OPTION_COLORS[map.size % IMPORT_OPTION_COLORS.length];
      id = newId('dopt');
      insOption.run(id, cols[colIdx].column.id, label.trim() || 'Opción', color, map.size);
      map.set(key, id);
    }
    return id;
  };

  const ts = now();
  const tx = db.transaction(() => {
    for (let r = 0; r < rows.length; r++) {
      const rawRow = rows[r];
      const rowId = newId('drow');
      insRow.run(rowId, database.id, r, ts, ts);
      for (let i = 0; i < cols.length; i++) {
        const { sourceIndex, column } = cols[i];
        // attachment/ai_image/relation/rollup keep their value outside db_cells, so an
        // imported string has nowhere to land: create the column, leave the cells empty.
        if (!typeStoresImportedText(column.type)) continue;
        const raw = (rawRow[sourceIndex] ?? '').trim();
        if (!raw) continue;
        let value: string | null;
        if (column.type === 'select') {
          value = optionId(i, raw);
        } else if (column.type === 'multi_select') {
          value = encodeMultiSelect(splitMultiValue(raw).map((label) => optionId(i, label)));
        } else {
          value = normalizeCellValue(column.type, normalizeCsvValue(column.type, raw));
        }
        if (value != null) insCell.run(rowId, column.id, value);
      }
      if (onProgress && (r % 500 === 0 || r === rows.length - 1)) onProgress(r + 1, rows.length);
    }
  });
  tx();
  return getDatabase(database.id)!;
}
