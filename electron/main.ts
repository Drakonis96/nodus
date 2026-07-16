import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { getDb, closeDb } from './db/database';
import { reconcileAuthorLayerOnce } from './db/authorsRepo';
import { pruneDormantIdeas } from './db/ideasRepo';
import { maybeRunAutoBackup, runAutoBackupNow } from './export/autoBackup';
import { registerIpc } from './ipc';
import { scanQueue } from './pipeline/scanQueue';
import { getSettings } from './db/settingsRepo';
import { getActiveVault } from './vaults/vaultRegistry';
import { generateDemoPortraits, hasDemoPortraitKey, demoPortraitsPending } from './ai/genealogyDemoPortraits';
import { interruptDecorativeImageGenerations } from './ai/decorativeImages';
import { startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import { startMcpServer, stopMcpServer } from './mcp';
import { setCopilotWindowProvider, startCopilotServer, stopCopilotServer } from './copilot/server';
import { applyMascotWindow, destroyMascotWindow } from './mascotWindow';
import { seedWelcomeNotification } from './notifications';
import { startStudyCalendarReminders, stopStudyCalendarReminders } from './studyCalendarReminders';
import { restorePersistedDockIcon } from './dockIcon';
import { recoverLegacyApiKeys } from './secrets/legacySecretRecovery';
import type { UpdateCheckResponse, UpdateProgressEvent } from '@shared/types';

const require = createRequire(__filename);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

// 2.3.0 made the display name explicit, which also changed the macOS Safe Storage
// service from "nodus" to "Nodus". The normal process keeps the current name;
// recovery explicitly requests either released credential from macOS Keychain.
app.setName('Nodus');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

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
let downloadedUpdateFile: string | null = null;
let lastUpdateEvent: UpdateProgressEvent | null = null;
let installUpdateTimer: NodeJS.Timeout | null = null;
let useUnsignedMacUpdaterFallback = false;

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function macAppBundlePath(): string | null {
  if (process.platform !== 'darwin') return null;
  const marker = '.app/Contents/MacOS/';
  const markerIndex = process.execPath.indexOf(marker);
  if (markerIndex < 0) return null;
  return process.execPath.slice(0, markerIndex + '.app'.length);
}

function macAppHasDeveloperIdSignature(): boolean {
  const appPath = macAppBundlePath();
  if (!appPath) return false;
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const signature = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return result.status === 0 && /Authority=Developer ID Application:/.test(signature);
}

function unsignedMacUpdateHelperScript(): string {
  // The helper is outside the bundle, so it can replace the .app after this
  // process exits. electron-updater has already verified the ZIP checksum.
  return [
    '#!/bin/sh',
    'set -eu',
    'PID="$1"',
    'ZIP="$2"',
    'TARGET="$3"',
    'STATE="$4"',
    'STAGING="$(/usr/bin/mktemp -d /private/tmp/nodus-update.XXXXXX)"',
    'BACKUP="${TARGET}.previous"',
    'finish() { /bin/rm -rf "$STAGING"; /bin/rm -f "$0"; }',
    "fail() { /usr/bin/printf '%s\\n' '{\"status\":\"failed\"}' > \"$STATE\"; finish; exit 1; }",
    'trap finish EXIT',
    'while /bin/kill -0 "$PID" 2>/dev/null; do /bin/sleep 0.1; done',
    '/usr/bin/ditto -x -k "$ZIP" "$STAGING" || fail',
    'NEW_APP="$(/usr/bin/find "$STAGING" -type d -name Nodus.app -print -quit)"',
    '[ -n "$NEW_APP" ] && [ -d "$NEW_APP/Contents" ] || fail',
    '/bin/rm -rf "$BACKUP"',
    '/bin/mv "$TARGET" "$BACKUP" || fail',
    'if ! /bin/mv "$NEW_APP" "$TARGET"; then /bin/mv "$BACKUP" "$TARGET" || true; fail; fi',
    '/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true',
    " /usr/bin/printf '%s\\n' '{\"status\":\"installed\"}' > \"$STATE\"",
    '/usr/bin/open -n "$TARGET" || true',
  ].join('\n');
}

async function installUnsignedMacUpdate(downloadedFile: string): Promise<void> {
  const appPath = macAppBundlePath();
  if (!appPath) throw new Error('No se pudo localizar la aplicación de macOS para actualizarla.');
  if (path.extname(downloadedFile).toLowerCase() !== '.zip') {
    throw new Error('El paquete descargado no es un ZIP de macOS válido.');
  }
  await Promise.all([
    fs.access(downloadedFile, fsConstants.R_OK),
    fs.access(appPath, fsConstants.R_OK),
    fs.access(path.dirname(appPath), fsConstants.W_OK),
  ]);

  const statePath = path.join(app.getPath('userData'), 'update-install-state.json');
  const helperPath = path.join(os.tmpdir(), `nodus-update-${process.pid}-${Date.now()}.sh`);
  await fs.writeFile(helperPath, unsignedMacUpdateHelperScript(), { encoding: 'utf8', mode: 0o700 });
  await fs.writeFile(statePath, JSON.stringify({ status: 'starting', version: downloadedUpdateVersion }), 'utf8');

  const helper = spawn('/bin/sh', [helperPath, String(process.pid), downloadedFile, appPath, statePath], {
    detached: true,
    stdio: 'ignore',
  });
  helper.unref();
  app.quit();
}

function emitUpdate(event: UpdateCheckResponse): UpdateCheckResponse {
  lastUpdateEvent = { ...event, at: new Date().toISOString() };
  mainWindow?.webContents.send('updates:progress', lastUpdateEvent);
  return event;
}

function isSafeExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function openExternalSafely(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  void shell.openExternal(url.trim()).catch((error) => {
    console.error(`[navigation] could not open external URL: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** Never let a website replace Nodus inside its main BrowserWindow. */
function protectMainWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    let sameOrigin = false;
    try {
      const target = new URL(url);
      const current = new URL(currentUrl);
      sameOrigin = /^https?:$/i.test(target.protocol) && target.origin === current.origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin) return;
    event.preventDefault();
    openExternalSafely(url);
  });
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
  protectMainWindowNavigation(mainWindow);

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Don't let the always-on-top mascot window keep the app alive after the main
    // window closes (matters on Windows/Linux, where window-all-closed quits).
    destroyMascotWindow();
  });
}

async function checkForUpdates(reason: string): Promise<UpdateCheckResponse> {
  // Deterministic real-window coverage for the startup modal without contacting
  // release infrastructure from the isolated E2E profile.
  if (process.env.NODUS_E2E_UPDATE_STATUS === 'not-available') {
    return emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  }
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
  installUpdateTimer = setTimeout(() => {
    installUpdateTimer = null;
    void (async () => {
      try {
        if (useUnsignedMacUpdaterFallback) {
          if (!downloadedUpdateFile) throw new Error('No se encontró el paquete descargado para instalar la actualización.');
          await installUnsignedMacUpdate(downloadedUpdateFile);
        } else {
          autoUpdater.quitAndInstall(false, true);
        }
      } catch (e) {
        installingUpdate = false;
        emitUpdate({
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
          version: downloadedUpdateVersion ?? app.getVersion(),
          progress: null,
        });
      }
    })();
  }, 650);
  return response;
}

function setupAutoUpdates(): void {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    console.log('[updates] disabled outside packaged app');
    return;
  }

  useUnsignedMacUpdaterFallback = process.platform === 'darwin' && !macAppHasDeveloperIdSignature();
  autoUpdater.autoDownload = true;
  // Squirrel.Mac only reliably hands off to a Developer ID-signed app. For the
  // current ad-hoc fallback, keep electron-updater's verified ZIP and replace
  // the writable .app with our external helper instead of waiting forever for
  // a native event that macOS never delivers.
  autoUpdater.autoInstallOnAppQuit = !useUnsignedMacUpdaterFallback;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  console.log(
    useUnsignedMacUpdaterFallback
      ? '[updates] using unsigned macOS fallback installer'
      : '[updates] using native updater hand-off'
  );

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
    downloadedUpdateFile = info.downloadedFile;
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
    if (installUpdateTimer) {
      clearTimeout(installUpdateTimer);
      installUpdateTimer = null;
    }
    installingUpdate = false;
    console.error(`[updates] error: ${e instanceof Error ? e.message : String(e)}`);
    emitUpdate({
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
      version: downloadedUpdateVersion ?? app.getVersion(),
      progress: null,
    });
  });

  // The renderer's cinematic startup modal performs the immediate check and
  // presents its result. Keep the long-running scheduled checks here.
  updateCheckTimer = setInterval(() => void checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  restorePersistedDockIcon();
  getDb(); // open + migrate before anything touches data
  reconcileAuthorLayerOnce(); // one-time: collapse duplicate author nodes onto Zotero identity
  // Maintenance: drop ideas that have sat dormant (no occurrences) for >30 days.
  // Recent dormancy is kept — it lets fusion revive an idea with the same
  // global_id when its work is rescanned.
  const prunedIdeas = pruneDormantIdeas();
  if (prunedIdeas > 0) console.log(`[maintenance] pruned ${prunedIdeas} long-dormant ideas`);
  setCopilotWindowProvider(() => mainWindow);
  registerIpc(() => mainWindow, () => checkForUpdates('manual'), installDownloadedUpdate);
  createWindow();

  // Recover API keys encrypted by the pre-2.3 lowercase Safe Storage identity.
  // The window is created first so any macOS Keychain authorization prompt has
  // visible app context. On success the renderer refreshes Settings, and the
  // configured recovery workspace immediately receives a complete new snapshot.
  void recoverLegacyApiKeys().then(async (result) => {
    if (result.recoveredProviders.length > 0) {
      mainWindow?.webContents.send('settings:apiKeysRecovered', result);
      const recoverySettings = getSettings();
      if (recoverySettings.autoBackupEnabled && recoverySettings.autoBackupFolder) {
        const backup = await runAutoBackupNow(app.getVersion());
        console.log(`[backup] API-key recovery snapshot: ${backup.ok ? 'ok' : 'error'}: ${backup.message}`);
      }
    } else if (result.remainingLockedProviders.length > 0) {
      mainWindow?.webContents.send('settings:apiKeysRecovered', result);
    }
  }).catch((error) => console.error(`[secrets] recovery failed safely: ${error instanceof Error ? error.message : String(error)}`));

  const settings = getSettings();
  // Queue resume is opt-in: pending DB state may come from previous automatic versions.
  if (settings.autoResumeQueue) scanQueue.resumePending();

  // Automatic backups: first check shortly after launch (so an overdue backup
  // runs without waiting a full interval), then a low-frequency heartbeat. The
  // heavy work (SQLite snapshot + scrypt + AES) is a single async pass and the
  // schedule state lives in settings, so missed ticks self-correct.
  const autoBackupTick = () => {
    void maybeRunAutoBackup(app.getVersion()).then((result) => {
      if (result) console.log(`[backup] ${result.ok ? 'ok' : 'error'}: ${result.message}`);
    });
  };
  setTimeout(autoBackupTick, 2 * 60 * 1000);
  setInterval(autoBackupTick, 30 * 60 * 1000);

  if (settings.syncMode === 'realtime') startRealtimeSync();
  if (settings.mcpEnabled) void startMcpServer();
  if (settings.copilotEnabled) void startCopilotServer();
  // Nodi mascot: open the always-on-top desktop window when the user has opted into it.
  seedWelcomeNotification();
  startStudyCalendarReminders();
  applyMascotWindow();
  setupAutoUpdates();

  // Genealogy demo: fill in the daguerreotype portraits in the background if this
  // vault is showing the demo, a Gemini key is present, and some are still missing.
  if (settings.demoMode && getActiveVault().type === 'genealogy' && hasDemoPortraitKey() && demoPortraitsPending()) {
    void generateDemoPortraits({
      onProgress: (done, total) => mainWindow?.webContents.send('demo:portraits', { done, total }),
    }).catch(() => undefined);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopRealtimeSync();
    interruptDecorativeImageGenerations();
    closeDb();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopStudyCalendarReminders();
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (installUpdateTimer) clearTimeout(installUpdateTimer);
  stopRealtimeSync();
  interruptDecorativeImageGenerations();
  void stopMcpServer();
  void stopCopilotServer();
  closeDb();
});

const updateAwareApp = app as typeof app & { on(event: 'before-quit-for-update', listener: () => void): typeof app };
updateAwareApp.on('before-quit-for-update', () => {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  stopRealtimeSync();
  interruptDecorativeImageGenerations();
  void stopMcpServer();
  void stopCopilotServer();
  closeDb();
});
