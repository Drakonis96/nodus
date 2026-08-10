import { BrowserWindow } from 'electron';
import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryMigrationProgress,
  LibraryMigrationReport,
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
} from '@shared/libraryTypes';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';
import {
  configuredLibraryRoot,
  libraryDeviceId,
  localLibraryDatabasePath,
} from './libraryPaths';
import { listVaults } from '../vaults/vaultRegistry';
import { migrateVaultLibraries } from './libraryMigration';
import { importZoteroLibraries, previewZoteroLibraries } from './zoteroLibraryImport';
import { LibraryExtractionQueue } from './libraryExtractionQueue';
import { completeTextNeutral } from '../ai/aiClient';
import { getSettings } from '../db/settingsRepo';
import { buildOcrTextPrompt, OCR_USER_PROMPT } from '@shared/aiOcrPrompt';
import { DEFAULT_OCR_OPTIONS } from '@shared/aiOcrTypes';

let live: { root: string; deviceId: string; store: LibraryDiskStore; catalog: LibraryCatalog; extraction: LibraryExtractionQueue } | null = null;
let migration: Promise<LibraryMigrationReport> | null = null;
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
    formatVersion: 1,
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
  live = { root, deviceId, store, catalog, extraction };
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
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('library:extractionProgress', progress);
  }
}

export function getGlobalLibraryStatus(): LibraryStatus {
  const current = service();
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
  if (migration) return migration;
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  migration = migrateVaultLibraries({
    vaults: listVaults(),
    store: current.store,
    catalog: current.catalog,
    onProgress: broadcastMigration,
  }).then((report) => {
    const readyToExtract = current.store.scanMaterializedItems().records
      .filter((item) => !item.deletedAt && item.source === 'zotero' && item.extraction?.status === 'pending' && !!item.files?.original)
      .map((item) => item.id);
    if (readyToExtract.length) current.extraction.enqueue(readyToExtract);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return report;
  }).finally(() => { migration = null; });
  return migration;
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
  return current.extraction.enqueue(itemIds, options, priority);
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

export function closeGlobalLibrary(): void {
  for (const controller of zoteroImports.values()) controller.abort();
  zoteroImports.clear();
  live?.extraction.dispose();
  live?.catalog.close();
  live = null;
}
