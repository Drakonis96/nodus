/**
 * The encyclopedia of an invented world: keys, wiki-links, the A–Z index and the ranking
 * that turns one search box into both the index and the link autocomplete.
 *
 * Pure and dependency-free (beyond the filter helpers it shares with the other world
 * collections), so all of it is unit-tested without a database, a renderer or a model.
 *
 * Two rules run through the whole file and explain most of its shape:
 *
 *  - **An entry is addressed by kind AND id.** Ids are unique per table, never across the
 *    world, so `prs_1` the character and `plc_1` the place can only be told apart by the
 *    kind. Everything — the React key, the link target, the export anchor, the stored
 *    `target_key` — is the one string `entryKey()` builds.
 *  - **Folding is done in JavaScript, never in SQL.** SQLite's `LOWER()` is ASCII-only and
 *    would file «Vael» and «Vaël» as two different things, in a genre where half the
 *    proper nouns carry a diaeresis.
 */

import { normalizeForSearch } from './worldFilters';
import type {
  WorldArticleCategory,
  WorldEntry,
  WorldEntryKey,
  WorldEntryKind,
  WorldEntryRef,
} from './types';

// ── Vocabulary ───────────────────────────────────────────────────────────────

// `conflict` is here and `arc` is NOT, and that asymmetry is deliberate: a war is a thing
// the world contains and a reader can be told about, while an arc is spoiler by nature —
// it is the shape of a character's change, and an encyclopedia entry for it would put the
// ending of the book in the index.
export const WORLD_ENTRY_KINDS: WorldEntryKind[] = ['article', 'character', 'place', 'group', 'scene', 'map', 'conflict', 'rule'];

export const WORLD_ENTRY_KIND_LABEL: Record<WorldEntryKind, string> = {
  article: 'Artículo',
  character: 'Personaje',
  place: 'Lugar',
  group: 'Facción o cultura',
  scene: 'Escena',
  map: 'Mapa',
  conflict: 'Conflicto',
  rule: 'Regla',
};

export const ARTICLE_CATEGORIES: WorldArticleCategory[] = [
  'magic', 'religion', 'language', 'creature', 'species', 'artifact', 'technology',
  'concept', 'event', 'organization', 'flora', 'fauna', 'custom', 'other',
];

export const ARTICLE_CATEGORY_LABEL: Record<WorldArticleCategory, string> = {
  magic: 'Sistema de magia',
  religion: 'Religión',
  language: 'Lengua',
  creature: 'Criatura',
  species: 'Especie',
  artifact: 'Artefacto',
  technology: 'Tecnología',
  concept: 'Concepto',
  event: 'Suceso',
  organization: 'Organización',
  flora: 'Flora',
  fauna: 'Fauna',
  custom: 'Costumbre',
  other: 'Otro',
};

/** Which text a link or a full-text hit was found in. Stored as the raw field name so a
 *  reindex of one field never wipes another's links; translated only for display. */
export const WORLD_LINK_FIELD_LABEL: Record<string, string> = {
  body: 'Cuerpo',
  summary: 'Resumen',
  notes: 'Notas',
  backstory: 'Trasfondo',
  personality: 'Personalidad',
  appearance: 'Apariencia',
  atmosphere: 'Atmósfera',
  history: 'Historia',
  description: 'Descripción',
  biography: 'Biografía',
  pitch: 'De qué va',
  stakes: 'Qué se pierde',
  outcome: 'Cómo acaba',
  statement: 'La regla',
  cost: 'Qué cuesta romperla',
  limits: 'Hasta dónde no llega',
};

export function isArticleCategory(value: unknown): value is WorldArticleCategory {
  return typeof value === 'string' && (ARTICLE_CATEGORIES as string[]).includes(value);
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export function entryKey(ref: WorldEntryRef): WorldEntryKey {
  return `${ref.kind}:${ref.id}`;
}

export function parseEntryKey(key: string): WorldEntryRef | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id || !(WORLD_ENTRY_KINDS as string[]).includes(kind)) return null;
  return { kind: kind as WorldEntryKind, id };
}

/**
 * The `target_key` of a link whose target nobody has defined yet. One column holds both
 * forms because every query is "the rows pointing at X"; the `?:` prefix cannot collide
 * with a real key, since no entry kind is named `?`.
 */
export function pendingKey(text: string): string {
  return `?:${normalizeTitle(text)}`;
}

export function isPendingKey(key: string): boolean {
  return key.startsWith('?:');
}

export function pendingText(key: string): string | null {
  return isPendingKey(key) ? key.slice(2) : null;
}

/** The stored `title_key`: accents folded, lowercased, inner whitespace collapsed. */
export function normalizeTitle(value: string): string {
  return normalizeForSearch(value).replace(/\s+/g, ' ');
}

