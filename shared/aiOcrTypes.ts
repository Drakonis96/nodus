// Nodus AI OCR (OCR Workspace) — pure, dependency-free types shared by the engine,
// the persistence store and (later) the renderer. No Node or Electron imports, so it
// bundles cleanly for unit tests and for the renderer alike.
//
// A page is transcribed into layout-labelled blocks (the rich "structured" mode) or,
// for models that cannot produce valid JSON, a single verbatim MAIN_TEXT block (the
// "text" fallback mode). `normalizeOcrPageResult` coerces whatever the model returns
// into this shape so a sloppy-but-usable response never crashes the pipeline.
import type { ModelRef } from './types';

/** Layout role of a transcribed block. Mirrors the labels the prompt asks the model
 *  to assign; reconstruction uses them to place titles and to filter out chrome. */
export type OcrBlockLabel = 'TITLE' | 'MAIN_TEXT' | 'FOOTNOTE' | 'HEADER' | 'FOOTER' | 'CAPTION';

export const OCR_BLOCK_LABELS: readonly OcrBlockLabel[] = [
  'TITLE',
  'MAIN_TEXT',
  'FOOTNOTE',
  'HEADER',
  'FOOTER',
  'CAPTION',
];

/** Normalized bounding box `[ymin, xmin, ymax, xmax]` (the model is asked for 0–1000). */
export type OcrBox = [number, number, number, number];

export interface OcrBlock {
  text: string;
  label: OcrBlockLabel;
  box_2d?: OcrBox;
}

export interface OcrPageResult {
  /** True when the page has no readable content (only artefacts / blank scan). */
  blankPage: boolean;
  blocks: OcrBlock[];
}

/** What the model is asked to DO with the text. */
export type OcrProcessingMode = 'ocr' | 'translation' | 'manual';

/** How the model is asked to RETURN the text: labelled JSON blocks, or plain verbatim
 *  text. `text` is also the automatic fallback when `structured` yields no usable JSON. */
export type OcrOutputMode = 'structured' | 'text';

export interface OcrOptions {
  outputMode: OcrOutputMode;
  processingMode: OcrProcessingMode;
  /** Only for `translation`: the language to translate the transcription into. */
  targetLanguage?: string;
  /** Only for `manual`: extra, additive user instructions. */
  customPrompt?: string;
  /** Strip in-text academic citations from the body. */
  removeReferences: boolean;
  /** The image is a single pre-cropped column (disables multi-column detection).
   *  Set internally when `splitColumns` crops a page into columns. */
  singleColumn?: boolean;
  /** Detect multi-column pages, crop each column and OCR them separately, then merge. */
  splitColumns?: boolean;
  /** Only process these 1-based pages, e.g. "1-3,5" (PDF only; empty = all pages). */
  pageRange?: string;
  /** Cap the longest edge of each rendered page image (px). Lower it for small local
   *  models so a page image fits their context window. Undefined = the rasterizer default. */
  rasterMaxEdge?: number;
}

export const DEFAULT_OCR_OPTIONS: OcrOptions = {
  outputMode: 'structured',
  processingMode: 'ocr',
  removeReferences: true,
  singleColumn: false,
  splitColumns: false,
};

/** Renderer -> main request to start OCR for one or more source files. */
export interface AiOcrCreateRequest {
  sourcePaths: string[];
  options?: Partial<OcrOptions>;
  model?: ModelRef | null;
}

/** Formats a transcript can be exported to. */
export type AiOcrExportFormat = 'txt' | 'md' | 'html' | 'epub' | 'pdf';

/** Result of a save-to-disk export (a native save dialog can be cancelled). */
export interface AiOcrExportResult {
  canceled: boolean;
  path?: string;
}

// ── Coercion / guards ────────────────────────────────────────────────────────

function coerceLabel(v: unknown): OcrBlockLabel {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (OCR_BLOCK_LABELS as readonly string[]).includes(s) ? (s as OcrBlockLabel) : 'MAIN_TEXT';
}

