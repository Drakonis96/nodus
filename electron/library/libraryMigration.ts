import Database from 'better-sqlite3';
import fs from 'node:fs';
import type {
  LibraryCollectionRecord,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  LibraryMigrationProgress,
  LibraryMigrationReport,
  LibraryVaultLink,
} from '@shared/libraryTypes';
import type { VaultSummary } from '@shared/types';
import { canonicalJson } from './libraryRecord';
import { LibraryDiskStore } from './libraryStorage';
import { LibraryCatalog } from './libraryCatalog';

type VaultDescriptor = Pick<VaultSummary, 'id' | 'name' | 'path' | 'type'>;

interface LegacyWorkRow extends Record<string, unknown> {
  nodus_id: string;
  zotero_key: string | null;
  title: string | null;
  authors_json: string | null;
  creators_json?: string | null;
  year: number | null;
  item_type: string | null;
  doi: string | null;
  notes: string | null;
  light_status: string | null;
  deep_status: string | null;
  summary_status: string | null;
  archived: number | null;
  idea_count: number;
  passage_count: number;
  evidence_count: number;
  gap_count: number;
  summary_count: number;
}

interface VaultInventory {
  vault: VaultDescriptor;
  db: Database.Database;
  works: LegacyWorkRow[];
  collections: Array<{ collection_key: string; name: string | null; parent_key: string | null }>;
  memberships: Map<string, string[]>;
  tags: Map<string, string[]>;
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((entry) => entry.name === column);
}

function grouped(rows: Array<{ nodus_id: string; value: string }>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) result.set(row.nodus_id, [...(result.get(row.nodus_id) ?? []), row.value]);
  return result;
}

function readInventory(vault: VaultDescriptor): VaultInventory | null {
  if (!fs.existsSync(vault.path)) return null;
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  if (!tableExists(db, 'works')) { db.close(); return null; }
  const creators = columnExists(db, 'works', 'creators_json') ? 'w.creators_json' : 'NULL AS creators_json';
  const count = (table: string, alias: string): string => tableExists(db, table)
    ? `(SELECT COUNT(*) FROM ${table} ${alias} WHERE ${alias}.nodus_id=w.nodus_id)`
    : '0';
  const works = db.prepare(`
    SELECT w.*, ${creators},
      ${count('idea_occurrences', 'io')} AS idea_count,
      ${count('passages', 'p')} AS passage_count,
      ${count('evidence', 'e')} AS evidence_count,
      ${count('gaps', 'g')} AS gap_count,
      ${count('work_summaries', 'ws')} AS summary_count
    FROM works w ORDER BY w.nodus_id
  `).all() as LegacyWorkRow[];
  let collections: VaultInventory['collections'] = [];
  if (tableExists(db, 'collections')) {
    collections = db.prepare(
      'SELECT collection_key, name, parent_key FROM collections ORDER BY parent_key, name, collection_key'
    ).all() as VaultInventory['collections'];
  }
  let memberships = new Map<string, string[]>();
  if (tableExists(db, 'work_collections')) {
    const rows = db.prepare(
      'SELECT nodus_id, collection_key AS value FROM work_collections ORDER BY nodus_id, collection_key'
    ).all() as Array<{ nodus_id: string; value: string }>;
    memberships = grouped(rows);
  }
  const tags = tableExists(db, 'work_zotero_tags') && tableExists(db, 'zotero_tags')
    ? grouped((db.prepare(`
        SELECT wzt.nodus_id, zt.label AS value
        FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id=wzt.tag_id
        ORDER BY wzt.nodus_id, zt.label COLLATE NOCASE
      `).all() as Array<{ nodus_id: string; value: string }>))
    : new Map<string, string[]>();
  return { vault, db, works, collections, memberships, tags };
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function creatorsFor(row: LegacyWorkRow): LibraryCreator[] {
  const detailed = parseArray(row.creators_json);
  const source = detailed.length ? detailed : parseArray(row.authors_json);
  return source.flatMap((creator) => {
    if (typeof creator === 'string' && creator.trim()) return [{ creatorType: 'author', name: creator.trim() }];
    if (!creator || typeof creator !== 'object') return [];
    const item = creator as Record<string, unknown>;
    const firstName = typeof item.firstName === 'string' ? item.firstName.trim() : '';
    const lastName = typeof item.lastName === 'string' ? item.lastName.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!firstName && !lastName && !name) return [];
    return [{
      creatorType: typeof item.creatorType === 'string' && item.creatorType.trim() ? item.creatorType.trim() : 'author',
      ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(name ? { name } : {}),
    }];
  });
}

