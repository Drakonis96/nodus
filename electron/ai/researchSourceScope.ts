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

export function resolveResearchSourceScope(value?: ResearchSourceFilter): ResearchSourceScope | null {
  const filter = normalizeResearchSourceFilter(value);
  if (!filter.enabled) return null;
  const workIds = matchingResearchWorkIds(listResearchContextSources(), filter);
  const db = getDb();
  const bound = JSON.stringify(workIds);
  const ids = (sql: string) => new Set((db.prepare(sql).all(bound) as Array<{ id: string }>).map(row => row.id));
  return {
    workIds: new Set(workIds),
    ideaIds: ids('SELECT DISTINCT global_id id FROM idea_occurrences WHERE nodus_id IN (SELECT value FROM json_each(?))'),
    themeIds: ids(`WITH allowed AS (SELECT value FROM json_each(?))
      SELECT DISTINCT theme_id id FROM work_themes WHERE nodus_id IN (SELECT value FROM allowed)
      UNION SELECT theme_id id FROM idea_theme_links WHERE nodus_id IN (SELECT value FROM allowed)`),
    authorIds: ids('SELECT DISTINCT author_id id FROM work_authors WHERE nodus_id IN (SELECT value FROM json_each(?)) AND role=\'author\''),
    edgeIds: ids('SELECT id FROM edges WHERE source_work IN (SELECT value FROM json_each(?))'),
  };
}
