// PDF Presenter — the audience + presenter BrowserWindows, the mobile-remote server
// and the control hub that keeps them all in sync (main is the hub, mirroring the
// reference app). The audience opens full-screen on the external display; the
// presenter view on the built-in one. Canonical runtime state lives here (a pure
// reducer from @shared/presenterState); each applied action is fanned out to the
// other window AND to the phone clients, so the two Electron windows and any number
// of phones share one state. The LAN server runs only while presenting.
import path from 'node:path';
import { app, BrowserWindow, screen, powerSaveBlocker } from 'electron';
import QRCode from 'qrcode';
import {
  beginPresentation,
  initialPresenterState,
  presenterReducer,
  type PresenterAction,
  type PresenterRuntimeState,
} from '@shared/presenterState';
import {
  startPresenterServer,
  stopPresenterServer,
  broadcastToClients,
  getPresenterServerInfo,
  type PresenterServerInfo,
} from './server';
import { getSystemVolume, setSystemVolume } from './systemAudio';

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');

let audienceWindow: BrowserWindow | null = null;
let presenterWindow: BrowserWindow | null = null;
let state: PresenterRuntimeState = initialPresenterState();
let powerSaveBlockerId: number | null = null;

function presenterDir(): string {
  return path.join(app.getPath('userData'), 'toolkit', 'presenter');
}

/** Pick the built-in display for the presenter and an external one for the audience. */
function pickDisplays(): { presenter: Electron.Display; audience: Electron.Display } {
  const all = screen.getAllDisplays();
  if (all.length <= 1) return { presenter: all[0], audience: all[0] };
  const builtIn = all.find((d) => d.internal) || screen.getPrimaryDisplay();
  const external = all.find((d) => d.id !== builtIn.id) || builtIn;
  return { presenter: builtIn, audience: external };
}

function loadEntry(win: BrowserWindow, htmlFile: string, query: Record<string, string>): void {
  if (VITE_DEV_SERVER_URL) {
    const url = new URL(htmlFile, VITE_DEV_SERVER_URL);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(RENDERER_DIST, htmlFile), { query });
  }
}

function baseWindowOptions(display: Electron.Display, fullscreen = true): Electron.BrowserWindowConstructorOptions {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}

function createAudienceWindow(pdfId: string, startSlide: number, fullscreen = true): void {
  const { audience } = pickDisplays();
  const win = new BrowserWindow(baseWindowOptions(audience, fullscreen));
  audienceWindow = win;
  loadEntry(win, 'presenterAudience.html', { pdfId, startSlide: String(startSlide), role: 'audience' });
  win.on('closed', () => {
    if (audienceWindow === win) audienceWindow = null;
    // The audience is the presentation — closing it ends everything.
    stopPresentation();
  });
}

function createPresenterWindow(pdfId: string, startSlide: number): void {
  const { presenter } = pickDisplays();
  const win = new BrowserWindow(baseWindowOptions(presenter));
  presenterWindow = win;
  loadEntry(win, 'presenterView.html', { pdfId, startSlide: String(startSlide), role: 'presenter' });
  win.on('closed', () => {
    if (presenterWindow === win) presenterWindow = null;
  });
}

function startPowerSave(): void {
  if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
}

function stopPowerSave(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  powerSaveBlockerId = null;
}

/** Start a presentation (audience only, or with the presenter view too). */
export function startPresentation(pdfId: string, startSlide = 1, withPresenter = false): void {
  stopPresentation();
  state = beginPresentation(pdfId, startSlide);
  // On a single display, presenter mode can't show BOTH windows fullscreen at once:
  // macOS gives each fullscreen window its own Space, so the audience (opened first)
  // ends up hiding the presenter console entirely. Keep the audience as a plain
  // window in that case so the console — created last, and fullscreen — is what the
  // user actually lands on. With two displays each window gets its own screen.
  const singleDisplay = screen.getAllDisplays().length <= 1;
  createAudienceWindow(pdfId, startSlide, !(withPresenter && singleDisplay));
  if (withPresenter) createPresenterWindow(pdfId, startSlide);
  startPowerSave();
  // The mobile remote is best-effort: a server failure must not break presenting.
  void startPresenterServer({
    libraryDir: presenterDir,
    getState: () => state,
    onRemoteAction: handleRemoteControl,
    getVolume: getSystemVolume,
    setVolume: setSystemVolume,
  }).catch((err) => console.error('Presenter server failed to start:', err));
}

let stopping = false;
export function stopPresentation(): void {
  if (stopping) return;
  stopping = true;
  const wins = [audienceWindow, presenterWindow];
  audienceWindow = null;
  presenterWindow = null;
  for (const w of wins) {
    if (w && !w.isDestroyed()) w.close();
  }
  stopPowerSave();
  stopPresenterServer();
  state = initialPresenterState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('presenter:ended');
  }
  stopping = false;
}

/** Reduce an action into the canonical state and fan it out to every other consumer. */
function applyAndRelay(action: PresenterAction, exclude: { wc?: Electron.WebContents; clientId?: number }): void {
  state = presenterReducer(state, action);
  const originWin = exclude.wc ? BrowserWindow.fromWebContents(exclude.wc) : null;
  for (const w of [audienceWindow, presenterWindow]) {
    if (w && w !== originWin && !w.isDestroyed()) w.webContents.send('presenter:control:event', action);
  }
  broadcastToClients(action, exclude.clientId);
}

/** Control from an Electron window (audience or presenter). */
export function handlePresenterControl(sender: Electron.WebContents, action: PresenterAction): void {
  applyAndRelay(action, { wc: sender });
}

/** Control from a phone (relayed by the server). */
export function handleRemoteControl(action: PresenterAction, clientId: number): void {
  applyAndRelay(action, { clientId });
}

export function getPresenterRuntimeState(): PresenterRuntimeState {
  return state;
}

/** Server info + a QR data URL for the presenter window's "scan to connect" panel. */
export async function getServerInfoWithQr(): Promise<(PresenterServerInfo & { qr: string }) | null> {
  const info = getPresenterServerInfo();
  if (!info) return null;
  const qr = await QRCode.toDataURL(info.url, { width: 320, margin: 2 });
  return { ...info, qr };
}
