/**
 * Frozen reading snapshot for a complete study guide.
 *
 * The search index repeats every chunk once per placement and overlaps chunks by
 * 180 characters, which is right for ranking and wrong for reading a source from
 * start to finish. The snapshot is therefore built from the source text itself:
 * one non-overlapping sequence of passages per source, in document order, each
 * with the exact locator (page, slide, heading offset or time window) that later
 * becomes the citation. Nothing here depends on embeddings or on a query.
 */
import { parseStudyMaterialMarkers } from '../studyMaterials';
import type { StudySearchScope } from '../studySearch';
import type { StudySourceOrganization } from '../studySourceTree';
import { studyOrganizationPaths } from '../studySourceTree';
import type { CompleteGuideResolvedSource, CompleteGuideSourceKind } from './types';

export const COMPLETE_GUIDE_PASSAGE_MAX_CHARS = 3_600;
/** A lecture window closes after this many seconds even if it is short in text. */
export const COMPLETE_GUIDE_TRANSCRIPT_WINDOW_SECONDS = 180;
/** Rough characters-per-token used for planning, deliberately conservative. */
export const COMPLETE_GUIDE_CHARS_PER_TOKEN = 3.6;

export type CompleteGuideLocator =
  | { kind: 'page'; page: number; from: number; to: number }
  | { kind: 'slide'; slide: number; from: number; to: number }
  | { kind: 'offset'; from: number; to: number; heading?: string }
  | { kind: 'time'; start: number; end: number; segmentIds: string[] };

export interface CompleteGuidePassage {
  /** `${alias}.${ordinal}`: short enough for prompts, unique inside one snapshot. */
  id: string;
  sourceKey: string;
  ordinal: number;
  text: string;
  locator: CompleteGuideLocator;
  /** Hash of the normalized text: the cache and duplicate identity of the passage. */
  contentHash: string;
  chars: number;
  /** Same text already present earlier in the snapshot (e.g. a copied handout). */
  duplicateOf?: string;
}

export interface CompleteGuideSnapshotSource {
  sourceKey: string;
  kind: CompleteGuideSourceKind;
  sourceId: string;
  title: string;
  /** A1… materials, D1… notes, G1… recordings. Used in labels, never invented by a model. */
  alias: string;
  /** Resolved placement used for ordering and for assigning units. */
  placement: StudySearchScope;
  /** Human path of that placement: course / subject / folders / unit. */
  path: string;
  locatorKind: 'page' | 'slide' | 'offset' | 'time';
  passageIds: string[];
  chars: number;
  pages?: { total: number; withText: number; empty: number[] };
  updatedAt: string;
}

export interface CompleteGuideSnapshotIssue {
  sourceKey: string;
  title: string;
  code: 'pages_without_text' | 'no_text' | 'duplicate_passages';
  detail: string;
}

export interface CompleteGuideSnapshot {
  version: 1;
  sources: CompleteGuideSnapshotSource[];
  passages: CompleteGuidePassage[];
  totals: { sources: number; passages: number; readablePassages: number; chars: number; pages: number; estimatedTokens: number };
  issues: CompleteGuideSnapshotIssue[];
}

export interface CompleteGuideSourceText {
  source: CompleteGuideResolvedSource;
  updatedAt: string;
  /** Materials: visual description + extracted text (with page/slide markers). Notes: Markdown. */
  text?: string;
  /** Transcripts: ordered segments of the chosen transcript. */
  segments?: Array<{ id: string; start: number; end: number; text: string }>;
}

/** Stable, dependency-free 53-bit hash (cyrb53) rendered as hex. */
export function completeGuideHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function normalizePassageText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/** Split a block into non-overlapping pieces, preferring paragraph then sentence ends. */
export function splitReadingBlock(text: string, max = COMPLETE_GUIDE_PASSAGE_MAX_CHARS): Array<{ text: string; from: number; to: number }> {
  const pieces: Array<{ text: string; from: number; to: number }> = [];
  let from = 0;
  while (from < text.length) {
    let to = Math.min(text.length, from + max);
    if (to < text.length) {
      const window = text.slice(from, to);
      const paragraph = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '), window.lastIndexOf('! '));
      const line = window.lastIndexOf('\n');
      const cut = paragraph > max * 0.5 ? paragraph + 2 : sentence > max * 0.5 ? sentence + 2 : line > max * 0.5 ? line + 1 : -1;
      if (cut > 0) to = from + cut;
    }
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) pieces.push({ text: trimmed, from: from + lead, to: from + lead + trimmed.length });
    from = to;
  }
  return pieces;
}

interface DraftPassage { text: string; locator: CompleteGuideLocator }

