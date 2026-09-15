import type {
  LibraryItemMetadata,
  LibraryItemType,
  LibraryMetadataCandidate,
  LibraryMetadataIdentifierKind,
  LibraryMetadataLookupResult,
  LibraryReferenceKind,
} from '@shared/libraryTypes';
import { fetchPublicResource, readBoundedText, type PublicFetchOptions } from '../network/publicDownload';
import { parseScholarlyLandingPage } from './libraryLandingPage';

export type MetadataFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const METADATA_TIMEOUT_MS = 15_000;
/** Publisher landing pages are read for their `<head>`, so the cap is generous but finite. */
const LANDING_PAGE_MAX_BYTES = 4 * 1024 * 1024;
const LANDING_PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,application/pdf;q=0.8,*/*;q=0.1';

/**
 * The one provider failure that is not a malfunction.
 *
 * A `404` from Crossref, DataCite, Open Library or PubMed means the identifier names
 * nothing they hold, and callers treat it as an answer — arXiv, in particular, falls back
 * to its own feed when DataCite has no DOI for the identifier. Comparing the sentence
 * itself is what keeps that distinction out of the transport layer: every other failure
 * (a status, a timeout, a dropped connection) stays an error.
 */
const NO_METADATA = 'No se encontraron metadatos para ese identificador.';

/** A library that throttles is telling the reader to wait, which is worth saying. */
function providerStatusError(status: number): Error {
  return new Error(status === 429
    ? 'El servicio bibliográfico está limitando las peticiones. Inténtalo de nuevo en un minuto.'
    : `El servicio bibliográfico respondió con ${status}.`);
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Canceled', 'AbortError')); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); }, { once: true });
  });
}

function identifier(kind: LibraryReferenceKind, raw: string): string {
  let value = raw.trim();
  if (kind === 'doi') {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
    if (!/^10\.\d{4,9}\/\S+$/i.test(value)) throw new Error('El DOI no tiene un formato válido.');
    return value;
  }
  if (kind === 'pmid') {
    value = value.replace(/^pmid:\s*/i, '').trim();
    if (!/^\d{1,12}$/.test(value)) throw new Error('El PMID debe contener sólo dígitos.');
    return value;
  }
  if (kind === 'pmcid') {
    value = value.replace(/^pmcid?:\s*/i, '').toUpperCase().replace(/\s+/g, '');
    if (!/^PMC\d{1,12}$/.test(value)) throw new Error('El PMCID debe tener el formato PMC seguido de dígitos.');
    return value;
  }
  if (kind === 'arxiv') {
    value = value.replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '').replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '').trim();
    if (!/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(value)) throw new Error('El identificador arXiv no tiene un formato válido.');
    return value;
  }
  if (kind === 'url') {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('La dirección no es una URL válida.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Sólo se pueden añadir direcciones http o https.');
    return url.toString();
  }
  value = value.toUpperCase().replace(/[^0-9X]/g, '');
  if (kind === 'isbn' && !/^(?:\d{9}[\dX]|\d{13})$/.test(value)) throw new Error('El ISBN debe contener 10 o 13 caracteres.');
  if (kind === 'issn' && !/^\d{7}[\dX]$/.test(value)) throw new Error('El ISSN debe contener 8 caracteres.');
  return value;
}

function plain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value
    // Crossref ships abstracts and titles as JATS, DataCite as HTML. A tag that closes
    // right before a full stop must vanish rather than leave "SAM ." behind — while a
    // space that the author typed (French "Quoi ?") is left exactly where it is.
    .replace(/<[^>]+>(?=[.,;:!?])/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return clean || undefined;
}

function strings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(plain).filter((entry): entry is string => !!entry))];
}

