/**
 * The writer returns typed blocks; this module decides their provenance and renders
 * them. Labels, callout markers and citation links are produced here from data: a
 * block is "from your materials" only if it names extracted items, an AI example is
 * labelled as such and never links to a material, and web blocks only cite the web.
 */
import type { CompleteGuideItem } from './items';
import type { CompleteGuideLabels } from './labels';

export const COMPLETE_GUIDE_BLOCK_KINDS = ['explanation', 'definition', 'formula', 'rule', 'procedure', 'example', 'ai_example', 'ai_analogy', 'mistake', 'table', 'memorize', 'selfcheck', 'web'] as const;
export type CompleteGuideBlockKind = (typeof COMPLETE_GUIDE_BLOCK_KINDS)[number];
export type CompleteGuideProvenance = 'materials' | 'ai' | 'web' | 'derived';

export interface CompleteGuideTable { headers: string[]; rows: string[][] }

export interface CompleteGuideBlock {
  kind: CompleteGuideBlockKind;
  provenance: CompleteGuideProvenance;
  title?: string;
  markdown: string;
  itemIds: string[];
  table?: CompleteGuideTable;
  question?: string;
  answer?: string;
  /** Web blocks: ids of recorded web passages (`web:<sha>`). */
  webPassageIds?: string[];
  /** Tables whose rows already carry their own citations (e.g. "Detalles adicionales"). */
  citationsInRows?: boolean;
  /** Result of verification, for the coverage panel. */
  audit?: { checked: boolean; removedSentences: number; repaired: boolean };
}

export interface WrittenBlocksResult { blocks: CompleteGuideBlock[]; dropped: { unsupported: number; aiDisabled: number; malformed: number } }

const KINDS = new Set<string>(COMPLETE_GUIDE_BLOCK_KINDS);
const MATERIAL_KINDS = new Set<CompleteGuideBlockKind>(['explanation', 'definition', 'formula', 'rule', 'procedure', 'example', 'table', 'memorize']);

export function validWrittenBlocks(value: unknown): value is { blocks: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { blocks?: unknown }).blocks));
}

/**
 * Remove what only code may write: links and bare URLs (citations are appended from
 * item evidence), callout markers, headings (the outline is ours), HTML and any
 * pseudo-citation such as `[A1]`, `[K0012]` or `(p. 12)` that the model imitated.
 */
export function sanitizeModelMarkdown(value: string): string {
  return value
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\[[^\]]*\]\((?:nodus|file|javascript):[^)]*\)/gi, '')
    .replace(/\[(?:[ADGKW]\d+(?:\.\d+)?(?:\s*[,;·]\s*[^\]]{0,30})?)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(https?:[^)]*\)/gi, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/^\s*>?\s*\[!\w[\w-]*\][^\n]*$/gim, '')
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/\[(?:[ADGKW]\d+(?:\.\d+)?(?:\s*[,;·]\s*[^\]]{0,30})?)\]/g, '')
    .replace(/\((?:K\d{4}(?:\s*,\s*K\d{4})*)\)/g, '')
    .replace(/(?<=\S)[ \t]{2,}/g, ' ')
    .replace(/(?<=\S) +([.,;:!?)])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cell(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? sanitizeModelMarkdown(String(value)).replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').slice(0, 400)
    : '';
}

function normalizeTable(raw: unknown): CompleteGuideTable | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as { headers?: unknown; rows?: unknown };
  const headers = Array.isArray(input.headers) ? input.headers.map(cell).filter(Boolean).slice(0, 6) : [];
  if (headers.length < 2 || !Array.isArray(input.rows)) return null;
  const rows = input.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => headers.map((_, index) => cell(row[index])))
    .filter((row) => row.some(Boolean))
    .slice(0, 40);
  return rows.length ? { headers, rows } : null;
}

