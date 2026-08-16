import { fileURLToPath } from 'node:url';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary, WorkMeta } from '@shared/types';

// Read-only client for Zotero's local API: the desktop app's local implementation
// of Web API v3, served from port 23119 since Zotero 7. There is no "Zotero 7 API" —
// the API version is 3, and Zotero supports exactly one version at a time. Requires
// Zotero 7 or newer. Never writes to Zotero, never touches zotero.sqlite directly.

const BASE = process.env.NODUS_ZOTERO_API_BASE?.trim() || 'http://localhost:23119/api';

// The local API accepts `0` as the user ID (the real numeric userID works too;
// anything else answers 400), so we always address the local library as `users/0`.
export const LOCAL_USER_ID = '0';
export const PERSONAL_LIBRARY: ZoteroLibrary = { type: 'user', id: LOCAL_USER_ID, name: 'Mi biblioteca' };

const HEADERS: Record<string, string> = {
  // Load-bearing, do not remove: this is Zotero's DNS-rebinding guard. Against a
  // Mozilla/* User-Agent (Electron's) without this header, Zotero closes the TCP
  // connection outright — not a 403, so callers see a socket error rather than an
  // HTTP status. Verified against Zotero 9.0.6.
  // https://www.zotero.org/support/dev/web_api/v3/basics
  'Zotero-Allowed-Request': '1',
};

export class ZoteroRequestError extends Error {
  constructor(
    message: string,
    readonly code: 'zotero-closed' | 'credentials-expired' | 'rate-limited' | 'library-missing' | 'permission' | 'network' | 'invalid-response',
    readonly status: number | null,
    readonly retryable: boolean,
  ) { super(message); this.name = 'ZoteroRequestError'; }
}

function retryDelay(response: Response | null, attempt: number): number {
  const header = response?.headers.get('Retry-After');
  const retryAfter = header === null || header === undefined ? Number.NaN : Number(header);
  return Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(2_000, retryAfter * 1_000) : attempt * 150;
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Solicitud cancelada', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Solicitud cancelada', 'AbortError')); }, { once: true });
  });
}

async function zfetch(url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) }, signal });
      if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
        await waitForRetry(retryDelay(response, attempt), signal);
        continue;
      }
      if (response.status === 401) throw new ZoteroRequestError('Las credenciales de Zotero han caducado.', 'credentials-expired', 401, false);
      if (response.status === 403) throw new ZoteroRequestError('Zotero rechazó el acceso a esta biblioteca.', 'permission', 403, false);
      if (response.status === 429) throw new ZoteroRequestError('Zotero mantiene temporalmente limitado el acceso.', 'rate-limited', 429, true);
      if (response.status >= 500) throw new ZoteroRequestError(`Zotero respondió HTTP ${response.status}.`, 'network', response.status, true);
      return response;
    } catch (error) {
      if (error instanceof ZoteroRequestError || signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      if (attempt < 3) { await waitForRetry(retryDelay(null, attempt), signal); continue; }
      const message = error instanceof Error ? error.message : String(error);
      throw new ZoteroRequestError(`No se pudo conectar con Zotero: ${message}`, /ECONNREFUSED|fetch failed|socket/i.test(message) ? 'zotero-closed' : 'network', null, true);
    }
  }
  throw new ZoteroRequestError('No se pudo conectar con Zotero.', 'network', null, true);
}

function endpointError(context: string, response: Response): ZoteroRequestError {
  return new ZoteroRequestError(
    response.status === 404 ? `La biblioteca de Zotero ya no existe: ${context}.` : `${context}: HTTP ${response.status}`,
    response.status === 404 ? 'library-missing' : 'invalid-response', response.status, false,
  );
}

function libraryPrefix(library: ZoteroLibrary): string {
  return library.type === 'group' ? `groups/${encodeURIComponent(library.id)}` : `users/${encodeURIComponent(library.id || LOCAL_USER_ID)}`;
}

function canonicalKey(library: ZoteroLibrary, rawKey: string): string {
  return library.type === 'group' ? `groups:${library.id}:${rawKey}` : rawKey;
}

