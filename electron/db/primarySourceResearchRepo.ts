import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type {
  PrimarySourceCitationInsertion,
  PrimarySourceAccessStatus,
  PrimarySourceDashboardActivity,
  PrimarySourceDashboardTask,
  PrimarySourceNoteLinkInput,
  PrimarySourceNoteProfile,
  PrimarySourceNoteProfilePatch,
  PrimarySourceNoteRelationKind,
  PrimarySourceNoteStatus,
  PrimarySourceNoteType,
  PrimarySourceNoteWorkspace,
  PrimarySourceOperationalDashboard,
  PrimarySourceResearchNote,
  PrimarySourceResearchNoteLink,
  PrimarySourceSearchFacet,
  PrimarySourceSearchLayer,
  PrimarySourceSearchRequest,
  PrimarySourceSearchResponse,
  PrimarySourceSearchResult,
  PrimarySourceSearchTargetKind,
  PrimarySourceSensitivity,
} from '@shared/primarySourcesTypes';
import {
  PRIMARY_SOURCE_NOTE_STATUSES,
  PRIMARY_SOURCE_NOTE_TYPES,
  PRIMARY_SOURCE_ACCESS_STATUSES,
  PRIMARY_SOURCE_SENSITIVITIES,
  decidePrimarySourcePolicy,
} from '@shared/primarySourcesTypes';
import { primarySourceExcerptDeepLink } from '@shared/primarySourceDeepLink';
import { getDb } from './database';
import { createNote, getNote, getNotesTree } from './notesRepo';

const NOTE_RELATIONS: PrimarySourceNoteRelationKind[] = [
  'references',
  'quotes',
  'interprets',
  'questions',
  'supports',
  'contradicts',
];

const SEARCH_TARGETS: PrimarySourceSearchTargetKind[] = [
  'source',
  'unit',
  'text_version',
  'excerpt',
  'person',
  'event',
  'place',
  'relation',
  'saved_search',
  'note',
];

type ItemContext = {
  itemId: string;
  title: string;
  kind: string;
  mimeType: string | null;
  unitId: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  referenceCode: string | null;
  unitTitle: string | null;
  level: string | null;
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  accessStatus: PrimarySourceSearchResult['accessStatus'];
  hierarchy: string[];
  personIds: string[];
  placeIds: string[];
};

type SearchCandidate = Omit<
  PrimarySourceSearchResult,
  'resultId' | 'matchText' | 'matchStart' | 'matchLength'
> & {
  searchable: string;
  preferredText: string;
};

type UnitRow = {
  unit_id: string;
  parent_unit_id: string | null;
  repository_id: string | null;
  reference_code: string | null;
  title: string;
  level: string;
  date_display: string | null;
  date_start_sort: string | null;
  date_end_sort: string | null;
};

type SearchSyntax = {
  terms: string[];
  fields: Map<string, string[]>;
};

const FIELD_ALIASES: Record<string, string> = {
  persona: 'person',
  person: 'person',
  lugar: 'place',
  place: 'place',
  repositorio: 'repository',
  repository: 'repository',
  fecha: 'date',
  date: 'date',
  tipo: 'type',
  type: 'type',
  estado: 'status',
  status: 'status',
  referencia: 'reference',
  reference: 'reference',
};

function now(): string {
  return new Date().toISOString();
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** A compact query language: quoted phrases plus `field:value` filters. */
export function parsePrimarySourceSearchSyntax(query: string): SearchSyntax {
  const fields = new Map<string, string[]>();
  const terms: string[] = [];
  const tokenPattern = /(?:^|\s)(?:([\p{L}_-]+):)?(?:"([^"]+)"|([^\s]+))/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(query.trim())) !== null) {
    const rawKey = match[1]?.toLocaleLowerCase();
    const value = clean(match[2] ?? match[3]);
    if (!value) continue;
    const key = rawKey ? FIELD_ALIASES[rawKey] : null;
    if (key) fields.set(key, [...(fields.get(key) ?? []), value]);
    else terms.push(value);
  }
  return { terms, fields };
}

function searchTermsMatch(value: string, terms: string[]): boolean {
  const normalized = fold(value);
  return terms.every((term) => normalized.includes(fold(term)));
}

function fieldMatch(candidate: SearchCandidate, syntax: SearchSyntax): boolean {
  const values = (key: string): string[] => syntax.fields.get(key) ?? [];
  const containsAll = (haystack: string, needles: string[]) =>
    needles.every((needle) => fold(haystack).includes(fold(needle)));
  if (!containsAll(candidate.personIds.join(' '), values('person'))) return false;
  if (!containsAll(candidate.placeIds.join(' '), values('place'))) return false;
  if (!containsAll(candidate.repositoryName ?? '', values('repository'))) return false;
  if (!containsAll(candidate.dateDisplay ?? '', values('date'))) return false;
  if (!containsAll([candidate.documentType, candidate.layer].filter(Boolean).join(' '), values('type'))) return false;
  if (!containsAll(candidate.reviewStatus ?? '', values('status'))) return false;
  if (!containsAll(candidate.referenceCode ?? '', values('reference'))) return false;
  return true;
}

function snippet(value: string, term: string): Pick<PrimarySourceSearchResult, 'matchText' | 'matchStart' | 'matchLength'> {
  const compact = clean(value);
  const normalized = fold(compact);
  const needle = fold(term);
  const found = needle ? normalized.indexOf(needle) : 0;
  const rawIndex = found < 0 ? 0 : found;
  const start = Math.max(0, rawIndex - 75);
  const end = Math.min(compact.length, rawIndex + Math.max(needle.length, 1) + 120);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < compact.length ? '…' : '';
  const matchText = `${prefix}${compact.slice(start, end)}${suffix}`;
  return {
    matchText,
    matchStart: Math.max(0, rawIndex - start + prefix.length),
    matchLength: Math.min(term.length || 1, Math.max(0, matchText.length - (rawIndex - start + prefix.length))),
  };
}

function hierarchyFor(unitId: string | null, units: Map<string, UnitRow>): string[] {
  if (!unitId) return [];
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = unitId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const unit = units.get(current);
    if (!unit) break;
    chain.unshift(unit.title);
    current = unit.parent_unit_id;
  }
  return chain;
}

