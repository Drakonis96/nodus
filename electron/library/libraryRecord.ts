import { createHash } from 'node:crypto';
import type {
  LibraryCollectionRecord,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryItemType,
  LibrarySourceIdentity,
} from '@shared/libraryTypes';

const SOURCES = new Set<LibraryItemSource>([
  'nodus', 'zotero', 'mendeley', 'ris', 'bibtex', 'biblatex', 'csl-json',
  'endnote-xml', 'zotero-rdf', 'csv', 'markdown', 'compass', 'legacy',
]);
const ITEM_TYPES = new Set<LibraryItemType>([
  'article-journal', 'journal-article', 'magazine-article', 'newspaper-article', 'book', 'book-chapter', 'chapter', 'book-section',
  'conference-paper', 'thesis', 'report', 'manuscript', 'presentation', 'interview', 'letter', 'email', 'instant-message',
  'encyclopedia-article', 'dictionary-entry', 'case', 'hearing', 'bill', 'statute', 'patent', 'artwork', 'map', 'film',
  'audio-recording', 'video-recording', 'radio-broadcast', 'tv-broadcast', 'podcast', 'blog-post', 'forum-post',
  'computer-program', 'webpage', 'document', 'dataset', 'preprint', 'standard', 'other',
]);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function recordContentHash(value: Omit<LibraryItemRecord, 'clock'> | Omit<LibraryCollectionRecord, 'clock'>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function stringValue(value: unknown, max = 10_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : undefined;
}

// Bibliographic strings are source data, not UI labels. Internal whitespace can be
// meaningful (paragraphs, initials, catalogue punctuation) and must round-trip from
// Zotero exactly. Structural identifiers continue to use stringValue above.
function metadataStringValue(value: unknown, max = 10_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

function metadataStringArray(value: unknown, maxItems = 256): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => metadataStringValue(item, 1_000)).filter((item): item is string => !!item))].slice(0, maxItems);
}

function stringArray(value: unknown, maxItems = 256): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => stringValue(item, 1_000)).filter((item): item is string => !!item))].slice(0, maxItems);
}

export function normalizeLibrarySourceIdentity(value: unknown): LibrarySourceIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const source = input.source as LibrarySourceIdentity['source'];
  const libraryType = input.libraryType as LibrarySourceIdentity['libraryType'];
  const libraryId = stringValue(input.libraryId, 1_000);
  const itemKey = stringValue(input.itemKey, 2_000);
  if (!['zotero', 'mendeley', 'ris', 'bibtex', 'biblatex', 'csl-json', 'endnote-xml', 'zotero-rdf', 'csv', 'markdown', 'compass'].includes(source)) return null;
  if (!['user', 'group', 'personal', 'shared', 'import'].includes(libraryType)) return null;
  return libraryId && itemKey ? { source, libraryType, libraryId, itemKey } : null;
}

function normalizeProviderProvenance(value: unknown): NonNullable<LibraryItemRecord['provenance']> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const input = entry as Record<string, unknown>;
    const provider = stringValue(input.provider, 200);
    if (!provider) return [];
    return [{
      provider,
      ...(stringValue(input.providerId, 2_000) ? { providerId: stringValue(input.providerId, 2_000) } : {}),
      ...(stringValue(input.sourceUrl, 10_000) ? { sourceUrl: stringValue(input.sourceUrl, 10_000) } : {}),
      ...(stringValue(input.retrievedAt, 100) ? { retrievedAt: stringValue(input.retrievedAt, 100) } : {}),
      ...(stringValue(input.attribution, 2_000) ? { attribution: stringValue(input.attribution, 2_000) } : {}),
      ...(stringValue(input.metadataLicense, 500) ? { metadataLicense: stringValue(input.metadataLicense, 500) } : {}),
    }];
  });
}

/** Stable comparison key for duplicate detection across providers. */
export function normalizeLibraryDedupTitle(value: string | undefined): string {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Canonical URL used only as a conservative duplicate hint.  Tracking
 * parameters and fragments are not part of a page identity, while meaningful
 * query parameters are retained.  Root/home-page URLs are intentionally
 * rejected by callers because they are too broad to identify a work.
 */
export function normalizeLibraryDedupUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    url.hostname = url.hostname.toLocaleLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    const tracking = /^(?:utm_[^=]+|fbclid|gclid|mc_cid|mc_eid)$/i;
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !tracking.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = '';
    for (const [key, entry] of kept) url.searchParams.append(key, entry);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return '';
  }
}