function parseCanonicalKey(key: string, fallback: ZoteroLibrary = PERSONAL_LIBRARY): { library: ZoteroLibrary; rawKey: string } {
  const match = /^groups:([^:]+):(.+)$/.exec(key);
  if (!match) return { library: fallback, rawKey: key };
  return { library: { type: 'group', id: match[1], name: fallback.type === 'group' && fallback.id === match[1] ? fallback.name : `Grupo ${match[1]}` }, rawKey: match[2] };
}

export async function libraries(): Promise<ZoteroLibrary[]> {
  const res = await zfetch(`${BASE}/users/${LOCAL_USER_ID}/groups?limit=100`);
  if (!res.ok) return [PERSONAL_LIBRARY];
  const groups = (await res.json().catch(() => [])) as any[];
  return [PERSONAL_LIBRARY, ...groups.map((raw) => ({
    type: 'group' as const,
    id: String(raw.id ?? raw.data?.id ?? raw.library?.id ?? ''),
    name: String(raw.data?.name ?? raw.name ?? raw.library?.name ?? 'Grupo de Zotero'),
  })).filter((group) => group.id)];
}

/**
 * Verify the local API is reachable. The local API has no auth and uses users/0,
 * so we just confirm a 200 and read the library version header.
 */
export async function ping(): Promise<{ ok: boolean; userId?: string; version?: number; message?: string }> {
  try {
    const res = await zfetch(`${BASE}/users/${LOCAL_USER_ID}/items?limit=1`);
    if (!res.ok) {
      const hint =
        res.status === 403
          ? 'Habilita "Permitir que otras aplicaciones se comuniquen con Zotero" en Ajustes › Avanzado.'
          : `HTTP ${res.status}`;
      return { ok: false, message: hint };
    }
    const v = res.headers.get('Last-Modified-Version');
    return { ok: true, userId: LOCAL_USER_ID, version: v ? parseInt(v, 10) : 0 };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Library version is returned in the Last-Modified-Version response header. */
export async function libraryVersion(userId: string, library: ZoteroLibrary = { ...PERSONAL_LIBRARY, id: userId }): Promise<number> {
  const res = await zfetch(`${BASE}/${libraryPrefix(library)}/items?limit=1`);
  const v = res.headers.get('Last-Modified-Version');
  return v ? parseInt(v, 10) : 0;
}

function mapCollection(raw: any, library: ZoteroLibrary): ZoteroCollection {
  const itemKey = raw.key ?? raw.data?.key;
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    name: raw.data?.name ?? raw.name ?? '(sin nombre)',
    parentCollection: raw.data?.parentCollection ? canonicalKey(library, raw.data.parentCollection) : false,
    // meta.numItems counts ONLY items directly in the collection (not subcollections).
    itemCount: raw.meta?.numItems ?? 0,
    subCount: raw.meta?.numCollections ?? 0,
  };
}

export async function topCollections(userId: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroCollection[]> {
  const library = requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId };
  const res = await zfetch(`${BASE}/${libraryPrefix(library)}/collections/top?limit=100`);
  if (!res.ok) throw endpointError('Colecciones de Zotero', res);
  const data = (await res.json()) as any[];
  return data.map((raw) => mapCollection(raw, library)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function childCollections(userId: string, parentKey: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroCollection[]> {
  const parsed = parseCanonicalKey(parentKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/collections/${encodeURIComponent(parsed.rawKey)}/collections?limit=100`);
  if (!res.ok) throw endpointError('Subcolecciones de Zotero', res);
  const data = (await res.json()) as any[];
  return data.map((raw) => mapCollection(raw, parsed.library)).sort((a, b) => a.name.localeCompare(b.name));
}

function yearFromDate(date?: string): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  return m ? parseInt(m[1], 10) : null;
}

function mapItem(raw: any, library: ZoteroLibrary): ZoteroItem {
  const d = raw.data ?? {};
  const creators = (d.creators ?? []).map((c: any) => ({
    lastName: c.lastName ?? '',
    firstName: c.firstName ?? '',
    name: c.name,
    creatorType: c.creatorType ?? 'author',
  }));
  const itemKey = d.key ?? raw.key;
  const represented = new Set([
    'key', 'version', 'itemType', 'title', 'shortTitle', 'creators', 'date', 'DOI', 'abstractNote', 'tags', 'collections',
    'publisher', 'publicationTitle', 'bookTitle', 'proceedingsTitle', 'ISBN', 'ISSN', 'url', 'language', 'volume', 'issue',
    'pages', 'edition', 'place', 'rights', 'extra', 'dateAdded', 'dateModified', 'relations',
  ]);
  const fields = Object.fromEntries(Object.entries(d as Record<string, unknown>).flatMap(([name, value]) => {
    if (represented.has(name) || !['string', 'number', 'boolean'].includes(typeof value)) return [];
    const clean = String(value).trim(); return clean ? [[name, clean]] : [];
  }));
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    version: d.version ?? raw.version ?? 0,
    title: d.title ?? d.shortTitle ?? '(sin título)',
    creators,
    year: yearFromDate(d.date),
    itemType: d.itemType ?? 'other',
    doi: d.DOI ?? null,
    abstract: d.abstractNote ?? null,
    tags: (d.tags ?? []).map((t: any) => t.tag),
    collections: (d.collections ?? []).map((key: string) => canonicalKey(library, key)),
    publisher: d.publisher ?? null,
    publicationTitle: d.publicationTitle ?? d.bookTitle ?? d.proceedingsTitle ?? null,
    isbn: d.ISBN ?? null,
    issn: d.ISSN ?? null,
    url: d.url ?? null,
    date: d.date ?? null,
    language: d.language ?? null,
    volume: d.volume ?? null,
    issue: d.issue ?? null,
    pages: d.pages ?? null,
    edition: d.edition ?? null,
    place: d.place ?? null,
    rights: d.rights ?? null,
    extra: d.extra ?? null,
    fields,
    dateAdded: d.dateAdded ?? null,
    dateModified: d.dateModified ?? null,
  };
}

export interface ZoteroLibraryItemsPage {
  items: ZoteroItem[];
  version: number;
  total: number;
}

/** All top-level bibliographic items in a library, or its incremental changes. */
export async function libraryItems(
  library: ZoteroLibrary,
  opts: { since?: number; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<ZoteroLibraryItemsPage> {
  const items: ZoteroItem[] = [];
  let start = 0;
  let version = 0;
  let total = 0;
  const limit = 100;
  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start), sort: 'dateModified', direction: 'asc' });
    if (opts.since && opts.since > 0) params.set('since', String(opts.since));
    const res = await zfetch(`${BASE}/${libraryPrefix(library)}/items/top?${params}`, opts.signal);
    if (!res.ok) throw endpointError('Elementos de Zotero', res);
    const data = (await res.json()) as any[];
    version = Number(res.headers.get('Last-Modified-Version')) || version;
    total = Number(res.headers.get('Total-Results')) || data.length;
    items.push(...data
      .filter((raw) => !['attachment', 'note', 'annotation'].includes(raw.data?.itemType))
      .map((raw) => mapItem(raw, library)));
    start += data.length;
    opts.onProgress?.(Math.min(start, total), total);
    if (data.length < limit || start >= total) break;
  }
  return { items, version, total };
}

export interface ZoteroDeletedObjects {
  version: number;
  items: string[];
  collections: string[];
}

/** Tombstones since a saved library version. Empty on the first full import. */
export async function deletedSince(
  library: ZoteroLibrary,
  since: number,
  signal?: AbortSignal,
): Promise<ZoteroDeletedObjects> {
  if (since <= 0) return { version: 0, items: [], collections: [] };
  const res = await zfetch(`${BASE}/${libraryPrefix(library)}/deleted?since=${encodeURIComponent(String(since))}`, signal);
  // The local API does not implement /deleted: it answers 404 "No endpoint found" for
  // every library, user id and `since` — unlike the Web API this endpoint only exists in.
  // Read as a missing library that aborted the entire import on the *second* run, once a
  // version had been recorded and `since` stopped being zero, which is why it stayed
  // hidden while first syncs were failing for other reasons. A library that really is
  // gone also fails on the items and collections endpoints, which are checked on their
  // own, so answering "no tombstones" here cannot disguise one.
  //
  // The cost is that deletions made in Zotero are not mirrored: an item removed there
  // stays in the local catalogue until a full refresh. That is the honest answer while
  // the runtime cannot report tombstones, and it is preferable to refusing to sync.
  if (res.status === 404) return { version: since, items: [], collections: [] };
  if (!res.ok) throw endpointError('Elementos eliminados de Zotero', res);
  const data = (await res.json().catch(() => ({}))) as { items?: string[]; collections?: string[] };
  return {
    version: Number(res.headers.get('Last-Modified-Version')) || since,
    items: (data.items ?? []).map((key) => canonicalKey(library, key)),
    collections: (data.collections ?? []).map((key) => canonicalKey(library, key)),
  };
}

/** Complete collection tree. Pagination is explicit so libraries over 100 nodes are never truncated. */
export async function allCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroCollection[]> {
  const out: ZoteroCollection[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const res = await zfetch(`${BASE}/${libraryPrefix(library)}/collections?limit=${limit}&start=${start}&sort=title`, signal);
    if (!res.ok) throw endpointError('Colecciones de Zotero', res);
    const data = (await res.json()) as any[];
    out.push(...data.map((raw) => mapCollection(raw, library)));
    const total = Number(res.headers.get('Total-Results')) || data.length;
    start += data.length;
    if (data.length < limit || start >= total) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Page through a collection's items (limit=100), skipping attachments/notes. */
export async function collectionItems(
  userId: string,
  collectionKey: string,
  opts: { query?: string; onProgress?: (loaded: number) => void; library?: ZoteroLibrary } = {}
): Promise<ZoteroItem[]> {
  const parsed = parseCanonicalKey(collectionKey, opts.library ?? { ...PERSONAL_LIBRARY, id: userId });
  const out: ZoteroItem[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const q = opts.query ? `&q=${encodeURIComponent(opts.query)}&qmode=titleCreatorYear` : '';
    const url = `${BASE}/${libraryPrefix(parsed.library)}/collections/${encodeURIComponent(parsed.rawKey)}/items/top?limit=${limit}&start=${start}${q}`;
    const res = await zfetch(url);
    if (!res.ok) throw new Error(`Zotero items HTTP ${res.status}`);
    const data = (await res.json()) as any[];
    for (const it of data) out.push(mapItem(it, parsed.library));
    opts.onProgress?.(out.length);
    const total = parseInt(res.headers.get('Total-Results') ?? '0', 10);
    start += limit;
    if (data.length < limit || start >= total) break;
  }
  return out;
}

/**
 * Items in a collection AND all its descendant subcollections, de-duplicated by key.
 * The Zotero API has no reliable recursive parameter, so we traverse the tree.
 */
export async function collectionItemsRecursive(
  userId: string,
  collectionKey: string,
  opts: { query?: string; library?: ZoteroLibrary } = {}
): Promise<ZoteroItem[]> {
  const seen = new Map<string, ZoteroItem>();
  const visited = new Set<string>();
  const visit = async (key: string): Promise<void> => {
    if (visited.has(key)) return;
    visited.add(key);
    const items = await collectionItems(userId, key, opts).catch(() => [] as ZoteroItem[]);
    for (const it of items) if (!seen.has(it.key)) seen.set(it.key, it);
    const children = await childCollections(userId, key).catch(() => [] as ZoteroCollection[]);
    for (const c of children) await visit(c.key);
  };
  await visit(collectionKey);
  return Array.from(seen.values());
}

export async function getItem(userId: string, itemKey: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroItem | null> {
  const parsed = parseCanonicalKey(itemKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`);
  if (!res.ok) return null;
  return mapItem(await res.json(), parsed.library);
}

export async function searchItems(library: ZoteroLibrary, query: string): Promise<ZoteroItem[]> {
  const q = query.trim();
  const params = new URLSearchParams({ limit: '50', sort: 'dateModified', direction: 'desc' });
  if (q) { params.set('q', q); params.set('qmode', 'titleCreatorYear'); }
  const res = await zfetch(`${BASE}/${libraryPrefix(library)}/items/top?${params}`);
  if (!res.ok) throw new Error(`Zotero search HTTP ${res.status}`);
  return ((await res.json()) as any[])
    .filter((raw) => !['note', 'annotation'].includes(raw.data?.itemType))
    .map((raw) => mapItem(raw, library));
}

function creatorName(c: any): string {
  if (c.name) return c.name;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.lastName || '';
}

/** Full bibliographic metadata for one item — used by the graph detail panel. */
export async function getItemMeta(userId: string, itemKey: string): Promise<WorkMeta | null> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`);
  if (!res.ok) return null;
  const d = ((await res.json()) as any).data ?? {};
  const authors = (d.creators ?? [])
    .filter((c: any) => !c.creatorType || c.creatorType === 'author' || c.creatorType === 'editor')
    .map(creatorName)
    .filter(Boolean);
  const numPages = d.numPages ? parseInt(String(d.numPages), 10) : null;
  return {
    itemType: d.itemType ?? 'other',
    authors,
    year: yearFromDate(d.date),
    container:
      d.publicationTitle || d.bookTitle || d.proceedingsTitle || d.encyclopediaTitle || d.dictionaryTitle || d.seriesTitle || null,
    publisher: d.publisher || null,
    pages: d.pages || null,
    numPages: Number.isFinite(numPages as number) ? (numPages as number) : null,
    volume: d.volume || null,
    issue: d.issue || null,
    edition: d.edition || null,
    place: d.place || null,
    doi: d.DOI || null,
    url: d.url || null,
    language: d.language || null,
  };
}

export type ZoteroAttachment = ZoteroAttachmentInfo;

export interface ZoteroFulltext {
  content: string;
  indexedPages?: number;
  totalPages?: number;
  indexedChars?: number;
  totalChars?: number;
}

/**
 * Zotero's own indexed full text for an attachment item (PDFs are indexed on import).
 * Returns null when the item has no indexed text (404 / empty). This lets us reuse
 * Zotero's extraction instead of re-parsing the PDF ourselves.
 */
export async function getFulltext(userId: string, attachmentKey: string): Promise<ZoteroFulltext | null> {
  const parsed = parseCanonicalKey(attachmentKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/fulltext`);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as ZoteroFulltext | null;
  if (!data || !data.content || !data.content.trim()) return null;
  return data;
}

export async function itemChildren(userId: string, itemKey: string): Promise<ZoteroAttachment[]> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/children`);
  if (!res.ok) return [];
  const data = (await res.json()) as any[];
  return data
    // Defensive: older Zotero builds answered /items/<unknown>/children with a 200
    // listing of UNRELATED library items instead of a 404 (9.0.6 returns an empty
    // array). Requiring parentItem to match keeps a stale/foreign key from ever
    // resolving to someone else's file, whichever behaviour the client has.
    .filter((c) => c.data?.itemType === 'attachment' && c.data?.parentItem === parsed.rawKey)
    .map((c) => ({
      key: canonicalKey(parsed.library, c.data.key),
      itemKey: c.data.key,
      library: parsed.library,
      title: c.data.title || c.data.filename || 'Adjunto',
      contentType: c.data.contentType ?? null,
      linkMode: c.data.linkMode ?? null,
      filename: c.data.filename ?? null,
      available: Boolean(c.data.filename),
      version: c.data.version ?? c.version ?? 0,
      parentItem: c.data.parentItem ?? null,
      dateModified: c.data.dateModified ?? null,
    }));
}

export interface ZoteroChildNote {
  key: string;
  title: string;
  html: string;
  version: number;
}

/** Child notes remain a read-only mirror in Nodus. */
export async function itemNotes(userId: string, itemKey: string, library?: ZoteroLibrary): Promise<ZoteroChildNote[]> {
  const parsed = parseCanonicalKey(itemKey, library ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/children`);
  if (!res.ok) return [];
  const data = (await res.json()) as any[];
  return data.filter((child) => child.data?.itemType === 'note' && child.data?.parentItem === parsed.rawKey).map((child) => ({
    key: canonicalKey(parsed.library, child.data.key),
    title: String(child.data.title || 'Zotero note'),
    html: String(child.data.note || ''),
    version: Number(child.data.version ?? child.version ?? 0),
  }));
}

