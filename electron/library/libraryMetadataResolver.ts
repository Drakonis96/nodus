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
  const timer = setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Nodus bibliographic metadata client' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontraron metadatos para ese identificador.' : `El servicio bibliográfico respondió con ${response.status}.`);
    return await response.json();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function textRequest(url: URL, fetcher: MetadataFetch, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/atom+xml', 'User-Agent': 'Nodus bibliographic metadata client' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontraron metadatos para ese identificador.' : `El servicio bibliográfico respondió con ${response.status}.`);
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
    metadata: {
      title, itemType: 'preprint', creators: authors, abstract: xmlValues(entry, 'summary')[0], date: published, year: parsedYear,
      ...(doi ? { doi } : {}), arxiv, url: `https://arxiv.org/abs/${arxiv}`,
      isbn: [], issn: [], tags: xmlValues(entry, 'category'),
    },
  };
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
  } else if (kind === 'isbn') {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('isbn', value); url.searchParams.set('limit', '5');
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,publish_year,publisher,isbn,language,subject');
    const payload = await jsonRequest(url, fetcher, options.signal) as { docs?: unknown[] };
    candidates = (payload.docs ?? []).map((entry, index) => openLibraryCandidate(entry, value, index)).filter((entry): entry is LibraryMetadataCandidate => !!entry);
  } else if (kind === 'pmid' || kind === 'pmcid') {
    let pmid = kind === 'pmid' ? value : '';
    let pmcid = kind === 'pmcid' ? value : '';
    if (pmcid) {
      const idUrl = new URL('https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/');
      idUrl.searchParams.set('format', 'json'); idUrl.searchParams.set('tool', 'nodus'); idUrl.searchParams.set('ids', pmcid);
      const converted = await jsonRequest(idUrl, fetcher, options.signal) as { records?: Array<{ pmid?: string; pmcid?: string; doi?: string }> };
      const record = converted.records?.[0]; pmid = plain(record?.pmid) ?? ''; pmcid = plain(record?.pmcid) ?? pmcid;
      if (!pmid && record?.doi) {
        const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(record.doi)}`);
        const payload = await jsonRequest(url, fetcher, options.signal) as { message?: unknown };
        const candidate = crossrefCandidate(payload.message, 0.96);
        if (candidate) candidates = [{ ...candidate, metadata: { ...candidate.metadata, pmcid } }];
      }
    }
    if (pmid) {
      const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
      url.searchParams.set('db', 'pubmed'); url.searchParams.set('id', pmid); url.searchParams.set('retmode', 'json');
      const payload = await jsonRequest(url, fetcher, options.signal) as { result?: Record<string, unknown> };
      const candidate = pubmedCandidate(payload.result?.[pmid], { pmid, ...(pmcid ? { pmcid } : {}) });
      if (candidate) candidates = [candidate];
    }
  } else {
    const url = new URL('https://export.arxiv.org/api/query'); url.searchParams.set('search_query', `id:${value}`); url.searchParams.set('max_results', '1');
    const candidate = arxivCandidate(await textRequest(url, fetcher, options.signal), value);
    if (candidate) candidates = [candidate];
  }
  if (!candidates.length) throw new Error('No se encontraron metadatos para ese identificador.');
  candidates = candidates.map((candidate) => ({
    ...candidate,
    metadata: {
      ...candidate.metadata,
      ...(candidate.metadata.url || !candidate.sourceUrl ? {} : { url: candidate.sourceUrl }),
    },
  }));
  return { kind, value, candidates, queriedAt: new Date().toISOString() };
}
