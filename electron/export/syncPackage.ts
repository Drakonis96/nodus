import AdmZip from 'adm-zip';
import type { SyncMergeSummary, SyncTableCounts } from '@shared/types';
import { getDb, SCHEMA_VERSION } from '../db/database';
import {
  serializeDatabasesForSync,
  replaceDatabaseFromSync,
  getDatabaseUpdatedAt,
  type DbSyncUnit,
} from '../db/databasesRepo';

/**
 * Portable sync package for the USER layer: notes (+ folders), saved writing
 * drafts, saved searches, edge-audit verdicts and structured databases (the
 * Databases vault — whole db_* trees incl. attachment blobs). Unlike the
 * encrypted full backup (which REPLACES the whole database), importing a sync
 * package MERGES: rows are matched by stable id (or pair key for edge
 * feedback), the newer side wins per row, and nothing local is ever deleted.
 * Databases merge as atomic units (newest-wins by db_databases.updated_at):
 * unknown databases are inserted whole, and a newer incoming copy replaces the
 * whole local tree. This is the piece that makes working on two machines
 * survivable — Zotero already syncs the library; this carries the layer Nodus
 * derives nothing from: what the user wrote.
 *
 * Core functions are dialog-free so they can run headless (tests, MCP).
 */

export const SYNC_FORMAT = 'nodus.sync-package';
export const SYNC_FORMAT_VERSION = 1;

interface SyncManifest {
  format: typeof SYNC_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  date: string;
  counts: Record<string, number>;
}

interface SyncPayload {
  note_folders: FolderRow[];
  notes: NoteRow[];
  writing_saved_drafts: DraftRow[];
  saved_searches: SearchRow[];
  edge_feedback: FeedbackRow[];
  databases: DbSyncUnit[];
  /** Every study_* table is carried independently. Older v1 packages simply
   * omit these keys, so the extension remains backwards compatible. */
  [table: `study_${string}`]: PortableRow[];
}

type PortableScalar = string | number | null | { __nodusBuffer: string };
type PortableRow = Record<string, PortableScalar>;

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  order_idx: number;
  created_at: string;
  updated_at: string;
}
interface NoteRow {
  id: string;
  folder_id: string | null;
  title: string;
  kind: string;
  content: string;
  source_json: string | null;
  order_idx: number;
  created_at: string;
  updated_at: string;
}
interface DraftRow {
  id: string;
  title: string;
  brief_json: string;
  selection_json: string;
  model_json: string | null;
  draft_json: string;
  created_at: string;
  updated_at: string;
}
interface SearchRow {
  id: string;
  name: string;
  query: string;
  mode: string;
  kinds_json: string;
  created_at: string;
}
interface FeedbackRow {
  from_id: string;
  to_id: string;
  type: string;
  verdict: string;
  note: string;
  created_at: string;
}

