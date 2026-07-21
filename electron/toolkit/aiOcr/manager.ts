// Nodus AI OCR — the per-document processing manager. Electron-free: every side effect
// (persistence, rasterization, the model call) is injected, so the whole loop is
// unit-testable with a mock model and a temp-dir store. The wiring layer binds the real
// rasterizer, the engine (bound to aiClient) and a window-emit callback.
//
// Responsibilities: rasterize the source once, OCR pages with bounded concurrency,
// retry retryable failures with exponential backoff, persist per-page state + the
// reconstructed transcript incrementally, support cancellation and per-page/whole-doc
// reprocessing, and resume unfinished documents after a restart.
import fs from 'node:fs';
import path from 'node:path';
import {
  docProgress,
  type OcrDoc,
  type OcrDocProgress,
  type OcrOptions,
  type OcrPageState,
  type OcrSourceKind,
} from '@shared/aiOcrTypes';
import { pageToMarkdown } from '@shared/aiOcrReconstruct';
import type { VisionImagePart } from '@shared/imageAnalysis';
import type { ModelRef } from '@shared/types';
import type { OcrStore } from './store';
import type { RasterizeOptions, RasterizeSignal, RasterPage } from './rasterize';
import type { OcrPageOutcome } from './engine';

type RasterizePdfFn = (
  filePath: string,
  options: RasterizeOptions,
  onPage?: (page: RasterPage, done: number, total: number) => void | Promise<void>,
  signal?: RasterizeSignal,
) => Promise<RasterPage[]>;
type RasterizeImageFn = (filePath: string, options: RasterizeOptions) => Promise<RasterPage>;
type OcrPageFn = (image: VisionImagePart, options: OcrOptions, model: ModelRef | null) => Promise<OcrPageOutcome>;

