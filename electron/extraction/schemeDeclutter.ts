import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from '../db/database';
import { bodySizeOf, typeSizeWeights, SCHEME_LAYOUT_CLASSIFIER, type LayoutItem } from './schemeLayout';

/**
 * Opt-in scheme decluttering at extraction: PDFs listed in <userData>/scheme-declutter.json
 * ({ "files": ["/abs/path.pdf", …] }) are extracted with each run of reaction-scheme, figure
 * and table lines as one "[scheme]" and without margin lines (running heads, tabs). Only
 * listed files: changing a book's text makes its analysis out of date. A file is listed when
 * its work is first extracted and nothing has used its text yet (`declutterNewDocuments`), or
 * by hand, before a book is rescanned in full.
 */

export const DECLUTTER_LIST = 'scheme-declutter.json';
const SAMPLE_PAGES = 40;

let cache: { mtimeMs: number; files: Set<string> } | null = null;

export function declutterListPath(): string {
  return path.join(app.getPath('userData'), DECLUTTER_LIST);
}

export function declutterEnabledFor(filePath: string): boolean {
  const listPath = declutterListPath();
  let mtimeMs: number;
  try { mtimeMs = fs.statSync(listPath).mtimeMs; } catch { return false; }
  if (cache?.mtimeMs !== mtimeMs) {
    try {
      const parsed = JSON.parse(fs.readFileSync(listPath, 'utf8')) as { files?: unknown };
      cache = { mtimeMs, files: new Set(Array.isArray(parsed.files) ? parsed.files.filter((entry): entry is string => typeof entry === 'string').map((entry) => path.resolve(entry)) : []) };
    } catch (error) {
      console.warn('[scheme-declutter] unreadable list:', error instanceof Error ? error.message : String(error));
      cache = { mtimeMs, files: new Set() };
    }
  }
  return cache.files.has(path.resolve(filePath));
}

/** Adds a file to the list, so every later extraction of it is decluttered too. */
export function addToDeclutterList(filePath: string): void {
  const listPath = declutterListPath();
  let files: string[] = [];
  try { files = (JSON.parse(fs.readFileSync(listPath, 'utf8')) as { files?: string[] }).files ?? []; } catch { /* a new list */ }
  const resolved = path.resolve(filePath);
  if (files.includes(resolved)) return;
  const tmp = `${listPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ files: [...files, resolved] }, null, 2));
  fs.renameSync(tmp, listPath);
  cache = null;
}

/** Whether nothing yet depends on a work's full text: it was never resolved and never deep
 *  analysed (a light scan reads only the title and abstract). Decluttering it changes nothing
 *  that exists. Unknown works count as used. */
export function workTextUnused(zoteroKey: string): boolean {
  const row = getDb().prepare('SELECT resolved_text_hash, deep_hash FROM works WHERE zotero_key = ?').get(zoteroKey) as { resolved_text_hash: string | null; deep_hash: string | null } | undefined;
  return !!row && !row.resolved_text_hash && !row.deep_hash;
}

/** The extraction cache key for a decluttered file: its own entry, so the plain and the
 *  decluttered text never stand in for each other, and a classifier change re-extracts. */
export function declutterCacheKey(filePath: string): string {
  return `${filePath}#declutter-${SCHEME_LAYOUT_CLASSIFIER}`;
}

/** A book's body type size, from up to 40 evenly spaced pages. */
export async function pdfBodySize(pdf: { numPages: number; getPage(page: number): Promise<any> }): Promise<number> {
  const weights = new Map<number, number>();
  const total = pdf.numPages;
  const samples = Math.min(SAMPLE_PAGES, total);
  for (let k = 0; k < samples; k++) {
    const page = await pdf.getPage(1 + Math.floor(samples > 1 ? k * (total - 1) / (samples - 1) : 0));
    typeSizeWeights(((await page.getTextContent()).items as LayoutItem[]).filter((item) => typeof item?.str === 'string' && Array.isArray(item.transform)), weights);
    page.cleanup?.();
  }
  return bodySizeOf(weights);
}
