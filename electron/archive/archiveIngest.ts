// Ingest a file into the evidence archive: read its bytes, extract searchable text
// with the shared extractor (CSV/XLSX/image-OCR/PDF/…), and store both. De-dupes on
// a content hash so re-importing the same file is a no-op.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractFromPath, type OcrOptions } from '../extraction/textExtractor';
import { createItem, findItemByHash, getItem, replaceItemFile } from '../db/archiveRepo';
import { analyzeImageBytes } from '../ai/imageAnalysis';
import { isVisionMime } from '@shared/imageAnalysis';
import type { ArchiveItem, ArchiveItemKind, ModelRef } from '@shared/types';

function kindForExt(ext: string): ArchiveItemKind {
  const e = ext.toLowerCase();
  if (e === '.csv') return 'csv';
  if (e === '.xlsx') return 'xlsx';
  if (e === '.pdf') return 'pdf';
  if (/\.(png|jpe?g|tiff?|webp|bmp)$/.test(e)) return 'image';
  if (/\.(txt|md|markdown)$/.test(e)) return 'text';
  return 'other';
}

function mimeForExt(ext: string): string | null {
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
  };
  return map[e] ?? null;
}

export interface IngestOptions {
  folderId?: string | null;
  title?: string;
  tags?: string[];
  ocr?: OcrOptions;
  /** Primary-source document type applied to the ingested item. */
  docType?: string | null;
  /** Vision model for analysing images (description + OCR). Null/undefined skips it. */
  visionModel?: ModelRef | null;
}

export interface IngestResult {
  item: ArchiveItem;
  /** True when the file was already in the archive (matched by content hash). */
  duplicate: boolean;
}

interface ExtractedFile {
  bytes: Buffer;
  hash: string;
  kind: ArchiveItemKind;
  mime: string | null;
  extractedText: string | null;
  description: string | null;
}

/** Read a file, extract its searchable text (and, for images, a vision description). */
async function readAndExtract(filePath: string, opts: IngestOptions): Promise<ExtractedFile> {
  const bytes = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  let extractedText = '';
  try {
    const doc = await extractFromPath(filePath, opts.ocr ? { ocr: opts.ocr } : {});
    extractedText = doc.text;
  } catch {
    // Unsupported or unreadable format — keep the file, just without extracted text.
  }

  const ext = path.extname(filePath);
  const kind = kindForExt(ext);
  const mime = mimeForExt(ext);

  // For images, a vision model yields a searchable visual description + a literal OCR
  // (better than tesseract for many records). Best-effort: failures keep whatever the
  // extractor produced.
  let description: string | null = null;
  if (kind === 'image' && opts.visionModel && isVisionMime(mime)) {
    const analysis = await analyzeImageBytes(bytes, mime!, opts.visionModel).catch(() => null);
    if (analysis) {
      description = analysis.description || null;
      if (analysis.text.trim()) extractedText = analysis.text;
    }
  }

  return { bytes, hash, kind, mime, extractedText: extractedText.trim() ? extractedText : null, description };
}

/** Ingest a single file into the archive, extracting searchable text where possible. */
export async function ingestArchiveFile(filePath: string, opts: IngestOptions = {}): Promise<IngestResult> {
  const bytes = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  const existingId = findItemByHash(hash);
  if (existingId) {
    const existing = getItem(existingId);
    if (existing) return { item: existing, duplicate: true };
  }

  const extracted = await readAndExtract(filePath, opts);
  const item = createItem({
    folderId: opts.folderId ?? null,
    title: opts.title?.trim() || path.basename(filePath),
    kind: extracted.kind,
    fileName: path.basename(filePath),
    mimeType: extracted.mime,
    bytes: extracted.bytes.length,
    blob: extracted.bytes,
    extractedText: extracted.extractedText,
    description: extracted.description,
    contentHash: extracted.hash,
    docType: opts.docType ?? null,
    tags: opts.tags,
  });
  return { item, duplicate: false };
}

/**
 * Replace the file attached to an existing item: new bytes, format and freshly
 * extracted text, keeping the item's title, classification, tags and person links.
 */
export async function replaceArchiveFile(itemId: string, filePath: string, opts: IngestOptions = {}): Promise<ArchiveItem | null> {
  const extracted = await readAndExtract(filePath, opts);
  return replaceItemFile(itemId, {
    fileName: path.basename(filePath),
    mimeType: extracted.mime,
    bytes: extracted.bytes.length,
    blob: extracted.bytes,
    kind: extracted.kind,
    extractedText: extracted.extractedText,
    description: extracted.description,
    contentHash: extracted.hash,
  });
}
