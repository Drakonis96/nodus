import { createHash } from 'node:crypto';
import type { CompassAuthor, CompassFilters, CompassIdentifier, CompassProviderAdapter, CompassProviderContext, CompassProviderId, CompassProviderPage, CompassPublicationType, CompassResult } from '@shared/compass';

export const USER_AGENT = 'Nodus Compass/1.0 (https://nodus.app; academic discovery client)';
export class CompassProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: number) { super(message); this.name = 'CompassProviderHttpError'; }
}
export function text(value: unknown, max = 4_000): string { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
export function identifier(scheme: string, value: unknown): CompassIdentifier | null { const v = text(value, 300); return v ? { scheme, value: v } : null; }
export function author(value: unknown): CompassAuthor | null { if (typeof value === 'string') return text(value, 300) ? { name: text(value, 300) } : null; if (!value || typeof value !== 'object') return null; const r = value as Record<string, unknown>; const name = text(r.name ?? [r.given, r.family].filter(Boolean).join(' '), 300); return name ? { name, given: text(r.given, 120) || undefined, family: text(r.family, 120) || undefined, orcid: text(r.orcid, 120) || undefined } : null; }
export function canonicalKey(ids: CompassIdentifier[], title: string, firstAuthor = '', year?: number): string {
  const preferred = ids.find((entry) => ['doi', 'pmid', 'pmcid', 'arxiv', 'isbn'].includes(entry.scheme.toLowerCase()));
  let raw: string;
  if (preferred) {
    const scheme = preferred.scheme.toLowerCase();
    let value = preferred.value.trim().toLowerCase();
    if (scheme === 'doi') value = value.replace(/^doi:\s*/, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    if (scheme === 'isbn') value = value.replace(/[\s-]/g, '');
    if (scheme === 'arxiv') value = value.replace(/^arxiv:\s*/, '').replace(/v\d+$/i, '');
    raw = `${scheme}:${value}`;
  } else {
    raw = `${title.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${firstAuthor.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')}|${year ?? ''}`;
  }
  return `compass:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}
export function result(input: { provider: CompassProviderId; providerId: string; title: string; authors?: CompassAuthor[]; year?: number; type?: CompassPublicationType; abstract?: string; url?: string; doi?: string; ids?: CompassIdentifier[]; language?: string; venue?: string; citationCount?: number; }): CompassResult {
  const ids = [...(input.ids ?? []), ...(input.doi ? [{ scheme: 'doi', value: input.doi }] : [])].filter((x, i, a) => a.findIndex((y) => y.scheme === x.scheme && y.value.toLowerCase() === x.value.toLowerCase()) === i); const authors = input.authors ?? []; const now = new Date().toISOString();
  return { canonicalKey: canonicalKey(ids, input.title, authors[0]?.name, input.year), title: text(input.title, 1_000) || 'Untitled work', abstract: text(input.abstract, 5_000) || undefined, authors, issuedYear: input.year, language: text(input.language, 30) || undefined, type: input.type ?? 'other', disciplines: [], topics: [], venue: text(input.venue, 400) || undefined, identifiers: ids, landingUrl: text(input.url, 2_000) || undefined, doiUrl: input.doi ? `https://doi.org/${input.doi}` : undefined, provenance: [{ provider: input.provider, providerId: text(input.providerId, 300), retrievedAt: now, sourceUrl: text(input.url, 2_000) || undefined }], providerRanks: {}, lexicalScore: 0, finalScore: 0, reasons: [] };
}
export async function requestJson(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ data: any; response: Response }> { let last: unknown; for (let attempt = 0; attempt < 3; attempt += 1) { try { const response = await fetch(url, { ...init, signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } }); if (response.ok) return { data: await response.json(), response }; const retryAfter = Number(response.headers.get('retry-after') ?? 0); const retryAt = retryAfter > 0 ? Date.now() + retryAfter * 1_000 : undefined; const error = new CompassProviderHttpError(`Provider HTTP ${response.status}`, response.status, retryAt); if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw error; const wait = Math.min(8_000, Math.max(200, retryAfter ? retryAfter * 1_000 : 250 * 2 ** attempt)); await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, wait); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); }); } catch (error) { if (signal.aborted) throw error; last = error; if (error instanceof CompassProviderHttpError || attempt === 2) throw error; } } throw last instanceof Error ? last : new Error(String(last)); }
export async function requestText(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ data: string; response: Response }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...init, signal, headers: { Accept: 'application/xml,text/xml,text/plain;q=0.9', 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } });
    if (response.ok) { const data = await response.text(); if (data.length > 5_000_000) throw new Error('Provider response exceeds the Compass XML limit.'); return { data, response }; }
    const retryAfter = Number(response.headers.get('retry-after') ?? 0); const retryAt = retryAfter > 0 ? Date.now() + retryAfter * 1_000 : undefined;
    if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new CompassProviderHttpError(`Provider HTTP ${response.status}`, response.status, retryAt);
    const wait = Math.min(8_000, Math.max(200, retryAfter ? retryAfter * 1_000 : 250 * 2 ** attempt));
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, wait); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
  }
  throw new Error('Provider request failed.');
}
export function queryString(plan: CompassProviderContext['query']): string { return [plan.text, ...plan.exactPhrases].filter(Boolean).join(' '); }
export function filterYear(url: URL, filters: CompassFilters): void { if (filters.fromYear) url.searchParams.set('from_publication_date', `${filters.fromYear}-01-01`); if (filters.toYear) url.searchParams.set('to_publication_date', `${filters.toYear}-12-31`); }
export function page(records: CompassResult[], provider: CompassProviderId, nextCursor?: string, attribution?: string): CompassProviderPage { return { provider, records: records.slice(0, 25), nextCursor, hasMore: !!nextCursor, attribution }; }
export type AdapterFactory = (id: CompassProviderId, attribution: string, fn: (context: CompassProviderContext) => Promise<CompassProviderPage>) => CompassProviderAdapter;
export const adapter: AdapterFactory = (id, attribution, fn) => ({ id, attribution, search: fn });
