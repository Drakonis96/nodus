import { BrowserWindow } from 'electron';
import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryMigrationProgress,
  LibraryMigrationPreview,
  LibraryMigrationReport,
  LibraryMigrationSession,
  LibraryMigrationStartRequest,
  LibraryRebuildResult,
  LibraryStatus,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  LibraryExtractionEnqueueResult,
  LibraryExtractionJob,
  LibraryExtractionOptions,
  LibraryExtractionProgress,
  LibraryCollectionView,
  LibraryItemCollectionPatch,
  LibraryItemRecord,
  LibraryLocalImportReport,
  LibraryBibliographyImportReport,
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryMetadataIdentifierKind,
  LibraryMetadataLookupResult,
  LibraryVaultLink,
  LibraryVaultLinkReport,
} from '@shared/libraryTypes';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';
import {
  configuredLibraryRoot,
  libraryDeviceId,
  localLibraryDatabasePath,
} from './libraryPaths';
import { getVault, listVaults } from '../vaults/vaultRegistry';
import { withVaultDatabase, getDb } from '../db/database';
import { getWork, getWorkByZoteroKey, upsertWork } from '../db/worksRepo';
import { LibraryMigrationSessionManager } from './libraryMigrationSessions';
import { importZoteroLibraries, previewZoteroLibraries } from './zoteroLibraryImport';
import { LibraryExtractionQueue } from './libraryExtractionQueue';
import { completeTextNeutral } from '../ai/aiClient';
import { getSettings } from '../db/settingsRepo';
import { buildOcrTextPrompt, OCR_USER_PROMPT } from '@shared/aiOcrPrompt';
import { DEFAULT_OCR_OPTIONS } from '@shared/aiOcrTypes';
import { LibraryOperations } from './libraryOperations';
import { resolveLibraryMetadata } from './libraryMetadataResolver';
import { propagateLibraryInvalidations, settleActiveVaultLibraryInvalidations } from './libraryInvalidation';
import { listLibraryAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import type { LibraryAnalysisReuseComponent, LibraryAnalysisReuseStatus } from '@shared/libraryTypes';
import { reuseVaultAnalysisForWorks } from '../vaults/vaultAnalysisImport';
import { libraryRevisionFingerprint } from './libraryVaultProvenance';
export { recordLinkedLibraryAnalysis } from './libraryVaultProvenance';

let live: {
  root: string;
  deviceId: string;
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  extraction: LibraryExtractionQueue;
  operations: LibraryOperations;
  migrations: LibraryMigrationSessionManager;
} | null = null;
const zoteroImports = new Map<string, AbortController>();

async function libraryRemoteOcr(input: { image: Buffer; mimeType: 'image/png' }): Promise<string> {
  const settings = getSettings();
  const model = settings.visionModel ?? settings.extractionModel ?? null;
  if (!model) throw new Error('No hay un modelo de visión configurado para el OCR remoto explícito.');
  return completeTextNeutral({
    system: buildOcrTextPrompt({ ...DEFAULT_OCR_OPTIONS, outputMode: 'text' }),
    user: OCR_USER_PROMPT,
    images: [{ base64: input.image.toString('base64'), mediaType: input.mimeType }],
    temperature: 0.1, maxTokens: 8000, plainContext: true,
  }, model);
}

function unavailableStatus(): LibraryStatus {
  return {
    configured: false,
    root: null,
    formatVersion: 2,
    deviceId: null,
    items: 0,
    collections: 0,
    attachments: 0,
    conflicts: 0,
    invalidRecords: 0,
    lastRebuiltAt: null,
  };
}

function service(): NonNullable<typeof live> | null {
  const root = configuredLibraryRoot();
  if (!root) {
    live?.extraction.dispose();
    live?.catalog.close();
    live = null;
    return null;
  }
  if (live?.root === root) return live;
  live?.extraction.dispose();
  live?.catalog.close();
  const deviceId = libraryDeviceId();
  const store = new LibraryDiskStore(root, deviceId);
  store.initialize();
  const catalog = new LibraryCatalog(localLibraryDatabasePath());
  const extraction = new LibraryExtractionQueue({ store, catalog, onProgress: broadcastExtraction, remoteOcr: libraryRemoteOcr });
  const migrations = new LibraryMigrationSessionManager(store, catalog, listVaults, broadcastMigration);
  live = { root, deviceId, store, catalog, extraction, operations: new LibraryOperations(store, catalog), migrations };
  return live;
}

function broadcast(status: LibraryStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('library:changed', status);
    }
  }
}

function broadcastMigration(progress: LibraryMigrationProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('library:migrationProgress', progress);
    }
  }
}

