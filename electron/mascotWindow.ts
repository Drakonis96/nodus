import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { NodiOverlayPlacement } from '@shared/types';
import { getSettings } from './db/settingsRepo';

// Standalone always-on-top desktop window that hosts the Nodi mascot (mascot.html).
// It floats above other applications on the operating systems that allow it. The
// mascot is purely visual for now; the window is a transparent, frameless drag
// surface so it can be repositioned on the desktop.

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');
// Roomy enough for Nodi plus its radial menu and a compact panel. The window is
// transparent. Its compact bounds hug Nodi; the larger bounds are used only while a
// menu or panel is open.
const EXPANDED_WIDTH = 600;
const EXPANDED_HEIGHT = 520;
const FIGURE_WIDTH = 180;
const FIGURE_HEIGHT = 200;
const MARGIN = 16;
const COMPACT_WIDTH = FIGURE_WIDTH + MARGIN * 2;
const COMPACT_HEIGHT = FIGURE_HEIGHT + MARGIN * 2;

let mascotWindow: BrowserWindow | null = null;
let tutorialVisible = false;
let placement: NodiOverlayPlacement = { x: MARGIN, y: MARGIN, horizontal: 'left', vertical: 'up' };
let windowDrag: { cursorX: number; cursorY: number; nodiX: number; nodiY: number; expanded: boolean } | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));

function placeWindowAroundNodi(win: BrowserWindow, desiredX: number, desiredY: number, expanded: boolean): NodiOverlayPlacement {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(desiredX + FIGURE_WIDTH / 2),
    y: Math.round(desiredY + FIGURE_HEIGHT / 2),
  });
  const { workArea } = display;
  const nodiX = clamp(desiredX, workArea.x, workArea.x + workArea.width - FIGURE_WIDTH);
  const nodiY = clamp(desiredY, workArea.y, workArea.y + workArea.height - FIGURE_HEIGHT);
  const horizontal: NodiOverlayPlacement['horizontal'] = nodiX + FIGURE_WIDTH / 2 >= workArea.x + workArea.width / 2 ? 'left' : 'right';
  const vertical: NodiOverlayPlacement['vertical'] = nodiY + FIGURE_HEIGHT / 2 >= workArea.y + workArea.height / 2 ? 'up' : 'down';
  const width = expanded ? Math.min(EXPANDED_WIDTH, workArea.width) : COMPACT_WIDTH;
  const height = expanded ? Math.min(EXPANDED_HEIGHT, workArea.height) : COMPACT_HEIGHT;
  const idealX = expanded && horizontal === 'left' ? nodiX - (width - FIGURE_WIDTH - MARGIN) : nodiX - MARGIN;
  const idealY = expanded && vertical === 'up' ? nodiY - (height - FIGURE_HEIGHT - MARGIN) : nodiY - MARGIN;
  const x = clamp(idealX, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(idealY, workArea.y, workArea.y + workArea.height - height);

  placement = { x: Math.round(nodiX - x), y: Math.round(nodiY - y), horizontal, vertical };
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  return placement;
}

function currentNodiPosition(win: BrowserWindow): { x: number; y: number } {
  const bounds = win.getBounds();
  return { x: bounds.x + placement.x, y: bounds.y + placement.y };
}

function positionBottomRight(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  placeWindowAroundNodi(
    win,
    workArea.x + workArea.width - FIGURE_WIDTH - MARGIN,
    workArea.y + workArea.height - FIGURE_HEIGHT - MARGIN,
    false
  );
}

function createMascotWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: COMPACT_WIDTH,
    height: COMPACT_HEIGHT,
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
  // Keep the compact host interactive. Enabling it from a forwarded mousemove races
  // a fast click, which makes Nodi appear unresponsive. The compact window is only a
  // 16px margin larger than the figure, so it remains a tightly scoped hit target.
  win.setIgnoreMouseEvents(false, { forward: true });
  positionBottomRight(win);

  win.on('show', applyLevels);
  win.on('blur', () => {
    if (!win.isDestroyed()) win.webContents.send('nodi:dismiss');
  });
  win.once('ready-to-show', () => {
    applyLevels();
    if (!tutorialVisible) win.showInactive();
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('mascot.html', VITE_DEV_SERVER_URL).toString());
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'mascot.html'));
  }

  win.on('closed', () => {
    if (mascotWindow === win) {
      mascotWindow = null;
      windowDrag = null;
      placement = { x: MARGIN, y: MARGIN, horizontal: 'left', vertical: 'up' };
    }
  });
  return win;
}

/** Resize the transparent host around the mascot without moving Nodi itself. */
export function setMascotWindowExpanded(win: BrowserWindow, expanded: boolean): NodiOverlayPlacement {
  const nodi = currentNodiPosition(win);
  windowDrag = null;
  return placeWindowAroundNodi(win, nodi.x, nodi.y, expanded);
}

/** Start an absolute screen-space drag. This is stable while the native window moves. */
export function beginMascotWindowDrag(win: BrowserWindow, screenX: number, screenY: number): NodiOverlayPlacement {
  const nodi = currentNodiPosition(win);
  const bounds = win.getBounds();
  const expanded = bounds.width > COMPACT_WIDTH || bounds.height > COMPACT_HEIGHT;
  placement = placeWindowAroundNodi(win, nodi.x, nodi.y, expanded);
  const placedNodi = currentNodiPosition(win);
  windowDrag = { cursorX: screenX, cursorY: screenY, nodiX: placedNodi.x, nodiY: placedNodi.y, expanded };
  return placement;
}

export function dragMascotWindow(win: BrowserWindow, screenX: number, screenY: number): NodiOverlayPlacement {
  if (!windowDrag) return placement;
  return placeWindowAroundNodi(
    win,
    windowDrag.nodiX + screenX - windowDrag.cursorX,
    windowDrag.nodiY + screenY - windowDrag.cursorY,
    windowDrag.expanded
  );
}

export function endMascotWindowDrag(): void {
  windowDrag = null;
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
  if (want && !tutorialVisible) {
    if (!mascotWindow || mascotWindow.isDestroyed()) {
      mascotWindow = createMascotWindow();
    } else {
      mascotWindow.showInactive();
    }
  } else if (tutorialVisible && mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.hide();
  } else if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.close();
    mascotWindow = null;
  }
}

/** Temporarily hide the real companion while the cinematic tutorial stages its own Nodi. */
export function setMascotTutorialVisible(visible: boolean): void {
  tutorialVisible = visible;
  applyMascotWindow();
}

/** Close the mascot window (e.g. when the main window closes or the app quits). */
export function destroyMascotWindow(): void {
  if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.close();
  mascotWindow = null;
}
