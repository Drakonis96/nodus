import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCollectionView,
  LibraryBibliographyImportReport,
  LibraryCatalogItem,
  LibraryDuplicateGroup,
  LibraryItemCollectionPatch,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  LibraryMetadataOverrides,
  LibraryLocalImportReport,
} from '@shared/libraryTypes';
import { canonicalJson, normalizeLibraryMetadata } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, atomicWriteJson, safeLibraryFolderName } from './libraryPaths';
import { LibraryDiskStore } from './libraryStorage';
import { importBibliographyFiles } from './libraryBibliographyImport';

function comparable(value: LibraryItemRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = value;
  return canonicalJson(rest);
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function copyImmutable(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) return;
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function normalizedIdentity(value: string | undefined): string {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function compactIdentifier(value: string | undefined): string {
  return normalizedIdentity(value).replace(/\s+/g, '');
}

function creatorLabel(record: LibraryItemRecord): string {
  const creator = record.metadata.creators[0];
  return creator?.name || [creator?.firstName, creator?.lastName].filter(Boolean).join(' ');
}

function recordCatalogItem(record: LibraryItemRecord, store: LibraryDiskStore): LibraryCatalogItem {
  const reader = record.files?.reader ?? 'reader.md';
  return {
    id: record.id, storageId: record.storageId, source: record.source,
    sourceLibraryId: record.sourceLibraryId ?? null, sourceKey: record.sourceKey ?? null,
    citationKey: record.citationKey ?? null, title: record.metadata.title,
    itemType: record.metadata.itemType, creators: record.metadata.creators, year: record.metadata.year ?? null,
    date: record.metadata.date ?? null, doi: record.metadata.doi ?? null,
    isbn: record.metadata.isbn ?? [], issn: record.metadata.issn ?? [], tags: record.metadata.tags ?? [],
    collectionIds: record.collectionIds, attachmentCount: record.attachments.length,
    readerAvailable: fs.existsSync(path.join(store.itemFolder(record.storageId), reader)),
    extractionStatus: record.extraction?.status ?? 'pending', updatedAt: record.clock.updatedAt,
  };
}

function copyDirectoryIfMissing(source: string, destination: string): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectoryIfMissing(from, to);
    else if (entry.isFile() && !fs.existsSync(to)) copyImmutable(from, to);
  }
}

