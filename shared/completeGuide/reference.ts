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
  if (item.latex) lines.push('', `$$${item.latex}$$`);
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

/** Sortable year from dates such as "1789", "s. XVIII", "44 a. C.", "300 BC". */
export function eventYear(date: string): number | null {
  const bc = /\b(a\.?\s?c\.?|bc|bce|av\.?\s?j\.?-?c\.?|v\.?\s?chr\.?)\b/i.test(date);
  const year = date.match(/-?\d{1,4}/);
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

export function renderTimeline(items: CompleteGuideItem[], cite: Cite, labels: CompleteGuideLabels): string {
  const events = items.filter((item) => item.type === 'event' && item.date && eventYear(item.date) !== null)
    .sort((a, b) => (eventYear(a.date!) ?? 0) - (eventYear(b.date!) ?? 0) || a.order - b.order);
  if (events.length < 3) return '';
  return renderTable({
    headers: [labels.date, labels.event, labels.source],
    rows: events.map((item) => [escapeCell(item.date!), escapeCell(`**${item.title}**: ${item.statement}`), citeText(cite, item.id)]),
  });
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
  if (words.length && words.length <= 24 && overlap >= 0.5 && digitsOk) return phrase.trim();
  const fallback = `${item.title}: ${item.statement}`;
  return fallback.length > 220 ? `${fallback.slice(0, 219)}…` : fallback;
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
