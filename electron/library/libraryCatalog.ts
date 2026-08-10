import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCatalogItem,
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryCollectionRecord,
  LibraryItemRecord,
  LibraryRebuildResult,
  LibraryStatus,
  LibraryVaultLink,
} from '@shared/libraryTypes';
import { LibraryDiskStore } from './libraryStorage';

type CountRow = { count: number };

function json<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function creatorsText(record: LibraryItemRecord): string {
  return record.metadata.creators.map((creator) =>
    creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')
  ).filter(Boolean).join('; ');
}

function ftsQuery(value: string): string {
  return value.normalize('NFKC').trim().split(/\s+/).filter(Boolean).slice(0, 20)
    .map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}

export class LibraryCatalog {
  private readonly handle: Database.Database;
  readonly file: string;

  constructor(file: string) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.handle = new Database(this.file);
    this.handle.pragma('journal_mode = WAL');
    this.handle.pragma('foreign_keys = ON');
    this.handle.exec(`
      CREATE TABLE IF NOT EXISTS library_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY,
        storage_id TEXT NOT NULL UNIQUE,
        folder_name TEXT NOT NULL,
        source TEXT NOT NULL,
        source_key TEXT,
        citation_key TEXT,
        title TEXT NOT NULL,
        item_type TEXT NOT NULL,
        creators_json TEXT NOT NULL,
        abstract TEXT,
        date_value TEXT,
        year INTEGER,
        doi TEXT,
        isbn_json TEXT NOT NULL,
        issn_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        collection_ids_json TEXT NOT NULL,
        attachment_count INTEGER NOT NULL,
        reader_available INTEGER NOT NULL,
        extraction_status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS library_items_updated ON library_items (deleted_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS library_items_source ON library_items (source, deleted_at);
      CREATE INDEX IF NOT EXISTS library_items_doi ON library_items (doi) WHERE doi IS NOT NULL;
      CREATE TABLE IF NOT EXISTS library_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        position INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_key TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS library_collections_parent ON library_collections (parent_id, position, name);
      CREATE TABLE IF NOT EXISTS library_item_collections (
        item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        collection_id TEXT NOT NULL,
        PRIMARY KEY (item_id, collection_id)
      );
      CREATE INDEX IF NOT EXISTS library_item_collections_collection ON library_item_collections (collection_id, item_id);
      CREATE TABLE IF NOT EXISTS library_attachments (
        id TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (item_id, id)
      );
      CREATE INDEX IF NOT EXISTS library_attachments_hash ON library_attachments (sha256);
      CREATE TABLE IF NOT EXISTS library_vault_links (
        item_id TEXT NOT NULL,
        vault_id TEXT NOT NULL,
        vault_name TEXT NOT NULL,
        vault_type TEXT NOT NULL,
        work_id TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        PRIMARY KEY (item_id, vault_id, work_id)
      );
      CREATE INDEX IF NOT EXISTS library_vault_links_vault ON library_vault_links (vault_id, work_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS library_items_fts USING fts5(
        item_id UNINDEXED,
        title,
        creators,
        abstract,
        tags,
        identifiers,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
  }

  close(): void {
    this.handle.close();
  }

  private putMeta(key: string, value: string): void {
    this.handle.prepare('INSERT OR REPLACE INTO library_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  private getMeta(key: string): string | null {
    const row = this.handle.prepare('SELECT value FROM library_meta WHERE key=?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  rebuild(store: LibraryDiskStore): LibraryRebuildResult {
    const started = Date.now();
    const reconciled = store.reconcile();
    const items = store.scanMaterializedItems();
    const collections = store.scanMaterializedCollections();
    const insertItem = this.handle.prepare(`
      INSERT INTO library_items (
        id, storage_id, folder_name, source, source_key, citation_key, title, item_type,
        creators_json, abstract, date_value, year, doi, isbn_json, issn_json, tags_json,
        metadata_json, collection_ids_json, attachment_count, reader_available,
        extraction_status, revision, updated_at, deleted_at
      ) VALUES (
        @id, @storageId, @folderName, @source, @sourceKey, @citationKey, @title, @itemType,
        @creatorsJson, @abstract, @date, @year, @doi, @isbnJson, @issnJson, @tagsJson,
        @metadataJson, @collectionIdsJson, @attachmentCount, @readerAvailable,
        @extractionStatus, @revision, @updatedAt, @deletedAt
      )
    `);
    const insertFts = this.handle.prepare(`
      INSERT INTO library_items_fts (item_id, title, creators, abstract, tags, identifiers)
      VALUES (@id, @title, @creators, @abstract, @tags, @identifiers)
    `);
    const insertMembership = this.handle.prepare(
      'INSERT OR IGNORE INTO library_item_collections (item_id, collection_id) VALUES (?, ?)'
    );
    const insertAttachment = this.handle.prepare(`
      INSERT INTO library_attachments (id, item_id, file_name, relative_path, mime_type, byte_size, sha256, role)
      VALUES (@id, @itemId, @fileName, @relativePath, @mimeType, @byteSize, @sha256, @role)
    `);
    const insertCollection = this.handle.prepare(`
      INSERT INTO library_collections (id, name, parent_id, position, source, source_key, revision, updated_at, deleted_at)
      VALUES (@id, @name, @parentId, @position, @source, @sourceKey, @revision, @updatedAt, @deletedAt)
    `);
    const rebuiltAt = new Date().toISOString();
    this.handle.transaction(() => {
      this.handle.exec(`
        DELETE FROM library_item_collections;
        DELETE FROM library_attachments;
        DELETE FROM library_items;
        DELETE FROM library_collections;
        DELETE FROM library_items_fts;
      `);
      for (const record of items.records) {
        const folder = store.itemFolder(record.storageId);
        const readerName = record.files?.reader ?? 'reader.md';
        insertItem.run({
          id: record.id,
          storageId: record.storageId,
          folderName: path.basename(folder),
          source: record.source,
          sourceKey: record.sourceKey ?? null,
          citationKey: record.citationKey ?? null,
          title: record.metadata.title,
          itemType: record.metadata.itemType,
          creatorsJson: JSON.stringify(record.metadata.creators),
          abstract: record.metadata.abstract ?? null,
          date: record.metadata.date ?? null,
          year: record.metadata.year ?? null,
          doi: record.metadata.doi ?? null,
          isbnJson: JSON.stringify(record.metadata.isbn ?? []),
          issnJson: JSON.stringify(record.metadata.issn ?? []),
          tagsJson: JSON.stringify(record.metadata.tags ?? []),
          metadataJson: JSON.stringify(record.metadata),
          collectionIdsJson: JSON.stringify(record.collectionIds),
          attachmentCount: record.attachments.length,
          readerAvailable: fs.existsSync(path.join(folder, readerName)) ? 1 : 0,
          extractionStatus: record.extraction?.status ?? 'pending',
          revision: record.clock.revision,
          updatedAt: record.clock.updatedAt,
          deletedAt: record.deletedAt,
        });
        insertFts.run({
          id: record.id,
          title: record.metadata.title,
          creators: creatorsText(record),
          abstract: record.metadata.abstract ?? '',
          tags: (record.metadata.tags ?? []).join(' '),
          identifiers: [record.metadata.doi, ...(record.metadata.isbn ?? []), ...(record.metadata.issn ?? [])].filter(Boolean).join(' '),
        });
        for (const collectionId of record.collectionIds) insertMembership.run(record.id, collectionId);
        for (const attachment of record.attachments) insertAttachment.run({ ...attachment, itemId: record.id });
      }
      for (const record of collections.records) insertCollection.run({
        id: record.id,
        name: record.name,
        parentId: record.parentId,
        position: record.position,
        source: record.source,
        sourceKey: record.sourceKey ?? null,
        revision: record.clock.revision,
        updatedAt: record.clock.updatedAt,
        deletedAt: record.deletedAt,
      });
      this.putMeta('formatVersion', '1');
      this.putMeta('root', store.root);
      this.putMeta('lastRebuiltAt', rebuiltAt);
      this.putMeta('conflicts', String(reconciled.conflicts));
      this.putMeta('invalidRecords', String(reconciled.invalidRecords + items.invalid + collections.invalid));
    })();
    return {
      items: items.records.filter((item) => !item.deletedAt).length,
      collections: collections.records.filter((collection) => !collection.deletedAt).length,
      attachments: items.records.filter((item) => !item.deletedAt).reduce((total, item) => total + item.attachments.length, 0),
      conflicts: reconciled.conflicts,
      invalidRecords: reconciled.invalidRecords + items.invalid + collections.invalid,
      durationMs: Date.now() - started,
    };
  }

  status(root: string, deviceId: string): LibraryStatus {
    const count = (table: string, where = ''): number => Number((this.handle.prepare(
      `SELECT COUNT(*) AS count FROM ${table} ${where}`
    ).get() as CountRow).count);
    const indexedRoot = this.getMeta('root');
    if (indexedRoot !== root) {
      return {
        configured: true, root, formatVersion: 1, deviceId,
        items: 0, collections: 0, attachments: 0, conflicts: 0, invalidRecords: 0, lastRebuiltAt: null,
      };
    }
    return {
      configured: true,
      root,
      formatVersion: Number(this.getMeta('formatVersion')) || 1,
      deviceId,
      items: count('library_items', 'WHERE deleted_at IS NULL'),
      collections: count('library_collections', 'WHERE deleted_at IS NULL'),
      attachments: count('library_attachments', 'JOIN library_items ON library_items.id=library_attachments.item_id WHERE library_items.deleted_at IS NULL'),
      conflicts: Number(this.getMeta('conflicts')) || 0,
      invalidRecords: Number(this.getMeta('invalidRecords')) || 0,
      lastRebuiltAt: this.getMeta('lastRebuiltAt'),
    };
  }

  replaceVaultLinks(links: LibraryVaultLink[]): void {
    const insert = this.handle.prepare(`
      INSERT INTO library_vault_links (item_id, vault_id, vault_name, vault_type, work_id, analysis_json)
      VALUES (@itemId, @vaultId, @vaultName, @vaultType, @workId, @analysisJson)
    `);
    this.handle.transaction(() => {
      this.handle.prepare('DELETE FROM library_vault_links').run();
      for (const link of links) insert.run({ ...link, analysisJson: JSON.stringify(link.analysis) });
    })();
  }

  listVaultLinks(itemId?: string): LibraryVaultLink[] {
    const rows = (itemId
      ? this.handle.prepare('SELECT * FROM library_vault_links WHERE item_id=? ORDER BY vault_name, work_id').all(itemId)
      : this.handle.prepare('SELECT * FROM library_vault_links ORDER BY item_id, vault_name, work_id').all()
    ) as Record<string, unknown>[];
    return rows.map((row) => ({
      itemId: String(row.item_id),
      vaultId: String(row.vault_id),
      vaultName: String(row.vault_name),
      vaultType: String(row.vault_type),
      workId: String(row.work_id),
      analysis: json(row.analysis_json, {
        lightStatus: 'none', deepStatus: 'none', summaryStatus: 'none', ideaCount: 0,
        passageCount: 0, evidenceCount: 0, gapCount: 0, hasSummary: false, hasNotes: false, archived: false,
      }),
    }));
  }

  list(query: LibraryCatalogQuery = {}): LibraryCatalogPage {
    const limit = Math.max(1, Math.min(500, Math.trunc(query.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const where: string[] = [];
    const params: Record<string, unknown> = { limit, offset };
    if (!query.includeDeleted) where.push('i.deleted_at IS NULL');
    if (query.source) { where.push('i.source=@source'); params.source = query.source; }
    if (query.collectionId) {
      where.push('EXISTS (SELECT 1 FROM library_item_collections ic WHERE ic.item_id=i.id AND ic.collection_id=@collectionId)');
      params.collectionId = query.collectionId;
    }
    const normalizedSearch = query.search?.trim();
    let join = '';
    if (normalizedSearch) {
      join = 'JOIN library_items_fts f ON f.item_id=i.id';
      where.push('library_items_fts MATCH @search');
      params.search = ftsQuery(normalizedSearch);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((this.handle.prepare(
      `SELECT COUNT(*) AS count FROM library_items i ${join} ${clause}`
    ).get(params) as CountRow).count);
    const rows = this.handle.prepare(`
      SELECT i.* FROM library_items i ${join} ${clause}
      ORDER BY i.updated_at DESC, i.title COLLATE NOCASE, i.id
      LIMIT @limit OFFSET @offset
    `).all(params) as Record<string, unknown>[];
    const items: LibraryCatalogItem[] = rows.map((row) => ({
      id: String(row.id),
      storageId: String(row.storage_id),
      source: row.source as LibraryCatalogItem['source'],
      sourceKey: row.source_key == null ? null : String(row.source_key),
      citationKey: row.citation_key == null ? null : String(row.citation_key),
      title: String(row.title),
      itemType: row.item_type as LibraryCatalogItem['itemType'],
      creators: json(row.creators_json, []),
      year: row.year == null ? null : Number(row.year),
      date: row.date_value == null ? null : String(row.date_value),
      doi: row.doi == null ? null : String(row.doi),
      isbn: json(row.isbn_json, []),
      issn: json(row.issn_json, []),
      tags: json(row.tags_json, []),
      collectionIds: json(row.collection_ids_json, []),
      attachmentCount: Number(row.attachment_count),
      readerAvailable: Number(row.reader_available) === 1,
      extractionStatus: row.extraction_status as LibraryCatalogItem['extractionStatus'],
      updatedAt: String(row.updated_at),
    }));
    return { items, total, limit, offset };
  }
}

export function validateCollectionForest(records: LibraryCollectionRecord[]): string[] {
  const live = new Map(records.filter((record) => !record.deletedAt).map((record) => [record.id, record]));
  const invalid = new Set<string>();
  for (const record of live.values()) {
    const visited = new Set<string>([record.id]);
    let parentId = record.parentId;
    while (parentId) {
      if (visited.has(parentId)) { for (const id of visited) invalid.add(id); break; }
      visited.add(parentId);
      const parent = live.get(parentId);
      if (!parent) { invalid.add(record.id); break; }
      parentId = parent.parentId;
    }
  }
  return [...invalid].sort();
}
