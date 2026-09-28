/**
 * Knowledge items: the atomic facts a complete study guide is built from. The model
 * proposes them while reading; code decides whether each one is anchored in the
 * passage it claims to come from, merges duplicates and numbers them. Nothing
 * reaches the guide as "from your materials" unless its quote was found in the text.
 */
import type { CompleteGuidePassage } from './snapshot';
import { normalizePassageText } from './snapshot';

export const COMPLETE_GUIDE_ITEM_TYPES = ['definition', 'concept', 'formula', 'rule', 'procedure', 'example', 'mistake', 'event', 'fact', 'figure'] as const;
export type CompleteGuideItemType = (typeof COMPLETE_GUIDE_ITEM_TYPES)[number];
export type CompleteGuideImportance = 'core' | 'support' | 'detail';
export type CompleteGuideAnchor = 'exact' | 'fuzzy' | 'missing';

export interface CompleteGuideVariable { symbol: string; meaning: string; unit?: string }

export interface CompleteGuideEvidence {
  passageId: string;
  sourceKey: string;
  quote: string;
  anchor: CompleteGuideAnchor;
}

export interface CompleteGuideItem {
  /** K0001… in reading order. */
  id: string;
  type: CompleteGuideItemType;
  title: string;
  statement: string;
  latex?: string;
  variables?: CompleteGuideVariable[];
  conditions?: string[];
  steps?: string[];
  /** Worked examples: the solution as given by the material. */
  solution?: string;
  /** Events: the date as written. */
  date?: string;
  importance: CompleteGuideImportance;
  /** Chapter (unit) the item belongs to, from its first evidence passage. */
  unitKey: string;
  evidence: CompleteGuideEvidence[];
  /** The quote could not be found because the extracted text is damaged (formulas). */
  reconstructedLatex?: boolean;
  /** Reading order of the first evidence passage, then position inside the window. */
  order: number;
}

/** What one extraction call may return for one item, before validation. */
export interface CompleteGuideRawItem {
  type: CompleteGuideItemType;
  title: string;
  statement: string;
  latex?: string;
  variables?: CompleteGuideVariable[];
  conditions?: string[];
  steps?: string[];
  solution?: string;
  date?: string;
  importance: CompleteGuideImportance;
  passageId: string;
  quote: string;
}

const TYPES = new Set<string>(COMPLETE_GUIDE_ITEM_TYPES);
const IMPORTANCE = new Set<string>(['core', 'support', 'detail']);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Item prose is inserted into lists, tables and cards: block markup copied from notes
 * (headings, callout markers, quote bars) would break them. Quotes keep the raw text. */
const prose = (value: unknown, max: number) => text(typeof value === 'string' ? value.replace(/^\s*(?:>\s*)+/, '').replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/\[![\w-]+\]\s*/g, '') : value, max);
const list = (value: unknown, max: number, each: number) => (Array.isArray(value) ? value.map((entry) => text(entry, each)).filter(Boolean).slice(0, max) : []);

export function validExtractionResult(value: unknown): value is { items: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items));
}

export function normalizeRawItem(raw: unknown): CompleteGuideRawItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const type = TYPES.has(String(input.type)) ? input.type as CompleteGuideItemType : 'concept';
  const statement = prose(input.statement, 1_600);
  const title = prose(input.title, 160) || statement.slice(0, 80);
  const passageId = text(input.passageId, 40);
  if (!statement || !passageId) return null;
  const variables = Array.isArray(input.variables)
    ? input.variables.map((entry) => {
      const variable = entry as Record<string, unknown>;
      const symbol = text(variable?.symbol, 40);
      const meaning = text(variable?.meaning, 200);
      const unit = text(variable?.unit, 40);
      return symbol && meaning ? { symbol, meaning, ...(unit ? { unit } : {}) } : null;
    }).filter((entry): entry is CompleteGuideVariable => Boolean(entry)).slice(0, 16)
    : [];
  const latex = typeof input.latex === 'string' ? input.latex.trim().replace(/^\$+|\$+$/g, '').slice(0, 600) : '';
  const solution = prose(input.solution, 2_400);
  const date = text(input.date, 60);
  const conditions = list(input.conditions, 10, 300);
  const steps = list(input.steps, 16, 400);
  return {
    type,
    title,
    statement,
    ...(latex ? { latex } : {}),
    ...(variables.length ? { variables } : {}),
    ...(conditions.length ? { conditions } : {}),
    ...(steps.length ? { steps } : {}),
    ...(solution ? { solution } : {}),
    ...(date ? { date } : {}),
    importance: IMPORTANCE.has(String(input.importance)) ? input.importance as CompleteGuideImportance : 'support',
    passageId,
    quote: typeof input.quote === 'string' ? input.quote.trim().slice(0, 1_500) : '',
  };
}