function loadItemContexts(): Map<string, ItemContext> {
  const db = getDb();
  const unitRows = db.prepare(
    `SELECT unit_id, parent_unit_id, repository_id, reference_code, title, level,
            date_display, date_start_sort, date_end_sort
       FROM archive_description_units`
  ).all() as UnitRow[];
  const units = new Map(unitRows.map((unit) => [unit.unit_id, unit]));
  const rows = db.prepare(
    `SELECT i.item_id, i.title, i.kind, i.mime_type,
            u.unit_id, u.repository_id, r.name AS repository_name,
            u.reference_code, u.title AS unit_title, u.level, u.date_display,
            u.date_start_sort, u.date_end_sort,
            COALESCE(p.access_status, 'unknown') AS access_status
       FROM archive_items i
       LEFT JOIN archive_item_units iu
         ON iu.item_id=i.item_id AND iu.relation_kind='describes'
       LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
       LEFT JOIN archive_item_profiles p ON p.item_id=i.item_id`
  ).all() as Array<{
    item_id: string;
    title: string;
    kind: string;
    mime_type: string | null;
    unit_id: string | null;
    repository_id: string | null;
    repository_name: string | null;
    reference_code: string | null;
    unit_title: string | null;
    level: string | null;
    date_display: string | null;
    date_start_sort: string | null;
    date_end_sort: string | null;
    access_status: PrimarySourceSearchResult['accessStatus'];
  }>;
  const personRows = db.prepare(
    `SELECT m.item_id, m.person_id, m.original_label, p.display_name
       FROM archive_person_mentions m
       LEFT JOIN persons p ON p.person_id=m.person_id`
  ).all() as Array<{
    item_id: string;
    person_id: string | null;
    original_label: string;
    display_name: string | null;
  }>;
  const placeRows = db.prepare(
    `SELECT m.item_id, m.place_id, m.original_label, p.name
       FROM archive_place_mentions m
       LEFT JOIN places p ON p.place_id=m.place_id`
  ).all() as Array<{
    item_id: string;
    place_id: string | null;
    original_label: string;
    name: string | null;
  }>;
  const people = new Map<string, string[]>();
  const places = new Map<string, string[]>();
  for (const row of personRows) {
    people.set(row.item_id, [
      ...(people.get(row.item_id) ?? []),
      row.person_id ?? '',
      row.original_label,
      row.display_name ?? '',
    ].filter(Boolean));
  }
  for (const row of placeRows) {
    places.set(row.item_id, [
      ...(places.get(row.item_id) ?? []),
      row.place_id ?? '',
      row.original_label,
      row.name ?? '',
    ].filter(Boolean));
  }
  return new Map(rows.map((row) => [row.item_id, {
    itemId: row.item_id,
    title: row.title,
    kind: row.kind,
    mimeType: row.mime_type,
    unitId: row.unit_id,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    referenceCode: row.reference_code,
    unitTitle: row.unit_title,
    level: row.level,
    dateDisplay: row.date_display,
    dateStartSort: row.date_start_sort,
    dateEndSort: row.date_end_sort,
    accessStatus: row.access_status,
    hierarchy: hierarchyFor(row.unit_id, units),
    personIds: [...new Set(people.get(row.item_id) ?? [])],
    placeIds: [...new Set(places.get(row.item_id) ?? [])],
  }]));
}

function baseCandidate(
  layer: PrimarySourceSearchLayer,
  targetKind: PrimarySourceSearchTargetKind,
  targetId: string,
  title: string,
  searchable: string,
  preferredText: string,
  context?: ItemContext | null
): SearchCandidate {
  return {
    layer,
    targetKind,
    targetId,
    itemId: context?.itemId ?? null,
    excerptId: null,
    textVersionId: null,
    startOffset: null,
    endOffset: null,
    noteId: null,
    title,
    searchable,
    preferredText,
    repositoryId: context?.repositoryId ?? null,
    repositoryName: context?.repositoryName ?? null,
    hierarchy: context?.hierarchy ?? [],
    referenceCode: context?.referenceCode ?? null,
    dateDisplay: context?.dateDisplay ?? null,
    documentType: context?.kind ?? null,
    level: context?.level ?? null,
    format: context?.mimeType ?? null,
    personIds: context?.personIds ?? [],
    placeIds: context?.placeIds ?? [],
    reviewStatus: null,
    accessStatus: context?.accessStatus ?? null,
    locator: null,
    interpretation: false,
    unreviewedText: false,
    restrictedContentHidden: false,
  };
}

function accessAllowsContent(context: ItemContext | undefined, request: PrimarySourceSearchRequest): boolean {
  if (!context) return true;
  if (context.accessStatus === 'unknown' && request.allowUnknownRightsContent) return true;
  return decidePrimarySourcePolicy({
    accessStatus: context.accessStatus ?? 'unknown',
    sensitivity: 'normal',
    action: 'search_content',
    allowPrivateSearch: request.allowPrivateContent,
    allowRestrictedSearch: request.allowRestrictedContent,
  }).decision === 'allow';
}

