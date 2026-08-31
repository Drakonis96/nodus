import { createHash } from 'node:crypto';
import type { Work, ZoteroItem, ZoteroSyncOptions } from '@shared/types';

export type ZoteroSyncMode = 'manual' | 'realtime';
export type ZoteroItemChange = 'new' | 'changed' | 'unchanged' | 'baseline';

export interface ZoteroChangeContext {
  authors: string[];
  hasReadTag: boolean;
  lastSuccessfulSyncAt: string | null;
}

function sortedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.normalize('NFC')))].sort((left, right) => left.localeCompare(right));
}

function sortedRecord(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Stable fallback revision for Zotero local APIs that expose every item as version 0.
 * Arrays whose order carries no meaning are sorted; creator order remains intact because
 * it is bibliographic data.
 */
export function zoteroItemFingerprint(item: ZoteroItem): string {
  const payload = {
    // Old fingerprints used Zotero's original rich-text value. Continue hashing
    // that value while exposing a plain title to the rest of the app.
    title: item.titleMarkup ?? item.title,
    creators: item.creators.map((creator) => ({
      creatorType: creator.creatorType ?? 'author',
      firstName: creator.firstName ?? '',
      lastName: creator.lastName ?? '',
      name: creator.name ?? '',
    })),
    year: item.year,
    itemType: item.itemType,
    doi: item.doi,
    abstract: item.abstract,
    tags: sortedStrings(item.tags),
    collections: sortedStrings(item.collections),
    publisher: item.publisher,
    publicationTitle: item.publicationTitle,
    isbn: item.isbn,
    issn: item.issn,
    url: item.url,
    date: item.date,
    language: item.language,
    volume: item.volume,
    issue: item.issue,
    pages: item.pages,
    edition: item.edition,
    place: item.place,
    rights: item.rights,
    extra: item.extra,
    fields: sortedRecord(item.fields),
    dateAdded: item.dateAdded,
    dateModified: item.dateModified,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function positiveVersion(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function modifiedAfter(item: ZoteroItem, timestamp: string | null): boolean {
  if (!item.dateModified || !timestamp) return false;
  const modifiedAt = Date.parse(item.dateModified);
  const syncedAt = Date.parse(timestamp);
  return Number.isFinite(modifiedAt) && Number.isFinite(syncedAt) && modifiedAt > syncedAt;
}

function coreMetadataChanged(previous: Work, item: ZoteroItem, context: ZoteroChangeContext): boolean {
  let previousAuthors: string[] = [];
  try { previousAuthors = JSON.parse(previous.authors_json || '[]') as string[]; } catch { previousAuthors = []; }
  return (previous.zotero_title_markup ?? previous.title) !== (item.titleMarkup ?? item.title)
    || JSON.stringify(previousAuthors) !== JSON.stringify(context.authors)
    || previous.year !== item.year
    || previous.item_type !== item.itemType
    || previous.doi !== item.doi
    || Boolean(previous.read_tag) !== context.hasReadTag;
}

/**
 * Classify a Zotero item without treating a transport-version transition as a content
 * change. Zotero 10.0.1's local API returns version 0 for every item. On the first sync
 * after that transition there is no stored fingerprint yet, so the last completed sync
 * and persisted core metadata distinguish a real edit from adopting the new baseline.
 */
export function classifyZoteroItemChange(
  previous: Work | null,
  item: ZoteroItem,
  context: ZoteroChangeContext,
): ZoteroItemChange {
  if (!previous) return 'new';

  const incomingVersion = positiveVersion(item.version);
  const previousVersion = positiveVersion(previous.zotero_version);
  if (incomingVersion !== null && previousVersion !== null) {
    return incomingVersion === previousVersion ? 'unchanged' : 'changed';
  }

  const fingerprint = zoteroItemFingerprint(item);
  if (previous.zotero_fingerprint) {
    return previous.zotero_fingerprint === fingerprint ? 'unchanged' : 'changed';
  }

  if (coreMetadataChanged(previous, item, context) || modifiedAfter(item, context.lastSuccessfulSyncAt)) {
    return 'changed';
  }
  return 'baseline';
}

/** Never replace a valid historical Zotero revision with the local API's sentinel 0. */
export function persistedZoteroVersion(previous: Work | null, incomingVersion: number): number {
  return positiveVersion(incomingVersion) ?? previous?.zotero_version ?? 0;
}

/** The header opts into catalog-only refresh; setup and realtime retain their explicit automation settings. */
export function shouldAutomateAnalysisAfterSync(mode: ZoteroSyncMode, options: ZoteroSyncOptions = {}): boolean {
  return mode === 'realtime' || options.catalogOnly !== true;
}

/** A Zotero upgrade may reset its local library revision, so inequality matters in both directions. */
export function zoteroLibraryVersionsChanged(
  previous: Record<string, number>,
  current: Record<string, number>,
): boolean {
  return Object.entries(current).some(([key, version]) => version !== (previous[key] ?? 0));
}
