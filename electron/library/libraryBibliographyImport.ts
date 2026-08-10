import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryBibliographyImportReport,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryItemType,
} from '@shared/libraryTypes';
import { normalizeLibraryMetadata } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';

export interface ParsedBibliographicItem {
  source: Extract<LibraryItemSource, 'ris' | 'bibtex' | 'csl-json' | 'mendeley'>;
  citationKey?: string;
  metadata: LibraryItemMetadata;
}

function values(map: Map<string, string[]>, ...keys: string[]): string[] {
  return keys.flatMap((key) => map.get(key) ?? []).map((value) => value.trim()).filter(Boolean);
}

function year(value: unknown): number | null {
  const match = /(?:^|\D)(-?\d{3,4})(?:\D|$)/.exec(String(value ?? ''));
  const parsed = Number(match?.[1]);
  return Number.isInteger(parsed) && parsed > -10_000 && parsed < 10_000 ? parsed : null;
}

function itemType(value: unknown): LibraryItemType {
  const type = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['jour', 'journalarticle', 'article', 'articlejournal', 'magazinearticle', 'newspaperarticle'].includes(type)) return 'article-journal';
  if (['book', 'editedbook', 'monograph'].includes(type)) return 'book';
  if (['chap', 'booksection', 'inbook', 'incollection', 'chapter'].includes(type)) return 'chapter';
  if (['conf', 'conferencepaper', 'inproceedings', 'proceedings'].includes(type)) return 'conference-paper';
  if (['thes', 'thesis', 'phdthesis', 'mastersthesis'].includes(type)) return 'thesis';
  if (['rprt', 'report', 'techreport'].includes(type)) return 'report';
  if (['web', 'webpage', 'online', 'misc'].includes(type)) return 'webpage';
  if (type === 'dataset') return 'dataset';
  return 'document';
}

function nameCreator(name: string): LibraryCreator {
  const clean = name.trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(clean);
  return comma
    ? { creatorType: 'author', firstName: comma[2].trim(), lastName: comma[1].trim() }
    : { creatorType: 'author', name: clean };
}

function identifiers(input: string[]): { isbn: string[]; issn: string[] } {
  const isbn: string[] = []; const issn: string[] = [];
  for (const raw of input) {
    const clean = raw.toUpperCase().replace(/[^0-9X]/g, '');
    if (/^\d{7}[\dX]$/.test(clean)) issn.push(raw.trim());
    else if (/^(?:\d{9}[\dX]|\d{13})$/.test(clean)) isbn.push(raw.trim());
  }
  return { isbn: [...new Set(isbn)], issn: [...new Set(issn)] };
}

export function parseRis(text: string): ParsedBibliographicItem[] {
  const records: Array<Map<string, string[]>> = [];
  let current = new Map<string, string[]>();
  let lastTag = '';
  const flush = () => { if (current.size) records.push(current); current = new Map(); lastTag = ''; };
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^([A-Z0-9]{2})\s{0,2}-\s?(.*)$/.exec(line);
    if (match) {
      const [, tag, raw] = match;
      if (tag === 'TY' && current.size) flush();
      if (tag === 'ER') { flush(); continue; }
      current.set(tag, [...(current.get(tag) ?? []), raw.trim()]); lastTag = tag;
    } else if (lastTag && line.trim()) {
      const entries = current.get(lastTag)!; entries[entries.length - 1] = `${entries[entries.length - 1]} ${line.trim()}`;
    }
  }
  flush();
  return records.flatMap((record) => {
    const title = values(record, 'TI', 'T1', 'CT')[0];
    if (!title) return [];
    const date = values(record, 'PY', 'Y1', 'DA')[0];
    const serials = identifiers(values(record, 'SN'));
    const firstPage = values(record, 'SP')[0]; const lastPage = values(record, 'EP')[0];
    return [{ source: 'ris' as const, citationKey: values(record, 'ID')[0], metadata: normalizeLibraryMetadata({
      title, itemType: itemType(values(record, 'TY')[0]), creators: values(record, 'AU', 'A1', 'A2').map(nameCreator),
      abstract: values(record, 'AB', 'N2')[0], date, year: year(date), language: values(record, 'LA')[0],
      publisher: values(record, 'PB')[0], publicationTitle: values(record, 'JO', 'JF', 'T2')[0],
      volume: values(record, 'VL')[0], issue: values(record, 'IS')[0], pages: firstPage ? `${firstPage}${lastPage ? `-${lastPage}` : ''}` : undefined,
      place: values(record, 'CY', 'PP')[0], url: values(record, 'UR')[0], doi: values(record, 'DO')[0],
      isbn: serials.isbn, issn: serials.issn, tags: values(record, 'KW'),
    }, title) }];
  });
}

