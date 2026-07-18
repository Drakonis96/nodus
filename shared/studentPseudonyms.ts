/**
 * Student pseudonymisation (teaching vault).
 *
 * Rosters hold the names of minors. Before any teaching text reaches an AI provider
 * we replace those names with opaque codes, and we map the codes back to real names
 * on the way out so the teacher never sees the machinery:
 *
 *     "¿Cómo va Ana Peña?"  ──anonymize──▶  "¿Cómo va STU_7K3Q?"   ──▶ provider
 *     "Ana ha mejorado."    ◀─deanonymize──  "STU_7K3Q ha mejorado."  ◀──
 *
 * Everything here is pure: no Electron, no DB, no settings. The Electron side owns
 * *when* to apply it (electron/ai/studentPrivacyContext.ts); this module owns *how*.
 *
 * Three rules run through the whole file, and they are the reason it is not a
 * two-line `String.replace`:
 *
 *   1. NEVER GUESS. If a name could refer to two students, the text is left alone and
 *      a warning is raised. A wrong substitution silently attributes one student's
 *      behaviour to another, which is worse than not substituting at all.
 *   2. FAIL LOUD ON THE WAY OUT. `findResidualNames` re-reads the anonymised payload
 *      looking for names that should have gone. The likely bug is not an exception,
 *      it is a silent no-op — an empty scope, a regex that matched nothing — and a
 *      no-op looks exactly like success.
 *   3. DON'T CORRUPT THE PROMPT. Spanish rosters are full of ordinary words (Rosa,
 *      Cruz, Pilar, Flores…). Blindly rewriting "la rosa de los vientos" into
 *      "la STU_7K3Q de los vientos" would damage the very text we are sending.
 */

// ── Identifier format ────────────────────────────────────────────────────────
//
// Base32-ish alphabet with the visually ambiguous glyphs removed (0/O, 1/I/L, U):
// a teacher reads these aloud and types them back, so O-vs-0 confusion is a real
// cost. 30 symbols ^ 4 positions = 810 000 codes per group.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 4;

/**
 * `STU_7K3Q`. Deliberately:
 *  - SCREAMING_SNAKE, because every BPE tokenizer round-trips code-shaped identifiers
 *    reliably. Bracketed (`[[x]]`) forms collide with Nodus note links, Unicode
 *    sentinels get normalised away, and `{{x}}` gets escaped in JSON mode.
 *  - `STU`, not `ALUMNO`/`STUDENT`: prompts carry an output-language directive that
 *    orders the model to translate free text, and a translated placeholder no longer
 *    matches the reverse map. `STU` is not a word in any of the seven UI languages.
 *  - random, not sequential: `STU_01…STU_30` would leak roster size and (since rosters
 *    are usually alphabetical) partial name ordering.
 */
const CODE_CHAR_CLASS = '[2-9A-HJKMNP-TV-Z]';
export const PSEUDONYM_RE = new RegExp(`STU_${CODE_CHAR_CLASS}{4}`, 'g');

/**
 * Recogniser used on the way back. Models lowercase things, swap `_` for `-`, and
 * occasionally insert a space, so the reverse pass is deliberately more forgiving
 * than the generator. Anything it matches is normalised to canonical form before
 * lookup; anything it matches but cannot resolve is reported, never guessed at.
 */
const PSEUDONYM_LENIENT_RE = /\bSTU[_\-\s]?([2-9A-Za-hj-km-np-tv-z]{4})\b/gi;

/** Longest possible partial placeholder held back by the streaming rewriter. */
const MAX_HOLD = 'STU_'.length + CODE_LENGTH;

/**
 * Suffix that *might* still grow into a placeholder. Anchored at `$`, so the first
 * match found scanning left-to-right is the longest valid suffix, and it can never
 * be longer than MAX_HOLD — which is what bounds the stream buffer.
 */
const PARTIAL_TAIL_RE = /S(?:T(?:U(?:[_\-\s]?[2-9A-Za-z]{0,4})?)?)?$/i;

export function isPseudonym(value: string): boolean {
  return new RegExp(`^STU_${CODE_CHAR_CLASS}{4}$`).test(value);
}

/**
 * Rejection-samples a code that is not already taken in the group. Callers pass the
 * codes already stored for that group, so codes are collision-free by construction
 * rather than by probability.
 */
export function generatePseudonymCode(taken: ReadonlySet<string>, rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    let code = 'STU_';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    }
    if (!taken.has(code)) return code;
  }
  // 810 000 codes against a class of ~30 students: unreachable in practice, but a
  // silent infinite loop in the main process would freeze the app, so bail loudly.
  throw new Error('No se pudo generar un identificador de alumnado único');
}