/**
 * The letter an entry files under. Folds accents (`Ä`→`A`, `ñ`→`N`) so a world does not
 * grow a separate section for every diacritic, and sends digits, symbols and scripts
 * without a Latin letter to `#` rather than to a heading nobody can jump to.
 */
export function alphaBucket(label: string): string {
  const first = (label ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0);
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : '#';
}

// ── Wiki-links ───────────────────────────────────────────────────────────────

/** The resolved form, stored in the body: ordinary Markdown pointing at a `nodus://` URL,
 *  not a second syntax, so every renderer already knows what to do with it. */
export function formatWorldLink(ref: WorldEntryRef, label: string): string {
  return `[${label.replace(/[[\]]/g, '')}](nodus://world/${ref.kind}/${encodeURIComponent(ref.id)})`;
}

export interface ResolvedWorldLink {
  status: 'resolved';
  target: WorldEntryRef;
  label: string;
}

export interface PendingWorldLink {
  status: 'pending';
  /** Verbatim, as typed. `pendingKey()` normalises it for storage. */
  text: string;
}

export type ParsedWorldLink = ResolvedWorldLink | PendingWorldLink;

const RESOLVED_LINK_RE = /\[([^\]\n]*)\]\(nodus:\/\/world\/([a-z]+)\/([^)\s]+)\)/g;
const PENDING_LINK_RE = /\[\[([^\][\n]+)\]\]/g;

/**
 * Every link in a body, in order, deduplicated by target with a count.
 *
 * Code is skipped: an author pasting a snippet with `[[…]]` in it is not linking, and a
 * `nodus://` URL inside a fence is being shown, not followed.
 */
export function parseWorldLinks(body: string): { link: ParsedWorldLink; occurrences: number }[] {
  const counts = new Map<string, { link: ParsedWorldLink; occurrences: number }>();
  const add = (key: string, link: ParsedWorldLink) => {
    const existing = counts.get(key);
    if (existing) existing.occurrences += 1;
    // The FIRST label wins: it is the one the reader meets, and a link inspector that
    // reported the last one would describe a mention nobody has read yet.
    else counts.set(key, { link, occurrences: 1 });
  };

  for (const segment of proseSegments(body ?? '')) {
    for (const match of segment.matchAll(RESOLVED_LINK_RE)) {
      const kind = match[2];
      if (!(WORLD_ENTRY_KINDS as string[]).includes(kind)) continue;
      const target: WorldEntryRef = { kind: kind as WorldEntryKind, id: safeDecode(match[3]) };
      add(entryKey(target), { status: 'resolved', target, label: match[1] });
    }
    for (const match of segment.matchAll(PENDING_LINK_RE)) {
      const text = match[1].trim();
      if (!text) continue;
      add(pendingKey(text), { status: 'pending', text });
    }
  }
  return [...counts.values()];
}

/**
 * Prepare a body for the reader: `[[X]]` becomes a link to the reserved `new` kind, so
 * react-markdown renders it and the reader can offer to create the missing entry. Doing
 * it here rather than with a remark plugin keeps the stored body honest — what the author
 * typed is what is saved.
 */
export function toRenderableBody(body: string): string {
  return mapProse(body ?? '', (segment) =>
    segment.replace(PENDING_LINK_RE, (whole, text: string) => {
      const trimmed = text.trim();
      return trimmed ? `[${trimmed}](nodus://world/new/${encodeURIComponent(trimmed)})` : whole;
    })
  );
}

/**
 * Promote the `[[X]]` links whose text now names a real entry, leaving the rest alone.
 *
 * This is what makes typing `[[Kaelen Vor]]` and saving equivalent to picking Kaelen from
 * the autocomplete, and it is also how creating an entry from a red link repairs every
 * body that was already waiting for it.
 */
export function resolvePendingLinks(
  body: string,
  resolve: (normalized: string) => WorldEntryRef | null
): { body: string; resolved: number } {
  let resolved = 0;
  const next = mapProse(body ?? '', (segment) =>
    segment.replace(PENDING_LINK_RE, (whole, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return whole;
      const target = resolve(normalizeTitle(trimmed));
      if (!target) return whole;
      resolved += 1;
      return formatWorldLink(target, trimmed);
    })
  );
  return { body: next, resolved };
}

/** Every name an entry answers to, folded — the resolver's lookup table. */
export function entryLookup(entries: WorldEntry[]): Map<string, WorldEntryRef> {
  const lookup = new Map<string, WorldEntryRef>();
  for (const entry of entries) {
    for (const name of [entry.title, ...entry.aliases]) {
      const key = normalizeTitle(name ?? '');
      // First writer wins, and entries arrive oldest-first, so a name collision resolves
      // to the entry that has carried it longest rather than to whichever sorted first.
      if (key && !lookup.has(key)) lookup.set(key, { kind: entry.kind, id: entry.id });
    }
  }
  return lookup;
}

