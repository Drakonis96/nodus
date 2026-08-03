import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { NodiNote } from '@shared/types';

/**
 * Nodi's quick notes, in a table of their own.
 *
 * Deliberately **not** in a vault. Nodi is the companion, not a corpus: a jot made while
 * reading one vault is still there when the next one is open, and putting it in a vault's
 * SQLite would tie it to a publication it has nothing to do with — and hide it from every
 * other vault. So this is its own small database in the user-data directory, install-wide,
 * beside the app rather than inside any of its libraries.
 *
 * It replaces `nodi-notes.json`, which was the same idea without a schema. A JSON array is
 * fine until two things need it at once: the companion writing a note and the server sync
 * merging one. What the table adds is exactly what that needs — a row identity, an
 * `updated_at` to merge on, and a `deleted_at` so a deletion can travel instead of looking
 * like a note the other device has not heard of yet.
 */

let db: Database.Database | null = null;

export interface StoredNodiNote extends NodiNote {
  /** Epoch milliseconds when this note was deleted, or null while it is live. */
  deletedAt: number | null;
}

function databasePath(): string {
  return path.join(app.getPath('userData'), 'nodi.sqlite');
}

function legacyPath(): string {
  return path.join(app.getPath('userData'), 'nodi-notes.json');
}

export function getNodiDb(): Database.Database {
  if (db) return db;
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new Database(file);
  handle.pragma('journal_mode = WAL');
  handle.exec(`
    CREATE TABLE IF NOT EXISTS nodi_notes (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      title_explicit INTEGER NOT NULL DEFAULT 0,
      content        TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      deleted_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS nodi_notes_updated ON nodi_notes (updated_at DESC);
    CREATE TABLE IF NOT EXISTS nodi_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db = handle;
  importLegacyNotes(handle);
  return handle;
}

/**
 * Move `nodi-notes.json` in, once.
 *
 * The file is left where it is rather than deleted: it costs a few kilobytes and it is the
 * only copy of these notes if anything about this migration turns out to be wrong.
 */
function importLegacyNotes(handle: Database.Database): void {
  const done = handle.prepare(`SELECT value FROM nodi_meta WHERE key = 'legacyImported'`).get() as
    | { value: string }
    | undefined;
  if (done) return;
  let notes: NodiNote[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyPath(), 'utf8')) as { notes?: NodiNote[] };
    notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
  } catch {
    notes = [];
  }
  const insert = handle.prepare(`
    INSERT OR IGNORE INTO nodi_notes (id, title, title_explicit, content, created_at, updated_at, deleted_at)
    VALUES (@id, @title, @titleExplicit, @content, @createdAt, @updatedAt, NULL)
  `);
  handle.transaction(() => {
    for (const note of notes) {
      insert.run({
        id: String(note.id),
        title: String(note.title ?? ''),
        titleExplicit: note.titleExplicit ? 1 : 0,
        content: String(note.content ?? ''),
        createdAt: Number(note.createdAt) || Date.now(),
        updatedAt: Number(note.updatedAt) || Date.now(),
      });
    }
    handle.prepare(`INSERT OR REPLACE INTO nodi_meta (key, value) VALUES ('legacyImported', ?)`)
      .run(String(notes.length));
  })();
}

function toNote(row: Record<string, unknown>): StoredNodiNote {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    titleExplicit: Number(row.title_explicit) === 1,
    content: String(row.content ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

/** Live notes, newest first. */
export function selectLiveNotes(limit = 500): StoredNodiNote[] {
  return (getNodiDb()
    .prepare(`SELECT * FROM nodi_notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[]).map(toNote);
}

/** Everything, tombstones included, that changed after `since`. What the sync sends. */
export function selectNotesChangedSince(since: number): StoredNodiNote[] {
  return (getNodiDb()
    .prepare(`SELECT * FROM nodi_notes WHERE updated_at > ? ORDER BY updated_at ASC`)
    .all(Number.isFinite(since) ? since : 0) as Record<string, unknown>[]).map(toNote);
}

export function selectNote(id: string): StoredNodiNote | null {
  const row = getNodiDb().prepare(`SELECT * FROM nodi_notes WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toNote(row) : null;
}

export function upsertNote(note: StoredNodiNote): void {
  getNodiDb()
    .prepare(`
      INSERT INTO nodi_notes (id, title, title_explicit, content, created_at, updated_at, deleted_at)
      VALUES (@id, @title, @titleExplicit, @content, @createdAt, @updatedAt, @deletedAt)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, title_explicit = excluded.title_explicit,
        content = excluded.content, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `)
    .run({
      id: note.id,
      title: note.title,
      titleExplicit: note.titleExplicit ? 1 : 0,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
    });
}

/**
 * Apply what the server sent, newest-wins, a deletion winning a tie.
 *
 * The same rule `server/lib/core/nodiNotes.mjs` merges by, because both sides have to agree
 * or a note would flip between two states forever.
 */
export function mergeIncoming(notes: StoredNodiNote[]): number {
  const handle = getNodiDb();
  let applied = 0;
  handle.transaction(() => {
    for (const incoming of notes) {
      const existing = selectNote(incoming.id);
      if (existing) {
        if (incoming.updatedAt < existing.updatedAt) continue;
        if (incoming.updatedAt === existing.updatedAt && incoming.deletedAt === null) continue;
      }
      upsertNote(incoming);
      applied += 1;
    }
  })();
  return applied;
}

export function readMeta(key: string): string | null {
  const row = getNodiDb().prepare(`SELECT value FROM nodi_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function writeMeta(key: string, value: string): void {
  getNodiDb().prepare(`INSERT OR REPLACE INTO nodi_meta (key, value) VALUES (?, ?)`).run(key, value);
}

export function closeNodiDb(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}
