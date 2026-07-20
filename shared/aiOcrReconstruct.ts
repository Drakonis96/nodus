// Nodus AI OCR — reconstruction of the layout-labelled blocks into clean Markdown.
// Pure and dependency-free. Ported from the reference engine's reconstruction logic:
// blocks are placed in reading order (by bounding box), hyphenation and soft line
// wraps are undone, TITLE blocks become `#` headings and everything else becomes
// paragraphs. The label filter lets a reader keep only body + titles by default and
// opt into headers/footnotes/captions.
import { OCR_BLOCK_LABELS, type OcrBlock, type OcrBlockLabel, type OcrPageResult } from './aiOcrTypes';

/** Labels kept by default: the reading content, without page chrome. */
export const DEFAULT_INCLUDE_LABELS: readonly OcrBlockLabel[] = ['TITLE', 'MAIN_TEXT'];

// A token that cannot occur in transcribed prose, used to protect true paragraph
// breaks while single (soft-wrap) newlines are flattened to spaces.
const PARAGRAPH_SENTINEL = '___NODUS_PARAGRAPH_BREAK___';

/**
 * Clean a single block's text:
 *  1. rejoin words hyphenated across a line break ("exam-\nple" -> "example"),
 *  2. preserve genuine paragraph breaks (blank lines) inside the block,
 *  3. collapse remaining single line breaks into spaces,
 *  4. normalize whitespace per paragraph.
 */
export function cleanBlockContent(text: string): string {
  if (!text) return '';
  // Hyphen at end of a (soft-wrapped) line -> remove hyphen and the break.
  let cleaned = text.replace(/-\s*[\r\n]+\s*/g, '');
  // Protect real paragraph breaks (two+ newlines) before flattening single ones.
  cleaned = cleaned.replace(/(\r\n|\n|\r){2,}/g, PARAGRAPH_SENTINEL);
  // Remaining single line breaks are soft wraps -> spaces.
  cleaned = cleaned.replace(/[\r\n]+/g, ' ');
  // Restore the protected paragraph breaks.
  cleaned = cleaned.split(PARAGRAPH_SENTINEL).join('\n\n');
  return cleaned
    .split('\n\n')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

/** Sort a page's blocks into reading order by bounding box (top-to-bottom, then
 *  left-to-right on the same visual line). Blocks without a box keep their order. */
function sortByReadingOrder(blocks: OcrBlock[]): OcrBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const boxA = a.block.box_2d;
      const boxB = b.block.box_2d;
      if (!boxA || !boxB) return a.index - b.index; // stable when position unknown
      // Same visual line (Y within 10 normalized units) -> left-to-right.
      if (Math.abs(boxA[0] - boxB[0]) > 10) return boxA[0] - boxB[0];
      if (boxA[1] !== boxB[1]) return boxA[1] - boxB[1];
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

function normalizeIncludeLabels(labels?: readonly OcrBlockLabel[]): Set<OcrBlockLabel> {
  const list = labels && labels.length > 0 ? labels : DEFAULT_INCLUDE_LABELS;
  const valid = list.filter((l) => (OCR_BLOCK_LABELS as readonly string[]).includes(l));
  return new Set(valid.length > 0 ? valid : DEFAULT_INCLUDE_LABELS);
}

/** Reconstruct one page into Markdown. TITLE -> `# heading`, others -> paragraphs. */
export function pageToMarkdown(page: OcrPageResult, includeLabels?: readonly OcrBlockLabel[]): string {
  if (page.blankPage && page.blocks.length === 0) return '';
  const include = normalizeIncludeLabels(includeLabels);
  let out = '';
  for (const block of sortByReadingOrder(page.blocks)) {
    if (!include.has(block.label)) continue;
    const content = cleanBlockContent(block.text);
    if (!content) continue;
    if (block.label === 'TITLE') {
      out += `\n\n# ${content}\n\n`;
    } else {
      out += `${content}\n\n`;
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Reconstruct a whole document (ordered pages) into one clean Markdown string. */
export function reconstructMarkdown(
  pages: OcrPageResult[],
  includeLabels?: readonly OcrBlockLabel[],
): string {
  const parts: string[] = [];
  for (const page of pages) {
    const md = pageToMarkdown(page, includeLabels);
    if (md) parts.push(md);
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
