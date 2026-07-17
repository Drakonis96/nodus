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
// Roomy enough for Nodi plus its radial menu and panels. Keep these native bounds
// stable: on macOS, resizing a visible transparent NSPanel briefly stretches its old
// backing surface from the new origin before Chromium submits the next frame. That
// exact transient is the diagonal jump seen when Nodi opens outside the main app.
const EXPANDED_WIDTH = 600;
const EXPANDED_HEIGHT = 520;
const FIGURE_WIDTH = 180;
const FIGURE_HEIGHT = 200;
const MARGIN = 16;

let mascotWindow: BrowserWindow | null = null;
let tutorialVisible = false;
let placement: NodiOverlayPlacement = { x: MARGIN, y: MARGIN, horizontal: 'left', vertical: 'up' };
let windowDrag: { cursorX: number; cursorY: number; nodiX: number; nodiY: number } | null = null;
let requestedBounds: { x: number; y: number; width: number; height: number } | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));

function placeWindowAroundNodi(win: BrowserWindow, desiredX: number, desiredY: number): NodiOverlayPlacement {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(desiredX + FIGURE_WIDTH / 2),
    y: Math.round(desiredY + FIGURE_HEIGHT / 2),
  });
  const { workArea } = display;
  const nodiX = clamp(desiredX, workArea.x, workArea.x + workArea.width - FIGURE_WIDTH);
  const nodiY = clamp(desiredY, workArea.y, workArea.y + workArea.height - FIGURE_HEIGHT);
  const horizontal: NodiOverlayPlacement['horizontal'] = nodiX + FIGURE_WIDTH / 2 >= workArea.x + workArea.width / 2 ? 'left' : 'right';
  const vertical: NodiOverlayPlacement['vertical'] = nodiY + FIGURE_HEIGHT / 2 >= workArea.y + workArea.height / 2 ? 'up' : 'down';
  const width = Math.min(EXPANDED_WIDTH, workArea.width);
  const height = Math.min(EXPANDED_HEIGHT, workArea.height);
  const idealX = horizontal === 'left' ? nodiX - (width - FIGURE_WIDTH - MARGIN) : nodiX - MARGIN;
  const idealY = vertical === 'up' ? nodiY - (height - FIGURE_HEIGHT - MARGIN) : nodiY - MARGIN;
  const x = clamp(idealX, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(idealY, workArea.y, workArea.y + workArea.height - height);

  const nextBounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  const currentBounds = win.getBounds();
  const isRepeatedRequest = requestedBounds
    && requestedBounds.x === nextBounds.x
    && requestedBounds.y === nextBounds.y
    && requestedBounds.width === nextBounds.width
    && requestedBounds.height === nextBounds.height;
  if (!isRepeatedRequest) {
    if (
      currentBounds.x !== nextBounds.x
      || currentBounds.y !== nextBounds.y
      || currentBounds.width !== nextBounds.width
      || currentBounds.height !== nextBounds.height
    ) {
      win.setBounds(nextBounds, false);
    }
    // Keep the requested rectangle as well as the applied one. AppKit may inset a
    // transparent NSPanel at a screen edge; comparing only against getBounds() would
    // resend the rejected x=0 request on every pointermove and make the panel rock.
    requestedBounds = nextBounds;
  }
  // Read the applied bounds: native window managers may constrain a requested
  // position. Placement must describe where Nodi really is, not where we asked the
  // host window to be, or the next pointer event feeds that error back as a bounce.
  const appliedBounds = win.getBounds();
  placement = {
    x: Math.round(clamp(nodiX - appliedBounds.x, 0, appliedBounds.width - FIGURE_WIDTH)),
    y: Math.round(clamp(nodiY - appliedBounds.y, 0, appliedBounds.height - FIGURE_HEIGHT)),
    horizontal,
    vertical,
  };
  return placement;
}

function currentNodiPosition(win: BrowserWindow): { x: number; y: number } {
  const bounds = win.getBounds();
  return { x: bounds.x + placement.x, y: bounds.y + placement.y };
}

