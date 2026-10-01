import { createHash } from 'node:crypto';
import { getDb } from '../db/database';
import { bodySizeOf, typeSizeWeights, SCHEME_LAYOUT_CLASSIFIER, type LayoutItem } from './schemeLayout';

/**
 * A PDF's extraction choice belongs to its work and attachment in the owning vault.
 * Persist both choices in that vault's settings before extraction: a later settings
 * change, a moved file or another work sharing the PDF must not change existing text.
 * Direct file extraction (Toolkit, translation, etc.) stays plain unless requested.
 */

const SAMPLE_PAGES = 40;

export function declutterForWorkSource(zoteroKey: string, sourceRef: string, preferred: boolean): boolean {
  const db = getDb();
  const work = db.prepare('SELECT nodus_id, resolved_text_hash, deep_hash FROM works WHERE zotero_key = ?').get(zoteroKey) as {
    nodus_id: string; resolved_text_hash: string | null; deep_hash: string | null;
  } | undefined;
  if (!work) return false;
  const identity = createHash('sha256').update(JSON.stringify([work.nodus_id, sourceRef])).digest('hex');
  const key = `pdf_declutter:${identity}`;
  const read = () => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const saved = read();
  if (saved !== undefined) return saved === 'declutter';
  const unused = !work.resolved_text_hash && !work.deep_hash;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .run(key, preferred && unused ? 'declutter' : 'plain');
  return read() === 'declutter';
}

/** The extraction cache key for a decluttered file: its own entry, so the plain and the
 *  decluttered text never stand in for each other, and a classifier change re-extracts. */
export function declutterCacheKey(filePath: string): string {
  return `${filePath}#declutter-${SCHEME_LAYOUT_CLASSIFIER}`;
}

/** A book's body type size, from up to 40 evenly spaced pages. */
export async function pdfBodySize(pdf: { numPages: number; getPage(page: number): Promise<any> }, signal?: AbortSignal): Promise<number> {
  const weights = new Map<number, number>();
  const total = pdf.numPages;
  const samples = Math.min(SAMPLE_PAGES, total);
  for (let k = 0; k < samples; k++) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(1 + Math.floor(samples > 1 ? k * (total - 1) / (samples - 1) : 0));
    try {
      const content = await page.getTextContent();
      signal?.throwIfAborted();
      typeSizeWeights((content.items as LayoutItem[]).filter((item) => typeof item?.str === 'string' && Array.isArray(item.transform)), weights);
    } finally {
      page.cleanup?.();
    }
  }
  return bodySizeOf(weights);
}