export interface OcrManagerDeps {
  store: OcrStore;
  rasterizePdf: RasterizePdfFn;
  rasterizeImage: RasterizeImageFn;
  ocrPage: OcrPageFn;
  emit?: (progress: OcrDocProgress) => void;
  /** Max pages OCR'd concurrently. Default 3. */
  concurrency?: number;
  /** Retries per page on retryable failures. Default 2. */
  maxRetries?: number;
  rasterizeOptions?: RasterizeOptions;
  /** Detect and crop columns for the splitColumns option. Injected so the manager stays
   *  canvas-free in tests; the wiring binds it to columns.detectAndCropColumns. */
  splitColumns?: (buffer: Buffer, mediaType: string) => Promise<VisionImagePart[]>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CreateOcrInput {
  id: string;
  name: string;
  sourcePath: string;
  sourceKind: OcrSourceKind;
  model: ModelRef | null;
  options: OcrOptions;
}

export interface OcrManager {
  createDocument(input: CreateOcrInput): Promise<OcrDoc>;
  reprocessPage(id: string, index: number, patch?: { model?: ModelRef | null }): Promise<void>;
  reprocessDocument(id: string, patch?: { model?: ModelRef | null; options?: OcrOptions }): Promise<void>;
  /** Save a manual edit of a page (null reverts to the OCR reconstruction) and
   *  regenerate the transcript. Throws while the document is still processing. */
  editPage(id: string, index: number, text: string | null): Promise<void>;
  cancel(id: string): void;
  isProcessing(id: string): boolean;
  resume(): Promise<void>;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Transient failures worth a retry: rate limits, timeouts, 5xx, transport errors, and
 *  a one-off empty model response. Deterministic errors (bad key, bad request) are not. */
function isRetryable(error: unknown): boolean {
  const m = errMsg(error).toLowerCase();
  return /(rate limit|too many requests|429|quota|resource exhausted|overloaded|timeout|timed out|econnreset|etimedout|enotfound|socket hang up|network|502|503|504|respuesta vac[ií]a)/.test(m);
}

function padStem(index: number): string {
  return `page_${String(index + 1).padStart(4, '0')}`;
}

export function createOcrManager(deps: OcrManagerDeps): OcrManager {
  const { store, rasterizePdf, rasterizeImage, ocrPage } = deps;
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const maxRetries = Math.max(0, deps.maxRetries ?? DEFAULT_MAX_RETRIES);
  const rasterOpts: RasterizeOptions = deps.rasterizeOptions ?? {};
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const emitProgress = (doc: OcrDoc, currentPage: number | null = null): void => {
    deps.emit?.(docProgress(doc, currentPage));
  };

  /** docId -> cancellation signal while it is actively processing. */
  const active = new Map<string, RasterizeSignal>();

  function backoff(attempt: number): number {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  }

  async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, poolSize: number): Promise<void> {
    let i = 0;
    const runNext = async (): Promise<void> => {
      while (i < items.length) {
        const item = items[i++];
        await worker(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, runNext));
  }

  function regenerateTranscript(doc: OcrDoc): void {
    const parts: string[] = [];
    for (const page of [...doc.pages].sort((a, b) => a.index - b.index)) {
      if (page.status !== 'done') continue;
      if (page.editedText != null) {
        if (page.editedText.trim()) parts.push(page.editedText.trim());
        continue;
      }
      const result = store.readPageResult(doc.id, page.index);
      if (!result) continue;
      const md = pageToMarkdown(result);
      if (md) parts.push(md);
    }
    store.writeTranscript(doc.id, parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim());
  }

  async function rasterize(doc: OcrDoc, signal: RasterizeSignal): Promise<void> {
    const srcPath = store.sourceAbsPath(doc.id, doc.sourceFile);
    // Per-document overrides: a smaller edge for small local models, and a page range.
    const opts: RasterizeOptions = {
      ...rasterOpts,
      maxEdge: doc.options.rasterMaxEdge ?? rasterOpts.maxEdge,
      pageRange: doc.options.pageRange,
    };
    const pages: OcrPageState[] = [];
    const record = (page: RasterPage): void => {
      // Sequential index so a page range still yields contiguous indices (no gaps); the
      // original page number is kept in sourcePage for display.
      const index = pages.length;
      const filename = `${padStem(index)}.jpg`;
      store.writePageImage(doc.id, filename, page.buffer);
      pages.push({
        index,
        status: 'pending',
        imageFile: filename,
        mediaType: page.mediaType,
        width: page.width,
        height: page.height,
        sourcePage: page.pageNumber,
        retryCount: 0,
        lastError: null,
        editedText: null,
      });
    };
    if (doc.sourceKind === 'pdf') {
      await rasterizePdf(srcPath, opts, (page) => record(page), signal);
    } else {
      record(await rasterizeImage(srcPath, opts));
    }
    doc.pages = pages; // already in render order = sequential index
    doc.pageCount = pages.length;
  }

  async function processOnePage(doc: OcrDoc, page: OcrPageState, signal: RasterizeSignal): Promise<void> {
    if (signal.cancelled) return;
    page.status = 'processing';
    page.lastError = null;
    doc.updatedAt = now();
    store.putDoc(doc);
    emitProgress(doc, page.index + 1);

    const bytes = store.readPageImage(doc.id, page.imageFile);
    if (!bytes) {
      page.status = 'error';
      page.lastError = 'No se encontró la imagen de la página.';
      doc.updatedAt = now();
      store.putDoc(doc);
      emitProgress(doc);
      return;
    }
    // One OCR attempt for the page: a single vision call, or — when splitColumns is on and
    // the page really is multi-column — one call per cropped column, merged in reading
    // order. Column detection failing falls back to the whole page.
    const runOcr = async (): Promise<OcrPageOutcome> => {
      let parts: VisionImagePart[] | null = null;
      if (doc.options.splitColumns && deps.splitColumns) {
        try { parts = await deps.splitColumns(bytes, page.mediaType); } catch { parts = null; }
      }
      if (!parts || parts.length <= 1) {
        const image: VisionImagePart = parts?.[0] ?? { base64: bytes.toString('base64'), mediaType: page.mediaType };
        return ocrPage(image, doc.options, doc.model);
      }
      const colOptions = { ...doc.options, singleColumn: true };
      const results: OcrPageOutcome[] = [];
      for (const part of parts) results.push(await ocrPage(part, colOptions, doc.model));
      return {
        result: {
          blankPage: results.every((r) => r.result.blankPage),
          blocks: results.flatMap((r) => r.result.blocks),
        },
        mode: results.some((r) => r.mode === 'structured') ? 'structured' : 'text',
      };
    };

    const maxAttempts = maxRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.cancelled) return;
      try {
        const outcome = await runOcr();
        store.writePageResult(doc.id, page.index, outcome.result);
        page.status = 'done';
        page.blankPage = outcome.result.blankPage;
        page.mode = outcome.mode;
        page.lastError = null;
        page.retryCount = attempt - 1;
        doc.updatedAt = now();
        store.putDoc(doc);
        emitProgress(doc);
        return;
      } catch (error) {
        page.retryCount = attempt - 1;
        if (attempt < maxAttempts && isRetryable(error)) {
          await sleep(backoff(attempt));
          continue;
        }
        page.status = 'error';
        page.lastError = errMsg(error);
        doc.updatedAt = now();
        store.putDoc(doc);
        emitProgress(doc);
        return;
      }
    }
  }

  function finalize(doc: OcrDoc, signal: RasterizeSignal): void {
    if (signal.cancelled) {
      doc.status = 'cancelled';
    } else if (doc.pages.some((p) => p.status === 'error')) {
      doc.status = 'error';
    } else if (doc.pages.length > 0 && doc.pages.every((p) => p.status === 'done')) {
      doc.status = 'done';
    } else {
      doc.status = 'processing';
    }
    doc.updatedAt = now();
    regenerateTranscript(doc);
    store.putDoc(doc);
    emitProgress(doc);
  }