// ── Data contract ────────────────────────────────────────────────────────────

export interface PseudonymStudent {
  /** Stable row id — the structured path keys on this, never on the name. */
  id: string;
  /** Persisted `STU_XXXX`. Stored, not derived, so it survives renames. */
  code: string;
  /** e.g. "Ana María" */
  givenNames: string;
  /** e.g. "Peña López" */
  surnames: string;
}

export type PseudonymWarning =
  | { kind: 'ambiguous'; token: string; candidateCount: number }
  | { kind: 'common-word'; token: string }
  | { kind: 'unknown-code'; code: string };

export interface PseudonymScope {
  students: PseudonymStudent[];
  byId: Map<string, PseudonymStudent>;
  byCode: Map<string, PseudonymStudent>;
  /** Normalised name token → the students it could refer to. */
  candidates: Map<string, string[]>;
  /** Single alternation over every token, longest-first. Null when the roster is empty. */
  matcher: RegExp | null;
  /** Tokens that are also ordinary words and therefore need corroboration. */
  guarded: Set<string>;
}

export function displayNameOf(student: PseudonymStudent): string {
  return [student.givenNames, student.surnames].map((p) => p.trim()).filter(Boolean).join(' ');
}

/** The label feature code should render. Never write a real name into a prompt. */
export function labelFor(scope: PseudonymScope, studentId: string): string {
  const student = scope.byId.get(studentId);
  return student ? student.code : studentId;
}

// ── Normalisation ────────────────────────────────────────────────────────────
//
// Matching is accent- and case-insensitive: teachers type "jose" for "José" and
// "Pena" for "Peña". Over-matching is the safe direction here — a false positive
// costs an unnecessary substitution, a false negative leaks a real name.
//
// We fold per character and keep an index map back to the original string, so the
// substitution lands on the ORIGINAL text at the right offsets. Folding the whole
// string at once would shift every offset after the first accent.
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of piece) {
      folded += ch;
      map.push(i);
    }
  }
  map.push(text.length); // sentinel so an end-of-string match maps cleanly
  return { folded, map };
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Spanish given names and surnames that are also ordinary words. Matching one of
 * these is not enough on its own — see `hasCorroboration`. The list is intentionally
 * conservative: a missing entry costs an over-substitution (visible, recoverable),
 * whereas guarding a name that needs no guard costs a leak.
 */
const COMMON_WORD_NAMES = new Set(
  [
    // given names
    'rosa', 'cruz', 'nieves', 'pilar', 'mar', 'sol', 'paz', 'dolores', 'angeles', 'consuelo',
    'amparo', 'esperanza', 'gloria', 'luz', 'alba', 'aurora', 'estrella', 'perla', 'olivia',
    'salvador', 'angel', 'jesus', 'santiago', 'victoria', 'clara', 'blanca', 'violeta', 'azucena',
    // surnames
    'leon', 'blanco', 'moreno', 'rubio', 'flores', 'campos', 'casas', 'prado', 'iglesias',
    'mora', 'pena', 'rico', 'bello', 'justo', 'santos', 'reyes', 'vega', 'serrano', 'nieto',
    'caballero', 'pastor', 'herrero', 'molina', 'puente', 'rivera', 'valle', 'monte', 'bosque',
    // a few for the other UI languages
    'may', 'june', 'grace', 'hope', 'rose', 'faith', 'noel', 'sommer', 'winter', 'petit', 'legrand',
  ].map(fold),
);

/** Words that, immediately before a name, mark it as a name. */
const NAME_NEXUS_RE = /(?:\b(?:de|del|la|el|los|las|y|e|alumn[oa]s?|estudiantes?|se[nñ]or(?:a|ita)?|sr|sra|srta|don|do[nñ]a|con|para|a|que)\b\.?\s+)$/i;

// ── Scope construction ───────────────────────────────────────────────────────

/**
 * Indexes a roster into everything the text passes need. The matcher is ONE
 * alternation sorted longest-first, applied in a single pass: that is what makes
 * "Ana Peña López" win over "Ana", and what stops an already-inserted `STU_7K3Q`
 * from being re-scanned.
 */
