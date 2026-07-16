/**
 * Pure helpers for the bulk file upload: matching a set of file names against a
 * database's rows by a reference column's value. Dependency-free so the matching is
 * unit-tested without a database or the filesystem.
 *
 * Matching runs in passes, strongest evidence first: an exact name, then a catalogue
 * code shared by both sides, then a fuzzy name similarity. Each pass only looks at what
 * earlier passes left over, so a confident match is never displaced by a guess.
 */

export function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

/** A file's match key: its base name without the extension, normalized. */
export function fileMatchKey(fileName: string): string {
  return normalizeKey(fileName.replace(/\.[^.]+$/, ''));
}

export interface BulkRowRef {
  rowId: string;
  /** The reference column's display value for this row. */
  refValue: string | null;
}

/** How a file was paired with its row — surfaced in the preview so the user can judge it. */
export type BulkMatchStrategy = 'exact' | 'code' | 'fuzzy';

export interface BulkMatch {
  fileName: string;
  rowId: string | null;
  strategy?: BulkMatchStrategy;
  /** The code or key both sides shared, for the preview. */
  key?: string;
  /** 0..1, only meaningful for fuzzy matches. */
  score?: number;
  /** Set when there was too much to compare by similarity and we declined rather than hang. */
  fuzzyDeclined?: boolean;
}

/**
 * A catalogue code: letter-runs glued to digit-runs, optionally chained with - or _
 * (LV001, LV001-FG001, IMG_2024). Anchored to neither end, so it survives the debris
 * real exports carry around a code — "_ _ lv130-fg006", "LV007-FG092·", "lv005-fg069__1".
 */
const CODE_RE = /[a-z]+\d+(?:[-_][a-z]+\d+)*/gi;

/** Extract the longest catalogue code in a string, or null when there is none. */
export function extractCode(s: string, pattern: RegExp = CODE_RE): string | null {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let best: string | null = null;
  for (const m of s.matchAll(re)) {
    if (best == null || m[0].length > best.length) best = m[0];
  }
  return best ? best.toLowerCase() : null;
}

/**
 * Turn a user-typed code template into a regex. `#` is a digit, `@` a letter, `*` any run
 * of characters; everything else is literal. Returns null for an unusable template.
 * A template wrapped in `/` is taken as a raw regex body.
 */
export function codeTemplateToRegex(template: string): RegExp | null {
  const trimmed = template.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('/')) {
      const body = trimmed.replace(/^\//, '').replace(/\/$/, '');
      return body ? new RegExp(body, 'gi') : null;
    }
    let out = '';
    let run: { ch: string; n: number } | null = null;
    const flush = () => {
      if (!run) return;
      out += run.ch === '#' ? `\\d{${run.n}}` : `[a-z]{${run.n}}`;
      run = null;
    };
    for (const ch of trimmed) {
      if (ch === '#' || ch === '@') {
        if (run && run.ch === ch) run.n++;
        else {
          flush();
          run = { ch, n: 1 };
        }
        continue;
      }
      flush();
      out += ch === '*' ? '.*?' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    flush();
    return out ? new RegExp(out, 'gi') : null;
  } catch {
    return null;
  }
}

/** Character trigrams of a normalized string, for fuzzy scoring. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Sørensen–Dice overlap of two trigram sets: 1 = identical, 0 = nothing in common. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** A fuzzy pairing must be this similar, and this much better than the runner-up. */
const FUZZY_MIN_SCORE = 0.6;
const FUZZY_MIN_MARGIN = 0.08;
/**
 * Fuzzy scoring compares every leftover against every row, so its cost is the product of
 * the two. Past this many comparisons we decline instead of scoring: the preview runs on
 * the render thread on every keystroke, and pointing the reference column at the wrong
 * column leaves thousands of leftovers — 7k files x 7k rows would hang the UI for minutes.
 */
const FUZZY_MAX_COMPARISONS = 1_000_000;

/** What a bulk upload should do with each file beyond storing it. */
export interface BulkAttachOptions {
  /** Extract text (OCR for images). Slow: opt-in per upload. */
  ocr?: boolean;
  /** Describe each image with the configured vision model. Slow: opt-in per upload. */
  describe?: boolean;
  /** Pair leftovers by name similarity. */
  fuzzy?: boolean;
  /** A user-typed code template (see codeTemplateToRegex); null uses the built-in pattern. */
  codeTemplate?: string | null;
}

