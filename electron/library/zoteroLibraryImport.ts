import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryAttachmentRecord,
  LibraryCollectionRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
} from '@shared/libraryTypes';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary } from '@shared/types';
import * as zotero from '../zotero/zoteroClient';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, safeLibraryFolderName } from './libraryPaths';
import { canonicalJson } from './libraryRecord';
import { LibraryDiskStore } from './libraryStorage';

export interface ZoteroImportClient {
  libraries(): Promise<ZoteroLibrary[]>;
  libraryVersion(userId: string, library: ZoteroLibrary): Promise<number>;
  allCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroCollection[]>;
  libraryItems(library: ZoteroLibrary, options?: {
    since?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  }): Promise<{ items: ZoteroItem[]; version: number; total: number }>;
  deletedSince(library: ZoteroLibrary, since: number, signal?: AbortSignal): Promise<{
    version: number;
    items: string[];
    collections: string[];
  }>;
  itemAttachments(userId: string, itemKey: string, library?: ZoteroLibrary): Promise<ZoteroAttachmentInfo[]>;
  attachmentFilePath(userId: string, attachmentKey: string): Promise<string | null>;
}

const defaultClient: ZoteroImportClient = {
  libraries: zotero.libraries,
  libraryVersion: zotero.libraryVersion,
  allCollections: zotero.allCollections,
  libraryItems: zotero.libraryItems,
  deletedSince: zotero.deletedSince,
  itemAttachments: zotero.itemAttachments,
  attachmentFilePath: zotero.attachmentFilePath,
};

function libraryId(library: ZoteroLibrary): string {
  return library.type === 'group' ? `groups/${library.id}` : `users/${library.id || '0'}`;
}

function importSourceId(library: ZoteroLibrary): string {
  return `zotero:${libraryId(library)}`;
}

function collectionId(key: string): string {
  return `zotero:${key}`;
}

function itemId(key: string): string {
  return `zotero:${key}`;
}

function itemType(value: string): LibraryItemType {
  const type = value.toLowerCase().replace(/[^a-z]/g, '');
  if (['journalarticle', 'articlejournal', 'magazinearticle', 'newspaperarticle'].includes(type)) return 'article-journal';
  if (type === 'book') return 'book';
  if (['booksection', 'chapter'].includes(type)) return 'chapter';
  if (['conferencepaper', 'proceedings'].includes(type)) return 'conference-paper';
  if (type === 'thesis') return 'thesis';
  if (type === 'report') return 'report';
  if (['webpage', 'blogpost', 'forumpost'].includes(type)) return 'webpage';
  if (type === 'dataset') return 'dataset';
  return type ? 'document' : 'other';
}

