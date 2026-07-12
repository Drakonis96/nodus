/**
 * Evidence-driven kinship inference — the heart of Nodus's promise that AI never
 * contaminates a family tree. This pure module turns *evidence* into *proposals*:
 * it never asserts a relationship, and it produces NOTHING from a bare co-mention of
 * two names. Only two kinds of real evidence generate a candidate parent/spouse edge:
 *
 *   1. `record_role` — a structured record's participant roles imply kinship: a
 *      baptism naming father/mother of the baptised child; a marriage naming the two
 *      spouses. These are inferred conservatively (a marriage's principals are NOT
 *      treated as anyone's children, so "padre del contrayente" is never mis-assigned).
 *   2. `explicit_claim` — the source text states the relationship outright ("mi padre
 *      Juan", "su esposa María"), extracted with its verbatim quote.
 *
 * Candidates carry a weight; the store accumulates them per person-pair. A suggestion
 * only surfaces once its accumulated score crosses a threshold, so a single weak
 * signal waits for corroboration — the Genealogical Proof Standard as code. The user
 * always confirms (→ an ai_confirmed relationship) or dismisses.
 *
 * Dependency-free and unit-tested without any DB or AI call.
 */

import type { KinSignal, KinStrength } from './types';

export interface KinCandidate {
  /** For 'parent', from = the parent, to = the child. For 'spouse', normalised a<b. */
  fromPerson: string;
  toPerson: string;
  type: 'parent' | 'spouse';
  subtype: 'adoptive' | null;
  signal: KinSignal;
  weight: number;
  quote: string | null;
  location: string | null;
}

/** Minimal event shape the inference needs (person ids already resolved). */
export interface EventForKin {
  type: string;
  participants: { personId: string; role: string }[];
  quote?: string | null;
  location?: string | null;
}

/** An explicit relationship stated in narrative text: "subject is <relation> of object". */
export interface KinClaim {
  subjectId: string;
  objectId: string;
  relation: string;
  quote: string | null;
  location: string | null;
}

// Weights. A parish baptism/birth naming the parents is direct evidence (1.0); a
// census household is structural but weaker (0.6); an explicit textual claim is
// strong but names can be ambiguous, so it still wants confirmation (0.8).
const PARENT_WEIGHT: Record<string, number> = {
  baptism: 1,
  birth: 1,
  death: 0.6,
  burial: 0.6,
  census: 0.6,
  residence: 0.5,
  migration: 0.5,
  occupation: 0.5,
  other: 0.5,
};
const SPOUSE_WEIGHT: Record<string, number> = {
  marriage: 1,
  census: 0.6,
  residence: 0.5,
  other: 0.5,
};
const EXPLICIT_CLAIM_WEIGHT = 0.8;

/** A suggestion below this accumulated score is held back until corroborated. */
export const SURFACE_MIN_SCORE = 0.6;
/** Scores are capped so a flood of identical mentions can't dominate the review. */
export const MAX_SCORE = 3;

export function normalizeSpousePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parentCandidate(parent: string, child: string, signal: KinSignal, weight: number, quote: string | null, location: string | null): KinCandidate {
  return { fromPerson: parent, toPerson: child, type: 'parent', subtype: null, signal, weight, quote, location };
}

function spouseCandidate(a: string, b: string, signal: KinSignal, weight: number, quote: string | null, location: string | null): KinCandidate {
  const [x, y] = normalizeSpousePair(a, b);
  return { fromPerson: x, toPerson: y, type: 'spouse', subtype: null, signal, weight, quote, location };
}

/**
 * Derive kinship candidates from a set of events by their participant roles. Purely
 * structural and conservative: parents are linked only to explicit children (and to
 * the principal ONLY in a birth/baptism, where the principal unambiguously IS the
 * child). Marriage principals are treated as spouses, never as children.
 */
export function deriveKinFromEvents(events: EventForKin[]): KinCandidate[] {
  const out: KinCandidate[] = [];
  for (const ev of events) {
    const byRole = new Map<string, string[]>();
    for (const p of ev.participants) {
      if (!p?.personId) continue;
      const arr = byRole.get(p.role) ?? [];
      if (!arr.includes(p.personId)) arr.push(p.personId);
      byRole.set(p.role, arr);
    }
    const type = ev.type;
    const quote = ev.quote ?? null;
    const location = ev.location ?? null;

    const parents = [...(byRole.get('father') ?? []), ...(byRole.get('mother') ?? [])];
    const principals = byRole.get('principal') ?? [];
    const spouses = byRole.get('spouse') ?? [];

    // Children: explicit 'child' roles, plus the principal when the event is a
    // birth/baptism (there the principal is, unambiguously, the child).
    const childTargets = new Set<string>(byRole.get('child') ?? []);
    if (type === 'birth' || type === 'baptism') for (const p of principals) childTargets.add(p);

    const pw = PARENT_WEIGHT[type] ?? 0.5;
    for (const parent of parents) {
      for (const child of childTargets) {
        if (parent === child) continue;
        out.push(parentCandidate(parent, child, 'record_role', pw, quote, location));
      }
    }

    const sw = SPOUSE_WEIGHT[type] ?? 0.5;
    if (type === 'marriage') {
      // Everyone marked principal or spouse in a marriage is mutually married.
      const people = [...new Set([...principals, ...spouses])];
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          out.push(spouseCandidate(people[i], people[j], 'record_role', sw, quote, location));
        }
      }
    } else {
      // A 'spouse' role in any other record means married to that record's principal.
      for (const s of spouses) {
        for (const p of principals) {
          if (s !== p) out.push(spouseCandidate(s, p, 'record_role', sw, quote, location));
        }
      }
    }
  }
  return out;
}

