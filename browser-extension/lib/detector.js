// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

const FILE_TYPES = {
  pdf: ['application/pdf', 'document'], epub: ['application/epub+zip', 'book'],
  doc: ['application/msword', 'document'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
  odt: ['application/vnd.oasis.opendocument.text', 'document'], rtf: ['application/rtf', 'document'],
  txt: ['text/plain', 'document'], md: ['text/markdown', 'document'], html: ['text/html', 'webpage'], htm: ['text/html', 'webpage'],
  xml: ['application/xml', 'document'], jats: ['application/xml', 'journal-article'],
  csv: ['text/csv', 'dataset'], tsv: ['text/tab-separated-values', 'dataset'], xls: ['application/vnd.ms-excel', 'dataset'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'dataset'], ods: ['application/vnd.oasis.opendocument.spreadsheet', 'dataset'],
  ppt: ['application/vnd.ms-powerpoint', 'presentation'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
  png: ['image/png', 'artwork'], jpg: ['image/jpeg', 'artwork'], jpeg: ['image/jpeg', 'artwork'], webp: ['image/webp', 'artwork'],
  gif: ['image/gif', 'artwork'], tif: ['image/tiff', 'artwork'], tiff: ['image/tiff', 'artwork'], svg: ['image/svg+xml', 'artwork'],
  mp3: ['audio/mpeg', 'audio-recording'], m4a: ['audio/mp4', 'audio-recording'], wav: ['audio/wav', 'audio-recording'],
  ogg: ['audio/ogg', 'audio-recording'], flac: ['audio/flac', 'audio-recording'], mp4: ['video/mp4', 'video-recording'], webm: ['video/webm', 'video-recording'],
};

const SCHEMA_TYPES = {
  scholarlyarticle: 'journal-article', medicalscholarlyarticle: 'journal-article', article: 'journal-article',
  newsarticle: 'newspaper-article', blogposting: 'blog-post', book: 'book', chapter: 'book-chapter',
  thesis: 'thesis', report: 'report', dataset: 'dataset', softwareapplication: 'computer-program',
  presentationdigitaldocument: 'presentation', movie: 'film', videoobject: 'video-recording', audioobject: 'audio-recording',
  podcastseries: 'podcast', podcastepisode: 'podcast', visualartwork: 'artwork', map: 'map', webpage: 'webpage',
};

function clean(value, limit = 10000) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function values(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value]).flatMap((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return clean(String(entry)) ? [clean(String(entry))] : [];
    if (entry && typeof entry === 'object') return values(entry.name || entry.value || entry['@value']);
    return [];
  });
}

function creator(value, role = 'author') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = clean(value.name);
    const firstName = clean(value.givenName || value.firstName);
    const lastName = clean(value.familyName || value.lastName);
    if (firstName || lastName) return { creatorType: role, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), fieldMode: 0 };
    if (name) return creator(name, role);
  }
  const name = clean(value);
  if (!name) return null;
  const comma = /^([^,]+),\s*(.+)$/.exec(name);
  if (comma) return { creatorType: role, firstName: comma[2], lastName: comma[1], fieldMode: 0 };
  const parts = name.split(/\s+/);
  if (parts.length > 1) return { creatorType: role, firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1), fieldMode: 0 };
  return { creatorType: role, name, fieldMode: 1 };
}

function yearFrom(value) {
  const match = /(?:^|\D)(1[0-9]{3}|20[0-9]{2}|2100)(?:\D|$)/.exec(clean(value, 200));
  return match ? Number(match[1]) : null;
}

function metaMap(snapshot) {
  const map = new Map();
  for (const meta of snapshot.metas || []) {
    const key = clean(meta.name || meta.property || meta.httpEquiv, 200).toLowerCase();
    const value = clean(meta.content, 100000);
    if (key && value) map.set(key, [...(map.get(key) || []), value]);
  }
  return map;
}

function first(map, ...keys) {
  for (const key of keys) {
    const value = map.get(key.toLowerCase())?.[0];
    if (value) return value;
  }
  return '';
}

function all(map, ...keys) {
  return [...new Set(keys.flatMap((key) => map.get(key.toLowerCase()) || []).map((entry) => clean(entry)).filter(Boolean))];
}

function absoluteUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function fileInfo(url, contentType) {
  let extension = '';
  try { extension = /\.([a-z0-9]{1,8})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() || ''; } catch { /* invalid */ }
  if (FILE_TYPES[extension]) return { extension, mimeType: FILE_TYPES[extension][0], itemType: FILE_TYPES[extension][1] };
  const mime = clean(contentType, 200).toLowerCase().split(';')[0];
  const match = Object.entries(FILE_TYPES).find(([, info]) => info[0] === mime);
  return match ? { extension: match[0], mimeType: mime, itemType: match[1][1] } : null;
}

