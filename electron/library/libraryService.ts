import { BrowserWindow } from 'electron';
import type { LibraryCatalogPage, LibraryCatalogQuery, LibraryRebuildResult, LibraryStatus } from '@shared/libraryTypes';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';
import {
  configuredLibraryRoot,
  libraryDeviceId,
  localLibraryDatabasePath,
} from './libraryPaths';

let live: { root: string; deviceId: string; store: LibraryDiskStore; catalog: LibraryCatalog } | null = null;

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

export function closeGlobalLibrary(): void {
  live?.catalog.close();
  live = null;
}
