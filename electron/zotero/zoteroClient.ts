import { fileURLToPath } from 'node:url';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary, WorkMeta } from '@shared/types';

// Read-only client for the Zotero 7 local API. Never writes to Zotero, never
// touches zotero.sqlite directly.

const BASE = process.env.NODUS_ZOTERO_API_BASE?.trim() || 'http://localhost:23119/api';

// The Zotero 7 local API always addresses the local library as `users/0`,
// regardless of the account's real numeric userID.
export const LOCAL_USER_ID = '0';
export const PERSONAL_LIBRARY: ZoteroLibrary = { type: 'user', id: LOCAL_USER_ID, name: 'Mi biblioteca' };

const HEADERS: Record<string, string> = {
  // Required: Zotero rejects requests with a Mozilla/* User-Agent (Electron's) unless
  // this header is present. https://www.zotero.org/support/dev/web_api/v3/basics
  'Zotero-Allowed-Request': '1',
};

async function zfetch(url: string): Promise<Response> {
  return fetch(url, { headers: HEADERS });
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
  if (!res.ok) throw new Error(`Zotero collections HTTP ${res.status}`);
  const data = (await res.json()) as any[];
  return data.map((raw) => mapCollection(raw, library)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function childCollections(userId: string, parentKey: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroCollection[]> {
  const parsed = parseCanonicalKey(parentKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${BASE}/${libraryPrefix(parsed.library)}/collections/${encodeURIComponent(parsed.rawKey)}/collections?limit=100`);
  if (!res.ok) throw new Error(`Zotero subcollections HTTP ${res.status}`);
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
    url: d.url ?? null,
  };
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
    // Zotero's local API answers /items/<unknown>/children with a 200 listing
    // of UNRELATED library items instead of a 404. Requiring parentItem to
    // match keeps a stale/foreign key from resolving to someone else's file.
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
  const res = await fetch(`${BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/file`, {
    headers: HEADERS,
    redirect: 'manual',
  });
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
  };
}

/** Incremental diff: items changed since a library version. */
export async function itemsSince(userId: string, since: number): Promise<{ items: ZoteroItem[]; version: number }> {
  const out: ZoteroItem[] = [];
  let start = 0;
  const limit = 100;
  let version = since;
  for (;;) {
    const res = await zfetch(`${BASE}/users/${userId}/items/top?since=${since}&limit=${limit}&start=${start}`);
    if (!res.ok) throw new Error(`Zotero since HTTP ${res.status}`);
    const v = res.headers.get('Last-Modified-Version');
    if (v) version = parseInt(v, 10);
    const data = (await res.json()) as any[];
    for (const it of data) out.push(mapItem(it, { ...PERSONAL_LIBRARY, id: userId }));
    const total = parseInt(res.headers.get('Total-Results') ?? '0', 10);
    start += limit;
    if (data.length < limit || start >= total) break;
  }
  return { items: out, version };
}
