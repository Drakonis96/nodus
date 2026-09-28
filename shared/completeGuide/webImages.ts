/**
 * Optional web images for a complete study guide ("Imágenes de la web", off by
 * default). Materials come first: a chapter gets at most one web image, and only for
 * a core concept that has no figure from the student's own materials. An image is
 * used only when its free licence and author are confirmed by Wikimedia Commons,
 * and its caption carries that attribution, generated here from data.
 */
import type { CompleteGuideItem } from './items';

export interface CompleteGuideWebImageRequest {
  itemId: string;
  unitKey: string;
  /** Search terms: the concept as the guide names it. */
  query: string;
  caption: string;
}

export interface CompleteGuideWebImageAttribution {
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  /** The file's description page (where the licence is stated). */
  url: string;
  site: string;
}

export const COMPLETE_GUIDE_WEB_IMAGES_PER_CHAPTER = 1;
export const COMPLETE_GUIDE_WEB_IMAGES_TOTAL = 6;
const IMAGE_ITEM_TYPES = new Set(['figure', 'concept', 'definition', 'procedure', 'event']);

export function selectWebImageRequests(
  items: CompleteGuideItem[],
  chapters: string[],
  illustrated: ReadonlySet<string>,
  limits = { perChapter: COMPLETE_GUIDE_WEB_IMAGES_PER_CHAPTER, total: COMPLETE_GUIDE_WEB_IMAGES_TOTAL },
): CompleteGuideWebImageRequest[] {
  const requests: CompleteGuideWebImageRequest[] = [];
  // Figure items whose page yielded no picture first, then the core concepts in order.
  const rank = (item: CompleteGuideItem) => (item.type === 'figure' ? 0 : 1);
  for (const unitKey of chapters) {
    if (requests.length >= limits.total) break;
    const candidates = items
      .filter((item) => item.unitKey === unitKey && item.importance === 'core' && IMAGE_ITEM_TYPES.has(item.type) && !illustrated.has(item.id) && item.title.trim().length >= 3)
      .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
      .slice(0, limits.perChapter);
    for (const item of candidates) {
      if (requests.length >= limits.total) break;
      requests.push({ itemId: item.id, unitKey, query: item.title.replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120), caption: item.title.slice(0, 160) });
    }
  }
  return requests.filter((request) => request.query.length >= 3);
}

/** Free licences Commons uses; NC/ND variants, GFDL-only and unknown terms are refused. */
export function freeImageLicense(shortName: string): boolean {
  const value = shortName.trim().toLowerCase();
  if (!value || /\b(nc|nd)\b|non-?commercial|no-?deriv|fair use|all rights reserved/.test(value)) return false;
  return /^(cc0|cc[ -]?by(?:-sa)?(?:[ -]\d(?:\.\d)?)?(?:\s|$|[ -]\w)|public domain|pd\b|pd-)/.test(value);
}

export function stripImageMetadataHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const STOP = new Set(['para', 'como', 'with', 'from', 'that', 'this', 'entre', 'sobre', 'desde', 'donde', 'which', 'their', 'there', 'dans', 'pour', 'avec', 'uber', 'eine', 'einer', 'della', 'delle', 'degli']);

/** At least one significant term of the query appears in the image's own text. */
export function imageMatchesQuery(query: string, texts: string[]): boolean {
  const terms = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 4 && !STOP.has(term)))];
  if (!terms.length) return false;
  const haystack = fold(texts.join(' '));
  return terms.some((term) => haystack.includes(term.slice(0, Math.max(4, Math.min(term.length, 6)))));
}

/** `File:Name.ext` from a Commons description URL, or null. */
export function commonsFileTitle(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)commons\.wikimedia\.org$/.test(parsed.hostname)) return null;
    const match = /^\/wiki\/(File:.+)$/.exec(parsed.pathname);
    return match ? decodeURIComponent(match[1]).replace(/_/g, ' ') : null;
  } catch {
    return null;
  }
}

/** Caption with the attribution the licence asks for; never "from your materials". */
export function webImageCaption(caption: string, attribution: CompleteGuideWebImageAttribution): string {
  const author = attribution.author.slice(0, 120);
  return `${caption} — ${attribution.title}${author ? `, ${author}` : ''} · ${attribution.license} · ${attribution.site}`;
}