  async function process(id: string): Promise<void> {
    if (active.has(id)) return;
    const signal: RasterizeSignal = { cancelled: false };
    active.set(id, signal);
    try {
      const doc = store.readDoc(id);
      if (!doc) return;
      doc.status = 'processing';
      doc.error = null;
      doc.updatedAt = now();
      store.putDoc(doc);
      emitProgress(doc);

      if (doc.pages.length === 0) {
        await rasterize(doc, signal);
        if (signal.cancelled) {
          doc.status = 'cancelled';
          doc.updatedAt = now();
          store.putDoc(doc);
          emitProgress(doc);
          return;
        }
        store.putDoc(doc);
        emitProgress(doc);
      }

      const pending = doc.pages.filter((p) => p.status === 'pending' || p.status === 'processing');
      // Per-document concurrency (chosen in the UI), falling back to the injected default.
      const poolSize = Math.max(1, doc.options.concurrency ?? concurrency);
      await runPool(pending, (page) => processOnePage(doc, page, signal), poolSize);
      finalize(doc, signal);
    } catch (error) {
      const doc = store.readDoc(id);
      if (doc) {
        doc.status = 'error';
        doc.error = errMsg(error);
        doc.updatedAt = now();
        store.putDoc(doc);
        emitProgress(doc);
      }
    } finally {
      active.delete(id);
    }
  }

  return {
    async createDocument(input: CreateOcrInput): Promise<OcrDoc> {
      const ext = path.extname(input.sourcePath).toLowerCase() || (input.sourceKind === 'pdf' ? '.pdf' : '.img');
      const sourceFile = `source${ext}`;
      const doc: OcrDoc = {
        id: input.id,
        name: input.name,
        sourceFile,
        sourceKind: input.sourceKind,
        status: 'pending',
        model: input.model,
        options: input.options,
        pageCount: 0,
        pages: [],
        createdAt: now(),
        updatedAt: now(),
        error: null,
      };
      store.writeSource(doc.id, sourceFile, fs.readFileSync(input.sourcePath));
      store.putDoc(doc);
      emitProgress(doc);
      void process(doc.id);
      return doc;
    },

    async reprocessPage(id: string, index: number, patch?: { model?: ModelRef | null }): Promise<void> {
      if (active.has(id)) throw new Error('El documento ya se está procesando.');
      const doc = store.readDoc(id);
      if (!doc) throw new Error('Documento OCR no encontrado.');
      const page = doc.pages.find((p) => p.index === index);
      if (!page) throw new Error(`La página ${index + 1} no existe.`);
      if (patch?.model !== undefined) doc.model = patch.model; // reprocess this page with the chosen model
      page.status = 'pending';
      page.lastError = null;
      page.editedText = null;
      doc.updatedAt = now();
      store.putDoc(doc);
      await process(id);
    },

    async reprocessDocument(id: string, patch?: { model?: ModelRef | null; options?: OcrOptions }): Promise<void> {
      if (active.has(id)) throw new Error('El documento ya se está procesando.');
      const doc = store.readDoc(id);
      if (!doc) throw new Error('Documento OCR no encontrado.');
      if (patch?.model !== undefined) doc.model = patch.model;
      if (patch?.options) doc.options = patch.options;
      for (const page of doc.pages) {
        page.status = 'pending';
        page.lastError = null;
        page.editedText = null;
      }
      doc.updatedAt = now();
      store.putDoc(doc);
      await process(id);
    },

    async editPage(id: string, index: number, text: string | null): Promise<void> {
      if (active.has(id)) throw new Error('El documento se está procesando; espera a que termine para editar.');
      const doc = store.readDoc(id);
      if (!doc) throw new Error('Documento OCR no encontrado.');
      const page = doc.pages.find((p) => p.index === index);
      if (!page) throw new Error(`La página ${index + 1} no existe.`);
      page.editedText = text; // null reverts to the reconstructed OCR text
      doc.updatedAt = now();
      store.putDoc(doc);
      regenerateTranscript(doc);
    },

    cancel(id: string): void {
      const signal = active.get(id);
      if (signal) signal.cancelled = true;
    },

    isProcessing(id: string): boolean {
      return active.has(id);
    },

    async resume(): Promise<void> {
      const summaries = store.rebuildIndex();
      for (const summary of summaries) {
        if (summary.status !== 'processing' && summary.status !== 'pending') continue;
        const doc = store.readDoc(summary.id);
        if (!doc) continue;
        // Reset any page left mid-flight by the crash so it is retried.
        let changed = false;
        for (const page of doc.pages) {
          if (page.status === 'processing') {
            page.status = 'pending';
            changed = true;
          }
        }
        if (changed) store.putDoc(doc);
        void process(doc.id);
      }
    },
  };
}