function materialPassages(text: string): { passages: DraftPassage[]; pages?: CompleteGuideSnapshotSource['pages']; locatorKind: 'page' | 'slide' | 'offset' } {
  const markers = parseStudyMaterialMarkers(text);
  if (!markers.length) {
    return { locatorKind: 'offset', passages: splitReadingBlock(text).map((piece) => ({ text: piece.text, locator: { kind: 'offset', from: piece.from, to: piece.to } })) };
  }
  const passages: DraftPassage[] = [];
  // Text before the first marker is the visual description of an image material or
  // a cover/preamble: it is read too, located by offset.
  const preamble = text.slice(0, markers[0].from);
  for (const piece of splitReadingBlock(preamble)) passages.push({ text: piece.text, locator: { kind: 'offset', from: piece.from, to: piece.to } });
  const empty: number[] = [];
  let withText = 0;
  const slides = markers.every((marker) => marker.kind === 'slide');
  for (const [index, marker] of markers.entries()) {
    const end = markers[index + 1]?.from ?? text.length;
    const block = text.slice(marker.from, end);
    const bodyStart = marker.from + (block.match(/^\[\[[^\]]+\]\]\s*/)?.[0].length ?? 0);
    const body = text.slice(bodyStart, end);
    const pieces = splitReadingBlock(body);
    if (!pieces.length) { empty.push(marker.number); continue; }
    withText += 1;
    for (const piece of pieces) {
      const from = bodyStart + piece.from;
      const to = bodyStart + piece.to;
      passages.push({
        text: piece.text,
        locator: marker.kind === 'page' ? { kind: 'page', page: marker.number, from, to } : { kind: 'slide', slide: marker.number, from, to },
      });
    }
  }
  return { locatorKind: slides ? 'slide' : 'page', passages, pages: { total: markers.length, withText, empty } };
}

function documentPassages(markdown: string): DraftPassage[] {
  // Keep a heading with the paragraphs under it; start a new passage at a heading
  // once the current one has real content, or when the size limit is reached.
  const passages: DraftPassage[] = [];
  const headingPattern = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
  const headings = [...markdown.matchAll(headingPattern)].map((match) => ({ at: match.index ?? 0, title: match[1].trim() }));
  const boundaries = [0, ...headings.map((heading) => heading.at).filter((at) => at > 0), markdown.length];
  let pendingFrom = 0;
  const headingAt = (offset: number) => [...headings].reverse().find((heading) => heading.at <= offset)?.title;
  const flush = (from: number, to: number) => {
    for (const piece of splitReadingBlock(markdown.slice(from, to))) {
      const start = from + piece.from;
      passages.push({ text: piece.text, locator: { kind: 'offset', from: start, to: from + piece.to, ...(headingAt(start) ? { heading: headingAt(start) } : {}) } });
    }
  };
  for (let index = 1; index < boundaries.length; index += 1) {
    const at = boundaries[index];
    const isLast = index === boundaries.length - 1;
    if (isLast || markdown.slice(pendingFrom, at).trim().length >= 1_200) {
      flush(pendingFrom, at);
      pendingFrom = at;
    }
  }
  return passages;
}

function transcriptPassages(segments: NonNullable<CompleteGuideSourceText['segments']>): DraftPassage[] {
  const passages: DraftPassage[] = [];
  let window: typeof segments = [];
  const flush = () => {
    const text = window.map((segment) => segment.text.trim()).filter(Boolean).join(' ');
    if (text) passages.push({ text, locator: { kind: 'time', start: window[0].start, end: window[window.length - 1].end, segmentIds: window.map((segment) => segment.id) } });
    window = [];
  };
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const chars = window.reduce((sum, item) => sum + item.text.length + 1, 0);
    if (window.length && (segment.end - window[0].start > COMPLETE_GUIDE_TRANSCRIPT_WINDOW_SECONDS || chars + segment.text.length > COMPLETE_GUIDE_PASSAGE_MAX_CHARS)) flush();
    window.push(segment);
  }
  if (window.length) flush();
  return passages;
}

function positionKey(scope: StudySearchScope, organization: StudySourceOrganization): number[] {
  const position = <T extends { id: string; position: number }>(items: T[], id: string | null) => {
    if (!id) return Number.MAX_SAFE_INTEGER;
    return items.find((item) => item.id === id)?.position ?? Number.MAX_SAFE_INTEGER - 1;
  };
  const chain = <T extends { id: string; position: number }>(items: T[], parentOf: (item: T) => string | null, id: string | null) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const list: number[] = [];
    const seen = new Set<string>();
    let current = id ? byId.get(id) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      list.unshift(current.position);
      const parent = parentOf(current);
      current = parent ? byId.get(parent) : undefined;
    }
    return list;
  };
  const folders = chain(organization.folders, (folder) => folder.parentId, scope.folderId);
  const topics = chain(organization.topics, (topic) => topic.parentId, scope.topicId);
  return [
    position(organization.courses, scope.courseId),
    position(organization.subjects, scope.subjectId),
    ...padded(folders, 6),
    ...padded(topics, 6),
  ];
}

