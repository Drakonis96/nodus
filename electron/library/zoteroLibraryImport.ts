import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryAttachmentRecord,
  LibraryCollectionRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  LibraryMetadataOverrides,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncFailure,
} from '@shared/libraryTypes';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary } from '@shared/types';
import * as zotero from '../zotero/zoteroClient';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, fitLibraryFileName, resolveLibraryFile, safeLibraryFileName, safeLibraryFolderName } from './libraryPaths';
import {
  canonicalJson,
  librarySourceIdentityKey,
  normalizeLibraryMetadata,
  zoteroSourceIdentity,
} from './libraryRecord';
import { LibraryDiskStore } from './libraryStorage';
import { ZoteroSyncSessionStore } from './libraryZoteroSyncSessions';

export interface ZoteroImportClient {
  libraries(): Promise<ZoteroLibrary[]>;
  libraryVersion(userId: string, library: ZoteroLibrary): Promise<number>;
  allCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroCollection[]>;
  libraryItems(library: ZoteroLibrary, options?: {
    since?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
    includeStandaloneFiles?: boolean;
  }): Promise<{ items: ZoteroItem[]; version: number; total: number; standaloneSkipped?: number }>;
  deletedSince(library: ZoteroLibrary, since: number, signal?: AbortSignal): Promise<{
    version: number;
    items: string[];
    collections: string[];
  }>;
  itemAttachments(userId: string, itemKey: string, library?: ZoteroLibrary): Promise<ZoteroAttachmentInfo[]>;
  attachmentFilePath(userId: string, attachmentKey: string): Promise<string | null>;
  itemNotes?(userId: string, itemKey: string, library?: ZoteroLibrary): Promise<zotero.ZoteroChildNote[]>;
}

const defaultClient: ZoteroImportClient = {
  libraries: zotero.libraries,
  libraryVersion: zotero.libraryVersion,
  allCollections: zotero.allCollections,
  libraryItems: zotero.libraryItems,
  deletedSince: zotero.deletedSince,
  itemAttachments: zotero.itemAttachments,
  attachmentFilePath: zotero.attachmentFilePath,
  itemNotes: zotero.itemNotes,
};

function libraryId(library: ZoteroLibrary): string {
  return library.type === 'group' ? `groups/${library.id}` : `users/${library.id || '0'}`;
}

function importSourceId(library: ZoteroLibrary): string {
  return `zotero:${libraryId(library)}`;
}

function legacyCollectionAlias(key: string): string {
  return `zotero:${key}`;
}

function qualifiedCollectionAlias(library: ZoteroLibrary, itemKey: string): string {
  return `zotero:collection:${library.type}:${library.id || '0'}:${itemKey}`;
}

function qualifiedItemAlias(library: ZoteroLibrary, itemKey: string): string {
  return `zotero:item:${library.type}:${library.id || '0'}:${itemKey}`;
}

function legacyAliasIsUnambiguous(library: ZoteroLibrary, transportKey: string): boolean {
  return library.type === 'user' || transportKey !== transportKey.split(':').at(-1);
}

function rawZoteroKey(key: string): string {
  return /^groups:[^:]+:(.+)$/.exec(key)?.[1] ?? key;
}

export function mapZoteroLibraryItemType(value: string): LibraryItemType {
  const type = value.toLowerCase().replace(/[^a-z]/g, '');
  if (['journalarticle', 'articlejournal'].includes(type)) return 'journal-article';
  if (type === 'magazinearticle') return 'magazine-article';
  if (type === 'newspaperarticle') return 'newspaper-article';
  if (type === 'book') return 'book';
  const mapped: Record<string, LibraryItemType> = {
    booksection: 'book-chapter', chapter: 'book-chapter', conferencepaper: 'conference-paper', proceedings: 'conference-paper',
    thesis: 'thesis', report: 'report', manuscript: 'manuscript', presentation: 'presentation', interview: 'interview',
    letter: 'letter', email: 'email', instantmessage: 'instant-message', encyclopediaarticle: 'encyclopedia-article',
    dictionaryentry: 'dictionary-entry', case: 'case', hearing: 'hearing', bill: 'bill', statute: 'statute', patent: 'patent',
    artwork: 'artwork', map: 'map', film: 'film', audiorecording: 'audio-recording', videorecording: 'video-recording',
    radiobroadcast: 'radio-broadcast', tvbroadcast: 'tv-broadcast', podcast: 'podcast', blogpost: 'blog-post',
    forumpost: 'forum-post', computerprogram: 'computer-program', webpage: 'webpage', dataset: 'dataset', document: 'document',
    preprint: 'preprint', standard: 'standard',
  };
  if (mapped[type]) return mapped[type];
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
  for (const [name, entry] of Object.entries(item.fields ?? {})) result[`Zotero field: ${name}`] = entry;
  if (item.dateAdded) result['Zotero date added'] = item.dateAdded;
  if (item.dateModified) result['Zotero date modified'] = item.dateModified;
  return Object.keys(result).length ? result : undefined;
}