export interface MatchOptions {
  /** Pair leftovers by name similarity. Off by default: a wrong attachment is worse than none. */
  fuzzy?: boolean;
  /** Override the catalogue-code pattern (from codeTemplateToRegex). */
  codePattern?: RegExp | null;
  /** Disable the code pass entirely. */
  useCode?: boolean;
}

/**
 * Match each file to a row. A file matches when its full name or its name without the
 * extension equals a row's reference value; failing that, when a catalogue code appears in
 * both; failing that (opt-in) when the names are similar enough and the winner is
 * unambiguous. The first row with a given value wins; a file with no match gets rowId=null.
 */
export function matchFilesToRows(fileNames: string[], rows: BulkRowRef[], opts: MatchOptions = {}): BulkMatch[] {
  const { fuzzy = false, codePattern = null, useCode = true } = opts;
  const pattern = codePattern ?? CODE_RE;

  const byKey = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const r of rows) {
    const v = r.refValue?.trim();
    if (!v) continue;
    const k = normalizeKey(v);
    if (!byKey.has(k)) byKey.set(k, r.rowId);
    if (useCode) {
      const code = extractCode(v, pattern);
      if (code && !byCode.has(code)) byCode.set(code, r.rowId);
    }
  }

  const results: BulkMatch[] = fileNames.map((fileName) => {
    const withExt = normalizeKey(fileName);
    const noExt = fileMatchKey(fileName);
    const exact = byKey.get(withExt) ?? byKey.get(noExt);
    if (exact) return { fileName, rowId: exact, strategy: 'exact' as const, key: noExt };
    if (useCode) {
      const code = extractCode(noExt, pattern);
      const hit = code ? byCode.get(code) : undefined;
      if (hit && code) return { fileName, rowId: hit, strategy: 'code' as const, key: code };
    }
    return { fileName, rowId: null };
  });

  if (!fuzzy) return results;

  const leftovers = results.filter((m) => !m.rowId);
  if (leftovers.length === 0) return results;
  const candidates = rows
    .filter((r) => r.refValue?.trim())
    .map((r) => ({ rowId: r.rowId, grams: trigrams(r.refValue!) }));
  if (leftovers.length * candidates.length > FUZZY_MAX_COMPARISONS) {
    for (const m of leftovers) m.fuzzyDeclined = true;
    return results;
  }
  for (const m of leftovers) {
    const g = trigrams(fileMatchKey(m.fileName));
    let bestId: string | null = null;
    let bestScore = 0;
    let second = 0;
    for (const c of candidates) {
      const score = dice(g, c.grams);
      if (score > bestScore) {
        second = bestScore;
        bestId = c.rowId;
        bestScore = score;
      } else if (score > second) second = score;
    }
    // Require both an absolute floor and a clear gap: two rows that score alike mean we
    // cannot tell them apart, and guessing would file the image under the wrong one.
    if (bestId && bestScore >= FUZZY_MIN_SCORE && bestScore - second >= FUZZY_MIN_MARGIN) {
      m.rowId = bestId;
      m.strategy = 'fuzzy';
      m.score = Math.round(bestScore * 100) / 100;
    }
  }
  return results;
}

export function countMatches(matches: BulkMatch[]): { matched: number; unmatched: number } {
  let matched = 0;
  for (const m of matches) if (m.rowId) matched++;
  return { matched, unmatched: matches.length - matched };
}

/** Tally matches by strategy, for the upload preview. */
export function summarizeMatches(matches: BulkMatch[]): {
  exact: number;
  code: number;
  fuzzy: number;
  unmatched: number;
  /** True when the similarity pass was skipped because there was too much to compare. */
  fuzzyDeclined: boolean;
} {
  const out = { exact: 0, code: 0, fuzzy: 0, unmatched: 0, fuzzyDeclined: false };
  for (const m of matches) {
    if (!m.rowId) out.unmatched++;
    else if (m.strategy) out[m.strategy]++;
    if (m.fuzzyDeclined) out.fuzzyDeclined = true;
  }
  return out;
}