function candidatesForSearch(request: PrimarySourceSearchRequest): SearchCandidate[] {
  const db = getDb();
  const contexts = loadItemContexts();
  const candidates: SearchCandidate[] = [];
  // Parse and fold once per search. Doing this inside the text-version loop made
  // a 10k-source corpus repeat the same Unicode normalization and query parser
  // thousands of times before a single candidate could be returned.
  const primarySearchNeedle = parsePrimarySourceSearchSyntax(request.query).terms[0] ?? '';
  const foldedPrimarySearchNeedle = fold(primarySearchNeedle);

  const itemRows = db.prepare(
    `SELECT i.item_id, i.title, i.description, i.extracted_text,
            u.title AS unit_title, u.reference_code, u.creator_display, u.scope_content,
            p.metadata_json
       FROM archive_items i
       LEFT JOIN archive_item_units iu
         ON iu.item_id=i.item_id AND iu.relation_kind='describes'
       LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
       LEFT JOIN archive_item_profiles p ON p.item_id=i.item_id`
  ).all() as Array<{
    item_id: string;
    title: string;
    description: string | null;
    extracted_text: string | null;
    unit_title: string | null;
    reference_code: string | null;
    creator_display: string | null;
    scope_content: string | null;
    metadata_json: string | null;
  }>;
  for (const row of itemRows) {
    const context = contexts.get(row.item_id);
    const metadataText = [
      row.title,
      row.description,
      row.unit_title,
      row.reference_code,
      row.creator_display,
      row.scope_content,
      row.metadata_json,
      context?.repositoryName,
      context?.hierarchy.join(' '),
    ].filter(Boolean).join('\n');
    const metadataCandidate = baseCandidate('metadata', 'source', row.item_id, row.title, metadataText, metadataText, context);
    metadataCandidate.restrictedContentHidden = Boolean(row.extracted_text && !accessAllowsContent(context, request));
    candidates.push(metadataCandidate);
    if (row.extracted_text && accessAllowsContent(context, request)) {
      const extracted = baseCandidate('ocr', 'source', row.item_id, row.title, row.extracted_text, row.extracted_text, context);
      extracted.reviewStatus = 'legacy';
      extracted.unreviewedText = true;
      candidates.push(extracted);
    }
  }

  const textRows = db.prepare(
    `SELECT text_version_id, item_id, kind, content, status
       FROM archive_text_versions`
  ).all() as Array<{
    text_version_id: string;
    item_id: string;
    kind: string;
    content: string;
    status: string;
  }>;
  const excerpts = db.prepare(
    `SELECT excerpt_id, item_id, text_version_id, locator_display, quoted_text,
            review_status, locator_json
       FROM archive_excerpts`
  ).all() as Array<{
    excerpt_id: string;
    item_id: string;
    text_version_id: string | null;
    locator_display: string;
    quoted_text: string | null;
    review_status: string;
    locator_json: string;
  }>;
  const excerptsByVersion = new Map<string, typeof excerpts>();
  for (const excerpt of excerpts) {
    if (!excerpt.text_version_id) continue;
    excerptsByVersion.set(excerpt.text_version_id, [
      ...(excerptsByVersion.get(excerpt.text_version_id) ?? []),
      excerpt,
    ]);
  }
  for (const row of textRows) {
    const context = contexts.get(row.item_id);
    if (!accessAllowsContent(context, request)) continue;
    const layer: PrimarySourceSearchLayer = row.kind === 'ocr' ? 'ocr' : 'transcription';
    const candidate = baseCandidate(
      layer,
      'text_version',
      row.text_version_id,
      context?.title ?? row.text_version_id,
      row.content,
      row.content,
      context
    );
    candidate.textVersionId = row.text_version_id;
    candidate.reviewStatus = row.status;
    candidate.unreviewedText = row.status !== 'reviewed';
    const offset = fold(row.content).indexOf(foldedPrimarySearchNeedle);
    if (offset >= 0) {
      candidate.startOffset = offset;
      candidate.endOffset = offset + primarySearchNeedle.length;
      const exact = (excerptsByVersion.get(row.text_version_id) ?? []).find((excerpt) => {
        const locator = parseJson<{ textRange?: { start?: number; end?: number } }>(excerpt.locator_json, {});
        const start = locator.textRange?.start;
        const end = locator.textRange?.end;
        return typeof start === 'number'
          && typeof end === 'number'
          && start <= offset
          && end >= offset + primarySearchNeedle.length;
      });
      if (exact) {
        candidate.targetKind = 'excerpt';
        candidate.targetId = exact.excerpt_id;
        candidate.excerptId = exact.excerpt_id;
        candidate.locator = exact.locator_display;
      }
    }
    candidates.push(candidate);
  }

  for (const row of excerpts) {
    const context = contexts.get(row.item_id);
    if (!row.quoted_text || !accessAllowsContent(context, request)) continue;
    const candidate = baseCandidate(
      'excerpt',
      'excerpt',
      row.excerpt_id,
      context?.title ?? row.excerpt_id,
      `${row.locator_display}\n${row.quoted_text}`,
      row.quoted_text,
      context
    );
    candidate.excerptId = row.excerpt_id;
    candidate.textVersionId = row.text_version_id;
    candidate.locator = row.locator_display;
    candidate.reviewStatus = row.review_status;
    candidates.push(candidate);
  }

  const people = db.prepare(
    `SELECT m.mention_id, m.item_id, m.excerpt_id, m.person_id, m.original_label,
            m.role, m.identity_status, p.display_name
       FROM archive_person_mentions m
       LEFT JOIN persons p ON p.person_id=m.person_id`
  ).all() as Array<{
    mention_id: string;
    item_id: string;
    excerpt_id: string | null;
    person_id: string | null;
    original_label: string;
    role: string | null;
    identity_status: string;
    display_name: string | null;
  }>;
  for (const row of people) {
    const candidate = baseCandidate(
      'person',
      'person',
      row.person_id ?? row.mention_id,
      row.display_name ?? row.original_label,
      [row.original_label, row.display_name, row.role].filter(Boolean).join(' '),
      row.original_label,
      contexts.get(row.item_id)
    );
    candidate.excerptId = row.excerpt_id;
    candidate.reviewStatus = row.identity_status;
    candidate.personIds = [...new Set([...candidate.personIds, row.person_id ?? row.mention_id, row.original_label])];
    candidates.push(candidate);
  }

  const events = db.prepare(
    `SELECT e.event_id, e.type, e.label, e.date, e.date_sort, e.date_end_sort,
            e.place_id, re.nodus_id AS item_id, re.excerpt_id, re.review_status
       FROM events e
       LEFT JOIN record_evidence re
         ON re.target_kind='event' AND re.target_id=e.event_id`
  ).all() as Array<{
    event_id: string;
    type: string;
    label: string | null;
    date: string | null;
    date_sort: string | null;
    date_end_sort: string | null;
    place_id: string | null;
    item_id: string | null;
    excerpt_id: string | null;
    review_status: string | null;
  }>;
  for (const row of events) {
    const candidate = baseCandidate(
      'event',
      'event',
      row.event_id,
      row.label || row.type,
      [row.label, row.type, row.date].filter(Boolean).join(' '),
      [row.label, row.date].filter(Boolean).join(' · '),
      row.item_id ? contexts.get(row.item_id) : null
    );
    candidate.excerptId = row.excerpt_id;
    candidate.dateDisplay = row.date;
    candidate.placeIds = [...new Set([...candidate.placeIds, ...(row.place_id ? [row.place_id] : [])])];
    candidate.reviewStatus = row.review_status;
    candidates.push(candidate);
  }

  const places = db.prepare(
    `SELECT m.mention_id, m.item_id, m.excerpt_id, m.place_id, m.original_label,
            m.role, m.status, p.name
       FROM archive_place_mentions m
       LEFT JOIN places p ON p.place_id=m.place_id`
  ).all() as Array<{
    mention_id: string;
    item_id: string;
    excerpt_id: string | null;
    place_id: string | null;
    original_label: string;
    role: string;
    status: string;
    name: string | null;
  }>;
  for (const row of places) {
    const candidate = baseCandidate(
      'place',
      'place',
      row.place_id ?? row.mention_id,
      row.name ?? row.original_label,
      [row.original_label, row.name, row.role].filter(Boolean).join(' '),
      row.original_label,
      contexts.get(row.item_id)
    );
    candidate.excerptId = row.excerpt_id;
    candidate.reviewStatus = row.status;
    candidate.placeIds = [...new Set([...candidate.placeIds, row.place_id ?? row.mention_id, row.original_label])];
    candidates.push(candidate);
  }

  const relations = db.prepare(
    `SELECT sr.relation_id, sr.role, sr.notes, sr.status, sr.person_id,
            sr.target_id, p.display_name AS source_name,
            COALESCE(tp.display_name, sc.display_name) AS target_name,
            re.nodus_id AS item_id, re.excerpt_id, re.review_status
       FROM social_relations sr
       JOIN persons p ON p.person_id=sr.person_id
       LEFT JOIN persons tp ON sr.target_kind='person' AND tp.person_id=sr.target_id
       LEFT JOIN social_contacts sc ON sr.target_kind='contact' AND sc.contact_id=sr.target_id
       LEFT JOIN record_evidence re
         ON re.target_kind='social_relation' AND re.target_id=sr.relation_id`
  ).all() as Array<{
    relation_id: string;
    role: string;
    notes: string | null;
    status: string;
    person_id: string;
    target_id: string;
    source_name: string;
    target_name: string | null;
    item_id: string | null;
    excerpt_id: string | null;
    review_status: string | null;
  }>;
  for (const row of relations) {
    const title = `${row.source_name} — ${row.role} — ${row.target_name ?? row.target_id}`;
    const candidate = baseCandidate(
      'relation',
      'relation',
      row.relation_id,
      title,
      [title, row.notes].filter(Boolean).join(' '),
      title,
      row.item_id ? contexts.get(row.item_id) : null
    );
    candidate.excerptId = row.excerpt_id;
    candidate.personIds = [...new Set([...candidate.personIds, row.person_id, row.target_id, row.source_name, row.target_name ?? ''])].filter(Boolean);
    candidate.reviewStatus = row.review_status ?? row.status;
    candidates.push(candidate);
  }

  const notes = db.prepare(
    `SELECT id, title, content, updated_at FROM notes`
  ).all() as Array<{ id: string; title: string; content: string; updated_at: string }>;
  for (const row of notes) {
    const candidate = baseCandidate(
      'note',
      'note',
      row.id,
      row.title,
      `${row.title}\n${row.content}`,
      row.content || row.title
    );
    candidate.noteId = row.id;
    candidate.interpretation = true;
    candidate.reviewStatus = (db.prepare(
      'SELECT status FROM primary_source_note_profiles WHERE note_id=?'
    ).get(row.id) as { status: string } | undefined)?.status ?? 'draft';
    candidates.push(candidate);
  }

  const tags = db.prepare(
    `SELECT t.item_id, t.tag FROM archive_item_tags t`
  ).all() as Array<{ item_id: string; tag: string }>;
  for (const row of tags) {
    const context = contexts.get(row.item_id);
    candidates.push(baseCandidate('tag', 'source', row.item_id, context?.title ?? row.tag, row.tag, row.tag, context));
  }

  const collections = db.prepare(
    `SELECT f.folder_id, f.name, j.item_id
       FROM archive_folders f
       JOIN archive_item_folders j ON j.folder_id=f.folder_id`
  ).all() as Array<{ folder_id: string; name: string; item_id: string }>;
  for (const row of collections) {
    const context = contexts.get(row.item_id);
    candidates.push(baseCandidate('collection', 'source', row.item_id, context?.title ?? row.name, row.name, row.name, context));
  }

  return candidates;
}

