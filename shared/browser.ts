// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser contract shared by the main process and the renderer.
 *
 * Everything here crosses IPC, so it is plain data: no Electron types, no
 * WebContents, no handles. The renderer draws chrome and issues commands; it
 * never holds a reference to a page.
 */

import type { BrowserSearchEngineId } from './browserOmnibox';

/** How a tab's last navigation ended. `ok` covers "still loading". */
export type BrowserTabErrorKind =
  | 'none'
  | 'dns'
  | 'offline'
  | 'refused'
  | 'timeout'
  | 'certificate'
  | 'blocked-scheme'
  | 'crashed'
  | 'unknown';

export interface BrowserTabError {
  kind: BrowserTabErrorKind;
  /** Chromium's numeric code, kept for diagnosis rather than for display. */
  code: number | null;
  /** Chromium's own description. Shown verbatim under the localized heading. */
  description: string;
  url: string;
}

/**
 * One tab, as the renderer sees it.
 *
 * `title`/`favicon` are what Chromium reported for the live page. The favicon is
 * a data URI resolved in the main process on purpose: handing the renderer a
 * remote URL would make the TRUSTED window issue a request to whatever host the
 * page named.
 */
export interface BrowserTabState {
  id: string;
  url: string;
  /** What the user typed or what the page reports, whichever is newer. */
  title: string;
  faviconDataUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Chromium reports audio is coming out right now. */
  audible: boolean;
  muted: boolean;
  /** A media session exists in this tab — see BrowserMediaState. */
  hasMedia: boolean;
  mediaPlaying: boolean;
  error: BrowserTabError | null;
}

/** The whole browser, in one payload the renderer can render from. */
export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

/**
 * A media session in one tab.
 *
 * `canPrevious`/`canNext` are deliberately ABSENT rather than present-and-false.
 * Neither the Media Session API nor Electron exposes a way to discover whether a
 * page registered `previoustrack`/`nexttrack` handlers — `setActionHandler` has
 * no getter. A field would invite a UI to render controls that cannot work, so
 * adding them later has to be a deliberate, typed change.
 */
export interface BrowserMediaState {
  tabId: string;
  /** The media title where the page exposed one, else the page title. */
  title: string;
  url: string;
  origin: string;
  faviconDataUrl: string | null;
  hasMedia: boolean;
  playing: boolean;
  audible: boolean;
  muted: boolean;
  canPlayPause: boolean;
  kind: 'audio' | 'video' | 'unknown';
}

/** Where a new tab or the Home button should go. */
export type BrowserHomeMode = 'start' | 'blank' | 'custom';

export interface BrowserPrefs {
  homeMode: BrowserHomeMode;
  homeUrl: string;
  searchEngine: BrowserSearchEngineId;
  searchTemplate: string;
  restoreTabs: boolean;
  newTabMode: 'home' | 'blank';
}

export const DEFAULT_BROWSER_PREFS: BrowserPrefs = {
  homeMode: 'start',
  homeUrl: '',
  searchEngine: 'google',
  searchTemplate: '',
  // Off by default: restoring N tabs means N renderer processes at first open,
  // and a stale SSO tab restoring into a login wall is a poor first impression.
  restoreTabs: false,
  newTabMode: 'home',
};

/** The first-party start page used by Home and, by default, every new tab. */
export const NODUS_RESEARCH_ATLAS_URL = 'https://nodusresearch.com/research-atlas/';

/**
 * The most tabs Nodus Browser will hold open.
 *
 * Each tab is its own renderer process (roughly 40-90 MB). This is a research
 * browser, not a replacement for one, and an uncapped tab strip is how the
 * feature would turn into a memory complaint.
 */
export const MAX_BROWSER_TABS = 12;

/** The rectangle, in CSS pixels, the renderer has reserved for the page. */
export interface BrowserViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A permission a page is waiting on.
 *
 * Presented by Nodus, never by the page: the prompt is drawn in Nodus chrome and
 * the browser view is shrunk to make room, so a site can neither cover it nor
 * imitate it in its own content area.
 */
export interface PendingBrowserPermission {
  id: string;
  /** Electron's own permission name. `media` covers camera and microphone. */
  permission: string;
  origin: string;
  /** For `media`: which of 'video' (camera) / 'audio' (microphone) was asked for. */
  mediaTypes: string[];
}

/** A download in progress or finished, as the renderer sees it. */
export interface BrowserDownloadView {
  id: string;
  filename: string;
  url: string;
  kind: 'pdf' | 'document' | 'dataset' | 'media' | 'other';
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  /** Whether Nodus can offer to file this into the Library. */
  importable: boolean;
  savePath: string | null;
}

/**
 * What the browser keeps on disk.
 *
 * Only `profileBytes` and `cacheBytes` are byte figures, and that is a hard
 * limit rather than a simplification: Chromium exposes no per-category size API
 * through Electron. Everything else is reported as counts, and the UI says so.
 */
export interface BrowserStorageReport {
  profileBytes: number | null;
  cacheBytes: number;
  cookieCount: number;
  cookieSites: number;
  sites: { origin: string; cookies: number }[];
  measuredAt: number;
}

export type BrowserDataCategory =
  | 'cache' | 'cookies' | 'localStorage' | 'indexedDB'
  | 'serviceWorkers' | 'cacheStorage' | 'fileSystems';
