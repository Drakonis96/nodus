/**
 * Historical / genealogical date parsing. Records rarely give clean ISO dates: they
 * say "c. 1850", "antes de 1880", "2 de marzo de 1850", "between 1850 and 1855".
 * This turns those into (a) a normalised display string, (b) a sortable ISO-ish key
 * so a timeline can order fuzzy dates, and (c) a qualifier the UI can badge.
 *
 * Pure and dependency-free so both the main process (when storing events) and the
 * renderer (when displaying them) share one parser. Authored in Spanish — the app's
 * base language — but understands common English forms too.
 */

export type DateQualifier = 'exact' | 'circa' | 'before' | 'after' | 'between' | 'unknown';

export interface ParsedHistoricalDate {
  /** The original input, trimmed. */
  input: string;
  /** Normalised, human-readable form (e.g. "c. 1850", "antes de 1880", "2 mar 1850"). */
  display: string;
  /** Lower-bound sort key 'YYYY-MM-DD', or null when nothing parseable was found. */
  sortKey: string | null;
  /** Upper-bound sort key for ranges; null otherwise. */
  endSortKey: string | null;
  qualifier: DateQualifier;
  /** The anchor year, when known. */
  year: number | null;
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

const MONTH_ABBR_ES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface DateCore {
  year: number;
  month?: number;
  day?: number;
}

/** Parse a single (unqualified) date token into year/month/day, or null. */
function parseCore(raw: string): DateCore | null {
  const s = raw.trim().toLowerCase().replace(/\bde\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // ISO: YYYY, YYYY-MM, YYYY-MM-DD
  let m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s);
  if (m) {
    return finishCore(Number(m[1]), m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
  }

  // D/M/YYYY (day-first, common in Spanish records)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return finishCore(Number(m[3]), Number(m[2]), Number(m[1]));

  // D monthname YYYY
  m = /^(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]] !== undefined) return finishCore(Number(m[3]), MONTHS[m[2]], Number(m[1]));

  // monthname D, YYYY (English)
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1]] !== undefined) return finishCore(Number(m[3]), MONTHS[m[1]], Number(m[2]));

  // monthname YYYY
  m = /^([a-záéíóú]+)\.?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1]] !== undefined) return finishCore(Number(m[2]), MONTHS[m[1]], undefined);

  return null;
}

function finishCore(year: number, month?: number, day?: number): DateCore | null {
  if (!Number.isFinite(year) || year < 1 || year > 3000) return null;
  if (month !== undefined && (month < 1 || month > 12)) return null;
  if (day !== undefined && (day < 1 || day > 31)) return null;
  return { year, month, day };
}

function lowerKey(core: DateCore): string {
  return `${String(core.year).padStart(4, '0')}-${pad2(core.month ?? 1)}-${pad2(core.day ?? 1)}`;
}

function upperKey(core: DateCore): string {
  return `${String(core.year).padStart(4, '0')}-${pad2(core.month ?? 12)}-${pad2(core.day ?? 31)}`;
}

function displayCore(core: DateCore): string {
  if (core.day && core.month) return `${core.day} ${MONTH_ABBR_ES[core.month]} ${core.year}`;
  if (core.month) return `${MONTH_ABBR_ES[core.month]} ${core.year}`;
  return String(core.year);
}

// Longest alternatives first so "ca"/"circa"/"hacia" aren't truncated to "c"/"h".
const CIRCA_RE = /^(circa|hacia|about|abt\.?|ca\.?|c\.?|h\.?|~)\s*/i;
const BEFORE_RE = /^(before|bef\.?|antes\s+de|ant\.?|<)\s*/i;
const AFTER_RE = /^(after|aft\.?|despu[eé]s\s+de|post\.?|>)\s*/i;

/** Parse a historical date expression. Never throws; unknown input yields a null sort key. */
export function parseHistoricalDate(input: string | null | undefined): ParsedHistoricalDate {
  const trimmed = (input ?? '').trim();
  const empty: ParsedHistoricalDate = {
    input: trimmed,
    display: trimmed,
    sortKey: null,
    endSortKey: null,
    qualifier: trimmed ? 'unknown' : 'unknown',
    year: null,
  };
  if (!trimmed) return empty;

  // Range: "between X and Y", "entre X y Y", GEDCOM "BET X AND Y", "X/Y" or "X - Y".
  const range =
    /^(?:between|entre|bet)\s+(.+?)\s+(?:and|y)\s+(.+)$/i.exec(trimmed) ||
    /^(\d{4})\s*[/–—-]\s*(\d{4})$/.exec(trimmed);
  if (range) {
    const a = parseCore(range[1]);
    const b = parseCore(range[2]);
    if (a && b) {
      return {
        input: trimmed,
        display: `entre ${displayCore(a)} y ${displayCore(b)}`,
        sortKey: lowerKey(a),
        endSortKey: upperKey(b),
        qualifier: 'between',
        year: a.year,
      };
    }
  }

  let rest = trimmed;
  let qualifier: DateQualifier = 'exact';
  let prefix = '';
  if (CIRCA_RE.test(rest)) {
    qualifier = 'circa';
    prefix = 'c. ';
    rest = rest.replace(CIRCA_RE, '');
  } else if (BEFORE_RE.test(rest)) {
    qualifier = 'before';
    prefix = 'antes de ';
    rest = rest.replace(BEFORE_RE, '');
  } else if (AFTER_RE.test(rest)) {
    qualifier = 'after';
    prefix = 'después de ';
    rest = rest.replace(AFTER_RE, '');
  }

  const core = parseCore(rest);
  if (!core) {
    return { ...empty, qualifier: qualifier === 'exact' ? 'unknown' : qualifier };
  }

  return {
    input: trimmed,
    display: `${prefix}${displayCore(core)}`,
    sortKey: lowerKey(core),
    endSortKey: null,
    qualifier,
    year: core.year,
  };
}
