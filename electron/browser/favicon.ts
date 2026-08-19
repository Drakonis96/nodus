// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { browserSession } from './session';
import { sanitizeFaviconDataUrl, sanitizeBookmarkUrl } from '@shared/browserBookmarks';

const MAX_FAVICON_BYTES = 64 * 1024;
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
  const key = candidates.join('\n');
  if (!key) return Promise.resolve(null);
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
