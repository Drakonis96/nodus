import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPdfjs, openPdf, pageText } from './pdfjsLoader';

export interface OriginalPageRead { file: string; sha256: string; from: number; to: number; maxBytes: number; languages: string }
export interface OriginalPage { text: string; pageNumber: number; pageLabel: string | null; partial: boolean; ocr: boolean }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function needsOcr(page: any, text: string): Promise<boolean> {
  if (text.trim().length >= 50) return false;
  const pdfjs = await loadPdfjs();
  const operators = await page.getOperatorList();
  return operators.fnArray.some((op: number) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintJpegXObject].includes(op));
}
export interface OriginalInspection { pages: number; needsOcr: boolean; textCharacters: number }
/** Read-only preflight. Scans are identified, never recognized or downloaded. */
export async function inspectOriginalPdf(input: { file: string; sha256?: string }, signal?: AbortSignal): Promise<OriginalInspection> {
  if (fs.statSync(input.file).size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
  const before = hash(fs.readFileSync(input.file));
  if (input.sha256 && before !== input.sha256) throw new Error('research_source_revision_changed');
  const pdf = await openPdf(input.file);
  try {
    let textCharacters = 0, scanned = false;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      const text = await pageText(page);
      textCharacters += text.length;
      scanned = await needsOcr(page, text);
      page.cleanup?.();
      if (scanned) break;
    }
    if (before !== hash(fs.readFileSync(input.file))) throw new Error('research_source_revision_changed');
    return { pages: pdf.numPages, needsOcr: scanned, textCharacters };
  } finally { await pdf.destroy(); }
}
/** Worker-only bounded reading. This does not publish an index or enqueue work. */
export async function readOriginalPages(input: OriginalPageRead, signal?: AbortSignal): Promise<OriginalPage[]> {
  signal?.throwIfAborted();
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 1 || input.to < input.from || input.to - input.from > 3
      || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 64000) throw new Error('research_invalid_page_range');
  if (fs.statSync(input.file).size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
  if (hash(fs.readFileSync(input.file)) !== input.sha256) throw new Error('research_source_revision_changed');
  const pdf = await openPdf(input.file);
  try {
    const labels = await pdf.getPageLabels();
    const result: OriginalPage[] = [];
    let remaining = input.maxBytes;
    for (let number = input.from; number <= Math.min(input.to, pdf.numPages) && remaining > 0; number++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      const text = await pageText(page);
      const scanned = await needsOcr(page, text);
      page.cleanup?.();
      if (scanned) {
        throw new Error('documentary_ocr_deferred');
      }
      const bytes = Buffer.from(text);
      const partial = bytes.length > remaining;
      // A prefix retains complete UTF-8 characters. No invented page label.
      const bounded = partial ? bytes.subarray(0, remaining).toString('utf8').replace(/\uFFFD$/u, '') : text;
      remaining -= Buffer.byteLength(bounded);
      if (bounded.trim()) result.push({ text: bounded, pageNumber: number, pageLabel: labels?.[number - 1] ?? null, partial, ocr: false });
    }
    signal?.throwIfAborted();
    if (hash(fs.readFileSync(input.file)) !== input.sha256) throw new Error('research_source_revision_changed');
    return result;
  } finally { await pdf.destroy(); }
}
