// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type {
  LibraryBibliographyFormat,
  LibraryCitationResult,
  LibraryCitationStyle,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
} from '@shared/libraryTypes';

function clean(value: string | undefined): string { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function ascii(value: string): string { return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ''); }
function creatorFamily(creator: LibraryCreator | undefined): string {
  return clean(creator?.lastName || creator?.name || creator?.firstName) || 'Anon';
}
function creatorNatural(creator: LibraryCreator): string {
  return clean(creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '));
}
function initials(value: string | undefined): string {
  return clean(value).split(/[\s-]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase()}.`).join(' ');
}
function creatorInverted(creator: LibraryCreator): string {
  if (creator.name) return clean(creator.name);
  return clean(`${creator.lastName ?? ''}, ${initials(creator.firstName)}`).replace(/,\s*$/, '');
}
function year(metadata: LibraryItemMetadata): string { return metadata.year == null ? 'n.d.' : String(metadata.year); }
function joinHuman(values: string[], conjunction = 'and'): string {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, ${conjunction} ${values.at(-1)}`;
}
function sentence(value: string): string { const text = clean(value); return text && !/[.!?]$/.test(text) ? `${text}.` : text; }
function container(metadata: LibraryItemMetadata): string {
  return [metadata.publicationTitle, metadata.volume, metadata.issue ? `(${metadata.issue})` : '', metadata.pages].filter(Boolean).join(', ');
}
function doiUrl(metadata: LibraryItemMetadata): string { return metadata.doi ? `https://doi.org/${metadata.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}` : clean(metadata.url); }

export function generateCitationKey(metadata: LibraryItemMetadata, used: Iterable<string> = [], preferred?: string): string {
  const occupied = new Set([...used].map((entry) => entry.toLocaleLowerCase()));
  const preferredClean = ascii(clean(preferred));
  const firstWord = clean(metadata.title).split(/\s+/).map(ascii).find((word) => word.length > 2) ?? 'item';
  const base = (preferredClean || `${ascii(creatorFamily(metadata.creators[0]))}${firstWord}${metadata.year ?? 'nd'}`).slice(0, 120) || 'item';
  if (!occupied.has(base.toLocaleLowerCase())) return base;
  for (let index = 0; index < 26; index += 1) {
    const candidate = `${base}${String.fromCharCode(97 + index)}`;
    if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
  }
  let index = 2; while (occupied.has(`${base}${index}`.toLocaleLowerCase())) index += 1;
  return `${base}${index}`;
}

function authorLead(metadata: LibraryItemMetadata): string {
  const families = metadata.creators.filter((entry) => entry.creatorType === 'author').map((entry) => creatorFamily(entry));
  if (!families.length) return clean(metadata.title).split(/\s+/).slice(0, 3).join(' ');
  if (families.length === 1) return families[0];
  if (families.length === 2) return `${families[0]} & ${families[1]}`;
  return `${families[0]} et al.`;
}

export function formatLibraryCitation(records: LibraryItemRecord[], style: LibraryCitationStyle, kind: 'citation' | 'bibliography'): LibraryCitationResult {
  const entries = records.map((record, index) => {
    const metadata = record.metadata; const authors = metadata.creators.filter((entry) => entry.creatorType === 'author');
    if (kind === 'citation') {
      if (style === 'ieee') return `[${index + 1}]`;
      if (style === 'vancouver') return `(${index + 1})`;
      if (style === 'mla-9') return `(${authorLead(metadata)}${metadata.pages ? ` ${metadata.pages.split('-')[0]}` : ''})`;
      return `(${authorLead(metadata)}, ${year(metadata)})`;
    }
    const title = clean(metadata.title); const publication = clean(metadata.publicationTitle); const link = doiUrl(metadata);
    if (style === 'apa-7') {
      const names = joinHuman(authors.map(creatorInverted), '&');
      return [names ? `${names} (${year(metadata)}).` : `(${year(metadata)}).`, sentence(title), sentence(container(metadata)), link].filter(Boolean).join(' ');
    }
    if (style === 'chicago-author-date') {
      const names = joinHuman(authors.map((author, authorIndex) => authorIndex ? creatorNatural(author) : creatorInverted(author)));
      return [names ? `${names}.` : '', `${year(metadata)}.`, `“${title}.”`, publication ? `${publication}${metadata.volume ? ` ${metadata.volume}` : ''}${metadata.issue ? `, no. ${metadata.issue}` : ''}${metadata.pages ? `: ${metadata.pages}` : ''}.` : '', link].filter(Boolean).join(' ');
    }
    if (style === 'mla-9') {
      const names = joinHuman(authors.map((author, authorIndex) => authorIndex ? creatorNatural(author) : creatorInverted(author)));
      return [names ? `${names}.` : '', `“${title}.”`, publication ? `${publication},` : '', metadata.volume ? `vol. ${metadata.volume},` : '', metadata.issue ? `no. ${metadata.issue},` : '', `${year(metadata)},`, metadata.pages ? `pp. ${metadata.pages}.` : '', link].filter(Boolean).join(' ').replace(/,\s*\./g, '.');
    }
    const initialsFirst = authors.map((author) => author.name || clean(`${initials(author.firstName)} ${author.lastName ?? ''}`));
    if (style === 'ieee') return [`[${index + 1}]`, initialsFirst.join(', '), `“${title},”`, publication ? `${publication},` : '', metadata.volume ? `vol. ${metadata.volume},` : '', metadata.issue ? `no. ${metadata.issue},` : '', metadata.pages ? `pp. ${metadata.pages},` : '', `${year(metadata)}.`, link].filter(Boolean).join(' ');
    return [`${index + 1}.`, initialsFirst.join(', '), sentence(title), publication ? `${publication}.` : '', `${year(metadata)}${metadata.volume ? `;${metadata.volume}` : ''}${metadata.issue ? `(${metadata.issue})` : ''}${metadata.pages ? `:${metadata.pages}` : ''}.`, link].filter(Boolean).join(' ');
  });
  return { style, kind, itemIds: records.map((record) => record.id), text: entries.join(kind === 'citation' ? '; ' : '\n') };
}

function xml(value: unknown): string { return clean(String(value ?? '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function bib(value: unknown): string { return clean(String(value ?? '')).replace(/[{}]/g, '').replace(/([&%_$#])/g, '\\$1'); }
function csv(value: unknown): string { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function yaml(value: unknown): string { return JSON.stringify(clean(String(value ?? ''))); }
function typeForRis(metadata: LibraryItemMetadata): string { return metadata.itemType === 'book' ? 'BOOK' : ['chapter', 'book-section'].includes(metadata.itemType) ? 'CHAP' : metadata.itemType === 'thesis' ? 'THES' : metadata.itemType === 'report' ? 'RPRT' : 'JOUR'; }
function typeForBib(metadata: LibraryItemMetadata): string { return metadata.itemType === 'book' ? 'book' : ['chapter', 'book-section'].includes(metadata.itemType) ? 'incollection' : metadata.itemType === 'thesis' ? 'phdthesis' : metadata.itemType === 'conference-paper' ? 'inproceedings' : 'article'; }
function authors(metadata: LibraryItemMetadata): string { return metadata.creators.filter((entry) => entry.creatorType === 'author').map((entry) => entry.name || `${entry.lastName ?? ''}, ${entry.firstName ?? ''}`.replace(/,\s*$/, '')).join(' and '); }
function key(record: LibraryItemRecord): string { return record.citationKey || generateCitationKey(record.metadata); }

function cslRecord(record: LibraryItemRecord): Record<string, unknown> {
  const metadata = record.metadata;
  return {
    id: key(record), type: metadata.itemType, title: metadata.title,
    author: metadata.creators.filter((entry) => entry.creatorType === 'author').map((entry) => entry.name ? { literal: entry.name } : { given: entry.firstName, family: entry.lastName }),
    ...(metadata.year != null ? { issued: { 'date-parts': [[metadata.year]] } } : {}),
    ...(metadata.abstract ? { abstract: metadata.abstract } : {}), ...(metadata.publicationTitle ? { 'container-title': metadata.publicationTitle } : {}),
    ...(metadata.publisher ? { publisher: metadata.publisher } : {}), ...(metadata.volume ? { volume: metadata.volume } : {}),
    ...(metadata.issue ? { issue: metadata.issue } : {}), ...(metadata.pages ? { page: metadata.pages } : {}),
    ...(metadata.doi ? { DOI: metadata.doi } : {}), ...(metadata.isbn?.length ? { ISBN: metadata.isbn } : {}),
    ...(metadata.issn?.length ? { ISSN: metadata.issn } : {}), ...(metadata.url ? { URL: metadata.url } : {}),
    ...(metadata.pmid ? { PMID: metadata.pmid } : {}), ...(metadata.pmcid ? { PMCID: metadata.pmcid } : {}), ...(metadata.arxiv ? { arXiv: metadata.arxiv } : {}),
    ...(metadata.tags?.length ? { keyword: metadata.tags.join('; ') } : {}),
    ...Object.fromEntries(Object.entries(metadata.extra ?? {}).map(([extraKey, value]) => [extraKey.replace(/^csl:/, ''), value])),
  };
}

export function exportLibraryBibliography(records: LibraryItemRecord[], format: LibraryBibliographyFormat): string {
  const stable = [...records].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
  if (format === 'csl-json') return `${JSON.stringify(stable.map(cslRecord), null, 2)}\n`;
  if (format === 'ris') return `${stable.map((record) => {
    const metadata = record.metadata; const lines = [`TY  - ${typeForRis(metadata)}`, `ID  - ${key(record)}`, `TI  - ${metadata.title}`];
    for (const creator of metadata.creators.filter((entry) => entry.creatorType === 'author')) lines.push(`AU  - ${creator.name || `${creator.lastName ?? ''}, ${creator.firstName ?? ''}`.trim()}`);
    if (metadata.year != null) lines.push(`PY  - ${metadata.year}`); if (metadata.abstract) lines.push(`AB  - ${metadata.abstract}`); if (metadata.publicationTitle) lines.push(`JO  - ${metadata.publicationTitle}`);
    if (metadata.publisher) lines.push(`PB  - ${metadata.publisher}`); if (metadata.volume) lines.push(`VL  - ${metadata.volume}`); if (metadata.issue) lines.push(`IS  - ${metadata.issue}`);
    if (metadata.pages) { const [start, end] = metadata.pages.split('-'); lines.push(`SP  - ${start}`); if (end) lines.push(`EP  - ${end}`); }
    if (metadata.doi) lines.push(`DO  - ${metadata.doi}`); for (const serial of [...(metadata.isbn ?? []), ...(metadata.issn ?? [])]) lines.push(`SN  - ${serial}`);
    if (metadata.url) lines.push(`UR  - ${metadata.url}`); for (const tag of metadata.tags ?? []) lines.push(`KW  - ${tag}`);
    for (const [extraKey, value] of Object.entries(metadata.extra ?? {})) if (/^ris:[A-Z0-9]{2}$/i.test(extraKey)) for (const line of value.split('\n')) lines.push(`${extraKey.slice(4).toUpperCase()}  - ${line}`);
    lines.push('ER  -'); return lines.join('\n');
  }).join('\n\n')}\n`;
  if (format === 'bibtex' || format === 'biblatex') return `${stable.map((record) => {
    const metadata = record.metadata; const fields: Array<[string, unknown]> = [['title', metadata.title], ['author', authors(metadata)], ['year', metadata.year], [format === 'biblatex' ? 'journaltitle' : 'journal', metadata.publicationTitle], ['publisher', metadata.publisher], ['volume', metadata.volume], ['number', metadata.issue], ['pages', metadata.pages], ['doi', metadata.doi], ['isbn', metadata.isbn?.join(', ')], ['issn', metadata.issn?.join(', ')], ['url', metadata.url], ['abstract', metadata.abstract], ['keywords', metadata.tags?.join('; ')]];
    const prefix = `${format}:`; for (const [extraKey, value] of Object.entries(metadata.extra ?? {})) if (extraKey.startsWith(prefix)) fields.push([extraKey.slice(prefix.length), value]);
    return `@${typeForBib(metadata)}{${key(record)},\n${fields.filter(([, value]) => value != null && String(value).trim()).map(([name, value]) => `  ${name} = {${bib(value)}}`).join(',\n')}\n}`;
  }).join('\n\n')}\n`;
  if (format === 'csv') {
    const base = ['citationKey', 'type', 'title', 'authors', 'year', 'date', 'abstract', 'publicationTitle', 'publisher', 'volume', 'issue', 'pages', 'doi', 'isbn', 'issn', 'url', 'language', 'tags', 'pmid', 'pmcid', 'arxiv'];
    const extra = [...new Set(stable.flatMap((record) => Object.keys(record.metadata.extra ?? {})))].sort(); const headers = [...base, ...extra.map((name) => `extra.${name}`)];
    const rows = stable.map((record) => { const metadata = record.metadata; const values: Record<string, unknown> = { citationKey: key(record), type: metadata.itemType, title: metadata.title, authors: metadata.creators.map(creatorNatural).join('; '), year: metadata.year, date: metadata.date, abstract: metadata.abstract, publicationTitle: metadata.publicationTitle, publisher: metadata.publisher, volume: metadata.volume, issue: metadata.issue, pages: metadata.pages, doi: metadata.doi, isbn: metadata.isbn?.join('; '), issn: metadata.issn?.join('; '), url: metadata.url, language: metadata.language, tags: metadata.tags?.join('; '), pmid: metadata.pmid, pmcid: metadata.pmcid, arxiv: metadata.arxiv }; for (const name of extra) values[`extra.${name}`] = metadata.extra?.[name]; return headers.map((header) => csv(values[header])).join(','); });
    return `${[headers.map(csv).join(','), ...rows].join('\n')}\n`;
  }
  if (format === 'markdown') return `${stable.map((record) => { const metadata = record.metadata; const fields: Array<[string, unknown]> = [['citationKey', key(record)], ['type', metadata.itemType], ['title', metadata.title], ['authors', metadata.creators.map(creatorNatural).join('; ')], ['year', metadata.year], ['date', metadata.date], ['abstract', metadata.abstract], ['publication', metadata.publicationTitle], ['publisher', metadata.publisher], ['volume', metadata.volume], ['issue', metadata.issue], ['pages', metadata.pages], ['doi', metadata.doi], ['isbn', metadata.isbn?.join('; ')], ['issn', metadata.issn?.join('; ')], ['url', metadata.url], ['language', metadata.language], ['tags', metadata.tags?.join('; ')], ['pmid', metadata.pmid], ['pmcid', metadata.pmcid], ['arxiv', metadata.arxiv], ...Object.entries(metadata.extra ?? {}).map(([name, value]) => [`extra.${name}`, value] as [string, string])]; return `---\n${fields.filter(([, value]) => value != null && String(value).trim()).map(([name, value]) => `${name}: ${yaml(value)}`).join('\n')}\n---\n\n# ${metadata.title}`; }).join('\n\n')}\n`;
  if (format === 'endnote-xml') return `<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>\n${stable.map((record) => { const metadata = record.metadata; return `<record><rec-number>${xml(key(record))}</rec-number><ref-type name="${xml(metadata.itemType)}"/><contributors><authors>${metadata.creators.filter((entry) => entry.creatorType === 'author').map((entry) => `<author>${xml(entry.name || `${entry.lastName ?? ''}, ${entry.firstName ?? ''}`)}</author>`).join('')}</authors></contributors><titles><title>${xml(metadata.title)}</title>${metadata.publicationTitle ? `<secondary-title>${xml(metadata.publicationTitle)}</secondary-title>` : ''}</titles><dates>${metadata.year != null ? `<year>${metadata.year}</year>` : ''}</dates>${metadata.publisher ? `<publisher>${xml(metadata.publisher)}</publisher>` : ''}${metadata.volume ? `<volume>${xml(metadata.volume)}</volume>` : ''}${metadata.issue ? `<number>${xml(metadata.issue)}</number>` : ''}${metadata.pages ? `<pages>${xml(metadata.pages)}</pages>` : ''}${metadata.abstract ? `<abstract>${xml(metadata.abstract)}</abstract>` : ''}${metadata.doi ? `<electronic-resource-num>${xml(metadata.doi)}</electronic-resource-num>` : ''}${[...(metadata.isbn ?? []), ...(metadata.issn ?? [])].map((value) => `<isbn>${xml(value)}</isbn>`).join('')}${metadata.url ? `<urls><related-urls><url>${xml(metadata.url)}</url></related-urls></urls>` : ''}<keywords>${(metadata.tags ?? []).map((tag) => `<keyword>${xml(tag)}</keyword>`).join('')}</keywords>${Object.entries(metadata.extra ?? {}).filter(([name]) => name.startsWith('endnote:')).map(([name, value]) => `<${name.slice(8)}>${xml(value)}</${name.slice(8)}>`).join('')}</record>`; }).join('\n')}\n</records></xml>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:z="http://www.zotero.org/namespaces/export#" xmlns:bib="http://purl.org/net/biblio#" xmlns:prism="http://prismstandard.org/namespaces/1.2/basic/">\n${stable.map((record) => { const metadata = record.metadata; const extra = Object.entries(metadata.extra ?? {}).filter(([name]) => name.startsWith('zotero-rdf:')).flatMap(([name, value]) => { const tag = name.slice(11); return /^[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*$/.test(tag) ? [`<${tag}>${xml(value)}</${tag}>`] : []; }).join(''); return `<bib:Article rdf:about="urn:nodus:${xml(key(record))}"><z:itemType>${xml(metadata.itemType)}</z:itemType><dc:title>${xml(metadata.title)}</dc:title>${metadata.creators.filter((entry) => entry.creatorType === 'author').map((entry) => `<dc:creator>${xml(creatorNatural(entry))}</dc:creator>`).join('')}${metadata.date || metadata.year != null ? `<dc:date>${xml(metadata.date ?? metadata.year)}</dc:date>` : ''}${metadata.publisher ? `<dc:publisher>${xml(metadata.publisher)}</dc:publisher>` : ''}${metadata.abstract ? `<dc:description>${xml(metadata.abstract)}</dc:description>` : ''}${metadata.doi ? `<dc:identifier>doi:${xml(metadata.doi)}</dc:identifier>` : ''}${[...(metadata.isbn ?? []), ...(metadata.issn ?? [])].map((value) => `<dc:identifier>${xml(value)}</dc:identifier>`).join('')}${metadata.url ? `<dc:identifier>${xml(metadata.url)}</dc:identifier>` : ''}${(metadata.tags ?? []).map((tag) => `<dc:subject>${xml(tag)}</dc:subject>`).join('')}${metadata.publicationTitle ? `<prism:publicationName>${xml(metadata.publicationTitle)}</prism:publicationName>` : ''}${extra}</bib:Article>`; }).join('\n')}\n</rdf:RDF>\n`;
}