/** Snapshot the user layer into a zip buffer with a validating manifest. */
export function buildSyncPackage(appVersion: string): { buffer: Buffer; counts: Record<string, number> } {
  const db = getDb();
  const payload = {
    note_folders: db.prepare('SELECT id, parent_id, name, order_idx, created_at, updated_at FROM note_folders').all() as FolderRow[],
    notes: db
      .prepare('SELECT id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at FROM notes')
      .all() as NoteRow[],
    writing_saved_drafts: db
      .prepare('SELECT id, title, brief_json, selection_json, model_json, draft_json, created_at, updated_at FROM writing_saved_drafts')
      .all() as DraftRow[],
    saved_searches: db.prepare('SELECT id, name, query, mode, kinds_json, created_at FROM saved_searches').all() as SearchRow[],
    edge_feedback: db.prepare('SELECT from_id, to_id, type, verdict, note, created_at FROM edge_feedback').all() as FeedbackRow[],
    databases: serializeDatabasesForSync(),
  } as SyncPayload;
  for (const table of listStudyTables()) {
    payload[table as `study_${string}`] = (db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[])
      .map(encodePortableRow);
  }
  const counts = Object.fromEntries(Object.entries(payload).map(([table, rows]) => [table, rows.length]));
  const manifest: SyncManifest = {
    format: SYNC_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    date: new Date().toISOString(),
    counts,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('user-layer.json', Buffer.from(JSON.stringify(payload, null, 2)));
  return { buffer: zip.toBuffer(), counts };
}

/**
 * Merge a sync package into the live database. Additive and newest-wins:
 * unknown rows are inserted, rows present on both sides take whichever
 * `updated_at` (or `created_at`) is newer, and local rows absent from the
 * package are always left alone.
 */
export function mergeSyncPackage(buffer: Buffer): SyncMergeSummary {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Archivo de sincronización ilegible.');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  const payloadEntry = zip.getEntry('user-layer.json');
  if (!manifestEntry || !payloadEntry) throw new Error('Paquete inválido: faltan manifest o datos.');

  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as SyncManifest;
  if (manifest.format !== SYNC_FORMAT || manifest.formatVersion !== SYNC_FORMAT_VERSION) {
    throw new Error('Formato de paquete de sincronización no soportado.');
  }

  const payload = JSON.parse(zip.readAsText(payloadEntry)) as SyncPayload;
  for (const [table, expected] of Object.entries(manifest.counts)) {
    const rows = (payload as unknown as Record<string, unknown[]>)[table];
    if (!Array.isArray(rows) || rows.length !== expected) {
      throw new Error(`Paquete inválido: el recuento de ${table} no coincide con su manifiesto.`);
    }
  }

  const db = getDb();
  const summary: SyncMergeSummary = {
    noteFolders: zeroCounts(),
    notes: zeroCounts(),
    writingDrafts: zeroCounts(),
    savedSearches: zeroCounts(),
    edgeFeedback: zeroCounts(),
    databases: zeroCounts(),
    study: zeroCounts(),
  };

  const tx = db.transaction(() => {
    mergeFolders(payload.note_folders ?? [], summary.noteFolders);
    mergeNotes(payload.notes ?? [], summary.notes);
    mergeDrafts(payload.writing_saved_drafts ?? [], summary.writingDrafts);
    mergeSearches(payload.saved_searches ?? [], summary.savedSearches);
    mergeFeedback(payload.edge_feedback ?? [], summary.edgeFeedback);
    mergeDatabases(payload.databases ?? [], summary.databases);
    mergeStudyTables(payload, summary.study);
  });
  tx();
  return summary;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Identificador de tabla no válido.');
  return `"${value}"`;
}

function listStudyTables(): string[] {
  return (getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'study\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => /^study_[A-Za-z0-9_]+$/.test(name));
}

function encodePortableRow(row: Record<string, unknown>): PortableRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (Buffer.isBuffer(value)) return [key, { __nodusBuffer: value.toString('base64') }];
    if (value === null || typeof value === 'string' || typeof value === 'number') return [key, value];
    throw new Error(`El campo ${key} contiene un valor no portable.`);
  })) as PortableRow;
}

function decodePortableValue(value: PortableScalar): string | number | Buffer | null {
  if (value && typeof value === 'object') {
    if (typeof value.__nodusBuffer !== 'string') throw new Error('Valor binario no válido en el paquete de sincronización.');
    return Buffer.from(value.__nodusBuffer, 'base64');
  }
  return value;
}

interface TableColumn { name: string; pk: number }

/**
 * Merge every study row as an atomic record. Primary keys identify conflicts;
 * updated_at (or created_at) decides which side wins. The complete row is
 * written in one statement, including binary material/audio/embedding fields.
 * Foreign keys are deferred until the transaction ends so an arbitrary table
 * name order cannot split a course/document/material tree mid-import.
 */
