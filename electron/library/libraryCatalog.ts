import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCatalogItem,
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryCollectionRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryImportSourceState,
  LibraryExtractionJob,
  LibraryRebuildResult,
  LibraryStatus,
  LibraryVaultLink,
  LibraryCollectionView,
  LibraryCatalogFacets,
  LibrarySmartSearchCondition,
  LibrarySmartSearchGroup,
  LibrarySortRule,
} from '@shared/libraryTypes';
import { LibraryDiskStore } from './libraryStorage';
import { librarySourceIdentityKey } from './libraryRecord';
import { validateLibrarySmartSearchGroup } from './librarySmartCollections';
import { atomicWriteJson } from './libraryPaths';

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

function emptyFacets(): LibraryCatalogFacets {
  return { sources: [], itemTypes: [], extraction: [], attachments: [], years: [], tags: [], vaults: [] };
}

function smartSearchUsesTrash(group: LibrarySmartSearchGroup): boolean {
  return group.rules.some((rule) => 'rules' in rule ? smartSearchUsesTrash(rule) : rule.field === 'trash');
}

function smartSearchSql(group: LibrarySmartSearchGroup, params: Record<string, unknown>, sequence = { value: 0 }): string {
  const conditionSql = (rule: LibrarySmartSearchCondition): string => {
    const key = `smart${sequence.value++}`;
    const raw = rule.value == null ? '' : String(rule.value);
    const value = raw.trim();
    const lower = value.toLocaleLowerCase();
    const like = `%${lower.replace(/[\\%_]/g, '\\$&')}%`;
    const compareText = (column: string) => {
      params[key] = rule.operator === 'contains' ? like : lower;
      const base = rule.operator === 'contains'
        ? `LOWER(COALESCE(${column}, '')) LIKE @${key} ESCAPE '\\'`
        : `LOWER(COALESCE(${column}, '')) = @${key}`;
      return rule.operator === 'not-equals' ? `NOT (${base})` : base;
    };
    if (rule.field === 'title') return compareText('i.title');
    if (rule.field === 'abstract') return compareText('i.abstract');
    if (rule.field === 'creator') return compareText('i.creators_json');
    if (rule.field === 'source') return compareText('i.source');
    if (rule.field === 'itemType') return compareText('i.item_type');
    if (rule.field === 'extraction') return compareText('i.extraction_status');
    if (rule.field === 'date') {
      params[key] = value;
      if (rule.operator === 'before') return `COALESCE(i.date_value, '') < @${key}`;
      if (rule.operator === 'after') return `COALESCE(i.date_value, '') > @${key}`;
      return compareText('i.date_value');
    }
    if (rule.field === 'year') {
      params[key] = Number(value);
      if (!Number.isFinite(params[key])) return '0';
      const operator = rule.operator === 'before' ? '<' : rule.operator === 'after' ? '>' : rule.operator === 'not-equals' ? '<>' : '=';
      return `i.year ${operator} @${key}`;
    }
    if (rule.field === 'tag') {
      params[key] = rule.operator === 'contains' ? like : lower;
      const compare = rule.operator === 'contains'
        ? `LOWER(CAST(tag.value AS TEXT)) LIKE @${key} ESCAPE '\\'`
        : `LOWER(CAST(tag.value AS TEXT)) = @${key}`;
      const exists = `EXISTS (SELECT 1 FROM json_each(i.tags_json) tag WHERE ${compare})`;
      return rule.operator === 'not-equals' ? `NOT (${exists})` : exists;
    }
    if (rule.field === 'collection') {
      params[key] = value;
      const exists = `EXISTS (SELECT 1 FROM library_item_collections smart_collection WHERE smart_collection.item_id=i.id AND smart_collection.collection_id=@${key})`;
      return rule.operator === 'not-equals' ? `NOT (${exists})` : exists;
    }
    if (rule.field === 'attachment') {
      if (rule.operator === 'is-true') return 'i.attachment_count > 0';
      if (rule.operator === 'is-false') return 'i.attachment_count = 0';
      params[key] = rule.operator === 'contains' ? like : lower;
      const compare = rule.operator === 'contains'
        ? `(LOWER(a.file_name) LIKE @${key} ESCAPE '\\' OR LOWER(a.mime_type) LIKE @${key} ESCAPE '\\' OR LOWER(a.role) LIKE @${key} ESCAPE '\\')`
        : `(LOWER(a.mime_type)=@${key} OR LOWER(a.role)=@${key})`;
      const exists = `EXISTS (SELECT 1 FROM library_attachments a WHERE a.item_id=i.id AND ${compare})`;
      return rule.operator === 'not-equals' ? `NOT (${exists})` : exists;
    }
    if (rule.field === 'trash') {
      const truthy = rule.operator === 'is-true' || value === 'true';
      return truthy ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL';
    }
    if (rule.field === 'vault') {
      params[key] = rule.operator === 'contains' ? like : lower;
      const compare = rule.operator === 'contains'
        ? `(LOWER(v.vault_name) LIKE @${key} ESCAPE '\\' OR LOWER(v.vault_id) LIKE @${key} ESCAPE '\\')`
        : `LOWER(v.vault_id)=@${key}`;
      const exists = `EXISTS (SELECT 1 FROM library_vault_links v WHERE v.item_id=i.id AND ${compare})`;
      return rule.operator === 'not-equals' ? `NOT (${exists})` : exists;
    }
    if (rule.field === 'analysis') {
      const [component, freshness] = lower.includes(':') ? lower.split(':', 2) : ['', lower];
      params[key] = freshness;
      if (component && ['extraction', 'light', 'deep', 'passages', 'ideas', 'embeddings', 'summary'].includes(component)) {
        const expression = `LOWER(COALESCE(json_extract(i.analysis_json, '$.components.${component}.freshness'), 'none'))=@${key}`;
        return rule.operator === 'not-equals' ? `NOT (${expression})` : expression;
      }
      const exists = `EXISTS (SELECT 1 FROM json_each(i.analysis_json, '$.components') component WHERE LOWER(COALESCE(json_extract(component.value, '$.freshness'), 'none'))=@${key})`;
      return rule.operator === 'not-equals' ? `NOT (${exists})` : exists;
    }
    return '0';
  };
  const clauses = group.rules.map((rule) => 'rules' in rule ? smartSearchSql(rule, params, sequence) : conditionSql(rule));
  const usesOr = group.mode === 'any' || group.mode === 'not';
  const combined = clauses.length ? `(${clauses.join(usesOr ? ' OR ' : ' AND ')})` : (usesOr ? '0' : '1');
  return group.mode === 'not' ? `NOT ${combined}` : combined;
}