function broadcastExtraction(progress: LibraryExtractionProgress): void {
  if (progress.status === 'done' && live) settleActiveVaultLibraryInvalidations(live.store, live.catalog);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('library:extractionProgress', progress);
  }
}

export function getGlobalLibraryStatus(): LibraryStatus {
  const current = service();
  if (current) settleActiveVaultLibraryInvalidations(current.store, current.catalog);
  return current ? current.catalog.status(current.root, current.deviceId) : unavailableStatus();
}

export function rebuildGlobalLibrary(): LibraryRebuildResult {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.catalog.rebuild(current.store);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function listGlobalLibraryItems(query?: LibraryCatalogQuery): LibraryCatalogPage {
  const current = service();
  if (!current) return { items: [], total: 0, limit: Math.max(1, Math.min(500, query?.limit ?? 100)), offset: Math.max(0, query?.offset ?? 0) };
  const status = current.catalog.status(current.root, current.deviceId);
  if (!status.lastRebuiltAt) current.catalog.rebuild(current.store);
  return current.catalog.list(query);
}

export function migrateExistingVaultLibraries(): Promise<LibraryMigrationReport> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  const preview = current.migrations.preview();
  const selectedVaultIds = preview.vaults.filter((vault) => vault.available).map((vault) => vault.id);
  return current.migrations.start({ preview, selectedVaultIds }).then((session) => {
    if (!session.report || session.status !== 'completed') throw new Error(session.error ?? 'La migración no se completó.');
    const readyToExtract = current.store.scanMaterializedItems().records
      .filter((item) => !item.deletedAt && item.source === 'zotero' && item.extraction?.status === 'pending' && !!item.files?.original)
      .map((item) => item.id);
    if (readyToExtract.length) current.extraction.enqueue(readyToExtract);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return session.report;
  });
}

export function previewLibraryMigration(): LibraryMigrationPreview {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.migrations.preview();
}

export function startLibraryMigration(request: LibraryMigrationStartRequest): Promise<LibraryMigrationSession> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  return current.migrations.start(request).then((session) => {
    broadcast(current.catalog.status(current.root, current.deviceId));
    return session;
  });
}

export function resumeLibraryMigration(sessionId: string): Promise<LibraryMigrationSession> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  return current.migrations.resume(sessionId).then((session) => {
    broadcast(current.catalog.status(current.root, current.deviceId));
    return session;
  });
}

export function cancelLibraryMigration(sessionId: string): boolean {
  return service()?.migrations.cancel(sessionId) ?? false;
}

export function rollbackLibraryMigration(sessionId: string): LibraryMigrationSession {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const session = current.migrations.rollback(sessionId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return session;
}

export function listLibraryMigrationSessions(): LibraryMigrationSession[] {
  return service()?.migrations.list() ?? [];
}

export function listZoteroImportLibraries(): Promise<ZoteroLibraryPreview[]> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  return previewZoteroLibraries(current.catalog);
}

export function startZoteroLibraryImport(
  requestId: string,
  selection: ZoteroImportSelection | undefined,
  onProgress: (progress: ZoteroImportProgress) => void,
): Promise<ZoteroImportReport> {
  if (!requestId?.trim()) return Promise.reject(new Error('La importación necesita un identificador de solicitud.'));
  if (zoteroImports.has(requestId)) return Promise.reject(new Error('Esa importación de Zotero ya está en curso.'));
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  const controller = new AbortController();
  zoteroImports.set(requestId, controller);
  return importZoteroLibraries({
    requestId, selection, store: current.store, catalog: current.catalog,
    signal: controller.signal, onProgress,
  }).then((report) => {
    const readyToExtract = current.store.scanMaterializedItems().records
      .filter((item) => !item.deletedAt && item.source === 'zotero' && item.extraction?.status === 'pending' && !!item.files?.original)
      .map((item) => item.id);
    if (readyToExtract.length) current.extraction.enqueue(readyToExtract);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return report;
  }).finally(() => { zoteroImports.delete(requestId); });
}