function bibEntries(text: string): Array<{ type: string; key: string; fields: Map<string, string> }> {
  const entries: Array<{ type: string; key: string; fields: Map<string, string> }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('@', cursor); if (start < 0) break;
    const header = /^@([A-Za-z]+)\s*([{(])/.exec(text.slice(start)); if (!header) { cursor = start + 1; continue; }
    const openAt = start + header[0].lastIndexOf(header[2]); const closeChar = header[2] === '{' ? '}' : ')';
    let depth = 1; let quote = false; let index = openAt + 1;
    for (; index < text.length && depth > 0; index += 1) {
      const character = text[index];
      if (character === '"' && text[index - 1] !== '\\') quote = !quote;
      if (quote) continue;
      if (character === header[2]) depth += 1; else if (character === closeChar) depth -= 1;
    }
    const body = text.slice(openAt + 1, index - 1); cursor = index;
    let split = 0; depth = 0; quote = false;
    for (; split < body.length; split += 1) { const character = body[split]; if (character === '"' && body[split - 1] !== '\\') quote = !quote; if (!quote && character === '{') depth += 1; if (!quote && character === '}') depth -= 1; if (!quote && depth === 0 && character === ',') break; }
    const key = body.slice(0, split).trim(); const fields = new Map<string, string>(); let at = split + 1;
    while (at < body.length) {
      while (/[\s,]/.test(body[at] ?? '')) at += 1;
      const name = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(at)); if (!name) break;
      at += name[0].length; while (/\s/.test(body[at] ?? '')) at += 1; if (body[at] !== '=') break; at += 1; while (/\s/.test(body[at] ?? '')) at += 1;
      let value = '';
      if (body[at] === '{') { let level = 1; const from = ++at; while (at < body.length && level) { if (body[at] === '{') level += 1; else if (body[at] === '}') level -= 1; at += 1; } value = body.slice(from, at - 1); }
      else if (body[at] === '"') { const from = ++at; while (at < body.length && (body[at] !== '"' || body[at - 1] === '\\')) at += 1; value = body.slice(from, at); at += 1; }
      else { const from = at; while (at < body.length && body[at] !== ',') at += 1; value = body.slice(from, at); }
      fields.set(name[0].toLowerCase(), value.replace(/[{}]/g, '').replace(/\\([&%_$#])/g, '$1').replace(/\s+/g, ' ').trim());
    }
    entries.push({ type: header[1], key, fields });
  }
  return entries;
}

export function parseBibtex(text: string): ParsedBibliographicItem[] {
  return bibEntries(text).flatMap((entry) => {
    const get = (...keys: string[]) => keys.map((key) => entry.fields.get(key)).find(Boolean);
    const title = get('title'); if (!title) return [];
    const authors = String(get('author') ?? '').split(/\s+and\s+/i).map(nameCreator).filter((creator) => creator.name || creator.firstName || creator.lastName);
    const rawYear = get('year', 'date');
    return [{ source: 'bibtex' as const, citationKey: entry.key || undefined, metadata: normalizeLibraryMetadata({
      title, itemType: itemType(entry.type), creators: authors, abstract: get('abstract'), date: get('date'), year: year(rawYear),
      language: get('language'), publisher: get('publisher'), publicationTitle: get('journaltitle', 'journal', 'booktitle'),
      volume: get('volume'), issue: get('number', 'issue'), pages: get('pages'), edition: get('edition'), place: get('address', 'location'),
      url: get('url'), doi: get('doi'), isbn: get('isbn')?.split(/[,;]\s*/) ?? [], issn: get('issn')?.split(/[,;]\s*/) ?? [],
      tags: get('keywords')?.split(/[,;]\s*/) ?? [],
    }, title) }];
  });
}

function cslDate(value: unknown): { date?: string; year: number | null } {
  const parts = ((value as { 'date-parts'?: unknown } | undefined)?.['date-parts'] as unknown[][] | undefined)?.[0];
  if (!Array.isArray(parts) || !parts.length) return { year: null };
  return { date: parts.map(String).join('-'), year: year(parts[0]) };
}

function cslItem(raw: unknown, source: 'csl-json' | 'mendeley'): ParsedBibliographicItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>; const title = String(item.title ?? '').trim(); if (!title) return null;
  const issued = cslDate(item.issued ?? (item.year ? { 'date-parts': [[item.year]] } : null));
  const rawAuthors = Array.isArray(item.author) ? item.author : Array.isArray(item.authors) ? item.authors : [];
  const creators = rawAuthors.flatMap((rawAuthor) => {
    if (typeof rawAuthor === 'string') return [nameCreator(rawAuthor)]; if (!rawAuthor || typeof rawAuthor !== 'object') return [];
    const author = rawAuthor as Record<string, unknown>; const firstName = String(author.given ?? author.first_name ?? '').trim(); const lastName = String(author.family ?? author.last_name ?? '').trim(); const name = String(author.literal ?? author.name ?? '').trim();
    return firstName || lastName || name ? [{ creatorType: 'author', ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(name ? { name } : {}) }] : [];
  });
  const identifiersMap = item.identifiers && typeof item.identifiers === 'object' ? item.identifiers as Record<string, unknown> : {};
  const list = (value: unknown) => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).flatMap((value) => value.split(/[,;]\s*/)).filter(Boolean);
  return { source, citationKey: String(item.id ?? item.citation_key ?? '').trim() || undefined, metadata: normalizeLibraryMetadata({
    title, itemType: itemType(item.type), creators, abstract: item.abstract, date: issued.date, year: issued.year,
    language: item.language, publisher: item.publisher, publicationTitle: item['container-title'] ?? item.source,
    volume: item.volume, issue: item.issue, pages: item.page ?? item.pages, edition: item.edition, place: item['publisher-place'] ?? item.city,
    url: item.URL ?? item.url, doi: item.DOI ?? item.doi ?? identifiersMap.doi,
    isbn: list(item.ISBN ?? item.isbn ?? identifiersMap.isbn), issn: list(item.ISSN ?? item.issn ?? identifiersMap.issn),
    tags: list(item.keyword ?? item.keywords ?? item.tags),
  }, title) };
}

export function parseCslJson(text: string): ParsedBibliographicItem[] {
  const parsed = JSON.parse(text) as unknown;
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { documents?: unknown }).documents) ? (parsed as { documents: unknown[] }).documents : [parsed];
  const mendeley = values.some((entry) => !!entry && typeof entry === 'object' && ('authors' in entry || 'identifiers' in entry || 'citation_key' in entry));
  return values.map((entry) => cslItem(entry, mendeley ? 'mendeley' : 'csl-json')).filter((entry): entry is ParsedBibliographicItem => !!entry);
}