function dateOverlaps(candidate: SearchCandidate, from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from && !to) return true;
  const value = candidate.dateDisplay ?? '';
  const years = value.match(/\d{4}/g)?.map(Number) ?? [];
  if (years.length === 0) return false;
  const start = Math.min(...years);
  const end = Math.max(...years);
  const fromYear = from ? Number(from.slice(0, 4)) : Number.NEGATIVE_INFINITY;
  const toYear = to ? Number(to.slice(0, 4)) : Number.POSITIVE_INFINITY;
  return end >= fromYear && start <= toYear;
}

function requestFilterMatch(candidate: SearchCandidate, request: PrimarySourceSearchRequest): boolean {
  const filter = request.filters;
  if (!filter) return true;
  if (filter.layers?.length && !filter.layers.includes(candidate.layer)) return false;
  if (filter.repositoryId && candidate.repositoryId !== filter.repositoryId) return false;
  if (filter.level && candidate.level !== filter.level) return false;
  if (filter.format && candidate.format !== filter.format) return false;
  if (filter.personId && !candidate.personIds.includes(filter.personId)) return false;
  if (filter.placeId && !candidate.placeIds.includes(filter.placeId)) return false;
  if (filter.reviewStatus && candidate.reviewStatus !== filter.reviewStatus) return false;
  if (filter.accessStatus && candidate.accessStatus !== filter.accessStatus) return false;
  return dateOverlaps(candidate, filter.dateFrom, filter.dateTo);
}

