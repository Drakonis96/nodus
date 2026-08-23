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
import {
  browserInternalPage,
  isGoogleSignInUrl,
  isNodusResearchSiteUrl,
  MAX_BROWSER_TABS,
  NODUS_BOOKMARKS_URL,
  shouldRestoreInternalReturnOnDismiss,
} from '@shared/browser';
import { decideNavigation } from '@shared/browserNavigation';
import { NODUS_BROWSER_PARTITION, browserSession } from './session';
import { installContextMenu, type ContextMenuActions } from './contextMenu';
import { browserShortcutFor, historyNeighbourIndex } from '@shared/browserShortcuts';
import { cachePageFavicon } from './favicon';
import { recordBrowserHistoryVisit } from './history';
import {
  describeMediaSession,
  dropMediaSession,
  hasMediaSession,
  noteAudioState,
  noteMediaPaused,
  noteMediaPlaybackState,
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
  /**
   * The Nodus start page this tab was showing before it went to the web.
   *
   * Internal pages (Bookmarks, Research Atlas) are drawn by React and never load
   * anything into the WebContents, so they leave NO entry in Chromium's history.
   * A tab that opens on one and then visits a site therefore has exactly one
   * history entry, canGoBack() is false, and Back is a button that silently does
   * nothing — measured, not assumed: goBack() with no history emits no events at
   * all. Nodus has to remember the step Chromium never recorded.
   */
  internalReturn: { kind: 'bookmarks' | 'atlas'; url: string } | null;
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
let shortcutActions: BrowserShortcutActions | null = null;
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

/**
 * Stop before Google's wall, and say so in Nodus's own words.
 *
 * Google rejects sign-in from every embedded browser, so letting the navigation
 * proceed only replaces a page the user wanted with a dead end that blames their
 * browser. Catching it here means the tab can offer the one route that works —
 * the system browser — instead of a Retry button that will never succeed.
 *
 * `siteUrl` is the page the sign-in started from, and callers must pass it only
 * when there IS one. A federated login has to begin and end in the same browser:
 * handing the system browser the half-finished accounts.google.com URL strands
 * it without the state the site left in its own sessionStorage back here, which
 * is what produces Firebase's `auth/missing-initial-state`. So the hand-off
 * offers the SITE, and the whole flow runs once, in one place. When the user
 * asked for Google directly there is no such page, and null is correct.
 *
 * Returns whether the navigation was intercepted, so each caller can skip it.
 */
function interceptGoogleSignIn(tab: Tab, url: string, siteUrl: string | null = null): boolean {
  if (!isGoogleSignInUrl(url)) return false;
  patch(tab, {
    loading: false,
    error: { kind: 'google-sign-in', code: null, description: '', url, siteUrl: handoffTarget(siteUrl) },
  });
  return true;
}

/**
 * The originating page, if it is somewhere the system browser can usefully be
 * sent. Anything that is not an ordinary web page — about:blank on a tab that
 * has not navigated yet, an internal Nodus start page, or Google's own sign-in
 * host — leaves the hand-off with nothing to offer but the Google URL itself.
 */
function handoffTarget(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (isGoogleSignInUrl(siteUrl)) return null;
    return siteUrl;
  } catch {
    return null;
  }
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

/** What a keyboard shortcut caught inside a page asks the app to do. */
export interface BrowserShortcutActions {
  /** Open a new tab, honouring the user's new-tab preference. */
  newTab(): void;
}

/** Wire the host window and the change notifier. Called once, from the IPC layer. */
export function initBrowserTabs(
  window: BaseWindow,
  onChange: () => void,
  menu?: ContextMenuActions,
  shortcuts?: BrowserShortcutActions,
): void {
  hostWindow = window;
  notify = onChange;
  if (menu) contextMenuActions = menu;
  if (shortcuts) shortcutActions = shortcuts;
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

  /**
   * Nodus's own shortcuts, claimed before the page sees them.
   *
   * Only what `browserShortcutFor` recognises is taken; every other keystroke
   * passes straight through to the website, which is why this cannot break a
   * site's own bindings.
   */
  on(tab, contents, 'before-input-event', ((event: { preventDefault(): void }, input: unknown) => {
    if (!isWeb()) return;
    const shortcut = browserShortcutFor(input as Parameters<typeof browserShortcutFor>[0]);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === 'newTab') shortcutActions?.newTab();
  }) as never);
  void applyPageColorScheme(contents);

  /**
   * The page preload's media message. Register it on this exact WebContents
   * instead of ipcMain's global bus, then still require its main frame. A
   * different tab or any Nodus window has no listener to reach.
   */
  const pageMediaListener = (
    event: Electron.IpcMainEvent,
    payload: { playing?: unknown; kind?: unknown },
  ) => {
    if (!isWeb()) return;
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    const kind = payload?.kind === 'audio' || payload?.kind === 'video' ? payload.kind : 'unknown';
    // The page reports whether ANYTHING is playing, not one element's edge, so
    // this replaces the session's flag outright rather than counting with it.
    const playing = payload?.playing === true;
    noteMediaPlaybackState(tab.id, playing, () => ({
      title: tab.state.title || tab.state.url,
      url: tab.state.url,
      origin: originOf(tab.state.url),
      faviconDataUrl: tab.state.faviconDataUrl,
    }), kind);
    patch(tab, playing ? { hasMedia: true, mediaPlaying: true } : { mediaPlaying: false });
  };
  contents.ipc.on('nodus-browser:page:media', pageMediaListener);
  tab.disposers.push(() => contents.ipc.removeListener('nodus-browser:page:media', pageMediaListener));

  /**
   * Whether the page could act on the last header command.
   *
   * A `false` means no reachable media element answered — the player keeps its
   * audio somewhere no DOM query goes (a cross-origin frame, a closed shadow
   * root, an element the page never attached). Chromium's own media key is the
   * last resort for those, because it reaches the page's Media Session handlers,
   * which no amount of DOM walking can.
   */
  const pageMediaResultListener = (
    event: Electron.IpcMainEvent,
    payload: { command?: unknown; handled?: unknown },
  ) => {
    if (!isWeb()) return;
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    if (payload?.handled !== false) return;
    const command = payload?.command;
    if (command !== 'play' && command !== 'pause' && command !== 'stop') return;
    sendMediaKey(contents, 'MediaPlayPause');
  };
  contents.ipc.on('nodus-browser:page:mediaCommandResult', pageMediaResultListener);
  tab.disposers.push(() => contents.ipc.removeListener('nodus-browser:page:mediaCommandResult', pageMediaResultListener));

  /**
   * The Nodus website has one inert Bookmarks slot. Its isolated preload sends
   * this only for a trusted click; main then repeats every boundary check before
   * changing the active tab into the local React page. No bookmark data crosses
   * into the remote renderer.
   */
  const openBookmarksListener = (event: Electron.IpcMainEvent) => {
    if (!isWeb() || tab.id !== activeTabId) return;
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    if (!isNodusResearchSiteUrl(contents.getURL())) return;
    navigate(NODUS_BOOKMARKS_URL);
  };
  contents.ipc.on('nodus-browser:page:openBookmarks', openBookmarksListener);
  tab.disposers.push(() => contents.ipc.removeListener('nodus-browser:page:openBookmarks', openBookmarksListener));

  // Never let a page dictate the options of a window it opens. `allow` would
  // hand the site control of webPreferences; instead every popup becomes an
  // ordinary Nodus tab, created by us with our own configuration.
  // A third-party OAuth flow must complete in the browser context it started
  // in, or its callback session lands somewhere the user is not. That argued
  // for keeping Google auth inside Nodus and dressing Electron up as Chrome —
  // which was tried, measured against the real page, and does not work: Google
  // blocks the EMBEDDER, not the User-Agent. So the flow is recognised and
  // stopped instead, and the user is told plainly. See isGoogleSignInUrl.
  contents.setWindowOpenHandler(({ url }) => {
    // A "Continue with Google" button usually opens a window rather than
    // redirecting. Opening a fresh tab on it would spend a tab to show Google's
    // refusal, so the notice replaces it in the tab the user is already looking at.
    if (interceptGoogleSignIn(tab, url, contents.getURL())) return { action: 'deny' };
    if (decideNavigation(url, { isMainFrame: true }).allowed) void createTab(url);
    return { action: 'deny' };
  });

  on(tab, contents, 'select-bluetooth-device', ((event: Electron.Event, _devices: unknown[], callback: (id: string) => void) => {
    event.preventDefault();
    callback('');
  }) as never);

  on(tab, contents, 'will-navigate', ((event: Electron.Event, url: string) => {
    if (interceptGoogleSignIn(tab, url, contents.getURL())) {
      event.preventDefault();
      return;
    }
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
    if (details.isMainFrame && interceptGoogleSignIn(tab, details.url, contents.getURL())) {
      details.preventDefault();
      return;
    }
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
  on(tab, contents, 'dom-ready', (() => {
    if (!isWeb()) return;
    void applyPageColorScheme(contents);
    // Google's JS check also reads navigator.userAgentData.brands; hide Electron
    // there too (request headers are already spoofed in session.ts). Brand
    // versions are rewritten to the Chromium major in navigator.userAgent so the
    // JS view matches the header view — a mismatch is itself detectable.
    // Object.create(uaData) keeps getHighEntropyValues working; its brand lists
    // are filtered on the way out as well.
    void contents.executeJavaScript(`
      try {
        const uaData = navigator.userAgentData;
        if (uaData && Array.isArray(uaData.brands)) {
          const m = /Chrome\\/(\\d+)/.exec(navigator.userAgent);
          const major = m ? m[1] : null;
          const fix = (b) => {
            const brand = String(b.brand || '');
            if (/Electron/i.test(brand)) return null;
            if (major && /Chromium|Google Chrome/i.test(brand)) return { brand, version: major };
            return b;
          };
          const brands = uaData.brands.map(fix).filter(Boolean);
          const changed = brands.length !== uaData.brands.length
            || brands.some((b, i) => b !== uaData.brands[i]);
          if (changed) {
            const spoofed = Object.create(uaData);
            spoofed.brands = brands;
            if (typeof uaData.getHighEntropyValues === 'function') {
              spoofed.getHighEntropyValues = (hints) => uaData.getHighEntropyValues(hints).then((info) => {
                const copy = { ...info };
                for (const key of ['brands', 'fullVersionList']) {
                  if (Array.isArray(copy[key])) copy[key] = copy[key].filter(b => !/Electron/i.test(String(b.brand || '')));
                }
                return copy;
              });
            }
            Object.defineProperty(navigator, 'userAgentData', { value: spoofed, configurable: true });
          }
        }
      } catch {}
    `).catch(() => undefined);
  }) as never);

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
      canGoBack: canGoBackFrom(tab),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }) as never);

  on(tab, contents, 'did-navigate-in-page', ((
    _event: unknown, url: string, isMainFrame: boolean,
  ) => {
    if (!isWeb() || !isMainFrame) return;
    patch(tab, {
      url,
      canGoBack: canGoBackFrom(tab),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
    recordBrowserHistoryVisit({ title: contents.getTitle() || tab.state.title, url });
  }) as never);

  // Record only committed, successfully loaded main documents. The website has
  // no history API: Electron main observes Chromium and writes bounded plain
  // data to Nodus's private history repository.
  on(tab, contents, 'did-finish-load', (() => {
    if (!isWeb()) return;
    recordBrowserHistoryVisit({
      title: contents.getTitle() || tab.state.title,
      url: contents.getURL() || tab.state.url,
    });
  }) as never);

  on(tab, contents, 'did-stop-loading', (() => {
    if (!isWeb()) return;
    patch(tab, {
      loading: false,
      canGoBack: canGoBackFrom(tab),
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

  on(tab, contents, 'found-in-page', ((_: unknown, result: Electron.FoundInPageResult) => {
    if (tab.id !== activeTabId) return;
    foundInPageListener?.(result);
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
    internalReturn: null,
  };
  tabs.set(id, tab);
  wire(tab);
  await activateTab(id);

  if (!internalKind && interceptGoogleSignIn(tab, url)) {
    notify?.();
    return id;
  }

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

/**
 * Whether Back has anywhere to go: Chromium's own history, or the start page
 * Chromium never recorded. Used everywhere the tab's canGoBack is published, so
 * the toolbar button is enabled exactly when pressing it will do something.
 */
function canGoBackFrom(tab: Tab): boolean {
  if (tab.view.webContents.navigationHistory.canGoBack()) return true;
  return tab.internalReturn !== null;
}

/** Restore the React start page represented by the history step Chromium lacks. */
function restoreInternalReturn(
  tab: Tab,
  back: NonNullable<Tab['internalReturn']>,
): void {
  const contents = tab.view.webContents;
  tab.internalReturn = null;
  contents.stop();
  dropMediaSession(tab.id);
  patch(tab, {
    kind: back.kind,
    url: back.url,
    title: back.kind === 'bookmarks' ? 'Nodus Bookmarks' : 'Research Atlas',
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
  void contents.loadURL('about:blank').catch(() => undefined);
}

/**
 * Put the tab back on the page it never actually left.
 *
 * The Google sign-in notice is raised WITHOUT a navigation: the popup is denied,
 * or will-navigate is preventDefault()ed, so the site's own page is still loaded
 * and merely hidden, because a tab with an error hides its native view. Going
 * back from here was therefore the wrong move twice over — it lands on whatever
 * preceded the login page, and on a tab with no history it silently does nothing
 * at all, which is exactly how it looked: a dead button.
 *
 * Clearing the error normally reveals the live page again, and the visible
 * state is resynced from the WebContents rather than trusted: the omnibox path
 * patches the tab's url to the Google address before raising the notice, and
 * leaving that in place would show one address over a different page. The one
 * exception is a React start page, whose WebContents is only about:blank; that
 * remembered page must be restored rather than replaced with an empty surface.
 */
export function dismissError(): void {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const contents = tab.view.webContents;
  const live = contents.getURL();
  const internalReturn = shouldRestoreInternalReturnOnDismiss(live, tab.internalReturn !== null)
    ? tab.internalReturn
    : null;
  if (internalReturn) {
    restoreInternalReturn(tab, internalReturn);
    return;
  }
  patch(tab, {
    error: null,
    loading: false,
    // about:blank is meaningful here: a direct Google request in a fresh tab
    // has no live site to reveal, so retaining Google's blocked address would
    // put one URL over a different page.
    url: live || tab.state.url,
    title: contents.getTitle() || tab.state.title,
    canGoBack: canGoBackFrom(tab),
    canGoForward: contents.navigationHistory.canGoForward(),
  });
  applyVisibility();
}

/**
 * Back, including the step Chromium does not know about.
 *
 * Three cases, in order. Chromium's history when there is one. Otherwise the
 * start page this tab left, which never became a history entry because internal
 * pages are drawn by React. Otherwise, if an error pane is up, clear it — the
 * Google sign-in notice is raised WITHOUT a navigation, so the page it covers is
 * still loaded and revealing it is the only sensible meaning of "back".
 *
 * What must not happen is the fourth case that used to be the only one: falling
 * through and doing nothing at all, which is how this reached the user.
 */
/**
 * Where Back or Forward would take the ACTIVE tab, without going there.
 *
 * What Cmd/Ctrl-clicking those buttons needs: the destination as a URL, so it
 * can be opened in a new tab while this one stays where it is. Null when there
 * is nowhere to go, or when the step would leave a Nodus-internal start page —
 * those are React pages with no URL another tab could load.
 */
export function historyNeighbourUrl(direction: 'back' | 'forward'): string | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return null;
  const history = tab.view.webContents.navigationHistory;
  const index = historyNeighbourIndex(history.getActiveIndex(), history.length(), direction);
  if (index === null) return null;
  const url = history.getEntryAtIndex(index)?.url ?? '';
  return decideNavigation(url, { isMainFrame: true }).allowed ? url : null;
}

export function goBack(): void {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const contents = tab.view.webContents;

  if (contents.navigationHistory.canGoBack()) {
    contents.navigationHistory.goBack();
    return;
  }

  const back = tab.internalReturn;
  if (back) {
    restoreInternalReturn(tab, back);
    return;
  }

  if (tab.state.error) dismissError();
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
    tab.internalReturn = null;
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
  // Leaving a start page: remember it, because Chromium is about to record this
  // navigation as the tab's FIRST history entry and Back would have nowhere to go.
  if (tab.state.kind !== 'web') {
    tab.internalReturn = { kind: tab.state.kind, url: tab.state.url };
  }
  patch(tab, {
    kind: 'web',
    url,
    title: '',
    faviconDataUrl: null,
    loading: true,
    error: null,
  });
  // After the patch above, so the notice replaces a tab that already shows the
  // target address rather than one still displaying the previous page.
  if (interceptGoogleSignIn(tab, url)) {
    applyVisibility();
    return true;
  }
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

let foundInPageListener: ((result: Electron.FoundInPageResult) => void) | null = null;
export function setFoundInPageListener(cb: ((result: Electron.FoundInPageResult) => void) | null): void {
  foundInPageListener = cb;
}
export function findInPage(text: string, options: { forward?: boolean; findNext?: boolean; matchCase?: boolean } = {}): void {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.findInPage(text, { forward: options.forward ?? true, findNext: options.findNext ?? false, matchCase: options.matchCase ?? false });
}
export function stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection' = 'clearSelection'): void {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.stopFindInPage(action);
}

/** Press one of Chromium's standard media keys in a page. */
function sendMediaKey(contents: WebContents, keyCode: string): void {
  if (contents.isDestroyed()) return;
  try {
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    contents.sendInputEvent({ type: 'keyUp', keyCode });
  } catch {
    // A view being torn down mid-command is not worth a crash.
  }
}

/** Drive one tab's media from the header. */
export function sendMediaCommand(id: string, command: BrowserMediaCommand): void {
  const tab = tabs.get(id);
  if (!tab || tab.state.kind !== 'web' || tab.view.webContents.isDestroyed()) return;
  if (command === 'previous' || command === 'next') {
    sendMediaKey(tab.view.webContents, command === 'previous' ? 'MediaPreviousTrack' : 'MediaNextTrack');
  }
  // Play/pause deliberately does NOT send its media key up front: on a page the
  // preload can reach, the key would toggle a second time and undo the command.
  // The page answers whether it handled it, and only a "no" falls back to the key.
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
