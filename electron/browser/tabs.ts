// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Nodus Browser tabs: one WebContentsView each, owned entirely by the main process.
 *
 * BrowserView is deprecated and <webview> is officially discouraged, so
 * WebContentsView is the supported primitive. It is a NATIVE child view, which
 * has two consequences the rest of the feature is built around:
 *
 *  1. It paints ABOVE the window's HTML, so every React modal, the command
 *     palette and the Nodi companion would be hidden behind a page. The renderer
 *     therefore tells us when an overlay opens and we hide the view (see
 *     `setOverlayVisible`) rather than trying to stack around it.
 *
 *  2. Only the ACTIVE tab is attached to `contentView`. Background tabs keep
 *     their WebContents alive — so a login, a scroll position and playing audio
 *     all survive — but are detached, so Chromium neither composites nor paints
 *     them. That is what makes a tab cheap enough to have twelve of.
 */

import { nativeTheme, WebContentsView, type BaseWindow, type WebContents } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserMediaCommand, BrowserState, BrowserTabError, BrowserTabState, BrowserViewport } from '@shared/browser';
import type { ThemeMode } from '@shared/types';
import { browserInternalPage, MAX_BROWSER_TABS } from '@shared/browser';
import { decideNavigation } from '@shared/browserNavigation';
import { NODUS_BROWSER_PARTITION, browserSession } from './session';
import { installContextMenu, type ContextMenuActions } from './contextMenu';
import { cachePageFavicon } from './favicon';
import {
  describeMediaSession,
  dropMediaSession,
  hasMediaSession,
  noteAudioState,
  noteMediaPaused,
  noteMediaPlaying,
  noteMuted,
  clearAllMediaSessions,
} from './media';

interface Tab {
  id: string;
  view: WebContentsView;
  /** What we last told the renderer, so a no-op change does not cause a send. */
  state: BrowserTabState;
  /** Every listener this tab registered, so closing it can undo all of them. */
  disposers: (() => void)[];
  /** In-flight page collection requests, completed with null during teardown. */
  pendingCollections: Set<(value: unknown) => void>;
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let hostWindow: BaseWindow | null = null;
let viewport: BrowserViewport | null = null;
/**
 * Two INDEPENDENT reasons the page may be hidden, deliberately not one flag.
 *
 * `sectionVisible` is whether the user is looking at the browser section at all;
 * `overlayOpen` is whether a React overlay is on top of it. Collapsing them into
 * one boolean is what shipped a page that stayed painted over the rest of the
 * app after switching sections, and a menu whose clicks went to the website
 * underneath it instead of to the menu.
 */
let sectionVisible = false;
let overlayOpen = false;
let notify: (() => void) | null = null;
let contextMenuActions: ContextMenuActions | null = null;
const pageThemeJobs = new WeakMap<WebContents, Promise<void>>();

function browserSurfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff';
}

function applyBrowserSurfaceColor(): void {
  const color = browserSurfaceColor();
  const dark = nativeTheme.shouldUseDarkColors;
  for (const tab of tabs.values()) {
    tab.view.setBackgroundColor(color);
    void applyPageColorScheme(tab.view.webContents, dark);
  }
}

/**
 * Electron's nativeTheme reaches the default renderer immediately, but a
 * persistent partition can leave an already-open WebContentsView on its former
 * media-query value. Chromium's own Emulation domain makes that preference
 * deterministic without reloading the page or injecting site CSS.
 */
async function applyPageColorScheme(
  contents: WebContents,
  dark = nativeTheme.shouldUseDarkColors,
): Promise<void> {
  const previous = pageThemeJobs.get(contents) ?? Promise.resolve();
  const job = previous.catch(() => undefined).then(async () => {
    if (contents.isDestroyed()) return;
    const attachedHere = !contents.debugger.isAttached();
    try {
      if (attachedHere) contents.debugger.attach('1.3');
      await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
      });
    } catch {
      // A user-opened DevTools session can own the debugger transport. The native
      // theme still supplies the normal fallback; never break browsing for style.
    } finally {
      if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
    }
  });
  pageThemeJobs.set(contents, job);
  await job;
  if (pageThemeJobs.get(contents) === job) pageThemeJobs.delete(contents);
}

