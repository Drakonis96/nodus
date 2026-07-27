/**
 * Craft and coherence checks for worldbuilding characters.
 *
 * Deliberately NOT the genealogy equivalent (conflictDetection.ts). That one reconciles
 * DISAGREEING SOURCES about a real person — two records giving different birth years.
 * Here there is one source, the author, so nothing can disagree; what can happen is that
 * the author's own sheet contradicts itself, or that two characters have names a reader
 * will confuse. Both are craft problems, not evidence problems.
 *
 * Pure and dependency-free: no DB, no AI, no cost. These run on every sheet render, so
 * they must stay cheap and must never invent a problem — a warning that is usually wrong
 * gets ignored, and then the one that matters gets ignored too.
 */

import type { CharacterLifeStatus } from './types';

export type CharacterCheckSeverity = 'error' | 'warning';

export interface CharacterCheck {
  id: string;
  severity: CharacterCheckSeverity;
  /** Spanish message; translated at render time. */
  message: string;
  /** Values interpolated into the message by the caller's tx(). */
  values?: Record<string, string>;
}

export interface CoherenceInput {
  lifeStatus: CharacterLifeStatus;
  birthYear: number | null;
  deathYear: number | null;
  deathDate: string | null;
  events: { type: string; label: string | null; worldYear: number | null }[];
}

/**
 * Contradictions inside one character's own sheet. Only checks that need NO judgement:
 * every one of these is arithmetic on years the author typed, so a hit is always real.
 * Anything requiring interpretation belongs to the AI, not here.
 */
export function checkCharacterCoherence(input: CoherenceInput): CharacterCheck[] {
  const checks: CharacterCheck[] = [];
  const { birthYear, deathYear } = input;

  if (birthYear != null && deathYear != null && deathYear < birthYear) {
    checks.push({
      id: 'death-before-birth',
      severity: 'error',
      message: 'Muere el año {death}, antes de nacer el año {birth}.',
      values: { death: String(deathYear), birth: String(birthYear) },
    });
  }

  // An event the character takes part in AFTER they died, or BEFORE they were born.
  // Birth and death events themselves are exempt: they are the boundary, not a crossing.
  const BOUNDARY = new Set(['birth', 'death']);
  for (const event of input.events) {
    if (event.worldYear == null || BOUNDARY.has(event.type)) continue;
    if (deathYear != null && event.worldYear > deathYear) {
      checks.push({
        id: `event-after-death-${event.type}-${event.worldYear}`,
        severity: 'error',
        message: 'Participa en un hecho el año {year}, después de morir el año {death}.',
        values: { year: String(event.worldYear), death: String(deathYear) },
      });
    }
    if (birthYear != null && event.worldYear < birthYear) {
      checks.push({
        id: `event-before-birth-${event.type}-${event.worldYear}`,
        severity: 'error',
        message: 'Participa en un hecho el año {year}, antes de nacer el año {birth}.',
        values: { year: String(event.worldYear), birth: String(birthYear) },
      });
    }
  }

  // A death recorded on a character still marked alive. A warning, not an error: the
  // author may be mid-edit, and 'undead' or 'immortal' make the pairing legitimate.
  if ((input.deathDate?.trim() || deathYear != null) && input.lifeStatus === 'alive') {
    checks.push({
      id: 'dead-but-alive',
      severity: 'warning',
      message: 'Tiene fecha de muerte pero su estado sigue siendo «vivo».',
    });
  }

  // A character marked dead with nothing saying when. Only a nudge.
  if (input.lifeStatus === 'dead' && !input.deathDate?.trim() && deathYear == null) {
    checks.push({
      id: 'dead-without-date',
      severity: 'warning',
      message: 'Está marcado como muerto pero no consta cuándo.',
    });
  }

  return checks;
}

// ── Confusable names ─────────────────────────────────────────────────────────

/** Strip accents, case and punctuation so "Kaëlen" and "kaelen" compare equal. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, iterative with a single row: these are names, not documents. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return 1 - editDistance(left, right) / longest;
}

export interface ConfusablePair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  similarity: number;
  reason: 'near-identical' | 'same-initial-and-shape';
}

/**
 * Pairs of characters a reader is likely to mix up. This is a WRITING-CRAFT check, not a
 * data check: nothing is wrong with the vault, but "Kaelen" and "Kaelin" in the same
 * cast is a reading problem.
 *
 * Two signals, both conservative, because a false positive on every vaguely similar pair
 * would train the author to ignore the whole section:
 *   - near-identical: one or two edits apart;
 *   - same-initial-and-shape: same first letter AND same length AND still very close,
 *     which is the pattern that actually defeats readers scanning a page.
 *
 * Only the DISPLAY name is compared. Aliases are supposed to overlap — that is often the
 * point of an alias — and comparing them produced nothing but noise.
 */
export function findConfusableNames(
  characters: { personId: string; displayName: string }[],
  { threshold = 0.82 }: { threshold?: number } = {}
): ConfusablePair[] {
  const pairs: ConfusablePair[] = [];
  for (let i = 0; i < characters.length; i += 1) {
    for (let j = i + 1; j < characters.length; j += 1) {
      const a = characters[i];
      const b = characters[j];
      const left = normalizeName(a.displayName);
      const right = normalizeName(b.displayName);
      // Very short names are similar by accident ("Ur" vs "Un"); the check would fire on
      // half the cast of a world that likes terse names.
      if (left.length < 4 || right.length < 4) continue;
      const distance = editDistance(left, right);
      const similarity = nameSimilarity(a.displayName, b.displayName);
      if (distance <= 2 && similarity >= threshold) {
        pairs.push({
          aId: a.personId,
          aName: a.displayName,
          bId: b.personId,
          bName: b.displayName,
          similarity,
          reason: 'near-identical',
        });
      } else if (left[0] === right[0] && left.length === right.length && similarity >= threshold) {
        pairs.push({
          aId: a.personId,
          aName: a.displayName,
          bId: b.personId,
          bName: b.displayName,
          similarity,
          reason: 'same-initial-and-shape',
        });
      }
    }
  }
  return pairs.sort((first, second) => second.similarity - first.similarity);
}

/** The confusable pairs involving one particular character. */
export function confusableWith(
  personId: string,
  characters: { personId: string; displayName: string }[]
): ConfusablePair[] {
  return findConfusableNames(characters).filter((pair) => pair.aId === personId || pair.bId === personId);
}
