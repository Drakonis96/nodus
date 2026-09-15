// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type {
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemType,
  LibraryMetadataIdentifierKind,
} from '@shared/libraryTypes';
import { extractScholarlyPdfUrls } from './libraryFullText';

/**
 * A work described by the markup of its own landing page.
 *
 * Publishers that have no usable API still publish the record they want cited, in the
 * Highwire `citation_*` tags they emit for Google Scholar, in Dublin Core, in schema.org
 * JSON-LD or in Open Graph. Those are the same bytes, in a different shape, as the record
 * a URL import is after — reading them costs one page fetch and no credentials.
 */
export interface LibraryLandingPageRecord {
  metadata: LibraryItemMetadata;
  pdfUrls: string[];
  identifiers: Array<{ kind: LibraryMetadataIdentifierKind; value: string }>;
}

const MAX_JSON_LD_BLOCKS = 16;
const MAX_TAGS = 4_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)));
}

function clean(value: unknown, limit = 2_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = decodeEntities(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, limit) : undefined;
}

function tagAttributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i, '').replace(/\/?\s*>$/, '');
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    result.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return result;
}

function resolvedHttpUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

/** Every `<meta>` value, lower-cased by name/property, in document order. */
function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  let count = 0;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (count >= MAX_TAGS) break;
    count += 1;
    const attrs = tagAttributes(match[0]);
    const name = (attrs.get('name') ?? attrs.get('property') ?? attrs.get('itemprop') ?? '').trim().toLowerCase();
    const content = clean(attrs.get('content'), 4_000);
    if (!name || !content) continue;
    const existing = tags.get(name);
    if (existing) existing.push(content);
    else tags.set(name, [content]);
  }
  return tags;
}

/**
 * The parser cannot know which identifier a page is describing, so the order here is the
 * order of trust: a DOI names one work unambiguously, an arXiv id names a preprint, and
 * PMID/PMCID name the biomedical record of a work that may have all three.
 */
function firstIdentifier(tags: Map<string, string[]>): { kind: LibraryMetadataIdentifierKind; value: string } | undefined {
  const doi = tags.get('citation_doi')?.[0] ?? tags.get('dc.identifier')?.find((entry) => /^10\.\d{4,9}\//i.test(entry.replace(/^doi:\s*/i, '')));
  const normalizedDoi = doi?.replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim();
  if (normalizedDoi && /^10\.\d{4,9}\/\S+$/i.test(normalizedDoi)) return { kind: 'doi', value: normalizedDoi };
  const arxiv = tags.get('citation_arxiv_id')?.[0]?.replace(/^arxiv:\s*/i, '').trim();
  if (arxiv && /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(arxiv)) return { kind: 'arxiv', value: arxiv };
  const pmid = tags.get('citation_pmid')?.[0]?.trim();
  if (pmid && /^\d{1,12}$/.test(pmid)) return { kind: 'pmid', value: pmid };
  const pmcid = tags.get('citation_pmcid')?.[0]?.trim();
  if (pmcid && /^PMC\d{1,12}$/i.test(pmcid)) return { kind: 'pmcid', value: pmcid.toUpperCase() };
  return undefined;
}

function creatorsFromNames(names: string[]): LibraryCreator[] {
  return [...new Set(names.map((entry) => entry.trim()).filter(Boolean))].map((name) => {
    const inverted = /^([^,]+),\s*(.+)$/.exec(name);
    if (inverted) return { creatorType: 'author' as const, firstName: inverted[2].trim(), lastName: inverted[1].trim() };
    const parts = name.split(/\s+/);
    return parts.length > 1
      ? { creatorType: 'author' as const, firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! }
      : { creatorType: 'author' as const, name };
  });
}

/** `citation_publication_date` is usually `YYYY/MM/DD`; Dublin Core prefers `YYYY-MM-DD`. */
function normalizeDate(raw: string | undefined): { date?: string; year: number | null } {
  if (!raw) return { year: null };
  const match = /(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/.exec(raw);
  if (!match) return { year: null };
  const year = Number(match[1]);
  const date = [match[1], match[2], match[3]].filter(Boolean).map((part, index) => index === 0 ? part : part!.padStart(2, '0')).join('-');
  return { date, year };
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  let count = 0;
  const collect = (value: unknown, depth = 0) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const entry of value.slice(0, 64)) collect(entry, depth + 1); return; }
    const node = value as Record<string, unknown>;
    nodes.push(node);
    if (node['@graph']) collect(node['@graph'], depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (count >= MAX_JSON_LD_BLOCKS) break;
    count += 1;
    try { collect(JSON.parse(match[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, ''))); } catch { /* malformed JSON-LD is common; the meta tags carry the same facts */ }
  }
  return nodes;
}

const SCHOLARLY_TYPES = new Set([
  'scholarlyarticle', 'article', 'newsarticle', 'report', 'book', 'chapter', 'preprint',
  'dissertation', 'thesis', 'dataset', 'creativework', 'techarticle', 'review',
]);

function jsonLdType(node: Record<string, unknown>): string {
  const value = node['@type'];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.toLowerCase() : '';
}

function scholarlyNode(nodes: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return nodes.find((node) => SCHOLARLY_TYPES.has(jsonLdType(node)) && (node.headline ?? node.name));
}

