// Nodus AI OCR — the per-page engine. Electron-free: it takes an INJECTED model-call
// bundle (bound to aiClient's completeJson / completeTextNeutral by the wiring layer,
// or to a mock in tests) so it can be unit-tested without the AI stack. It never
// imports aiClient directly.
//
// Robustness (the plan's #1 risk — many local/free vision models can't emit valid
// JSON): structured mode asks for labelled JSON blocks, but falls back to a verbatim
// plain-text transcription when the JSON is unusable. A completely empty response in
// the default structured path is surfaced as an error (retryable) rather than a fake
// blank page, so a model that silently returns nothing is never reported as "done".
import { buildOcrSystemPrompt, buildOcrTextPrompt, OCR_USER_PROMPT } from '@shared/aiOcrPrompt';
import {
  isOcrPageShape,
  normalizeOcrPageResult,
  pageHasText,
  type OcrOptions,
  type OcrOutputMode,
  type OcrPageResult,
} from '@shared/aiOcrTypes';
import type { VisionImagePart } from '@shared/imageAnalysis';
import type { ModelRef } from '@shared/types';

/** The subset of aiClient's CallOpts the engine needs. Structurally compatible with
 *  the real completeJson/completeText, which accept a superset. */
export interface OcrCallOpts {
  system: string;
  user: string;
  images: VisionImagePart[];
  temperature?: number;
  maxTokens?: number;
  plainContext?: boolean;
}

/** Injected model-call bundle. The wiring binds these to aiClient. */
export interface OcrModelCall {
  completeJson<T>(opts: OcrCallOpts, guard: (v: unknown) => v is T, model?: ModelRef | null): Promise<T>;
  completeText(opts: OcrCallOpts, model?: ModelRef | null): Promise<string>;
}

export interface OcrPageOutcome {
  result: OcrPageResult;
  /** Which mode actually produced the result (structured, or the text fallback). */
  mode: OcrOutputMode;
}

const OCR_TEMPERATURE = 0.1;
// Generous so a dense full page isn't truncated; the AI client clamps this to a local
// model's loaded context window automatically.
const OCR_MAX_TOKENS = 8000;

/** Turn a verbatim plain-text transcription into a single-block page result. An empty
 *  transcription is treated as a blank page (the text prompt asks for "" when blank). */
function textToPageResult(text: string): OcrPageResult {
  const trimmed = (text ?? '').trim();
  // Strip an accidental ``` fence a chatty model may wrap around the text.
  const unfenced = trimmed
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  if (!unfenced) return { blankPage: true, blocks: [] };
  return { blankPage: false, blocks: [{ text: unfenced, label: 'MAIN_TEXT' }] };
}

/** OCR a single page image. Returns the page result plus the mode that produced it. */
export async function ocrPageImage(
  image: VisionImagePart,
  options: OcrOptions,
  model: ModelRef | null,
  call: OcrModelCall,
): Promise<OcrPageOutcome> {
  const base = { images: [image], temperature: OCR_TEMPERATURE, maxTokens: OCR_MAX_TOKENS, plainContext: true };

  // User explicitly chose the simple verbatim path: trust it, empty = blank.
  if (options.outputMode === 'text') {
    const text = await call.completeText({ system: buildOcrTextPrompt(options), user: OCR_USER_PROMPT, ...base }, model);
    return { result: textToPageResult(text), mode: 'text' };
  }

  // Structured path: ask for labelled JSON blocks.
  let structured: OcrPageResult | null = null;
  try {
    const raw = await call.completeJson(
      { system: buildOcrSystemPrompt(options), user: OCR_USER_PROMPT, ...base },
      isOcrPageShape,
      model,
    );
    structured = normalizeOcrPageResult(raw);
  } catch {
    structured = null; // unusable JSON — fall through to the verbatim fallback
  }
  if (structured?.blankPage) return { result: structured, mode: 'structured' };
  if (structured && pageHasText(structured)) return { result: structured, mode: 'structured' };

  // The JSON was missing or empty-but-not-blank. Retry as verbatim text — this is what
  // rescues models that can't produce valid JSON.
  const text = await call.completeText({ system: buildOcrTextPrompt(options), user: OCR_USER_PROMPT, ...base }, model);
  const result = textToPageResult(text);
  if (pageHasText(result)) return { result, mode: 'text' };

  // Neither path yielded any text and the model never signalled a blank page: it
  // produced nothing. Surface it as a (retryable) error instead of a fake blank page.
  throw new Error('El modelo de visión no devolvió texto para esta página (respuesta vacía).');
}
