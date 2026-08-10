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

let live: { root: string; deviceId: string; store: LibraryDiskStore; catalog: LibraryCatalog } | null = null;
let migration: Promise<LibraryMigrationReport> | null = null;
const zoteroImports = new Map<string, AbortController>();

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
    live?.catalog.close();
    live = null;
    return null;
  }
  if (live?.root === root) return live;
  live?.catalog.close();
  const deviceId = libraryDeviceId();
  const store = new LibraryDiskStore(root, deviceId);
  store.initialize();
  live = { root, deviceId, store, catalog: new LibraryCatalog(localLibraryDatabasePath()) };
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

export function closeGlobalLibrary(): void {
  for (const controller of zoteroImports.values()) controller.abort();
  zoteroImports.clear();
  live?.catalog.close();
  live = null;
}
