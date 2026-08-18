// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Which URLs a Nodus Browser tab is allowed to navigate to.
 *
 * This is the second half of the address-bar blocklist in ./browserOmnibox, and
 * it is the half that actually protects anything: the address bar only sees what
 * the user typed, while this runs on every `will-navigate` and
 * `will-frame-navigate`, i.e. on redirects, meta-refreshes, script navigations
 * and anything a page does on its own.
 *
 * Pure and Electron-free so the whole matrix can be asserted without booting an
 * app (scripts/test-browser-nav-policy.mjs).
 */

import { BLOCKED_SCHEMES } from './browserOmnibox';

export interface NavigationDecision {
  allowed: boolean;
  /** Present when refused, so the caller can tell the user which scheme it was. */
  scheme?: string;
  reason?: 'blocked-scheme' | 'unsupported-scheme' | 'malformed';
}

/** Schemes a real web page legitimately reaches for. */
const TOP_LEVEL_ALLOWED = new Set(['http', 'https', 'about']);

/**
 * Subframes additionally get `blob:` and `data:`.
 *
 * Both are refused at the TOP level (a pasted `data:` URL runs in whatever page
 * is loaded, and `blob:` at top level is a redirect trick), but inside a frame
 * they are ordinary: PDF viewers, embedded players and image galleries all use
 * them, and refusing them there breaks working sites for no security gain —
 * the frame is already inside a page we allowed.
 */
const SUBFRAME_EXTRA_ALLOWED = new Set(['blob', 'data']);

function schemeOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Decide whether a tab may navigate to `url`.
 *
 * Fails CLOSED: an unrecognised scheme is refused rather than allowed, because
 * new schemes appear with new Chromium versions and a browser that follows
 * whatever it does not recognise is not a policy, it is a hole.
 */
export function decideNavigation(url: string, options: { isMainFrame?: boolean } = {}): NavigationDecision {
  const isMainFrame = options.isMainFrame !== false;
  const scheme = schemeOf(url);
  if (!scheme) return { allowed: false, reason: 'malformed' };

  // The subframe exception is checked BEFORE the blocklist, because `blob:` and
  // `data:` appear in both and the frame case is the narrower rule. Chromium
  // draws the same line itself: it blocks top-level data: navigation and permits
  // it inside a frame. Ordering these the other way round silently disabled the
  // exception, which is how this was written the first time.
  if (!isMainFrame && SUBFRAME_EXTRA_ALLOWED.has(scheme)) return { allowed: true };

  if (BLOCKED_SCHEMES.has(scheme)) return { allowed: false, scheme, reason: 'blocked-scheme' };

  if (TOP_LEVEL_ALLOWED.has(scheme)) {
    // `about:` is only ever the blank page; `about:gpu` and friends are Chromium
    // internals and have no business inside a research browser.
    if (scheme === 'about') {
      return url.trim().toLowerCase() === 'about:blank'
        ? { allowed: true }
        : { allowed: false, scheme, reason: 'blocked-scheme' };
    }
    return { allowed: true };
  }

  return { allowed: false, scheme, reason: 'unsupported-scheme' };
}

/** Convenience wrapper for the common main-frame case. */
export function isNavigationAllowed(url: string, isMainFrame = true): boolean {
  return decideNavigation(url, { isMainFrame }).allowed;
}
