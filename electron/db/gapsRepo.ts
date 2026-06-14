import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type { GapKind, GapAggregate, EdgeType, EdgeBasis } from '@shared/types';

export function addGap(
  nodusId: string,
  kind: GapKind,
  statement: string,
  relatedIdea: string | null,
  confidence: number,
  evidenceId: string | null
): void {
  getDb()
    .prepare(
      'INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(uuid(), nodusId, relatedIdea, kind, statement, confidence, evidenceId);
}

export function addExternalRef(
  nodusId: string,
  fromIdea: string,
  citedWork: string,
  type: EdgeType,
  basis: EdgeBasis,
  confidence: number,
  evidenceId: string | null
): void {
  getDb()
    .prepare(
      'INSERT INTO external_refs (id, nodus_id, from_idea, cited_work, type, basis, confidence, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(uuid(), nodusId, fromIdea, citedWork, type, basis, confidence, evidenceId);
}

/** Aggregate gaps across the whole corpus, grouped by a normalized statement, sorted by frequency. */
export function aggregateGaps(): GapAggregate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT g.kind, g.statement, g.nodus_id, w.title, w.zotero_key
       FROM gaps g JOIN works w ON w.nodus_id = g.nodus_id`
    )
    .all() as { kind: GapKind; statement: string; nodus_id: string; title: string; zotero_key: string }[];

  const map = new Map<string, GapAggregate>();
  for (const r of rows) {
    const key = `${r.kind}::${normalize(r.statement)}`;
    let agg = map.get(key);
    if (!agg) {
      agg = { kind: r.kind, statement: r.statement, count: 0, works: [] };
      map.set(key, agg);
    }
    agg.count += 1;
    if (!agg.works.some((w) => w.nodus_id === r.nodus_id)) {
      agg.works.push({ nodus_id: r.nodus_id, title: r.title, zotero_key: r.zotero_key });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
