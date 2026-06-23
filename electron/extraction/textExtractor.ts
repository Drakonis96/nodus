import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DeepContextMode, SourceType, PdfAnalysis } from '@shared/types';
import { itemChildren, itemAsAttachment, getFulltext, ZoteroAttachment } from '../zotero/zoteroClient';
import { openPdf, pageText } from './pdfjsLoader';
import { analyzePdf } from './pdfAnalyzer';
import { ocrPdfPages } from './ocr';
import { getExtractionCache, upsertExtractionCache } from '../db/extractionCacheRepo';
import { perfLog, startPerf, type PerfContext } from '../perf';

export interface ExtractedDoc {
  text: string;
  sourceType: SourceType;
  notes: string | null;
  analysis?: PdfAnalysis;
}

export interface ExtractProgress {
  phase: 'analyze' | 'fulltext' | 'extract' | 'ocr' | 'download';
  detail: string;
  pct: number | null; // 0..1 when known
}
export type OnExtractProgress = (p: ExtractProgress) => void;

export interface OcrOptions {
  enabled: boolean;
  languages: string;
  maxPages: number;
}

const MIN_CHARS_TEXT_PAGE = 50;
const STANDARD_CHUNK_WORDS = 1800;
const STANDARD_OVERLAP_WORDS = 100;
const LONG_CHUNK_WORDS = 30000;

export interface ChunkOptions {
  mode?: DeepContextMode;
  standardChunkWords?: number;
  longChunkWords?: number;
}

