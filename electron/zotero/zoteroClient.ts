import type { ZoteroCollection, ZoteroItem, WorkMeta } from '@shared/types';

// Read-only client for the Zotero 7 local API. Never writes to Zotero, never
// touches zotero.sqlite directly.

const BASE = 'http://localhost:23119/api';

// The Zotero 7 local API always addresses the local library as `users/0`,
// regardless of the account's real numeric userID.
export const LOCAL_USER_ID = '0';

const HEADERS: Record<string, string> = {
  // Required: Zotero rejects requests with a Mozilla/* User-Agent (Electron's) unless
  // this header is present. https://www.zotero.org/support/dev/web_api/v3/basics
  'Zotero-Allowed-Request': '1',
};

async function zfetch(url: string): Promise<Response> {
  return fetch(url, { headers: HEADERS });
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
export async function libraryVersion(userId: string): Promise<number> {
  const res = await zfetch(`${BASE}/users/${userId}/items?limit=1`);
  const v = res.headers.get('Last-Modified-Version');
  return v ? parseInt(v, 10) : 0;
}

function mapCollection(raw: any): ZoteroCollection {
  return {
    key: raw.key ?? raw.data?.key,
    name: raw.data?.name ?? raw.name ?? '(sin nombre)',
    parentCollection: raw.data?.parentCollection ?? false,
    // meta.numItems counts ONLY items directly in the collection (not subcollections).
    itemCount: raw.meta?.numItems ?? 0,
    subCount: raw.meta?.numCollections ?? 0,
  };
}

export async function topCollections(userId: string): Promise<ZoteroCollection[]> {
  const res = await zfetch(`${BASE}/users/${userId}/collections/top?limit=100`);
  if (!res.ok) throw new Error(`Zotero collections HTTP ${res.status}`);
  const data = (await res.json()) as any[];
  return data.map(mapCollection).sort((a, b) => a.name.localeCompare(b.name));
}

export async function childCollections(userId: string, parentKey: string): Promise<ZoteroCollection[]> {
  const res = await zfetch(`${BASE}/users/${userId}/collections/${parentKey}/collections?limit=100`);
  if (!res.ok) throw new Error(`Zotero subcollections HTTP ${res.status}`);
  const data = (await res.json()) as any[];
  return data.map(mapCollection).sort((a, b) => a.name.localeCompare(b.name));
}

function yearFromDate(date?: string): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  return m ? parseInt(m[1], 10) : null;
}

function mapItem(raw: any): ZoteroItem {
  const d = raw.data ?? {};
  const creators = (d.creators ?? []).map((c: any) => ({
    lastName: c.lastName ?? '',
    firstName: c.firstName ?? '',
    name: c.name,
    creatorType: c.creatorType ?? 'author',
  }));
  return {
    key: d.key ?? raw.key,
    version: d.version ?? raw.version ?? 0,
    title: d.title ?? d.shortTitle ?? '(sin título)',
    creators,
    year: yearFromDate(d.date),
    itemType: d.itemType ?? 'other',
    doi: d.DOI ?? null,
    abstract: d.abstractNote ?? null,
    tags: (d.tags ?? []).map((t: any) => t.tag),
    collections: d.collections ?? [],
  };
}

/** Page through a collection's items (limit=100), skipping attachments/notes. */
export async function collectionItems(
  userId: string,
  collectionKey: string,
  opts: { query?: string; onProgress?: (loaded: number) => void } = {}
): Promise<ZoteroItem[]> {
  const out: ZoteroItem[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const q = opts.query ? `&q=${encodeURIComponent(opts.query)}&qmode=titleCreatorYear` : '';
    const url = `${BASE}/users/${userId}/collections/${collectionKey}/items/top?limit=${limit}&start=${start}${q}`;
    const res = await zfetch(url);
    if (!res.ok) throw new Error(`Zotero items HTTP ${res.status}`);
    const data = (await res.json()) as any[];
    for (const it of data) out.push(mapItem(it));
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
  opts: { query?: string } = {}
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

export async function getItem(userId: string, itemKey: string): Promise<ZoteroItem | null> {
  const res = await zfetch(`${BASE}/users/${userId}/items/${itemKey}`);
  if (!res.ok) return null;
  return mapItem(await res.json());
}

function creatorName(c: any): string {
  if (c.name) return c.name;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.lastName || '';
}

/** Full bibliographic metadata for one item — used by the graph detail panel. */
export async function getItemMeta(userId: string, itemKey: string): Promise<WorkMeta | null> {
  const res = await zfetch(`${BASE}/users/${userId}/items/${itemKey}`);
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

export interface ZoteroAttachment {
  key: string;
  contentType: string | null;
  linkMode: string | null;
  filename: string | null;
}

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
  const res = await zfetch(`${BASE}/users/${userId}/items/${attachmentKey}/fulltext`);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as ZoteroFulltext | null;
  if (!data || !data.content || !data.content.trim()) return null;
  return data;
}

export async function itemChildren(userId: string, itemKey: string): Promise<ZoteroAttachment[]> {
  const res = await zfetch(`${BASE}/users/${userId}/items/${itemKey}/children`);
  if (!res.ok) return [];
  const data = (await res.json()) as any[];
  return data
    .filter((c) => c.data?.itemType === 'attachment')
    .map((c) => ({
      key: c.data.key,
      contentType: c.data.contentType ?? null,
      linkMode: c.data.linkMode ?? null,
      filename: c.data.filename ?? null,
    }));
}

/**
 * When the work item is itself a file attachment — a standalone file (PDF, .md,
 * .docx…) added directly to a collection with no parent reference — it has no
 * children, so its text must be read from the item itself. Returns the item as a
 * ZoteroAttachment, or null when it is not an attachment.
 */
export async function itemAsAttachment(userId: string, itemKey: string): Promise<ZoteroAttachment | null> {
  const res = await zfetch(`${BASE}/users/${userId}/items/${itemKey}`);
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as any;
  const d = raw?.data;
  if (!d || d.itemType !== 'attachment') return null;
  return {
    key: d.key ?? itemKey,
    contentType: d.contentType ?? null,
    linkMode: d.linkMode ?? null,
    filename: d.filename ?? null,
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
    for (const it of data) out.push(mapItem(it));
    const total = parseInt(res.headers.get('Total-Results') ?? '0', 10);
    start += limit;
    if (data.length < limit || start >= total) break;
  }
  return { items: out, version };
}