function coerceBox(v: unknown): OcrBox | undefined {
  if (!Array.isArray(v) || v.length < 4) return undefined;
  const nums = v.slice(0, 4).map((n) => Number(n));
  return nums.every((n) => Number.isFinite(n)) ? (nums as OcrBox) : undefined;
}

/** Lenient shape check: an object with a `blocks` array. Used as the `completeJson`
 *  guard — normalization does the real work, so we accept anything object-shaped. */
export function isOcrPageShape(v: unknown): v is { blankPage?: unknown; blocks?: unknown } {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Coerce an arbitrary model response into a valid OcrPageResult. Never throws:
 *  drops malformed blocks, defaults labels, keeps only finite boxes. */
export function normalizeOcrPageResult(v: unknown): OcrPageResult {
  const obj = isOcrPageShape(v) ? v : {};
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks: OcrBlock[] = [];
  for (const b of rawBlocks) {
    if (!b || typeof b !== 'object') continue;
    const rec = b as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text : '';
    if (!text.trim()) continue;
    blocks.push({ text, label: coerceLabel(rec.label), box_2d: coerceBox(rec.box_2d) });
  }
  const blankPage = obj.blankPage === true || (blocks.length === 0 && obj.blankPage !== false);
  return { blankPage, blocks };
}

/** True when a page result carries any non-empty text. */
export function pageHasText(page: OcrPageResult): boolean {
  return page.blocks.some((b) => b.text.trim().length > 0);
}

// ── Persistence shapes (the working library under userData/ai-ocr) ────────────

export type OcrDocStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
export type OcrPageStatus = 'pending' | 'processing' | 'done' | 'error';

export interface OcrPageState {
  /** 0-based page index. */
  index: number;
  status: OcrPageStatus;
  /** Relative filename of the rendered page image, e.g. `page_0001.jpg`. */
  imageFile: string;
  mediaType: string;
  width?: number;
  height?: number;
  /** Original 1-based page number in the source (differs from index+1 when a page
   *  range was applied). Display-only. */
  sourcePage?: number;
  blankPage?: boolean;
  /** Which output mode produced the stored blocks (structured vs text fallback). */
  mode?: OcrOutputMode;
  retryCount?: number;
  lastError?: string | null;
  /** Manual edit of the reconstructed page Markdown (F3); overrides the transcript. */
  editedText?: string | null;
}

export type OcrSourceKind = 'pdf' | 'image';

export interface OcrDoc {
  id: string;
  name: string;
  /** Relative filename of the copied source, e.g. `source.pdf`. */
  sourceFile: string;
  sourceKind: OcrSourceKind;
  status: OcrDocStatus;
  model: ModelRef | null;
  options: OcrOptions;
  pageCount: number;
  pages: OcrPageState[];
  createdAt: number;
  updatedAt: number;
  error?: string | null;
}

/** Lightweight library-list entry (index.json), no per-page detail. */
export interface OcrDocSummary {
  id: string;
  name: string;
  status: OcrDocStatus;
  pageCount: number;
  doneCount: number;
  errorCount: number;
  model: ModelRef | null;
  createdAt: number;
  updatedAt: number;
}

/** Progress snapshot pushed to the renderer as a document processes. */
export interface OcrDocProgress {
  docId: string;
  status: OcrDocStatus;
  pageCount: number;
  doneCount: number;
  errorCount: number;
  currentPage?: number | null;
  error?: string | null;
}

export function summarizeDoc(doc: OcrDoc): OcrDocSummary {
  return {
    id: doc.id,
    name: doc.name,
    status: doc.status,
    pageCount: doc.pageCount,
    doneCount: doc.pages.filter((p) => p.status === 'done').length,
    errorCount: doc.pages.filter((p) => p.status === 'error').length,
    model: doc.model,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function docProgress(doc: OcrDoc, currentPage?: number | null): OcrDocProgress {
  return {
    docId: doc.id,
    status: doc.status,
    pageCount: doc.pageCount,
    doneCount: doc.pages.filter((p) => p.status === 'done').length,
    errorCount: doc.pages.filter((p) => p.status === 'error').length,
    currentPage: currentPage ?? null,
    error: doc.error ?? null,
  };
}
