import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SourceType, PdfAnalysis } from '@shared/types';
import { itemChildren, getFulltext, ZoteroAttachment } from '../zotero/zoteroClient';
import { openPdf, pageText } from './pdfjsLoader';
import { analyzePdf } from './pdfAnalyzer';
import { ocrPdfPages } from './ocr';

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
const CHUNK_WORDS = 6000;
const OVERLAP_WORDS = 200;

/** Split long text into ~6k-word chunks with ~200-word overlap. */
export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= CHUNK_WORDS) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - OVERLAP_WORDS;
  }
  return chunks;
}

// ── PDF: streaming extraction with page markers + optional OCR ────────────────

/**
 * Extract a PDF page-by-page (memory-safe for large files). Each page's text is
 * prefixed with a `[[p. N]]` marker so the model can cite accurate locations.
 * Pages without a text layer are OCR-ed when enabled, otherwise skipped + noted.
 */
export async function extractPdfStreaming(
  filePath: string,
  opts: { ocr: OcrOptions; onProgress?: OnExtractProgress; analysis?: PdfAnalysis }
): Promise<ExtractedDoc> {
  const analysis = opts.analysis ?? (await analyzePdf(filePath));

  // Fast exit: a scanned PDF with OCR disabled — don't read hundreds of blank pages.
  if (analysis.strategy === 'scanned' && !opts.ocr.enabled) {
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

  let ocredPages = 0;
  let skippedPages = blanks.length;
  if (opts.ocr.enabled && blanks.length) {
    const toOcr = blanks.slice(0, opts.ocr.maxPages);
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
    } catch (e) {
      // OCR deps missing or failed — keep whatever digital text we have.
      skippedPages = blanks.length;
    }
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
  opts: { ocr?: OcrOptions; onProgress?: OnExtractProgress } = {}
): Promise<ExtractedDoc> {
  const ext = path.extname(filePath).toLowerCase();
  const ocr = opts.ocr ?? { enabled: false, languages: 'spa+eng', maxPages: 300 };
  if (ext === '.pdf') return extractPdfStreaming(filePath, { ocr, onProgress: opts.onProgress });
  if (ext === '.docx') return { text: await extractDocx(filePath), sourceType: 'upload', notes: null };
  if (ext === '.md' || ext === '.markdown') return { text: extractTextFile(filePath), sourceType: 'markdown', notes: null };
  if (ext === '.txt') return { text: extractTextFile(filePath), sourceType: 'upload', notes: null };
  throw new Error(`Tipo de archivo no soportado: ${ext}`);
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
  opts: ResolveOptions
): Promise<ExtractedDoc> {
  const children = await itemChildren(userId, zoteroKey).catch(() => [] as ZoteroAttachment[]);
  const textAttachments = children.filter(isTextAttachment);

  // (1) Reuse Zotero's indexed full text when it's substantial and reasonably complete.
  if (opts.preferZoteroFulltext) {
    for (const att of textAttachments) {
      opts.onProgress?.({ phase: 'fulltext', detail: 'Comprobando índice de Zotero…', pct: null });
      const ft = await getFulltext(userId, att.key).catch(() => null);
      if (ft && ft.content.trim().length > 500) {
        const complete =
          ft.totalPages == null || ft.indexedPages == null || ft.indexedPages >= Math.floor(ft.totalPages * 0.9);
        if (complete) {
          return {
            text: ft.content,
            sourceType: 'pdf',
            notes: `Texto indexado por Zotero${ft.totalPages ? ` (${ft.indexedPages}/${ft.totalPages} págs.)` : ''}.`,
          };
        }
      }
    }
  }

  // (2) Parse the PDF/text file from the storage folder ourselves.
  const docs: ExtractedDoc[] = [];
  for (const att of textAttachments) {
    if (!att.filename || !storagePath) continue;
    const filePath = path.join(storagePath, att.key, att.filename);
    if (!fs.existsSync(filePath)) continue;
    if (/\.pdf$/i.test(att.filename)) {
      opts.onProgress?.({ phase: 'analyze', detail: 'Analizando PDF…', pct: null });
    }
    try {
      docs.push(await extractFromPath(filePath, { ocr: opts.ocr, onProgress: opts.onProgress }));
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
    const oa = await tryUnpaywall(doi, opts.unpaywallEmail, opts.ocr, opts.onProgress).catch(() => null);
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
  onProgress?: OnExtractProgress
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
    const doc = await extractPdfStreaming(tmp, { ocr, onProgress });
    return { ...doc, notes: `Texto recuperado vía Unpaywall.${doc.notes ? ' ' + doc.notes : ''}` };
  } finally {
    fs.unlinkSync(tmp);
  }
}
