import { matchingResearchWorkIds, normalizeResearchSourceFilter, type ResearchContextSources, type ResearchSourceFilter } from '@shared/researchContextFilters';
import { getDb } from '../db/database';

export function listResearchContextSources(): ResearchContextSources {
  const db = getDb();
  const rows = db.prepare('SELECT nodus_id, title, authors_json, year FROM works WHERE archived=0 ORDER BY title COLLATE NOCASE').all() as Array<{ nodus_id: string; title: string; authors_json: string; year: number | null }>;
  const links = db.prepare(`SELECT a.author_id, a.name, wa.nodus_id FROM authors a
    JOIN work_authors wa ON wa.author_id=a.author_id AND wa.role='author'
    JOIN works w ON w.nodus_id=wa.nodus_id WHERE w.archived=0 ORDER BY a.name COLLATE NOCASE`).all() as Array<{ author_id: string; name: string; nodus_id: string }>;
  const authors = new Map<string, ResearchContextSources['authors'][number]>();
  for (const row of links) {
    if (!authors.has(row.author_id)) authors.set(row.author_id, { id: row.author_id, name: row.name, workIds: [] });
    authors.get(row.author_id)!.workIds.push(row.nodus_id);
  }
  return { authors: [...authors.values()], works: rows.map(row => {
    let authors: string[] = [];
    try { const parsed = JSON.parse(row.authors_json); if (Array.isArray(parsed)) authors = parsed.filter(item => typeof item === 'string'); } catch { /* Legacy metadata. */ }
    return { id: row.nodus_id, title: row.title, authors, year: row.year };
  }) };
}

export interface ResearchSourceScope {
  workIds: Set<string>;
  ideaIds: Set<string>;
  themeIds: Set<string>;
  authorIds: Set<string>;
  edgeIds: Set<string>;
}

export function resolveResearchSourceScope(value?: ResearchSourceFilter, strictProvenance = false): ResearchSourceScope | null {
  const filter = normalizeResearchSourceFilter(value);
  if (!filter.enabled) return null;
  const workIds = matchingResearchWorkIds(listResearchContextSources(), filter);
  const db = getDb();
  const bound = JSON.stringify(workIds);
  const ids = (sql: string) => new Set((db.prepare(sql).all(bound) as Array<{ id: string }>).map(row => row.id));
  return {
    workIds: new Set(workIds),
    ideaIds: ids(strictProvenance ? `WITH allowed AS (SELECT value FROM json_each(?))
      SELECT DISTINCT io.global_id id FROM idea_occurrences io WHERE io.nodus_id IN (SELECT value FROM allowed)
      AND NOT EXISTS (SELECT 1 FROM idea_occurrences other WHERE other.global_id=io.global_id AND other.nodus_id NOT IN (SELECT value FROM allowed))
      AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.global_id=io.global_id AND e.nodus_id NOT IN (SELECT value FROM allowed))`
      : 'SELECT DISTINCT global_id id FROM idea_occurrences WHERE nodus_id IN (SELECT value FROM json_each(?))'),
    themeIds: ids(`WITH allowed AS (SELECT value FROM json_each(?))
      SELECT DISTINCT theme_id id FROM work_themes WHERE nodus_id IN (SELECT value FROM allowed)
      UNION SELECT theme_id id FROM idea_theme_links WHERE nodus_id IN (SELECT value FROM allowed)`),
    authorIds: ids('SELECT DISTINCT author_id id FROM work_authors WHERE nodus_id IN (SELECT value FROM json_each(?)) AND role=\'author\''),
    edgeIds: ids('SELECT id FROM edges WHERE source_work IN (SELECT value FROM json_each(?))'),
  };
}

/** A mixed-work Idea's synthesized statement is never reusable under a narrower
 * scope. Its explicit quotation may route to an authorized current passage only
 * when the quoted bytes actually occur there. No global label or development text
 * crosses this adapter; nonseparable/paraphrased syntheses remain excluded. */
export function scopedIdeaEvidencePassages(query: string, workIds: string[], limit: number): import('./hierarchicalRetrieval').HierarchicalPassageHit[] {
  if (!workIds.length || limit <= 0) return [];
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 32);
  if (!terms.length) return [];
  const rows = getDb().prepare(`WITH allowed AS (SELECT value FROM json_each(?)), terms AS (SELECT value FROM json_each(?))
    SELECT DISTINCT p.passage_id,p.nodus_id,p.text,p.page_label,p.source_ref,p.page_number,
      w.title,w.authors_json,w.year,w.zotero_key,
      (SELECT COUNT(*) FROM terms WHERE instr(lower(p.text),value)>0) similarity
    FROM evidence e JOIN passages p ON p.nodus_id=e.nodus_id JOIN works w ON w.nodus_id=p.nodus_id
    WHERE e.nodus_id IN (SELECT value FROM allowed) AND w.archived=0 AND e.kind='explicit'
      AND length(trim(e.quote))>=16 AND instr(p.text,e.quote)>0
      AND EXISTS (SELECT 1 FROM terms WHERE instr(lower(e.quote),value)>0)
      AND EXISTS (SELECT 1 FROM idea_occurrences other WHERE other.global_id=e.global_id AND other.nodus_id NOT IN (SELECT value FROM allowed))
      AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))
    ORDER BY similarity DESC,p.passage_id LIMIT ?`).all(JSON.stringify(workIds), JSON.stringify(terms), Math.min(500, limit)) as import('../db/passagesRepo').SimilarPassage[];
  return rows.map(row => ({ ...row, lanes: ['support'] }));
}