/**
 * Keep Chromium's color preference and every native browser surface aligned
 * with Nodus's light / dark / system setting. Pages that support
 * `prefers-color-scheme` react live, just like the React application does.
 */
export function setBrowserTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme;
  applyBrowserSurfaceColor();
}

nativeTheme.on('updated', applyBrowserSurfaceColor);

/** Chromium error codes worth telling the user apart. */
function classifyError(code: number): BrowserTabError['kind'] {
  if (code === -105 || code === -137) return 'dns';        // NAME_NOT_RESOLVED / NAME_RESOLUTION_FAILED
  if (code === -106) return 'offline';                      // INTERNET_DISCONNECTED
  if (code === -102) return 'refused';                      // CONNECTION_REFUSED
  if (code === -7 || code === -118) return 'timeout';       // TIMED_OUT / CONNECTION_TIMED_OUT
  if (code <= -200 && code >= -299) return 'certificate';   // the whole CERT_ block
  return 'unknown';
}

function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

function emptyState(id: string, url: string): BrowserTabState {
  const kind = browserInternalPage(url) ?? 'web';
  return {
    id,
    kind,
    url,
    title: kind === 'bookmarks' ? 'Nodus Bookmarks' : kind === 'atlas' ? 'Research Atlas' : '',
    faviconDataUrl: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    audible: false,
    muted: false,
    hasMedia: false,
    mediaPlaying: false,
    error: null,
  };
}

/** Wire the host window and the change notifier. Called once, from the IPC layer. */
export function initBrowserTabs(window: BaseWindow, onChange: () => void, menu?: ContextMenuActions): void {
  hostWindow = window;
  notify = onChange;
  if (menu) contextMenuActions = menu;
}

export function browserState(): BrowserState {
  return {
    tabs: [...tabs.values()].map((tab) => ({ ...tab.state })),
    activeTabId,
  };
}

function patch(tab: Tab, next: Partial<BrowserTabState>): void {
  let changed = false;
  const current = tab.state as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (current[key] !== value) changed = true;
  }
  if (!changed) return;
  Object.assign(tab.state, next);
  // Error UI lives in the trusted renderer and must not be covered by the
  // native website view. Clearing the error makes the page visible again.
  if (Object.hasOwn(next, 'error') && tab.id === activeTabId) applyVisibility();
  notify?.();
}

function applyBounds(tab: Tab): void {
  if (!viewport) return;
  // Integers only: a fractional rectangle leaves a sub-pixel seam between the
  // native view and the React chrome around it.
  tab.view.setBounds({
    x: Math.round(viewport.x),
    y: Math.round(viewport.y),
    width: Math.max(0, Math.round(viewport.width)),
    height: Math.max(0, Math.round(viewport.height)),
  });
}

function attach(tab: Tab): void {
  if (!hostWindow || hostWindow.isDestroyed()) return;
  hostWindow.contentView.addChildView(tab.view);
  applyBounds(tab);
  tab.view.setVisible(tab.state.kind === 'web' && sectionVisible && !overlayOpen && !tab.state.error);
}

function detach(tab: Tab): void {
  if (!hostWindow || hostWindow.isDestroyed()) return;
  hostWindow.contentView.removeChildView(tab.view);
}

/** Register a listener and remember how to remove it. */
function on(tab: Tab, contents: WebContents, event: string, handler: (...args: never[]) => void): void {
  (contents as unknown as { on(e: string, h: unknown): void }).on(event, handler);
  tab.disposers.push(() => {
    (contents as unknown as { removeListener(e: string, h: unknown): void }).removeListener(event, handler);
  });
}

