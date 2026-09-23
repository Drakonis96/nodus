// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { browserSession } from './session';
import { sanitizeFaviconDataUrl, sanitizeBookmarkUrl } from '@shared/browserBookmarks';

const MAX_FAVICON_BYTES = 64 * 1024;
const MAX_FAVICON_DOCUMENT_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 256;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']);
const cache = new Map<string, Promise<string | null>>();

interface Reader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

async function boundedBody(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_FAVICON_BYTES) return null;
  const reader = (response.body as unknown as { getReader?: () => Reader } | null)?.getReader?.();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    let reading = true;
    while (reading) {
      const part = await reader.read();
      if (part.done) { reading = false; continue; }
      const chunk = Buffer.from(part.value ?? []);
      bytes += chunk.length;
      if (bytes > MAX_FAVICON_BYTES) { await reader.cancel(); return null; }
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks, bytes);
}

async function boundedPrefix(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = (response.body as unknown as { getReader?: () => Reader } | null)?.getReader?.();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value ?? []);
      const remaining = maxBytes - bytes;
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining || bytes === maxBytes) await reader.cancel();
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks, bytes);
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi, (entity, decimal, hexadecimal) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function linkAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtmlAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

/**
 * The document a followed fetch landed on, for resolving relative `href`s.
 *
 * Electron's `session.fetch()` reports an EMPTY `Response.url`, so the address
 * the bytes actually came from is not observable from the main process. The
 * requested address is the only base available, and it is the right one in
 * every case that matters: icon `href`s are absolute paths or absolute URLs far
 * more often than not, and a redirect that changes the *directory* is the one
 * shape that could resolve differently. Treating the missing URL as a failure
 * instead — as this did — made the base null and threw away every declared
 * icon on every site.
 *
 * Both arguments are already known to be ordinary http(s).
 */
function finalDocumentUrl(requested: string, reported: string): string | null {
  return sanitizeBookmarkUrl(reported) ?? sanitizeBookmarkUrl(requested);
}

async function discoverFaviconUrls(pageUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await browserSession().fetch(pageUrl, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const finalUrl = finalDocumentUrl(pageUrl, response.url);
    const type = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (!response.ok || !finalUrl || (type !== 'text/html' && type !== 'application/xhtml+xml')) return [];
    const body = await boundedPrefix(response, MAX_FAVICON_DOCUMENT_BYTES);
    if (!body?.length) return [];
    const candidates: string[] = [];
    for (const match of body.toString('utf8').matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      const rel = linkAttribute(tag, 'rel').toLowerCase().split(/\s+/);
      if (!rel.some((value) => value === 'icon' || value === 'apple-touch-icon')) continue;
      const href = linkAttribute(tag, 'href');
      if (!href) continue;
      try {
        const resolved = new URL(href, finalUrl).href;
        const declaredType = linkAttribute(tag, 'type').toLowerCase();
        // SVG is intentionally not embedded as a data URL in the trusted app
        // renderer; keep looking for a raster alternative from the same site.
        if (declaredType === 'image/svg+xml' || new URL(resolved).pathname.toLowerCase().endsWith('.svg')) continue;
        if (sanitizeBookmarkUrl(resolved)) candidates.push(resolved);
      } catch { /* Ignore malformed link elements from remote pages. */ }
    }
    return candidates;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(url: string): Promise<string | null> {
  const safe = sanitizeBookmarkUrl(url);
  if (!safe) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await browserSession().fetch(safe, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    // Never `response.url`: Electron's `session.fetch()` leaves it empty, so
    // checking it here — as this did — rejected every icon that ever arrived
    // and quietly degraded the whole feature to the globe. The guarantee it was
    // standing in for is already held upstream, where it belongs: `safe` is
    // http(s) by construction, and the browser session cancels any request that
    // leaves http(s), including part-way through a redirect.
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (!TYPES.has(type)) return null;
    const body = await boundedBody(response);
    if (!body?.length) return null;
    return sanitizeFaviconDataUrl(`data:${type};base64,${body.toString('base64')}`);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One memoised lookup, evicting the oldest entry once the cache is full. */
function memoized(key: string, load: () => Promise<string | null>): Promise<string | null> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load();
  cache.set(key, pending);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? '');
  return pending;
}

/** Deduplicated, http(s)-only, and capped so one hostile page cannot fan out. */
function healthyCandidates(urls: string[]): string[] {
  return [...new Set(urls.map(String).filter((url) => sanitizeBookmarkUrl(url)))].slice(0, 4);
}

/**
 * Where a site keeps its icon when it declared none, or declared only an SVG.
 *
 * Order matters: a real `.ico` is the one path a browser is entitled to assume,
 * and the two larger images are a better icon than nothing rather than a better
 * icon than the `.ico`.
 */
function wellKnownFaviconUrls(origin: string): string[] {
  return [
    new URL('/favicon.ico', origin).href,
    new URL('/favicon.png', origin).href,
    new URL('/apple-touch-icon.png', origin).href,
  ];
}

/** The first candidate that yields usable bytes. */
async function firstIcon(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    const data = await fetchOne(url);
    if (data) return data;
  }
  return null;
}

/** Fetch at most four Chromium-discovered candidates, cached and size-limited. */
export function cachePageFavicon(urls: string[]): Promise<string | null> {
  const candidates = healthyCandidates(urls);
  if (!candidates.length) return Promise.resolve(null);
  return memoized(`icons:${candidates.join('\n')}`, () => firstIcon(candidates));
}

/**
 * Resolve the icon for a LIVE tab, given whatever Chromium reported for it.
 *
 * Chromium's own list is tried first because it is free and usually right, but
 * it is not sufficient on its own. A site whose only declared icon is an SVG —
 * which Nodus deliberately never embeds — makes Chromium report nothing usable,
 * and it does not then fall back to `/favicon.ico` on the site's behalf. Half of
 * the sites that hit this still serve a perfectly good raster `.ico`, so
 * without the well-known paths those tabs showed the globe while the icon sat
 * one request away.
 */
export function cachePageFaviconForSite(pageUrl: string, urls: string[]): Promise<string | null> {
  const safe = sanitizeBookmarkUrl(pageUrl);
  if (!safe) return cachePageFavicon(urls);
  const origin = new URL(safe).origin;
  const candidates = healthyCandidates(urls);
  return memoized(
    `page:${origin}:${candidates.join('\n')}`,
    () => firstIcon([...candidates, ...wellKnownFaviconUrls(origin)]),
  );
}

/** Resolve a bookmark icon even when it was imported or saved before Chromium reported one. */
export function cacheWebsiteFavicon(pageUrl: string): Promise<string | null> {
  const safe = sanitizeBookmarkUrl(pageUrl);
  if (!safe) return Promise.resolve(null);
  const origin = new URL(safe).origin;
  return memoized(`website:${origin}`, async () => {
    const linked = await cachePageFavicon(await discoverFaviconUrls(safe));
    if (linked) return linked;
    return firstIcon(wellKnownFaviconUrls(origin));
  });
}
