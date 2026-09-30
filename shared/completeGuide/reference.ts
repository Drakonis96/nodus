/**
 * Reference sections rendered from verified items without a model: glossary, formula
 * sheet, timeline, coverage, source index and the review sheet. Because they are
 * built from data, every line keeps its citation and nothing new can be invented here.
 */
import type { CompleteGuideItem } from './items';
import { normalizeForAnchor } from './items';
import type { CompleteGuideLabels } from './labels';
import { renderTable } from './blocks';
import type { CompleteGuideSnapshotSource } from './snapshot';
import { compactRanges } from './snapshot';
import { invalidMath, strayDollar, truncateOutsideMath } from './math';

type Cite = (itemId: string) => string[];
const citeText = (cite: Cite, id: string) => cite(id).slice(0, 3).join('; ');
const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ');

export function renderGlossary(items: CompleteGuideItem[], cite: Cite, labels: CompleteGuideLabels): string {
  const terms = items
    .filter((item) => (item.type === 'definition' || item.type === 'concept') && item.importance !== 'detail')
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  if (!terms.length) return '';
  return renderTable({
    headers: [labels.term, labels.meaning, labels.source],
    rows: terms.map((item) => [escapeCell(item.title), escapeCell(item.statement), citeText(cite, item.id)]),
  });
}

function formulaLines(item: CompleteGuideItem, cite: Cite, labels: CompleteGuideLabels): string[] {
  const lines = [`**${item.title}** — ${citeText(cite, item.id)}`];
  if (item.latex) lines.push('', '$$', item.latex, '$$');
  else lines.push('', item.statement);
  if (item.variables?.length) lines.push('', `*${labels.variables}:* ${item.variables.map((variable) => `$${variable.symbol}$ ${variable.meaning}${variable.unit ? ` (${variable.unit})` : ''}`).join('; ')}`);
  if (item.conditions?.length) lines.push('', `*${labels.conditions}:* ${item.conditions.join('; ')}`);
  if (item.reconstructedLatex) lines.push('', `*${labels.reconstructedFormula}*`);
  return lines;
}

export function renderFormulaSheet(chapters: Array<{ title: string; items: CompleteGuideItem[] }>, cite: Cite, labels: CompleteGuideLabels): string {
  const parts: string[] = [];
  for (const chapter of chapters) {
    const formulas = chapter.items.filter((item) => item.type === 'formula');
    if (!formulas.length) continue;
    parts.push(`### ${chapter.title}`);
    for (const item of formulas) parts.push(formulaLines(item, cite, labels).join('\n'));
  }
  return parts.join('\n\n');
}

/** Sortable year from dates such as "1789", "25 de marzo de 1874", "s. XVIII", "44 a. C.", "300 BC". */
export function eventYear(date: string): number | null {
  const bc = /\b(a\.?\s?c\.?|bc|bce|av\.?\s?j\.?-?c\.?|v\.?\s?chr\.?)\b/i.test(date);
  // A day or a month number comes before the year in most languages: prefer the longest number.
  const year = date.match(/-?\d{3,4}/) ?? date.match(/-?\d{1,4}/);
  if (year) return Number(year[0]) * (bc ? -1 : 1);
  const roman = date.match(/\b([IVXLC]+)\b/);
  if (roman) {
    const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    let total = 0;
    const letters = roman[1].split('');
    letters.forEach((letter, index) => { const value = values[letter]; total += value < (values[letters[index + 1]] ?? 0) ? -value : value; });
    return (total - 1) * 100 * (bc ? -1 : 1);
  }
  return null;
}

export interface DatedEntry { item: CompleteGuideItem; date: string; year: number }

/** A year (1000–2099) that is not a quantity: not followed by a unit, not part of a longer number. */
const QUOTE_YEAR = /(?<![\d.,/-])(1\d{3}|20\d{2})(?![\d])(?!\s?(?:mL|ml|L|l|m|km|cm|mm|kg|g|mg|Pa|atm|K|J|kJ|N|W|V|°|%|kcal|cal|hab))/;
const YEAR_TYPES = new Set<CompleteGuideItem['type']>(['event', 'fact', 'definition', 'concept', 'rule']);

/**
 * Items that sit at a date, oldest first. The date is the one the extraction recorded;
 * models often type an event as a definition and leave it blank, so where the chapter has
 * no formulas (`quoteYears`) a year in the item's own anchored quote, repeated in its title
 * or statement, stands in for it. Nothing here comes from outside the materials.
 */
