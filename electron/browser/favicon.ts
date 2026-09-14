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
    const finalUrl = sanitizeBookmarkUrl(response.url);
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
    if (!response.ok || !sanitizeBookmarkUrl(response.url)) return null;
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

/** Fetch at most four Chromium-discovered candidates, cached and size-limited. */
export function cachePageFavicon(urls: string[]): Promise<string | null> {
  const candidates = [...new Set(urls.map(String).filter((url) => sanitizeBookmarkUrl(url)))].slice(0, 4);
  if (!candidates.length) return Promise.resolve(null);
  const key = `icons:${candidates.join('\n')}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    for (const url of candidates) {
      const data = await fetchOne(url);
      if (data) return data;
    }
    return null;
  })();
  cache.set(key, pending);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? '');
  return pending;
}

/** Resolve a bookmark icon even when it was imported or saved before Chromium reported one. */
export function cacheWebsiteFavicon(pageUrl: string): Promise<string | null> {
  const safe = sanitizeBookmarkUrl(pageUrl);
  if (!safe) return Promise.resolve(null);
  const origin = new URL(safe).origin;
  const key = `website:${origin}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const discovered = await discoverFaviconUrls(safe);
    const linked = await cachePageFavicon(discovered);
    if (linked) return linked;
    return cachePageFavicon([
      new URL('/favicon.ico', origin).href,
      new URL('/favicon.png', origin).href,
      new URL('/apple-touch-icon.png', origin).href,
    ]);
  })();
  cache.set(key, pending);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? '');
  return pending;
}