export function normalizeWrittenBlocks(
  raw: unknown,
  options: { validItemIds: ReadonlySet<string>; items: ReadonlyMap<string, CompleteGuideItem>; aiExamples: boolean; webIds?: ReadonlySet<string> },
): WrittenBlocksResult {
  const dropped = { unsupported: 0, aiDisabled: 0, malformed: 0 };
  const blocks: CompleteGuideBlock[] = [];
  const list = validWrittenBlocks(raw) ? raw.blocks : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') { dropped.malformed += 1; continue; }
    const input = entry as Record<string, unknown>;
    const kind: CompleteGuideBlockKind = KINDS.has(String(input.kind)) ? input.kind as CompleteGuideBlockKind : 'explanation';
    const itemIds = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(String).map((id) => id.trim().toUpperCase()).filter((id) => options.validItemIds.has(id)))];
    const title = typeof input.title === 'string' ? sanitizeModelMarkdown(input.title).replace(/\n/g, ' ').slice(0, 160) : '';
    const markdown = typeof input.markdown === 'string' ? sanitizeModelMarkdown(input.markdown).slice(0, 8_000) : '';
    const base = { kind, itemIds, ...(title ? { title } : {}) };
    if (kind === 'web') {
      // Only passages actually recorded for this guide; a web block never cites materials.
      const webPassageIds = [...new Set((Array.isArray(input.webPassageIds) ? input.webPassageIds : []).map(String).map((id) => id.trim()).filter((id) => options.webIds?.has(id)))];
      if (!markdown) { dropped.malformed += 1; continue; }
      if (!webPassageIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'web', markdown, webPassageIds });
      continue;
    }
    if (kind === 'ai_example' || kind === 'ai_analogy') {
      if (!options.aiExamples) { dropped.aiDisabled += 1; continue; }
      if (!markdown) { dropped.malformed += 1; continue; }
      blocks.push({ ...base, provenance: 'ai', markdown });
      continue;
    }
    if (kind === 'mistake') {
      if (!markdown) { dropped.malformed += 1; continue; }
      const stated = itemIds.some((id) => options.items.get(id)?.type === 'mistake');
      if (stated) { blocks.push({ ...base, provenance: 'materials', markdown }); continue; }
      if (!options.aiExamples) { dropped.aiDisabled += 1; continue; }
      blocks.push({ ...base, provenance: 'ai', markdown });
      continue;
    }
    if (kind === 'selfcheck') {
      const question = typeof input.question === 'string' ? sanitizeModelMarkdown(input.question).slice(0, 1_000) : '';
      const answer = typeof input.answer === 'string' ? sanitizeModelMarkdown(input.answer).slice(0, 2_000) : '';
      if (!question || !answer) { dropped.malformed += 1; continue; }
      if (!itemIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'derived', markdown: '', question, answer });
      continue;
    }
    if (kind === 'table') {
      const table = normalizeTable(input.table);
      if (!table) { dropped.malformed += 1; continue; }
      if (!itemIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'materials', markdown, table });
      continue;
    }
    if (!markdown) { dropped.malformed += 1; continue; }
    if (MATERIAL_KINDS.has(kind) && !itemIds.length) { dropped.unsupported += 1; continue; }
    blocks.push({ ...base, provenance: 'materials', markdown });
  }
  return { blocks, dropped };
}

/** Items a set of blocks explains with material provenance (AI blocks only illustrate). */
export function coveredItemIds(blocks: CompleteGuideBlock[]): Set<string> {
  const covered = new Set<string>();
  for (const block of blocks) if (block.provenance === 'materials' || block.provenance === 'derived') for (const id of block.itemIds) covered.add(id);
  return covered;
}

export interface RenderContext {
  labels: CompleteGuideLabels;
  /** Citation links for an item's evidence, e.g. `[A1 · p. 12](nodus://…)`. */
  cite: (itemId: string) => string[];
  /** Web blocks: links to their recorded web passages. */
  citeWeb?: (webPassageId: string) => string | null;
}

