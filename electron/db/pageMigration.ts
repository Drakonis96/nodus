import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createPageYState } from '@shared/pageYjs';
import { markdownToPageBlocks, pageBlockNormalizedText, type PageBlockDraft } from '@shared/pages';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function insertBlocks(db: Database.Database, pageId: string, blocks: PageBlockDraft[], timestamp: string): void {
  const insert = db.prepare(
    `INSERT INTO page_blocks
      (id, page_id, parent_block_id, sort_order, type, content_json, normalized_text,
       revision, created_by, updated_by, created_at, updated_at, trashed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'migration', 'migration', ?, ?, NULL)`,
  );
  blocks.forEach((entry, index) => {
    const id = entry.id ?? `pblk:${hash(`${pageId}\0${index}`).slice(0, 32)}`;
    const content = entry.content ?? {};
    insert.run(
      id, pageId, entry.parentBlockId ?? null, entry.order ?? (index + 1) * 1024,
      entry.type, JSON.stringify(content), pageBlockNormalizedText(entry.type, content), timestamp, timestamp,
    );
    entry.id = id;
    entry.order = entry.order ?? (index + 1) * 1024;
  });
}

/** Backfill page documents without ever interpreting an unknown Markdown construct away. */
export function migrateUniversalPages(db: Database.Database): void {
  const timestamp = new Date().toISOString();
  const empty = createPageYState('', []);
  const insertDocument = db.prepare(
    `INSERT OR IGNORE INTO page_documents
      (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
       markdown_hash, update_count, created_at, updated_at)
     VALUES (?, 1, 0, 1, ?, ?, ?, 0, ?, ?)`,
  );
  const allPages = db.prepare('SELECT id FROM pages ORDER BY id').all() as Array<{ id: string }>;
  for (const page of allPages) insertDocument.run(page.id, Buffer.from(empty.state), Buffer.from(empty.stateVector), hash(''), timestamp, timestamp);

  const notes = db.prepare(
    `SELECT note.id, note.title, note.content, page.id AS page_id
     FROM notes note JOIN pages page ON page.note_id = note.id ORDER BY note.created_at, note.id`,
  ).all() as Array<{ id: string; title: string; content: string; page_id: string }>;
  const updateDocument = db.prepare(
    `UPDATE page_documents SET snapshot_blob = ?, state_vector = ?, markdown_hash = ?,
       revision = 1, snapshot_sequence = 0, next_update_sequence = 1, update_count = 0, updated_at = ?
     WHERE page_id = ?`,
  );
  const updateNote = db.prepare('UPDATE notes SET page_markdown_hash = ? WHERE id = ?');
  for (const note of notes) {
    let sequence = 0;
    const blocks = markdownToPageBlocks(note.content, () => `pblk:${hash(`${note.page_id}\0${sequence++}`).slice(0, 32)}`);
    insertBlocks(db, note.page_id, blocks, timestamp);
    const yjs = createPageYState(note.title, blocks);
    const markdownHash = hash(note.content.replace(/\r\n?/g, '\n').trimEnd());
    updateDocument.run(Buffer.from(yjs.state), Buffer.from(yjs.stateVector), markdownHash, timestamp, note.page_id);
    updateNote.run(markdownHash, note.id);
  }
}

/** Ensure page/document cardinality remains one-to-one for pages created by SQL triggers. */
export function backfillUniversalPageDocuments(db: Database.Database): void {
  const timestamp = new Date().toISOString();
  const missing = db.prepare(
    `SELECT page.id, page.title
     FROM pages page LEFT JOIN page_documents document ON document.page_id = page.id
     WHERE document.page_id IS NULL ORDER BY page.id`,
  ).all() as Array<{ id: string; title: string }>;
  const readBlocks = db.prepare(
    `SELECT id, parent_block_id, sort_order, type, content_json
     FROM page_blocks WHERE page_id = ? AND trashed_at IS NULL ORDER BY sort_order, id`,
  );
  const insertDocument = db.prepare(
    `INSERT INTO page_documents
      (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
       markdown_hash, update_count, created_at, updated_at)
     VALUES (?, 1, 0, 1, ?, ?, ?, 0, ?, ?)`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO page_document_snapshots
      (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?)`,
  );
  for (const page of missing) {
    const blocks = (readBlocks.all(page.id) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      parentBlockId: row.parent_block_id == null ? null : String(row.parent_block_id),
      order: Number(row.sort_order),
      type: String(row.type) as PageBlockDraft['type'],
      content: JSON.parse(String(row.content_json || '{}')) as Record<string, unknown>,
    }));
    const yjs = createPageYState(page.title, blocks);
    const markdownHash = hash('');
    insertDocument.run(page.id, Buffer.from(yjs.state), Buffer.from(yjs.stateVector), markdownHash, timestamp, timestamp);
    insertSnapshot.run(randomUUID(), page.id, Buffer.from(yjs.state), Buffer.from(yjs.stateVector), markdownHash, timestamp);
  }
}
