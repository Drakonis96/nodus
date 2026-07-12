/**
 * Candidate identity matching for genealogy: which person records MIGHT be the same
 * individual seen across different sources ("Juan Pérez" in an 1875 census and a 1878
 * marriage record). Pure and dependency-free — the electron side supplies the person
 * data and persists the user's accept (merge) / dismiss decisions.
 *
 * Deliberately conservative: it PROPOSES, never merges. Blocking is name-based (with
 * tolerance for spelling variants) gated by a birth-year window and boosted by shared
 * places, so obviously-different people (incompatible years) are never suggested. The
 * user always adjudicates — the Genealogical Proof Standard as a workflow.
 */

export interface MatchPerson {
  id: string;
  displayName: string;
  /** Normalised name tokens (lowercased, accent/punct-stripped). */
  tokens: string[];
  birthYear: number | null;
  placeKeys: string[];
}

export interface MatchCandidate {
  aId: string;
  bId: string;
  score: number;
  reasons: string[];
}

const BIRTH_YEAR_WINDOW = 3;

/** Levenshtein distance, capped early — we only care about "≤ 1". */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 2) return 99;
  const prev = new Array(bl + 1);
  const curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j];
  }
  return prev[bl];
}

function tokenClose(a: string, b: string): boolean {
  return a === b || editDistance(a, b) <= 1;
}

/** Name-only comparison. Returns a base score + whether it was exact, or null if no match. */
function compareNames(a: string[], b: string[]): { base: number; exact: boolean } | null {
  if (a.length === 0 || b.length === 0) return null;
  const firstA = a[0];
  const firstB = b[0];
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];

  const givenClose = tokenClose(firstA, firstB);
  const surnameClose = tokenClose(lastA, lastB);
  if (givenClose && surnameClose) {
    const exact = firstA === firstB && lastA === lastB;
    return { base: 1, exact };
  }
  // Fallback: identical full token set in any order (e.g. reordered names).
  const setA = [...a].sort().join(' ');
  const setB = [...b].sort().join(' ');
  if (setA === setB) return { base: 1, exact: true };
  return null;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface ReconcileTarget {
  /** Normalised name tokens of the freshly extracted person. */
  tokens: string[];
  birthYear: number | null;
}

/**
 * Decide whether a freshly extracted person should LINK to an existing record instead
 * of creating a duplicate. Deliberately conservative — the whole point of Nodus is not
 * to silently fold two people together on a weak signal. It links ONLY when there is an
 * EXACT name match, with no conflicting birth year, and exactly ONE such candidate.
 * Anything ambiguous — a merely-similar name, several exact matches, or a date conflict
 * — returns null, so a new person is created and the pair flows to the user-adjudicated
 * "Revisar coincidencias" review rather than being merged behind the user's back.
 */
export function shouldLinkToExisting(extracted: ReconcileTarget, existing: MatchPerson[]): string | null {
  const matches: string[] = [];
  for (const e of existing) {
    const cmp = compareNames(extracted.tokens, e.tokens);
    if (!cmp || !cmp.exact) continue;
    if (
      extracted.birthYear != null &&
      e.birthYear != null &&
      Math.abs(extracted.birthYear - e.birthYear) > BIRTH_YEAR_WINDOW
    ) {
      continue; // Same name but incompatible years → different people; do not link.
    }
    matches.push(e.id);
    if (matches.length > 1) return null; // Ambiguous → let the user adjudicate.
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Compute candidate matches over the person set, skipping dismissed pairs. Persons
 * with incompatible known birth years are never paired.
 */
export function computeMatchCandidates(persons: MatchPerson[], dismissed: Set<string> = new Set()): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const a = persons[i];
      const b = persons[j];
      if (dismissed.has(pairKey(a.id, b.id))) continue;

      const name = compareNames(a.tokens, b.tokens);
      if (!name) continue;

      // Incompatible known birth years → definitely different people.
      if (a.birthYear != null && b.birthYear != null) {
        if (Math.abs(a.birthYear - b.birthYear) > BIRTH_YEAR_WINDOW) continue;
      }

      const reasons: string[] = [name.exact ? 'mismo nombre' : 'nombre similar'];
      let score = name.base;

      if (a.birthYear != null && b.birthYear != null) {
        score += 0.3;
        reasons.push('fechas de nacimiento compatibles');
      }
      const sharedPlace = a.placeKeys.some((p) => b.placeKeys.includes(p));
      if (sharedPlace) {
        score += 0.3;
        reasons.push('lugar en común');
      }

      candidates.push({ aId: a.id, bId: b.id, score, reasons });
    }
  }
  return candidates.sort((x, y) => y.score - x.score);
}