function crossrefType(value: unknown): LibraryItemType {
  const type = String(value ?? '').toLowerCase();
  if (type === 'journal-article') return 'journal-article';
  if (type === 'posted-content') return 'preprint';
  if (['book', 'monograph', 'reference-book'].includes(type)) return 'book';
  if (['book-chapter', 'book-section', 'reference-entry'].includes(type)) return 'book-chapter';
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
  const fullTextLinks = (Array.isArray(message.link) ? message.link : []).flatMap((rawLink) => {
    if (!rawLink || typeof rawLink !== 'object') return [];
    const link = rawLink as Record<string, unknown>;
    const url = plain(link.URL);
    const mimeType = plain(link['content-type'])?.toLowerCase().split(';')[0] ?? null;
    if (!url || mimeType !== 'application/pdf') return [];
    return [{ url, mimeType, source: 'crossref' as const }];
  });
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
    sourceUrl: plain(message.URL) ?? (doi ? `https://doi.org/${doi}` : null),
    ...(fullTextLinks.length ? { fullTextLinks } : {}), metadata,
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
  const sourceUrl = key ? `https://openlibrary.org${key}` : null;
  return {
    id: key ?? `open-library:${isbn}:${index}`, source: 'open-library', confidence: Math.max(0.65, 0.96 - index * 0.05),
    sourceUrl,
    metadata: {
      title, itemType: 'book', year,
      creators: strings(item.author_name).map((name) => ({ creatorType: 'author', name })),
      ...(strings(item.publisher)[0] ? { publisher: strings(item.publisher)[0] } : {}),
      ...(strings(item.language)[0] ? { language: strings(item.language)[0] } : {}),
      ...(sourceUrl ? { url: sourceUrl } : {}),
      isbn: [...new Set([isbn, ...strings(item.isbn)])], issn: [], tags: strings(item.subject).slice(0, 40),
    },
  };
}

async function jsonRequest(url: URL, fetcher: MetadataFetch, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Nodus bibliographic metadata client' } });
    if (!response.ok) throw response.status === 404 ? new Error(NO_METADATA) : providerStatusError(response.status);
    return await response.json();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function textRequest(url: URL, fetcher: MetadataFetch, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/atom+xml', 'User-Agent': 'Nodus bibliographic metadata client' } });
    if (!response.ok) throw response.status === 404 ? new Error(NO_METADATA) : providerStatusError(response.status);
    return await response.text();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function xmlPlain(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((match) => xmlPlain(match[1])).filter(Boolean);
}

function pubmedCandidate(raw: unknown, requested: { pmid?: string; pmcid?: string }): LibraryMetadataCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = plain(item.title); if (!title) return null;
  const authors = (Array.isArray(item.authors) ? item.authors : []).flatMap((author) => {
    const name = plain((author as { name?: unknown } | null)?.name); return name ? [nameCreator(name)] : [];
  });
  const articleIds = Array.isArray(item.articleids) ? item.articleids as Array<Record<string, unknown>> : [];
  const findId = (idType: string) => plain(articleIds.find((entry) => String(entry.idtype ?? '').toLowerCase() === idType)?.value);
  const rawDate = plain(item.pubdate) ?? plain(item.epubdate);
  const parsedYear = Number(/\b(\d{4})\b/.exec(rawDate ?? '')?.[1]) || null;
  const doi = findId('doi'); const pmid = requested.pmid ?? findId('pubmed'); const pmcid = requested.pmcid ?? findId('pmc');
  const sourceUrl = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/` : null;
  return {
    id: `pubmed:${pmid ?? pmcid ?? title}`, source: 'pubmed', confidence: 1,
    sourceUrl,
    metadata: {
      title, itemType: 'article-journal', creators: authors, date: rawDate, year: parsedYear,
      publicationTitle: plain(item.fulljournalname) ?? plain(item.source), volume: plain(item.volume), issue: plain(item.issue), pages: plain(item.pages),
      ...(sourceUrl ? { url: sourceUrl } : {}), ...(doi ? { doi } : {}), ...(pmid ? { pmid } : {}), ...(pmcid ? { pmcid } : {}),
      isbn: [], issn: strings(item.issn), tags: [],
    },
  };
}

function nameCreator(name: string): LibraryItemMetadata['creators'][number] {
  const clean = name.trim(); const comma = /^([^,]+),\s*(.+)$/.exec(clean);
  if (comma) return { creatorType: 'author', firstName: comma[2], lastName: comma[1] };
  const parts = clean.split(/\s+/); return parts.length > 1
    ? { creatorType: 'author', firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
    : { creatorType: 'author', name: clean };
}

function arxivCandidate(xml: string, arxiv: string): LibraryMetadataCandidate | null {
  const entry = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/i.exec(xml)?.[1]; if (!entry) return null;
  const title = xmlValues(entry, 'title')[0]; if (!title) return null;
  const published = xmlValues(entry, 'published')[0]; const parsedYear = Number(published?.slice(0, 4)) || null;
  const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)]
    .flatMap((match) => xmlValues(match[1], 'name').map(nameCreator));
  const doi = xmlValues(entry, 'arxiv:doi')[0];
  return {
    id: `arxiv:${arxiv}`, source: 'arxiv', confidence: 1, sourceUrl: `https://arxiv.org/abs/${arxiv}`,
    fullTextLinks: [{ url: `https://arxiv.org/pdf/${arxiv}.pdf`, mimeType: 'application/pdf', source: 'arxiv' }],
    metadata: {
      title, itemType: 'preprint', creators: authors, abstract: xmlValues(entry, 'summary')[0], date: published, year: parsedYear,
      ...(doi ? { doi } : {}), arxiv, url: `https://arxiv.org/abs/${arxiv}`,
      isbn: [], issn: [], tags: xmlValues(entry, 'category'),
    },
  };
}

