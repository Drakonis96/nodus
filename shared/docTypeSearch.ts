/**
 * Literal + "semantic" search over the ~190 archive document types, for the type
 * picker. Offline and dependency-free (no embeddings): it ranks by exact/prefix/
 * substring hits on the bilingual labels and on each type's curated `keywords`
 * (synonyms), and falls back to a fuzzy Dice-coefficient similarity so an inexact or
 * mistyped query still surfaces apt suggestions ("tumba" → Lápida, "chirch" → Church).
 * Pure so it is unit-tested without a DOM.
 */

import { ARCHIVE_DOC_TYPES, type ArchiveDocTypeDef } from './archiveDocTypes';

/** Lowercase, strip accents, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const clean = s.replace(/[^a-z0-9]/g, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity of two strings over character bigrams (0..1). */
export function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** All normalized haystacks for a type: every label + keywords, plus their tokens. */
function haystacks(def: ArchiveDocTypeDef): { phrases: string[]; tokens: Set<string> } {
  // Every language's label is searchable, so a type can be found by its name in any
  // interface language regardless of which one is active.
  const phrases = [...new Set([...Object.values(def.labels), ...def.keywords])].map(normalizeText).filter(Boolean);
  const tokens = new Set<string>();
  for (const p of phrases) for (const tok of p.split(' ')) if (tok.length >= 2) tokens.add(tok);
  return { phrases, tokens };
}

/** Score one type against a normalized query (0 = no match). Higher is better. */
function scoreType(def: ArchiveDocTypeDef, q: string): number {
  const { phrases, tokens } = haystacks(def);
  let best = 0;
  for (const p of phrases) {
    if (p === q) best = Math.max(best, 1000);
    else if (p.startsWith(q)) best = Math.max(best, 820);
    else if (p.includes(q)) best = Math.max(best, 640);
  }
  if (best < 640) {
    for (const tok of tokens) {
      if (tok === q) best = Math.max(best, 720);
      else if (tok.startsWith(q)) best = Math.max(best, 560);
      else if (q.length >= 3 && tok.includes(q)) best = Math.max(best, 420);
    }
  }
  // Fuzzy fallback for typos / near-misses, only when nothing better fired.
  if (best < 420 && q.length >= 3) {
    let fuzzy = 0;
    for (const p of phrases) fuzzy = Math.max(fuzzy, diceCoefficient(q, p));
    for (const tok of tokens) if (Math.abs(tok.length - q.length) <= 3) fuzzy = Math.max(fuzzy, diceCoefficient(q, tok));
    if (fuzzy >= 0.34) best = Math.max(best, Math.round(fuzzy * 380));
  }
  return best;
}

export interface DocTypeSearchOptions {
  /** Restrict the searched set (e.g. only genealogy-relevant types). */
  pool?: ArchiveDocTypeDef[];
  /** Cap the number of results (default: all matches). */
  limit?: number;
}

/**
 * Ranked types matching `query` (literal + fuzzy/synonym). An empty query returns the
 * pool unchanged (the UI groups those by category). Multi-word queries require every
 * word to contribute a hit, so "iglesia romanica" narrows rather than widens.
 */
export function searchDocTypes(query: string, opts: DocTypeSearchOptions = {}): ArchiveDocTypeDef[] {
  const pool = opts.pool ?? ARCHIVE_DOC_TYPES;
  const q = normalizeText(query);
  if (!q) return opts.limit ? pool.slice(0, opts.limit) : pool;

  const words = q.split(' ').filter(Boolean);
  const scored: { def: ArchiveDocTypeDef; score: number }[] = [];
  for (const def of pool) {
    let total = 0;
    let ok = true;
    for (const w of words) {
      const s = scoreType(def, w);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) scored.push({ def, score: total / words.length });
  }
  scored.sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label));
  const result = scored.map((s) => s.def);
  return opts.limit ? result.slice(0, opts.limit) : result;
}