export async function itemAttachments(userId: string, itemKey: string, library?: ZoteroLibrary): Promise<ZoteroAttachment[]> {
  const parsed = parseCanonicalKey(itemKey, library ?? { ...PERSONAL_LIBRARY, id: userId });
  const canonical = canonicalKey(parsed.library, parsed.rawKey);
  const children = await itemChildren(userId, canonical);
  if (children.length) return children;
  const self = await itemAsAttachment(userId, canonical);
  return self ? [self] : [];
}

export async function attachmentFilePath(userId: string, attachmentKey: string): Promise<string | null> {
  const parsed = parseCanonicalKey(attachmentKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/file`, undefined, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location?.startsWith('file:')) return null;
  try { return fileURLToPath(location); } catch { return null; }
}

// Attachment key per parent item, resolved once per session. Used by the
// "open evidence at its PDF page" deep link; invalidation is unnecessary at
// this cadence (a re-added attachment just needs an app restart).
const pdfAttachmentCache = new Map<string, string | null>();

/**
 * The Zotero item key of the first PDF attachment under an item (or the item
 * itself when it IS a standalone PDF attachment). zotero://open-pdf needs the
 * ATTACHMENT key, not the parent's. Null when the item has no PDF.
 */
export async function resolvePdfAttachmentKey(userId: string, itemKey: string): Promise<string | null> {
  const cached = pdfAttachmentCache.get(itemKey);
  if (cached !== undefined) return cached;
  try {
    const children = await itemChildren(userId, itemKey);
    let key = children.find((c) => c.contentType === 'application/pdf')?.key ?? null;
    if (!key) {
      const self = await itemAsAttachment(userId, itemKey);
      if (self?.contentType === 'application/pdf') key = self.key;
    }
    pdfAttachmentCache.set(itemKey, key);
    return key;
  } catch {
    // Zotero probably closed: don't poison the cache, retry on the next click.
    return null;
  }
}

/**
 * When the work item is itself a file attachment — a standalone file (PDF, .md,
 * .docx…) added directly to a collection with no parent reference — it has no
 * children, so its text must be read from the item itself. Returns the item as a
 * ZoteroAttachment, or null when it is not an attachment.
 */
export async function itemAsAttachment(userId: string, itemKey: string): Promise<ZoteroAttachment | null> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`);
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as any;
  const d = raw?.data;
  if (!d || d.itemType !== 'attachment') return null;
  return {
    key: canonicalKey(parsed.library, d.key ?? parsed.rawKey),
    itemKey: d.key ?? parsed.rawKey,
    library: parsed.library,
    title: d.title || d.filename || 'Adjunto',
    contentType: d.contentType ?? null,
    linkMode: d.linkMode ?? null,
    filename: d.filename ?? null,
    available: Boolean(d.filename),
    version: d.version ?? raw.version ?? 0,
    parentItem: d.parentItem ?? null,
    dateModified: d.dateModified ?? null,
  };
}

// An `itemsSince()` incremental diff used to live here, unreferenced by any caller.
// It was removed rather than fixed: it built `users/<id>` by hand instead of going
// through libraryPrefix(), so it could never have served a group library, and its
// `since=0` contract shifted under it (Zotero 8 made since=0 return everything —
// zotero/zotero#5011). Sync reads the library version via libraryVersion() and
// re-walks collections; a real incremental path should be written against the
// current API rather than resurrected from this.