/** arXiv DOIs are registered for the work, never for one revision, so the version goes. */
function versionlessArxiv(value: string): string {
  return value.replace(/v\d+$/i, '');
}

function dataciteYear(attributes: Record<string, unknown>, issued: string | undefined): number | null {
  if (Number.isInteger(Number(attributes.publicationYear))) return Number(attributes.publicationYear);
  const fromDate = Number(issued?.slice(0, 4));
  return Number.isInteger(fromDate) && fromDate > 0 ? fromDate : null;
}

/**
 * arXiv metadata, from DataCite.
 *
 * Every arXiv paper has a `10.48550/arXiv.<id>` DOI registered with DataCite, which serves
 * the same title, author list, abstract, subject list and submission date as arXiv's own
 * Atom feed — and serves them to a program without the throttling that made that feed
 * unusable: it answers every request from a non-browser client with `429 Rate exceeded.`
 * until it gives up and the connection is dropped.
 *
 * A 404 is a real answer here, not a failure: it means the identifier has no DOI, and the
 * caller falls back to the feed.
 */
async function dataciteArxivCandidate(arxiv: string, fetcher: MetadataFetch, signal?: AbortSignal): Promise<LibraryMetadataCandidate | null> {
  const url = new URL(`https://api.datacite.org/dois/${encodeURIComponent(`10.48550/arxiv.${versionlessArxiv(arxiv)}`)}`);
  let payload: unknown;
  try {
    payload = await jsonRequest(url, fetcher, signal);
  } catch (error) {
    if (error instanceof Error && error.message === NO_METADATA) return null;
    throw error;
  }
  const attributes = (payload as { data?: { attributes?: Record<string, unknown> } } | null)?.data?.attributes;
  if (!attributes || typeof attributes !== 'object') return null;
  const title = strings((Array.isArray(attributes.titles) ? attributes.titles : []).map((entry) => (entry as Record<string, unknown>)?.title))[0];
  if (!title) return null;
  const descriptions = (Array.isArray(attributes.descriptions) ? attributes.descriptions : []) as Array<Record<string, unknown>>;
  const abstract = plain(descriptions.find((entry) => String(entry.descriptionType ?? '').toLowerCase() === 'abstract')?.description)
    ?? plain(descriptions[0]?.description);
  const dates = (Array.isArray(attributes.dates) ? attributes.dates : []) as Array<Record<string, unknown>>;
  const issued = plain(dates.find((entry) => String(entry.dateType ?? '').toLowerCase() === 'submitted')?.date)
    ?? plain(dates.find((entry) => String(entry.dateType ?? '').toLowerCase() === 'issued')?.date);
  const landing = plain(attributes.url) ?? `https://arxiv.org/abs/${arxiv}`;
  const publisher = plain(attributes.publisher);
  return {
    id: `arxiv:${arxiv}`, source: 'arxiv', confidence: 1, sourceUrl: landing,
    fullTextLinks: [{ url: `https://arxiv.org/pdf/${arxiv}.pdf`, mimeType: 'application/pdf', source: 'arxiv' }],
    metadata: {
      title, itemType: 'preprint',
      creators: (Array.isArray(attributes.creators) ? attributes.creators : []).flatMap((entry) => {
        const creator = entry as Record<string, unknown>;
        const family = plain(creator.familyName); const given = plain(creator.givenName); const name = plain(creator.name);
        if (family || given) return [{ creatorType: 'author' as const, ...(given ? { firstName: given } : {}), ...(family ? { lastName: family } : {}) }];
        if (!name) return [];
        return String(creator.nameType ?? '').toLowerCase() === 'organizational'
          ? [{ creatorType: 'author' as const, name }]
          : [nameCreator(name)];
      }),
      ...(abstract ? { abstract } : {}),
      ...(issued ? { date: issued } : {}),
      year: dataciteYear(attributes, issued),
      ...(publisher ? { publisher } : {}),
      url: landing, arxiv,
      isbn: [], issn: [],
      tags: (Array.isArray(attributes.subjects) ? attributes.subjects : [])
        .map((entry) => plain((entry as Record<string, unknown>)?.subject))
        .filter((entry): entry is string => !!entry).slice(0, 40),
    },
  };
}