export function libraryCreatorDedupKey(creators: LibraryCreator[] | undefined): string {
  const first = creators?.find((creator) => creator.creatorType === 'author' || creator.creatorType === 'bookAuthor') ?? creators?.[0];
  return normalizeLibraryDedupTitle(first?.name || [first?.firstName, first?.lastName].filter(Boolean).join(' '));
}

export function librarySourceIdentityKey(identity: LibrarySourceIdentity): string {
  return [identity.source, identity.libraryType, identity.libraryId, identity.itemKey]
    .map((part) => `${part.length}:${part}`).join('|');
}

export function zoteroSourceIdentity(libraryId: string, itemKey: string): LibrarySourceIdentity {
  const group = /^groups\/(.+)$/.exec(libraryId);
  const user = /^users\/(.*)$/.exec(libraryId);
  return {
    source: 'zotero',
    libraryType: group ? 'group' : 'user',
    libraryId: group?.[1] || user?.[1] || libraryId || '0',
    itemKey,
  };
}

function normalizeSourceIdentities(value: unknown): LibrarySourceIdentity[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, LibrarySourceIdentity>();
  for (const entry of value) {
    const identity = normalizeLibrarySourceIdentity(entry);
    if (identity) unique.set(librarySourceIdentityKey(identity), identity);
  }
  return [...unique.values()];
}

function legacySourceIdentity(input: Record<string, unknown>): LibrarySourceIdentity | null {
  const source = input.source as LibraryItemSource;
  const sourceKey = stringValue(input.sourceKey, 2_000);
  const sourceLibraryId = stringValue(input.sourceLibraryId, 1_000);
  if (source === 'zotero' && sourceKey) return zoteroSourceIdentity(sourceLibraryId ?? 'users/0', sourceKey);
  if (source && source !== 'nodus' && source !== 'legacy' && sourceKey) {
    return normalizeLibrarySourceIdentity({
      source,
      libraryType: 'import',
      libraryId: sourceLibraryId ?? 'default',
      itemKey: sourceKey,
    });
  }
  return null;
}

function normalizeCreators(value: unknown): LibraryCreator[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 512).flatMap<LibraryCreator>((entry) => {
    if (typeof entry === 'string') {
      const name = metadataStringValue(entry, 1_000);
      return name ? [{ creatorType: 'author', name }] : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const creatorType = metadataStringValue(source.creatorType, 80) ?? 'author';
    const firstName = metadataStringValue(source.firstName, 500);
    const lastName = metadataStringValue(source.lastName, 500);
    const name = metadataStringValue(source.name, 1_000);
    if (!firstName && !lastName && !name) return [];
    const fieldMode = source.fieldMode === 1 || name && !firstName && !lastName ? 1 as const : 0 as const;
    return [{ creatorType, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(name ? { name } : {}), fieldMode }];
  });
}

