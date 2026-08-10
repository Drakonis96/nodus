import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCollectionView,
  LibraryItemCollectionPatch,
  LibraryItemRecord,
  LibraryItemType,
  LibraryLocalImportReport,
} from '@shared/libraryTypes';
import { canonicalJson } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, safeLibraryFolderName } from './libraryPaths';
import { LibraryDiskStore } from './libraryStorage';

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
    const parent = parentId ? this.store.readMaterializedCollection(parentId) : null;
    if (parentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    const siblings = this.catalog.listCollections().filter((entry) => entry.parentId === parentId);
    const id = `nodus:collection:${randomUUID()}`;
    this.store.upsertCollection({ id, name: clean, parentId, position: siblings.length, source: 'nodus', deletedAt: null });
    this.catalog.rebuild(this.store);
    return this.catalog.listCollections().find((entry) => entry.id === id)!;
  }

  updateCollection(id: string, patch: { name?: string; parentId?: string | null; position?: number }): LibraryCollectionView {
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
    const add = new Set(patch.add ?? []);
    const remove = new Set(patch.remove ?? []);
    for (const id of add) {
      const collection = this.store.readMaterializedCollection(id);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
    }
    let updated = 0;
    for (const item of this.store.scanMaterializedItems().records) {
      if (!itemIds.includes(item.id) || item.deletedAt) continue;
      const collectionIds = [...new Set([...item.collectionIds.filter((id) => !remove.has(id)), ...add])];
      const desired = { ...item, collectionIds };
      if (comparable(item) !== comparable(desired)) { this.store.upsertItem(desired, item.clock.revision); updated += 1; }
    }
    if (updated) this.catalog.rebuild(this.store);
    return updated;
  }

  setItemsDeleted(itemIds: string[], deleted: boolean): number {
    let updated = 0;
    const now = new Date().toISOString();
    for (const item of this.store.scanMaterializedItems().records) {
      if (!itemIds.includes(item.id) || Boolean(item.deletedAt) === deleted) continue;
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
}