// ── Search and ranking ───────────────────────────────────────────────────────

export interface WorldEntryHit {
  entry: WorldEntry;
  score: number;
  matched: 'title' | 'alias' | 'summary' | 'category';
}

const KIND_ORDER: Record<WorldEntryKind, number> = {
  article: 0, rule: 1, character: 2, place: 3, group: 4, conflict: 5, scene: 6, map: 7,
};

/**
 * Rank, do not filter: an empty query returns the whole world in A–Z order, which is what
 * makes this the same code path as the index itself instead of a second one that can
 * disagree with it.
 */
export function searchWorldEntries(entries: WorldEntry[], query: string, limit?: number): WorldEntryHit[] {
  const needle = normalizeTitle(query ?? '');
  if (!needle) {
    const all = [...entries]
      .sort((a, b) => a.titleKey.localeCompare(b.titleKey) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
      .map((entry): WorldEntryHit => ({ entry, score: 0, matched: 'title' }));
    return limit == null ? all : all.slice(0, limit);
  }

  const hits: WorldEntryHit[] = [];
  for (const entry of entries) {
    const title = entry.titleKey;
    let score = 0;
    let matched: WorldEntryHit['matched'] = 'title';
    if (title === needle) score = 100;
    else if (title.startsWith(needle)) score = 80;
    else if (title.includes(needle)) score = 50;

    if (score < 100) {
      for (const alias of entry.aliases) {
        const folded = normalizeTitle(alias ?? '');
        if (!folded) continue;
        const aliasScore = folded === needle ? 70 : folded.includes(needle) ? 40 : 0;
        if (aliasScore > score) {
          score = aliasScore;
          matched = 'alias';
        }
      }
    }
    if (score === 0 && entry.summary && normalizeTitle(entry.summary).includes(needle)) {
      score = 20;
      matched = 'summary';
    }
    if (score === 0 && entry.category && normalizeTitle(entry.category).includes(needle)) {
      score = 10;
      matched = 'category';
    }
    if (score > 0) hits.push({ entry, score, matched });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] ||
      a.entry.titleKey.localeCompare(b.entry.titleKey)
  );
  // Truncating AFTER the sort is the point: a limit that cut by insertion order would
  // drop the exact title match whenever it happened to be loaded last.
  return limit == null ? hits : hits.slice(0, limit);
}

/** The `[[` autocomplete. Same ranking, but a bare `[[` offers the most recently touched
 *  entries rather than the alphabet, because that is what an author is usually reaching
 *  for mid-sentence. */
export function rankEntryCandidates(entries: WorldEntry[], fragment: string, limit = 8): WorldEntry[] {
  if (!normalizeTitle(fragment ?? '')) {
    return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  return searchWorldEntries(entries, fragment, limit).map((hit) => hit.entry);
}

/**
 * A window of `text` around the first occurrence of `needle`, with ellipses where it was
 * cut. The folding here is length-preserving on purpose: an NFD-and-strip fold shortens
 * the string, and every index computed against it would then point at the wrong character
 * of the original — off by one per accent, which is invisible in English and constant in
 * Spanish.
 */
export function extractSnippet(text: string, needle: string, radius = 70): string {
  const haystack = text ?? '';
  const folded = foldPreservingLength(haystack);
  const target = foldPreservingLength(needle ?? '').trim();
  const at = target ? folded.indexOf(target) : -1;
  if (at < 0) {
    return haystack.length <= radius * 2 ? haystack.trim() : `${haystack.slice(0, radius * 2).trim()}…`;
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(haystack.length, at + target.length + radius);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
}

/** Lowercase and strip diacritics **one character at a time**, so the result has exactly
 *  as many characters as the input and indexes into it stay valid. */
export function foldPreservingLength(value: string): string {
  let out = '';
  for (const char of value ?? '') {
    const folded = char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Any transformation that changes the character COUNT is refused rather than applied:
    // a lone combining mark folds to nothing, an emoji is a surrogate pair, and either
    // would shift every index after it by one. Positional integrity is the whole point.
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

// ── Code-aware traversal ─────────────────────────────────────────────────────

// Fenced blocks first, so a stray backtick inside one cannot open an inline span.
const CODE_SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/** Apply `fn` to the prose of a Markdown body, leaving code exactly as written. */
function mapProse(text: string, fn: (segment: string) => string): string {
  return text
    .split(CODE_SEGMENT_RE)
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join('');
}

/** The prose halves of a Markdown body, code removed. Shared with the placeholder scan:
 *  a `???` inside a fence is being shown, not left to decide. */
export function proseSegments(text: string): string[] {
  return (text ?? '').split(CODE_SEGMENT_RE).filter((_, index) => index % 2 === 0);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A body can be hand-edited, and a stray `%` must not take the whole index down.
    return value;
  }
}