export interface ChunkPlan {
  chunks: string[];
  mode: DeepContextMode;
  wordCount: number;
  chunkWords: number;
  overlapWords: number;
  maxIdeasPerChunk: number;
  maxRelationsPerChunk: number;
  maxGapsPerChunk: number;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function chunkConfig(opts: ChunkOptions = {}): {
  mode: DeepContextMode;
  chunkWords: number;
  overlapWords: number;
  maxIdeasPerChunk: number;
  maxRelationsPerChunk: number;
  maxGapsPerChunk: number;
} {
  const mode = opts.mode === 'long' ? 'long' : 'standard';
  if (mode === 'long') {
    const chunkWords = clampInt(opts.longChunkWords, LONG_CHUNK_WORDS, 5000, 50000);
    const overlapWords = clampInt(Math.round(chunkWords * 0.02), 600, 200, 1000);
    const maxIdeasPerChunk = clampInt(Math.ceil(chunkWords / 4000), 8, 6, 16);
    return {
      mode,
      chunkWords,
      overlapWords,
      maxIdeasPerChunk,
      maxRelationsPerChunk: Math.max(8, Math.round(maxIdeasPerChunk * 1.5)),
      maxGapsPerChunk: Math.min(4, Math.max(2, Math.ceil(maxIdeasPerChunk / 4))),
    };
  }
  const chunkWords = clampInt(opts.standardChunkWords, STANDARD_CHUNK_WORDS, 500, 5000);
  return {
    mode,
    chunkWords,
    overlapWords: STANDARD_OVERLAP_WORDS,
    maxIdeasPerChunk: 4,
    maxRelationsPerChunk: 5,
    maxGapsPerChunk: 2,
  };
}

/** Split long text into bounded chunks with a small overlap for reliable LLM JSON output. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  return planTextChunks(text, opts).chunks;
}

export function planTextChunks(text: string, opts: ChunkOptions = {}): ChunkPlan {
  const config = chunkConfig(opts);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= config.chunkWords) {
    return { ...config, chunks: [text], wordCount: words.length };
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + config.chunkWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - config.overlapWords;
  }
  return { ...config, chunks, wordCount: words.length };
}

// ── PDF: streaming extraction with page markers + optional OCR ────────────────

/**
 * Extract a PDF page-by-page (memory-safe for large files). Each page's text is
 * prefixed with a `[[p. N]]` marker so the model can cite accurate locations.
 * Pages without a text layer are OCR-ed when enabled, otherwise skipped + noted.
 */
export async function extractPdfStreaming(
  filePath: string,
  opts: { ocr: OcrOptions; onProgress?: OnExtractProgress; analysis?: PdfAnalysis; perf?: PerfContext }
): Promise<ExtractedDoc> {
  const analysisDone = opts.analysis ? null : startPerf('PDF analysis', opts.perf, { file: path.basename(filePath) });
  const analysis = opts.analysis ?? (await analyzePdf(filePath));
  analysisDone?.({ strategy: analysis.strategy, pages: analysis.pageCount });

  // Fast exit: a scanned PDF with OCR disabled — don't read hundreds of blank pages.
  if (analysis.strategy === 'scanned' && !opts.ocr.enabled) {
    perfLog('OCR', 0, opts.perf, { status: 'disabled', pages: analysis.pageCount });
    return {
      text: '',
      sourceType: 'pdf',
      analysis,
      notes: `PDF escaneado sin capa de texto (${analysis.pageCount} págs.) y OCR desactivado.`,
    };
  }
  if (analysis.strategy === 'empty') {
    return { text: '', sourceType: 'pdf', analysis, notes: 'PDF sin páginas legibles.' };
  }

  const extractionDone = startPerf('PDF extraction', opts.perf, { file: path.basename(filePath), pages: analysis.pageCount });
  const pdf = await openPdf(filePath);
  const total: number = pdf.numPages;
  const pageTexts = new Map<number, string>();
  const blanks: number[] = [];

  for (let p = 1; p <= total; p++) {
    opts.onProgress?.({ phase: 'extract', detail: `Extrayendo p. ${p}/${total}`, pct: p / total });
    const page = await pdf.getPage(p);
    const txt = await pageText(page);
    page.cleanup?.();
    if (txt.length >= MIN_CHARS_TEXT_PAGE) pageTexts.set(p, txt);
    else blanks.push(p);
  }
  extractionDone({ textPages: pageTexts.size, blankPages: blanks.length });

  let ocredPages = 0;
  let skippedPages = blanks.length;
  if (opts.ocr.enabled && blanks.length) {
    const toOcr = blanks.slice(0, opts.ocr.maxPages);
    const ocrDone = startPerf('OCR', opts.perf, { pages: toOcr.length, languages: opts.ocr.languages });
    try {
      const map = await ocrPdfPages(pdf, toOcr, opts.ocr.languages, ({ page, totalPages }) =>
        opts.onProgress?.({ phase: 'ocr', detail: `OCR p. ${page}/${totalPages}`, pct: page / totalPages })
      );
      for (const [p, t] of map) {
        if (t && t.length >= MIN_CHARS_TEXT_PAGE) {
          pageTexts.set(p, t);
          ocredPages++;
        }
      }
      skippedPages = blanks.length - ocredPages;
      ocrDone({ recoveredPages: ocredPages, skippedPages });
    } catch (e) {
      // OCR deps missing or failed — keep whatever digital text we have.
      skippedPages = blanks.length;
      ocrDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  } else if (blanks.length) {
    perfLog('OCR', 0, opts.perf, { status: opts.ocr.enabled ? 'no_pages' : 'disabled', blankPages: blanks.length });
  }

  await pdf.destroy?.();

  // Assemble in page order with markers.
  const parts: string[] = [];
  for (let p = 1; p <= total; p++) {
    const t = pageTexts.get(p);
    if (t) parts.push(`[[p. ${p}]]\n${t}`);
  }

  const notes: string[] = [];
  if (ocredPages) notes.push(`${ocredPages} página(s) recuperadas por OCR.`);
  if (skippedPages) notes.push(`${skippedPages} página(s) sin texto omitidas.`);

  return {
    text: parts.join('\n\n'),
    sourceType: 'pdf',
    analysis,
    notes: notes.length ? notes.join(' ') : null,
  };
}

export async function extractDocx(filePath: string): Promise<string> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value as string) ?? '';
}

