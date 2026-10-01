// PDF Presenter — the audience + presenter BrowserWindows, the mobile-remote server
// and the control hub that keeps them all in sync (main is the hub, mirroring the
// reference app). The audience opens full-screen on the external display; the
// presenter view on the built-in one. Canonical runtime state lives here (a pure
// reducer from @shared/presenterState); each applied action is fanned out to the
// other window AND to the phone clients, so the two Electron windows and any number
// of phones share one state. The LAN server runs only while presenting.
import path from 'node:path';
import { app, BrowserWindow, screen, powerSaveBlocker } from 'electron';
import { getSettings } from '../../db/settingsRepo';
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
import { startNativePresenter, stopNativePresenter, broadcastNativePresenter, getNativePresenterInfo } from './native';
import { startLanPresenter, stopLanPresenter, broadcastLanPresenter, broadcastLanVolume, getLanPresenterInfo } from './lan';

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');

let audienceWindow: BrowserWindow | null = null;
let presenterWindow: BrowserWindow | null = null;
let state: PresenterRuntimeState = initialPresenterState();
let powerSaveBlockerId: number | null = null;
let timerTick: ReturnType<typeof setInterval> | null = null;
let timerAnchor = 0;
let videoVolume = 50;

function getVideoVolume(): Promise<number> { return Promise.resolve(videoVolume); }
async function setVideoVolume(value: number): Promise<void> {
  if (!Number.isFinite(value)) return;
  videoVolume = Math.max(0, Math.min(100, Math.round(value)));
  applyAndRelay({ type: 'videoVolume', volume: videoVolume }, {});
  broadcastLanVolume(videoVolume);
}

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
      // Deck playback and the cast handoff, nine methods, none of which writes to a
      // vault. See shared/api/windows.ts.
      preload: path.join(__dirname, 'preload.presenter.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function createAudienceWindow(pdfId: string, startSlide: number, fullscreen = true): void {
  const { audience } = pickDisplays();
  const win = new BrowserWindow(baseWindowOptions(audience, fullscreen));
  audienceWindow = win;
  loadEntry(win, 'presenterAudience.html', {
    pdfId,
    startSlide: String(startSlide),
    role: 'audience',
    language: getSettings().uiLanguage,
  });
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
  loadEntry(win, 'presenterView.html', {
    pdfId,
    startSlide: String(startSlide),
    role: 'presenter',
    language: getSettings().uiLanguage,
  });
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
  videoVolume = 50;
  state.timerRunning = withPresenter;
  timerAnchor = Date.now();
  timerTick = setInterval(() => {
    if (state.timerRunning) {
      const seconds = Math.floor((Date.now() - timerAnchor) / 1000);
      applyAndRelay({ type: 'timerSync', timerSeconds: seconds, timerRunning: true }, {});
    }
  }, 1000);
  // On a single display, presenter mode can't show BOTH windows fullscreen at once:
  // macOS gives each fullscreen window its own Space, so the audience (opened first)
  // ends up hiding the presenter console entirely. Keep the audience as a plain
  // window in that case so the console — created last, and fullscreen — is what the
  // user actually lands on. With two displays each window gets its own screen.
  const singleDisplay = screen.getAllDisplays().length <= 1;
  createAudienceWindow(pdfId, startSlide, !(withPresenter && singleDisplay));
  if (withPresenter) createPresenterWindow(pdfId, startSlide);
  startPowerSave();
  try {
    startNativePresenter({
      libraryDir: presenterDir,
      getState: () => state,
      onAction: (action, origin) => applyAndRelay(action, { nativeOrigin: origin }),
      getVolume: getSystemVolume,
      setVolume: setSystemVolume,
    });
  } catch {
    stopNativePresenter();
  }
  if (process.platform === 'win32' || process.platform === 'linux') {
    void startLanPresenter({
      libraryDir: presenterDir,
      getState: () => state,
      onAction: (action, origin) => applyAndRelay(action, { nativeOrigin: origin }),
      getVolume: getVideoVolume,
      setVolume: setVideoVolume,
    });
  }
  // The mobile remote is best-effort: a server failure must not break presenting.
  void startPresenterServer({
    libraryDir: presenterDir,
    getState: () => state,
    onRemoteAction: handleRemoteControl,
    getVolume: process.platform === 'darwin' ? getSystemVolume : getVideoVolume,
    setVolume: process.platform === 'darwin' ? setSystemVolume : setVideoVolume,
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
  if (timerTick) clearInterval(timerTick);
  timerTick = null;
  stopNativePresenter();
  stopLanPresenter();
  stopPresenterServer();
  state = initialPresenterState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('presenter:ended');
  }
  stopping = false;
}

/** Reduce an action into the canonical state and fan it out to every other consumer. */
function applyAndRelay(action: PresenterAction, exclude: { wc?: Electron.WebContents; clientId?: number; nativeOrigin?: string }): void {
  if (action.type === 'timerToggle' || action.type === 'timerReset') {
    timerAnchor = Date.now() - (action.type === 'timerReset' ? 0 : state.timerSeconds * 1000);
  }
  state = presenterReducer(state, action);
  const originWin = exclude.wc ? BrowserWindow.fromWebContents(exclude.wc) : null;
  for (const w of [audienceWindow, presenterWindow]) {
    if (w && w !== originWin && !w.isDestroyed()) w.webContents.send('presenter:control:event', action);
  }
  broadcastToClients(action, exclude.clientId);
  broadcastNativePresenter(action, exclude.nativeOrigin);
  broadcastLanPresenter(action, exclude.nativeOrigin);
  if (action.type === 'setTotal' && process.platform !== 'darwin') {
    // The audience can finish loading after pairing. Prime its player with the
    // latest session volume rather than silently restoring YouTube's default.
    applyAndRelay({ type: 'videoVolume', volume: videoVolume }, {});
  }
  if (action.type === 'timerToggle' || action.type === 'timerReset') {
    const sync: PresenterAction = { type: 'timerSync', timerSeconds: state.timerSeconds, timerRunning: state.timerRunning };
    for (const w of [audienceWindow, presenterWindow]) if (w && !w.isDestroyed()) w.webContents.send('presenter:control:event', sync);
    broadcastToClients(sync);
  }
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
export async function getServerInfoWithQr(): Promise<(PresenterServerInfo & { qr: string; native?: { url: string; qr: string; name: string; transport?: 'lan' } }) | null> {
  const info = getPresenterServerInfo();
  if (!info) return null;
  const qr = await QRCode.toDataURL(info.url, { width: 320, margin: 2 });
  const native = process.platform === 'darwin' ? getNativePresenterInfo() : getLanPresenterInfo();
  return { ...info, qr, ...(native ? { native: { ...native, qr: await QRCode.toDataURL(native.url, { width: 320, margin: 2 }) } } : {}) };
}