function mergeStudyTables(payload: SyncPayload, counts: SyncTableCounts): void {
  const db = getDb();
  const localTables = new Set(listStudyTables());
  const incomingTables = Object.keys(payload).filter((name) => /^study_[A-Za-z0-9_]+$/.test(name)).sort();
  if (incomingTables.length === 0) return;
  db.pragma('defer_foreign_keys = ON');
  for (const table of incomingTables) {
    const rows = payload[table as `study_${string}`];
    if (!Array.isArray(rows)) continue;
    if (!localTables.has(table)) {
      counts.skipped += rows.length;
      continue;
    }
    const columns = db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
    const allowed = new Set(columns.map((column) => column.name));
    const primaryKeys = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    if (primaryKeys.length === 0) {
      counts.skipped += rows.length;
      continue;
    }
    for (const portable of rows) {
      const row = Object.fromEntries(Object.entries(portable).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, decodePortableValue(value)]));
      if (primaryKeys.some((key) => row[key] === undefined)) throw new Error(`Paquete inválido: falta la clave primaria de ${table}.`);
      const where = primaryKeys.map((key) => `${quoteIdentifier(key)} = ?`).join(' AND ');
      const keyValues = primaryKeys.map((key) => row[key]);
      const local = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`).get(...keyValues) as Record<string, unknown> | undefined;
      const names = Object.keys(row);
      if (!local) {
        const placeholders = names.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`).run(...names.map((name) => row[name]));
        counts.inserted += 1;
        continue;
      }
      const timestampKey = row.updated_at !== undefined ? 'updated_at' : row.created_at !== undefined ? 'created_at' : null;
      if (!timestampKey || String(row[timestampKey] ?? '') <= String(local[timestampKey] ?? '')) {
        counts.skipped += 1;
        continue;
      }
      const mutable = names.filter((name) => !primaryKeys.includes(name));
      if (mutable.length === 0) {
        counts.skipped += 1;
        continue;
      }
      db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${mutable.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${where}`)
        .run(...mutable.map((name) => row[name]), ...keyValues);
      counts.updated += 1;
    }
  }
}

function zeroCounts(): SyncTableCounts {
  return { inserted: 0, updated: 0, skipped: 0 };
}

/** Parents before children so foreign keys resolve on insert. */
function sortFoldersTopologically(folders: FolderRow[]): FolderRow[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const depth = (f: FolderRow, seen = new Set<string>()): number => {
    if (!f.parent_id || seen.has(f.id)) return 0;
    const parent = byId.get(f.parent_id);
    if (!parent) return 0;
    seen.add(f.id);
    return 1 + depth(parent, seen);
  };
  return [...folders].sort((a, b) => depth(a) - depth(b));
}

function mergeFolders(incoming: FolderRow[], counts: SyncTableCounts): void {
  const db = getDb();
  const localIds = new Set((db.prepare('SELECT id FROM note_folders').all() as { id: string }[]).map((r) => r.id));
  for (const folder of sortFoldersTopologically(incoming)) {
    const parentOk = folder.parent_id === null || localIds.has(folder.parent_id);
    const parentId = parentOk ? folder.parent_id : null;
    if (!localIds.has(folder.id)) {
      db.prepare('INSERT INTO note_folders (id, parent_id, name, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        folder.id,
        parentId,
        folder.name,
        folder.order_idx,
        folder.created_at,
        folder.updated_at
      );
      localIds.add(folder.id);
      counts.inserted += 1;
      continue;
    }
    const local = db.prepare('SELECT updated_at FROM note_folders WHERE id = ?').get(folder.id) as { updated_at: string };
    if (folder.updated_at > local.updated_at) {
      db.prepare('UPDATE note_folders SET parent_id = ?, name = ?, order_idx = ?, updated_at = ? WHERE id = ?').run(
        parentId,
        folder.name,
        folder.order_idx,
        folder.updated_at,
        folder.id
      );
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
}

function mergeNotes(incoming: NoteRow[], counts: SyncTableCounts): void {
  const db = getDb();
  const folderIds = new Set((db.prepare('SELECT id FROM note_folders').all() as { id: string }[]).map((r) => r.id));
  for (const note of incoming) {
    const folderId = note.folder_id && folderIds.has(note.folder_id) ? note.folder_id : null;
    const local = db.prepare('SELECT updated_at FROM notes WHERE id = ?').get(note.id) as { updated_at: string } | undefined;
    if (!local) {
      db.prepare(
        'INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(note.id, folderId, note.title, note.kind, note.content, note.source_json, note.order_idx, note.created_at, note.updated_at);
      counts.inserted += 1;
    } else if (note.updated_at > local.updated_at) {
      db.prepare(
        'UPDATE notes SET folder_id = ?, title = ?, kind = ?, content = ?, source_json = ?, order_idx = ?, updated_at = ? WHERE id = ?'
      ).run(folderId, note.title, note.kind, note.content, note.source_json, note.order_idx, note.updated_at, note.id);
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
}

function mergeDrafts(incoming: DraftRow[], counts: SyncTableCounts): void {
  const db = getDb();
  for (const draft of incoming) {
    const local = db.prepare('SELECT updated_at FROM writing_saved_drafts WHERE id = ?').get(draft.id) as
      | { updated_at: string }
      | undefined;
    if (!local) {
      db.prepare(
        'INSERT INTO writing_saved_drafts (id, title, brief_json, selection_json, model_json, draft_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(draft.id, draft.title, draft.brief_json, draft.selection_json, draft.model_json, draft.draft_json, draft.created_at, draft.updated_at);
      counts.inserted += 1;
    } else if (draft.updated_at > local.updated_at) {
      db.prepare(
        'UPDATE writing_saved_drafts SET title = ?, brief_json = ?, selection_json = ?, model_json = ?, draft_json = ?, updated_at = ? WHERE id = ?'
      ).run(draft.title, draft.brief_json, draft.selection_json, draft.model_json, draft.draft_json, draft.updated_at, draft.id);
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
}

function mergeSearches(incoming: SearchRow[], counts: SyncTableCounts): void {
  const db = getDb();
  for (const search of incoming) {
    const exists = db.prepare('SELECT 1 FROM saved_searches WHERE id = ?').get(search.id);
    if (exists) {
      counts.skipped += 1;
      continue;
    }
    db.prepare('INSERT INTO saved_searches (id, name, query, mode, kinds_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      search.id,
      search.name,
      search.query,
      search.mode,
      search.kinds_json,
      search.created_at
    );
    counts.inserted += 1;
  }
}

function mergeFeedback(incoming: FeedbackRow[], counts: SyncTableCounts): void {
  const db = getDb();
  for (const fb of incoming) {
    const local = db
      .prepare(
        'SELECT from_id, to_id, created_at FROM edge_feedback WHERE type = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))'
      )
      .get(fb.type, fb.from_id, fb.to_id, fb.to_id, fb.from_id) as { from_id: string; to_id: string; created_at: string } | undefined;
    if (!local) {
      db.prepare('INSERT INTO edge_feedback (from_id, to_id, type, verdict, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        fb.from_id,
        fb.to_id,
        fb.type,
        fb.verdict,
        fb.note,
        fb.created_at
      );
      counts.inserted += 1;
    } else if (fb.created_at > local.created_at) {
      db.prepare('UPDATE edge_feedback SET verdict = ?, note = ?, created_at = ? WHERE from_id = ? AND to_id = ? AND type = ?').run(
        fb.verdict,
        fb.note,
        fb.created_at,
        local.from_id,
        local.to_id,
        fb.type
      );
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
}

/**
 * Databases merge as atomic units. Absent locally → insert the whole tree.
 * Present on both → the newer `updated_at` wins: a newer incoming copy replaces
 * the entire local tree (columns, rows, cells, attachment blobs, relations,
 * views); an older-or-equal one is skipped. Nothing local is deleted unless a
 * strictly newer replacement arrives for the same database id.
 */
function mergeDatabases(incoming: DbSyncUnit[], counts: SyncTableCounts): void {
  for (const unit of incoming) {
    const localUpdatedAt = getDatabaseUpdatedAt(unit.database.id);
    if (localUpdatedAt === null) {
      replaceDatabaseFromSync(unit);
      counts.inserted += 1;
    } else if (unit.database.updated_at > localUpdatedAt) {
      replaceDatabaseFromSync(unit);
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
}
