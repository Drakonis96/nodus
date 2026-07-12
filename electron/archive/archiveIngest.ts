// Ingest a file into the evidence archive: read its bytes, extract searchable text
// with the shared extractor (CSV/XLSX/image-OCR/PDF/…), and store both. De-dupes on
// a content hash so re-importing the same file is a no-op.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractFromPath, type OcrOptions } from '../extraction/textExtractor';
import { createItem, findItemByHash, getItem } from '../db/archiveRepo';
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
  /** Vision model for analysing images (description + OCR). Null/undefined skips it. */
  visionModel?: ModelRef | null;
}

export interface IngestResult {
  item: ArchiveItem;
  /** True when the file was already in the archive (matched by content hash). */
  duplicate: boolean;
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

  const item = createItem({
    folderId: opts.folderId ?? null,
    title: opts.title?.trim() || path.basename(filePath),
    kind,
    fileName: path.basename(filePath),
    mimeType: mime,
    bytes: bytes.length,
    blob: bytes,
    extractedText: extractedText.trim() ? extractedText : null,
    description,
    contentHash: hash,
    tags: opts.tags,
  });
  return { item, duplicate: false };
}