function facets(
  results: PrimarySourceSearchResult[],
  values: (result: PrimarySourceSearchResult) => Array<{ id: string; label: string }>
): PrimarySourceSearchFacet[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const result of results) {
    for (const value of values(result)) {
      if (!value.id) continue;
      const current = counts.get(value.id);
      counts.set(value.id, { label: value.label, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function searchPrimarySourceCorpus(request: PrimarySourceSearchRequest): PrimarySourceSearchResponse {
  const started = performance.now();
  const syntax = parsePrimarySourceSearchSyntax(request.query);
  const terms = syntax.terms;
  const limit = Math.max(1, Math.min(request.limit ?? 250, 500));
  const matched = candidatesForSearch(request)
    .filter((candidate) => (terms.length === 0 || searchTermsMatch(candidate.searchable, terms)))
    .filter((candidate) => fieldMatch(candidate, syntax));
  const all = matched.filter((candidate) => requestFilterMatch(candidate, request));
  const total = all.length;
  const firstTerm = terms[0] ?? '';
  const materialize = (candidate: SearchCandidate, index: number): PrimarySourceSearchResult => ({
    ...candidate,
    ...snippet(candidate.preferredText || candidate.searchable, firstTerm),
    resultId: `${candidate.layer}:${candidate.targetId}:${index}`,
  });
  const results = all.slice(0, limit).map((candidate, index): PrimarySourceSearchResult => ({
    ...materialize(candidate, index),
  }));
  const facetRows = matched.slice(0, 5_000).map(materialize);
  const elapsedMs = Math.max(0, performance.now() - started);
  return {
    queryText: terms.join(' '),
    parsedTerms: terms,
    results,
    total,
    elapsedMs,
    indexStrategy: 'sqlite_like',
    // FTS remains an evidence-based upgrade, not a speculative second source of truth.
    ftsRecommended: elapsedMs > 150 || total > 10_000,
    facets: {
      layers: facets(facetRows, (result) => [{ id: result.layer, label: result.layer }]),
      repositories: facets(facetRows, (result) => result.repositoryId ? [{
        id: result.repositoryId,
        label: result.repositoryName ?? result.repositoryId,
      }] : []),
      levels: facets(facetRows, (result) => result.level ? [{ id: result.level, label: result.level }] : []),
      formats: facets(facetRows, (result) => result.format ? [{ id: result.format, label: result.format }] : []),
      persons: facets(facetRows, (result) => result.personIds.map((id) => ({ id, label: id }))),
      places: facets(facetRows, (result) => result.placeIds.map((id) => ({ id, label: id }))),
      reviewStatuses: facets(facetRows, (result) => result.reviewStatus ? [{
        id: result.reviewStatus,
        label: result.reviewStatus,
      }] : []),
      accessStatuses: facets(facetRows, (result) => result.accessStatus ? [{
        id: result.accessStatus,
        label: result.accessStatus,
      }] : []),
    },
  };
}

function normalizeNoteType(value: string | null | undefined): PrimarySourceNoteType {
  return PRIMARY_SOURCE_NOTE_TYPES.includes(value as PrimarySourceNoteType)
    ? value as PrimarySourceNoteType
    : 'observation';
}

function normalizeNoteStatus(value: string | null | undefined): PrimarySourceNoteStatus {
  return PRIMARY_SOURCE_NOTE_STATUSES.includes(value as PrimarySourceNoteStatus)
    ? value as PrimarySourceNoteStatus
    : 'draft';
}

function normalizeNoteAccess(value: string | null | undefined): PrimarySourceAccessStatus {
  return PRIMARY_SOURCE_ACCESS_STATUSES.includes(value as PrimarySourceAccessStatus)
    ? value as PrimarySourceAccessStatus
    : 'private';
}

function normalizeNoteSensitivity(value: string | null | undefined): PrimarySourceSensitivity {
  return PRIMARY_SOURCE_SENSITIVITIES.includes(value as PrimarySourceSensitivity)
    ? value as PrimarySourceSensitivity
    : 'normal';
}

function normalizeRelation(value: string | null | undefined): PrimarySourceNoteRelationKind {
  return NOTE_RELATIONS.includes(value as PrimarySourceNoteRelationKind)
    ? value as PrimarySourceNoteRelationKind
    : 'references';
}

function ensureNoteProfile(noteId: string): PrimarySourceNoteProfile {
  const db = getDb();
  const existing = db.prepare(
    `SELECT note_id, note_type, status, collection, access_status, sensitivity,
            created_at, updated_at
       FROM primary_source_note_profiles WHERE note_id=?`
  ).get(noteId) as {
    note_id: string;
    note_type: string;
    status: string;
    collection: string | null;
    access_status: string;
    sensitivity: string;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!existing) {
    if (!getNote(noteId)) throw new Error('The note does not exist.');
    const timestamp = now();
    db.prepare(
      `INSERT INTO primary_source_note_profiles
        (note_id, note_type, status, collection, created_at, updated_at)
       VALUES (?, 'observation', 'draft', NULL, ?, ?)`
    ).run(noteId, timestamp, timestamp);
    return {
      noteId,
      noteType: 'observation',
      status: 'draft',
      collection: null,
      accessStatus: 'private',
      sensitivity: 'normal',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  return {
    noteId: existing.note_id,
    noteType: normalizeNoteType(existing.note_type),
    status: normalizeNoteStatus(existing.status),
    collection: existing.collection,
    accessStatus: normalizeNoteAccess(existing.access_status),
    sensitivity: normalizeNoteSensitivity(existing.sensitivity),
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
  };
}

type TargetDetails = {
  label: string;
  itemId: string | null;
  excerptId: string | null;
  repositoryName: string | null;
  referenceCode: string | null;
  locator: string | null;
  quote: string | null;
};

function targetDetails(kind: PrimarySourceSearchTargetKind, id: string, excerptId?: string | null): TargetDetails {
  if (!SEARCH_TARGETS.includes(kind)) throw new Error('Unsupported note-link target.');
  const db = getDb();
  const excerpt = excerptId ? db.prepare(
    `SELECT e.excerpt_id, e.item_id, e.locator_display, e.quoted_text,
            i.title, u.reference_code, r.name AS repository_name
       FROM archive_excerpts e
       JOIN archive_items i ON i.item_id=e.item_id
       LEFT JOIN archive_item_units iu
         ON iu.item_id=i.item_id AND iu.relation_kind='describes'
       LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
      WHERE e.excerpt_id=?`
  ).get(excerptId) as {
    excerpt_id: string;
    item_id: string;
    locator_display: string;
    quoted_text: string | null;
    title: string;
    reference_code: string | null;
    repository_name: string | null;
  } | undefined : undefined;
  if (excerptId && !excerpt) throw new Error('The cited excerpt does not exist.');
  if (excerpt) {
    return {
      label: excerpt.title,
      itemId: excerpt.item_id,
      excerptId: excerpt.excerpt_id,
      repositoryName: excerpt.repository_name,
      referenceCode: excerpt.reference_code,
      locator: excerpt.locator_display,
      quote: excerpt.quoted_text,
    };
  }
  const lookups: Record<PrimarySourceSearchTargetKind, { sql: string; label: string }> = {
    source: { sql: 'SELECT title AS label, item_id AS item_id FROM archive_items WHERE item_id=?', label: 'source' },
    unit: { sql: 'SELECT title AS label, NULL AS item_id FROM archive_description_units WHERE unit_id=?', label: 'unit' },
    text_version: {
      sql: `SELECT i.title AS label, t.item_id AS item_id
              FROM archive_text_versions t JOIN archive_items i ON i.item_id=t.item_id
             WHERE t.text_version_id=?`,
      label: 'text version',
    },
    excerpt: {
      sql: `SELECT i.title AS label, e.item_id AS item_id
              FROM archive_excerpts e JOIN archive_items i ON i.item_id=e.item_id
             WHERE e.excerpt_id=?`,
      label: 'excerpt',
    },
    person: { sql: 'SELECT display_name AS label, NULL AS item_id FROM persons WHERE person_id=?', label: 'person' },
    event: { sql: `SELECT COALESCE(label, type) AS label, NULL AS item_id FROM events WHERE event_id=?`, label: 'event' },
    place: { sql: 'SELECT name AS label, NULL AS item_id FROM places WHERE place_id=?', label: 'place' },
    relation: {
      sql: `SELECT role AS label, NULL AS item_id FROM social_relations WHERE relation_id=?`,
      label: 'relation',
    },
    saved_search: { sql: 'SELECT name AS label, NULL AS item_id FROM saved_searches WHERE id=?', label: 'saved search' },
    note: { sql: 'SELECT title AS label, NULL AS item_id FROM notes WHERE id=?', label: 'note' },
  };
  const lookup = lookups[kind];
  const row = db.prepare(lookup.sql).get(id) as { label: string; item_id: string | null } | undefined;
  if (!row) throw new Error(`The linked ${lookup.label} does not exist.`);
  return {
    label: row.label,
    itemId: row.item_id,
    excerptId: kind === 'excerpt' ? id : null,
    repositoryName: null,
    referenceCode: null,
    locator: null,
    quote: null,
  };
}

function linkRows(noteId?: string): PrimarySourceResearchNoteLink[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT l.link_id, l.nodus_id, n.title AS note_title, l.target_kind,
            l.target_id, l.excerpt_id, l.relation_kind, l.created_at,
            s.quoted_text AS snapshot_quote, s.locator_display AS snapshot_locator,
            s.source_hash
       FROM note_links l
       JOIN notes n ON n.id=l.nodus_id
       LEFT JOIN primary_source_note_link_snapshots s ON s.link_id=l.link_id
      ${noteId ? 'WHERE l.nodus_id=?' : ''}
      ORDER BY l.created_at DESC`
  ).all(...(noteId ? [noteId] : [])) as Array<{
    link_id: string;
    nodus_id: string;
    note_title: string;
    target_kind: string;
    target_id: string;
    excerpt_id: string | null;
    relation_kind: string;
    created_at: string;
    snapshot_quote: string | null;
    snapshot_locator: string | null;
    source_hash: string | null;
  }>;
  return rows.flatMap((row) => {
    if (!SEARCH_TARGETS.includes(row.target_kind as PrimarySourceSearchTargetKind)) return [];
    let details: TargetDetails;
    try {
      details = targetDetails(
        row.target_kind as PrimarySourceSearchTargetKind,
        row.target_id,
        row.excerpt_id
      );
    } catch {
      details = {
        label: row.target_id,
        itemId: null,
        excerptId: row.excerpt_id,
        repositoryName: null,
        referenceCode: null,
        locator: row.snapshot_locator,
        quote: null,
      };
    }
    const currentHash = crypto.createHash('sha256')
      .update(`${details.quote ?? ''}\n${details.locator ?? ''}`)
      .digest('hex');
    return [{
      linkId: row.link_id,
      noteId: row.nodus_id,
      noteTitle: row.note_title,
      targetKind: row.target_kind as PrimarySourceSearchTargetKind,
      targetId: row.target_id,
      targetLabel: details.label,
      itemId: details.itemId,
      excerptId: details.excerptId,
      relationKind: normalizeRelation(row.relation_kind),
      repositoryName: details.repositoryName,
      referenceCode: details.referenceCode,
      locator: details.locator ?? row.snapshot_locator,
      quote: details.quote ?? row.snapshot_quote,
      citationChanged: Boolean(row.source_hash && row.source_hash !== currentHash),
      createdAt: row.created_at,
    }];
  });
}

export function getPrimarySourceNoteWorkspace(): PrimarySourceNoteWorkspace {
  const tree = getNotesTree();
  const allLinks = linkRows();
  const profiles = new Map(tree.notes.map((note) => [note.id, ensureNoteProfile(note.id)]));
  const notes: PrimarySourceResearchNote[] = tree.notes.map((note) => ({
    ...note,
    profile: profiles.get(note.id)!,
    links: allLinks.filter((link) => link.noteId === note.id),
    backlinkCount: allLinks.filter((link) => link.targetKind === 'note' && link.targetId === note.id).length,
  }));
  return {
    notes,
    collections: [...new Set(notes.map((note) => note.profile.collection).filter((value): value is string => Boolean(value)))].sort(),
    linkTargets: SEARCH_TARGETS.map((id) => ({ id, label: id })),
  };
}

export function createPrimarySourceNote(input: {
  title: string;
  content?: string;
  noteType?: PrimarySourceNoteType;
  status?: PrimarySourceNoteStatus;
  collection?: string | null;
  accessStatus?: PrimarySourceAccessStatus;
  sensitivity?: PrimarySourceSensitivity;
}): PrimarySourceResearchNote {
  const db = getDb();
  const transaction = db.transaction(() => {
    const note = createNote({
      title: input.title,
      content: input.content ?? '',
      kind: input.noteType === 'hypothesis' ? 'hypothesis' : 'markdown',
    });
    const timestamp = now();
    db.prepare(
      `INSERT INTO primary_source_note_profiles
        (note_id, note_type, status, collection, access_status, sensitivity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      note.id,
      normalizeNoteType(input.noteType),
      normalizeNoteStatus(input.status),
      clean(input.collection) || null,
      normalizeNoteAccess(input.accessStatus),
      normalizeNoteSensitivity(input.sensitivity),
      timestamp,
      timestamp
    );
    return note.id;
  });
  const noteId = transaction();
  return getPrimarySourceNoteWorkspace().notes.find((note) => note.id === noteId)!;
}

export function updatePrimarySourceNoteProfile(
  noteId: string,
  patch: PrimarySourceNoteProfilePatch
): PrimarySourceNoteProfile {
  const current = ensureNoteProfile(noteId);
  const next = {
    noteType: patch.noteType === undefined ? current.noteType : normalizeNoteType(patch.noteType),
    status: patch.status === undefined ? current.status : normalizeNoteStatus(patch.status),
    collection: patch.collection === undefined ? current.collection : clean(patch.collection) || null,
    accessStatus: patch.accessStatus === undefined ? current.accessStatus : normalizeNoteAccess(patch.accessStatus),
    sensitivity: patch.sensitivity === undefined ? current.sensitivity : normalizeNoteSensitivity(patch.sensitivity),
  };
  getDb().prepare(
    `UPDATE primary_source_note_profiles
        SET note_type=?, status=?, collection=?, access_status=?, sensitivity=?, updated_at=?
      WHERE note_id=?`
  ).run(next.noteType, next.status, next.collection, next.accessStatus, next.sensitivity, now(), noteId);
  return ensureNoteProfile(noteId);
}

export function addPrimarySourceNoteLink(input: PrimarySourceNoteLinkInput): PrimarySourceResearchNoteLink {
  if (!getNote(input.noteId)) throw new Error('The note does not exist.');
  const relation = normalizeRelation(input.relationKind);
  const details = targetDetails(input.targetKind, input.targetId, input.excerptId);
  const db = getDb();
  const transaction = db.transaction(() => {
    const existing = db.prepare(
      `SELECT link_id FROM note_links
        WHERE nodus_id=? AND target_kind=? AND target_id=? AND relation_kind=?`
    ).get(input.noteId, input.targetKind, input.targetId, relation) as { link_id: string } | undefined;
    const linkId = existing?.link_id ?? uuid();
    if (!existing) {
      db.prepare(
        `INSERT INTO note_links
          (link_id, nodus_id, target_kind, target_id, excerpt_id, relation_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(linkId, input.noteId, input.targetKind, input.targetId, details.excerptId, relation, now());
    } else if (details.excerptId) {
      db.prepare('UPDATE note_links SET excerpt_id=? WHERE link_id=?').run(details.excerptId, linkId);
    }
    const hash = crypto.createHash('sha256')
      .update(`${details.quote ?? ''}\n${details.locator ?? ''}`)
      .digest('hex');
    db.prepare(
      `INSERT INTO primary_source_note_link_snapshots
        (link_id, quoted_text, locator_display, source_hash, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(link_id) DO UPDATE SET
         quoted_text=excluded.quoted_text,
         locator_display=excluded.locator_display,
         source_hash=excluded.source_hash`
    ).run(linkId, details.quote, details.locator, hash, now());
    return linkId;
  });
  const linkId = transaction();
  return linkRows(input.noteId).find((link) => link.linkId === linkId)!;
}

export function removePrimarySourceNoteLink(linkId: string): boolean {
  return getDb().prepare('DELETE FROM note_links WHERE link_id=?').run(linkId).changes > 0;
}

export function getPrimarySourceBacklinks(
  targetKind: PrimarySourceSearchTargetKind,
  targetId: string
): PrimarySourceResearchNoteLink[] {
  return linkRows().filter((link) => link.targetKind === targetKind && link.targetId === targetId);
}

export function insertPrimarySourceExcerptCitation(input: PrimarySourceNoteLinkInput): PrimarySourceCitationInsertion {
  if (!input.excerptId) throw new Error('A literal citation requires an exact excerpt.');
  const link = addPrimarySourceNoteLink({ ...input, relationKind: 'quotes' });
  if (!link.itemId || !link.excerptId || !link.quote) {
    throw new Error('The excerpt does not contain a citable quotation.');
  }
  const citation = [
    link.repositoryName,
    link.referenceCode,
    link.locator,
  ].filter(Boolean).join(', ');
  const deepLink = primarySourceExcerptDeepLink(link.itemId, link.excerptId);
  return {
    link,
    markdown: `> “${link.quote.replace(/\s+/g, ' ').trim()}” — [${citation || link.targetLabel}](${deepLink})`,
  };
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = getDb().prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function latestTimestamp(sql: string): string | null {
  const row = getDb().prepare(sql).get() as { value: string | null } | undefined;
  return row?.value ?? null;
}

function dashboardTasks(): PrimarySourceDashboardTask[] {
  const definitions: Array<Omit<PrimarySourceDashboardTask, 'count' | 'targetIds'> & { sql: string }> = [
    {
      kind: 'missing_provenance',
      label: 'Importaciones sin procedencia',
      view: 'archive',
      sql: `SELECT i.item_id AS id FROM archive_items i
             WHERE NOT EXISTS (
               SELECT 1 FROM archive_item_units iu
                WHERE iu.item_id=i.item_id AND iu.relation_kind='describes'
             )`,
    },
    {
      kind: 'missing_reference',
      label: 'Unidades sin referencia',
      view: 'archive',
      sql: `SELECT DISTINCT iu.item_id AS id FROM archive_description_units u
             JOIN archive_item_units iu ON iu.unit_id=u.unit_id
            WHERE u.reference_code IS NULL OR trim(u.reference_code)=''`,
    },
    {
      kind: 'ocr_review',
      label: 'OCR pendiente de revisión',
      view: 'archive',
      sql: `SELECT DISTINCT item_id AS id FROM archive_text_versions
             WHERE kind='ocr' AND status<>'reviewed'`,
    },
    {
      kind: 'pending_proposals',
      label: 'Propuestas de entidades',
      view: 'archive',
      sql: `SELECT DISTINCT item_id AS id FROM archive_entity_proposals WHERE status='pending'`,
    },
    {
      kind: 'provisional_identities',
      label: 'Identidades provisionales',
      view: 'persons',
      sql: `SELECT DISTINCT person_id AS id FROM archive_person_mentions
             WHERE person_id IS NOT NULL AND identity_status<>'confirmed'`,
    },
    {
      kind: 'event_evidence',
      label: 'Eventos sin evidencia precisa',
      view: 'timeline',
      sql: `SELECT e.event_id AS id FROM events e
             WHERE NOT EXISTS (
               SELECT 1 FROM record_evidence re
                JOIN archive_excerpts x ON x.excerpt_id=re.excerpt_id
               WHERE re.target_kind='event' AND re.target_id=e.event_id
                 AND trim(COALESCE(x.quoted_text,''))<>''
             )`,
    },
    {
      kind: 'relation_evidence',
      label: 'Relaciones con una sola evidencia',
      view: 'relations',
      sql: `SELECT sr.relation_id AS id FROM social_relations sr
             WHERE (
               SELECT COUNT(*) FROM record_evidence re
                WHERE re.target_kind='social_relation' AND re.target_id=sr.relation_id
             ) <= 1`,
    },
    {
      kind: 'ambiguous_places',
      label: 'Lugares ambiguos',
      view: 'map',
      sql: `SELECT mention_id AS id FROM archive_place_mentions
             WHERE status IN ('unresolved','proposed')`,
    },
    {
      kind: 'restricted_export',
      label: 'Material restringido excluido de exportaciones',
      view: 'archive',
      sql: `SELECT export_id AS id FROM archive_exports WHERE excluded_files>0`,
    },
    {
      kind: 'integrity',
      label: 'Comprobaciones de integridad pendientes o fallidas',
      view: 'archive',
      sql: `SELECT DISTINCT item_id AS id FROM archive_item_files
             WHERE verification_status IN ('pending','mismatch','missing','error')`,
    },
  ];
  return definitions
    .map(({ sql, ...task }) => {
      const ids = (getDb().prepare(`${sql} LIMIT 1001`).all() as Array<{ id: string | null }>)
        .map((row) => row.id)
        .filter((id): id is string => Boolean(id));
      return { ...task, count: ids.length, targetIds: ids.slice(0, 1000) };
    })
    .filter((task) => task.count > 0);
}

function recentActivity(): PrimarySourceDashboardActivity[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, kind, label, detail, occurred_at, view, target_id FROM (
       SELECT 'source:' || item_id AS id, 'source' AS kind, title AS label,
              NULL AS detail, created_at AS occurred_at, 'archive' AS view,
              item_id AS target_id
         FROM archive_items
       UNION ALL
       SELECT 'text:' || text_version_id, 'text',
              CASE WHEN status='reviewed' THEN 'Texto revisado' ELSE 'Texto añadido' END,
              kind, COALESCE(reviewed_at, updated_at), 'archive', item_id
         FROM archive_text_versions
       UNION ALL
       SELECT 'proposal:' || proposal_id, 'proposal',
              CASE WHEN status='accepted' THEN 'Propuesta aceptada' ELSE 'Propuesta revisada' END,
              proposal_kind, COALESCE(reviewed_at, created_at), 'archive', item_id
         FROM archive_entity_proposals WHERE status<>'pending'
       UNION ALL
       SELECT 'note:' || id, 'note', title, NULL, updated_at, 'notes', id FROM notes
       UNION ALL
       SELECT 'export:' || export_id, 'export', 'Exportación realizada', kind,
              created_at, 'archive', export_id FROM archive_exports
     ) ORDER BY occurred_at DESC LIMIT 12`
  ).all() as Array<{
    id: string;
    kind: PrimarySourceDashboardActivity['kind'];
    label: string;
    detail: string | null;
    occurred_at: string;
    view: PrimarySourceDashboardActivity['view'];
    target_id: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    occurredAt: row.occurred_at,
    view: row.view,
    targetId: row.target_id,
  }));
}

export function getPrimarySourceOperationalDashboard(): PrimarySourceOperationalDashboard {
  const db = getDb();
  const latest = db.prepare(
    `SELECT i.item_id, i.title,
            (SELECT excerpt_id FROM archive_excerpts e
              WHERE e.item_id=i.item_id ORDER BY e.created_at DESC LIMIT 1) AS excerpt_id
       FROM archive_items i ORDER BY i.updated_at DESC LIMIT 1`
  ).get() as { item_id: string; title: string; excerpt_id: string | null } | undefined;
  return {
    metrics: {
      descriptionUnits: scalar('SELECT COUNT(*) AS count FROM archive_description_units'),
      preservedMasters: scalar(`SELECT COUNT(*) AS count FROM archive_item_files WHERE role='master'`),
      citationReadySources: scalar(`SELECT COUNT(*) AS count FROM archive_item_profiles WHERE citation_status='ready'`),
      identifiedPersons: scalar(
        `SELECT COUNT(DISTINCT person_id) AS count FROM archive_person_mentions
          WHERE person_id IS NOT NULL`
      ),
      documentedEvents: scalar(
        `SELECT COUNT(DISTINCT e.event_id) AS count FROM events e
          JOIN record_evidence re ON re.target_kind='event' AND re.target_id=e.event_id
          JOIN archive_excerpts x ON x.excerpt_id=re.excerpt_id
         WHERE trim(COALESCE(x.quoted_text,''))<>''`
      ),
      resolvedPlaces: scalar(
        `SELECT COUNT(DISTINCT place_id) AS count FROM archive_place_mentions
          WHERE place_id IS NOT NULL AND status='resolved'`
      ),
    },
    tasks: dashboardTasks(),
    recentActivity: recentActivity(),
    preservation: {
      lastBackupAt: latestTimestamp(
        `SELECT MAX(created_at) AS value FROM archive_exports WHERE kind IN ('backup','complete_backup')`
      ),
      lastInventoryAt: latestTimestamp(
        `SELECT MAX(checked_at) AS value FROM archive_integrity_checks`
      ),
      verifiedFiles: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files WHERE verification_status='verified'`
      ),
      pendingFiles: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files WHERE verification_status='pending'`
      ),
      missingFiles: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files WHERE verification_status='missing'`
      ),
      failedChecks: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files WHERE verification_status IN ('mismatch','error')`
      ),
      orphanDerivatives: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files f
          LEFT JOIN archive_item_files p ON p.file_id=f.parent_file_id
         WHERE f.role='derivative' AND p.file_id IS NULL`
      ),
      unhashedLegacyFiles: scalar(
        `SELECT COUNT(*) AS count FROM archive_item_files
          WHERE role='master' AND (content_hash IS NULL OR trim(content_hash)='')`
      ),
      originalsWithoutCopy: scalar(
        `SELECT COUNT(DISTINCT m.item_id) AS count FROM archive_item_files m
          WHERE m.role='master' AND NOT EXISTS (
            SELECT 1 FROM archive_item_files a
             WHERE a.item_id=m.item_id AND a.role IN ('access','derivative')
          )`
      ),
      vaultSizeBytes: scalar(
        `SELECT COALESCE(SUM(byte_size),0) AS count FROM archive_item_files`
      ),
    },
    latestSource: latest ? {
      itemId: latest.item_id,
      title: latest.title,
      excerptId: latest.excerpt_id,
    } : null,
  };
}

/** Test helper: all note profiles remain attached to a real shared note. */
export function primarySourceNoteProfileCount(): number {
  return scalar('SELECT COUNT(*) AS count FROM primary_source_note_profiles');
}