/** Normalization shared by quotes and passages: Unicode forms, ligatures, hyphenation,
 * typographic quotes and dashes, whitespace and case. */
export function normalizeForAnchor(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/[“”«»„‟"]/g, '"')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function tokens(value: string): string[] {
  return normalizeForAnchor(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 || /\d/.test(token));
}

/** Where a proposed quote stands against the passage it names. */
export function anchorQuote(passageText: string, quote: string, lenient = false): CompleteGuideAnchor {
  const normalizedQuote = normalizeForAnchor(quote);
  if (normalizedQuote.length < 8) return 'missing';
  const normalizedPassage = normalizeForAnchor(passageText);
  if (normalizedPassage.includes(normalizedQuote)) return 'exact';
  const quoteTokens = tokens(quote);
  if (quoteTokens.length < (lenient ? 2 : 4)) return 'missing';
  const passageTokens = new Set(tokens(passageText));
  const hits = quoteTokens.filter((token) => passageTokens.has(token)).length;
  return hits / quoteTokens.length >= (lenient ? 0.6 : 0.8) ? 'fuzzy' : 'missing';
}

/**
 * Anchor one raw item inside the passages of its reading window. The passage the
 * model named is tried first, then its neighbours (models often cite the passage
 * before or after). Formulas may survive a damaged quote, marked as reconstructed.
 */
export function anchorRawItem(raw: CompleteGuideRawItem, window: CompleteGuidePassage[]): { passage: CompleteGuidePassage; anchor: CompleteGuideAnchor; reconstructed: boolean } | null {
  const named = window.findIndex((passage) => passage.id === raw.passageId);
  const ordered = named < 0 ? window : [window[named], ...window.filter((_, index) => index !== named).sort((a, b) => Math.abs(window.indexOf(a) - named) - Math.abs(window.indexOf(b) - named))];
  const lenient = raw.type === 'formula';
  for (const passage of ordered) {
    const anchor = anchorQuote(passage.text, raw.quote, lenient);
    if (anchor !== 'missing') return { passage, anchor, reconstructed: false };
  }
  if (lenient && named >= 0) return { passage: window[named], anchor: 'missing', reconstructed: true };
  return null;
}

const DENSE_PATTERNS: RegExp[] = [
  /[=≈≠≤≥⇌→⟶↔]/,
  /\\(frac|sqrt|sum|int|cdot|times|ce)\b/,
  /\b[a-zA-Z]\s*[_^]\s*\{?[\w+-]/,
  /(se define|se denomina|se llama|definici[oó]n|llamamos|is defined|is called|definition|définition|on appelle|definiert|definição|definizione|tanım|định nghĩa|定义|定義|определени|визначенн|정의)/iu,
  /(ejemplo|ejercicio|problema resuelto|soluci[oó]n|example|exercise|worked|solution|exemple|beispiel|exemplo|esempio|örnek|ví dụ|例|пример|приклад|예)/iu,
];

/** Passages that look like they hold formulas, definitions or worked examples. */
export function looksDense(passageText: string): boolean {
  return DENSE_PATTERNS.some((pattern) => pattern.test(passageText));
}

export interface PendingItem { raw: CompleteGuideRawItem; passage: CompleteGuidePassage; anchor: CompleteGuideAnchor; reconstructed: boolean; position: number }

/**
 * Merge exact duplicates (same type and statement) keeping every piece of evidence,
 * order by reading position and number the result K0001….
 */
export function finalizeItems(
  pending: PendingItem[],
  passageOrder: Map<string, number>,
  unitOfSource: Map<string, string>,
): CompleteGuideItem[] {
  const byKey = new Map<string, CompleteGuideItem>();
  const sorted = [...pending].sort((a, b) => (passageOrder.get(a.passage.id) ?? 0) - (passageOrder.get(b.passage.id) ?? 0) || a.position - b.position);
  for (const entry of sorted) {
    const key = `${entry.raw.type}\0${normalizePassageText(entry.raw.statement)}`;
    const evidence: CompleteGuideEvidence = { passageId: entry.passage.id, sourceKey: entry.passage.sourceKey, quote: entry.raw.quote, anchor: entry.anchor };
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.evidence.some((item) => item.passageId === evidence.passageId)) existing.evidence.push(evidence);
      if (rank(entry.raw.importance) < rank(existing.importance)) existing.importance = entry.raw.importance;
      continue;
    }
    const { passageId: _passageId, quote: _quote, ...content } = entry.raw;
    byKey.set(key, {
      id: '',
      ...content,
      unitKey: unitOfSource.get(entry.passage.sourceKey) ?? 'root',
      evidence: [evidence],
      ...(entry.reconstructed ? { reconstructedLatex: true } : {}),
      order: (passageOrder.get(entry.passage.id) ?? 0) * 1_000 + entry.position,
    });
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, id: `K${String(index + 1).padStart(4, '0')}` }));
}