/**
 * arXiv's Atom feed, kept as the fallback for identifiers DataCite has no DOI for.
 *
 * The feed throttles by IP and answers `429` with a body that reads `Rate exceeded.`, so
 * one retry is worth the wait; beyond that the caller's message has to say that arXiv is
 * rate-limiting, because that is the only part the reader can act on.
 */
async function arxivAtomCandidates(arxiv: string, fetcher: MetadataFetch, signal?: AbortSignal): Promise<LibraryMetadataCandidate[]> {
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `id:${arxiv}`); url.searchParams.set('max_results', '1');
  let lastError: unknown = null;
  for (const delay of [0, 1_500]) {
    if (delay) await wait(delay, signal);
    try {
      const candidate = arxivCandidate(await textRequest(url, fetcher, signal), arxiv);
      if (candidate) return [candidate];
      lastError = new Error(NO_METADATA);
    } catch (error) {
      if ((error as Error | null)?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(NO_METADATA);
}

async function arxivCandidates(arxiv: string, fetcher: MetadataFetch, signal?: AbortSignal): Promise<LibraryMetadataCandidate[]> {
  let dataciteError: unknown = null;
  try {
    const fromDatacite = await dataciteArxivCandidate(arxiv, fetcher, signal);
    if (fromDatacite) return [fromDatacite];
  } catch (error) { dataciteError = error; }
  try {
    return await arxivAtomCandidates(arxiv, fetcher, signal);
  } catch (error) {
    // A throttled feed is the failure the reader can act on, so it outranks a 404 that
    // only means "this paper has no DOI yet".
    if (error instanceof Error && error.message !== NO_METADATA) throw error;
    throw dataciteError instanceof Error ? dataciteError : error;
  }
}

/**
 * The identifier a known host puts in its URL path.
 *
 * These are the links people actually copy out of a paper, and every one of them resolves
 * against a metadata API — cheaper, more accurate, and kinder to the publisher than
 * scraping the page the link opens. Anything else falls through to the page itself.
 */
function identifierFromUrl(url: URL): { kind: LibraryMetadataIdentifierKind; value: string } | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(url.pathname);
  if (host === 'arxiv.org') {
    const match = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i.exec(path);
    if (match) return { kind: 'arxiv', value: match[1] };
  }
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const value = path.replace(/^\//, '');
    if (/^10\.\d{4,9}\/\S+$/.test(value)) return { kind: 'doi', value };
  }
  if (host === 'pubmed.ncbi.nlm.nih.gov') {
    const match = /^\/(\d{1,12})\/?$/.exec(path);
    if (match) return { kind: 'pmid', value: match[1] };
  }
  if (host === 'ncbi.nlm.nih.gov' || host === 'pmc.ncbi.nlm.nih.gov') {
    const match = /^\/pmc\/articles\/(PMC\d{1,12})\/?$/i.exec(path) ?? /^\/(PMC\d{1,12})\/?$/i.exec(path);
    if (match) return { kind: 'pmcid', value: match[1].toUpperCase() };
  }
  if (host === 'europepmc.org') {
    const match = /^\/(?:article|articles)\/(?:PMC)?(PMC\d{1,12})\/?$/i.exec(path);
    if (match) return { kind: 'pmcid', value: match[1].toUpperCase() };
  }
  return null;
}

function fileTitle(url: string): string {
  try {
    const base = decodeURIComponent(url.split('/').pop() ?? '');
    return base.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim() || url;
  } catch { return url; }
}

/** A URL that is itself the document: the item is the file, and it is already in hand. */
function directFileCandidate(url: string, mimeType: string): LibraryMetadataCandidate {
  return {
    id: url, source: 'landing-page', confidence: 0.9, sourceUrl: url,
    fullTextLinks: [{ url, mimeType, source: 'landing-page' }],
    metadata: {
      title: fileTitle(url), itemType: 'document', creators: [], year: null,
      url, isbn: [], issn: [], tags: [],
    },
  };
}

function stripEmpty(metadata: LibraryItemMetadata): Partial<LibraryItemMetadata> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value != null && (!Array.isArray(value) || value.length > 0)),
  ) as Partial<LibraryItemMetadata>;
}