function orderBySql(sort: LibrarySortRule[] | undefined): string {
  const expressions: Record<LibrarySortRule['field'], string> = {
    title: 'i.title COLLATE NOCASE',
    creator: "LOWER(COALESCE(json_extract(i.creators_json, '$[0].lastName'), json_extract(i.creators_json, '$[0].name'), ''))",
    itemType: 'i.item_type COLLATE NOCASE', publicationTitle: "LOWER(COALESCE(json_extract(i.metadata_json, '$.publicationTitle'), ''))",
    publisher: "LOWER(COALESCE(json_extract(i.metadata_json, '$.publisher'), ''))", date: 'i.date_value COLLATE NOCASE',
    year: 'i.year', edition: "LOWER(COALESCE(json_extract(i.metadata_json, '$.edition'), ''))",
    volume: "LOWER(COALESCE(json_extract(i.metadata_json, '$.volume'), ''))", issue: "LOWER(COALESCE(json_extract(i.metadata_json, '$.issue'), ''))",
    pages: "LOWER(COALESCE(json_extract(i.metadata_json, '$.pages'), ''))", doi: "LOWER(COALESCE(i.doi, ''))",
    isbn: "LOWER(COALESCE(json_extract(i.isbn_json, '$[0]'), ''))", issn: "LOWER(COALESCE(json_extract(i.issn_json, '$[0]'), ''))",
    pmid: "LOWER(COALESCE(json_extract(i.metadata_json, '$.pmid'), ''))", pmcid: "LOWER(COALESCE(json_extract(i.metadata_json, '$.pmcid'), ''))",
    arxiv: "LOWER(COALESCE(json_extract(i.metadata_json, '$.arxiv'), ''))", url: "LOWER(COALESCE(json_extract(i.metadata_json, '$.url'), ''))",
    tags: "LOWER(COALESCE(json_extract(i.tags_json, '$[0]'), ''))", language: "LOWER(COALESCE(json_extract(i.metadata_json, '$.language'), ''))",
    citationKey: "LOWER(COALESCE(i.citation_key, ''))",
    source: 'i.source', createdAt: 'i.created_at', updatedAt: 'i.updated_at', extraction: 'i.extraction_status', attachments: 'i.attachment_count',
  };
  const unique = new Set<string>();
  const clauses = (sort ?? []).filter((entry) => {
    if (!expressions[entry.field] || unique.has(entry.field)) return false;
    unique.add(entry.field);
    return true;
  })
    .slice(0, 3).map((entry) => `${expressions[entry.field]} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`);
  return [...clauses, 'i.id ASC'].join(', ');
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
        source_library_id TEXT,
        source_key TEXT,
        source_state TEXT,
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
        analysis_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL,
        created_at TEXT,
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
        source_library_id TEXT,
        source_key TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS library_collections_parent ON library_collections (parent_id, position, name);
      CREATE TABLE IF NOT EXISTS library_item_aliases (
        alias TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS library_item_aliases_item ON library_item_aliases (item_id);
      CREATE TABLE IF NOT EXISTS library_source_identities (
        identity_key TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        library_type TEXT NOT NULL,
        library_id TEXT NOT NULL,
        item_key TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS library_source_identity_parts
        ON library_source_identities (source, library_type, library_id, item_key);
      CREATE TABLE IF NOT EXISTS library_collection_aliases (
        alias TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS library_collection_aliases_collection ON library_collection_aliases (collection_id);
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
      CREATE TABLE IF NOT EXISTS library_import_sources (
        source_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        library_id TEXT NOT NULL,
        library_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        configuration_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_extraction_jobs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress REAL NOT NULL,
        priority INTEGER NOT NULL,
        options_json TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS library_extraction_jobs_queue ON library_extraction_jobs (status, priority DESC, created_at);
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
    this.ensureColumn('library_items', 'source_library_id', 'TEXT');
    this.ensureColumn('library_items', 'source_state', 'TEXT');
    this.ensureColumn('library_items', 'analysis_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('library_items', 'created_at', 'TEXT');
    this.ensureColumn('library_collections', 'source_library_id', 'TEXT');
    this.handle.exec('CREATE INDEX IF NOT EXISTS library_items_source_library ON library_items (source, source_library_id, source_key);');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((entry) => entry.name === column)) this.handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

  private vaultLinksFile(root: string): string {
    return path.join(root, '.nodus', 'vault-links.json');
  }

  private readPersistedVaultLinks(root: string): { exists: boolean; valid: boolean; links: LibraryVaultLink[] } {
    const file = this.vaultLinksFile(root);
    if (!fs.existsSync(file)) return { exists: false, valid: true, links: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { links?: unknown };
      if (!Array.isArray(parsed?.links)) return { exists: true, valid: false, links: [] };
      const links = parsed.links.filter((entry): entry is LibraryVaultLink => {
        if (!entry || typeof entry !== 'object') return false;
        const value = entry as Partial<LibraryVaultLink>;
        return typeof value.itemId === 'string' && typeof value.vaultId === 'string'
          && typeof value.vaultName === 'string' && typeof value.vaultType === 'string'
          && typeof value.workId === 'string' && !!value.analysis && typeof value.analysis === 'object';
      });
      return { exists: true, valid: links.length === parsed.links.length, links };
    } catch { return { exists: true, valid: false, links: [] }; }
  }

  private persistVaultLinks(links = this.listVaultLinks()): void {
    const root = this.getMeta('root'); if (!root) return;
    atomicWriteJson(this.vaultLinksFile(root), {
      format: 'nodus.library-vault-links', formatVersion: 1,
      updatedAt: new Date().toISOString(), links,
    });
  }

  rebuild(store: LibraryDiskStore): LibraryRebuildResult {
    const started = Date.now();
    // Vault links are rebuildable cache state, but their source vaults may be closed.
    // Preserve them inside the same SQLite transaction that replaces the item index,
    // so a crash between rebuild and a migration refresh cannot erase valid links.
    const cachedVaultLinks = this.listVaultLinks();
    const persistedVaultLinks = this.readPersistedVaultLinks(store.root);
    const preservedVaultLinks = persistedVaultLinks.exists && persistedVaultLinks.valid ? persistedVaultLinks.links : cachedVaultLinks;
    const reconciled = store.reconcile();
    const items = store.scanMaterializedItems();
    const collections = store.scanMaterializedCollections();
    const insertItem = this.handle.prepare(`
      INSERT INTO library_items (
        id, storage_id, folder_name, source, source_library_id, source_key, source_state, citation_key, title, item_type,
        creators_json, abstract, date_value, year, doi, isbn_json, issn_json, tags_json,
        metadata_json, collection_ids_json, attachment_count, reader_available,
        extraction_status, analysis_json, revision, created_at, updated_at, deleted_at
      ) VALUES (
        @id, @storageId, @folderName, @source, @sourceLibraryId, @sourceKey, @sourceState, @citationKey, @title, @itemType,
        @creatorsJson, @abstract, @date, @year, @doi, @isbnJson, @issnJson, @tagsJson,
        @metadataJson, @collectionIdsJson, @attachmentCount, @readerAvailable,
        @extractionStatus, @analysisJson, @revision, @createdAt, @updatedAt, @deletedAt
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
    const insertItemAlias = this.handle.prepare(
      'INSERT OR IGNORE INTO library_item_aliases (alias, item_id) VALUES (?, ?)'
    );
    const insertSourceIdentity = this.handle.prepare(`
      INSERT OR IGNORE INTO library_source_identities
        (identity_key, item_id, source, library_type, library_id, item_key)
      VALUES (@identityKey, @itemId, @source, @libraryType, @libraryId, @itemKey)
    `);
    const insertCollection = this.handle.prepare(`
      INSERT INTO library_collections (id, name, parent_id, position, source, source_library_id, source_key, revision, updated_at, deleted_at)
      VALUES (@id, @name, @parentId, @position, @source, @sourceLibraryId, @sourceKey, @revision, @updatedAt, @deletedAt)
    `);
    const insertCollectionAlias = this.handle.prepare(
      'INSERT OR IGNORE INTO library_collection_aliases (alias, collection_id) VALUES (?, ?)'
    );
    const restoreVaultLink = this.handle.prepare(`
      INSERT OR IGNORE INTO library_vault_links (item_id, vault_id, vault_name, vault_type, work_id, analysis_json)
      VALUES (@itemId, @vaultId, @vaultName, @vaultType, @workId, @analysisJson)
    `);
    const rebuiltAt = new Date().toISOString();
    this.handle.transaction(() => {
      this.handle.exec(`
        DELETE FROM library_item_aliases;
        DELETE FROM library_source_identities;
        DELETE FROM library_collection_aliases;
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
          sourceLibraryId: record.sourceLibraryId ?? null,
          sourceKey: record.sourceKey ?? null,
          sourceState: record.sourceState ?? null,
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
          analysisJson: JSON.stringify(record.contentRevision ?? {}),
          revision: record.clock.revision,
          createdAt: record.createdAt,
          updatedAt: record.clock.updatedAt,
          deletedAt: record.deletedAt,
        });
        insertFts.run({
          id: record.id,
          title: record.metadata.title,
          creators: creatorsText(record),
          abstract: record.metadata.abstract ?? '',
          tags: (record.metadata.tags ?? []).join(' '),
          identifiers: [record.metadata.doi, record.metadata.pmid, record.metadata.pmcid, record.metadata.arxiv, ...(record.metadata.isbn ?? []), ...(record.metadata.issn ?? [])].filter(Boolean).join(' '),
        });
        for (const collectionId of record.collectionIds) insertMembership.run(record.id, collectionId);
        for (const attachment of record.attachments) insertAttachment.run({ ...attachment, itemId: record.id });
        if (!record.deletedAt) {
          for (const alias of record.aliases) insertItemAlias.run(alias, record.id);
          for (const identity of record.sourceIdentities) insertSourceIdentity.run({
            identityKey: librarySourceIdentityKey(identity), itemId: record.id, ...identity,
          });
        }
      }
      for (const record of collections.records) {
        insertCollection.run({
          id: record.id,
          name: record.name,
          parentId: record.parentId,
          position: record.position,
          source: record.source,
          sourceLibraryId: record.sourceLibraryId ?? null,
          sourceKey: record.sourceKey ?? null,
          revision: record.clock.revision,
          updatedAt: record.clock.updatedAt,
          deletedAt: record.deletedAt,
        });
        if (!record.deletedAt) for (const alias of record.aliases) insertCollectionAlias.run(alias, record.id);
      }
      const liveItemIds = new Set(items.records.map((record) => record.id));
      for (const link of preservedVaultLinks) {
        const itemId = this.resolveItemId(link.itemId) ?? link.itemId;
        if (!liveItemIds.has(itemId)) continue;
        restoreVaultLink.run({ ...link, itemId, analysisJson: JSON.stringify(link.analysis) });
      }
      this.putMeta('formatVersion', '2');
      this.putMeta('root', store.root);
      this.putMeta('lastRebuiltAt', rebuiltAt);
      this.putMeta('conflicts', String(reconciled.conflicts));
      this.putMeta('invalidRecords', String(reconciled.invalidRecords + items.invalid + collections.invalid));
    })();
    if (persistedVaultLinks.valid) this.persistVaultLinks();
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
        configured: true, root, formatVersion: 2, deviceId,
        items: 0, collections: 0, attachments: 0, conflicts: 0, invalidRecords: 0, lastRebuiltAt: null,
      };
    }
    return {
      configured: true,
      root,
      formatVersion: Number(this.getMeta('formatVersion')) || 2,
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
    this.persistVaultLinks();
  }

  upsertVaultLinks(links: LibraryVaultLink[]): void {
    const insert = this.handle.prepare(`
      INSERT INTO library_vault_links (item_id, vault_id, vault_name, vault_type, work_id, analysis_json)
      VALUES (@itemId, @vaultId, @vaultName, @vaultType, @workId, @analysisJson)
      ON CONFLICT(item_id, vault_id, work_id) DO UPDATE SET
        vault_name=excluded.vault_name, vault_type=excluded.vault_type,
        analysis_json=excluded.analysis_json
    `);
    this.handle.transaction(() => {
      for (const link of links) {
        const itemId = this.resolveItemId(link.itemId) ?? link.itemId;
        this.handle.prepare('DELETE FROM library_vault_links WHERE item_id=? AND vault_id=? AND work_id<>?')
          .run(itemId, link.vaultId, link.workId);
        insert.run({ ...link, itemId, analysisJson: JSON.stringify(link.analysis) });
      }
    })();
    this.persistVaultLinks();
  }

  remapVaultLinks(fromItemIds: string[], toItemId: string): number {
    const from = [...new Set(fromItemIds.filter((id) => id && id !== toItemId))];
    if (!from.length) return 0;
    const placeholders = from.map(() => '?').join(',');
    const links = this.handle.prepare(`SELECT * FROM library_vault_links WHERE item_id IN (${placeholders})`).all(...from) as Record<string, unknown>[];
    const insert = this.handle.prepare(`
      INSERT INTO library_vault_links (item_id, vault_id, vault_name, vault_type, work_id, analysis_json)
      VALUES (@itemId, @vaultId, @vaultName, @vaultType, @workId, @analysisJson)
      ON CONFLICT(item_id, vault_id, work_id) DO UPDATE SET
        vault_name=excluded.vault_name, vault_type=excluded.vault_type, analysis_json=excluded.analysis_json
    `);
    this.handle.transaction(() => {
      for (const row of links) insert.run({
        itemId: toItemId, vaultId: row.vault_id, vaultName: row.vault_name,
        vaultType: row.vault_type, workId: row.work_id, analysisJson: row.analysis_json,
      });
      this.handle.prepare(`DELETE FROM library_vault_links WHERE item_id IN (${placeholders})`).run(...from);
    })();
    this.persistVaultLinks();
    return links.length;
  }

  listVaultLinks(itemId?: string): LibraryVaultLink[] {
    const canonicalItemId = itemId ? this.resolveItemId(itemId) ?? itemId : undefined;
    const rows = (itemId
      ? this.handle.prepare('SELECT * FROM library_vault_links WHERE item_id=? ORDER BY vault_name, work_id').all(canonicalItemId)
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

  getImportSource(sourceId: string): LibraryImportSourceState | null {
    const row = this.handle.prepare('SELECT * FROM library_import_sources WHERE source_id=?').get(sourceId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      sourceId: String(row.source_id),
      source: row.source as LibraryImportSourceState['source'],
      libraryId: String(row.library_id),
      libraryName: String(row.library_name),
      version: Number(row.version),
      importedAt: String(row.imported_at),
      configuration: json(row.configuration_json, {}),
    };
  }

  putImportSource(state: LibraryImportSourceState): void {
    this.handle.prepare(`
      INSERT INTO library_import_sources (source_id, source, library_id, library_name, version, imported_at, configuration_json)
      VALUES (@sourceId, @source, @libraryId, @libraryName, @version, @importedAt, @configurationJson)
      ON CONFLICT(source_id) DO UPDATE SET
        source=excluded.source, library_id=excluded.library_id, library_name=excluded.library_name,
        version=excluded.version, imported_at=excluded.imported_at, configuration_json=excluded.configuration_json
    `).run({ ...state, configurationJson: JSON.stringify(state.configuration) });
  }

  putExtractionJob(job: LibraryExtractionJob): void {
    this.handle.prepare(`
      INSERT INTO library_extraction_jobs (
        id, item_id, status, phase, progress, priority, options_json, attempts, error, created_at, updated_at
      ) VALUES (@id, @itemId, @status, @phase, @progress, @priority, @optionsJson, @attempts, @error, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        item_id=excluded.item_id, status=excluded.status, phase=excluded.phase,
        progress=excluded.progress, priority=excluded.priority, options_json=excluded.options_json,
        attempts=excluded.attempts, error=excluded.error, updated_at=excluded.updated_at
    `).run({ ...job, optionsJson: JSON.stringify(job.options) });
  }

  private extractionJob(row: Record<string, unknown>): LibraryExtractionJob {
    return {
      id: String(row.id), itemId: String(row.item_id),
      status: row.status as LibraryExtractionJob['status'],
      phase: row.phase as LibraryExtractionJob['phase'],
      progress: Number(row.progress), priority: Number(row.priority),
      options: json(row.options_json, {
        ocrMode: 'local', ocrLanguages: 'spa+eng', maxOcrPages: 500,
        extractImages: true, detectTables: true, force: false,
      }),
      attempts: Number(row.attempts), error: row.error == null ? null : String(row.error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  getExtractionJob(id: string): LibraryExtractionJob | null {
    const row = this.handle.prepare('SELECT * FROM library_extraction_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.extractionJob(row) : null;
  }

  findActiveExtractionJob(itemId: string): LibraryExtractionJob | null {
    const row = this.handle.prepare(`
      SELECT * FROM library_extraction_jobs WHERE item_id=? AND status IN ('queued', 'processing')
      ORDER BY created_at DESC LIMIT 1
    `).get(itemId) as Record<string, unknown> | undefined;
    return row ? this.extractionJob(row) : null;
  }

  listExtractionJobs(status?: LibraryExtractionJob['status']): LibraryExtractionJob[] {
    const rows = (status
      ? this.handle.prepare('SELECT * FROM library_extraction_jobs WHERE status=? ORDER BY priority DESC, created_at').all(status)
      : this.handle.prepare('SELECT * FROM library_extraction_jobs ORDER BY updated_at DESC, priority DESC').all()
    ) as Record<string, unknown>[];
    return rows.map((row) => this.extractionJob(row));
  }

  resumeInterruptedExtractionJobs(now = new Date().toISOString()): number {
    return Number(this.handle.prepare(`
      UPDATE library_extraction_jobs SET status='queued', phase='queued', error=NULL, updated_at=? WHERE status='processing'
    `).run(now).changes);
  }

  list(query: LibraryCatalogQuery = {}): LibraryCatalogPage {
    const limit = Math.max(1, Math.min(500, Math.trunc(query.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const where: string[] = [];
    const params: Record<string, unknown> = { limit, offset };
    if (!query.includeDeleted && !(query.smartSearch && smartSearchUsesTrash(query.smartSearch))) where.push('i.deleted_at IS NULL');
    if (query.source) { where.push('i.source=@source'); params.source = query.source; }
    if (query.itemType) { where.push('i.item_type=@itemType'); params.itemType = query.itemType; }
    if (query.tag) { where.push('EXISTS (SELECT 1 FROM json_each(i.tags_json) query_tag WHERE LOWER(CAST(query_tag.value AS TEXT))=LOWER(@tag))'); params.tag = query.tag; }
    if (query.vaultId) { where.push('EXISTS (SELECT 1 FROM library_vault_links query_vault WHERE query_vault.item_id=i.id AND query_vault.vault_id=@vaultId)'); params.vaultId = query.vaultId; }
    if (query.extractionStatus) { where.push('i.extraction_status=@extractionStatus'); params.extractionStatus = query.extractionStatus; }
    if (Number.isInteger(query.yearFrom)) { where.push('i.year>=@yearFrom'); params.yearFrom = query.yearFrom; }
    if (Number.isInteger(query.yearTo)) { where.push('i.year<=@yearTo'); params.yearTo = query.yearTo; }
    if (query.hasAttachments === true) where.push('i.attachment_count>0');
    if (query.hasAttachments === false) where.push('i.attachment_count=0');
    if (query.collectionId) {
      where.push('EXISTS (SELECT 1 FROM library_item_collections ic WHERE ic.item_id=i.id AND ic.collection_id=@collectionId)');
      params.collectionId = this.resolveCollectionId(query.collectionId) ?? query.collectionId;
    }
    if (query.smartSearch) {
      if (!validateLibrarySmartSearchGroup(query.smartSearch)) throw new Error('La búsqueda inteligente no es válida.');
      where.push(smartSearchSql(query.smartSearch, params));
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
      ORDER BY ${orderBySql(query.sort)}
      LIMIT @limit OFFSET @offset
    `).all(params) as Record<string, unknown>[];
    const items: LibraryCatalogItem[] = rows.map((row) => ({
      id: String(row.id),
      storageId: String(row.storage_id),
      source: row.source as LibraryCatalogItem['source'],
      sourceLibraryId: row.source_library_id == null ? null : String(row.source_library_id),
      sourceKey: row.source_key == null ? null : String(row.source_key),
      sourceState: row.source_state == null ? null : row.source_state as LibraryCatalogItem['sourceState'],
      citationKey: row.citation_key == null ? null : String(row.citation_key),
      metadata: json<LibraryItemMetadata>(row.metadata_json, { title: String(row.title), itemType: row.item_type as LibraryItemMetadata['itemType'], creators: [], year: null, isbn: [], issn: [], tags: [] }),
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
      createdAt: row.created_at == null ? String(row.updated_at) : String(row.created_at),
      updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    }));
    const facets = query.includeFacets === false ? emptyFacets() : this.facets(join, clause, params);
    return { items, total, limit, offset, facets };
  }

  private facets(join: string, clause: string, params: Record<string, unknown>): LibraryCatalogFacets {
    const values = (sql: string): Array<{ value: string; count: number }> => (this.handle.prepare(sql).all(params) as Array<Record<string, unknown>>)
      .map((row) => ({ value: String(row.value), count: Number(row.count) }));
    const base = `FROM library_items i ${join}`;
    return {
      sources: values(`SELECT i.source value, COUNT(*) count ${base} ${clause} GROUP BY i.source ORDER BY count DESC, value`),
      itemTypes: values(`SELECT i.item_type value, COUNT(*) count ${base} ${clause} GROUP BY i.item_type ORDER BY count DESC, value`),
      extraction: values(`SELECT i.extraction_status value, COUNT(*) count ${base} ${clause} GROUP BY i.extraction_status ORDER BY count DESC, value`),
      attachments: values(`SELECT CASE WHEN i.attachment_count>0 THEN 'with' ELSE 'without' END value, COUNT(*) count ${base} ${clause} GROUP BY value ORDER BY value`),
      years: values(`SELECT CAST(i.year AS TEXT) value, COUNT(*) count ${base} ${clause ? `${clause} AND` : 'WHERE'} i.year IS NOT NULL GROUP BY i.year ORDER BY i.year DESC`).slice(0, 100),
      tags: values(`SELECT CAST(tag.value AS TEXT) value, COUNT(DISTINCT i.id) count ${base} JOIN json_each(i.tags_json) tag ${clause} GROUP BY tag.value ORDER BY count DESC, value COLLATE NOCASE`).slice(0, 100),
      vaults: values(`SELECT vf.vault_id value, COUNT(DISTINCT i.id) count ${base} JOIN library_vault_links vf ON vf.item_id=i.id ${clause} GROUP BY vf.vault_id ORDER BY count DESC, value`).slice(0, 100),
    };
  }

  listCollections(includeDeleted = false): LibraryCollectionView[] {
    const rows = this.handle.prepare(`
      SELECT c.*, COUNT(DISTINCT CASE WHEN i.deleted_at IS NULL THEN i.id END) AS direct_item_count
      FROM library_collections c
      LEFT JOIN library_item_collections ic ON ic.collection_id=c.id
      LEFT JOIN library_items i ON i.id=ic.item_id
      ${includeDeleted ? '' : 'WHERE c.deleted_at IS NULL'}
      GROUP BY c.id
      ORDER BY c.parent_id, c.position, c.name COLLATE NOCASE, c.id
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), parentId: row.parent_id == null ? null : String(row.parent_id),
      position: Number(row.position), source: row.source as LibraryCollectionView['source'],
      sourceLibraryId: row.source_library_id == null ? null : String(row.source_library_id),
      sourceKey: row.source_key == null ? null : String(row.source_key),
      directItemCount: Number(row.direct_item_count), updatedAt: String(row.updated_at),
    }));
  }

  resolveItemId(reference: string): string | null {
    const direct = this.handle.prepare('SELECT id FROM library_items WHERE id=? AND deleted_at IS NULL')
      .get(reference) as { id: string } | undefined;
    if (direct) return direct.id;
    const alias = this.handle.prepare(`
      SELECT a.item_id AS id FROM library_item_aliases a
      JOIN library_items i ON i.id=a.item_id
      WHERE a.alias=? AND i.deleted_at IS NULL
    `).get(reference) as { id: string } | undefined;
    return alias?.id ?? null;
  }

  resolveCollectionId(reference: string): string | null {
    const direct = this.handle.prepare('SELECT id FROM library_collections WHERE id=? AND deleted_at IS NULL')
      .get(reference) as { id: string } | undefined;
    if (direct) return direct.id;
    const alias = this.handle.prepare(`
      SELECT a.collection_id AS id FROM library_collection_aliases a
      JOIN library_collections c ON c.id=a.collection_id
      WHERE a.alias=? AND c.deleted_at IS NULL
    `).get(reference) as { id: string } | undefined;
    return alias?.id ?? null;
  }

  findItemIdBySourceIdentity(identity: LibraryItemRecord['sourceIdentities'][number]): string | null {
    const row = this.handle.prepare('SELECT item_id FROM library_source_identities WHERE identity_key=?')
      .get(librarySourceIdentityKey(identity)) as { item_id: string } | undefined;
    return row?.item_id ?? null;
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
