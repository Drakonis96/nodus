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

import { ipcMain, WebContentsView, type BaseWindow, type WebContents } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserState, BrowserTabError, BrowserTabState, BrowserViewport } from '@shared/browser';
import { MAX_BROWSER_TABS } from '@shared/browser';
import { decideNavigation } from '@shared/browserNavigation';
import { NODUS_BROWSER_PARTITION, browserSession } from './session';
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
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let hostWindow: BaseWindow | null = null;
let viewport: BrowserViewport | null = null;
let overlayVisible = true;
let notify: (() => void) | null = null;

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
  return {
    id,
    url,
    title: '',
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
export function initBrowserTabs(window: BaseWindow, onChange: () => void): void {
  hostWindow = window;
  notify = onChange;

  /**
   * The page preload's only outbound channel: whether the element that started
   * is audio or video, which Electron's own media events do not say.
   *
   * The sender is matched against the live tab registry. A message from anything
   * that is not one of our tabs is dropped rather than trusted — this is the one
   * channel in the browser that a page's preload can reach, so it is the one
   * place where a sender check earns its keep.
   */
  ipcMain.on('nodus-browser:page:media', (event, payload: { playing?: unknown; kind?: unknown }) => {
    const tab = [...tabs.values()].find((candidate) =>
      !candidate.view.webContents.isDestroyed() && candidate.view.webContents.id === event.sender.id);
    if (!tab) return;
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
  });
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
  if (!hostWindow) return;
  hostWindow.contentView.addChildView(tab.view);
  applyBounds(tab);
  tab.view.setVisible(overlayVisible);
}

function detach(tab: Tab): void {
  if (!hostWindow) return;
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

  // Never let a page dictate the options of a window it opens. `allow` would
  // hand the site control of webPreferences; instead every popup becomes an
  // ordinary Nodus tab, created by us with our own configuration.
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, { isMainFrame: true }).allowed) void createTab(url);
    return { action: 'deny' };
  });

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

  on(tab, contents, 'did-start-loading', (() => patch(tab, { loading: true, error: null })) as never);
  on(tab, contents, 'did-stop-loading', (() => patch(tab, {
    loading: false,
    url: contents.getURL(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  })) as never);

  on(tab, contents, 'page-title-updated', ((_e: unknown, title: string) => {
    patch(tab, { title });
    describeMediaSession(tab.id, { title });
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
    noteMediaPlaying(tab.id, () => ({
      title: tab.state.title || tab.state.url,
      url: tab.state.url,
      origin: originOf(tab.state.url),
      faviconDataUrl: tab.state.faviconDataUrl,
    }));
    patch(tab, { hasMedia: true, mediaPlaying: true });
  }) as never);

  on(tab, contents, 'media-paused', (() => {
    noteMediaPaused(tab.id);
    patch(tab, { mediaPlaying: false });
  }) as never);

  // Audibility is about sound, not about existence: it goes false on pause, and
  // a header that keyed on it would lose its own Play button.
  on(tab, contents, 'audio-state-changed', ((event: { audible: boolean }) => {
    noteAudioState(tab.id, event.audible);
    patch(tab, { audible: event.audible });
  }) as never);

  // A main-frame navigation replaces the document, so whatever was playing is
  // gone. Subframe navigations must not count: an ad frame reloading underneath
  // a video would otherwise drop the controls for the video.
  on(tab, contents, 'did-start-navigation', ((details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (!hasMediaSession(tab.id)) return;
    dropMediaSession(tab.id);
    patch(tab, { hasMedia: false, mediaPlaying: false, audible: false });
  }) as never);

  on(tab, contents, 'did-fail-load', ((
    _e: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean,
  ) => {
    // Subframe failures are ordinary noise (blocked trackers, dead embeds) and
    // must never replace a page that loaded fine.
    if (!isMainFrame) return;
    // -3 is ABORTED, which is what a user pressing Stop or navigating away looks
    // like. Showing an error pane for it would be wrong.
    if (errorCode === -3) return;
    patch(tab, {
      loading: false,
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
    patch(tab, { loading: false, error: { kind: 'certificate', code: null, description: error, url } });
  }) as never);

  on(tab, contents, 'render-process-gone', ((_e: unknown, details: { reason: string }) => {
    patch(tab, {
      loading: false,
      error: { kind: 'crashed', code: null, description: details.reason, url: tab.state.url },
    });
  }) as never);
}

export async function createTab(url: string): Promise<string | null> {
  if (tabs.size >= MAX_BROWSER_TABS) return null;

  const view = new WebContentsView({
    webPreferences: {
      partition: NODUS_BROWSER_PARTITION,
      preload: path.join(__dirname, 'preload.browserPage.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      // The single relaxation, and it buys Chromium's own PDF viewer. The
      // alternative — decoding untrusted PDF bytes with pdfjs inside the TRUSTED
      // renderer — is strictly worse.
      plugins: true,
      safeDialogs: true,
      spellcheck: true,
      backgroundThrottling: true,
    },
  });

  browserSession();

  const id = randomUUID();
  const tab: Tab = { id, view, state: emptyState(id, url), disposers: [] };
  tabs.set(id, tab);
  wire(tab);
  await activateTab(id);

  if (url && url !== 'about:blank') {
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

export function closeTab(id: string): void {
  const tab = tabs.get(id);
  if (!tab) return;

  detach(tab);
  // Undo every listener before destroying the contents: a handler firing during
  // teardown would patch state for a tab that no longer exists.
  for (const dispose of tab.disposers) dispose();
  tab.disposers.length = 0;
  tabs.delete(id);
  dropMediaSession(id);

  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

  if (activeTabId === id) {
    activeTabId = null;
    const next = [...tabs.keys()].at(-1) ?? null;
    if (next) void activateTab(next);
  }
  notify?.();
}

export function setViewport(next: BrowserViewport): void {
  viewport = next;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) applyBounds(tab);
}

/**
 * Hide the page while a React overlay is open.
 *
 * The WebContents is untouched, so media keeps playing and no state is lost —
 * this only stops the native view from painting over a modal.
 */
export function setOverlayVisible(visible: boolean): void {
  overlayVisible = visible;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  tab?.view.setVisible(visible);
}

function withActive<T>(fn: (contents: WebContents) => T): T | undefined {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return undefined;
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
  if (!decideNavigation(url, { isMainFrame: true }).allowed) return false;
  withActive((c) => void c.loadURL(url).catch(() => undefined));
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
  if (!tab || tab.view.webContents.isDestroyed()) return Promise.resolve(null);

  const requestId = `collect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('nodus-browser:page:collected', listener);
      clearTimeout(timer);
      resolve(value);
    };
    const listener = (event: Electron.IpcMainEvent, id: string, payload: unknown) => {
      // Match BOTH the request id and the sender: another tab replying to an id
      // it happened to see must not answer this question.
      if (id !== requestId || event.sender.id !== tab.view.webContents.id) return;
      finish(payload);
    };
    const timer = setTimeout(() => finish(null), COLLECT_TIMEOUT_MS);
    timer.unref?.();
    ipcMain.on('nodus-browser:page:collected', listener);
    tab.view.webContents.send('nodus-browser:page:collect', requestId, what);
  });
}

/** The active tab's identity, for attributing a capture. */
export function activeTabSummary(): { id: string; url: string; title: string } | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  return tab ? { id: tab.id, url: tab.state.url, title: tab.state.title } : null;
}

/** Mute or unmute one tab, whether or not it is the active one. */
export function setTabMuted(id: string, muted: boolean): void {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.setAudioMuted(muted);
  noteMuted(id, muted);
  patch(tab, { muted });
}

/** Drive one tab's media from the header. */
export function sendMediaCommand(id: string, command: 'play' | 'pause' | 'stop'): void {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.send('nodus-browser:page:mediaCommand', command);
}

/** Destroy every tab. Called from all three of main.ts's shutdown paths. */
export function closeAllBrowserTabs(): void {
  for (const id of [...tabs.keys()]) closeTab(id);
  activeTabId = null;
  viewport = null;
  // Also cancels the ended-grace timers, so none outlives the window.
  clearAllMediaSessions();
}

/** Test seam: how many WebContents this module still owns. */
export function openTabCount(): number {
  return tabs.size;
}
