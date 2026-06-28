import { v4 as uuid } from 'uuid';
import type {
  CreateNoteFolderInput,
  CreateNoteInput,
  Note,
  NoteFolder,
  NoteKind,
  NoteSource,
  NotesTree,
  UpdateNoteInput,
} from '@shared/types';
import { getDb } from './database';
import { currentEmbeddingConfig, encodeEmbedding, embeddingTextHash } from './ideasRepo';

interface NoteFolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  summary: string | null;
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

const NOTE_KINDS: NoteKind[] = ['markdown', 'assistant', 'writing', 'debate', 'idea'];

function normalizeKind(value: string | null | undefined): NoteKind {
  return NOTE_KINDS.includes(value as NoteKind) ? (value as NoteKind) : 'markdown';
}

function toFolder(row: NoteFolderRow): NoteFolder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    summary: row.summary ?? '',
    orderIdx: row.order_idx,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNote(row: NoteRow): Note {
  let source: NoteSource | null = null;
  if (row.source_json) {
    try {
      source = JSON.parse(row.source_json) as NoteSource;
    } catch {
      // A single corrupt provenance blob must not hide the note's text.
      source = null;
    }
  }
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    kind: normalizeKind(row.kind),
    content: row.content,
    source,
    orderIdx: row.order_idx,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getNotesTree(): NotesTree {
  const folderRows = getDb()
    .prepare('SELECT * FROM note_folders ORDER BY order_idx ASC, name COLLATE NOCASE ASC')
    .all() as NoteFolderRow[];
  const noteRows = getDb()
    .prepare('SELECT * FROM notes ORDER BY order_idx ASC, updated_at DESC')
    .all() as NoteRow[];
  return {
    folders: folderRows.map(toFolder),
    notes: noteRows.map(toNote),
  };
}

function nextFolderOrder(parentId: string | null): number {
  const row = getDb()
    .prepare(
      parentId === null
        ? 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM note_folders WHERE parent_id IS NULL'
        : 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM note_folders WHERE parent_id = ?'
    )
    .get(...(parentId === null ? [] : [parentId])) as { max: number };
  return row.max + 1;
}

function nextNoteOrder(folderId: string | null): number {
  const row = getDb()
    .prepare(
      folderId === null
        ? 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM notes WHERE folder_id IS NULL'
        : 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM notes WHERE folder_id = ?'
    )
    .get(...(folderId === null ? [] : [folderId])) as { max: number };
  return row.max + 1;
}

export function getNoteFolder(id: string): NoteFolder | null {
  const row = getDb().prepare('SELECT * FROM note_folders WHERE id = ?').get(id) as NoteFolderRow | undefined;
  return row ? toFolder(row) : null;
}

export function createNoteFolder(input: CreateNoteFolderInput): NoteFolder {
  const now = new Date().toISOString();
  const id = uuid();
  const parentId = input.parentId ?? null;
  if (parentId && !getNoteFolder(parentId)) throw new Error('La carpeta destino no existe');
  const name = input.name.trim() || 'Carpeta sin título';
  getDb()
    .prepare(
      `INSERT INTO note_folders (id, parent_id, name, order_idx, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, parentId, name, nextFolderOrder(parentId), now, now);
  return getNoteFolder(id)!;
}

export function renameNoteFolder(id: string, name: string): NoteFolder | null {
  const trimmed = name.trim();
  if (!trimmed) return getNoteFolder(id);
  getDb()
    .prepare('UPDATE note_folders SET name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, new Date().toISOString(), id);
  return getNoteFolder(id);
}

/** Set a folder's summary brief (the ideas it is meant to hold). Empty string clears it. */
export function updateNoteFolderSummary(id: string, summary: string): NoteFolder | null {
  if (!getNoteFolder(id)) return null;
  getDb()
    .prepare('UPDATE note_folders SET summary = ?, updated_at = ? WHERE id = ?')
    .run(summary.trim(), new Date().toISOString(), id);
  return getNoteFolder(id);
}

/** Walks the ancestor chain to reject moves that would create a cycle. */
function isDescendant(folderId: string, maybeAncestorId: string): boolean {
  let current: string | null = folderId;
  const guard = new Set<string>();
  while (current) {
    if (current === maybeAncestorId) return true;
    if (guard.has(current)) break;
    guard.add(current);
    const row = getDb().prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(current) as
      | { parent_id: string | null }
      | undefined;
    current = row?.parent_id ?? null;
  }
  return false;
}

export function moveNoteFolder(id: string, parentId: string | null): NoteFolder | null {
  const folder = getNoteFolder(id);
  if (!folder) return null;
  if (parentId) {
    if (parentId === id || !getNoteFolder(parentId) || isDescendant(parentId, id)) {
      // No-op rather than corrupt the tree when the target is invalid or a descendant.
      return folder;
    }
  }
  getDb()
    .prepare('UPDATE note_folders SET parent_id = ?, order_idx = ?, updated_at = ? WHERE id = ?')
    .run(parentId, nextFolderOrder(parentId), new Date().toISOString(), id);
  return getNoteFolder(id);
}

export function deleteNoteFolder(id: string): boolean {
  // ON DELETE CASCADE handles subfolders and their notes (foreign_keys pragma is on).
  return getDb().prepare('DELETE FROM note_folders WHERE id = ?').run(id).changes > 0;
}

export function getNote(id: string): Note | null {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
  return row ? toNote(row) : null;
}

export function createNote(input: CreateNoteInput): Note {
  const now = new Date().toISOString();
  const id = uuid();
  const folderId = input.folderId ?? null;
  if (folderId && !getNoteFolder(folderId)) throw new Error('La carpeta destino no existe');
  const title = input.title.trim() || 'Nota sin título';
  const kind = normalizeKind(input.kind);
  getDb()
    .prepare(
      `INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      folderId,
      title,
      kind,
      input.content ?? '',
      input.source ? JSON.stringify(input.source) : null,
      nextNoteOrder(folderId),
      now,
      now
    );
  return getNote(id)!;
}

export function updateNote(input: UpdateNoteInput): Note | null {
  const existing = getNote(input.id);
  if (!existing) return null;
  const folderChanged = input.folderId !== undefined && input.folderId !== existing.folderId;
  if (input.folderId) {
    if (!getNoteFolder(input.folderId)) throw new Error('La carpeta destino no existe');
  }
  const title = input.title !== undefined ? input.title.trim() || 'Nota sin título' : existing.title;
  const content = input.content !== undefined ? input.content : existing.content;
  const folderId = input.folderId !== undefined ? input.folderId : existing.folderId;
  const orderIdx = folderChanged ? nextNoteOrder(folderId) : existing.orderIdx;
  getDb()
    .prepare(
      'UPDATE notes SET title = ?, content = ?, folder_id = ?, order_idx = ?, updated_at = ? WHERE id = ?'
    )
    .run(title, content, folderId, orderIdx, new Date().toISOString(), input.id);
  return getNote(input.id);
}

export function moveNote(id: string, folderId: string | null): Note | null {
  return updateNote({ id, folderId });
}

export function deleteNote(id: string): boolean {
  return getDb().prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
}

/**
 * Persist an explicit ordering for a set of notes: each note's order_idx becomes
 * its position in `ids`. Used by the AI reorder and its undo. Notes are usually
 * all from one scope (a folder, or the whole workspace); order_idx only needs to
 * be consistent relative to the notes shown together.
 */
export function reorderNotes(ids: string[]): void {
  const db = getDb();
  // Reordering must not bump updated_at — that would corrupt the "by date" sort.
  const stmt = db.prepare('UPDATE notes SET order_idx = ? WHERE id = ?');
  const tx = db.transaction(() => {
    ids.forEach((id, index) => stmt.run(index, id));
  });
  tx();
}

// ── Note embeddings: let chapter-idea relation discovery reach the user's notes ──

/** The text we embed for a note: its title plus a clipped body. */
export function noteEmbeddingText(note: { title: string; content: string }): string {
  return `${note.title}\n${note.content}`.replace(/\s+/g, ' ').trim().slice(0, 8000);
}

/** Notes that lack a current-model embedding for their current text — i.e. need (re)embedding. */
export function notesNeedingEmbedding(): { id: string; title: string; content: string }[] {
  const config = currentEmbeddingConfig();
  const rows = getDb()
    .prepare(
      `SELECT id, title, content, embedding, embedding_provider, embedding_model, embedding_text_hash
         FROM notes
        WHERE content <> '' OR title <> ''`
    )
    .all() as {
    id: string;
    title: string;
    content: string;
    embedding: Buffer | null;
    embedding_provider: string | null;
    embedding_model: string | null;
    embedding_text_hash: string | null;
  }[];
  return rows
    .filter((row) => {
      const hash = embeddingTextHash(noteEmbeddingText(row));
      return (
        !row.embedding ||
        row.embedding_provider !== config.provider ||
        row.embedding_model !== config.model ||
        row.embedding_text_hash !== hash
      );
    })
    .map((row) => ({ id: row.id, title: row.title, content: row.content }));
}

export function updateNoteEmbedding(id: string, text: string, embedding: number[]): void {
  const config = currentEmbeddingConfig();
  getDb()
    .prepare(
      `UPDATE notes
          SET embedding = ?, embedding_provider = ?, embedding_model = ?, embedding_dim = ?, embedding_text_hash = ?
        WHERE id = ?`
    )
    .run(encodeEmbedding(embedding), config.provider, config.model, embedding.length, embeddingTextHash(text), id);
}

export interface SimilarNote {
  id: string;
  title: string;
  content: string;
  similarity: number;
}

/** Notes ranked by cosine similarity to the query vector (current-model embeddings only). */
export function findSimilarNotes(queryEmbedding: number[], threshold: number, limit: number): SimilarNote[] {
  if (limit <= 0) return [];
  const config = currentEmbeddingConfig();
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT id, title, content, vec_cosine(embedding, ?) AS similarity
           FROM notes
          WHERE embedding IS NOT NULL
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_dim = ?
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(encodeEmbedding(queryEmbedding), config.provider, config.model, queryEmbedding.length, threshold, limit) as SimilarNote[];
}
