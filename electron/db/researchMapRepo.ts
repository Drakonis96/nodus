import { v4 as uuid } from 'uuid';
import type {
  ModelRef,
  ResearchCoverageSummary,
  ResearchQuestion,
  ResearchQuestionDetail,
  RqCoverageLink,
  RqCoverageStatus,
  RqLinkKind,
  RqStatus,
  RqSubQuestion,
  RqSubQuestionInput,
} from '@shared/types';
import { getDb } from './database';

interface RqRow {
  id: string;
  question: string;
  notes: string | null;
  model_json: string | null;
  status: RqStatus;
  corpus_ideas: number;
  corpus_works: number;
  created_at: string;
  updated_at: string;
  mapped_at: string | null;
}

interface SubQRow {
  id: string;
  rq_id: string;
  text: string;
  rationale: string | null;
  order_idx: number;
  coverage_status: RqCoverageStatus | null;
  justification: string | null;
}

interface LinkRow {
  id: string;
  subq_id: string;
  kind: RqLinkKind;
  ref_id: string;
  label: string | null;
  score: number | null;
  read_state: 'read' | 'unread' | null;
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ModelRef;
  } catch {
    return null;
  }
}

function toResearchQuestion(row: RqRow): ResearchQuestion {
  return {
    id: row.id,
    question: row.question,
    notes: row.notes,
    model: parseModel(row.model_json),
    status: row.status,
    corpusIdeas: row.corpus_ideas,
    corpusWorks: row.corpus_works,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mappedAt: row.mapped_at,
  };
}

function toLink(row: LinkRow): RqCoverageLink {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.ref_id,
    label: row.label ?? row.ref_id,
    score: row.score,
    readState: row.read_state,
  };
}

function countTable(table: 'ideas' | 'works'): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

export function createResearchQuestion(question: string, notes?: string): ResearchQuestionDetail {
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuid();
  db.prepare(
    `INSERT INTO research_questions (id, question, notes, model_json, status, corpus_ideas, corpus_works, created_at, updated_at, mapped_at)
     VALUES (?, ?, ?, NULL, 'draft', 0, 0, ?, ?, NULL)`
  ).run(id, question.trim(), notes?.trim() || null, now, now);
  return getResearchQuestionDetail(id)!;
}

export function listResearchQuestions(): ResearchQuestion[] {
  const rows = getDb()
    .prepare('SELECT * FROM research_questions ORDER BY updated_at DESC, created_at DESC')
    .all() as RqRow[];
  return rows.map(toResearchQuestion);
}

export function getResearchQuestion(id: string): ResearchQuestion | null {
  const row = getDb().prepare('SELECT * FROM research_questions WHERE id = ?').get(id) as RqRow | undefined;
  return row ? toResearchQuestion(row) : null;
}

export function getSubQuestionRows(rqId: string): SubQRow[] {
  return getDb()
    .prepare('SELECT * FROM research_subquestions WHERE rq_id = ? ORDER BY order_idx ASC')
    .all(rqId) as SubQRow[];
}

export function getResearchQuestionDetail(id: string): ResearchQuestionDetail | null {
  const rq = getResearchQuestion(id);
  if (!rq) return null;
  const subRows = getSubQuestionRows(id);
  const subQuestions: RqSubQuestion[] = subRows.map((row) => {
    const links = getDb()
      .prepare('SELECT * FROM research_coverage_links WHERE subq_id = ? ORDER BY score DESC')
      .all(row.id) as LinkRow[];
    return {
      id: row.id,
      text: row.text,
      rationale: row.rationale,
      orderIdx: row.order_idx,
      coverageStatus: row.coverage_status,
      justification: row.justification,
      links: links.map(toLink),
    };
  });

  const summary: ResearchCoverageSummary = { covered: 0, partial: 0, uncovered: 0, disputed: 0, unmapped: 0 };
  for (const sq of subQuestions) {
    if (sq.coverageStatus === 'covered') summary.covered += 1;
    else if (sq.coverageStatus === 'partial') summary.partial += 1;
    else if (sq.coverageStatus === 'uncovered') summary.uncovered += 1;
    else if (sq.coverageStatus === 'disputed') summary.disputed += 1;
    else summary.unmapped += 1;
  }

  const stale =
    rq.status === 'mapped' && (countTable('ideas') > rq.corpusIdeas || countTable('works') > rq.corpusWorks);

  return { rq, subQuestions, stale, summary };
}

function touch(rqId: string): void {
  getDb().prepare('UPDATE research_questions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), rqId);
}

export function updateRqModel(rqId: string, model: ModelRef | null): void {
  getDb()
    .prepare('UPDATE research_questions SET model_json = ?, updated_at = ? WHERE id = ?')
    .run(model ? JSON.stringify(model) : null, new Date().toISOString(), rqId);
}

export function setRqStatus(rqId: string, status: RqStatus): void {
  getDb().prepare('UPDATE research_questions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), rqId);
}

export function setRqMapped(rqId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE research_questions SET status = 'mapped', mapped_at = ?, updated_at = ?, corpus_ideas = ?, corpus_works = ? WHERE id = ?`
    )
    .run(now, now, countTable('ideas'), countTable('works'), rqId);
}

/**
 * Replace the sub-questions for a question. Coverage is preserved for sub-questions
 * whose id and text are unchanged; new or edited ones start unmapped.
 */
export function replaceSubQuestions(rqId: string, inputs: RqSubQuestionInput[]): void {
  const db = getDb();
  const existing = getSubQuestionRows(rqId);
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const now = new Date().toISOString();

  const keptIds = new Set<string>();
  const tx = db.transaction(() => {
    inputs.forEach((input, index) => {
      const text = input.text.trim();
      if (!text) return;
      const prior = input.id ? existingById.get(input.id) : undefined;
      if (prior && prior.text === text) {
        // Unchanged: keep coverage, refresh rationale/order.
        keptIds.add(prior.id);
        db.prepare('UPDATE research_subquestions SET rationale = ?, order_idx = ? WHERE id = ?').run(
          input.rationale?.trim() || null,
          index,
          prior.id
        );
      } else {
        const id = uuid();
        keptIds.add(id);
        db.prepare(
          `INSERT INTO research_subquestions (id, rq_id, text, rationale, order_idx, coverage_status, justification, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
        ).run(id, rqId, text, input.rationale?.trim() || null, index, now);
      }
    });
    // Drop any prior sub-questions not kept (cascades to their links).
    for (const row of existing) {
      if (!keptIds.has(row.id)) {
        db.prepare('DELETE FROM research_subquestions WHERE id = ?').run(row.id);
      }
    }
  });
  tx();
  touch(rqId);
}

export function setSubQuestionCoverage(
  subqId: string,
  status: RqCoverageStatus,
  justification: string,
  links: Omit<RqCoverageLink, 'id'>[]
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE research_subquestions SET coverage_status = ?, justification = ? WHERE id = ?').run(
      status,
      justification,
      subqId
    );
    db.prepare('DELETE FROM research_coverage_links WHERE subq_id = ?').run(subqId);
    const insert = db.prepare(
      `INSERT INTO research_coverage_links (id, subq_id, kind, ref_id, label, score, read_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const link of links) {
      insert.run(uuid(), subqId, link.kind, link.refId, link.label, link.score, link.readState, now);
    }
  });
  tx();
}

export function deleteResearchQuestion(id: string): boolean {
  return getDb().prepare('DELETE FROM research_questions WHERE id = ?').run(id).changes > 0;
}
