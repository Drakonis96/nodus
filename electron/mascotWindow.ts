import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { getSettings } from './db/settingsRepo';

// Standalone always-on-top desktop window that hosts the Nodi mascot (mascot.html).
// It floats above other applications on the operating systems that allow it. The
// mascot is purely visual for now; the window is a transparent, frameless drag
// surface so it can be repositioned on the desktop.

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');
// Roomy enough for Nodi plus its radial menu and a compact panel. The window is
// transparent and click-through by default (the renderer re-enables the mouse only
// over Nodi and open panels), so the extra size is not a dead zone over other apps.
const WIDTH = 540;
const HEIGHT = 520;
const MARGIN = 16;

let mascotWindow: BrowserWindow | null = null;

function positionBottomRight(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + workArea.width - WIDTH - MARGIN);
  const y = Math.round(workArea.y + workArea.height - HEIGHT - MARGIN);
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function createMascotWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: 'Nodi',
    // On macOS a 'panel' window gets the NSWindowStyleMaskNonactivatingPanel style
    // mask, which is THE thing that lets it float above other apps' fullscreen Spaces
    // (and appear on every Space) without stealing focus. Without it, alwaysOnTop +
    // setVisibleOnAllWorkspaces only covers windowed apps, not fullscreen ones.
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Highest normal level so it sits above everything, re-asserted on show (macOS can
  // demote it across Space changes). The 'panel' type above handles the fullscreen /
  // all-Spaces behaviour, so we don't call setVisibleOnAllWorkspaces (which would
  // transform the process type and flicker the Dock icon each time).
  const applyLevels = () => win.setAlwaysOnTop(true, 'screen-saver');
  applyLevels();
  // Transparent areas let clicks pass through to the apps behind; the renderer
  // re-enables the mouse only over Nodi and its open panels.
  win.setIgnoreMouseEvents(true, { forward: true });
  positionBottomRight(win);

  win.on('show', applyLevels);
  win.once('ready-to-show', () => {
    applyLevels();
    win.showInactive();
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('mascot.html', VITE_DEV_SERVER_URL).toString());
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'mascot.html'));
  }

  win.on('closed', () => {
    if (mascotWindow === win) mascotWindow = null;
  });
  return win;
}

/** Create, show or tear down the mascot window to match the current settings. */
export function applyMascotWindow(): void {
  let want = false;
  try {
    const s = getSettings();
    want = s.mascotEnabled && s.mascotAlwaysOnTop;
  } catch {
    want = false;
  }
  if (want) {
    if (!mascotWindow || mascotWindow.isDestroyed()) {
      mascotWindow = createMascotWindow();
    } else {
      mascotWindow.showInactive();
    }
  } else if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.close();
    mascotWindow = null;
  }
}

/** Close the mascot window (e.g. when the main window closes or the app quits). */
export function destroyMascotWindow(): void {
  if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.close();
  mascotWindow = null;
}
