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
  LibraryAttachmentPatch,
  LibraryAttachmentRecord,
  LibraryNoteRecord,
  LibraryItemRelationType,
  LibraryTagPatch,
  LibraryTagRecord,
  LibrarySavedSearchRecord,
  LibrarySmartSearchGroup,
  LibraryViewPreferences,
} from '@shared/libraryTypes';
import { canonicalJson, normalizeLibraryMetadata } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, atomicWriteJson, safeLibraryFolderName } from './libraryPaths';
import { LibraryDiskStore } from './libraryStorage';
import { importBibliographyFiles } from './libraryBibliographyImport';
import { bibliographicFingerprint } from './libraryRevision';
import { LibrarySmartCollectionStore } from './librarySmartCollections';

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
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.odt': 'application/vnd.oasis.opendocument.text', '.rtf': 'application/rtf',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odp': 'application/vnd.oasis.opendocument.presentation', '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

const SUPPORTED_ATTACHMENTS = new Set([
  '.pdf', '.epub', '.md', '.markdown', '.txt', '.html', '.htm', '.xml', '.jats',
  '.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx', '.odp',
  '.csv', '.tsv', '.xlsx', '.xls', '.ods',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tif', '.tiff',
]);

function orderedAttachments(attachments: LibraryAttachmentRecord[]): LibraryAttachmentRecord[] {
  return attachments.map((entry, index) => ({ ...entry, position: entry.position ?? index }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
    .map((entry, position) => ({ ...entry, position }));
}

function inverseRelation(type: LibraryItemRelationType): LibraryItemRelationType {
  if (type === 'cites') return 'is-cited-by';
  if (type === 'is-cited-by') return 'cites';
  if (type === 'corrects') return 'is-corrected-by';
  if (type === 'is-corrected-by') return 'corrects';
  return 'related';
}

export class LibraryOperations {
  private readonly smartCollections: LibrarySmartCollectionStore;

  constructor(private readonly store: LibraryDiskStore, private readonly catalog: LibraryCatalog) {
    this.smartCollections = new LibrarySmartCollectionStore(store.root);
  }

  listCollections(): LibraryCollectionView[] {
    return this.catalog.listCollections();
  }

  createCollection(name: string, parentId: string | null): LibraryCollectionView {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('La colección necesita un nombre.');
    const canonicalParentId = parentId ? this.catalog.resolveCollectionId(parentId) ?? parentId : null;
    const parent = canonicalParentId ? this.store.readMaterializedCollection(canonicalParentId) : null;
    if (canonicalParentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    if (parent && parent.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
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
    const parent = parentId ? this.store.readMaterializedCollection(parentId) : null;
    if (parentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    if (parent && parent.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
    let cursor = parentId;
    while (cursor) {
      if (cursor === id) throw new Error('Ese movimiento crearía un ciclo de colecciones.');
      cursor = this.store.readMaterializedCollection(cursor)?.parentId ?? null;
    }
    const all = this.store.scanMaterializedCollections().records.filter((entry) => !entry.deletedAt);
    const oldSiblings = all.filter((entry) => entry.parentId === current.parentId && entry.id !== id)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const targetSiblings = (parentId === current.parentId ? oldSiblings : all.filter((entry) => entry.parentId === parentId && entry.id !== id))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const requestedPosition = patch.position === undefined
      ? (parentId === current.parentId ? current.position : targetSiblings.length)
      : Math.max(0, Math.trunc(patch.position));
    targetSiblings.splice(Math.min(requestedPosition, targetSiblings.length), 0, { ...current, name, parentId });
    const desiredPositions = new Map(targetSiblings.map((entry, position) => [entry.id, position]));
    const write = (entry: typeof current, desiredParentId: string | null, desiredPosition: number, desiredName = entry.name) => {
      if (entry.parentId === desiredParentId && entry.position === desiredPosition && entry.name === desiredName) return;
      this.store.upsertCollection({ ...entry, name: desiredName, parentId: desiredParentId, position: desiredPosition }, entry.clock.revision);
    };
    write(current, parentId, desiredPositions.get(id) ?? requestedPosition, name);
    for (const sibling of targetSiblings) if (sibling.id !== id) write(sibling, parentId, desiredPositions.get(sibling.id)!);
    if (parentId !== current.parentId) for (const [position, sibling] of oldSiblings.entries()) write(sibling, current.parentId, position);
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
    for (const id of new Set([...add, ...remove])) {
      const collection = this.store.readMaterializedCollection(id);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
      if (collection.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
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

  listSavedSearches(): LibrarySavedSearchRecord[] {
    return this.smartCollections.list();
  }

  saveSavedSearch(input: { id?: string; name: string; query: LibrarySmartSearchGroup }): LibrarySavedSearchRecord {
    return this.smartCollections.save(input);
  }

  deleteSavedSearch(id: string): boolean {
    return this.smartCollections.delete(id);
  }

  getViewPreferences(): LibraryViewPreferences {
    return this.smartCollections.preferences();
  }

  setViewPreferences(value: LibraryViewPreferences): LibraryViewPreferences {
    return this.smartCollections.setPreferences(value);
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
    const knownHashes = new Set(this.store.scanMaterializedItems().records.flatMap((item) => item.attachments.map((entry) => entry.sha256)));
    for (const raw of files) {
      const source = path.resolve(raw);
      const extension = path.extname(source).toLowerCase();
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) {
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
          mimeType: mimeType(extension), byteSize: stat.size, sha256: hash, role: 'original', position: 0, addedAt: new Date().toISOString(),
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

  createItem(metadata: LibraryItemMetadata, collectionIds: string[] = []): LibraryItemRecord {
    for (const collectionId of collectionIds) {
      const collection = this.store.readMaterializedCollection(this.catalog.resolveCollectionId(collectionId) ?? collectionId);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
    }
    const id = `nodus:${randomUUID()}`;
    const result = this.store.upsertItem({
      id, storageId: id, source: 'nodus', metadata: normalizeLibraryMetadata(metadata),
      collectionIds: [...new Set(collectionIds.map((entry) => this.catalog.resolveCollectionId(entry) ?? entry))],
      attachments: [], notes: [], relations: [], files: { annotations: 'annotations.json' },
      extraction: { status: 'pending' }, deletedAt: null,
    });
    this.catalog.rebuild(this.store);
    return result;
  }

  private item(itemId: string): LibraryItemRecord {
    const id = this.catalog.resolveItemId(itemId) ?? itemId;
    const item = this.store.scanMaterializedItems().records.find((entry) => entry.id === id && !entry.deletedAt);
    if (!item) throw new Error('El documento ya no existe.');
    return item;
  }

  duplicateItem(itemId: string): LibraryItemRecord {
    const current = this.item(itemId);
    const id = `nodus:${randomUUID()}`;
    const destinationFolder = this.store.itemFolder(id);
    const sourceFolder = this.store.itemFolder(current.storageId);
    for (const attachment of current.attachments) {
      const source = assertInside(sourceFolder, path.join(sourceFolder, attachment.relativePath));
      if (fs.existsSync(source)) copyImmutable(source, assertInside(destinationFolder, path.join(destinationFolder, attachment.relativePath)));
    }
    for (const relative of Object.values(current.files ?? {})) {
      if (!relative) continue;
      const source = assertInside(sourceFolder, path.join(sourceFolder, relative));
      if (fs.existsSync(source) && fs.statSync(source).isFile()) copyImmutable(source, assertInside(destinationFolder, path.join(destinationFolder, relative)));
    }
    copyDirectoryIfMissing(path.join(sourceFolder, 'assets'), path.join(destinationFolder, 'assets'));
    const now = new Date().toISOString();
    const result = this.store.upsertItem({
      id, storageId: id, source: 'nodus', citationKey: undefined,
      metadata: current.metadata, collectionIds: current.collectionIds,
      attachments: orderedAttachments(current.attachments.map((entry) => ({ ...entry, id: `local:${randomUUID()}`, sourceKey: undefined }))),
      notes: (current.notes ?? []).filter((note) => note.source === 'nodus').map((note) => ({ ...note, id: `note:${randomUUID()}`, createdAt: now, updatedAt: now })),
      relations: [], files: current.files, extraction: current.extraction, contentRevision: current.contentRevision,
      deletedAt: null,
    });
    this.catalog.rebuild(this.store);
    return result;
  }

  convertItemToNodus(itemId: string): LibraryItemRecord {
    const current = this.item(itemId);
    return current.source === 'nodus' ? current : this.duplicateItem(current.id);
  }

  addAttachments(itemId: string, files: string[]): LibraryItemRecord {
    const current = this.item(itemId);
    const folder = this.store.itemFolder(current.storageId);
    const hashes = new Set(current.attachments.map((entry) => entry.sha256));
    const additions: LibraryAttachmentRecord[] = [];
    const now = new Date().toISOString();
    for (const raw of files) {
      const source = path.resolve(raw); const extension = path.extname(source).toLowerCase();
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) throw new Error(`Formato no compatible: ${path.basename(source)}`);
      const sha256 = sha256File(source); if (hashes.has(sha256)) continue;
      const id = `local:${randomUUID()}`; const fileName = path.basename(source);
      const relativePath = path.join('attachments', `${id.slice(6, 14)}-${safeLibraryFolderName(fileName)}`);
      const destination = assertInside(folder, path.join(folder, relativePath)); copyImmutable(source, destination);
      const detectedMime = mimeType(extension);
      additions.push({ id, title: fileName, fileName, relativePath, mimeType: detectedMime,
        byteSize: fs.statSync(destination).size, sha256,
        role: current.attachments.length + additions.length === 0 ? 'original' : detectedMime.startsWith('image/') ? 'image' : 'supplement',
        position: current.attachments.length + additions.length, addedAt: now });
      hashes.add(sha256);
    }
    if (!additions.length) return current;
    const attachments = orderedAttachments([...current.attachments, ...additions]);
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), original: primary.relativePath } }, current.clock.revision);
    this.catalog.rebuild(this.store); return result;
  }

  updateAttachment(itemId: string, attachmentId: string, patch: LibraryAttachmentPatch): LibraryItemRecord {
    const current = this.item(itemId); const target = current.attachments.find((entry) => entry.id === attachmentId);
    if (!target) throw new Error('El adjunto ya no existe.');
    const folder = this.store.itemFolder(current.storageId); let relativePath = target.relativePath;
    const fileName = patch.fileName?.trim() ? safeLibraryFolderName(path.basename(patch.fileName.trim())) : target.fileName;
    if (fileName !== target.fileName) {
      const source = assertInside(folder, path.join(folder, target.relativePath));
      relativePath = path.join('attachments', `${target.id.replace(/[^a-z0-9]/gi, '').slice(-8)}-${fileName}`);
      if (fs.existsSync(source)) copyImmutable(source, assertInside(folder, path.join(folder, relativePath)));
    }
    const desired = { ...target, title: patch.title?.trim() || target.title, fileName, relativePath,
      role: patch.makePrimary ? 'original' as const : patch.role ?? target.role };
    const remaining = orderedAttachments(current.attachments.filter((entry) => entry.id !== attachmentId)
      .map((entry) => patch.makePrimary && entry.role === 'original' ? { ...entry, role: 'supplement' as const } : entry));
    remaining.splice(Math.max(0, Math.min(remaining.length, patch.position ?? target.position ?? remaining.length)), 0, desired);
    const attachments = remaining.map((entry, position) => ({ ...entry, position }));
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), ...(primary ? { original: primary.relativePath } : {}) } }, current.clock.revision);
    this.catalog.rebuild(this.store); return result;
  }

  replaceAttachment(itemId: string, attachmentId: string, file: string): LibraryItemRecord {
    const current = this.item(itemId); const target = current.attachments.find((entry) => entry.id === attachmentId);
    if (!target) throw new Error('El adjunto ya no existe.');
    const source = path.resolve(file); const extension = path.extname(source).toLowerCase();
    if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) throw new Error(`Formato no compatible: ${path.basename(source)}`);
    const sha256 = sha256File(source); const fileName = path.basename(source);
    const relativePath = path.join('attachments', `${attachmentId.replace(/[^a-z0-9]/gi, '').slice(-8)}-${sha256.slice(0, 10)}-${safeLibraryFolderName(fileName)}`);
    const folder = this.store.itemFolder(current.storageId); const destination = assertInside(folder, path.join(folder, relativePath));
    copyImmutable(source, destination);
    const attachments = orderedAttachments(current.attachments.map((entry) => entry.id === attachmentId ? {
      ...entry, title: fileName, fileName, relativePath, mimeType: mimeType(extension), byteSize: fs.statSync(destination).size, sha256, addedAt: new Date().toISOString(),
    } : entry));
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), ...(primary ? { original: primary.relativePath } : {}) } }, current.clock.revision);
    this.catalog.rebuild(this.store); return result;
  }

  removeAttachment(itemId: string, attachmentId: string): LibraryItemRecord {
    const current = this.item(itemId); const removed = current.attachments.find((entry) => entry.id === attachmentId);
    if (!removed) return current;
    let attachments = orderedAttachments(current.attachments.filter((entry) => entry.id !== attachmentId));
    if (removed.role === 'original' && attachments.length && !attachments.some((entry) => entry.role === 'original')) attachments = attachments.map((entry, index) => index ? entry : { ...entry, role: 'original' });
    const primary = attachments.find((entry) => entry.role === 'original');
    const { original: _original, ...otherFiles } = current.files ?? {};
    const result = this.store.upsertItem({ ...current, attachments, files: primary ? { ...otherFiles, original: primary.relativePath } : otherFiles }, current.clock.revision);
    this.catalog.rebuild(this.store); return result;
  }

  attachmentPath(itemId: string, attachmentId: string): string {
    const current = this.item(itemId); const attachment = current.attachments.find((entry) => entry.id === attachmentId);
    if (!attachment) throw new Error('El adjunto ya no existe.');
    const file = assertInside(this.store.itemFolder(current.storageId), path.join(this.store.itemFolder(current.storageId), attachment.relativePath));
    if (!fs.existsSync(file)) throw new Error('El archivo adjunto no está disponible.');
    return file;
  }

  upsertNote(itemId: string, input: Partial<LibraryNoteRecord> & Pick<LibraryNoteRecord, 'title' | 'markdown'>): LibraryItemRecord {
    const current = this.item(itemId); const existing = input.id ? (current.notes ?? []).find((entry) => entry.id === input.id) : null;
    if (input.source === 'zotero' || input.readOnly || existing?.readOnly) throw new Error('Las notas de Zotero son de solo lectura.');
    const now = new Date().toISOString(); const id = existing?.id ?? `note:${randomUUID()}`;
    const note: LibraryNoteRecord = { id, title: input.title.trim() || 'Nota sin título', markdown: input.markdown.replace(/\r\n?/g, '\n'),
      source: 'nodus', readOnly: false, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const notes = [...(current.notes ?? []).filter((entry) => entry.id !== id), note];
    const result = this.store.upsertItem({ ...current, notes }, current.clock.revision); this.catalog.rebuild(this.store); return result;
  }

  deleteNote(itemId: string, noteId: string): LibraryItemRecord {
    const current = this.item(itemId); const note = (current.notes ?? []).find((entry) => entry.id === noteId);
    if (note?.readOnly) throw new Error('Las notas de Zotero son de solo lectura.');
    const result = this.store.upsertItem({ ...current, notes: (current.notes ?? []).filter((entry) => entry.id !== noteId) }, current.clock.revision);
    this.catalog.rebuild(this.store); return result;
  }

  setRelation(itemId: string, targetItemId: string, relationType: LibraryItemRelationType, enabled: boolean): LibraryItemRecord {
    const left = this.item(itemId); const right = this.item(targetItemId);
    if (left.id === right.id) throw new Error('Un documento no puede relacionarse consigo mismo.');
    const now = new Date().toISOString();
    const update = (record: LibraryItemRecord, target: LibraryItemRecord, type: LibraryItemRelationType) => {
      const relations = (record.relations ?? []).filter((entry) => !(entry.targetItemId === target.id && entry.relationType === type));
      if (enabled) relations.push({ id: `relation:${randomUUID()}`, targetItemId: target.id, relationType: type, createdAt: now });
      return this.store.upsertItem({ ...record, relations }, record.clock.revision, now);
    };
    const result = update(left, right, relationType); update(right, left, inverseRelation(relationType));
    this.catalog.rebuild(this.store); return result;
  }

  patchItemTags(itemIds: string[], patch: LibraryTagPatch): number {
    const ids = new Set(itemIds.map((entry) => this.catalog.resolveItemId(entry) ?? entry));
    const add = [...new Set((patch.add ?? []).map((tag) => tag.trim()).filter(Boolean))]; const remove = new Set((patch.remove ?? []).map((tag) => tag.trim()));
    let count = 0;
    for (const item of this.store.scanMaterializedItems().records) {
      if (!ids.has(item.id) || item.deletedAt) continue;
      const tags = [...new Set([...(item.metadata.tags ?? []), ...add])].filter((tag) => !remove.has(tag));
      if (canonicalJson(tags) === canonicalJson(item.metadata.tags ?? [])) continue;
      this.store.upsertItem({ ...item, metadata: { ...item.metadata, tags } }, item.clock.revision); count += 1;
    }
    if (count) this.catalog.rebuild(this.store); return count;
  }

  private tagColors(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(path.join(this.store.root, '.nodus', 'tags.json'), 'utf8')) as Record<string, string>; } catch { return {}; }
  }

  listTagRecords(): LibraryTagRecord[] {
    const counts = new Map<string, number>(); const colors = this.tagColors();
    for (const item of this.store.scanMaterializedItems().records) if (!item.deletedAt) for (const tag of item.metadata.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...new Set([...counts.keys(), ...Object.keys(colors)])].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, color: colors[name] ?? null, itemCount: counts.get(name) ?? 0 }));
  }

  setTagColor(tag: string, color: string | null): LibraryTagRecord[] {
    const name = tag.trim(); if (!name) throw new Error('La etiqueta necesita un nombre.');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('El color debe usar el formato hexadecimal #RRGGBB.');
    const colors = this.tagColors(); if (color) colors[name] = color.toLowerCase(); else delete colors[name];
    atomicWriteJson(path.join(this.store.root, '.nodus', 'tags.json'), colors); return this.listTagRecords();
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
    let adoptedRevision: LibraryItemRecord['contentRevision'] | undefined;
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
        adoptedRevision = duplicate.contentRevision;
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
    const now = new Date().toISOString();
    const contentRevision = adoptedRevision ? {
      ...adoptedRevision,
      revision: Math.max(adoptedRevision.revision, desired.contentRevision?.revision ?? 0) + 1,
      bibliographicFingerprint: bibliographicFingerprint({ metadata }),
      previousReadable: null,
      updatedAt: now,
    } : desired.contentRevision;
    desired = this.store.upsertItem({
      ...desired, metadata, collectionIds: [...new Set([canonical, ...duplicates].flatMap((item) => item.collectionIds))],
      aliases: [...new Set([...(desired.aliases ?? []), ...duplicates.flatMap((item) => [item.id, ...item.aliases])])],
      sourceIdentities: [...new Map([desired, ...duplicates].flatMap((item) => item.sourceIdentities)
        .map((identity) => [JSON.stringify(identity), identity])).values()],
      vaultWorkIds: Object.assign({}, ...[...duplicates, desired].map((item) => item.vaultWorkIds ?? {})),
      attachments, files, extraction, contentRevision,
    }, desired.clock.revision, now);
    for (const duplicate of duplicates) this.store.upsertItem({ ...duplicate, deletedAt: now }, duplicate.clock.revision);
    this.catalog.rebuild(this.store);
    return desired;
  }
}

function readJsonArray(file: string): unknown[] {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; }
}