export function extractTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export async function extractFromPath(
  filePath: string,
  opts: { ocr?: OcrOptions; onProgress?: OnExtractProgress; perf?: PerfContext } = {}
): Promise<ExtractedDoc> {
  const ext = path.extname(filePath).toLowerCase();
  const ocr = opts.ocr ?? { enabled: false, languages: 'spa+eng', maxPages: 300 };
  const stat = fs.statSync(filePath);
  const cacheKey = { filePath, fileSize: stat.size, fileMtimeMs: stat.mtimeMs, ocr };
  const cacheLookupDone = startPerf('extraction cache lookup', opts.perf, { file: path.basename(filePath) });
  const cached = getExtractionCache(cacheKey);
  cacheLookupDone({ hit: Boolean(cached), size: stat.size });
  if (cached) return cached;

  let doc: ExtractedDoc;
  if (ext === '.pdf') {
    opts.onProgress?.({ phase: 'analyze', detail: 'Analizando PDF…', pct: null });
    const analysisDone = startPerf('PDF analysis', opts.perf, { file: path.basename(filePath) });
    const analysis = await analyzePdf(filePath);
    analysisDone({ strategy: analysis.strategy, pages: analysis.pageCount });
    doc = await extractPdfStreaming(filePath, { ocr, onProgress: opts.onProgress, analysis, perf: opts.perf });
  } else if (ext === '.docx') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'docx' });
    doc = { text: await extractDocx(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.md' || ext === '.markdown') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'markdown' });
    doc = { text: extractTextFile(filePath), sourceType: 'markdown', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.txt') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'txt' });
    doc = { text: extractTextFile(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else {
    throw new Error(`Tipo de archivo no soportado: ${ext}`);
  }

  upsertExtractionCache(cacheKey, doc);
  perfLog('extraction cache write', 0, opts.perf, { file: path.basename(filePath), chars: doc.text.length });
  return doc;
}

/** Best-effort default Zotero storage folder, used when the user left the path blank. */
export function defaultZoteroStorage(): string {
  const candidates = [
    path.join(os.homedir(), 'Zotero', 'storage'),
    path.join(os.homedir(), 'Documents', 'Zotero', 'storage'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** Only PDFs and plain text are legitimate full-text sources. HTML snapshots and images are excluded. */
function isTextAttachment(att: ZoteroAttachment): boolean {
  const ct = att.contentType ?? '';
  if (ct === 'application/pdf') return true;
  if (ct === 'text/plain' || ct === 'text/markdown') return true;
  if (ct.startsWith('text/html')) return false; // web snapshots
  if (ct.startsWith('image/')) return false;
  if (att.linkMode === 'imported_url') return false;
  const fn = att.filename ?? '';
  return /\.(pdf|txt|md|markdown|docx)$/i.test(fn);
}

export interface ResolveOptions {
  unpaywallEmail: string;
  preferZoteroFulltext: boolean;
  ocr: OcrOptions;
  onProgress?: OnExtractProgress;
  perf?: PerfContext;
}

/**
 * Resolve full text for a work via a detector chain that escalates only as needed:
 *   1) Zotero's own indexed full text (no parsing)
 *   2) Parse the PDF in storage (digital/hybrid → text; scanned → OCR if enabled)
 *   3) Unpaywall open-access PDF (by DOI)
 *   4) Abstract only / none
 */
export async function resolveWorkText(
  userId: string,
  zoteroKey: string,
  storagePath: string,
  abstract: string | null,
  doi: string | null,
  opts: ResolveOptions,
  itemType?: string | null
): Promise<ExtractedDoc> {
  let attachments: ZoteroAttachment[] = [];
  const metadataDone = startPerf('Zotero attachment metadata', opts.perf, { zoteroKey });
  try {
    if ((itemType ?? '').toLowerCase() === 'attachment') {
      // A standalone attachment item IS the file — it has no children, so read it
      // directly. This is what makes markdown/PDF files dropped straight into a
      // collection scannable as full text.
      const self = await itemAsAttachment(userId, zoteroKey);
      if (self) attachments = [self];
    } else {
      attachments = await itemChildren(userId, zoteroKey);
    }
    metadataDone({ attachments: attachments.length });
  } catch (e) {
    metadataDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
  const textAttachments = attachments.filter(isTextAttachment);
  // Fall back to the standard Zotero storage location when the user left it blank,
  // so deep scans can still find local PDFs instead of degrading to abstract-only.
  const effectiveStorage = storagePath || defaultZoteroStorage();

  // (1) Reuse Zotero's indexed full text when it's substantial and reasonably complete.
  if (opts.preferZoteroFulltext) {
    const fulltextDone = startPerf('Zotero fulltext', opts.perf, { attachments: textAttachments.length });
    let checked = 0;
    for (const att of textAttachments) {
      checked++;
      opts.onProgress?.({ phase: 'fulltext', detail: 'Comprobando índice de Zotero…', pct: null });
      const ft = await getFulltext(userId, att.key).catch(() => null);
      if (ft && ft.content.trim().length > 500) {
        const complete =
          ft.totalPages == null || ft.indexedPages == null || ft.indexedPages >= Math.floor(ft.totalPages * 0.9);
        if (complete) {
          fulltextDone({ checked, hit: true, chars: ft.content.length });
          return {
            text: ft.content,
            sourceType: 'pdf',
            notes: `Texto indexado por Zotero${ft.totalPages ? ` (${ft.indexedPages}/${ft.totalPages} págs.)` : ''}.`,
          };
        }
      }
    }
    fulltextDone({ checked, hit: false });
  }

  // (2) Parse the PDF/text file from the storage folder ourselves.
  const docs: ExtractedDoc[] = [];
  for (const att of textAttachments) {
    if (!att.filename || !effectiveStorage) continue;
    const filePath = path.join(effectiveStorage, att.key, att.filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      docs.push(await extractFromPath(filePath, { ocr: opts.ocr, onProgress: opts.onProgress, perf: opts.perf }));
    } catch {
      /* skip unreadable attachment */
    }
  }

  const withText = docs.filter((d) => d.text.trim().length > 0);
  if (withText.length > 0) {
    const combined = withText
      .map((d, i) => (withText.length > 1 ? `--- documento ${i + 1} ---\n${d.text}` : d.text))
      .join('\n\n');
    const notes = withText.map((d) => d.notes).filter(Boolean).join(' ') || null;
    return { text: combined, sourceType: withText[0].sourceType, notes, analysis: withText[0].analysis };
  }

  // (3) Unpaywall fallback by DOI.
  if (doi && opts.unpaywallEmail) {
    opts.onProgress?.({ phase: 'download', detail: 'Buscando texto abierto (Unpaywall)…', pct: null });
    const unpaywallDone = startPerf('Unpaywall', opts.perf, { doi });
    const oa = await tryUnpaywall(doi, opts.unpaywallEmail, opts.ocr, opts.onProgress, opts.perf).catch((e) => {
      unpaywallDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    unpaywallDone({ hit: Boolean(oa), chars: oa?.text.length ?? 0 });
    if (oa && oa.text.trim()) return oa;
  }

  // (4) Degrade to abstract-only / none. Carry forward any scan note (e.g. OCR disabled).
  const scanNote = docs.find((d) => d.notes)?.notes ?? null;
  if (abstract) {
    return { text: abstract, sourceType: 'abstract_only', notes: scanNote ?? 'Solo abstract disponible.' };
  }
  return { text: '', sourceType: 'none', notes: scanNote ?? 'Sin texto ni abstract disponible.' };
}

async function tryUnpaywall(
  doi: string,
  email: string,
  ocr: OcrOptions,
  onProgress?: OnExtractProgress,
  perf?: PerfContext
): Promise<ExtractedDoc | null> {
  const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const url = data?.best_oa_location?.url_for_pdf;
  if (!url) return null;
  const pdfRes = await fetch(url);
  if (!pdfRes.ok) return null;
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `nodus-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    const doc = await extractPdfStreaming(tmp, { ocr, onProgress, perf });
    return { ...doc, notes: `Texto recuperado vía Unpaywall.${doc.notes ? ' ' + doc.notes : ''}` };
  } finally {
    fs.unlinkSync(tmp);
  }
}