function itemType(value: string | null): LibraryItemType {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['journalarticle', 'article', 'articlejournal'].includes(normalized)) return 'article-journal';
  if (['book'].includes(normalized)) return 'book';
  if (['booksection', 'chapter'].includes(normalized)) return 'chapter';
  if (['conferencepaper', 'proceedings'].includes(normalized)) return 'conference-paper';
  if (['thesis'].includes(normalized)) return 'thesis';
  if (['report'].includes(normalized)) return 'report';
  if (['webpage', 'blogpost', 'forumPost'].includes(normalized)) return 'webpage';
  if (['dataset'].includes(normalized)) return 'dataset';
  return normalized ? 'document' : 'other';
}

function zoteroParts(key: string | null): { libraryId: string; rawKey: string } | null {
  if (!key) return null;
  const group = /^groups:([^:]+):(.+)$/.exec(key);
  return group ? { libraryId: `groups/${group[1]}`, rawKey: group[2] } : { libraryId: 'users/0', rawKey: key };
}

function globalCollectionId(key: string, vaultId: string): string {
  return key ? `zotero:${key}` : `nodus:${vaultId}:collection`;
}

function metadataScore(metadata: LibraryItemMetadata): number {
  return Object.values(metadata).reduce((score, value) => score + (
    Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : value ? 1 : 0
  ), 0);
}

function mergeMetadata(current: LibraryItemMetadata | undefined, incoming: LibraryItemMetadata): LibraryItemMetadata {
  if (!current) return incoming;
  const primary = metadataScore(incoming) > metadataScore(current) ? incoming : current;
  const secondary = primary === incoming ? current : incoming;
  return {
    ...secondary,
    ...primary,
    creators: primary.creators.length ? primary.creators : secondary.creators,
    tags: [...new Set([...(current.tags ?? []), ...(incoming.tags ?? [])])],
    isbn: [...new Set([...(current.isbn ?? []), ...(incoming.isbn ?? [])])],
    issn: [...new Set([...(current.issn ?? []), ...(incoming.issn ?? [])])],
  };
}

