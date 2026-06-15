import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDb, closeDb } from './db/database';
import { registerIpc } from './ipc';
import { scanQueue } from './pipeline/scanQueue';
import { getSettings } from './db/settingsRepo';
import { startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import type { UpdateCheckResponse, UpdateProgressEvent } from '@shared/types';

const require = createRequire(__filename);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

// Vite injects these env vars for the dev server / built output locations.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');

// Optional userData override (separate profile / isolated testing). Must run
// before app is ready, i.e. before anything reads getPath('userData').
if (process.env.NODUS_USERDATA) {
  app.setPath('userData', process.env.NODUS_USERDATA);
}

let mainWindow: BrowserWindow | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let installingUpdate = false;
let downloadedUpdateVersion: string | null = null;
let lastUpdateEvent: UpdateProgressEvent | null = null;

const UPDATE_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function emitUpdate(event: UpdateCheckResponse): UpdateCheckResponse {
  lastUpdateEvent = { ...event, at: new Date().toISOString() };
  mainWindow?.webContents.send('updates:progress', lastUpdateEvent);
  return event;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function checkForUpdates(reason: string): Promise<UpdateCheckResponse> {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    return emitUpdate({
      status: 'disabled',
      message: 'Las actualizaciones solo están disponibles en la app empaquetada.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (installingUpdate) {
    return emitUpdate({
      status: 'installing',
      message: 'Actualización descargada. Nodus se está cerrando para instalarla.',
      version: downloadedUpdateVersion ?? app.getVersion(),
      progress: 100,
    });
  }
  if (downloadedUpdateVersion) {
    return emitUpdate({
      status: 'downloaded',
      message: `Actualización ${downloadedUpdateVersion} descargada. Reiniciando para instalarla…`,
      version: downloadedUpdateVersion,
      progress: 100,
    });
  }
  console.log(`[updates] checking (${reason})`);
  emitUpdate({
    status: 'checking',
    message: 'Buscando actualizaciones…',
    version: app.getVersion(),
    progress: null,
  });
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (version && version !== app.getVersion()) {
      return emitUpdate({
        status: 'available',
        message: `Actualización ${version} encontrada. La descarga empezará automáticamente.`,
        version,
        progress: 0,
      });
    }
    return emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  } catch (e) {
    console.error(`[updates] check failed: ${e instanceof Error ? e.message : String(e)}`);
    return emitUpdate({
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
      version: app.getVersion(),
      progress: null,
    });
  }
}

async function installDownloadedUpdate(): Promise<UpdateCheckResponse> {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    return emitUpdate({
      status: 'disabled',
      message: 'Las actualizaciones solo están disponibles en la app empaquetada.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (!downloadedUpdateVersion) {
    return emitUpdate({
      status: 'not-available',
      message: 'No hay ninguna actualización descargada pendiente de instalar.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (installingUpdate) {
    return lastUpdateEvent ?? {
      status: 'installing',
      message: 'Instalando actualización…',
      version: downloadedUpdateVersion,
      progress: 100,
    };
  }
  installingUpdate = true;
  const response = emitUpdate({
    status: 'installing',
    message: `Instalando Nodus ${downloadedUpdateVersion} y reiniciando…`,
    version: downloadedUpdateVersion,
    progress: 100,
  });
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      installingUpdate = false;
      emitUpdate({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        version: downloadedUpdateVersion ?? app.getVersion(),
        progress: null,
      });
    }
  }, 800);
  return response;
}

function setupAutoUpdates(): void {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    console.log('[updates] disabled outside packaged app');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => console.log('[updates] checking for update'));
  autoUpdater.on('update-available', (info) => {
    console.log(`[updates] update available: ${info.version}`);
    emitUpdate({
      status: 'available',
      message: `Actualización ${info.version} encontrada. Descargando…`,
      version: info.version,
      progress: 0,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updates] up to date: ${info.version}`);
    emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.max(0, Math.min(100, p.percent ?? 0));
    console.log(`[updates] downloading ${Math.round(percent)}% (${Math.round((p.bytesPerSecond ?? 0) / 1024)} KiB/s)`);
    emitUpdate({
      status: 'downloading',
      message: `Descargando actualización… ${Math.round(percent)}%`,
      version: downloadedUpdateVersion ?? undefined,
      progress: percent,
      bytesPerSecond: p.bytesPerSecond ?? null,
      transferred: p.transferred ?? null,
      total: p.total ?? null,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (installingUpdate) return;
    downloadedUpdateVersion = info.version;
    console.log(`[updates] downloaded ${info.version}; installing and restarting`);
    emitUpdate({
      status: 'downloaded',
      message: `Actualización ${info.version} descargada. Reiniciando para instalarla…`,
      version: info.version,
      progress: 100,
    });
    setTimeout(() => void installDownloadedUpdate(), 1200);
  });
  autoUpdater.on('error', (e) => {
    console.error(`[updates] error: ${e instanceof Error ? e.message : String(e)}`);
    emitUpdate({
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
      version: downloadedUpdateVersion ?? app.getVersion(),
      progress: null,
    });
  });

  setTimeout(() => void checkForUpdates('startup'), UPDATE_CHECK_DELAY_MS);
  updateCheckTimer = setInterval(() => void checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  getDb(); // open + migrate before anything touches data
  registerIpc(() => mainWindow, () => checkForUpdates('manual'), installDownloadedUpdate);
  createWindow();

  const settings = getSettings();
  // Queue resume is opt-in: pending DB state may come from previous automatic versions.
  if (settings.autoResumeQueue) scanQueue.resumePending();

  if (settings.syncMode === 'realtime') startRealtimeSync();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopRealtimeSync();
    closeDb();
    app.quit();
  }
});

app.on('before-quit', () => {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  stopRealtimeSync();
  closeDb();
});

const updateAwareApp = app as typeof app & { on(event: 'before-quit-for-update', listener: () => void): typeof app };
updateAwareApp.on('before-quit-for-update', () => {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  stopRealtimeSync();
  closeDb();
});
