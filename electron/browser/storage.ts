// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Measuring and clearing what the browser keeps on disk.
 *
 * The honest part first, because it shapes the whole UI: **Chromium exposes byte
 * sizes for exactly two things** through Electron — the HTTP cache
 * (`session.getCacheSize()`) and, indirectly, the profile directory on disk.
 * There is no per-category API for localStorage, IndexedDB, service workers or
 * CacheStorage. None.
 *
 * So this module reports bytes for those two and COUNTS for everything else. It
 * does not walk Chromium's internal subdirectories to invent per-category
 * figures: those layouts are implementation details that change between
 * versions, and a number that is wrong is worse than a number that is absent.
 *
 * The other constraint is that none of this may block the main event loop. The
 * profile walk is async, bounded in concurrency, cached, and runs only when
 * someone opens the settings panel — never at startup and never on a timer.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { browserSession } from './session';

export interface BrowserStorageReport {
  /** Total bytes on disk for the browser profile. Null when it does not exist yet. */
  profileBytes: number | null;
  /** HTTP cache size, the one category Chromium reports directly. */
  cacheBytes: number;
  cookieCount: number;
  /** Distinct registrable-ish domains holding cookies. */
  cookieSites: number;
  /** Origins we know of, for the per-site list. Not a complete storage census. */
  sites: { origin: string; cookies: number }[];
  measuredAt: number;
}

export type BrowserDataCategory =
  | 'cache' | 'cookies' | 'localStorage' | 'indexedDB'
  | 'serviceWorkers' | 'cacheStorage' | 'fileSystems';

const CACHE_TTL_MS = 60_000;
let cached: BrowserStorageReport | null = null;

/**
 * Total size of a directory tree, without blocking.
 *
 * `opendir` streams entries instead of materialising a list, concurrency is
 * bounded so a deep profile cannot spawn thousands of parallel stats, and every
 * error is swallowed: a file vanishing mid-walk is normal in a live profile and
 * is not worth failing the whole measurement over.
 */
async function directorySize(root: string, budget = { walked: 0 }): Promise<number> {
  // A hard ceiling on entries, so a pathological profile cannot make this run
  // for minutes. Reported sizes are "at least this much" in that case, which is
  // still more useful than nothing.
  if (budget.walked > 400_000) return 0;

  let total = 0;
  let dir;
  try {
    dir = await fs.opendir(root);
  } catch {
    return 0;
  }

  const pending: Promise<number>[] = [];
  try {
    for await (const entry of dir) {
      budget.walked += 1;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        pending.push(directorySize(full, budget));
        // Bounded fan-out: await in batches rather than holding the whole tree
        // in flight at once.
        if (pending.length >= 8) {
          total += (await Promise.all(pending.splice(0))).reduce((sum, value) => sum + value, 0);
        }
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch { /* removed mid-walk */ }
      }
    }
  } catch { /* the directory went away under us */ }

  total += (await Promise.all(pending)).reduce((sum, value) => sum + value, 0);
  return total;
}

/** Measure, with a short cache so re-opening the panel does not re-walk the disk. */
export async function measureBrowserStorage(force = false): Promise<BrowserStorageReport> {
  if (!force && cached && Date.now() - cached.measuredAt < CACHE_TTL_MS) return cached;

  const ses = browserSession();
  const storagePath = ses.getStoragePath();

  const [cacheBytes, cookies, profileBytes] = await Promise.all([
    ses.getCacheSize().catch(() => 0),
    ses.cookies.get({}).catch(() => []),
    storagePath ? directorySize(storagePath).catch(() => null) : Promise.resolve(null),
  ]);

  const byDomain = new Map<string, number>();
  for (const cookie of cookies) {
    const domain = String(cookie.domain ?? '').replace(/^\./, '');
    if (!domain) continue;
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }

  cached = {
    profileBytes,
    cacheBytes,
    cookieCount: cookies.length,
    cookieSites: byDomain.size,
    sites: [...byDomain.entries()]
      .map(([origin, count]) => ({ origin, cookies: count }))
      .sort((a, b) => b.cookies - a.cookies)
      .slice(0, 300),
    measuredAt: Date.now(),
  };
  return cached;
}

/**
 * Clear the selected categories.
 *
 * Three APIs are needed, because none of them covers everything:
 *  - `clearCache()` for the HTTP cache, which `clearData` also has but which is
 *    worth doing directly.
 *  - `clearData({dataTypes})` for cookies, localStorage, IndexedDB, service
 *    workers and filesystems. Documented as preferred over clearStorageData.
 *  - `clearStorageData({storages})` for `cachestorage` and `shadercache`, which
 *    `clearData` has no dataTypes for at all.
 *
 * Note `quotas` is NOT passed: Electron 42 removed it from clearStorageData.
 */
export async function clearBrowserData(categories: BrowserDataCategory[], origins?: string[]): Promise<void> {
  const ses = browserSession();
  const wanted = new Set(categories);

  if (wanted.has('cache')) await ses.clearCache();

  const dataTypes: string[] = [];
  if (wanted.has('cookies')) dataTypes.push('cookies');
  if (wanted.has('localStorage')) dataTypes.push('localStorage');
  if (wanted.has('indexedDB')) dataTypes.push('indexedDB');
  if (wanted.has('serviceWorkers')) dataTypes.push('serviceWorkers');
  if (wanted.has('fileSystems')) dataTypes.push('fileSystems');
  if (dataTypes.length > 0) {
    await ses.clearData({
      dataTypes: dataTypes as never,
      ...(origins && origins.length > 0
        // third-parties-included is what a user means by "clear this site": the
        // embedded trackers a site brought with it belong to that site's data.
        ? { origins, originMatchingMode: 'third-parties-included' as const }
        : {}),
    });
  }

  // cachestorage has no clearData equivalent.
  if (wanted.has('cacheStorage')) {
    await ses.clearStorageData({
      storages: ['cachestorage'],
      ...(origins && origins.length === 1 ? { origin: origins[0] } : {}),
    });
  }

  // Stored HTTP credentials go with cookies: both are "am I still signed in".
  if (wanted.has('cookies')) await ses.clearAuthCache();

  cached = null;
}

/** Everything, plus the auth cache. The caller closes the tabs first. */
export async function clearAllBrowserData(): Promise<void> {
  await clearBrowserData([
    'cache', 'cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'cacheStorage', 'fileSystems',
  ]);
}