function jsonLdCreators(value: unknown): LibraryCreator[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.slice(0, 200).flatMap((entry) => {
    if (typeof entry === 'string') return creatorsFromNames([entry]);
    if (!entry || typeof entry !== 'object') return [];
    const node = entry as Record<string, unknown>;
    const family = clean(node.familyName, 200);
    const given = clean(node.givenName, 200);
    if (family || given) return [{ creatorType: 'author' as const, ...(given ? { firstName: given } : {}), ...(family ? { lastName: family } : {}) }];
    const name = clean(node.name, 200);
    return name ? creatorsFromNames([name]) : [];
  });
}

function itemTypeFromPage(tags: Map<string, string[]>, node: Record<string, unknown> | undefined): LibraryItemType {
  const raw = jsonLdType(node ?? {});
  if (raw === 'book') return 'book';
  if (raw === 'chapter') return 'book-chapter';
  if (raw === 'dissertation' || raw === 'thesis') return 'thesis';
  if (raw === 'dataset') return 'dataset';
  if (raw === 'report') return 'report';
  if (raw === 'preprint') return 'preprint';
  if (raw === 'scholarlyarticle' || raw === 'article' || raw === 'newsarticle' || raw === 'techarticle' || raw === 'review') return 'journal-article';
  if (tags.has('citation_journal_title') || tags.has('citation_issn')) return 'journal-article';
  if (tags.has('citation_arxiv_id') || /arxiv/i.test(tags.get('citation_publisher')?.[0] ?? '')) return 'preprint';
  if (tags.has('citation_conference_title') || tags.has('citation_conference_name')) return 'conference-paper';
  if (tags.has('citation_isbn')) return 'book';
  return 'document';
}

function canonicalUrl(html: string, baseUrl: string): string | undefined {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0]);
    if ((attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
      const url = resolvedHttpUrl(attrs.get('href'), baseUrl);
      if (url) return url;
    }
  }
  return undefined;
}

/** `citation_keywords` packs every keyword into one tag, comma or semicolon separated. */
function keywords(tags: Map<string, string[]>): string[] {
  const values = [...(tags.get('citation_keywords') ?? []), ...(tags.get('keywords') ?? [])]
    .flatMap((entry) => entry.split(/[;,]\s*/))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 40);
}

/**
 * Reads the record a landing page publishes about itself.
 *
 * Nothing here judges whether the page is the right work: the reader pasted that URL, so
 * it is. A page that declares nothing scholarly still yields a record from its own
 * `<title>` and canonical link — a deliberate link is a deliberate reference — but a page
 * with no title at all returns nothing, and the caller asks for a manual entry rather than
 * inventing one.
 */
export function parseScholarlyLandingPage(html: string, baseUrl: string): LibraryLandingPageRecord | null {
  const tags = metaTags(html);
  const node = scholarlyNode(jsonLdNodes(html));
  const pick = (...names: string[]) => names.flatMap((name) => tags.get(name) ?? []).find(Boolean);
  const title = pick('citation_title', 'dc.title', 'og:title', 'twitter:title')
    ?? clean(node?.headline, 500) ?? clean(node?.name, 500)
    ?? clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 500);
  if (!title) return null;

  const authorNames = tags.get('citation_author') ?? tags.get('dc.creator') ?? [];
  const creators = authorNames.length ? creatorsFromNames(authorNames) : jsonLdCreators(node?.author);
  const { date, year } = normalizeDate(pick('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'article:published_time')
    ?? clean(node?.datePublished, 60));
  const journal = pick('citation_journal_title', 'citation_conference_title') ?? clean((node?.isPartOf as Record<string, unknown> | undefined)?.name, 300);
  const firstPage = pick('citation_firstpage'); const lastPage = pick('citation_lastpage');
  const pages = firstPage ? (lastPage && lastPage !== firstPage ? `${firstPage}-${lastPage}` : firstPage) : undefined;
  const identifier = firstIdentifier(tags);
  const url = canonicalUrl(html, baseUrl) ?? resolvedHttpUrl(baseUrl, baseUrl);

  return {
    pdfUrls: extractScholarlyPdfUrls(html, baseUrl),
    identifiers: identifier ? [identifier] : [],
    metadata: {
      title, itemType: itemTypeFromPage(tags, node), creators, date, year,
      abstract: pick('citation_abstract', 'dc.description', 'og:description', 'description'),
      language: pick('citation_language', 'dc.language', 'og:locale'),
      publisher: pick('citation_publisher', 'dc.publisher'),
      publicationTitle: journal,
      volume: pick('citation_volume'), issue: pick('citation_issue'), pages,
      ...(url ? { url } : {}),
      ...(identifier?.kind === 'doi' ? { doi: identifier.value } : {}),
      ...(identifier?.kind === 'arxiv' ? { arxiv: identifier.value } : {}),
      ...(identifier?.kind === 'pmid' ? { pmid: identifier.value } : {}),
      ...(identifier?.kind === 'pmcid' ? { pmcid: identifier.value } : {}),
      isbn: tags.get('citation_isbn') ?? [],
      issn: tags.get('citation_issn') ?? [],
      tags: keywords(tags),
    },
  };
}
