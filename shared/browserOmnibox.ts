// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * What the Nodus Browser address bar does with what the user typed.
 *
 * Kept pure and free of Electron so the decision table can be asserted directly
 * (scripts/test-browser-omnibox.mjs). It is the single place that decides
 * "navigate here" vs "search for this" vs "refuse", and the refusal half is the
 * part that matters: the address bar is the one place where a user can hand the
 * browser a scheme, so the blocklist lives here rather than only in the
 * main-process navigation guard, and both are tested.
 */

export type BrowserSearchEngineId = 'google' | 'scholar' | 'bing' | 'duckduckgo' | 'custom';

/** `%s` is replaced by the URL-encoded query. */
export const BROWSER_SEARCH_TEMPLATES: Record<Exclude<BrowserSearchEngineId, 'custom'>, string> = {
  google: 'https://www.google.com/search?q=%s',
  scholar: 'https://scholar.google.com/scholar?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
};

/**
 * Schemes the browser refuses outright.
 *
 * `file:` and the three custom Nodus schemes are the load-bearing entries: the
 * protocol handlers in electron/{image,archive,library}Protocol.ts are registered
 * on the DEFAULT session and hand out vault bytes, so a browser tab must never be
 * able to name them. `javascript:` and `data:` are refused at the top level
 * because a pasted one runs in whatever page is currently loaded.
 */
export const BLOCKED_SCHEMES: ReadonlySet<string> = new Set([
  'file', 'javascript', 'data', 'blob', 'chrome', 'devtools', 'view-source',
  'nodus-image', 'nodus-archive', 'nodus-library',
]);

/** Schemes handed to the operating system instead of being navigated to. */
const EXTERNAL_SCHEMES = new Set(['mailto', 'tel']);

export type OmniboxResolution =
  | { kind: 'empty' }
  | { kind: 'navigate'; url: string }
  | { kind: 'search'; url: string; query: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; scheme: string };

/** A scheme prefix, lowercased, or null when the input carries none. */
function schemeOf(input: string): string | null {
  // The negative lookahead is what keeps "localhost:5173" and "example.org:8080"
  // from reading as the schemes "localhost" and "example.org": a colon followed
  // by nothing but digits is a port, not a scheme separator.
  const match = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i.exec(input);
  return match ? match[1].toLowerCase() : null;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/**
 * Whether the input reads as a host rather than as something to search for.
 *
 * Deliberately conservative: anything with whitespace is a query, and a bare
 * number with a dot ("3.14") is a query too, because treating it as a host sends
 * the user somewhere they never asked to go.
 */
export function looksLikeHost(input: string): boolean {
  const candidate = input.trim();
  if (!candidate || /\s/.test(candidate)) return false;

  const [authority] = candidate.split(/[/?#]/, 1);
  const withoutPort = authority.replace(/:\d{1,5}$/, '');
  if (!withoutPort) return false;
  if (isLoopbackHost(withoutPort.toLowerCase())) return true;

  // A dotted label sequence ending in a letters-only TLD of at least two chars.
  // The letters-only requirement is what keeps "3.14" and "1.5" out.
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(withoutPort);
}

/** Build a search URL from an engine choice, falling back to Google on a broken custom template. */
export function searchUrlFor(
  query: string,
  engine: BrowserSearchEngineId,
  customTemplate?: string | null,
): string {
  const encoded = encodeURIComponent(query);
  const template = engine === 'custom'
    ? (customTemplate && customTemplate.includes('%s') ? customTemplate : BROWSER_SEARCH_TEMPLATES.google)
    : BROWSER_SEARCH_TEMPLATES[engine];
  return template.replace('%s', encoded);
}

export interface OmniboxOptions {
  engine?: BrowserSearchEngineId;
  customTemplate?: string | null;
}

/** Resolve what the address bar should do with `raw`. */
export function parseOmniboxInput(raw: string, options: OmniboxOptions = {}): OmniboxResolution {
  const input = String(raw ?? '').trim();
  if (!input) return { kind: 'empty' };

  const engine = options.engine ?? 'google';
  const scheme = schemeOf(input);

  if (scheme) {
    if (BLOCKED_SCHEMES.has(scheme)) return { kind: 'blocked', scheme };
    if (EXTERNAL_SCHEMES.has(scheme)) return { kind: 'external', url: input };
    if (scheme === 'about') {
      // Only the blank page. `about:config`-style targets are Chromium internals.
      return input.toLowerCase() === 'about:blank'
        ? { kind: 'navigate', url: 'about:blank' }
        : { kind: 'blocked', scheme };
    }
    if (scheme === 'http' || scheme === 'https') {
      try {
        return { kind: 'navigate', url: new URL(input).toString() };
      } catch {
        return { kind: 'search', url: searchUrlFor(input, engine, options.customTemplate), query: input };
      }
    }
    // Anything else (ftp:, ws:, an unknown app scheme) is not something a
    // research browser should follow silently.
    return { kind: 'blocked', scheme };
  }

  if (looksLikeHost(input)) {
    // Loopback over http: a dev server answering https on localhost is the rare
    // case, and defaulting to https there fails the connection outright.
    const [authority] = input.split(/[/?#]/, 1);
    const host = authority.replace(/:\d{1,5}$/, '').toLowerCase();
    const protocol = isLoopbackHost(host) ? 'http' : 'https';
    try {
      return { kind: 'navigate', url: new URL(`${protocol}://${input}`).toString() };
    } catch {
      return { kind: 'search', url: searchUrlFor(input, engine, options.customTemplate), query: input };
    }
  }

  return { kind: 'search', url: searchUrlFor(input, engine, options.customTemplate), query: input };
}