export function buildPseudonymScope(students: PseudonymStudent[]): PseudonymScope {
  const byId = new Map<string, PseudonymStudent>();
  const byCode = new Map<string, PseudonymStudent>();
  const candidates = new Map<string, string[]>();
  const guarded = new Set<string>();
  // Preserve the original spelling of each token so the alternation matches the
  // accented form too; folding happens on the haystack, not the needle.
  const surfaces = new Map<string, string>();

  const addToken = (raw: string, studentId: string) => {
    const token = raw.trim();
    if (token.length < 2) return; // single letters would match half the alphabet
    const key = fold(token);
    if (!key) return;
    const list = candidates.get(key);
    if (list) {
      if (!list.includes(studentId)) list.push(studentId);
    } else {
      candidates.set(key, [studentId]);
    }
    if (!surfaces.has(key)) surfaces.set(key, token);
    if (COMMON_WORD_NAMES.has(key)) guarded.add(key);
  };

  for (const student of students) {
    byId.set(student.id, student);
    if (student.code) byCode.set(student.code.toUpperCase(), student);

    const given = student.givenNames.trim().split(/\s+/).filter(Boolean);
    const surnames = student.surnames.trim().split(/\s+/).filter(Boolean);

    // Rung 1 — full name, in both the natural and the "Apellidos, Nombre" order
    // schools export from their management systems.
    if (given.length && surnames.length) {
      addToken(`${given.join(' ')} ${surnames.join(' ')}`, student.id);
      addToken(`${surnames.join(' ')}, ${given.join(' ')}`, student.id);
      addToken(`${surnames.join(' ')} ${given.join(' ')}`, student.id);
    }
    // Rung 2 — the surname pair, which in Spain identifies a student almost uniquely.
    if (surnames.length > 1) addToken(surnames.join(' '), student.id);
    // Rungs 3 and 4 — individual surnames, then given names.
    for (const s of surnames) addToken(s, student.id);
    for (const g of given) addToken(g, student.id);
  }

  const keys = [...candidates.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const matcher = keys.length
    ? new RegExp(
        // Unicode-aware boundaries: JS `\b` is ASCII-only and breaks on á, ñ, ü.
        `(?<![\\p{L}\\p{M}\\p{N}_])(?:${keys.map((k) => escapeRe(k)).join('|')})(?![\\p{L}\\p{M}\\p{N}_])`,
        'giu',
      )
    : null;

  return { students, byId, byCode, candidates, matcher, guarded };
}

// ── Anonymisation (outbound) ─────────────────────────────────────────────────

/**
 * A guarded token (an ordinary word that is also somebody's name) is only treated as
 * a name when the surrounding text agrees: it is capitalised AND either follows a
 * nexus ("la alumna Rosa", "de Rosa") or sits next to another name token
 * ("Rosa Pérez"). Otherwise it stays put and the caller is warned.
 */
function hasCorroboration(
  original: string,
  start: number,
  end: number,
  scope: PseudonymScope,
): boolean {
  const surface = original.slice(start, end);
  const capitalised = surface[0] !== surface[0].toLowerCase();
  if (!capitalised) return false;

  const before = original.slice(Math.max(0, start - 24), start);
  if (NAME_NEXUS_RE.test(before)) return true;

  // Adjacent name token, either side: "Rosa Pérez" / "Pérez Rosa".
  const nextWord = /^[\s,]*([\p{L}\p{M}]+)/u.exec(original.slice(end));
  if (nextWord && scope.candidates.has(fold(nextWord[1]))) return true;
  const prevWord = /([\p{L}\p{M}]+)[\s,]*$/u.exec(before);
  if (prevWord && scope.candidates.has(fold(prevWord[1]))) return true;

  return false;
}

export interface AnonymizeResult {
  text: string;
  warnings: PseudonymWarning[];
  substitutions: number;
}

/**
 * Backstop sweep for free text — the teacher's own prompt and the roster's comments
 * column. Structured fields should already be rendered through `labelFor`, so a hit
 * here is either a comment or something the teacher typed.
 */
export function anonymizeText(text: string, scope: PseudonymScope): AnonymizeResult {
  if (!text || !scope.matcher) return { text, warnings: [], substitutions: 0 };

  const { folded, map } = foldWithMap(text);
  const warnings: PseudonymWarning[] = [];
  let out = '';
  let cursor = 0; // index into the ORIGINAL string
  let substitutions = 0;

  scope.matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = scope.matcher.exec(folded)) !== null) {
    const key = match[0];
    const origStart = map[match.index];
    const origEnd = map[match.index + key.length];
    const ids = scope.candidates.get(key) ?? [];

    out += text.slice(cursor, origStart);
    const surface = text.slice(origStart, origEnd);

    if (ids.length > 1) {
      // Rule 1: never guess. Leaving it also means we do NOT fall through to a
      // shorter token inside the same span — the span is consumed either way.
      warnings.push({ kind: 'ambiguous', token: surface, candidateCount: ids.length });
      out += surface;
    } else if (ids.length === 1 && scope.guarded.has(key) && !hasCorroboration(text, origStart, origEnd, scope)) {
      warnings.push({ kind: 'common-word', token: surface });
      out += surface;
    } else if (ids.length === 1) {
      out += scope.byId.get(ids[0])?.code ?? surface;
      substitutions++;
    } else {
      out += surface;
    }
    cursor = origEnd;
  }
  out += text.slice(cursor);

  return { text: out, warnings: dedupeWarnings(warnings), substitutions };
}

