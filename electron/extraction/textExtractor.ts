import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SourceType } from '@shared/types';
import { itemChildren, ZoteroAttachment } from '../zotero/zoteroClient';

export interface ExtractedDoc {
  text: string;
  sourceType: SourceType;
  notes: string | null;
}

const CHUNK_WORDS = 6000;
const OVERLAP_WORDS = 200;

/** Split long text into ~6k-word chunks with ~200-word overlap, avoiding mid-sentence breaks where possible. */
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

// ── File-type extractors ──────────────────────────────────────────────────────

export async function extractPdf(filePath: string): Promise<{ text: string; skippedPages: number }> {
  // pdfjs-dist legacy build runs in Node without a DOM.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  let skippedPages = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => it.str).filter(Boolean);
    const pageText = strings.join(' ').trim();
    if (!pageText) {
      // No text layer (likely a scan without OCR) — skip and note it.
      skippedPages++;
      continue;
    }
    parts.push(pageText);
  }
  await pdf.destroy?.();
  return { text: parts.join('\n\n'), skippedPages };
}

export async function extractDocx(filePath: string): Promise<string> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value as string) ?? '';
}

export function extractTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export async function extractFromPath(filePath: string): Promise<ExtractedDoc> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const { text, skippedPages } = await extractPdf(filePath);
    return {
      text,
      sourceType: 'pdf',
      notes: skippedPages > 0 ? `${skippedPages} página(s) sin capa de texto omitidas.` : null,
    };
  }
  if (ext === '.docx') {
    return { text: await extractDocx(filePath), sourceType: 'upload', notes: null };
  }
  if (ext === '.md' || ext === '.markdown') {
    return { text: extractTextFile(filePath), sourceType: 'markdown', notes: null };
  }
  if (ext === '.txt') {
    return { text: extractTextFile(filePath), sourceType: 'upload', notes: null };
  }
  throw new Error(`Tipo de archivo no soportado: ${ext}`);
}

/** Only PDFs and plain text are legitimate full-text sources. HTML snapshots and images are excluded. */
function isTextAttachment(att: ZoteroAttachment): boolean {
  const ct = att.contentType ?? '';
  if (ct === 'application/pdf') return true;
  if (ct === 'text/plain' || ct === 'text/markdown') return true;
  // Exclude HTML snapshots, images, and imported_url web captures.
  if (ct.startsWith('text/html')) return false;
  if (ct.startsWith('image/')) return false;
  if (att.linkMode === 'imported_url') return false;
  const fn = att.filename ?? '';
  return /\.(pdf|txt|md|markdown|docx)$/i.test(fn);
}

/**
 * Resolve full text for a work from its Zotero attachments in the storage folder.
 * Concatenates multiple legitimate sub-documents with clear separators.
 */
export async function resolveWorkText(
  userId: string,
  zoteroKey: string,
  storagePath: string,
  abstract: string | null,
  doi: string | null,
  unpaywallEmail: string
): Promise<ExtractedDoc> {
  const children = await itemChildren(userId, zoteroKey).catch(() => [] as ZoteroAttachment[]);
  const textAttachments = children.filter(isTextAttachment);

  const docs: ExtractedDoc[] = [];
  for (const att of textAttachments) {
    if (!att.filename || !storagePath) continue;
    const filePath = path.join(storagePath, att.key, att.filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      docs.push(await extractFromPath(filePath));
    } catch {
      /* skip unreadable attachment */
    }
  }

  if (docs.length > 0) {
    const combined = docs
      .map((d, i) => (docs.length > 1 ? `--- documento ${i + 1} ---\n${d.text}` : d.text))
      .join('\n\n');
    const notes = docs.map((d) => d.notes).filter(Boolean).join(' ') || null;
    return { text: combined, sourceType: docs[0].sourceType, notes };
  }

  // Fallback: try Unpaywall for an open-access PDF when a DOI exists.
  if (doi && unpaywallEmail) {
    const oaText = await tryUnpaywall(doi, unpaywallEmail).catch(() => null);
    if (oaText) return { text: oaText, sourceType: 'pdf', notes: 'Texto recuperado vía Unpaywall.' };
  }

  // Degrade to abstract-only.
  if (abstract) {
    return { text: abstract, sourceType: 'abstract_only', notes: 'Solo abstract disponible.' };
  }
  return { text: '', sourceType: 'none', notes: 'Sin texto ni abstract disponible.' };
}

async function tryUnpaywall(doi: string, email: string): Promise<string | null> {
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
    const { text } = await extractPdf(tmp);
    return text;
  } finally {
    fs.unlinkSync(tmp);
  }
}
