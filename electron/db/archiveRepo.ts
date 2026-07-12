// Evidence archive store: the user's own files (record photos, CSV/XLSX exports,
// scans) with folders + tags, kept in SQLite so the archive travels with backups
// and .nodussync. File blobs are stored but never loaded by list queries — fetch
// them explicitly with getItemBlob so browsing stays light.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { sanitizeDocMetadata } from '@shared/archiveDocTypes';
import type { ArchiveFolder, ArchiveItem, ArchiveItemInput, ArchiveItemKind } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Folders ──────────────────────────────────────────────────────────────────

interface FolderRow {
  folder_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

function rowToFolder(row: FolderRow): ArchiveFolder {
  return { folderId: row.folder_id, name: row.name, parentId: row.parent_id, createdAt: row.created_at };
}

export function createFolder(name: string, parentId: string | null = null): ArchiveFolder {
  const id = newId('afd');
  getDb()
    .prepare('INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.trim() || 'Carpeta', parentId, now());
  return getFolder(id)!;
}

export function getFolder(folderId: string): ArchiveFolder | null {
  const row = getDb().prepare('SELECT * FROM archive_folders WHERE folder_id = ?').get(folderId) as
    | FolderRow
    | undefined;
  return row ? rowToFolder(row) : null;
}

export function listFolders(): ArchiveFolder[] {
  return (getDb().prepare('SELECT * FROM archive_folders ORDER BY name').all() as FolderRow[]).map(rowToFolder);
}

export function renameFolder(folderId: string, name: string): ArchiveFolder | null {
  getDb().prepare('UPDATE archive_folders SET name = ? WHERE folder_id = ?').run(name.trim() || 'Carpeta', folderId);
  return getFolder(folderId);
}

/** Delete a folder; child folders cascade away and items in it become unfiled. */
export function deleteFolder(folderId: string): void {
  getDb().prepare('DELETE FROM archive_folders WHERE folder_id = ?').run(folderId);
}

// ── Items ────────────────────────────────────────────────────────────────────

interface ItemMetaRow {
  item_id: string;
  folder_id: string | null;
  title: string;
  kind: ArchiveItemKind;
  file_name: string | null;
  mime_type: string | null;
  bytes: number;
  has_blob: number;
  extracted_text: string | null;
  description: string | null;
  content_hash: string | null;
  doc_type: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

const ITEM_META_COLS = `item_id, folder_id, title, kind, file_name, mime_type, bytes,
  (blob IS NOT NULL) AS has_blob, extracted_text, description, content_hash, doc_type, metadata_json, created_at, updated_at`;

const ITEM_META_SELECT = `SELECT ${ITEM_META_COLS} FROM archive_items`;

function parseMetadata(json: string | null): Record<string, string> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function itemTags(itemId: string): string[] {
  return (
    getDb().prepare('SELECT tag FROM archive_item_tags WHERE item_id = ? ORDER BY tag').all(itemId) as {
      tag: string;
    }[]
  ).map((r) => r.tag);
}

function rowToItem(row: ItemMetaRow): ArchiveItem {
  return {
    itemId: row.item_id,
    folderId: row.folder_id,
    title: row.title,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    hasBlob: Boolean(row.has_blob),
    extractedText: row.extracted_text,
    description: row.description,
    contentHash: row.content_hash,
    docType: row.doc_type,
    metadata: parseMetadata(row.metadata_json),
    tags: itemTags(row.item_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Serialise sanitised metadata for a type, or null when empty. */
function metadataJson(docType: string | null | undefined, metadata: Record<string, string> | null | undefined): string | null {
  if (!metadata) return null;
  const clean = sanitizeDocMetadata(docType, metadata);
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

export function createItem(input: ArchiveItemInput): ArchiveItem {
  const db = getDb();
  const id = newId('ait');
  const ts = now();
  const blob = input.blob ? Buffer.from(input.blob) : null;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO archive_items
        (item_id, folder_id, title, kind, file_name, mime_type, bytes, blob, extracted_text, description, content_hash, doc_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.folderId ?? null,
      input.title.trim() || 'Sin título',
      input.kind ?? 'other',
      input.fileName ?? null,
      input.mimeType ?? null,
      input.bytes ?? (blob ? blob.length : 0),
      blob,
      input.extractedText ?? null,
      input.description ?? null,
      input.contentHash ?? null,
      input.docType ?? null,
      metadataJson(input.docType, input.metadata),
      ts,
      ts
    );
    for (const tag of dedupeTags(input.tags)) addTagInternal(id, tag);
  });
  tx();
  return getItem(id)!;
}

export function getItem(itemId: string): ArchiveItem | null {
  const row = getDb().prepare(`${ITEM_META_SELECT} WHERE item_id = ?`).get(itemId) as ItemMetaRow | undefined;
  return row ? rowToItem(row) : null;
}

/** Fetch the stored file bytes for an item, or null if it has none. */
export function getItemBlob(itemId: string): Buffer | null {
  const row = getDb().prepare('SELECT blob FROM archive_items WHERE item_id = ?').get(itemId) as
    | { blob: Buffer | null }
    | undefined;
  return row?.blob ?? null;
}

/** List items (metadata only) filtered by folder, tag and a text search over title + extracted text. */
export function listItems(opts: { folderId?: string | null; tag?: string; search?: string } = {}): ArchiveItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  let join = '';
  if (opts.folderId !== undefined) {
    if (opts.folderId === null) {
      where.push('i.folder_id IS NULL');
    } else {
      where.push('i.folder_id = ?');
      params.push(opts.folderId);
    }
  }
  if (opts.tag) {
    join += ' JOIN archive_item_tags t ON t.item_id = i.item_id';
    where.push('t.tag = ?');
    params.push(opts.tag);
  }
  const search = (opts.search ?? '').trim();
  if (search) {
    where.push('(i.title LIKE ? OR i.extracted_text LIKE ? OR i.description LIKE ? OR i.metadata_json LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `SELECT DISTINCT i.item_id, i.folder_id, i.title, i.kind, i.file_name, i.mime_type, i.bytes,
      (i.blob IS NOT NULL) AS has_blob, i.extracted_text, i.description, i.content_hash, i.doc_type, i.metadata_json, i.created_at, i.updated_at
    FROM archive_items i${join}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY i.updated_at DESC`;
  return (getDb().prepare(sql).all(...params) as ItemMetaRow[]).map(rowToItem);
}

export function updateItem(
  itemId: string,
  patch: Partial<Pick<ArchiveItemInput, 'title' | 'folderId' | 'description' | 'extractedText' | 'docType' | 'metadata'>>
): ArchiveItem | null {
  const existing = getItem(itemId);
  if (!existing) return null;
  const title = patch.title?.trim() ?? existing.title;
  const folderId = patch.folderId !== undefined ? patch.folderId : existing.folderId;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const extractedText = patch.extractedText !== undefined ? patch.extractedText : existing.extractedText;
  const docType = patch.docType !== undefined ? patch.docType : existing.docType;
  // Re-sanitise against the (possibly changed) type; a type change drops stray fields.
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
  getDb()
    .prepare(
      'UPDATE archive_items SET title = ?, folder_id = ?, description = ?, extracted_text = ?, doc_type = ?, metadata_json = ?, updated_at = ? WHERE item_id = ?'
    )
    .run(title, folderId, description, extractedText, docType, metadataJson(docType, metadata), now(), itemId);
  return getItem(itemId);
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM archive_items WHERE item_id = ?').run(itemId);
}

/** Return the item id whose content hash matches, if any (de-dupe on re-import). */
export function findItemByHash(contentHash: string): string | null {
  const row = getDb().prepare('SELECT item_id FROM archive_items WHERE content_hash = ? LIMIT 1').get(contentHash) as
    | { item_id: string }
    | undefined;
  return row?.item_id ?? null;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function dedupeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function addTagInternal(itemId: string, tag: string): void {
  getDb().prepare('INSERT OR IGNORE INTO archive_item_tags (item_id, tag) VALUES (?, ?)').run(itemId, tag);
}

export function addTag(itemId: string, tag: string): void {
  const trimmed = tag.trim();
  if (trimmed) addTagInternal(itemId, trimmed);
}

export function removeTag(itemId: string, tag: string): void {
  getDb().prepare('DELETE FROM archive_item_tags WHERE item_id = ? AND tag = ?').run(itemId, tag);
}

/** All distinct tags with their item counts, for a tag filter UI. */
export function listTags(): { tag: string; count: number }[] {
  return getDb()
    .prepare('SELECT tag, COUNT(*) AS count FROM archive_item_tags GROUP BY tag ORDER BY count DESC, tag')
    .all() as { tag: string; count: number }[];
}

export function archiveCounts(): { items: number; folders: number } {
  const db = getDb();
  return {
    items: (db.prepare('SELECT COUNT(*) AS c FROM archive_items').get() as { c: number }).c,
    folders: (db.prepare('SELECT COUNT(*) AS c FROM archive_folders').get() as { c: number }).c,
  };
}