function doiValue(raw) {
  const match = /(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i.exec(clean(raw, 2000));
  return match ? match[1].replace(/[.,;)]+$/g, '') : '';
}

function isbnValues(raw) {
  const matches = clean(raw, 2000).match(/(?:97[89][\d\s-]{10,16}|[\dX][\dX\s-]{8,16}[\dX])/gi) || [];
  return [...new Set(matches.map((entry) => entry.toUpperCase().replace(/[^0-9X]/g, '')).filter((entry) => entry.length === 10 || entry.length === 13))];
}

function schemaEntities(snapshot) {
  const result = [];
  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    if (typeof value !== 'object') return;
    if (value['@type']) result.push(value);
    if (value['@graph']) visit(value['@graph'], depth + 1);
    for (const key of ['mainEntity', 'mainEntityOfPage', 'subjectOf', 'hasPart']) if (value[key] && typeof value[key] === 'object') visit(value[key], depth + 1);
  };
  for (const raw of snapshot.jsonLd || []) {
    try { visit(JSON.parse(raw)); } catch { /* malformed publisher JSON-LD */ }
  }
  return result;
}

function schemaType(entity) {
  const types = values(entity?.['@type']).map((value) => value.toLowerCase().replace(/[^a-z]/g, ''));
  for (const type of types) if (SCHEMA_TYPES[type]) return SCHEMA_TYPES[type];
  return 'document';
}

function fromJsonLd(snapshot) {
  const entities = schemaEntities(snapshot).map((entity) => {
    const title = clean(entity.headline || entity.name);
    const itemType = schemaType(entity);
    const score = (title ? 4 : 0) + (itemType !== 'document' ? 3 : 0) + (entity.author ? 2 : 0) + (entity.identifier || entity.isbn ? 1 : 0);
    return { entity, title, itemType, score };
  }).filter((entry) => entry.title).sort((a, b) => b.score - a.score);
  const best = entities[0];
  if (!best || best.score < 5) return null;
  const entity = best.entity;
  const date = clean(entity.datePublished || entity.dateCreated);
  const identifiers = values(entity.identifier);
  const doi = doiValue([entity.doi, ...identifiers].filter(Boolean).join(' '));
  const isbns = [...new Set([...values(entity.isbn), ...identifiers.flatMap(isbnValues)])];
  const container = entity.isPartOf && typeof entity.isPartOf === 'object' ? clean(entity.isPartOf.name || entity.isPartOf.headline) : '';
  const publisher = entity.publisher && typeof entity.publisher === 'object' ? clean(entity.publisher.name) : clean(entity.publisher);
  const authors = (Array.isArray(entity.author) ? entity.author : entity.author ? [entity.author] : []).map((entry) => creator(entry)).filter(Boolean);
  const editors = (Array.isArray(entity.editor) ? entity.editor : entity.editor ? [entity.editor] : []).map((entry) => creator(entry, 'editor')).filter(Boolean);
  return {
    source: 'json-ld',
    metadata: {
      title: best.title, itemType: best.itemType, creators: [...authors, ...editors], abstract: clean(entity.abstract || entity.description, 500000),
      date, year: yearFrom(date), language: clean(entity.inLanguage), publisher, publicationTitle: container,
      volume: clean(entity.volumeNumber), issue: clean(entity.issueNumber), pages: clean(entity.pagination || entity.pageStart),
      edition: clean(entity.bookEdition), url: absoluteUrl(clean(entity.url || entity.mainEntityOfPage?.['@id']), snapshot.url) || snapshot.url,
      doi, isbn: isbns, issn: values(entity.issn), tags: values(entity.keywords).flatMap((entry) => entry.split(/[,;]\s*/)).filter(Boolean),
    },
  };
}