function metadata(item: ZoteroItem): LibraryItemMetadata {
  const extra = parseExtra(item.extra, item);
  return {
    title: item.title.trim() || 'Documento sin título',
    itemType: mapZoteroLibraryItemType(item.itemType),
    creators: item.creators.map((creator) => ({
      creatorType: creator.creatorType || 'author',
      ...(creator.firstName?.trim() ? { firstName: creator.firstName.trim() } : {}),
      ...(creator.lastName?.trim() ? { lastName: creator.lastName.trim() } : {}),
      ...(creator.name?.trim() ? { name: creator.name.trim() } : {}),
      fieldMode: creator.name?.trim() ? 1 as const : 0 as const,
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

function applyMetadataOverrides(base: LibraryItemMetadata, overrides?: LibraryMetadataOverrides): LibraryItemMetadata {
  if (!overrides) return base;
  const values = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete values[key];
    else values[key] = value;
  }
  return normalizeLibraryMetadata(values, base.title);
}

function comparableItem(record: LibraryItemRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

function comparableCollection(record: LibraryCollectionRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

/**
 * Zotero has no "this one is the article" flag. An entry routinely carries a full-text
 * PDF *and* a supplementary PDF, and to the API both are plain `application/pdf`: the
 * format tiers below tied them, and the tie fell through to `key.localeCompare`, the
 * alphabetical order of an opaque Zotero key. So an entry whose supplement happened to
 * key as "AA…" and whose article keyed as "ZZ…" had Nodus read, extract and analyse
 * the supplementary information as if it were the paper — a coin flip, silently.
 *
 * The attachment titles Zotero's own translators write are the only signal available,
 * and they are fairly consistent ("Full Text PDF", "Supplementary Information"). A
 * supplementary-looking attachment is ranked just below others of its own format, so
 * it still wins against an image or a spreadsheet and never against the article.
 */
const SUPPLEMENTARY = /supplement|supporting[\s_-]+information|appendix|annex/i;

function isSupplementary(attachment: ZoteroAttachmentInfo): boolean {
  return SUPPLEMENTARY.test(`${attachment.title ?? ''} ${attachment.filename ?? ''}`);
}

function priority(attachment: ZoteroAttachmentInfo): number {
  const mime = String(attachment.contentType ?? '').toLowerCase();
  const extension = path.extname(attachment.filename ?? '').toLowerCase();
  const format = mime === 'application/pdf' || extension === '.pdf' ? 0
    : mime.includes('epub') || extension === '.epub' ? 1
      : ['.md', '.markdown', '.jats', '.xml', '.html', '.htm'].includes(extension) ? 2
        : ['.docx', '.odt', '.rtf'].includes(extension) ? 3
          : mime.startsWith('text/plain') || extension === '.txt' ? 4
            : ['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension) ? 5
              : String(attachment.linkMode).toLowerCase().includes('snapshot') ? 6
                : mime.startsWith('image/') ? 7
                  : 8;
  return format + (isSupplementary(attachment) ? 0.5 : 0);
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

function syncFailure(error: unknown, sourceLibraryId: string | null): ZoteroSyncFailure {
  const candidate = error as { code?: ZoteroSyncFailure['code']; retryable?: boolean; message?: string };
  const message = error instanceof Error ? error.message : String(error);
  const code = candidate.code && ['zotero-closed', 'credentials-expired', 'rate-limited', 'library-missing', 'permission', 'network', 'invalid-response'].includes(candidate.code)
    ? candidate.code : /ECONNREFUSED|fetch failed|socket/i.test(message) ? 'zotero-closed' : 'unknown';
  return { libraryId: sourceLibraryId, code, message, retryable: candidate.retryable ?? ['zotero-closed', 'rate-limited', 'network'].includes(code) };
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
  // Fraction of the *items* walked by the notes and attachments passes. Those two
  // phases cannot be measured against `totalAttachments`: that total is discovered
  // one item at a time, so processed/total sat at ~1 from the first file onwards and
  // pinned the bar at 93% for the entire copy. Items are known up front, so they are
  // the only honest denominator once the catalogue is committed.
  itemRatio = 0,
): ZoteroImportProgress {
  const phaseBase = { connecting: 0, collections: 5, catalog: 15, notes: 45, attachments: 58, rebuild: 95, complete: 100, canceled: 100, failed: 100 }[phase];
  const portion = phase === 'catalog' && totalItems ? Math.round((processedItems / totalItems) * 28)
    : phase === 'notes' ? Math.round(Math.min(1, Math.max(0, itemRatio)) * 12)
      : phase === 'attachments' ? Math.round(Math.min(1, Math.max(0, itemRatio)) * 37)
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
    itemsUnchanged: 0, itemsDeleted: 0, itemsSourceMissing: 0, itemsStandaloneSkipped: 0, collectionsCreated: 0, collectionsUpdated: 0,
    collectionsUnchanged: 0, attachmentsCopied: 0, attachmentsUnchanged: 0,
    attachmentsUnavailable: 0, attachmentsLinkOnly: 0, attachmentsChanged: 0, conflicts: 0, librariesMissing: [], failures: [], partial: false,
    warnings: [], canceled: false, durationMs: 0,
  };
  const sessions = new ZoteroSyncSessionStore(store.root);
  let processedItems = 0;
  let totalItems = 0;
  let processedAttachments = 0;
  let totalAttachments = 0;
  let lastPercent = 0;
  let lastCheckpointAt = 0;
  let lastCheckpointPhase: ZoteroImportProgress['phase'] | null = null;
  let completedLibraries = 0;
  const catalogItem = (identity: LibraryItemRecord['sourceIdentities'][number]): LibraryItemRecord | null => {
    const itemId = catalog.findItemIdBySourceIdentity(identity);
    const storageId = itemId ? catalog.itemStorageId(itemId) : null;
    return storageId ? store.readMaterializedItem(storageId) : null;
  };
  const catalogCollection = (sourceLibraryId: string, sourceKey: string) => {
    const id = catalog.findCollectionIdBySource('zotero', sourceLibraryId, sourceKey);
    return id ? store.readMaterializedCollection(id) : null;
  };
  const emit = (value: ZoteroImportProgress): void => {
    value.percent = Math.max(lastPercent, value.percent);
    lastPercent = value.percent;
    onProgress?.(value);
    const now = Date.now();
    if (value.phase !== lastCheckpointPhase || now - lastCheckpointAt >= 500 || ['complete', 'canceled', 'failed'].includes(value.phase)) {
      sessions.progress(requestId, value);
      lastCheckpointAt = now; lastCheckpointPhase = value.phase;
    }
  };
  const initialProgress = progress(requestId, 'connecting', null, 0, 0, 0, 0, 'Conectando con Zotero…');
  sessions.begin(requestId, selection, initialProgress);
  emit(initialProgress);
  try {
    abortIfNeeded(signal);
    const available = await client.libraries();
    const selectedIds = new Set(selection.libraryIds ?? available.map(libraryId));
    const libraries = available.filter((library) => selectedIds.has(libraryId(library)));
    const availableIds = new Set(available.map(libraryId));
    report.librariesMissing = [...selectedIds].filter((id) => !availableIds.has(id));
    for (const missingId of report.librariesMissing) {
      const missingAt = new Date().toISOString();
      for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', missingId).entries()) {
        const current = store.readMaterializedItem(storageId);
        if (!current) continue;
        if (current.source !== 'zotero' || current.sourceLibraryId !== missingId || current.sourceState === 'library-missing') continue;
        catalog.indexItem(store.upsertItem({ ...current, sourceState: 'library-missing', sourceMissingAt: missingAt }, current.clock.revision), store);
        report.itemsSourceMissing += 1;
        if (index && index % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      for (const [index, collectionId] of catalog.sourceCollectionIds('zotero', missingId).entries()) {
        const current = store.readMaterializedCollection(collectionId);
        if (!current) continue;
        if (current.source !== 'zotero' || current.sourceLibraryId !== missingId || current.sourceState === 'library-missing') continue;
        catalog.indexCollection(store.upsertCollection({ ...current, sourceState: 'library-missing', sourceMissingAt: missingAt }, current.clock.revision));
        if (index && index % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      report.failures.push({ libraryId: missingId, code: 'library-missing', message: `La biblioteca ${missingId} ya no está disponible en Zotero.`, retryable: false });
    }
    report.libraries = libraries.length;
    for (const library of libraries) {
      abortIfNeeded(signal);
      const sourceLibraryId = libraryId(library);
      try {
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
        for (const id of selectedCollectionIds) {
          const knownId = catalog.resolveCollectionId(id) ?? id;
          const known = store.readMaterializedCollection(knownId);
          visit(known?.sourceKey ?? (id.startsWith('zotero:') ? id.slice(7) : id));
        }
      }
      const visibleCollections = subset ? collections.filter((entry) => selectedKeys.has(entry.key)) : collections;
      const collectionIds = new Map<string, string>();
      for (const [collectionIndex, collection] of visibleCollections.entries()) {
        const current = catalogCollection(sourceLibraryId, collection.itemKey)
          ?? store.readMaterializedCollection(legacyCollectionAlias(collection.key));
        collectionIds.set(collection.key, current?.id ?? `nodus:collection:${randomUUID()}`);
        if (collectionIndex && collectionIndex % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const positionByParent = new Map<string | null, number>();
      for (const [collectionIndex, collection] of visibleCollections.entries()) {
        const id = collectionIds.get(collection.key)!;
        const parentId = collection.parentCollection && (!subset || selectedKeys.has(collection.parentCollection))
          ? collectionIds.get(collection.parentCollection) ?? null : null;
        const current = catalogCollection(sourceLibraryId, collection.itemKey)
          ?? store.readMaterializedCollection(id);
        const aliases = [...new Set([
          ...(current?.aliases ?? []),
          qualifiedCollectionAlias(library, collection.itemKey),
          ...(legacyAliasIsUnambiguous(library, collection.key) ? [legacyCollectionAlias(collection.key)] : []),
        ].filter((alias) => alias !== id))];
        const desired = {
          id, name: collection.name.trim() || '(sin nombre)', parentId,
          position: positionByParent.get(parentId) ?? 0, source: 'zotero' as const,
          sourceLibraryId, sourceKey: collection.itemKey, aliases,
          sourceState: 'current' as const,
          ...(current?.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
          deletedAt: null,
        };
        positionByParent.set(parentId, desired.position + 1);
        if (!current) { catalog.indexCollection(store.upsertCollection(desired)); report.collectionsCreated += 1; }
        else if (comparableCollection(current) === comparableCollection({ ...current, ...desired })) report.collectionsUnchanged += 1;
        else { catalog.indexCollection(store.upsertCollection(desired, current.clock.revision)); report.collectionsUpdated += 1; }
        if (collectionIndex && collectionIndex % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (!since && !subset) {
        const visibleIds = new Set(collectionIds.values());
        for (const [index, collectionId] of catalog.sourceCollectionIds('zotero', sourceLibraryId).entries()) {
          const current = store.readMaterializedCollection(collectionId);
          if (!current) continue;
          if (current.source !== 'zotero' || current.sourceLibraryId !== sourceLibraryId || current.deletedAt || visibleIds.has(current.id)) continue;
          catalog.indexCollection(store.upsertCollection({ ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString() }, current.clock.revision));
          if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      const page = await client.libraryItems(library, {
        since: since || undefined, signal,
        includeStandaloneFiles: selection.includeStandaloneFiles === true,
        onProgress: (loaded, total) => emit(progress(
          requestId, 'catalog', library, processedItems + loaded, totalItems + total,
          processedAttachments, totalAttachments, `Catalogando ${library.name}…`,
        )),
      });
      const changedItems = page.items.filter((item) => {
        if (subset) return item.collections.some((key) => selectedKeys.has(key));
        return selection.includeUnfiled === false ? item.collections.length > 0 : true;
      });
      report.itemsStandaloneSkipped += page.standaloneSkipped ?? 0;
      report.itemsDiscovered += changedItems.length;
      totalItems += changedItems.length;
      const desiredByKey = new Map<string, LibraryItemRecord>();
      for (const item of changedItems) {
        abortIfNeeded(signal);
        const identity = zoteroSourceIdentity(sourceLibraryId, item.itemKey);
        const legacyAtTransportKey = store.readMaterializedItem(item.key);
        const current = catalogItem(identity)
          ?? (legacyAtTransportKey?.sourceIdentities.some((entry) => librarySourceIdentityKey(entry) === librarySourceIdentityKey(identity))
            ? legacyAtTransportKey : null);
        const localCollectionIds = (current?.collectionIds ?? []).filter((id) => {
          const collection = store.readMaterializedCollection(id);
          return collection?.source !== 'zotero' || collection.sourceLibraryId !== sourceLibraryId;
        });
        const id = current?.id ?? `nodus:${randomUUID()}`;
        const aliases = [...new Set([
          ...(current?.aliases ?? []),
          qualifiedItemAlias(library, item.itemKey),
          ...(legacyAliasIsUnambiguous(library, item.key) ? [`zotero:${item.key}`] : []),
        ].filter((alias) => alias !== id))];
        const sourceIdentities = [...new Map([...(current?.sourceIdentities ?? []), identity]
          .map((entry) => [librarySourceIdentityKey(entry), entry])).values()];
        const localTags = current?.localTags ?? [];
        const suppressedSourceTags = current?.suppressedSourceTags ?? [];
        const sourceMetadata = metadata(item);
        sourceMetadata.tags = [...new Set([
          ...(sourceMetadata.tags ?? []).filter((tag) => !suppressedSourceTags.includes(tag)),
          ...localTags,
        ])];
        const desired = {
          id, storageId: current?.storageId ?? id, aliases, sourceIdentities, source: 'zotero' as const,
          sourceLibraryId, sourceKey: item.itemKey,
          ...(current?.citationKey ? { citationKey: current.citationKey } : {}),
          metadata: applyMetadataOverrides(sourceMetadata, current?.metadataOverrides),
          ...(current?.metadataOverrides ? { metadataOverrides: current.metadataOverrides } : {}),
          ...(localTags.length ? { localTags } : {}),
          ...(suppressedSourceTags.length ? { suppressedSourceTags } : {}),
          collectionIds: [...new Set([
            ...localCollectionIds,
            ...item.collections.filter((key) => !subset || selectedKeys.has(key)).flatMap((key) => {
              const collectionId = collectionIds.get(key);
              return collectionId ? [collectionId] : [];
            }),
          ])],
          attachments: current?.attachments ?? [],
          ...(current?.files ? { files: current.files } : {}),
          extraction: current?.extraction ?? { status: 'pending' as const },
          sourceState: 'current' as const,
          ...(current?.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
          lastSourceSyncAt: current?.sourceVersion === item.version ? current.lastSourceSyncAt : new Date().toISOString(),
          sourceVersion: item.version,
          deletedAt: null,
        };
        let stored: LibraryItemRecord;
        if (!current) { stored = store.upsertItem(desired); report.itemsCreated += 1; }
        else if (comparableItem(current) === comparableItem({ ...current, ...desired })) {
          stored = current; report.itemsUnchanged += 1;
        } else {
          if (current.sourceVersion !== item.version && (current.metadataOverrides || localCollectionIds.length > 0)) report.conflicts += 1;
          stored = store.upsertItem(desired, current.clock.revision); report.itemsUpdated += 1;
        }
        desiredByKey.set(item.key, stored);
        catalog.indexItem(stored, store);
        processedItems += 1;
        emit(progress(requestId, 'catalog', library, processedItems, totalItems, processedAttachments, totalAttachments, `Catálogo disponible: ${item.title}`));
        if (processedItems % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const deleted = since > 0 ? await client.deletedSince(library, since, signal) : { version: 0, items: [], collections: [] };
      const deletedItemKeys = new Set(deleted.items.map(rawZoteroKey));
      if (!since && !subset) {
        const currentKeys = new Set(page.items.map((item) => item.itemKey));
        for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', sourceLibraryId).entries()) {
          const current = store.readMaterializedItem(storageId);
          if (!current) continue;
          const belongsToLibrary = current.sourceIdentities.some((entry) => entry.source === 'zotero'
            && entry.libraryType === library.type && entry.libraryId === String(library.id || '0'));
          if (belongsToLibrary && current.sourceKey && !currentKeys.has(current.sourceKey)) deletedItemKeys.add(current.sourceKey);
          if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      for (const key of deletedItemKeys) {
        const current = catalogItem(zoteroSourceIdentity(sourceLibraryId, key));
        if (!current || current.deletedAt || current.sourceLibraryId !== sourceLibraryId || current.sourceState === 'source-missing') continue;
        catalog.indexItem(store.upsertItem({ ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString() }, current.clock.revision), store);
        report.itemsSourceMissing += 1;
      }
      for (const key of deleted.collections) {
        const current = catalogCollection(sourceLibraryId, rawZoteroKey(key));
        if (!current || current.deletedAt || current.sourceLibraryId !== sourceLibraryId || current.sourceState === 'source-missing') continue;
        catalog.indexCollection(store.upsertCollection({ ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString() }, current.clock.revision));
      }

      // Deliberate checkpoint: every changed record is already visible through
      // incremental indexing before any file copy begins.
      emit(progress(requestId, 'notes', library, processedItems, totalItems, processedAttachments, totalAttachments, 'Catálogo listo; leyendo notas…'));
      if (client.itemNotes) {
        const { default: TurndownService } = await import('turndown');
        const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
        // One request per item, and every one of them has to land before the first
        // file is copied. On a 14.000-item library that is minutes of silence, so the
        // pass reports itself rather than leaving the bar parked on the last catalogue
        // message with nothing to show for it.
        for (const [noteIndex, item] of changedItems.entries()) {
          abortIfNeeded(signal);
          emit(progress(
            requestId, 'notes', library, processedItems, totalItems, processedAttachments, totalAttachments,
            `Leyendo notas: ${item.title}`, changedItems.length ? noteIndex / changedItems.length : 0,
          ));
          const current = desiredByKey.get(item.key) ?? catalogItem(zoteroSourceIdentity(sourceLibraryId, item.itemKey));
          if (!current) continue;
          try {
            const mirrored = (await client.itemNotes(library.id, item.key, library)).map((note) => ({
              id: `zotero-note:${note.key}`, title: note.title, markdown: turndown.turndown(note.html).trim(),
              source: 'zotero' as const, sourceKey: note.key, readOnly: true,
              createdAt: (current.notes ?? []).find((entry) => entry.id === `zotero-note:${note.key}`)?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }));
            const notes = [...(current.notes ?? []).filter((note) => note.source !== 'zotero'), ...mirrored];
            if (comparableItem(current) !== comparableItem({ ...current, notes })) {
              const stored = store.upsertItem({ ...current, notes }, current.clock.revision);
              desiredByKey.set(item.key, stored);
              catalog.indexItem(stored, store);
            }
          } catch (error) {
            const failure = syncFailure(error, sourceLibraryId);
            report.failures.push(failure);
            report.warnings.push(`No se pudieron actualizar las notas de ${item.title}: ${failure.message}`);
            report.partial = true;
          }
        }
      }
      if (selection.copyAttachments !== false) {
        emit(progress(requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments, 'Copiando adjuntos…'));
        for (const [fileIndex, item] of changedItems.entries()) {
          abortIfNeeded(signal);
          emit(progress(
            requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments,
            `Adjuntos: ${item.title}`, changedItems.length ? fileIndex / changedItems.length : 0,
          ));
          let attachments: ZoteroAttachmentInfo[];
          try {
            attachments = (await client.itemAttachments(library.id, item.key, library)).sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
          } catch (error) {
            const failure = syncFailure(error, sourceLibraryId);
            report.failures.push(failure);
            report.warnings.push(`No se pudieron consultar los adjuntos de ${item.title}: ${failure.message}`);
            report.partial = true;
            continue;
          }
          totalAttachments += attachments.length;
          let current = desiredByKey.get(item.key)
            ?? catalogItem(zoteroSourceIdentity(sourceLibraryId, item.itemKey));
          if (!current) continue;
          const copied: LibraryAttachmentRecord[] = current.attachments
            .filter((entry) => !entry.sourceKey)
            .map((entry) => ({ ...entry }));
          const seenSourceKeys = new Set<string>();
          for (let index = 0; index < attachments.length; index += 1) {
            abortIfNeeded(signal);
            const attachment = attachments[index];
            // A `linked_url` attachment is a bookmark: a URL with no file behind it,
            // which Zotero answers with `400 Not a file attachment`. Asking for its
            // path and then filing the refusal under "unavailable" turned every saved
            // link into a warning and flagged the whole sync as partial — roughly 7% of
            // a typical library. It is not a missing file, so it is not counted as one.
            if (attachment.linkMode === 'linked_url' || attachment.available === false) {
              report.attachmentsLinkOnly += 1;
              continue;
            }
            seenSourceKeys.add(attachment.itemKey);
            const previousBySource = current.attachments.find((entry) => entry.sourceKey === attachment.itemKey);
            let sourcePath: string | null = null;
            try {
              sourcePath = await client.attachmentFilePath(library.id, attachment.key);
            } catch (error) {
              const failure = syncFailure(error, sourceLibraryId);
              report.failures.push(failure);
              report.partial = true;
            }
            if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
              report.attachmentsUnavailable += 1;
              report.partial = true;
              report.warnings.push(`Adjunto no disponible: ${item.title} — ${attachment.title}`);
              if (previousBySource) copied.push({ ...previousBySource, sourceState: 'not-downloaded' });
              processedAttachments += 1;
              continue;
            }
            const sourceHash = await sha256(sourcePath);
            const previous = previousBySource?.sha256 === sourceHash ? previousBySource : undefined;
            if (previous && resolveLibraryFile(store.itemFolder(current.storageId), previous.relativePath)) {
              copied.push({ ...previous, sourceState: 'available' });
              report.attachmentsUnchanged += 1;
              processedAttachments += 1;
              continue;
            }
            const fileName = path.basename(attachment.filename || path.basename(sourcePath) || 'adjunto');
            const baseName = fitLibraryFileName(`${safeLibraryFolderName(attachment.itemKey)}-${safeLibraryFileName(fileName)}`);
            const attachmentDirectory = assertInside(store.itemFolder(current.storageId), path.join(store.itemFolder(current.storageId), 'attachments'));
            let destination = assertInside(attachmentDirectory, path.join(attachmentDirectory, baseName));
            if (fs.existsSync(destination)) destination = assertInside(attachmentDirectory, path.join(
              attachmentDirectory, fitLibraryFileName(`${safeLibraryFolderName(attachment.itemKey)}-${sourceHash.slice(0, 12)}-${safeLibraryFileName(fileName)}`),
            ));
            // One unwritable file used to abort the whole library. The copy sits at the
            // end of a loop whose only try/catch covers the Zotero request, so an
            // ENAMETOOLONG — or a full disk, or a permission — threw past every
            // remaining item straight to the per-library handler, and an import of
            // 14.000 works stopped copying at whichever file happened to be awkward
            // while the catalogue kept claiming everything was imported. A file that
            // cannot be copied is now one skipped attachment, reported and survived.
            try {
              if (!fs.existsSync(destination)) await copyImmutable(sourcePath, destination);
            } catch (error) {
              const failure = syncFailure(error, sourceLibraryId);
              report.failures.push(failure);
              report.warnings.push(`No se pudo copiar el adjunto de ${item.title} — ${attachment.title}: ${failure.message}`);
              report.attachmentsUnavailable += 1;
              report.partial = true;
              if (previousBySource) copied.push({ ...previousBySource, sourceState: 'not-downloaded' });
              processedAttachments += 1;
              continue;
            }
            const stat = fs.statSync(destination);
            copied.push({
              id: attachment.key, title: attachment.title, fileName,
              relativePath: path.relative(store.itemFolder(current.storageId), destination),
              mimeType: attachment.contentType || 'application/octet-stream', byteSize: stat.size,
              sha256: sourceHash, role: previousBySource?.role ?? attachmentRole(attachment, index), position: previousBySource?.position ?? index,
              addedAt: previousBySource?.addedAt ?? new Date().toISOString(), sourceKey: attachment.itemKey, sourceState: 'available',
            });
            report.attachmentsCopied += 1;
            if (previousBySource) report.attachmentsChanged += 1;
            processedAttachments += 1;
            emit(progress(
              requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments,
              `Copiado: ${fileName}`, changedItems.length ? fileIndex / changedItems.length : 0,
            ));
          }
          copied.push(...current.attachments
            .filter((entry) => entry.sourceKey && !seenSourceKeys.has(entry.sourceKey))
            .map((entry) => ({ ...entry, sourceState: 'source-missing' as const })));
          copied.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
            || (a.addedAt ?? '').localeCompare(b.addedAt ?? ''));
          copied.forEach((attachment, index) => { attachment.position = index; });
          const previousOriginalPath = current.files?.original;
          const previousOriginal = previousOriginalPath
            ? copied.find((attachment) => attachment.relativePath === previousOriginalPath)
            : undefined;
          const original = previousOriginal ?? copied.find((attachment) => attachment.role === 'original') ?? copied[0];
          const files = {
            ...(current.files ?? {}),
            ...(original ? { original: original.relativePath } : {}),
            annotations: current.files?.annotations ?? 'annotations.json',
          };
          const desired = { ...current, attachments: copied, files };
          if (comparableItem(current) !== comparableItem(desired)) {
            current = store.upsertItem(desired, current.clock.revision);
            desiredByKey.set(item.key, current);
            catalog.indexItem(current, store);
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
      completedLibraries += 1;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        const failure = syncFailure(error, sourceLibraryId);
        report.failures.push(failure);
        report.warnings.push(failure.message);
        report.partial = true;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    emit(progress(requestId, 'rebuild', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Verificando el índice local…'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    report.partial = report.partial || report.failures.length > 0 || report.librariesMissing.length > 0;
    const failed = report.failures.length > 0 && completedLibraries === 0;
    // `failed` only means that no library reached the end; it says nothing about why.
    // Reporting it as "Zotero no está disponible" made every cause look like a closed
    // Zotero, so a failure with Zotero plainly running sent the reader hunting through
    // connectivity, paths and permissions instead of reading the actual error. Lead
    // with the first failure's own message and keep the reassurance after it.
    const failureDetail = report.failures[0]?.message?.trim();
    emit(progress(requestId, failed ? 'failed' : 'complete', null, processedItems, totalItems, processedAttachments, totalAttachments,
      failed
        ? `${failureDetail || 'No se pudo completar la importación de Zotero.'} Los datos locales se conservan.`
        : report.partial ? 'Sincronización parcial completada; revisa el informe.' : 'Importación de Zotero completada.'));
    report.durationMs = Date.now() - started;
    sessions.finish(requestId, failed ? 'failed' : 'completed', report, failed ? report.failures[0]?.message ?? 'Sincronización fallida.' : null);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      report.canceled = true;
      await new Promise<void>((resolve) => setImmediate(resolve));
      emit(progress(requestId, 'canceled', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Importación cancelada; el catálogo ya importado se conserva.'));
      report.durationMs = Date.now() - started;
      sessions.finish(requestId, 'canceled', report);
    } else {
      const failure = syncFailure(error, null);
      report.failures.push(failure);
      report.warnings.push(failure.message);
      report.partial = true;
      await new Promise<void>((resolve) => setImmediate(resolve));
      emit(progress(requestId, 'failed', null, processedItems, totalItems, processedAttachments, totalAttachments, 'No se pudo conectar con Zotero; los datos locales se conservan.'));
      report.durationMs = Date.now() - started;
      sessions.finish(requestId, 'failed', report, failure.message);
    }
  }
  if (!report.durationMs) report.durationMs = Date.now() - started;
  return report;
}