async function identifierMetadata(
  identifiers: Array<{ kind: LibraryMetadataIdentifierKind; value: string }>,
  fetcher: MetadataFetch,
  signal?: AbortSignal,
): Promise<LibraryMetadataCandidate | null> {
  const first = identifiers[0];
  if (!first) return null;
  try { return (await resolveIdentifierCandidates(first.kind, first.value, fetcher, signal))[0]; }
  catch { return null; }
}

/**
 * Merge a page's own record with the one its identifier resolves to.
 *
 * The page leads because it describes the exact revision the reader linked to, and the
 * resolved record fills the fields a landing page never carries (journal, abstract,
 * pagination). One field is the exception: a page with no scholarly markup reports its
 * item type as the generic `document`, and that must not demote an article.
 */
function mergeOverPage(page: LibraryItemMetadata, resolved: LibraryItemMetadata): LibraryItemMetadata {
  const overlay = stripEmpty(page);
  if (overlay.itemType === 'document' && resolved.itemType !== 'document') delete overlay.itemType;
  return { ...resolved, ...overlay };
}

async function resolveUrlCandidate(
  rawUrl: string,
  fetcher: MetadataFetch,
  signal: AbortSignal | undefined,
  options: Pick<PublicFetchOptions, 'assertPublic' | 'fetcher'>,
): Promise<LibraryMetadataCandidate> {
  const url = new URL(rawUrl);
  const known = identifierFromUrl(url);
  let identifierError: unknown = null;
  if (known) {
    try { return (await resolveIdentifierCandidates(known.kind, known.value, fetcher, signal))[0]; }
    catch (error) { identifierError = error; }
  }
  let fetched;
  try {
    fetched = await fetchPublicResource(rawUrl, {
      ...options, fetcher, signal, accept: LANDING_PAGE_ACCEPT,
      maxBytes: LANDING_PAGE_MAX_BYTES, timeoutMs: 20_000,
    });
  } catch (error) {
    // The page is unreachable or refused us. When the URL also named an identifier, that
    // failure is the more useful one to report: it says what the host did, not the page.
    throw identifierError instanceof Error ? identifierError : error;
  }
  const contentType = (fetched.response.headers.get('content-type') ?? '').toLowerCase().split(';')[0];
  if (contentType === 'application/pdf') return directFileCandidate(fetched.finalUrl, 'application/pdf');
  if (contentType && !['text/html', 'application/xhtml+xml'].includes(contentType)) {
    throw new Error('La dirección no apunta a una página ni a un PDF.');
  }
  const record = parseScholarlyLandingPage(
    await readBoundedText(fetched.response, LANDING_PAGE_MAX_BYTES, 'La página consultada es demasiado grande para leer sus metadatos.'),
    fetched.finalUrl,
  );
  if (!record) throw new Error('La página no publica metadatos bibliográficos. Añade la referencia a mano.');
  const resolved = await identifierMetadata(record.identifiers, fetcher, signal);
  const fullTextLinks = [...new Map([
    ...(resolved?.fullTextLinks ?? []),
    ...record.pdfUrls.map((pdfUrl) => ({ url: pdfUrl, mimeType: 'application/pdf', source: 'landing-page' as const })),
  ].map((entry) => [entry.url, entry])).values()];
  return {
    id: resolved ? `${resolved.id}#${fetched.finalUrl}` : fetched.finalUrl,
    source: 'landing-page', confidence: resolved ? 0.95 : 0.85,
    sourceUrl: fetched.finalUrl,
    ...(fullTextLinks.length ? { fullTextLinks } : {}),
    metadata: resolved ? mergeOverPage(record.metadata, resolved.metadata) : record.metadata,
  };
}