function splitIdentifiers(value: string | null): string[] {
  return [...new Set(String(value ?? '').split(/[;,\n]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function parseExtra(value: string | null, item: ZoteroItem): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const match = /^([^:]{1,100}):\s*(.+)$/.exec(line.trim());
    if (match) result[match[1].trim()] = match[2].trim();
  }
  result['Zotero item type'] = item.itemType;
  result['Zotero version'] = String(item.version);
  if (item.dateAdded) result['Zotero date added'] = item.dateAdded;
  if (item.dateModified) result['Zotero date modified'] = item.dateModified;
  return Object.keys(result).length ? result : undefined;
}

function metadata(item: ZoteroItem): LibraryItemMetadata {
  const extra = parseExtra(item.extra, item);
  return {
    title: item.title.trim() || 'Documento sin título',
    itemType: itemType(item.itemType),
    creators: item.creators.map((creator) => ({
      creatorType: creator.creatorType || 'author',
      ...(creator.firstName?.trim() ? { firstName: creator.firstName.trim() } : {}),
      ...(creator.lastName?.trim() ? { lastName: creator.lastName.trim() } : {}),
      ...(creator.name?.trim() ? { name: creator.name.trim() } : {}),
    })),
    ...(item.abstract?.trim() ? { abstract: item.abstract.trim() } : {}),
    ...(item.date?.trim() ? { date: item.date.trim() } : {}),
    year: item.year,
    ...(item.language?.trim() ? { language: item.language.trim() } : {}),
    ...(item.publisher?.trim() ? { publisher: item.publisher.trim() } : {}),
    ...(item.publicationTitle?.trim() ? { publicationTitle: item.publicationTitle.trim() } : {}),
    ...(item.volume?.trim() ? { volume: item.volume.trim() } : {}),
    ...(item.issue?.trim() ? { issue: item.issue.trim() } : {}),
    ...(item.pages?.trim() ? { pages: item.pages.trim() } : {}),
    ...(item.edition?.trim() ? { edition: item.edition.trim() } : {}),
    ...(item.place?.trim() ? { place: item.place.trim() } : {}),
    ...(item.rights?.trim() ? { rights: item.rights.trim() } : {}),
    ...(item.url?.trim() ? { url: item.url.trim() } : {}),
    ...(item.doi?.trim() ? { doi: item.doi.trim() } : {}),
    isbn: splitIdentifiers(item.isbn),
    issn: splitIdentifiers(item.issn),
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    ...(extra ? { extra } : {}),
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

function priority(attachment: ZoteroAttachmentInfo): number {
  const mime = String(attachment.contentType ?? '').toLowerCase();
  const extension = path.extname(attachment.filename ?? '').toLowerCase();
  if (mime === 'application/pdf' || extension === '.pdf') return 0;
  if (mime.includes('epub') || extension === '.epub') return 1;
  if (['.md', '.markdown', '.jats', '.xml', '.html', '.htm'].includes(extension)) return 2;
  if (['.docx', '.odt', '.rtf'].includes(extension)) return 3;
  if (mime.startsWith('text/plain') || extension === '.txt') return 4;
  if (['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension)) return 5;
  if (String(attachment.linkMode).toLowerCase().includes('snapshot')) return 6;
  if (mime.startsWith('image/')) return 7;
  return 8;
}

function attachmentRole(attachment: ZoteroAttachmentInfo, index: number): LibraryAttachmentRecord['role'] {
  if (index === 0) return 'original';
  if (String(attachment.linkMode).toLowerCase().includes('snapshot')) return 'snapshot';
  if (String(attachment.contentType).toLowerCase().startsWith('image/')) return 'image';
  return 'supplement';
}

async function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function copyImmutable(source: string, destination: string): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
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

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Importación cancelada', 'AbortError');
}

function progress(
  requestId: string,
  phase: ZoteroImportProgress['phase'],
  library: ZoteroLibrary | null,
  processedItems: number,
  totalItems: number,
  processedAttachments: number,
  totalAttachments: number,
  message: string,
): ZoteroImportProgress {
  const phaseBase = { connecting: 0, collections: 5, catalog: 15, attachments: 45, rebuild: 95, complete: 100, canceled: 100 }[phase];
  const portion = phase === 'catalog' && totalItems ? Math.round((processedItems / totalItems) * 28)
    : phase === 'attachments' && totalAttachments ? Math.round((processedAttachments / totalAttachments) * 48)
      : 0;
  return {
    requestId, phase, libraryId: library ? libraryId(library) : null, libraryName: library?.name ?? null,
    processedItems, totalItems, processedAttachments, totalAttachments,
    percent: Math.min(100, phaseBase + portion), message,
  };
}

export async function previewZoteroLibraries(
  catalog: LibraryCatalog,
  client: ZoteroImportClient = defaultClient,
): Promise<ZoteroLibraryPreview[]> {
  const libraries = await client.libraries();
  return Promise.all(libraries.map(async (library) => ({
    id: libraryId(library),
    type: library.type,
    name: library.name,
    version: await client.libraryVersion(library.id, library),
    lastImportedVersion: catalog.getImportSource(importSourceId(library))?.version ?? 0,
  })));
}

export async function importZoteroLibraries(options: {
  requestId: string;
  selection?: ZoteroImportSelection;
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  client?: ZoteroImportClient;
  signal?: AbortSignal;
  onProgress?: (value: ZoteroImportProgress) => void;
}): Promise<ZoteroImportReport> {
  const started = Date.now();
  const { requestId, store, catalog, signal, onProgress } = options;
  const client = options.client ?? defaultClient;
  const selection = options.selection ?? {};
  const report: ZoteroImportReport = {
    requestId, libraries: 0, itemsDiscovered: 0, itemsCreated: 0, itemsUpdated: 0,
    itemsUnchanged: 0, itemsDeleted: 0, collectionsCreated: 0, collectionsUpdated: 0,
    collectionsUnchanged: 0, attachmentsCopied: 0, attachmentsUnchanged: 0,
    attachmentsUnavailable: 0, warnings: [], canceled: false, durationMs: 0,
  };
  let processedItems = 0;
  let totalItems = 0;
  let processedAttachments = 0;
  let totalAttachments = 0;
  let lastPercent = 0;
  const emit = (value: ZoteroImportProgress): void => {
    value.percent = Math.max(lastPercent, value.percent);
    lastPercent = value.percent;
    onProgress?.(value);
  };
  emit(progress(requestId, 'connecting', null, 0, 0, 0, 0, 'Conectando con Zotero…'));
  try {
    abortIfNeeded(signal);
    const available = await client.libraries();
    const selectedIds = new Set(selection.libraryIds ?? available.map(libraryId));
    const libraries = available.filter((library) => selectedIds.has(libraryId(library)));
    report.libraries = libraries.length;
    for (const library of libraries) {
      abortIfNeeded(signal);
      const sourceLibraryId = libraryId(library);
      const saved = catalog.getImportSource(importSourceId(library));
      const selectedCollectionIds = new Set(selection.collectionIds ?? []);
      const subset = selectedCollectionIds.size > 0;
      const since = !selection.fullRefresh && !subset ? saved?.version ?? 0 : 0;
      emit(progress(requestId, 'collections', library, processedItems, totalItems, processedAttachments, totalAttachments, `Leyendo colecciones de ${library.name}…`));
      const collections = await client.allCollections(library, signal);
      const selectedKeys = new Set<string>();
      if (subset) {
        const byParent = new Map<string, string[]>();
        for (const collection of collections) {
          const parent = collection.parentCollection || '';
          byParent.set(parent, [...(byParent.get(parent) ?? []), collection.key]);
        }
        const visit = (key: string): void => {
          if (selectedKeys.has(key)) return;
          selectedKeys.add(key);
          for (const child of byParent.get(key) ?? []) visit(child);
        };
        for (const id of selectedCollectionIds) visit(id.startsWith('zotero:') ? id.slice(7) : id);
      }
      const visibleCollections = subset ? collections.filter((entry) => selectedKeys.has(entry.key)) : collections;
      const positionByParent = new Map<string | null, number>();
      for (const collection of visibleCollections) {
        const id = collectionId(collection.key);
        const parentId = collection.parentCollection && (!subset || selectedKeys.has(collection.parentCollection))
          ? collectionId(collection.parentCollection) : null;
        const current = store.readMaterializedCollection(id);
        const desired = {
          id, name: collection.name.trim() || '(sin nombre)', parentId,
          position: positionByParent.get(parentId) ?? 0, source: 'zotero' as const,
          sourceLibraryId, sourceKey: collection.itemKey, deletedAt: null,
        };
        positionByParent.set(parentId, desired.position + 1);
        if (!current) { store.upsertCollection(desired); report.collectionsCreated += 1; }
        else if (comparableCollection(current) === comparableCollection({ ...current, ...desired })) report.collectionsUnchanged += 1;
        else { store.upsertCollection(desired, current.clock.revision); report.collectionsUpdated += 1; }
      }
      if (!since && !subset) {
        const visibleIds = new Set(visibleCollections.map((entry) => collectionId(entry.key)));
        for (const current of store.scanMaterializedCollections().records) {
          if (current.source !== 'zotero' || current.sourceLibraryId !== sourceLibraryId || current.deletedAt || visibleIds.has(current.id)) continue;
          store.upsertCollection({ ...current, deletedAt: new Date().toISOString() }, current.clock.revision);
        }
      }

      const page = await client.libraryItems(library, {
        since: since || undefined, signal,
        onProgress: (loaded, total) => emit(progress(
          requestId, 'catalog', library, processedItems + loaded, totalItems + total,
          processedAttachments, totalAttachments, `Catalogando ${library.name}…`,
        )),
      });
      const changedItems = page.items.filter((item) => {
        if (subset) return item.collections.some((key) => selectedKeys.has(key));
        return selection.includeUnfiled === false ? item.collections.length > 0 : true;
      });
      report.itemsDiscovered += changedItems.length;
      totalItems += changedItems.length;
      const desiredByKey = new Map<string, LibraryItemRecord>();
      for (const item of changedItems) {
        abortIfNeeded(signal);
        const current = store.readMaterializedItem(item.key);
        const localCollectionIds = (current?.collectionIds ?? []).filter((id) => {
          const collection = store.readMaterializedCollection(id);
          return collection?.source !== 'zotero' || collection.sourceLibraryId !== sourceLibraryId;
        });
        const desired = {
          id: itemId(item.key), storageId: item.key, source: 'zotero' as const,
          sourceLibraryId, sourceKey: item.itemKey,
          ...(current?.citationKey ? { citationKey: current.citationKey } : {}),
          metadata: metadata(item),
          collectionIds: [...new Set([
            ...localCollectionIds,
            ...item.collections.filter((key) => !subset || selectedKeys.has(key)).map(collectionId),
          ])],
          attachments: current?.attachments ?? [],
          ...(current?.files ? { files: current.files } : {}),
          extraction: current?.extraction ?? { status: 'pending' as const },
          deletedAt: null,
        };
        let stored: LibraryItemRecord;
        if (!current) { stored = store.upsertItem(desired); report.itemsCreated += 1; }
        else if (comparableItem(current) === comparableItem({ ...current, ...desired })) {
          stored = current; report.itemsUnchanged += 1;
        } else { stored = store.upsertItem(desired, current.clock.revision); report.itemsUpdated += 1; }
        desiredByKey.set(item.key, stored);
        processedItems += 1;
        emit(progress(requestId, 'catalog', library, processedItems, totalItems, processedAttachments, totalAttachments, `Catálogo disponible: ${item.title}`));
      }

      const deleted = since > 0 ? await client.deletedSince(library, since, signal) : { version: 0, items: [], collections: [] };
      const deletedItemKeys = new Set(deleted.items);
      if (!since && !subset) {
        const currentKeys = new Set(page.items.map((item) => item.key));
        for (const current of store.scanMaterializedItems().records) {
          if (current.source === 'zotero' && current.sourceLibraryId === sourceLibraryId && current.sourceKey && !currentKeys.has(
            library.type === 'group' ? `groups:${library.id}:${current.sourceKey}` : current.sourceKey
          )) deletedItemKeys.add(current.storageId);
        }
      }
      for (const key of deletedItemKeys) {
        const current = store.readMaterializedItem(key);
        if (!current || current.deletedAt || current.sourceLibraryId !== sourceLibraryId) continue;
        store.upsertItem({ ...current, deletedAt: new Date().toISOString() }, current.clock.revision);
        report.itemsDeleted += 1;
      }
      for (const key of deleted.collections) {
        const current = store.readMaterializedCollection(collectionId(key));
        if (!current || current.deletedAt || current.sourceLibraryId !== sourceLibraryId) continue;
        store.upsertCollection({ ...current, deletedAt: new Date().toISOString() }, current.clock.revision);
      }

      // Deliberate checkpoint: the complete bibliography appears before any file copy begins.
      catalog.rebuild(store);
      emit(progress(requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments, 'Catálogo listo; copiando adjuntos…'));
      if (selection.copyAttachments !== false) {
        for (const item of changedItems) {
          abortIfNeeded(signal);
          const attachments = (await client.itemAttachments(library.id, item.key, library)).sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
          totalAttachments += attachments.length;
          let current = desiredByKey.get(item.key) ?? store.readMaterializedItem(item.key);
          if (!current) continue;
          const copied: LibraryAttachmentRecord[] = [];
          for (let index = 0; index < attachments.length; index += 1) {
            abortIfNeeded(signal);
            const attachment = attachments[index];
            const sourcePath = await client.attachmentFilePath(library.id, attachment.key);
            if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
              report.attachmentsUnavailable += 1;
              report.warnings.push(`Adjunto no disponible: ${item.title} — ${attachment.title}`);
              processedAttachments += 1;
              continue;
            }
            const sourceHash = await sha256(sourcePath);
            const previous = current.attachments.find((entry) => entry.sourceKey === attachment.itemKey && entry.sha256 === sourceHash);
            if (previous && fs.existsSync(path.join(store.itemFolder(current.storageId), previous.relativePath))) {
              copied.push({ ...previous, role: attachmentRole(attachment, index) });
              report.attachmentsUnchanged += 1;
              processedAttachments += 1;
              continue;
            }
            const fileName = path.basename(attachment.filename || path.basename(sourcePath) || 'adjunto');
            const baseName = `${safeLibraryFolderName(attachment.itemKey)}-${safeLibraryFolderName(fileName)}`;
            const attachmentDirectory = assertInside(store.itemFolder(current.storageId), path.join(store.itemFolder(current.storageId), 'attachments'));
            let destination = assertInside(attachmentDirectory, path.join(attachmentDirectory, baseName));
            if (fs.existsSync(destination)) destination = assertInside(attachmentDirectory, path.join(
              attachmentDirectory, `${safeLibraryFolderName(attachment.itemKey)}-${sourceHash.slice(0, 12)}-${safeLibraryFolderName(fileName)}`,
            ));
            if (!fs.existsSync(destination)) await copyImmutable(sourcePath, destination);
            const stat = fs.statSync(destination);
            copied.push({
              id: attachment.key, title: attachment.title, fileName,
              relativePath: path.relative(store.itemFolder(current.storageId), destination),
              mimeType: attachment.contentType || 'application/octet-stream', byteSize: stat.size,
              sha256: sourceHash, role: attachmentRole(attachment, index), sourceKey: attachment.itemKey,
            });
            report.attachmentsCopied += 1;
            processedAttachments += 1;
            emit(progress(requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments, `Copiado: ${fileName}`));
          }
          const files = {
            ...(current.files ?? {}),
            ...(copied[0] ? { original: copied[0].relativePath } : {}),
            annotations: current.files?.annotations ?? 'annotations.json',
          };
          const desired = { ...current, attachments: copied, files };
          if (comparableItem(current) !== comparableItem(desired)) {
            current = store.upsertItem(desired, current.clock.revision);
            desiredByKey.set(item.key, current);
          }
        }
      }
      abortIfNeeded(signal);
      const importedVersion = Math.max(page.version, deleted.version, await client.libraryVersion(library.id, library));
      catalog.putImportSource({
        sourceId: importSourceId(library), source: 'zotero', libraryId: sourceLibraryId,
        libraryName: library.name, version: importedVersion, importedAt: new Date().toISOString(),
        configuration: { ...selection, libraryIds: [sourceLibraryId] },
      });
    }
    emit(progress(requestId, 'rebuild', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Reconstruyendo el índice local…'));
    catalog.rebuild(store);
    emit(progress(requestId, 'complete', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Importación de Zotero completada.'));
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      report.canceled = true;
      catalog.rebuild(store);
      emit(progress(requestId, 'canceled', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Importación cancelada; el catálogo ya importado se conserva.'));
    } else {
      throw error;
    }
  }
  report.durationMs = Date.now() - started;
  return report;
}
