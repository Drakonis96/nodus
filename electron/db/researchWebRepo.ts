import { createHash } from 'node:crypto';
import type { PassageDetail } from '@shared/types';
import { getDb } from './database';

export interface WebPassageRecord {
  url: string;
  finalUrl: string;
  title: string;
  siteName: string | null;
  domain: string;
  byline: string | null;
  publishedAt: string | null;
  doi: string | null;
  kind: 'html' | 'pdf';
  pageNumber: number | null;
  heading: string | null;
  text: string;
  retrievedAt: string;
}
interface Row { id: string; url: string; final_url: string; title: string; site_name: string | null; domain: string; byline: string | null; published_at: string | null;
  doi: string | null; kind: 'html' | 'pdf'; page_number: number | null; heading: string | null; text: string; retrieved_at: string }

export const WEB_PASSAGE_PREFIX = 'web:';

/** Content-addressed: the same bytes read from the same address are one receipt,
 * and a receipt can never be edited into saying something else. */
export function webPassageId(record: Pick<WebPassageRecord, 'finalUrl' | 'text' | 'pageNumber'>): string {
  return `${WEB_PASSAGE_PREFIX}${createHash('sha256').update(JSON.stringify([record.finalUrl, record.pageNumber, record.text])).digest('hex')}`;
}

export function recordWebPassage(record: WebPassageRecord): string {
  const id = webPassageId(record);
  getDb().prepare(`INSERT OR IGNORE INTO research_web_passages (id,url,final_url,title,site_name,domain,byline,published_at,doi,kind,page_number,heading,text,retrieved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id.slice(WEB_PASSAGE_PREFIX.length), record.url, record.finalUrl, record.title.slice(0, 400), record.siteName?.slice(0, 200) ?? null,
    record.domain, record.byline?.slice(0, 300) ?? null, record.publishedAt?.slice(0, 40) ?? null, record.doi?.slice(0, 200) ?? null, record.kind, record.pageNumber,
    record.heading?.slice(0, 200) ?? null, record.text, record.retrievedAt);
  return id;
}

export function getWebPassage(id: string): (WebPassageRecord & { id: string }) | null {
  const match = /^web:([a-f0-9]{64})$/.exec(id);
  if (!match) return null;
  let row: Row | undefined;
  try { row = getDb().prepare('SELECT * FROM research_web_passages WHERE id=?').get(match[1]) as Row | undefined; }
  catch { return null; }
  if (!row) return null;
  const record: WebPassageRecord = { url: row.url, finalUrl: row.final_url, title: row.title, siteName: row.site_name, domain: row.domain, byline: row.byline,
    publishedAt: row.published_at, doi: row.doi, kind: row.kind, pageNumber: row.page_number, heading: row.heading, text: row.text, retrievedAt: row.retrieved_at };
  // A row whose bytes no longer hash to its id is not the passage that was cited.
  return webPassageId(record) === id ? { ...record, id } : null;
}

const year = (value: string | null) => { const match = /\b(1[5-9]\d\d|20\d\d)\b/.exec(value ?? ''); return match ? Number(match[1]) : null; };

/** The shared passage shape, so web evidence opens where every passage opens. */
export function getWebPassageDetail(id: string): PassageDetail | null {
  const record = getWebPassage(id);
  if (!record) return null;
  return { passage_id: id, nodus_id: `web:${record.domain}`, text: record.text, page_label: record.pageNumber ? String(record.pageNumber) : null,
    source_ref: record.finalUrl, page_number: record.pageNumber, chunk_index: 0, provenance: 'web',
    web: { url: record.url, finalUrl: record.finalUrl, siteName: record.siteName, domain: record.domain, retrievedAt: record.retrievedAt, publishedAt: record.publishedAt, doi: record.doi, kind: record.kind },
    work: { title: record.title, authors: record.byline ? [record.byline] : [], year: year(record.publishedAt), zotero_key: '' } };
}