export function datedItems(items: CompleteGuideItem[], options: { quoteYears?: boolean } = {}): DatedEntry[] {
  const entries: DatedEntry[] = [];
  for (const item of items) {
    let date = item.date?.trim() ?? '';
    if (date && eventYear(date) === null) date = '';
    if (!date && options.quoteYears && item.importance !== 'detail' && YEAR_TYPES.has(item.type)) {
      const year = item.evidence.map((evidence) => evidence.quote.match(QUOTE_YEAR)?.[1]).find((candidate) => candidate && (item.title.includes(candidate) || item.statement.includes(candidate)));
      if (year) date = year;
    }
    const value = date ? eventYear(date) : null;
    if (date && value !== null) entries.push({ item, date, year: value });
  }
  return entries.sort((a, b) => a.year - b.year || a.item.order - b.item.order);
}

const significant = (value: string) => new Set(normalizeForAnchor(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 3).map((token) => token.slice(0, 6)));

/** The share of `needle`'s significant words (compared by their first letters, to survive inflection) that `haystack` also has. */
function held(needle: string, haystack: string): number {
  const need = significant(needle);
  if (!need.size) return 0;
  const have = significant(haystack);
  let hits = 0;
  for (const token of need) if (have.has(token)) hits += 1;
  return hits / need.size;
}

/**
 * A definition dated by its year repeats the event that opened that year («La Restauración
 * borbónica: régimen que comenzó en 1874…» beside «El pronunciamiento de Sagunto (1874) dio
 * comienzo a la Restauración borbónica»). A chronology lists what happened, so a definition or
 * concept is dropped when another entry of its year already names it or says the same; it stays
 * in the key concepts. Events and facts are never dropped.
 */
export function collapseChronology(entries: DatedEntry[]): DatedEntry[] {
  const concept = (entry: DatedEntry) => entry.item.type === 'definition' || entry.item.type === 'concept';
  return entries.filter((entry, index) => !concept(entry) || !entries.some((other, otherIndex) => otherIndex !== index && other.year === entry.year
    && (!concept(other) || otherIndex < index)
    && (held(entry.item.title, `${other.item.title} ${other.item.statement}`) >= 0.75 || held(entry.item.statement, other.item.statement) >= 0.6)));
}

/** The dated events of a chapter as its chronology lists them. */
export function chronologyOf(items: CompleteGuideItem[], options: { quoteYears?: boolean } = {}): DatedEntry[] {
  return collapseChronology(datedItems(items, options));
}

export type ChapterKind = 'quantitative' | 'narrative' | 'conceptual';

/**
 * What a chapter is about, from its items alone: formulas make it quantitative, a run of
 * dated items makes it narrative. It steers the writer (no equations for a political
 * system, no date drills next to a chronology) and decides whether years may be read
 * from quotes.
 */
export function chapterProfile(items: CompleteGuideItem[]): { kind: ChapterKind; formulas: number; dated: number; quoteYears: boolean } {
  const formulas = items.filter((item) => item.type === 'formula').length;
  const quoteYears = formulas === 0;
  const dated = chronologyOf(items, { quoteYears }).length;
  return { kind: formulas >= 2 ? 'quantitative' : dated >= 3 ? 'narrative' : 'conceptual', formulas, dated, quoteYears };
}

/** Whole sentences up to `max` characters; a single long sentence is cut outside formulas. */
export function sentenceCap(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?。]+[.!?。]+(?:\s|$)/g) ?? [];
  let result = '';
  for (const sentence of sentences) {
    if ((result + sentence).length > max) break;
    result += sentence;
  }
  return result.trim() || truncateOutsideMath(clean, max);
}

/** The chapter's dated events as a list, oldest first, each with its citation. */
export function renderChronology(entries: DatedEntry[], cite: Cite, labels: CompleteGuideLabels): string {
  void labels;
  return entries.map(({ item, date }) => {
    const statement = sentenceCap(item.statement, 260);
    // The statement is a sentence of its own; the title leads it only when the sentence does not already name it.
    const lead = held(item.title, statement) >= 0.6 ? '' : `${item.title}: `;
    const cites = citeText(cite, item.id);
    return `- **${date}** — ${lead}${statement}${cites ? ` (${cites})` : ''}`;
  }).join('\n');
}

/**
 * The concepts a chapter is built on, described in one line each in reading order: its
 * definitions and concepts, the essential ones first when there are more than ten.
 */
export function renderKeyConcepts(items: CompleteGuideItem[], cite: Cite, labels: CompleteGuideLabels): string {
  void labels;
  const rank = (item: CompleteGuideItem) => (item.importance === 'core' ? 0 : 1);
  const concepts = items.filter((item) => (item.type === 'definition' || item.type === 'concept') && item.importance !== 'detail');
  if (concepts.length < 3) return '';
  return [...concepts].sort((a, b) => rank(a) - rank(b) || a.order - b.order).slice(0, 10).sort((a, b) => a.order - b.order).map((item) => {
    const cites = citeText(cite, item.id);
    return `- **${item.title}**: ${sentenceCap(item.statement, 240)}${cites ? ` (${cites})` : ''}`;
  }).join('\n');
}

