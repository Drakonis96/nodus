import type { ModelRef, TranslationLanguage } from '@shared/types';
import { completeTextNeutral } from './aiClient';

// AI translation of a report/immersion assembled as Markdown. The document is
// translated in order-preserving chunks (a long report exceeds a single model
// response), each chunk instructed to keep Markdown structure and citation links
// intact so the translated copy still renders — and still cites — correctly.

// Character budget per chunk. Translation output is roughly the same length as the
// input, so this keeps each response comfortably inside the model's token limit
// while minimizing the number of round-trips.
const CHUNK_CHARS = 5000;
// Give each chunk enough room to grow (some languages are wordier than the source).
const CHUNK_MAX_TOKENS = 4000;

function translationSystemPrompt(language: TranslationLanguage): string {
  const target = `${language.name} (${language.nativeName})`;
  return `You are an expert academic and literary translator. Translate the user's Markdown document into ${target}.

STRICT RULES:
- Output ONLY the translated Markdown. No preamble, no explanations, no notes, and do NOT wrap the whole document in a code fence.
- Preserve the Markdown structure EXACTLY: heading levels (#, ##, ###), ordered/unordered lists, bold/italic, blockquotes (>), horizontal rules, and blank lines. Keep tables intact — the same number of columns, the same | pipes and the |---| separator row.
- Do NOT translate, reformat, or remove any URL or link target. Links look like [visible text](url): translate the visible text but copy the url character-for-character. This is critical for links whose url starts with "nodus://" — they are citations and MUST stay byte-identical.
- Do NOT alter numbers, dates, code, math, or reference keys.
- Translate the running prose, headings, list items, table cells, and quoted passages into ${target}. Keep quotation marks and any author/year attribution.
- Keep the meaning faithful and the register academic. Do NOT summarize, add, or omit content.
- If a span is already written in ${target}, leave it unchanged.`;
}

/** Split Markdown into order-preserving chunks at blank-line block boundaries,
 *  greedily packing blocks up to the budget. An oversized single block (rare) is
 *  hard-split by lines so no chunk blows the token limit. */
export function chunkMarkdown(markdown: string, maxChars = CHUNK_CHARS): string[] {
  const blocks = markdown.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current);
    current = '';
  };
  const pushBlock = (block: string) => {
    if (!current) {
      current = block;
    } else if (current.length + 2 + block.length <= maxChars) {
      current += `\n\n${block}`;
    } else {
      flush();
      current = block;
    }
  };
  for (const block of blocks) {
    if (block.length <= maxChars) {
      pushBlock(block);
      continue;
    }
    // Oversized block: flush what we have, then emit line-sized pieces.
    flush();
    const lines = block.split('\n');
    let piece = '';
    for (const line of lines) {
      if (piece && piece.length + 1 + line.length > maxChars) {
        chunks.push(piece);
        piece = '';
      }
      piece = piece ? `${piece}\n${line}` : line;
    }
    if (piece.trim()) chunks.push(piece);
  }
  flush();
  return chunks.length ? chunks : [markdown];
}

/** Strip a stray leading/trailing ``` fence a model may add around a whole chunk. */
function stripWrappingFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

export interface TranslateOptions {
  markdown: string;
  language: TranslationLanguage;
  model?: ModelRef | null;
  onProgress?: (done: number, total: number) => void;
}

/** Translate an assembled Markdown document. Returns the translated Markdown; the
 *  caller derives the display title from its first heading. */
export async function translateMarkdown(opts: TranslateOptions): Promise<string> {
  const { markdown, language, model, onProgress } = opts;
  const system = translationSystemPrompt(language);
  const chunks = chunkMarkdown(markdown);
  const out: string[] = [];
  onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const translated = await completeTextNeutral(
      { system, user: chunks[i], temperature: 0.2, maxTokens: CHUNK_MAX_TOKENS },
      model
    );
    out.push(stripWrappingFence(translated));
    onProgress?.(i + 1, chunks.length);
  }
  return out.join('\n\n').trim();
}

/** The translated document's title: the first Markdown heading, else a fallback. */
export function titleFromMarkdown(markdown: string, fallback: string): string {
  const match = /^#{1,3}\s+(.+)$/m.exec(markdown);
  return match ? match[1].trim() : fallback;
}