export function parseBibliographyFile(file: string): ParsedBibliographicItem[] {
  const text = fs.readFileSync(file, 'utf8'); const extension = path.extname(file).toLowerCase();
  if (extension === '.ris') return parseRis(text);
  if (['.bib', '.bibtex'].includes(extension)) return parseBibtex(text);
  if (extension === '.json') return parseCslJson(text);
  throw new Error(`Formato bibliográfico no compatible: ${extension || path.basename(file)}`);
}

function cleanId(value: string | undefined): string {
  return String(value ?? '').toLocaleLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/[^a-z0-9]/g, '');
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function creatorIdentity(record: LibraryItemRecord): string {
  const creator = record.metadata.creators[0];
  return normalizedTitle(creator?.name || [creator?.firstName, creator?.lastName].filter(Boolean).join(' '));
}

function duplicate(existing: LibraryItemRecord[], metadata: LibraryItemMetadata): LibraryItemRecord | null {
  const doi = cleanId(metadata.doi); const isbns = new Set((metadata.isbn ?? []).map(cleanId).filter(Boolean));
  const title = normalizedTitle(metadata.title); const firstCreator = normalizedTitle(metadata.creators[0]?.name || [metadata.creators[0]?.firstName, metadata.creators[0]?.lastName].filter(Boolean).join(' '));
  return existing.find((record) => {
    if (doi && cleanId(record.metadata.doi) === doi) return true;
    if (isbns.size && (record.metadata.isbn ?? []).some((value) => isbns.has(cleanId(value)))) return true;
    return title && normalizedTitle(record.metadata.title) === title && record.metadata.year === metadata.year && creatorIdentity(record) === firstCreator;
  }) ?? null;
}

export function importBibliographyFiles(options: {
  files: string[]; collectionId?: string | null; store: LibraryDiskStore; catalog: LibraryCatalog;
}): LibraryBibliographyImportReport {
  const report: LibraryBibliographyImportReport = { created: 0, updated: 0, duplicates: 0, skipped: 0, itemIds: [], warnings: [] };
  const records = options.store.scanMaterializedItems().records;
  for (const file of options.files) {
    let entries: ParsedBibliographicItem[];
    try { entries = parseBibliographyFile(file); } catch (error) { report.skipped += 1; report.warnings.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (!entries.length) { report.skipped += 1; report.warnings.push(`${path.basename(file)} no contenía referencias reconocibles.`); continue; }
    for (const entry of entries) {
      const same = duplicate(records, entry.metadata);
      if (same) { report.duplicates += 1; report.itemIds.push(same.id); continue; }
      const uuid = randomUUID(); const id = `${entry.source}:${uuid}`;
      const created = options.store.upsertItem({
        id, storageId: id, source: entry.source, ...(entry.citationKey ? { citationKey: entry.citationKey } : {}),
        metadata: entry.metadata, collectionIds: options.collectionId ? [options.collectionId] : [], attachments: [],
        files: { annotations: 'annotations.json' }, extraction: { status: 'unsupported', error: 'Referencia sin archivo adjunto.' }, deletedAt: null,
      });
      records.push(created); report.created += 1; report.itemIds.push(created.id);
    }
  }
  if (report.created || report.updated) options.catalog.rebuild(options.store);
  return report;
}
