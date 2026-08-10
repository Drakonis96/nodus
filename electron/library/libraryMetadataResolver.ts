import type {
  LibraryItemMetadata,
  LibraryItemType,
  LibraryMetadataCandidate,
  LibraryMetadataIdentifierKind,
  LibraryMetadataLookupResult,
} from '@shared/libraryTypes';

export type MetadataFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function identifier(kind: LibraryMetadataIdentifierKind, raw: string): string {
  let value = raw.trim();
  if (kind === 'doi') {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
    if (!/^10\.\d{4,9}\/\S+$/i.test(value)) throw new Error('El DOI no tiene un formato válido.');
    return value;
  }
  value = value.toUpperCase().replace(/[^0-9X]/g, '');
  if (kind === 'isbn' && !/^(?:\d{9}[\dX]|\d{13})$/.test(value)) throw new Error('El ISBN debe contener 10 o 13 caracteres.');
  if (kind === 'issn' && !/^\d{7}[\dX]$/.test(value)) throw new Error('El ISSN debe contener 8 caracteres.');
  return value;
}

function plain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return clean || undefined;
}

function strings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(plain).filter((entry): entry is string => !!entry))];
}

function crossrefType(value: unknown): LibraryItemType {
  const type = String(value ?? '').toLowerCase();
  if (['journal-article', 'posted-content'].includes(type)) return 'article-journal';
  if (['book', 'monograph', 'reference-book'].includes(type)) return 'book';
  if (['book-chapter', 'book-section', 'reference-entry'].includes(type)) return 'chapter';
  if (['proceedings-article', 'proceedings'].includes(type)) return 'conference-paper';
  if (type === 'dissertation') return 'thesis';
  if (type === 'report') return 'report';
  if (type === 'dataset') return 'dataset';
  return 'document';
}

function dateParts(message: Record<string, unknown>): { date?: string; year: number | null } {
  for (const field of ['published-print', 'published-online', 'issued', 'created']) {
    const parts = ((message[field] as { 'date-parts'?: unknown } | undefined)?.['date-parts'] as unknown[][] | undefined)?.[0];
    if (!Array.isArray(parts) || !Number.isInteger(Number(parts[0]))) continue;
    const values = parts.slice(0, 3).map(Number);
    return { date: values.join('-'), year: values[0] };
  }
  return { year: null };
}

function crossrefCandidate(raw: unknown, confidence: number): LibraryMetadataCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  const title = strings(message.title)[0];
  if (!title) return null;
  const doi = plain(message.DOI);
  const { date, year } = dateParts(message);
  const pages = plain(message.page);
  const metadata: LibraryItemMetadata = {
    title, itemType: crossrefType(message.type),
    creators: (Array.isArray(message.author) ? message.author : []).flatMap((rawAuthor) => {
      if (!rawAuthor || typeof rawAuthor !== 'object') return [];
      const author = rawAuthor as Record<string, unknown>;
      const firstName = plain(author.given); const lastName = plain(author.family); const name = plain(author.name);
      return firstName || lastName || name ? [{ creatorType: 'author', ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(name ? { name } : {}) }] : [];
    }),
    ...(plain(message.abstract) ? { abstract: plain(message.abstract) } : {}),
    ...(date ? { date } : {}), year,
    ...(plain(message.language) ? { language: plain(message.language) } : {}),
    ...(plain(message.publisher) ? { publisher: plain(message.publisher) } : {}),
    ...(strings(message['container-title'])[0] ? { publicationTitle: strings(message['container-title'])[0] } : {}),
    ...(plain(message.volume) ? { volume: plain(message.volume) } : {}),
    ...(plain(message.issue) ? { issue: plain(message.issue) } : {}),
    ...(pages ? { pages } : {}),
    ...(plain(message.URL) ? { url: plain(message.URL) } : {}),
    ...(doi ? { doi } : {}), isbn: strings(message.ISBN), issn: strings(message.ISSN), tags: [],
  };
  return {
    id: doi ?? plain(message.URL) ?? `crossref:${title}:${year ?? ''}`, source: 'crossref', confidence,
    sourceUrl: plain(message.URL) ?? (doi ? `https://doi.org/${doi}` : null), metadata,
  };
}

function openLibraryCandidate(raw: unknown, isbn: string, index: number): LibraryMetadataCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = plain(item.title);
  if (!title) return null;
  const years = (Array.isArray(item.publish_year) ? item.publish_year : []).map(Number).filter(Number.isInteger);
  const year = Number.isInteger(Number(item.first_publish_year)) ? Number(item.first_publish_year) : years[0] ?? null;
  const key = plain(item.key);
  return {
    id: key ?? `open-library:${isbn}:${index}`, source: 'open-library', confidence: Math.max(0.65, 0.96 - index * 0.05),
    sourceUrl: key ? `https://openlibrary.org${key}` : null,
    metadata: {
      title, itemType: 'book', year,
      creators: strings(item.author_name).map((name) => ({ creatorType: 'author', name })),
      ...(strings(item.publisher)[0] ? { publisher: strings(item.publisher)[0] } : {}),
      ...(strings(item.language)[0] ? { language: strings(item.language)[0] } : {}),
      isbn: [...new Set([isbn, ...strings(item.isbn)])], issn: [], tags: strings(item.subject).slice(0, 40),
    },
  };
}

async function jsonRequest(url: URL, fetcher: MetadataFetch, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Nodus bibliographic metadata client' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontraron metadatos para ese identificador.' : `El servicio bibliográfico respondió con ${response.status}.`);
    return await response.json();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function resolveLibraryMetadata(
  kind: LibraryMetadataIdentifierKind,
  rawValue: string,
  options: { fetcher?: MetadataFetch; signal?: AbortSignal } = {},
): Promise<LibraryMetadataLookupResult> {
  const value = identifier(kind, rawValue);
  const fetcher = options.fetcher ?? fetch;
  let candidates: LibraryMetadataCandidate[] = [];
  if (kind === 'doi') {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(value)}`);
    const payload = await jsonRequest(url, fetcher, options.signal) as { message?: unknown };
    const candidate = crossrefCandidate(payload.message, 1);
    if (candidate) candidates = [candidate];
  } else if (kind === 'issn') {
    const url = new URL(`https://api.crossref.org/journals/${encodeURIComponent(value)}/works`);
    url.searchParams.set('rows', '10');
    url.searchParams.set('select', 'DOI,title,author,issued,published-print,published-online,container-title,publisher,type,ISSN,ISBN,URL,abstract,language,volume,issue,page');
    const payload = await jsonRequest(url, fetcher, options.signal) as { message?: { items?: unknown[] } };
    candidates = (payload.message?.items ?? []).map((entry, index) => crossrefCandidate(entry, Math.max(0.55, 0.9 - index * 0.03))).filter((entry): entry is LibraryMetadataCandidate => !!entry);
  } else {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('isbn', value); url.searchParams.set('limit', '5');
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,publish_year,publisher,isbn,language,subject');
    const payload = await jsonRequest(url, fetcher, options.signal) as { docs?: unknown[] };
    candidates = (payload.docs ?? []).map((entry, index) => openLibraryCandidate(entry, value, index)).filter((entry): entry is LibraryMetadataCandidate => !!entry);
  }
  if (!candidates.length) throw new Error('No se encontraron metadatos para ese identificador.');
  return { kind, value, candidates, queriedAt: new Date().toISOString() };
}