function comparableItem(record: LibraryItemRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

function comparableCollection(record: LibraryCollectionRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

function migrationProgress(
  phase: LibraryMigrationProgress['phase'], vaultIndex: number, vaultCount: number,
  vault: VaultDescriptor | null, processedItems: number, totalItems: number,
): LibraryMigrationProgress {
  const itemPercent = totalItems ? 10 + Math.round((processedItems / totalItems) * 85) : 10;
  const percent = phase === 'inventory' ? 0
    : phase === 'collections' ? (processedItems ? itemPercent : 5)
      : phase === 'items' ? itemPercent
        : phase === 'catalog' ? 95
          : 100;
  return {
    phase, vaultIndex, vaultCount, vaultId: vault?.id ?? null, vaultName: vault?.name ?? null,
    processedItems, totalItems, percent: Math.max(0, Math.min(100, percent)),
  };
}

export async function migrateVaultLibraries(options: {
  vaults: VaultDescriptor[];
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  onProgress?: (progress: LibraryMigrationProgress) => void;
}): Promise<LibraryMigrationReport> {
  const started = Date.now();
  const { vaults, store, catalog, onProgress } = options;
  const warnings: string[] = [];
  const inventories: VaultInventory[] = [];
  onProgress?.(migrationProgress('inventory', 0, vaults.length, null, 0, 0));
  for (const vault of vaults) {
    try {
      const inventory = readInventory(vault);
      if (inventory) inventories.push(inventory);
      else warnings.push(`La bóveda «${vault.name}» no contiene una biblioteca académica.`);
    } catch (error) {
      warnings.push(`No se pudo leer «${vault.name}»: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const totalItems = inventories.reduce((total, inventory) => total + inventory.works.length, 0);
  let processedItems = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsUnchanged = 0;
  let collectionsCreated = 0;
  let collectionsUpdated = 0;
  let collectionsUnchanged = 0;
  let preservedAnalyses = 0;
  const links: LibraryVaultLink[] = [];
  try {
    for (let vaultIndex = 0; vaultIndex < inventories.length; vaultIndex += 1) {
      const inventory = inventories[vaultIndex];
      onProgress?.(migrationProgress('collections', vaultIndex, inventories.length, inventory.vault, processedItems, totalItems));
      const positions = new Map<string | null, number>();
      for (const collection of inventory.collections) {
        const id = globalCollectionId(collection.collection_key, inventory.vault.id);
        const parentId = collection.parent_key ? globalCollectionId(collection.parent_key, inventory.vault.id) : null;
        const current = store.readMaterializedCollection(id);
        const source = 'zotero' as const;
        const desired = {
          id, name: collection.name?.trim() || collection.collection_key, parentId,
          position: positions.get(parentId) ?? 0, source,
          sourceLibraryId: zoteroParts(collection.collection_key)?.libraryId ?? 'users/0',
          sourceKey: zoteroParts(collection.collection_key)?.rawKey ?? collection.collection_key,
          deletedAt: null,
        };
        positions.set(parentId, desired.position + 1);
        if (!current) { store.upsertCollection(desired); collectionsCreated += 1; }
        else {
          const candidate = { ...current, ...desired };
          if (comparableCollection(current) === comparableCollection(candidate)) collectionsUnchanged += 1;
          else { store.upsertCollection(desired, current.clock.revision); collectionsUpdated += 1; }
        }
      }

      for (const row of inventory.works) {
        const zotero = zoteroParts(row.zotero_key);
        const itemId = zotero ? `zotero:${row.zotero_key}` : `nodus:${inventory.vault.id}:${row.nodus_id}`;
        const storageId = zotero ? String(row.zotero_key) : itemId;
        const current = store.readMaterializedItem(storageId);
        const incomingMetadata: LibraryItemMetadata = {
          title: row.title?.trim() || 'Documento sin título',
          itemType: itemType(row.item_type),
          creators: creatorsFor(row),
          year: Number.isInteger(row.year) ? row.year : null,
          ...(row.doi?.trim() ? { doi: row.doi.trim() } : {}),
          isbn: [], issn: [], tags: inventory.tags.get(row.nodus_id) ?? [],
        };
        const collectionIds = (inventory.memberships.get(row.nodus_id) ?? [])
          .map((key) => globalCollectionId(key, inventory.vault.id));
        const desiredInput = {
          id: itemId,
          storageId,
          source: zotero ? 'zotero' as const : 'nodus' as const,
          ...(zotero ? { sourceLibraryId: zotero.libraryId, sourceKey: zotero.rawKey } : {}),
          ...(current?.citationKey ? { citationKey: current.citationKey } : {}),
          metadata: mergeMetadata(current?.metadata, incomingMetadata),
          collectionIds: [...new Set([...(current?.collectionIds ?? []), ...collectionIds])],
          attachments: current?.attachments ?? [],
          ...(current?.files ? { files: current.files } : {}),
          extraction: current?.extraction ?? { status: 'pending' as const },
          deletedAt: null,
        };
        if (!current) { store.upsertItem(desiredInput); itemsCreated += 1; }
        else {
          const candidate = { ...current, ...desiredInput } as LibraryItemRecord;
          if (comparableItem(current) === comparableItem(candidate)) itemsUnchanged += 1;
          else { store.upsertItem(desiredInput, current.clock.revision); itemsUpdated += 1; }
        }
        const analysis = {
          lightStatus: row.light_status ?? 'none', deepStatus: row.deep_status ?? 'none',
          summaryStatus: row.summary_status ?? 'none', ideaCount: Number(row.idea_count) || 0,
          passageCount: Number(row.passage_count) || 0, evidenceCount: Number(row.evidence_count) || 0,
          gapCount: Number(row.gap_count) || 0, hasSummary: Number(row.summary_count) > 0,
          hasNotes: Boolean(row.notes?.trim()), archived: Number(row.archived) === 1,
        };
        if (analysis.ideaCount || analysis.passageCount || analysis.evidenceCount || analysis.gapCount || analysis.hasSummary || analysis.hasNotes) {
          preservedAnalyses += 1;
        }
        links.push({
          itemId, vaultId: inventory.vault.id, vaultName: inventory.vault.name,
          vaultType: String(inventory.vault.type), workId: row.nodus_id, analysis,
        });
        processedItems += 1;
        onProgress?.(migrationProgress('items', vaultIndex, inventories.length, inventory.vault, processedItems, totalItems));
        if (processedItems % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    onProgress?.(migrationProgress('catalog', inventories.length, inventories.length, null, processedItems, totalItems));
    catalog.rebuild(store);
    catalog.replaceVaultLinks(links);
    onProgress?.(migrationProgress('complete', inventories.length, inventories.length, null, processedItems, totalItems));
  } finally {
    for (const inventory of inventories) inventory.db.close();
  }
  return {
    vaultsScanned: inventories.length,
    itemsDiscovered: totalItems,
    itemsCreated, itemsUpdated, itemsUnchanged,
    collectionsCreated, collectionsUpdated, collectionsUnchanged,
    vaultLinks: links.length,
    preservedAnalyses,
    warnings,
    durationMs: Date.now() - started,
  };
}