function padded(values: number[], length: number): number[] {
  // An ancestor sorts before its descendants: missing levels sort first.
  return [...values, ...Array.from({ length: Math.max(0, length - values.length) }, () => -1)].slice(0, length);
}

function compareKeys(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? -1) - (b[index] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

const KIND_ORDER: Record<CompleteGuideSourceKind, number> = { material: 0, document: 1, transcript: 2 };
const ALIAS_PREFIX: Record<CompleteGuideSourceKind, string> = { material: 'A', document: 'D', transcript: 'G' };

export function buildCompleteGuideSnapshot(inputs: CompleteGuideSourceText[], organization: StudySourceOrganization): CompleteGuideSnapshot {
  const paths = studyOrganizationPaths(organization);
  const empty: StudySearchScope = { courseId: null, subjectId: null, folderId: null, topicId: null };
  const ordered = inputs.map((input) => {
    const placement = input.source.matchedPlacements[0] ?? input.source.placements[0] ?? empty;
    return { input, placement, key: positionKey(placement, organization) };
  }).sort((a, b) => compareKeys(a.key, b.key)
    || KIND_ORDER[a.input.source.kind] - KIND_ORDER[b.input.source.kind]
    || a.input.source.title.localeCompare(b.input.source.title, undefined, { numeric: true, sensitivity: 'base' })
    || a.input.source.sourceKey.localeCompare(b.input.source.sourceKey));

  const counters: Record<CompleteGuideSourceKind, number> = { material: 0, document: 0, transcript: 0 };
  const sources: CompleteGuideSnapshotSource[] = [];
  const passages: CompleteGuidePassage[] = [];
  const issues: CompleteGuideSnapshotIssue[] = [];
  const firstByHash = new Map<string, string>();
  let pages = 0;

  for (const { input, placement } of ordered) {
    const { source } = input;
    counters[source.kind] += 1;
    const alias = `${ALIAS_PREFIX[source.kind]}${counters[source.kind]}`;
    let drafts: DraftPassage[];
    let locatorKind: CompleteGuideSnapshotSource['locatorKind'];
    let pageInfo: CompleteGuideSnapshotSource['pages'];
    if (source.kind === 'material') {
      const result = materialPassages(input.text ?? '');
      drafts = result.passages; locatorKind = result.locatorKind; pageInfo = result.pages;
    } else if (source.kind === 'document') {
      drafts = documentPassages(input.text ?? ''); locatorKind = 'offset';
    } else {
      drafts = transcriptPassages(input.segments ?? []); locatorKind = 'time';
    }
    const ids: string[] = [];
    let chars = 0;
    let duplicates = 0;
    for (const [index, draft] of drafts.entries()) {
      const id = `${alias}.${index + 1}`;
      const contentHash = completeGuideHash(normalizePassageText(draft.text));
      const duplicateOf = firstByHash.get(contentHash);
      if (!duplicateOf) firstByHash.set(contentHash, id); else duplicates += 1;
      passages.push({ id, sourceKey: source.sourceKey, ordinal: index + 1, text: draft.text, locator: draft.locator, contentHash, chars: draft.text.length, ...(duplicateOf ? { duplicateOf } : {}) });
      ids.push(id);
      chars += draft.text.length;
    }
    if (pageInfo) pages += pageInfo.total;
    sources.push({
      sourceKey: source.sourceKey, kind: source.kind, sourceId: source.sourceId, title: source.title, alias,
      placement, path: paths.label(placement), locatorKind, passageIds: ids, chars,
      ...(pageInfo ? { pages: pageInfo } : {}), updatedAt: input.updatedAt,
    });
    if (!ids.length) issues.push({ sourceKey: source.sourceKey, title: source.title, code: 'no_text', detail: 'Sin texto legible.' });
    if (pageInfo?.empty.length) {
      issues.push({ sourceKey: source.sourceKey, title: source.title, code: 'pages_without_text', detail: compactRanges(pageInfo.empty) });
    }
    if (duplicates) issues.push({ sourceKey: source.sourceKey, title: source.title, code: 'duplicate_passages', detail: String(duplicates) });
  }

  const readable = passages.filter((passage) => !passage.duplicateOf);
  const totalChars = readable.reduce((sum, passage) => sum + passage.chars, 0);
  return {
    version: 1,
    sources,
    passages,
    totals: {
      sources: sources.length,
      passages: passages.length,
      readablePassages: readable.length,
      chars: totalChars,
      pages,
      estimatedTokens: Math.ceil(totalChars / COMPLETE_GUIDE_CHARS_PER_TOKEN),
    },
    issues,
  };
}

/** `[1,2,3,7,9,10]` → `1–3, 7, 9–10`. Also used for "para ampliar" page ranges. */
export function compactRanges(values: number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) { end += 1; index += 1; }
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(', ');
}