function cursorIsOverNodi(win: BrowserWindow): boolean {
  const cursor = screen.getCursorScreenPoint();
  const nodi = currentNodiPosition(win);
  return cursor.x >= nodi.x
    && cursor.x < nodi.x + FIGURE_WIDTH
    && cursor.y >= nodi.y
    && cursor.y < nodi.y + FIGURE_HEIGHT;
}

function applyClosedMousePassthrough(win: BrowserWindow): void {
  // The host stays large to avoid a native resize flash. Its transparent area must
  // therefore pass through to the app below, while a stationary pointer already on
  // Nodi must remain clickable without requiring a preparatory mouse movement.
  win.setIgnoreMouseEvents(!cursorIsOverNodi(win), { forward: true });
}

function positionBottomRight(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  placeWindowAroundNodi(
    win,
    workArea.x + workArea.width - FIGURE_WIDTH - MARGIN,
    workArea.y + workArea.height - FIGURE_HEIGHT - MARGIN
  );
}

function createMascotWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: EXPANDED_WIDTH,
    height: EXPANDED_HEIGHT,
    show: false,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    // Movement is implemented below in absolute screen space. Letting AppKit also
    // treat this panel as user-movable makes macOS apply a second edge constraint,
    // so pointer movement at the left wall visibly rebounds between two positions.
    movable: false,
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
      // Nodi is an animated desktop overlay and remains visible while another app
      // owns the active window. Chromium's default background throttling suspends
      // its compositor in that exact state; the first click would otherwise resume
      // with a stale frame. Keep this one tiny renderer compositing continuously.
      backgroundThrottling: false,
    },
  });

  // Highest normal level so it sits above everything, re-asserted on show (macOS can
  // demote it across Space changes). The 'panel' type above handles the fullscreen /
  // all-Spaces behaviour, so we don't call setVisibleOnAllWorkspaces (which would
  // transform the process type and flicker the Dock icon each time).
  const applyLevels = () => {
    win.setAlwaysOnTop(true, 'screen-saver');
    // `movable: false` is not consistently retained when AppKit materialises a
    // non-activating panel, so enforce it on the live NSWindow as well.
    win.setMovable(false);
  };
  applyLevels();
  positionBottomRight(win);
  applyClosedMousePassthrough(win);

  win.on('show', applyLevels);
  win.on('blur', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('nodi:dismiss');
      applyClosedMousePassthrough(win);
    }
  });
  win.once('ready-to-show', () => {
    applyLevels();
    applyClosedMousePassthrough(win);
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
      requestedBounds = null;
      placement = { x: MARGIN, y: MARGIN, horizontal: 'left', vertical: 'up' };
    }
  });
  return win;
}

/** Toggle full-host interactivity without moving or resizing Nodi. */
export function setMascotWindowExpanded(win: BrowserWindow, expanded: boolean): NodiOverlayPlacement {
  const nodi = currentNodiPosition(win);
  windowDrag = null;
  if (expanded) win.setIgnoreMouseEvents(false, { forward: true });
  else applyClosedMousePassthrough(win);
  // Deliberately keep the native window expanded. Only its mouse passthrough state
  // changes; stable bounds mean AppKit never has an old compact surface to flash.
  return placeWindowAroundNodi(win, nodi.x, nodi.y);
}

/** Placement already computed before mascot.html loads, for its very first frame. */
export function getMascotWindowPlacement(): NodiOverlayPlacement {
  return { ...placement };
}

/** Start an absolute screen-space drag. This is stable while the native window moves. */
export function beginMascotWindowDrag(win: BrowserWindow, screenX: number, screenY: number): NodiOverlayPlacement {
  const nodi = currentNodiPosition(win);
  win.setIgnoreMouseEvents(false, { forward: true });
  placement = placeWindowAroundNodi(win, nodi.x, nodi.y);
  const placedNodi = currentNodiPosition(win);
  windowDrag = { cursorX: screenX, cursorY: screenY, nodiX: placedNodi.x, nodiY: placedNodi.y };
  return placement;
}

export function dragMascotWindow(win: BrowserWindow, screenX: number, screenY: number): NodiOverlayPlacement {
  if (!windowDrag) return placement;
  return placeWindowAroundNodi(
    win,
    windowDrag.nodiX + screenX - windowDrag.cursorX,
    windowDrag.nodiY + screenY - windowDrag.cursorY
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
