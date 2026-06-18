import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type { EdgeBasis, EdgeType, Evidence, Gap, GapAggregate, GapDetail, GapKind, Idea } from '@shared/types';

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

export function getGapDetail(gapId: string): GapDetail | null {
  const row = getDb()
    .prepare(
      `SELECT
         g.id, g.nodus_id, g.related_idea, g.kind, g.statement, g.confidence, g.evidence_id,
         w.title AS work_title, w.zotero_key AS work_zotero_key, w.authors_json AS work_authors_json,
         w.year AS work_year, w.item_type AS work_item_type,
         i.global_id AS idea_global_id, i.type AS idea_type, i.label AS idea_label, i.statement AS idea_statement,
         e.id AS evidence_row_id, e.global_id AS evidence_global_id, e.nodus_id AS evidence_nodus_id,
         e.quote AS evidence_quote, e.location AS evidence_location, e.kind AS evidence_kind
       FROM gaps g
       JOIN works w ON w.nodus_id = g.nodus_id
       LEFT JOIN ideas i ON i.global_id = g.related_idea
       LEFT JOIN evidence e ON e.id = g.evidence_id
       WHERE g.id = ?`
    )
    .get(gapId) as
    | {
        id: string;
        nodus_id: string;
        related_idea: string | null;
        kind: GapKind;
        statement: string;
        confidence: number;
        evidence_id: string | null;
        work_title: string;
        work_zotero_key: string;
        work_authors_json: string;
        work_year: number | null;
        work_item_type: string;
        idea_global_id: string | null;
        idea_type: Idea['type'] | null;
        idea_label: string | null;
        idea_statement: string | null;
        evidence_row_id: string | null;
        evidence_global_id: string | null;
        evidence_nodus_id: string | null;
        evidence_quote: string | null;
        evidence_location: string | null;
        evidence_kind: Evidence['kind'] | null;
      }
    | undefined;

  if (!row) return null;
  const gap: Gap = {
    id: row.id,
    nodus_id: row.nodus_id,
    related_idea: row.related_idea,
    kind: row.kind,
    statement: row.statement,
    confidence: row.confidence,
    evidence_id: row.evidence_id,
  };

  return {
    gap,
    work: {
      nodus_id: row.nodus_id,
      title: row.work_title,
      zotero_key: row.work_zotero_key,
      authors: parseAuthors(row.work_authors_json),
      year: row.work_year,
      item_type: row.work_item_type,
    },
    relatedIdea:
      row.idea_global_id && row.idea_type && row.idea_label && row.idea_statement
        ? {
            global_id: row.idea_global_id,
            type: row.idea_type,
            label: row.idea_label,
            statement: row.idea_statement,
          }
        : null,
    evidence:
      row.evidence_row_id && row.evidence_global_id && row.evidence_nodus_id && row.evidence_quote && row.evidence_kind
        ? {
            id: row.evidence_row_id,
            global_id: row.evidence_global_id,
            nodus_id: row.evidence_nodus_id,
            quote: row.evidence_quote,
            location: row.evidence_location,
            kind: row.evidence_kind,
          }
        : null,
  };
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

function parseAuthors(authorsJson: string): string[] {
  try {
    const parsed = JSON.parse(authorsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}
