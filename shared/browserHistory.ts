// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/** Plain-data model for Nodus Browser history. */

export type BrowserHistoryRetention = 'none' | '7d' | '30d' | '90d' | '1y' | 'forever';

export interface BrowserHistoryEntry {
  id: string;
  title: string;
  url: string;
  domain: string;
  visitedAt: string;
}

export interface BrowserHistoryStore {
  version: 1;
  revision: number;
  entries: BrowserHistoryEntry[];
}

export interface BrowserHistoryVisit {
  title: string;
  url: string;
  visitedAt?: string;
}

export const DEFAULT_BROWSER_HISTORY_RETENTION: BrowserHistoryRetention = '30d';
export const MAX_BROWSER_HISTORY_ENTRIES = 50_000;

const RETENTION_MS: Record<Exclude<BrowserHistoryRetention, 'none' | 'forever'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
  '90d': 90 * 24 * 60 * 60 * 1_000,
  '1y': 365 * 24 * 60 * 60 * 1_000,
};

function cleanText(value: unknown, limit: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- titles come from hostile pages
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function sanitizeBrowserHistoryUrl(value: unknown): string | null {
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().slice(0, 2_048);
  } catch {
    return null;
  }
}

export function emptyBrowserHistoryStore(): BrowserHistoryStore {
  return { version: 1, revision: 0, entries: [] };
}

export function normalizeBrowserHistoryStore(value: unknown): BrowserHistoryStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyBrowserHistoryStore();
  const candidate = value as Partial<BrowserHistoryStore>;
  const seen = new Set<string>();
  const entries: BrowserHistoryEntry[] = [];
  for (const raw of Array.isArray(candidate.entries) ? candidate.entries : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Partial<BrowserHistoryEntry>;
    const id = cleanText(item.id, 120);
    const url = sanitizeBrowserHistoryUrl(item.url);
    const time = Date.parse(String(item.visitedAt ?? ''));
    if (!id || seen.has(id) || !url || !Number.isFinite(time)) continue;
    seen.add(id);
    const parsed = new URL(url);
    entries.push({
      id,
      title: cleanText(item.title, 300) || parsed.hostname,
      url,
      domain: parsed.hostname.slice(0, 253),
      visitedAt: new Date(time).toISOString(),
    });
    if (entries.length >= MAX_BROWSER_HISTORY_ENTRIES) break;
  }
  entries.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  return {
    version: 1,
    revision: Math.max(0, Math.floor(Number(candidate.revision) || 0)),
    entries,
  };
}

export function browserHistoryCutoff(retention: BrowserHistoryRetention, now = Date.now()): number | null {
  if (retention === 'forever') return null;
  if (retention === 'none') return Number.POSITIVE_INFINITY;
  return now - RETENTION_MS[retention];
}

export function pruneBrowserHistory(
  store: BrowserHistoryStore,
  retention: BrowserHistoryRetention,
  now = Date.now(),
): BrowserHistoryStore {
  const normalized = normalizeBrowserHistoryStore(store);
  const cutoff = browserHistoryCutoff(retention, now);
  const entries = cutoff == null
    ? normalized.entries
    : normalized.entries.filter((entry) => Date.parse(entry.visitedAt) >= cutoff);
  if (entries.length === normalized.entries.length) return normalized;
  return { ...normalized, revision: normalized.revision + 1, entries };
}

export function insertBrowserHistoryVisit(
  store: BrowserHistoryStore,
  visit: BrowserHistoryVisit,
  id: string,
  retention: BrowserHistoryRetention,
  now = Date.now(),
): BrowserHistoryStore {
  const pruned = pruneBrowserHistory(store, retention, now);
  if (retention === 'none') return pruned;
  const url = sanitizeBrowserHistoryUrl(visit.url);
  if (!url) return pruned;
  const parsed = new URL(url);
  const visitTime = Date.parse(String(visit.visitedAt ?? ''));
  const visitedAt = Number.isFinite(visitTime) ? new Date(visitTime).toISOString() : new Date(now).toISOString();
  const entry: BrowserHistoryEntry = {
    id: cleanText(id, 120),
    title: cleanText(visit.title, 300) || parsed.hostname,
    url,
    domain: parsed.hostname.slice(0, 253),
    visitedAt,
  };
  if (!entry.id) return pruned;
  return {
    ...pruned,
    revision: pruned.revision + 1,
    entries: [entry, ...pruned.entries.filter((item) => item.id !== entry.id)]
      .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
      .slice(0, MAX_BROWSER_HISTORY_ENTRIES),
  };
}

export function deleteBrowserHistoryEntry(store: BrowserHistoryStore, id: string): BrowserHistoryStore {
  const normalized = normalizeBrowserHistoryStore(store);
  const entries = normalized.entries.filter((entry) => entry.id !== id);
  return entries.length === normalized.entries.length
    ? normalized
    : { ...normalized, revision: normalized.revision + 1, entries };
}

export function searchBrowserHistory(store: BrowserHistoryStore, query: string): BrowserHistoryEntry[] {
  const needle = cleanText(query, 300).toLocaleLowerCase();
  if (!needle) return normalizeBrowserHistoryStore(store).entries;
  return normalizeBrowserHistoryStore(store).entries.filter((entry) =>
    `${entry.title}\n${entry.url}\n${entry.domain}`.toLocaleLowerCase().includes(needle));
}
