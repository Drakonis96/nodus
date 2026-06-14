import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDb, closeDb } from './db/database';
import { registerIpc } from './ipc';
import { scanQueue } from './pipeline/scanQueue';
import { getSettings } from './db/settingsRepo';
import { startRealtimeSync, stopRealtimeSync } from './sync/syncService';

// Vite injects these env vars for the dev server / built output locations.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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

app.whenReady().then(() => {
  getDb(); // open + migrate before anything touches data
  registerIpc(() => mainWindow);
  createWindow();

  // Resume any scans that were pending when the app last closed.
  scanQueue.resumePending();

  if (getSettings().syncMode === 'realtime') startRealtimeSync();

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
  stopRealtimeSync();
  closeDb();
});