const PARENT_WORDS = new Set([
  'father', 'mother', 'parent', 'padre', 'madre', 'progenitor', 'progenitora', 'papa', 'mama',
]);
const CHILD_WORDS = new Set([
  'son', 'daughter', 'child', 'hijo', 'hija', 'vastago',
]);
const SPOUSE_WORDS = new Set([
  'spouse', 'husband', 'wife', 'esposo', 'esposa', 'marido', 'mujer', 'conyuge', 'consorte',
]);

function foldWord(w: string): string {
  return w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Map a free-text relation word to a storable kinship kind, or null if unmappable. */
export function normalizeClaimRelation(relation: string): 'parent' | 'child' | 'spouse' | null {
  const w = foldWord(String(relation ?? ''));
  if (!w) return null;
  if (PARENT_WORDS.has(w)) return 'parent';
  if (CHILD_WORDS.has(w)) return 'child';
  if (SPOUSE_WORDS.has(w)) return 'spouse';
  return null;
}

/**
 * Derive candidates from explicit textual relationship claims. Sibling claims are
 * intentionally dropped: they can't be stored without inventing a shared parent, and
 * inventing is exactly what we refuse to do.
 */
export function deriveKinFromClaims(claims: KinClaim[]): KinCandidate[] {
  const out: KinCandidate[] = [];
  for (const c of claims) {
    if (!c?.subjectId || !c?.objectId || c.subjectId === c.objectId) continue;
    const rel = normalizeClaimRelation(c.relation);
    if (!rel) continue;
    const w = EXPLICIT_CLAIM_WEIGHT;
    if (rel === 'parent') out.push(parentCandidate(c.subjectId, c.objectId, 'explicit_claim', w, c.quote, c.location));
    else if (rel === 'child') out.push(parentCandidate(c.objectId, c.subjectId, 'explicit_claim', w, c.quote, c.location));
    else if (rel === 'spouse') out.push(spouseCandidate(c.subjectId, c.objectId, 'explicit_claim', w, c.quote, c.location));
  }
  return out;
}

export function strengthForScore(score: number): KinStrength {
  if (score >= 1) return 'alta';
  if (score >= SURFACE_MIN_SCORE) return 'media';
  return 'baja';
}

/** Cap and round an accumulated score. */
export function clampScore(score: number): number {
  return Math.round(Math.min(score, MAX_SCORE) * 100) / 100;
}

export function pairTypeKey(type: string, from: string, to: string): string {
  if (type === 'spouse') {
    const [a, b] = normalizeSpousePair(from, to);
    return `spouse|${a}|${b}`;
  }
  return `parent|${from}|${to}`;
}

export interface AggregatedSuggestion {
  type: 'parent' | 'spouse';
  fromPerson: string;
  toPerson: string;
  subtype: 'adoptive' | null;
  score: number;
  strength: KinStrength;
  candidates: KinCandidate[];
}

/**
 * Aggregate a flat candidate list into one entry per person-pair, summing weights
 * (deduplicating identical quotes from the same signal so re-reads don't inflate).
 * Pure mirror of what the store does — used by tests to check the end-to-end logic.
 */
export function aggregateCandidates(candidates: KinCandidate[]): AggregatedSuggestion[] {
  const byPair = new Map<string, AggregatedSuggestion>();
  const seen = new Map<string, Set<string>>();
  for (const c of candidates) {
    const key = pairTypeKey(c.type, c.fromPerson, c.toPerson);
    let entry = byPair.get(key);
    if (!entry) {
      const [from, to] = c.type === 'spouse' ? normalizeSpousePair(c.fromPerson, c.toPerson) : [c.fromPerson, c.toPerson];
      entry = { type: c.type, fromPerson: from, toPerson: to, subtype: c.subtype, score: 0, strength: 'baja', candidates: [] };
      byPair.set(key, entry);
      seen.set(key, new Set());
    }
    const dedupe = `${c.signal}|${c.quote ?? ''}`;
    const seenSet = seen.get(key)!;
    if (seenSet.has(dedupe)) continue;
    seenSet.add(dedupe);
    entry.candidates.push(c);
    entry.score = clampScore(entry.score + c.weight);
    entry.strength = strengthForScore(entry.score);
    if (c.subtype === 'adoptive') entry.subtype = 'adoptive';
  }
  return [...byPair.values()];
}