export function renderTimelineEntries(entries: DatedEntry[], cite: Cite, labels: CompleteGuideLabels): string {
  return renderTable({
    headers: [labels.date, labels.event, labels.source],
    rows: entries.map(({ item, date }) => [escapeCell(date), escapeCell(`**${item.title}**: ${item.statement}`), citeText(cite, item.id)]),
  });
}

export function renderTimeline(items: CompleteGuideItem[], cite: Cite, labels: CompleteGuideLabels): string {
  const entries = datedItems(items);
  return entries.length < 3 ? '' : renderTimelineEntries(entries, cite, labels);
}

export interface SourceCoverage {
  source: CompleteGuideSnapshotSource;
  passagesRead: number;
  passagesTotal: number;
  itemsExtracted: number;
  itemsUsed: number;
  duplicates: number;
  unreadRanges: string[];
}

export function renderCoverage(rows: SourceCoverage[], labels: CompleteGuideLabels): string {
  const table = renderTable({
    headers: [labels.source, labels.title, labels.read, labels.itemsUsed, labels.notes],
    rows: rows.map((row) => {
      const notes: string[] = [];
      if (row.source.pages?.empty.length) notes.push(`${labels.pagesWithoutText}: ${compactRanges(row.source.pages.empty)}`);
      if (row.unreadRanges.length) notes.push(`${labels.unreadParts}: ${row.unreadRanges.join(', ')}`);
      if (row.duplicates) notes.push(`${labels.duplicates}: ${row.duplicates}`);
      const pages = row.source.pages ? ` (${row.source.pages.withText}/${row.source.pages.total})` : '';
      return [row.source.alias, escapeCell(row.source.title), `${row.passagesRead}/${row.passagesTotal}${pages}`, `${row.itemsUsed}/${row.itemsExtracted}`, escapeCell(notes.join('; ') || '—')];
    }),
  });
  return `${labels.coverageIntro}\n\n${table}`;
}

export function renderSourceIndex(entries: Array<{ source: CompleteGuideSnapshotSource; ranges: string }>): string {
  return entries.map(({ source, ranges }) => `- **${source.alias}** — ${source.title}${source.path ? ` · *${source.path}*` : ''}${ranges ? ` · ${ranges}` : ''}`).join('\n');
}

export function validCheatSheetSelection(value: unknown): value is { points: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { points?: unknown }).points));
}

/**
 * Keep a model phrasing only when it is short and visibly about its item; otherwise
 * the item's own title and statement are used. The review sheet cannot gain facts.
 */
export function acceptCheatPhrase(phrase: string, item: CompleteGuideItem): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  const own = new Set(normalizeForAnchor(`${item.title} ${item.statement}`).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 3));
  const phraseTokens = normalizeForAnchor(phrase).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 3);
  const overlap = phraseTokens.length ? phraseTokens.filter((token) => own.has(token)).length / phraseTokens.length : 0;
  const digitsOk = (phrase.match(/\d+(?:[.,]\d+)?/g) ?? []).every((number) => `${item.statement} ${item.latex ?? ''} ${item.title}`.includes(number));
  // A phrase cut inside a formula would print a raw `$`: fall back to the item itself.
  const mathOk = !strayDollar(phrase) && !invalidMath(phrase).length;
  if (words.length && words.length <= 24 && overlap >= 0.5 && digitsOk && mathOk) return phrase.trim();
  return truncateOutsideMath(`${item.title}: ${item.statement}`, 219);
}

export function renderCheatSheet(
  chapters: Array<{ title: string; items: CompleteGuideItem[]; points: Array<{ itemId: string; phrase: string }> }>,
  cite: Cite,
  labels: CompleteGuideLabels,
): string {
  const parts: string[] = [];
  for (const chapter of chapters) {
    const byId = new Map(chapter.items.map((item) => [item.id, item]));
    const chosen = chapter.points.filter((point) => byId.has(point.itemId));
    const fallback = chosen.length ? [] : chapter.items.filter((item) => item.importance === 'core').slice(0, 10).map((item) => ({ itemId: item.id, phrase: '' }));
    const points = [...chosen, ...fallback];
    const formulas = chapter.items.filter((item) => item.type === 'formula' && item.importance !== 'detail');
    if (!points.length && !formulas.length) continue;
    parts.push(`### ${chapter.title}`);
    if (points.length) {
      parts.push(`**${labels.keyPoints}**`);
      parts.push(points.map((point) => {
        const item = byId.get(point.itemId)!;
        return `- ${acceptCheatPhrase(point.phrase, item)} (${citeText(cite, item.id)})`;
      }).join('\n'));
    }
    if (formulas.length) {
      parts.push(`**${labels.formulaSheet}**`);
      parts.push(formulas.map((item) => `- ${item.title}: ${item.latex ? `$${item.latex}$` : item.statement}${item.conditions?.length ? ` — ${item.conditions.join('; ')}` : ''}`).join('\n'));
    }
  }
  return parts.join('\n\n');
}