function rank(importance: CompleteGuideImportance): number {
  return importance === 'core' ? 0 : importance === 'support' ? 1 : 2;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) { dot += a[index] * b[index]; na += a[index] ** 2; nb += b[index] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Semantic duplicates (the same definition phrased twice by two handouts) are merged
 * inside one unit and type, keeping the fuller statement and every source.
 * Returns the surviving items renumbered, and a map from removed id to kept id.
 */
export function mergeNearDuplicates(items: CompleteGuideItem[], vectors: Array<number[] | null>, threshold = 0.92): { items: CompleteGuideItem[]; mergedInto: Map<string, string> } {
  const mergedInto = new Map<string, string>();
  const alive = items.map((item) => ({ ...item, evidence: [...item.evidence] }));
  for (let i = 0; i < alive.length; i += 1) {
    if (mergedInto.has(alive[i].id) || !vectors[i]) continue;
    for (let j = i + 1; j < alive.length; j += 1) {
      if (mergedInto.has(alive[j].id) || !vectors[j]) continue;
      if (alive[i].type !== alive[j].type || alive[i].unitKey !== alive[j].unitKey) continue;
      if (alive[i].type === 'example' || alive[i].type === 'event') continue; // distinct instances, not paraphrases
      if (cosine(vectors[i]!, vectors[j]!) < threshold) continue;
      const keep = alive[i];
      const drop = alive[j];
      if (drop.statement.length > keep.statement.length) { keep.statement = drop.statement; keep.title = drop.title; }
      for (const evidence of drop.evidence) if (!keep.evidence.some((entry) => entry.passageId === evidence.passageId)) keep.evidence.push(evidence);
      if (rank(drop.importance) < rank(keep.importance)) keep.importance = drop.importance;
      mergedInto.set(drop.id, keep.id);
    }
  }
  const survivors = alive.filter((item) => !mergedInto.has(item.id));
  const renumber = new Map(survivors.map((item, index) => [item.id, `K${String(index + 1).padStart(4, '0')}`]));
  for (const [from, to] of mergedInto) mergedInto.set(from, renumber.get(to) ?? to);
  return { items: survivors.map((item) => ({ ...item, id: renumber.get(item.id)! })), mergedInto };
}