function fromHighwire(snapshot, map) {
  const title = first(map, 'citation_title', 'eprints.title', 'bepress_citation_title');
  if (!title) return null;
  const date = first(map, 'citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date');
  const firstPage = first(map, 'citation_firstpage');
  const lastPage = first(map, 'citation_lastpage');
  const typeHint = first(map, 'citation_dissertation_institution') ? 'thesis' : first(map, 'citation_conference_title') ? 'conference-paper' : first(map, 'citation_isbn') && !first(map, 'citation_journal_title') ? 'book' : 'journal-article';
  return {
    source: 'highwire',
    metadata: {
      title, itemType: typeHint, creators: all(map, 'citation_author', 'eprints.creators_name').map((entry) => creator(entry)).filter(Boolean),
      abstract: first(map, 'citation_abstract', 'dc.description'), date, year: yearFrom(date),
      language: first(map, 'citation_language', 'dc.language'), publisher: first(map, 'citation_publisher'),
      publicationTitle: first(map, 'citation_journal_title', 'citation_conference_title'), volume: first(map, 'citation_volume'),
      issue: first(map, 'citation_issue'), pages: firstPage && lastPage ? `${firstPage}-${lastPage}` : firstPage,
      url: first(map, 'citation_public_url', 'citation_abstract_html_url') || snapshot.url,
      doi: doiValue(first(map, 'citation_doi', 'dc.identifier')), isbn: isbnValues(first(map, 'citation_isbn')),
      issn: all(map, 'citation_issn'), tags: all(map, 'citation_keywords', 'keywords').flatMap((entry) => entry.split(/[,;]\s*/)).filter(Boolean),
    },
  };
}

function parseCoins(snapshot) {
  const raw = snapshot.coins?.[0];
  if (!raw) return null;
  const params = new URLSearchParams(raw.replace(/&amp;/g, '&'));
  const get = (key) => clean(params.get(key));
  const genre = get('rft.genre').toLowerCase();
  const itemType = genre.includes('bookitem') ? 'book-chapter' : genre.includes('book') ? 'book' : genre.includes('conference') ? 'conference-paper' : 'journal-article';
  const title = get('rft.atitle') || get('rft.btitle') || get('rft.title');
  if (!title) return null;
  const authors = params.getAll('rft.au').map((entry) => creator(entry)).filter(Boolean);
  if (!authors.length && (get('rft.aulast') || get('rft.aufirst'))) authors.push({ creatorType: 'author', firstName: get('rft.aufirst'), lastName: get('rft.aulast'), fieldMode: 0 });
  const date = get('rft.date');
  return { source: 'coins', metadata: { title, itemType, creators: authors, date, year: yearFrom(date), publicationTitle: get('rft.jtitle'), publisher: get('rft.pub'), volume: get('rft.volume'), issue: get('rft.issue'), pages: get('rft.pages') || get('rft.spage'), doi: doiValue(params.getAll('rft_id').join(' ')), isbn: isbnValues(get('rft.isbn')), issn: values(get('rft.issn')), url: snapshot.url, tags: [] } };
}

function fromDublinCore(snapshot, map) {
  const title = first(map, 'dc.title', 'dcterms.title');
  if (!title) return null;
  const date = first(map, 'dc.date', 'dcterms.issued', 'dcterms.created');
  const rawType = first(map, 'dc.type', 'dcterms.type').toLowerCase();
  const itemType = rawType.includes('book') ? 'book' : rawType.includes('article') ? 'journal-article' : rawType.includes('thesis') ? 'thesis' : rawType.includes('dataset') ? 'dataset' : 'document';
  const identifiers = all(map, 'dc.identifier', 'dcterms.identifier');
  return { source: 'dublin-core', metadata: { title, itemType, creators: all(map, 'dc.creator', 'dcterms.creator').map((entry) => creator(entry)).filter(Boolean), abstract: first(map, 'dc.description', 'dcterms.abstract'), date, year: yearFrom(date), language: first(map, 'dc.language', 'dcterms.language'), publisher: first(map, 'dc.publisher', 'dcterms.publisher'), url: snapshot.url, doi: doiValue(identifiers.join(' ')), isbn: identifiers.flatMap(isbnValues), issn: [], tags: all(map, 'dc.subject', 'dcterms.subject'), } };
}

function fromOpenGraph(snapshot, map) {
  const title = first(map, 'og:title', 'twitter:title') || snapshot.title;
  const date = first(map, 'article:published_time');
  const kind = first(map, 'og:type').toLowerCase();
  return { source: title !== snapshot.title ? 'open-graph' : 'generic', metadata: { title: clean(title) || 'Untitled web page', itemType: kind.includes('article') ? 'webpage' : 'webpage', creators: first(map, 'author', 'article:author') ? [creator(first(map, 'author', 'article:author'))].filter(Boolean) : [], abstract: first(map, 'og:description', 'description', 'twitter:description'), date, year: yearFrom(date), language: snapshot.lang, url: first(map, 'og:url') || snapshot.url, doi: doiValue(snapshot.url), isbn: [], issn: [], tags: all(map, 'article:tag', 'keywords').flatMap((entry) => entry.split(/[,;]\s*/)).filter(Boolean) } };
}