export function normalizeLibraryMetadata(value: unknown, fallbackTitle = 'Documento sin título'): LibraryItemMetadata {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawYear = input.year == null || input.year === '' ? Number.NaN : Number(input.year);
  const itemType = ITEM_TYPES.has(input.itemType as LibraryItemType) ? input.itemType as LibraryItemType : 'document';
  const extra = input.extra && typeof input.extra === 'object' && !Array.isArray(input.extra)
    ? Object.fromEntries(Object.entries(input.extra as Record<string, unknown>)
      .flatMap(([key, entry]) => {
        const normalized = metadataStringValue(entry, 10_000);
        return normalized ? [[key.slice(0, 200), normalized]] : [];
      }))
    : undefined;
  const abstract = metadataStringValue(input.abstract, 500_000);
  // Releases before these fields became sortable retained the same Zotero data
  // losslessly in `extra`. Promote it on read so an existing library benefits
  // immediately, without a destructive re-import.
  const accessDate = metadataStringValue(input.accessDate, 200)
    ?? metadataStringValue(extra?.['Zotero field: accessDate'], 200);
  const zoteroDateAdded = metadataStringValue(input.zoteroDateAdded, 200)
    ?? metadataStringValue(extra?.['Zotero date added'], 200);
  const zoteroDateModified = metadataStringValue(input.zoteroDateModified, 200)
    ?? metadataStringValue(extra?.['Zotero date modified'], 200);
  return {
    title: metadataStringValue(input.title, 10_000) ?? fallbackTitle,
    itemType,
    creators: normalizeCreators(input.creators ?? input.authors),
    ...(abstract ? { abstract } : {}),
    ...(metadataStringValue(input.date, 200) ? { date: metadataStringValue(input.date, 200) } : {}),
    ...(accessDate ? { accessDate } : {}),
    ...(zoteroDateAdded ? { zoteroDateAdded } : {}),
    ...(zoteroDateModified ? { zoteroDateModified } : {}),
    year: Number.isInteger(rawYear) && rawYear > -10_000 && rawYear < 10_000 ? rawYear : null,
    ...(metadataStringValue(input.language, 100) ? { language: metadataStringValue(input.language, 100) } : {}),
    ...(metadataStringValue(input.publisher, 2_000) ? { publisher: metadataStringValue(input.publisher, 2_000) } : {}),
    ...(metadataStringValue(input.publicationTitle, 2_000) ? { publicationTitle: metadataStringValue(input.publicationTitle, 2_000) } : {}),
    ...(metadataStringValue(input.volume, 200) ? { volume: metadataStringValue(input.volume, 200) } : {}),
    ...(metadataStringValue(input.issue, 200) ? { issue: metadataStringValue(input.issue, 200) } : {}),
    ...(metadataStringValue(input.pages, 200) ? { pages: metadataStringValue(input.pages, 200) } : {}),
    ...(metadataStringValue(input.edition, 200) ? { edition: metadataStringValue(input.edition, 200) } : {}),
    ...(metadataStringValue(input.place, 1_000) ? { place: metadataStringValue(input.place, 1_000) } : {}),
    ...(metadataStringValue(input.rights, 4_000) ? { rights: metadataStringValue(input.rights, 4_000) } : {}),
    ...(metadataStringValue(input.url, 10_000) ? { url: metadataStringValue(input.url, 10_000) } : {}),
    ...(metadataStringValue(input.doi, 1_000) ? { doi: metadataStringValue(input.doi, 1_000) } : {}),
    ...(metadataStringValue(input.pmid, 100) ? { pmid: metadataStringValue(input.pmid, 100) } : {}),
    ...(metadataStringValue(input.pmcid, 100) ? { pmcid: metadataStringValue(input.pmcid, 100) } : {}),
    ...(metadataStringValue(input.arxiv, 100) ? { arxiv: metadataStringValue(input.arxiv, 100) } : {}),
    isbn: metadataStringArray(input.isbn),
    issn: metadataStringArray(input.issn),
    tags: metadataStringArray(input.tags),
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  };
}

export function isLibraryItemRecord(value: unknown): value is LibraryItemRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LibraryItemRecord>;
  return item.format === 'nodus.library-item'
    && item.formatVersion === 2
    && typeof item.id === 'string'
    && typeof item.storageId === 'string'
    && Array.isArray(item.aliases)
    && Array.isArray(item.sourceIdentities)
    && SOURCES.has(item.source as LibraryItemSource)
    && !!item.metadata && typeof item.metadata.title === 'string'
    && Array.isArray(item.collectionIds)
    && Array.isArray(item.attachments)
    && typeof item.createdAt === 'string'
    && (item.deletedAt === null || typeof item.deletedAt === 'string')
    && !!item.clock
    && typeof item.clock.deviceId === 'string'
    && Number.isInteger(item.clock.revision)
    && Number.isInteger(item.clock.baseRevision)
    && typeof item.clock.updatedAt === 'string'
    && /^[a-f0-9]{64}$/i.test(item.clock.contentHash);
}

export function isLibraryCollectionRecord(value: unknown): value is LibraryCollectionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LibraryCollectionRecord>;
  return item.format === 'nodus.library-collection'
    && item.formatVersion === 2
    && typeof item.id === 'string'
    && Array.isArray(item.aliases)
    && typeof item.name === 'string'
    && (item.icon === undefined || ['folder', 'book', 'bookmark', 'star', 'archive', 'notebook', 'graduation', 'flask', 'globe', 'map', 'users', 'tag'].includes(item.icon))
    && (item.color === undefined || (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)))
    && (item.parentId === null || typeof item.parentId === 'string')
    && Number.isFinite(item.position)
    && SOURCES.has(item.source as LibraryItemSource)
    && typeof item.createdAt === 'string'
    && (item.deletedAt === null || typeof item.deletedAt === 'string')
    && !!item.clock
    && typeof item.clock.deviceId === 'string'
    && Number.isInteger(item.clock.revision)
    && Number.isInteger(item.clock.baseRevision)
    && typeof item.clock.updatedAt === 'string'
    && /^[a-f0-9]{64}$/i.test(item.clock.contentHash);
}