function wire(tab: Tab): void {
  const contents = tab.view.webContents;
  const isWeb = () => tab.state.kind === 'web';
  if (contextMenuActions) installContextMenu(contents, contextMenuActions, hostWindow);
  void applyPageColorScheme(contents);

  /**
   * The page preload's only unsolicited message. Register it on this exact
   * WebContents instead of ipcMain's global bus, then still require its main
   * frame. A different tab or any Nodus window has no listener to reach.
   */
  const pageMediaListener = (
    event: Electron.IpcMainEvent,
    payload: { playing?: unknown; kind?: unknown },
  ) => {
    if (!isWeb()) return;
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    const kind = payload?.kind === 'audio' || payload?.kind === 'video' ? payload.kind : 'unknown';
    if (payload?.playing === true) {
      noteMediaPlaying(tab.id, () => ({
        title: tab.state.title || tab.state.url,
        url: tab.state.url,
        origin: originOf(tab.state.url),
        faviconDataUrl: tab.state.faviconDataUrl,
      }), kind);
      patch(tab, { hasMedia: true, mediaPlaying: true });
    } else {
      noteMediaPaused(tab.id);
      patch(tab, { mediaPlaying: false });
    }
  };
  contents.ipc.on('nodus-browser:page:media', pageMediaListener);
  tab.disposers.push(() => contents.ipc.removeListener('nodus-browser:page:media', pageMediaListener));

  // Never let a page dictate the options of a window it opens. `allow` would
  // hand the site control of webPreferences; instead every popup becomes an
  // ordinary Nodus tab, created by us with our own configuration.
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, { isMainFrame: true }).allowed) void createTab(url);
    return { action: 'deny' };
  });

  on(tab, contents, 'select-bluetooth-device', ((event: Electron.Event, _devices: unknown[], callback: (id: string) => void) => {
    event.preventDefault();
    callback('');
  }) as never);

  on(tab, contents, 'will-navigate', ((event: Electron.Event, url: string) => {
    if (decideNavigation(url, { isMainFrame: true }).allowed) return;
    event.preventDefault();
    patch(tab, {
      error: { kind: 'blocked-scheme', code: null, description: url, url },
    });
  }) as never);

  on(tab, contents, 'will-frame-navigate', ((details: { url: string; isMainFrame: boolean; preventDefault(): void }) => {
    if (decideNavigation(details.url, { isMainFrame: details.isMainFrame }).allowed) return;
    details.preventDefault();
  }) as never);

  // Electron reports server redirects separately from will-navigate. Guard
  // them explicitly so an allowed HTTP endpoint cannot bounce into file: or a
  // privileged Nodus protocol between the initial request and the commit.
  on(tab, contents, 'will-redirect', ((details: { url: string; isMainFrame: boolean; preventDefault(): void }) => {
    if (decideNavigation(details.url, { isMainFrame: details.isMainFrame }).allowed) return;
    details.preventDefault();
    if (details.isMainFrame) {
      patch(tab, {
        loading: false,
        error: { kind: 'blocked-scheme', code: null, description: details.url, url: details.url },
      });
    }
  }) as never);

  on(tab, contents, 'did-start-loading', (() => { if (isWeb()) patch(tab, { loading: true, error: null }); }) as never);
  on(tab, contents, 'dom-ready', (() => { if (isWeb()) void applyPageColorScheme(contents); }) as never);

  // The address bar must follow navigation, not page load completion. A modern
  // page can keep the load event open for seconds (or indefinitely), so waiting
  // for did-stop-loading left the previous URL visible while the user was
  // already looking at the next document.
  on(tab, contents, 'did-redirect-navigation', ((details: { url: string; isMainFrame: boolean }) => {
    if (!isWeb() || !details.isMainFrame) return;
    patch(tab, { url: details.url });
  }) as never);

  on(tab, contents, 'did-navigate', ((_event: unknown, url: string) => {
    if (!isWeb()) return;
    patch(tab, {
      url,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }) as never);

  on(tab, contents, 'did-navigate-in-page', ((
    _event: unknown, url: string, isMainFrame: boolean,
  ) => {
    if (!isWeb() || !isMainFrame) return;
    patch(tab, {
      url,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }) as never);

  on(tab, contents, 'did-stop-loading', (() => {
    if (!isWeb()) return;
    patch(tab, {
      loading: false,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }) as never);

  on(tab, contents, 'page-title-updated', ((_e: unknown, title: string) => {
    if (!isWeb()) return;
    patch(tab, { title });
    describeMediaSession(tab.id, { title });
  }) as never);

  on(tab, contents, 'page-favicon-updated', ((_event: unknown, urls: string[]) => {
    if (!isWeb()) return;
    const expectedUrl = tab.state.url;
    void cachePageFavicon(Array.isArray(urls) ? urls : []).then((faviconDataUrl) => {
      if (!faviconDataUrl || !isWeb() || tab.state.url !== expectedUrl) return;
      patch(tab, { faviconDataUrl });
    });
  }) as never);

  /**
   * Media.
   *
   * Electron's own events are the primary signal and need no injection into the
   * page at all. `media-started-playing` fires for the first <video>/<audio> to
   * play; `media-paused` when they stop. Neither says whether it was audio or
   * video, which is the one thing the page preload adds.
   */
  on(tab, contents, 'media-started-playing', (() => {
    if (!isWeb()) return;
    noteMediaPlaying(tab.id, () => ({
      title: tab.state.title || tab.state.url,
      url: tab.state.url,
      origin: originOf(tab.state.url),
      faviconDataUrl: tab.state.faviconDataUrl,
    }));
    patch(tab, { hasMedia: true, mediaPlaying: true });
  }) as never);

  on(tab, contents, 'media-paused', (() => {
    if (!isWeb()) return;
    noteMediaPaused(tab.id);
    patch(tab, { mediaPlaying: false });
  }) as never);

  // Audibility is about sound, not about existence: it goes false on pause, and
  // a header that keyed on it would lose its own Play button.
  on(tab, contents, 'audio-state-changed', ((event: { audible: boolean }) => {
    if (!isWeb()) return;
    noteAudioState(tab.id, event.audible);
    patch(tab, { audible: event.audible });
  }) as never);

  // A main-frame navigation replaces the document, so whatever was playing is
  // gone. Subframe navigations must not count: an ad frame reloading underneath
  // a video would otherwise drop the controls for the video.
  on(tab, contents, 'did-start-navigation', ((details: {
    url: string; isMainFrame: boolean; isSameDocument: boolean;
  }) => {
    if (!isWeb() || !details.isMainFrame) return;
    patch(tab, {
      url: details.url,
      ...(details.isSameDocument ? {} : { loading: true, error: null }),
    });
    if (details.isSameDocument) return;
    if (!hasMediaSession(tab.id)) return;
    dropMediaSession(tab.id);
    patch(tab, { hasMedia: false, mediaPlaying: false, audible: false });
  }) as never);

  on(tab, contents, 'did-fail-load', ((
    _e: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean,
  ) => {
    // Subframe failures are ordinary noise (blocked trackers, dead embeds) and
    // must never replace a page that loaded fine.
    if (!isWeb() || !isMainFrame) return;
    // -3 is ABORTED, which is what a user pressing Stop or navigating away looks
    // like. Showing an error pane for it would be wrong.
    if (errorCode === -3) return;
    patch(tab, {
      loading: false,
      url: validatedURL || tab.state.url,
      error: { kind: classifyError(errorCode), code: errorCode, description: errorDescription, url: validatedURL },
    });
  }) as never);

  /**
   * Chromium validates certificates; Nodus only reflects the verdict.
   *
   * The listener signature is (event, url, error, certificate, callback), and
   * BOTH escape hatches are deliberately left alone: `event.preventDefault()`
   * plus `callback(true)` is how an app says "trust this anyway", and together
   * they are exactly the "proceed anyway" button v1 does not have. Touching
   * neither leaves Chromium's default, which is to reject.
   *
   * This is worth being explicit about because the two are easy to add later by
   * accident — a `callback(true)` looks like an acknowledgement rather than a
   * decision to trust an invalid certificate.
   */
  on(tab, contents, 'certificate-error', ((
    _e: unknown, url: string, error: string,
  ) => {
    if (!isWeb()) return;
    patch(tab, { loading: false, url, error: { kind: 'certificate', code: null, description: error, url } });
  }) as never);

  on(tab, contents, 'render-process-gone', ((_event: unknown, details: { reason?: string; exitCode?: number }) => {
    if (!isWeb()) return;
    // Keep the owned WebContents shell so Electron can create a fresh renderer
    // on Reload, but discard every document-scoped capability and hide the
    // native view behind Nodus's controlled crash pane. Nodus itself stays up.
    finishPendingCollections(tab);
    dropMediaSession(tab.id);
    patch(tab, {
      loading: false,
      audible: false,
      hasMedia: false,
      mediaPlaying: false,
      error: {
        kind: 'crashed',
        code: Number.isInteger(details?.exitCode) ? Number(details.exitCode) : null,
        description: String(details?.reason ?? 'renderer process exited'),
        url: tab.state.url,
      },
    });
  }) as never);

  on(tab, contents, 'unresponsive', (() => {
    if (!isWeb()) return;
    finishPendingCollections(tab);
    patch(tab, {
      loading: false,
      error: { kind: 'crashed', code: null, description: 'renderer unresponsive', url: tab.state.url },
    });
  }) as never);

  on(tab, contents, 'responsive', (() => {
    if (tab.state.error?.kind === 'crashed' && tab.state.error.description === 'renderer unresponsive') {
      patch(tab, { error: null });
    }
  }) as never);

  on(tab, contents, 'destroyed', (() => {
    // Covers destruction initiated outside the normal close/restart paths. The
    // ordinary destructor removes this listener before close(), so it cannot
    // recurse during expected teardown.
    destroyTab(tab.id, { activateReplacement: true, publish: true });
  }) as never);
}

export async function createTab(url: string): Promise<string | null> {
  if (tabs.size >= MAX_BROWSER_TABS) return null;
  const internalKind = browserInternalPage(url);
  if (!internalKind && !decideNavigation(url, { isMainFrame: true }).allowed) return null;

  const view = new WebContentsView({
    webPreferences: {
      partition: NODUS_BROWSER_PARTITION,
      preload: path.join(__dirname, 'preload.browserPage.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      // The isolated-world preload contains ipcRenderer. Production DevTools
      // would make that world selectable from an arbitrary page's console.
      devTools: false,
      // The single relaxation, and it buys Chromium's own PDF viewer. The
      // alternative — decoding untrusted PDF bytes with pdfjs inside the TRUSTED
      // renderer — is strictly worse.
      plugins: true,
      safeDialogs: true,
      spellcheck: true,
      backgroundThrottling: true,
      navigateOnDragDrop: false,
    },
  });
  view.setBackgroundColor(browserSurfaceColor());

  browserSession();

  const id = randomUUID();
  const tab: Tab = {
    id,
    view,
    state: emptyState(id, url),
    disposers: [],
    pendingCollections: new Set(),
  };
  tabs.set(id, tab);
  wire(tab);
  await activateTab(id);

  if (!internalKind && url && url !== 'about:blank') {
    // A load failure is reported through did-fail-load, which the UI already
    // renders; letting the rejection escape here would be a duplicate report.
    void view.webContents.loadURL(url).catch(() => undefined);
  }
  notify?.();
  return id;
}

export async function activateTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;
  const previous = activeTabId ? tabs.get(activeTabId) : null;
  if (previous && previous.id !== id) detach(previous);
  activeTabId = id;
  attach(tab);
  notify?.();
}

interface DestroyTabOptions {
  activateReplacement: boolean;
  publish: boolean;
}

function finishPendingCollections(tab: Tab): void {
  for (const finish of [...tab.pendingCollections]) finish(null);
  tab.pendingCollections.clear();
}

/** The single destructor used by close, external destruction, restart and exit. */
function destroyTab(id: string, options: DestroyTabOptions): void {
  const tab = tabs.get(id);
  if (!tab) return;

  // Stop first: close() alone can leave an in-flight navigation completing
  // callbacks while the rest of the tab is already being dismantled.
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.stop();
  detach(tab);
  // Undo every listener before destroying the contents: a handler firing during
  // teardown would patch state for a tab that no longer exists.
  for (const dispose of tab.disposers) dispose();
  tab.disposers.length = 0;
  finishPendingCollections(tab);
  tabs.delete(id);
  dropMediaSession(id);

  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

  if (activeTabId === id) {
    activeTabId = null;
    const next = [...tabs.keys()].at(-1) ?? null;
    if (next && options.activateReplacement) void activateTab(next);
  }
  if (options.publish) notify?.();
}

export function closeTab(id: string): void {
  destroyTab(id, { activateReplacement: true, publish: true });
}

export function setViewport(next: BrowserViewport): void {
  viewport = next;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) applyBounds(tab);
}

function applyVisibility(): void {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  tab?.view.setVisible(tab.state.kind === 'web' && sectionVisible && !overlayOpen && !tab.state.error);
}

/**
 * Whether the browser section is the one on screen.
 *
 * A WebContentsView is a native child view: it keeps painting over the window's
 * HTML until something says otherwise, so leaving the section without this left
 * the page floating above every other part of Nodus.
 */
export function setSectionVisible(visible: boolean): void {
  sectionVisible = visible;
  applyVisibility();
}

/**
 * Hide the page while a React overlay is open.
 *
 * Not just a paint problem: a native view on top also takes the MOUSE, so an
 * HTML menu drawn over the page looks fine and silently sends every click to the
 * website underneath. Anything that renders over the page must call this.
 *
 * The WebContents is untouched either way, so media keeps playing.
 */
export function setOverlayVisible(open: boolean): void {
  overlayOpen = open;
  applyVisibility();
}

/**
 * Freeze the active page before an HTML overlay hides its native view.
 *
 * WebContentsView always paints above React, so the real view still has to be
 * hidden while a modal or header panel is open. A transient PNG lets React keep
 * showing exactly what was underneath instead of exposing the window's bare
 * background (which looked like the whole browser had turned black).
 */
export async function captureOverlaySnapshot(): Promise<string | null> {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed() || !sectionVisible || !viewport) return null;
  try {
    const image = await tab.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

function withActive<T>(fn: (contents: WebContents) => T): T | undefined {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return undefined;
  return fn(tab.view.webContents);
}

export function goBack(): void {
  withActive((c) => { if (c.navigationHistory.canGoBack()) c.navigationHistory.goBack(); });
}
export function goForward(): void {
  withActive((c) => { if (c.navigationHistory.canGoForward()) c.navigationHistory.goForward(); });
}
export function reload(): void { withActive((c) => c.reload()); }
export function stopLoading(): void { withActive((c) => c.stop()); }

export function navigate(url: string): boolean {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return false;
  const internalKind = browserInternalPage(url);
  if (internalKind) {
    tab.view.webContents.stop();
    dropMediaSession(tab.id);
    patch(tab, {
      kind: internalKind,
      url,
      title: internalKind === 'bookmarks' ? 'Nodus Bookmarks' : 'Research Atlas',
      faviconDataUrl: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      hasMedia: false,
      mediaPlaying: false,
      error: null,
    });
    applyVisibility();
    void tab.view.webContents.loadURL('about:blank').catch(() => undefined);
    return true;
  }
  if (!decideNavigation(url, { isMainFrame: true }).allowed) return false;
  patch(tab, {
    kind: 'web',
    url,
    title: '',
    faviconDataUrl: null,
    loading: true,
    error: null,
  });
  applyVisibility();
  void tab.view.webContents.loadURL(url).catch(() => undefined);
  return true;
}

/**
 * Ask the active tab's preload for something and wait for its reply.
 *
 * Times out rather than hanging: a page that is busy, crashed or simply
 * uncooperative must not leave an Add-to-Library click waiting forever. A null
 * result is reported to the user as "nothing available", which is honest.
 */
const COLLECT_TIMEOUT_MS = 5_000;

export function collectFromTab(what: 'text' | 'selection' | 'capture' | 'pdf'): Promise<unknown> {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return Promise.resolve(null);

  const requestId = `collect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      tab.view.webContents.ipc.removeListener('nodus-browser:page:collected', listener);
      clearTimeout(timer);
      tab.pendingCollections.delete(finish);
      resolve(value);
    };
    const listener = (event: Electron.IpcMainEvent, id: string, payload: unknown) => {
      // Match BOTH the request id and the sender: another tab replying to an id
      // it happened to see must not answer this question.
      if (
        id !== requestId
        || event.sender !== tab.view.webContents
        || event.senderFrame !== tab.view.webContents.mainFrame
      ) return;
      finish(payload);
    };
    const timer = setTimeout(() => finish(null), COLLECT_TIMEOUT_MS);
    timer.unref?.();
    tab.view.webContents.ipc.on('nodus-browser:page:collected', listener);
    tab.pendingCollections.add(finish);
    tab.view.webContents.send('nodus-browser:page:collect', requestId, what);
  });
}

/** The active tab's identity, for attributing a capture. */
export function activeTabSummary(): { id: string; url: string; title: string; kind: BrowserTabState['kind']; faviconDataUrl: string | null } | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  return tab ? { id: tab.id, url: tab.state.url, title: tab.state.title, kind: tab.state.kind, faviconDataUrl: tab.state.faviconDataUrl } : null;
}

/** Mute or unmute one tab, whether or not it is the active one. */
export function setTabMuted(id: string, muted: boolean): void {
  const tab = tabs.get(id);
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.setAudioMuted(muted);
  noteMuted(id, muted);
  patch(tab, { muted });
}

/** Drive one tab's media from the header. */
export function sendMediaCommand(id: string, command: BrowserMediaCommand): void {
  const tab = tabs.get(id);
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return;
  if (command === 'previous' || command === 'next') {
    const keyCode = command === 'previous' ? 'MediaPreviousTrack' : 'MediaNextTrack';
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
  tab.view.webContents.send('nodus-browser:page:mediaCommand', command);
}

/**
 * Destroy every Browser-owned renderer through the same per-tab destructor.
 *
 * Restart preserves the last published viewport because the React chrome stays
 * mounted and the replacement view must have non-zero bounds immediately.
 * Application shutdown clears it because the host window is going away.
 */
export function closeAllBrowserTabs(options: { preserveViewport?: boolean } = {}): void {
  for (const id of [...tabs.keys()]) {
    destroyTab(id, { activateReplacement: false, publish: false });
  }
  activeTabId = null;
  if (!options.preserveViewport) {
    viewport = null;
    hostWindow = null;
    sectionVisible = false;
    overlayOpen = false;
  }
  // Also cancels the ended-grace timers, so none outlives the window.
  clearAllMediaSessions();
  notify?.();
}

/** Test seam: how many WebContents this module still owns. */
export function openTabCount(): number {
  return tabs.size;
}
