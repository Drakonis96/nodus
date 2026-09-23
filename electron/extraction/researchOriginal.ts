import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openPdf, pageText } from './pdfjsLoader';
import { ocrPdfPages } from './ocr';

export interface OriginalPageRead { file: string; sha256: string; from: number; to: number; maxBytes: number; languages: string }
export interface OriginalPage { text: string; pageNumber: number; pageLabel: string | null; partial: boolean; ocr: boolean }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
      let text = await pageText(page);
      let ocr = false;
      page.cleanup?.();
      if (!text.trim()) {
        text = (await ocrPdfPages(pdf, [number], input.languages, undefined, { localOnly: true, signal })).get(number)?.text ?? '';
        ocr = true;
      }
      const bytes = Buffer.from(text);
      const partial = bytes.length > remaining;
      // A prefix retains complete UTF-8 characters. No invented page label.
      const bounded = partial ? bytes.subarray(0, remaining).toString('utf8').replace(/\uFFFD$/u, '') : text;
      remaining -= Buffer.byteLength(bounded);
      if (bounded.trim()) result.push({ text: bounded, pageNumber: number, pageLabel: labels?.[number - 1] ?? null, partial, ocr });
    }
    signal?.throwIfAborted();
    if (hash(fs.readFileSync(input.file)) !== input.sha256) throw new Error('research_source_revision_changed');
    return result;
  } finally { await pdf.destroy(); }
}