function itemType(extension: string): LibraryItemType {
  if (['.html', '.htm'].includes(extension)) return 'webpage';
  if (['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension)) return 'dataset';
  return 'document';
}

function mimeType(extension: string): string {
  return ({
    '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.md': 'text/markdown', '.markdown': 'text/markdown',
    '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml', '.jats': 'application/xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

export class LibraryOperations {
  constructor(private readonly store: LibraryDiskStore, private readonly catalog: LibraryCatalog) {}

  listCollections(): LibraryCollectionView[] {
    return this.catalog.listCollections();
  }

  createCollection(name: string, parentId: string | null): LibraryCollectionView {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('La colección necesita un nombre.');
    const canonicalParentId = parentId ? this.catalog.resolveCollectionId(parentId) ?? parentId : null;
    const parent = canonicalParentId ? this.store.readMaterializedCollection(canonicalParentId) : null;
    if (canonicalParentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    const siblings = this.catalog.listCollections().filter((entry) => entry.parentId === canonicalParentId);
    const id = `nodus:collection:${randomUUID()}`;
    this.store.upsertCollection({ id, name: clean, parentId: canonicalParentId, position: siblings.length, source: 'nodus', deletedAt: null });
    this.catalog.rebuild(this.store);
    return this.catalog.listCollections().find((entry) => entry.id === id)!;
  }

  updateCollection(id: string, patch: { name?: string; parentId?: string | null; position?: number }): LibraryCollectionView {
    id = this.catalog.resolveCollectionId(id) ?? id;
    if (patch.parentId) patch = { ...patch, parentId: this.catalog.resolveCollectionId(patch.parentId) ?? patch.parentId };
    const current = this.store.readMaterializedCollection(id);
    if (!current || current.deletedAt) throw new Error('La colección ya no existe.');
    if (current.source !== 'nodus') throw new Error('Las colecciones importadas se reflejan desde su gestor; crea una colección de Nodus para organizarlas aquí.');
    const name = patch.name === undefined ? current.name : patch.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('La colección necesita un nombre.');
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
    if (parentId === id) throw new Error('Una colección no puede contenerse a sí misma.');
    let cursor = parentId;
    while (cursor) {
      if (cursor === id) throw new Error('Ese movimiento crearía un ciclo de colecciones.');
      cursor = this.store.readMaterializedCollection(cursor)?.parentId ?? null;
    }
    this.store.upsertCollection({
      ...current, name, parentId, position: Number.isFinite(patch.position) ? Math.max(0, Math.trunc(patch.position!)) : current.position,
    }, current.clock.revision);
    this.catalog.rebuild(this.store);
    return this.catalog.listCollections().find((entry) => entry.id === id)!;
  }

  deleteCollection(id: string, deleteItems = false): number {
    id = this.catalog.resolveCollectionId(id) ?? id;
    const root = this.store.readMaterializedCollection(id);
    if (!root || root.deletedAt) return 0;
    if (root.source !== 'nodus') throw new Error('Una colección importada solo puede eliminarse en su gestor de origen.');
    const all = this.store.scanMaterializedCollections().records;
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const collection of all) if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) { ids.add(collection.id); changed = true; }
    }
    const now = new Date().toISOString();
    for (const collectionId of ids) {
      const current = this.store.readMaterializedCollection(collectionId);
      if (current && !current.deletedAt) this.store.upsertCollection({ ...current, deletedAt: now }, current.clock.revision);
    }
    for (const item of this.store.scanMaterializedItems().records) {
      if (item.deletedAt || !item.collectionIds.some((collectionId) => ids.has(collectionId))) continue;
      const desired = deleteItems
        ? { ...item, deletedAt: now }
        : { ...item, collectionIds: item.collectionIds.filter((collectionId) => !ids.has(collectionId)) };
      this.store.upsertItem(desired, item.clock.revision);
    }
    this.catalog.rebuild(this.store);
    return ids.size;
  }

  patchItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): number {
    const canonicalItemIds = new Set(itemIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const add = new Set((patch.add ?? []).map((id) => this.catalog.resolveCollectionId(id) ?? id));
    const remove = new Set((patch.remove ?? []).map((id) => this.catalog.resolveCollectionId(id) ?? id));
    for (const id of add) {
      const collection = this.store.readMaterializedCollection(id);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
    }
    let updated = 0;
    for (const item of this.store.scanMaterializedItems().records) {
      if (!canonicalItemIds.has(item.id) || item.deletedAt) continue;
      const collectionIds = [...new Set([...item.collectionIds.filter((id) => !remove.has(id)), ...add])];
      const desired = { ...item, collectionIds };
      if (comparable(item) !== comparable(desired)) { this.store.upsertItem(desired, item.clock.revision); updated += 1; }
    }
    if (updated) this.catalog.rebuild(this.store);
    return updated;
  }

  setItemsDeleted(itemIds: string[], deleted: boolean): number {
    const canonicalItemIds = new Set(itemIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    let updated = 0;
    const now = new Date().toISOString();
    for (const item of this.store.scanMaterializedItems().records) {
      if (!canonicalItemIds.has(item.id) || Boolean(item.deletedAt) === deleted) continue;
      this.store.upsertItem({ ...item, deletedAt: deleted ? now : null }, item.clock.revision);
      updated += 1;
    }
    if (updated) this.catalog.rebuild(this.store);
    return updated;
  }

  importLocalFiles(files: string[], collectionId?: string | null): LibraryLocalImportReport {
    const report: LibraryLocalImportReport = { created: 0, skipped: 0, itemIds: [], warnings: [] };
    const supported = new Set(['.pdf', '.epub', '.md', '.markdown', '.txt', '.html', '.htm', '.xml', '.jats', '.docx', '.csv', '.tsv', '.xlsx', '.xls', '.ods']);
    const knownHashes = new Set(this.store.scanMaterializedItems().records.flatMap((item) => item.attachments.map((entry) => entry.sha256)));
    for (const raw of files) {
      const source = path.resolve(raw);
      const extension = path.extname(source).toLowerCase();
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !supported.has(extension)) {
        report.skipped += 1; report.warnings.push(`Formato no compatible: ${path.basename(source)}`); continue;
      }
      const hash = sha256File(source);
      if (knownHashes.has(hash)) { report.skipped += 1; report.warnings.push(`Ya estaba importado: ${path.basename(source)}`); continue; }
      const uuid = randomUUID();
      const id = `nodus:${uuid}`;
      const storageId = id;
      const folder = this.store.itemFolder(storageId);
      const fileName = safeLibraryFolderName(path.basename(source));
      const relativePath = path.join('attachments', fileName);
      const destination = assertInside(folder, path.join(folder, relativePath));
      copyImmutable(source, destination);
      const stat = fs.statSync(destination);
      this.store.upsertItem({
        id, storageId, source: 'nodus',
        metadata: {
          title: path.basename(source, extension).replace(/[_-]+/g, ' ').trim() || 'Documento sin título',
          itemType: itemType(extension), creators: [], year: null, isbn: [], issn: [], tags: [],
        },
        collectionIds: collectionId ? [collectionId] : [],
        attachments: [{
          id: `local:${uuid}`, title: path.basename(source), fileName: path.basename(source), relativePath,
          mimeType: mimeType(extension), byteSize: stat.size, sha256: hash, role: 'original',
        }],
        files: { original: relativePath, annotations: 'annotations.json' }, extraction: { status: 'pending' }, deletedAt: null,
      });
      knownHashes.add(hash);
      report.created += 1;
      report.itemIds.push(id);
    }
    if (report.created) this.catalog.rebuild(this.store);
    return report;
  }

  importBibliographyFiles(files: string[], collectionId?: string | null): LibraryBibliographyImportReport {
    return importBibliographyFiles({ files, collectionId, store: this.store, catalog: this.catalog });
  }

  updateItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): LibraryItemRecord {
    const canonicalItemId = this.catalog.resolveItemId(itemId) ?? itemId;
    const current = this.store.scanMaterializedItems().records.find((item) => item.id === canonicalItemId && !item.deletedAt);
    if (!current) throw new Error('El documento ya no existe.');
    const merged = normalizeLibraryMetadata({ ...current.metadata, ...patch }, current.metadata.title);
    const overridePatch = Object.fromEntries(Object.keys(patch).map((key) => {
      const value = (patch as Record<string, unknown>)[key];
      return [key, value === undefined ? null : value];
    })) as LibraryMetadataOverrides;
    const imported = current.source !== 'nodus';
    const desired = this.store.upsertItem({
      ...current, metadata: merged,
      ...(imported ? { metadataOverrides: { ...(current.metadataOverrides ?? {}), ...overridePatch } } : {}),
    }, current.clock.revision);
    this.catalog.rebuild(this.store);
    return desired;
  }

  listDuplicateGroups(): LibraryDuplicateGroup[] {
    const records = this.store.scanMaterializedItems().records.filter((item) => !item.deletedAt);
    const emitted = new Set<string>(); const groups: LibraryDuplicateGroup[] = [];
    const collect = (reason: LibraryDuplicateGroup['reason'], keyFor: (item: LibraryItemRecord) => string) => {
      const map = new Map<string, LibraryItemRecord[]>();
      for (const item of records) {
        const key = keyFor(item); if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), item]);
      }
      for (const [key, members] of map) {
        const fresh = members.filter((item) => !emitted.has(item.id));
        if (fresh.length < 2) continue;
        for (const item of fresh) emitted.add(item.id);
        groups.push({ key: `${reason}:${key}`, reason, items: fresh.map((item) => recordCatalogItem(item, this.store)) });
      }
    };
    collect('doi', (item) => compactIdentifier(item.metadata.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')));
    collect('isbn', (item) => compactIdentifier(item.metadata.isbn?.[0]));
    collect('metadata', (item) => {
      const title = normalizedIdentity(item.metadata.title); const creator = normalizedIdentity(creatorLabel(item));
      return title && creator && item.metadata.year != null ? `${title}|${item.metadata.year}|${creator}` : '';
    });
    return groups.sort((a, b) => a.items[0].title.localeCompare(b.items[0].title));
  }

  mergeItems(canonicalId: string, duplicateIds: string[]): LibraryItemRecord {
    const all = this.store.scanMaterializedItems().records;
    const resolvedCanonicalId = this.catalog.resolveItemId(canonicalId) ?? canonicalId;
    const resolvedDuplicateIds = new Set(duplicateIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const canonical = all.find((item) => item.id === resolvedCanonicalId && !item.deletedAt);
    if (!canonical) throw new Error('El documento canónico ya no existe.');
    const duplicates = all.filter((item) => resolvedDuplicateIds.has(item.id) && item.id !== resolvedCanonicalId && !item.deletedAt);
    if (!duplicates.length) return canonical;
    let desired: LibraryItemRecord = canonical;
    const folder = this.store.itemFolder(canonical.storageId);
    const attachments = [...canonical.attachments]; const hashes = new Set(attachments.map((entry) => entry.sha256));
    const files = { ...(canonical.files ?? {}) }; let extraction = canonical.extraction;
    for (const duplicate of duplicates) {
      const duplicateFolder = this.store.itemFolder(duplicate.storageId);
      for (const attachment of duplicate.attachments) {
        if (hashes.has(attachment.sha256)) continue;
        const source = assertInside(duplicateFolder, path.join(duplicateFolder, attachment.relativePath));
        if (!fs.existsSync(source)) continue;
        const relativePath = path.join('attachments', 'merged', `${safeLibraryFolderName(duplicate.storageId)}-${safeLibraryFolderName(attachment.fileName)}`);
        copyImmutable(source, assertInside(folder, path.join(folder, relativePath)));
        const role = !files.original && attachment.role === 'original' ? 'original' : attachment.role === 'original' ? 'supplement' : attachment.role;
        attachments.push({ ...attachment, id: `merged:${randomUUID()}`, relativePath, role }); hashes.add(attachment.sha256);
        if (!files.original && role === 'original') files.original = relativePath;
      }
      if (!files.reader && duplicate.files?.reader) {
        for (const key of ['reader', 'sourceMap', 'qualityReport'] as const) {
          const relative = duplicate.files?.[key]; if (!relative) continue;
          const source = assertInside(duplicateFolder, path.join(duplicateFolder, relative));
          if (fs.existsSync(source)) { copyImmutable(source, assertInside(folder, path.join(folder, relative))); files[key] = relative; }
        }
        copyDirectoryIfMissing(path.join(duplicateFolder, 'assets'), path.join(folder, 'assets'));
        extraction = duplicate.extraction;
      }
      const canonicalAnnotations = readJsonArray(path.join(folder, files.annotations ?? 'annotations.json'));
      const duplicateAnnotations = readJsonArray(path.join(duplicateFolder, duplicate.files?.annotations ?? 'annotations.json'));
      const annotationIds = new Set(canonicalAnnotations.map((entry) => String((entry as { id?: unknown }).id ?? '')));
      for (const annotation of duplicateAnnotations) {
        const id = String((annotation as { id?: unknown }).id ?? ''); if (!id || annotationIds.has(id)) continue;
        canonicalAnnotations.push({ ...(annotation as Record<string, unknown>), documentId: canonical.storageId }); annotationIds.add(id);
      }
      if (duplicateAnnotations.length) { files.annotations = files.annotations ?? 'annotations.json'; atomicWriteJson(path.join(folder, files.annotations), canonicalAnnotations); }
    }
    const fill = (key: keyof LibraryItemMetadata) => desired.metadata[key] || duplicates.map((item) => item.metadata[key]).find(Boolean);
    const metadata = normalizeLibraryMetadata({
      ...desired.metadata,
      abstract: fill('abstract'), date: fill('date'), year: desired.metadata.year ?? duplicates.map((item) => item.metadata.year).find((value) => value != null),
      language: fill('language'), publisher: fill('publisher'), publicationTitle: fill('publicationTitle'), volume: fill('volume'), issue: fill('issue'), pages: fill('pages'),
      doi: fill('doi'), url: fill('url'), isbn: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.isbn ?? [] : []))],
      issn: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.issn ?? [] : []))],
      tags: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.tags ?? [] : []))],
    }, desired.metadata.title);
    desired = this.store.upsertItem({
      ...desired, metadata, collectionIds: [...new Set([canonical, ...duplicates].flatMap((item) => item.collectionIds))],
      aliases: [...new Set([...(desired.aliases ?? []), ...duplicates.flatMap((item) => [item.id, ...item.aliases])])],
      sourceIdentities: [...new Map([desired, ...duplicates].flatMap((item) => item.sourceIdentities)
        .map((identity) => [JSON.stringify(identity), identity])).values()],
      vaultWorkIds: Object.assign({}, ...[...duplicates, desired].map((item) => item.vaultWorkIds ?? {})),
      attachments, files, extraction,
    }, desired.clock.revision);
    const now = new Date().toISOString();
    for (const duplicate of duplicates) this.store.upsertItem({ ...duplicate, deletedAt: now }, duplicate.clock.revision);
    this.catalog.rebuild(this.store);
    return desired;
  }
}

function readJsonArray(file: string): unknown[] {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; }
}