export function cancelZoteroLibraryImport(requestId: string): boolean {
  const controller = zoteroImports.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function enqueueLibraryExtraction(
  itemIds: string[],
  options?: Partial<LibraryExtractionOptions>,
  priority?: number,
): LibraryExtractionEnqueueResult {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.extraction.enqueue(itemIds.map((id) => current.catalog.resolveItemId(id) ?? id), options, priority);
}

export function listLibraryExtractionJobs(): LibraryExtractionJob[] {
  return service()?.extraction.list() ?? [];
}

export function cancelLibraryExtraction(jobId: string): boolean {
  return service()?.extraction.cancel(jobId) ?? false;
}

export function retryLibraryExtraction(jobId: string): boolean {
  return service()?.extraction.retry(jobId) ?? false;
}

export function listGlobalLibraryCollections(): LibraryCollectionView[] {
  return service()?.operations.listCollections() ?? [];
}

export function getGlobalLibraryItem(itemId: string): LibraryItemRecord | null {
  const current = service();
  if (!current) return null;
  return current.store.findItemByIdOrAlias(current.catalog.resolveItemId(itemId) ?? itemId);
}

export function createGlobalLibraryCollection(name: string, parentId: string | null): LibraryCollectionView {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.createCollection(name, parentId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function updateGlobalLibraryCollection(
  id: string,
  patch: { name?: string; parentId?: string | null; position?: number },
): LibraryCollectionView {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.updateCollection(id, patch);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function deleteGlobalLibraryCollection(id: string, deleteItems?: boolean): number {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.deleteCollection(id, deleteItems);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function patchGlobalLibraryItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): number {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.patchItemCollections(itemIds, patch);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function setGlobalLibraryItemsDeleted(itemIds: string[], deleted: boolean): number {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.setItemsDeleted(itemIds, deleted);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function importGlobalLibraryFiles(files: string[], collectionId?: string | null): LibraryLocalImportReport {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const report = current.operations.importLocalFiles(files, collectionId);
  if (report.itemIds.length) current.extraction.enqueue(report.itemIds);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return report;
}

export function importGlobalBibliographyFiles(files: string[], collectionId?: string | null): LibraryBibliographyImportReport {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const report = current.operations.importBibliographyFiles(files, collectionId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return report;
}

export function updateGlobalLibraryItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): LibraryItemRecord {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  let result = current.operations.updateItemMetadata(itemId, patch);
  const propagated = propagateLibraryInvalidations(result, current.store, current.catalog);
  if (propagated.clock.revision !== result.clock.revision) {
    result = propagated;
    current.catalog.rebuild(current.store);
  }
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function resolveGlobalLibraryMetadata(kind: LibraryMetadataIdentifierKind, value: string): Promise<LibraryMetadataLookupResult> {
  return resolveLibraryMetadata(kind, value);
}

export function listGlobalLibraryDuplicates(): LibraryDuplicateGroup[] {
  return service()?.operations.listDuplicateGroups() ?? [];
}

export function mergeGlobalLibraryItems(canonicalId: string, duplicateIds: string[]): LibraryItemRecord {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.mergeItems(canonicalId, duplicateIds);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function listGlobalLibraryVaults() {
  return listVaults();
}

export function listGlobalLibraryVaultLinks(itemId?: string): LibraryVaultLink[] {
  return service()?.catalog.listVaultLinks(itemId) ?? [];
}

function creatorDisplayName(creator: LibraryItemRecord['metadata']['creators'][number]): string {
  return creator.name?.trim() || [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
}

function vaultAnalysis(itemId: string, vaultId: string, vaultName: string, vaultType: string, workId: string): LibraryVaultLink {
  const db = getDb();
  const work = getWork(workId);
  if (!work) throw new Error('No se pudo crear la referencia dentro del vault.');
  const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE nodus_id=?`).get(workId) as { n: number }).n);
  const provenance = new Map(listLibraryAnalysisProvenance(workId).map((entry) => [entry.component, entry]));
  const reuse = Object.fromEntries((['light', 'deep', 'summary', 'ideas', 'passages', 'embeddings'] as const).map((component) => {
    const entry = provenance.get(component);
    const status: LibraryAnalysisReuseStatus = entry
      ? {
        state: entry.sourceVaultId && entry.sourceVaultId !== vaultId ? 'reused' : 'current',
        reason: entry.sourceVaultId && entry.sourceVaultId !== vaultId
          ? `Exact ${component} provenance reused from ${entry.sourceVaultId}.`
          : `Current ${component} output has complete provenance.`,
        sourceVaultId: entry.sourceVaultId,
        sourceWorkId: entry.sourceWorkId,
        reusedAt: entry.sourceVaultId && entry.sourceVaultId !== vaultId ? entry.updatedAt : null,
      }
      : { state: 'pending', reason: `No reusable ${component} output with complete provenance.`, sourceVaultId: null, sourceWorkId: null, reusedAt: null };
    return [component, status];
  })) as Record<LibraryAnalysisReuseComponent, LibraryAnalysisReuseStatus>;
  return {
    itemId, vaultId, vaultName, vaultType, workId,
    analysis: {
      lightStatus: work.light_status,
      deepStatus: work.deep_status,
      summaryStatus: work.summary_status,
      ideaCount: count('idea_occurrences'),
      passageCount: count('passages'),
      evidenceCount: count('evidence'),
      gapCount: count('gaps'),
      hasSummary: count('work_summaries') > 0,
      hasNotes: Boolean(work.notes?.trim()),
      archived: work.archived === 1,
      reuse,
    },
  };
}


/** Materialize references in a vault without duplicating the immutable global
 * files. Analysis resolves the clean Markdown through the stable zotero_key. */
export async function linkGlobalLibraryItemsToVault(itemIds: string[], vaultId: string): Promise<LibraryVaultLinkReport> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const vault = getVault(vaultId);
  if (!vault) throw new Error('El vault seleccionado ya no existe.');
  if (vault.origin === 'connected' && (vault.remote?.role === 'reader' || vault.remote?.state !== 'active')) {
    throw new Error('Este vault conectado es de solo lectura o no está activo.');
  }
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  const canonicalIds = [...new Set(uniqueIds.map((id) => current.catalog.resolveItemId(id) ?? id))];
  const records = current.store.scanMaterializedItems().records.filter((item) => canonicalIds.includes(item.id) && !item.deletedAt);
  if (records.length !== canonicalIds.length) throw new Error('Alguno de los documentos seleccionados ya no existe.');
  const prior = new Set(current.catalog.listVaultLinks().filter((link) => link.vaultId === vaultId).map((link) => link.itemId));
  const links = await withVaultDatabase(vaultId, async () => {
    const nextLinks: LibraryVaultLink[] = [];
    for (const record of records) {
    const zoteroIdentity = record.sourceIdentities.find((identity) => identity.source === 'zotero');
    const zoteroKey = zoteroIdentity
      ? zoteroIdentity.libraryType === 'group'
        ? `groups:${zoteroIdentity.libraryId}:${zoteroIdentity.itemKey}`
        : zoteroIdentity.itemKey
      : `nodus-library:${encodeURIComponent(record.id)}`;
    const existing = getWorkByZoteroKey(zoteroKey);
    const authors = record.metadata.creators.map(creatorDisplayName).filter(Boolean);
    const creators = record.metadata.creators.flatMap((creator) => {
      const role = creator.creatorType === 'editor' ? 'editor' as const : creator.creatorType === 'author' ? 'author' as const : null;
      if (!role) return [];
      return [{
        lastName: creator.lastName?.trim() || '',
        firstName: creator.firstName?.trim() || '',
        name: creator.name?.trim() || null,
        role,
      }];
    });
    upsertWork({
      nodus_id: existing?.nodus_id ?? record.vaultWorkIds?.[vaultId] ?? record.id,
      zotero_key: zoteroKey,
      zotero_version: null,
      title: record.metadata.title,
      authors,
      creators,
      year: record.metadata.year ?? null,
      item_type: record.metadata.itemType,
      doi: record.metadata.doi?.trim() || null,
      read_tag: false,
      zoteroTags: record.metadata.tags ?? [],
    });
    const linked = getWorkByZoteroKey(zoteroKey);
    if (!linked) throw new Error('No se pudo vincular el documento al vault.');
    getDb().prepare("UPDATE works SET source_type='markdown' WHERE nodus_id=?").run(linked.nodus_id);
    const revisionFingerprints = Object.fromEntries((['light', 'deep', 'summary', 'ideas', 'passages', 'embeddings'] as const)
      .map((component) => [component, libraryRevisionFingerprint(record, component)])) as Record<LibraryAnalysisReuseComponent, string | null>;
    await reuseVaultAnalysisForWorks([linked.nodus_id], {
      targetVaultId: vault.id,
      context: { libraryItemId: record.id, revisionFingerprints },
    });
      nextLinks.push(vaultAnalysis(record.id, vault.id, vault.name, String(vault.type), linked.nodus_id));
    }
    return nextLinks;
  });
  current.catalog.upsertVaultLinks(links);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return {
    requested: canonicalIds.length,
    linked: links.filter((link) => !prior.has(link.itemId)).length,
    existing: links.filter((link) => prior.has(link.itemId)).length,
    vaultId,
    links,
    reusedComponents: links.reduce((sum, link) => sum + Object.values(link.analysis.reuse ?? {}).filter((entry) => entry.state === 'reused').length, 0),
    pendingComponents: links.reduce((sum, link) => sum + Object.values(link.analysis.reuse ?? {}).filter((entry) => ['pending', 'incompatible', 'unavailable'].includes(entry.state)).length, 0),
    canceled: false,
  };
}

export function closeGlobalLibrary(): void {
  for (const controller of zoteroImports.values()) controller.abort();
  zoteroImports.clear();
  live?.extraction.dispose();
  live?.catalog.close();
  live = null;
}