/**
 * Leak detector, run on the payload that is about to be sent.
 *
 * It deliberately checks ONLY the tokens `anonymizeText` promises to remove —
 * unambiguous full names and surname pairs. Ambiguous names and guarded common
 * words were left in place on purpose, so flagging those would block every request
 * and train the user to switch the feature off.
 */
export function findResidualNames(text: string, scope: PseudonymScope): string[] {
  if (!text) return [];
  const folded = fold(text);
  const residual: string[] = [];
  for (const [key, ids] of scope.candidates) {
    if (ids.length !== 1) continue; // ambiguous: deliberately untouched
    if (!key.includes(' ')) continue; // single token: rung 3/4, may be guarded
    if (folded.includes(key) && !residual.includes(key)) residual.push(key);
  }
  return residual;
}

// ── De-anonymisation (inbound) ───────────────────────────────────────────────

export interface DeanonymizeResult {
  text: string;
  unknownCodes: string[];
}

export function deanonymizeText(text: string, scope: PseudonymScope): DeanonymizeResult {
  if (!text) return { text, unknownCodes: [] };
  const unknownCodes: string[] = [];
  const out = text.replace(PSEUDONYM_LENIENT_RE, (whole, code: string) => {
    const student = scope.byCode.get(`STU_${code.toUpperCase()}`);
    if (student) return displayNameOf(student);
    // Rule 1 again, on the way back: a code we don't recognise is shown raw. Guessing
    // "the closest student" would put words in a real child's mouth.
    if (!unknownCodes.includes(whole)) unknownCodes.push(whole);
    return whole;
  });
  return { text: out, unknownCodes };
}

/** Maps every string inside a parsed JSON value — used for `completeJson` results. */
export function deanonymizeDeep<T>(value: T, scope: PseudonymScope): T {
  if (typeof value === 'string') return deanonymizeText(value, scope).text as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deanonymizeDeep(v, scope)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deanonymizeDeep(v, scope);
    }
    return out as unknown as T;
  }
  return value;
}

export interface StreamDeanonymizer {
  push(delta: string): string;
  flush(): string;
  unknownCodes(): string[];
}

/**
 * Chunk-boundary-safe reverse mapping for streamed answers.
 *
 * A provider will happily split `STU_7K3Q` as `"STU_"` + `"7K3Q"`, so a naive
 * per-delta replace shows the raw code to the user and then never fixes it. We hold
 * back the longest suffix that could still grow into a placeholder — at most
 * MAX_HOLD characters, because the tail pattern is anchored — and emit everything
 * before it, already rewritten.
 *
 * Note that a *complete* trailing placeholder is also held for one chunk: without
 * that, a following chunk starting with a letter would extend it into a different
 * token we had already mis-substituted. It costs one chunk of latency and buys
 * correctness.
 *
 * The caller MUST call `flush()` in a `finally` — an aborted stream returns its
 * accumulated text directly, and without the flush the last few characters vanish.
 */
export function createStreamDeanonymizer(scope: PseudonymScope): StreamDeanonymizer {
  let tail = '';
  const unknown: string[] = [];

  const rewrite = (chunk: string): string => {
    if (!chunk) return '';
    const { text, unknownCodes } = deanonymizeText(chunk, scope);
    for (const code of unknownCodes) if (!unknown.includes(code)) unknown.push(code);
    return text;
  };

  return {
    push(delta: string): string {
      if (!delta) return '';
      const buf = tail + delta;
      const partial = PARTIAL_TAIL_RE.exec(buf);
      const holdAt = partial ? partial.index : buf.length;
      tail = buf.slice(holdAt);
      return rewrite(buf.slice(0, holdAt));
    },
    flush(): string {
      // End of stream is a word boundary, so an incomplete placeholder can never
      // become one: emit it verbatim rather than swallowing it.
      const out = rewrite(tail);
      tail = '';
      return out;
    },
    unknownCodes: () => unknown,
  };
}

export { MAX_HOLD as PSEUDONYM_MAX_HOLD };

function dedupeWarnings(warnings: PseudonymWarning[]): PseudonymWarning[] {
  const seen = new Set<string>();
  const out: PseudonymWarning[] = [];
  for (const w of warnings) {
    const key = `${w.kind}:${'token' in w ? w.token : w.code}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 5) break; // the notice is a hint, not a report
  }
  return out;
}
