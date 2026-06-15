import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDb, closeDb } from './db/database';
import { registerIpc } from './ipc';
import { scanQueue } from './pipeline/scanQueue';
import { getSettings } from './db/settingsRepo';
import { startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import type { UpdateCheckResponse } from '@shared/types';

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

const UPDATE_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
    return {
      status: 'disabled',
      message: 'Las actualizaciones solo están disponibles en la app empaquetada.',
      version: app.getVersion(),
    };
  }
  if (installingUpdate) {
    return {
      status: 'available',
      message: 'Actualización descargada. Nodus se está cerrando para instalarla.',
      version: app.getVersion(),
    };
  }
  console.log(`[updates] checking (${reason})`);
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (version && version !== app.getVersion()) {
      return {
        status: 'available',
        message: `Actualización ${version} encontrada. La descarga empezará automáticamente.`,
        version,
      };
    }
    return {
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
    };
  } catch (e) {
    console.error(`[updates] check failed: ${e instanceof Error ? e.message : String(e)}`);
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
      version: app.getVersion(),
    };
  }
}

function setupAutoUpdates(): void {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    console.log('[updates] disabled outside packaged app');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => console.log('[updates] checking for update'));
  autoUpdater.on('update-available', (info) => console.log(`[updates] update available: ${info.version}`));
  autoUpdater.on('update-not-available', (info) => console.log(`[updates] up to date: ${info.version}`));
  autoUpdater.on('download-progress', (p) =>
    console.log(`[updates] downloading ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KiB/s)`)
  );
  autoUpdater.on('update-downloaded', (info) => {
    if (installingUpdate) return;
    installingUpdate = true;
    console.log(`[updates] downloaded ${info.version}; installing and restarting`);
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 1500);
  });
  autoUpdater.on('error', (e) => {
    console.error(`[updates] error: ${e instanceof Error ? e.message : String(e)}`);
  });

  setTimeout(() => void checkForUpdates('startup'), UPDATE_CHECK_DELAY_MS);
  updateCheckTimer = setInterval(() => void checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  getDb(); // open + migrate before anything touches data
  registerIpc(() => mainWindow, () => checkForUpdates('manual'));
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