async function resolveIdentifierCandidates(
  kind: LibraryMetadataIdentifierKind,
  rawValue: string,
  fetcher: MetadataFetch,
  signal?: AbortSignal,
): Promise<LibraryMetadataCandidate[]> {
  const value = identifier(kind, rawValue);
  let candidates: LibraryMetadataCandidate[] = [];
  if (kind === 'doi') {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(value)}`);
    const payload = await jsonRequest(url, fetcher, signal) as { message?: unknown };
    const candidate = crossrefCandidate(payload.message, 1);
    if (candidate) candidates = [candidate];
  } else if (kind === 'issn') {
    const url = new URL(`https://api.crossref.org/journals/${encodeURIComponent(value)}/works`);
    url.searchParams.set('rows', '10');
    url.searchParams.set('select', 'DOI,title,author,issued,published-print,published-online,container-title,publisher,type,ISSN,ISBN,URL,abstract,language,volume,issue,page');
    const payload = await jsonRequest(url, fetcher, signal) as { message?: { items?: unknown[] } };
    candidates = (payload.message?.items ?? []).map((entry, index) => crossrefCandidate(entry, Math.max(0.55, 0.9 - index * 0.03))).filter((entry): entry is LibraryMetadataCandidate => !!entry);
  } else if (kind === 'isbn') {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('isbn', value); url.searchParams.set('limit', '5');
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,publish_year,publisher,isbn,language,subject');
    const payload = await jsonRequest(url, fetcher, signal) as { docs?: unknown[] };
    candidates = (payload.docs ?? []).map((entry, index) => openLibraryCandidate(entry, value, index)).filter((entry): entry is LibraryMetadataCandidate => !!entry);
  } else if (kind === 'pmid' || kind === 'pmcid') {
    let pmid = kind === 'pmid' ? value : '';
    let pmcid = kind === 'pmcid' ? value : '';
    if (pmcid) {
      const idUrl = new URL('https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/');
      idUrl.searchParams.set('format', 'json'); idUrl.searchParams.set('tool', 'nodus'); idUrl.searchParams.set('ids', pmcid);
      const converted = await jsonRequest(idUrl, fetcher, signal) as { records?: Array<{ pmid?: string; pmcid?: string; doi?: string }> };
      const record = converted.records?.[0]; pmid = plain(record?.pmid) ?? ''; pmcid = plain(record?.pmcid) ?? pmcid;
      if (!pmid && record?.doi) {
        const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(record.doi)}`);
        const payload = await jsonRequest(url, fetcher, signal) as { message?: unknown };
        const candidate = crossrefCandidate(payload.message, 0.96);
        if (candidate) candidates = [{ ...candidate, metadata: { ...candidate.metadata, pmcid } }];
      }
    }
    if (pmid) {
      const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
      url.searchParams.set('db', 'pubmed'); url.searchParams.set('id', pmid); url.searchParams.set('retmode', 'json');
      const payload = await jsonRequest(url, fetcher, signal) as { result?: Record<string, unknown> };
      const candidate = pubmedCandidate(payload.result?.[pmid], { pmid, ...(pmcid ? { pmcid } : {}) });
      if (candidate) candidates = [candidate];
    }
  } else {
    candidates = await arxivCandidates(value, fetcher, signal);
  }
  if (!candidates.length) throw new Error(NO_METADATA);
  return candidates.map((candidate) => ({
    ...candidate,
    metadata: {
      ...candidate.metadata,
      ...(candidate.metadata.url || !candidate.sourceUrl ? {} : { url: candidate.sourceUrl }),
    },
  }));
}

export async function resolveLibraryMetadata(
  kind: LibraryReferenceKind,
  rawValue: string,
  options: { fetcher?: MetadataFetch; signal?: AbortSignal; assertPublic?: (url: string) => Promise<URL> } = {},
): Promise<LibraryMetadataLookupResult> {
  const value = identifier(kind, rawValue);
  const fetcher = options.fetcher ?? fetch;
  const candidates = kind === 'url'
    ? [await resolveUrlCandidate(value, fetcher, options.signal, { fetcher: options.fetcher, assertPublic: options.assertPublic })]
    : await resolveIdentifierCandidates(kind, value, fetcher, options.signal);
  return { kind, value, candidates, queriedAt: new Date().toISOString() };
}