function attachments(snapshot, map, direct) {
  const candidates = [];
  const add = (raw, title, mimeType, role = 'supplement', resolveFullText = false) => {
    const url = absoluteUrl(raw, snapshot.url);
    if (!url) return;
    const info = fileInfo(url, mimeType);
    if ((!info || info.itemType === 'webpage') && !resolveFullText) return;
    let fileName = '';
    try { fileName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'document'); } catch { fileName = 'document'; }
    if (resolveFullText && !/\.pdf$/i.test(fileName)) fileName = 'full-text.pdf';
    const resolvedMime = mimeType || info?.mimeType || (resolveFullText ? 'application/pdf' : 'application/octet-stream');
    candidates.push({
      url, title: title || (resolvedMime === 'application/pdf' ? 'Full text PDF' : fileName),
      fileName, mimeType: resolvedMime, role, ...(resolveFullText ? { resolveFullText: true } : {}),
    });
  };
  if (direct) add(snapshot.url, snapshot.title || 'Original document', direct.mimeType, 'original');
  for (const url of all(map, 'citation_pdf_url', 'eprints.document_url', 'bepress_citation_pdf_url')) add(url, 'Full text PDF', 'application/pdf', direct ? 'supplement' : 'original');
  for (const link of snapshot.links || []) {
    const rel = clean(link.rel, 200).toLowerCase();
    const type = clean(link.type, 200).toLowerCase();
    if (type === 'application/pdf' || /(?:alternate|enclosure)/.test(rel) && fileInfo(link.href, type)) add(link.href, clean(link.title) || 'Full text', type, candidates.length ? 'supplement' : 'original');
  }
  const fullTextPattern = /(?:\bpdf\b|full\s*text|texto\s+completo|texte\s+int[ée]gral|volltext|testo\s+completo|texto\s+integral|tam\s+metin|descargar\s+(?:art[ií]culo|pdf)|download\s+(?:article|paper|pdf))/i;
  for (const anchor of snapshot.anchors || []) {
    const info = fileInfo(anchor.href, clean(anchor.type));
    const title = clean(anchor.text) || clean(anchor.title);
    const resolvesFullText = !info && fullTextPattern.test(`${anchor.text || ''} ${anchor.title || ''}`);
    add(anchor.href, resolvesFullText ? 'Full text PDF' : title, resolvesFullText ? 'application/pdf' : clean(anchor.type), candidates.length ? 'supplement' : 'original', resolvesFullText);
  }
  return [...new Map(candidates.map((entry) => [entry.url, entry])).values()].slice(0, 8);
}

export function detectCapture(snapshot) {
  if (!snapshot || !absoluteUrl(snapshot.url, snapshot.url)) throw new Error('This page cannot be captured.');
  const map = metaMap(snapshot);
  const direct = fileInfo(snapshot.url, snapshot.contentType);
  const directDocument = direct && direct.itemType !== 'webpage' ? direct : null;
  let detected;
  if (directDocument) {
    let fileName = '';
    try { fileName = decodeURIComponent(new URL(snapshot.url).pathname.split('/').filter(Boolean).at(-1) || snapshot.title || 'Document'); } catch { fileName = snapshot.title || 'Document'; }
    detected = { source: 'direct-file', metadata: { title: clean(snapshot.title) && !/^pdf\.js$/i.test(snapshot.title) ? clean(snapshot.title) : fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), itemType: directDocument.itemType, creators: [], year: null, language: snapshot.lang, url: snapshot.url, doi: doiValue(snapshot.url), isbn: isbnValues(snapshot.url), issn: [], tags: [] } };
  } else {
    detected = fromHighwire(snapshot, map) || fromJsonLd(snapshot) || parseCoins(snapshot) || fromDublinCore(snapshot, map) || fromOpenGraph(snapshot, map);
  }
  const metadata = detected.metadata;
  metadata.title = clean(metadata.title) || clean(snapshot.title) || 'Untitled document';
  metadata.creators = (metadata.creators || []).filter(Boolean);
  metadata.year = metadata.year || yearFrom(metadata.date);
  metadata.isbn = [...new Set(metadata.isbn || [])];
  metadata.issn = [...new Set(metadata.issn || [])];
  metadata.tags = [...new Set(metadata.tags || [])].slice(0, 64);
  metadata.extra = { ...(metadata.extra || {}), 'Browser capture source': detected.source, 'Captured from': snapshot.url };
  return {
    pageUrl: snapshot.url,
    metadataSource: detected.source,
    metadata,
    attachments: attachments(snapshot, map, directDocument),
    snapshotAvailable: !directDocument && Boolean(snapshot.html),
    snapshotHtml: !directDocument ? snapshot.html || '' : '',
  };
}

export const DETECTED_ITEM_TYPES = [...new Set(Object.values(SCHEMA_TYPES).concat(Object.values(FILE_TYPES).map((entry) => entry[1]), ['document', 'other']))];