/** Normalize both v2 and the published v1 contract without changing IDs or folders. */
export function normalizeLibraryItemRecord(value: unknown): LibraryItemRecord | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.format !== 'nodus.library-item' || ![1, 2].includes(Number(input.formatVersion))) return null;
  const aliases = stringArray(input.aliases, 2_000).filter((alias) => alias !== input.id);
  const identities = normalizeSourceIdentities(input.sourceIdentities);
  const inferred = legacySourceIdentity(input);
  if (inferred && !identities.some((entry) => librarySourceIdentityKey(entry) === librarySourceIdentityKey(inferred))) identities.push(inferred);
  const provenance = normalizeProviderProvenance(input.provenance);
  const { clock: rawClock, ...withoutClock } = input;
  const base = {
    ...withoutClock,
    formatVersion: 2 as const,
    aliases,
    sourceIdentities: identities,
    ...(provenance.length ? { provenance } : {}),
    metadata: normalizeLibraryMetadata(input.metadata, stringValue((input.metadata as Record<string, unknown> | undefined)?.title, 10_000)),
    attachments: Array.isArray(input.attachments) ? input.attachments.map((entry, position) => ({
      ...(entry as object), position: Number.isFinite(Number((entry as { position?: unknown }).position)) ? Number((entry as { position?: unknown }).position) : position,
    })) : [],
    notes: Array.isArray(input.notes) ? input.notes : [],
    relations: Array.isArray(input.relations) ? input.relations : [],
  } as unknown as Omit<LibraryItemRecord, 'clock'>;
  const clock = rawClock as LibraryItemRecord['clock'] | undefined;
  const normalized = {
    ...base,
    clock: Number(input.formatVersion) === 1 && clock
      ? {
        ...clock,
        revision: clock.revision + 1,
        baseRevision: clock.revision,
        contentHash: recordContentHash(base),
      }
      : clock,
  } as LibraryItemRecord;
  return isLibraryItemRecord(normalized) ? normalized : null;
}

export function normalizeLibraryCollectionRecord(value: unknown): LibraryCollectionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.format !== 'nodus.library-collection' || ![1, 2].includes(Number(input.formatVersion))) return null;
  const { clock: rawClock, icon: rawIcon, color: rawColor, ...withoutClock } = input;
  const icon = typeof rawIcon === 'string' && ['folder', 'book', 'bookmark', 'star', 'archive', 'notebook', 'graduation', 'flask', 'globe', 'map', 'users', 'tag'].includes(rawIcon) ? rawIcon : undefined;
  const color = typeof rawColor === 'string' && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toLowerCase() : undefined;
  const base = {
    ...withoutClock,
    formatVersion: 2 as const,
    aliases: stringArray(input.aliases, 2_000).filter((alias) => alias !== input.id),
    ...(icon ? { icon } : {}),
    ...(color ? { color } : {}),
  } as unknown as Omit<LibraryCollectionRecord, 'clock'>;
  const clock = rawClock as LibraryCollectionRecord['clock'] | undefined;
  const normalized = {
    ...base,
    clock: Number(input.formatVersion) === 1 && clock
      ? {
        ...clock,
        revision: clock.revision + 1,
        baseRevision: clock.revision,
        contentHash: recordContentHash(base),
      }
      : clock,
  } as LibraryCollectionRecord;
  return isLibraryCollectionRecord(normalized) ? normalized : null;
}

/** Read pre-contract prototype folders without mutating or losing them. */
export function legacyMetadataToRecord(value: unknown, folderName: string): LibraryItemRecord | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const storageId = stringValue(input.storageId, 2_000) ?? folderName;
  const id = stringValue(input.id, 2_000) ?? storageId;
  const now = stringValue(input.updatedAt, 100) ?? new Date(0).toISOString();
  const files = input.files && typeof input.files === 'object' ? input.files as LibraryItemRecord['files'] : undefined;
  const zoteroKey = typeof (input.zotero as { itemKey?: unknown } | undefined)?.itemKey === 'string'
    ? String((input.zotero as { itemKey: string }).itemKey)
    : undefined;
  const base = {
    format: 'nodus.library-item' as const,
    formatVersion: 2 as const,
    id,
    storageId,
    aliases: [],
    sourceIdentities: zoteroKey ? [zoteroSourceIdentity('users/0', zoteroKey)] : [],
    source: zoteroKey ? 'zotero' as const : 'legacy' as const,
    ...(zoteroKey ? { sourceLibraryId: 'users/0', sourceKey: zoteroKey } : {}),
    citationKey: stringValue(input.citationKey, 1_000),
    metadata: normalizeLibraryMetadata(input, stringValue(input.title, 10_000) ?? folderName),
    collectionIds: stringArray(input.collectionIds),
    attachments: [],
    files,
    extraction: { status: files?.reader ? 'ready' as const : 'pending' as const },
    createdAt: stringValue(input.createdAt, 100) ?? now,
    deletedAt: null,
  };
  return { ...base, clock: { deviceId: 'legacy', revision: 1, baseRevision: 0, updatedAt: now, contentHash: recordContentHash(base) } };
}