const CALLOUT: Partial<Record<CompleteGuideBlockKind, { type: string; label: keyof CompleteGuideLabels }>> = {
  definition: { type: 'definition', label: 'definition' },
  formula: { type: 'formula', label: 'formula' },
  rule: { type: 'rule', label: 'rule' },
  procedure: { type: 'procedure', label: 'procedure' },
  example: { type: 'example', label: 'example' },
  ai_example: { type: 'ai-example', label: 'aiExample' },
  ai_analogy: { type: 'ai-analogy', label: 'aiAnalogy' },
  memorize: { type: 'memorize', label: 'memorize' },
  web: { type: 'web', label: 'webSources' },
};

/** Display math on its own lines: `$$x$$` inline in a sentence renders as small inline math. */
export function displayMathOnOwnLines(markdown: string): string {
  return markdown.replace(/[ \t]*\$\$([\s\S]+?)\$\$[ \t]*/g, (_match, tex: string) => `\n\n$$\n${tex.trim()}\n$$\n\n`).replace(/\n{3,}/g, '\n\n').trim();
}

function quoteLines(markdown: string): string {
  return markdown.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function citations(block: CompleteGuideBlock, context: RenderContext): string {
  if (block.provenance === 'web') {
    const links = (block.webPassageIds ?? []).map((id) => context.citeWeb?.(id)).filter((link): link is string => Boolean(link));
    return links.join('; ');
  }
  if (block.provenance !== 'materials' && block.provenance !== 'derived') return '';
  return [...new Set(block.itemIds.flatMap((id) => context.cite(id)))].join('; ');
}

export function renderTable(table: CompleteGuideTable): string {
  return [
    `| ${table.headers.join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/**
 * One block as Markdown. Callouts use the Obsidian syntax `> [!type] Label · title`,
 * which the reader, the PDF and Word render as cards and plain Markdown keeps legible.
 * Self-check answers are returned separately so they can be printed at chapter end.
 */
export function renderBlock(input: CompleteGuideBlock, context: RenderContext, selfCheckNumber?: number): { markdown: string; answer?: string } {
  const { labels } = context;
  const block = { ...input, markdown: displayMathOnOwnLines(input.markdown), ...(input.question ? { question: displayMathOnOwnLines(input.question) } : {}), ...(input.answer ? { answer: displayMathOnOwnLines(input.answer) } : {}) };
  const cites = citations(block, context);
  const citeLine = cites ? `\n\n${cites}` : '';
  if (block.kind === 'selfcheck') {
    const number = selfCheckNumber ?? 1;
    return {
      markdown: `> [!selfcheck] ${labels.selfCheck} ${number}\n${quoteLines(block.question ?? '')}`,
      answer: `**${number}.** ${block.answer ?? ''}${cites ? ` (${cites})` : ''}`,
    };
  }
  if (block.kind === 'table' && block.table) {
    const heading = `**${block.title || labels.summaryTable}**`;
    return { markdown: [heading, block.markdown, renderTable(block.table), block.citationsInRows ? '' : cites].filter(Boolean).join('\n\n') };
  }
  if (block.kind === 'mistake') {
    const type = block.provenance === 'ai' ? 'ai-mistake' : 'mistake';
    const label = block.provenance === 'ai' ? labels.aiMistake : labels.mistake;
    const note = block.provenance === 'ai' ? `\n\n*${labels.aiNote}*` : '';
    return { markdown: `> [!${type}] ${label}${block.title ? ` · ${block.title}` : ''}\n${quoteLines(`${block.markdown}${note}${citeLine}`)}` };
  }
  const callout = CALLOUT[block.kind];
  if (!callout) return { markdown: `${block.markdown}${cites ? ` (${cites})` : ''}` };
  const note = block.provenance === 'ai' ? `\n\n*${labels.aiNote}*` : block.provenance === 'web' ? `\n\n*${labels.webNote}*` : '';
  return { markdown: `> [!${callout.type}] ${labels[callout.label]}${block.title ? ` · ${block.title}` : ''}\n${quoteLines(`${block.markdown}${note}${citeLine}`)}` };
}
