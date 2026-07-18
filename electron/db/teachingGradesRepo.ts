import crypto from 'node:crypto';
import { getDb } from './database';
import { createStudyShortId } from '@shared/studyOrg';
import {
  assessmentProfile,
  type AssessmentItem,
  type AssessmentPlan,
  type GradeEntry,
  type PlanRules,
} from '@shared/assessment';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

/** Stored JSON is user data that may predate a shape change — never trust it. */
function parsePlanRules(value: unknown, profile: string): PlanRules {
  const fallback = assessmentProfile(profile).rules;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return fallback;
    // Merge over the preset so a plan written by an older version still gets any
    // field added since, instead of arriving with it undefined.
    return { ...fallback, ...(parsed as Partial<PlanRules>) };
  } catch {
    return fallback;
  }
}

function toPlan(row: Row): AssessmentPlan {
  const profile = String(row.profile ?? 'libre');
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    subjectId: String(row.subject_id),
    academicYearId: row.academic_year_id ? String(row.academic_year_id) : null,
    profile,
    rules: parsePlanRules(row.rules_json, profile),
    publishedAt: row.published_at ? String(row.published_at) : null,
    version: Number(row.version ?? 1),
    parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
  };
}

function toItem(row: Row): AssessmentItem {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name ?? ''),
    kind: String(row.kind ?? 'activity') as AssessmentItem['kind'],
    position: Number(row.position ?? 0),
    weight: Number(row.weight ?? 1),
    weightAlt: Number(row.weight_alt ?? 1),
    aggregation: String(row.aggregation ?? 'weighted') as AssessmentItem['aggregation'],
    entryMode: String(row.entry_mode ?? 'numeric') as AssessmentItem['entryMode'],
    maxPoints: Number(row.max_points ?? 10),
    minToAverage: row.min_to_average == null ? null : Number(row.min_to_average),
    isMandatory: Number(row.is_mandatory) === 1,
    isRecoverable: Number(row.is_recoverable) === 1,
    target: row.target == null ? null : Number(row.target),
    bestOf: row.best_of == null ? null : Number(row.best_of),
    conditionalMin: row.conditional_min == null ? null : Number(row.conditional_min),
    sourceExamId: row.source_exam_id ? String(row.source_exam_id) : null,
    sourceExamQuestionId: row.source_exam_question_id ? String(row.source_exam_question_id) : null,
    sourceRubricId: row.source_rubric_id ? String(row.source_rubric_id) : null,
    competencyCode: row.competency_code ? String(row.competency_code) : null,
    criterionCode: row.criterion_code ? String(row.criterion_code) : null,
  };
}

function toEntry(row: Row): GradeEntry {
  return {
    studentId: String(row.student_id),
    itemId: String(row.item_id),
    convocatoria: String(row.convocatoria ?? 'ordinaria'),
    rawValue: row.raw_value == null ? null : Number(row.raw_value),
    status: String(row.status ?? 'not_assessed') as GradeEntry['status'],
    isOverride: Number(row.is_override) === 1,
    note: String(row.note ?? ''),
  };
}

// ── Plans ────────────────────────────────────────────────────────────────────

export function listAssessmentPlans(
  options: { subjectId?: string | null; academicYearId?: string | null } = {},
): AssessmentPlan[] {
  const clauses = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  if (options.subjectId) {
    clauses.push('subject_id = ?');
    values.push(options.subjectId);
  }
  // `IS ?` rather than `= ?`: plans predating academic years carry NULL, and
  // `= NULL` is never true in SQL, so `=` would hide them instead of scoping to them.
  if (options.academicYearId !== undefined) {
    clauses.push('academic_year_id IS ?');
    values.push(options.academicYearId);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM teaching_assessment_plans WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`)
    .all(...values) as Row[];
  return rows.map(toPlan);
}

export function getAssessmentPlan(id: string): { plan: AssessmentPlan; items: AssessmentItem[] } {
  const row = getDb()
    .prepare('SELECT * FROM teaching_assessment_plans WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Row | undefined;
  if (!row) throw new Error('Plan de evaluación no encontrado.');
  return { plan: toPlan(row), items: listAssessmentItems(id) };
}

export function listAssessmentItems(planId: string): AssessmentItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM teaching_assessment_items WHERE plan_id = ? ORDER BY position, rowid')
    .all(planId) as Row[];
  return rows.map(toItem);
}

export function createAssessmentPlan(input: {
  name: string;
  subjectId: string;
  academicYearId?: string | null;
  profile?: string;
}): AssessmentPlan {
  const { id, shortId } = ids('plan');
  const stamp = now();
  const profile = input.profile ?? 'libre';
  getDb()
    .prepare(
      `INSERT INTO teaching_assessment_plans
         (id, short_id, name, subject_id, academic_year_id, profile, rules_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id,
      shortId,
      input.name.trim() || 'Plan de evaluación',
      input.subjectId,
      input.academicYearId ?? null,
      profile,
      JSON.stringify(assessmentProfile(profile).rules),
      stamp,
      stamp,
    );
  return getAssessmentPlan(id).plan;
}

/**
 * `rules` is a PARTIAL patch, merged against what is stored.
 *
 * The editor writes one field at a time and several edits can be in flight at once
 * (blurring one input focuses the next). If the client sent the whole rules object,
 * the last write would silently clobber every edit made since it read them — losing
 * work for anyone who tabs through the form quickly. Merging here, against the row,
 * makes concurrent field edits compose instead of race.
 */
export function updateAssessmentPlan(
  id: string,
  patch: { name?: string; academicYearId?: string | null; profile?: string; rules?: Partial<PlanRules> },
): AssessmentPlan {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name.trim() || 'Plan de evaluación');
  }
  if (patch.academicYearId !== undefined) {
    sets.push('academic_year_id = ?');
    values.push(patch.academicYearId);
  }
  if (patch.profile !== undefined) {
    sets.push('profile = ?');
    values.push(patch.profile);
  }
  if (patch.rules !== undefined) {
    const current = getAssessmentPlan(id).plan.rules;
    sets.push('rules_json = ?');
    values.push(JSON.stringify({ ...current, ...patch.rules }));
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(now(), id);
    getDb().prepare(`UPDATE teaching_assessment_plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getAssessmentPlan(id).plan;
}

/**
 * Freezes a plan. From here on it is the document a grade challenge is judged
 * against, so editing it must not rewrite history — see `reviseAssessmentPlan`.
 */
export function publishAssessmentPlan(id: string): AssessmentPlan {
  getDb()
    .prepare('UPDATE teaching_assessment_plans SET published_at = ?, updated_at = ? WHERE id = ?')
    .run(now(), now(), id);
  return getAssessmentPlan(id).plan;
}

/**
 * Copies a published plan into a new, unpublished version.
 *
 * The old version stays exactly as it was, because marks already given were given
 * under its rules and must remain recomputable against them.
 */
export function reviseAssessmentPlan(id: string): AssessmentPlan {
  const db = getDb();
  const { plan, items } = getAssessmentPlan(id);
  const { id: newId, shortId } = ids('plan');
  const stamp = now();
  const idMap = new Map<string, string>();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO teaching_assessment_plans
         (id, short_id, name, subject_id, academic_year_id, profile, rules_json, version, parent_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId, shortId, plan.name, plan.subjectId, plan.academicYearId, plan.profile,
      JSON.stringify(plan.rules), plan.version + 1, plan.id, stamp, stamp,
    );
    // Two passes: mint every id first, so a child can point at its new parent
    // regardless of the order the rows come back in.
    for (const item of items) idMap.set(item.id, crypto.randomUUID());
    for (const item of items) {
      insertItemRow(db, { ...item, id: idMap.get(item.id)!, planId: newId, parentId: item.parentId ? idMap.get(item.parentId) ?? null : null }, stamp);
    }
  })();

  return getAssessmentPlan(newId).plan;
}

export function deleteAssessmentPlan(id: string): void {
  getDb().prepare('UPDATE teaching_assessment_plans SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

// ── Items ────────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof getDb>;

function insertItemRow(db: Db, item: AssessmentItem, stamp: string): void {
  db.prepare(
    `INSERT INTO teaching_assessment_items
       (id, plan_id, parent_id, name, kind, position, weight, weight_alt, aggregation, entry_mode,
        max_points, min_to_average, is_mandatory, is_recoverable, target, best_of, conditional_min,
        source_exam_id, source_exam_question_id, source_rubric_id, competency_code, criterion_code,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id, item.planId, item.parentId, item.name, item.kind, item.position,
    item.weight, item.weightAlt, item.aggregation, item.entryMode, item.maxPoints,
    item.minToAverage, item.isMandatory ? 1 : 0, item.isRecoverable ? 1 : 0,
    item.target, item.bestOf, item.conditionalMin,
    item.sourceExamId, item.sourceExamQuestionId, item.sourceRubricId,
    item.competencyCode, item.criterionCode, stamp, stamp,
  );
}

export function createAssessmentItem(planId: string, input: Partial<AssessmentItem>): AssessmentItem {
  const db = getDb();
  const id = crypto.randomUUID();
  const stamp = now();
  const position =
    input.position ??
    Number(
      (db
        .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM teaching_assessment_items WHERE plan_id = ? AND parent_id IS ?')
        .get(planId, input.parentId ?? null) as Row).p,
    ) + 1;

  insertItemRow(db, {
    id, planId,
    parentId: input.parentId ?? null,
    name: input.name ?? '',
    kind: input.kind ?? 'activity',
    position,
    weight: input.weight ?? 1,
    weightAlt: input.weightAlt ?? input.weight ?? 1,
    aggregation: input.aggregation ?? 'weighted',
    entryMode: input.entryMode ?? 'numeric',
    maxPoints: input.maxPoints ?? 10,
    minToAverage: input.minToAverage ?? null,
    isMandatory: input.isMandatory ?? false,
    isRecoverable: input.isRecoverable ?? true,
    target: input.target ?? null,
    bestOf: input.bestOf ?? null,
    conditionalMin: input.conditionalMin ?? null,
    sourceExamId: input.sourceExamId ?? null,
    sourceExamQuestionId: input.sourceExamQuestionId ?? null,
    sourceRubricId: input.sourceRubricId ?? null,
    competencyCode: input.competencyCode ?? null,
    criterionCode: input.criterionCode ?? null,
  }, stamp);

  const row = db.prepare('SELECT * FROM teaching_assessment_items WHERE id = ?').get(id) as Row;
  return toItem(row);
}

const ITEM_COLUMNS: Record<string, string> = {
  name: 'name', kind: 'kind', position: 'position', weight: 'weight', weightAlt: 'weight_alt',
  aggregation: 'aggregation', entryMode: 'entry_mode', maxPoints: 'max_points',
  minToAverage: 'min_to_average', target: 'target', bestOf: 'best_of', conditionalMin: 'conditional_min',
  competencyCode: 'competency_code', criterionCode: 'criterion_code', parentId: 'parent_id',
};

export function updateAssessmentItem(id: string, patch: Partial<AssessmentItem>): AssessmentItem {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(ITEM_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (patch.isMandatory !== undefined) {
    sets.push('is_mandatory = ?');
    values.push(patch.isMandatory ? 1 : 0);
  }
  if (patch.isRecoverable !== undefined) {
    sets.push('is_recoverable = ?');
    values.push(patch.isRecoverable ? 1 : 0);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(now(), id);
    getDb().prepare(`UPDATE teaching_assessment_items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  const row = getDb().prepare('SELECT * FROM teaching_assessment_items WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Elemento de evaluación no encontrado.');
  return toItem(row);
}

export function deleteAssessmentItem(id: string): void {
  getDb().prepare('DELETE FROM teaching_assessment_items WHERE id = ?').run(id);
}

export function reorderAssessmentItems(planId: string, orderedIds: string[]): AssessmentItem[] {
  const db = getDb();
  const stamp = now();
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      db.prepare('UPDATE teaching_assessment_items SET position = ?, updated_at = ? WHERE id = ? AND plan_id = ?')
        .run(index, stamp, id, planId);
    });
  })();
  return listAssessmentItems(planId);
}

// ── Entries ──────────────────────────────────────────────────────────────────

export function listGradeEntries(planId: string, convocatoria = 'ordinaria'): GradeEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT e.* FROM teaching_grade_entries e
         JOIN teaching_assessment_items i ON i.id = e.item_id
        WHERE i.plan_id = ? AND e.convocatoria = ?`,
    )
    .all(planId, convocatoria) as Row[];
  return rows.map(toEntry);
}

/**
 * Writes one cell. Upsert on the natural key so the grid can fire on every edit
 * without first checking whether a row exists.
 */
export function setGradeEntry(input: {
  studentId: string;
  itemId: string;
  convocatoria?: string;
  rawValue?: number | null;
  status?: GradeEntry['status'];
  isOverride?: boolean;
  note?: string;
}): GradeEntry {
  const db = getDb();
  const convocatoria = input.convocatoria ?? 'ordinaria';
  const stamp = now();
  const existing = db
    .prepare('SELECT * FROM teaching_grade_entries WHERE student_id = ? AND item_id = ? AND convocatoria = ?')
    .get(input.studentId, input.itemId, convocatoria) as Row | undefined;

  // A value typed into an empty cell means it has been assessed; the caller only has
  // to be explicit when it is something else (not submitted, exempt…).
  const status =
    input.status ??
    (input.rawValue != null ? 'evaluated' : existing ? String(existing.status) as GradeEntry['status'] : 'not_assessed');

  if (existing) {
    db.prepare(
      `UPDATE teaching_grade_entries
          SET raw_value = ?, status = ?, is_override = ?, note = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      input.rawValue === undefined ? existing.raw_value : input.rawValue,
      status,
      (input.isOverride ?? Number(existing.is_override) === 1) ? 1 : 0,
      input.note ?? String(existing.note ?? ''),
      stamp,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO teaching_grade_entries
         (id, student_id, item_id, convocatoria, raw_value, status, is_override, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(), input.studentId, input.itemId, convocatoria,
      input.rawValue ?? null, status, input.isOverride ? 1 : 0, input.note ?? '', stamp, stamp,
    );
  }

  const row = db
    .prepare('SELECT * FROM teaching_grade_entries WHERE student_id = ? AND item_id = ? AND convocatoria = ?')
    .get(input.studentId, input.itemId, convocatoria) as Row;
  return toEntry(row);
}

export function clearGradeEntry(studentId: string, itemId: string, convocatoria = 'ordinaria'): void {
  getDb()
    .prepare('DELETE FROM teaching_grade_entries WHERE student_id = ? AND item_id = ? AND convocatoria = ?')
    .run(studentId, itemId, convocatoria);
}

/**
 * Highest recorded value per item across a group — what `normalizeGroupMax` needs.
 * Computed in SQL so it stays correct for a 200-student roster without loading it.
 */
export function cohortStats(planId: string, groupId: string, convocatoria = 'ordinaria'): { maxByItem: Record<string, number> } {
  const rows = getDb()
    .prepare(
      `SELECT e.item_id AS item_id, MAX(e.raw_value) AS top
         FROM teaching_grade_entries e
         JOIN teaching_assessment_items i ON i.id = e.item_id
         JOIN teaching_students s ON s.id = e.student_id
        WHERE i.plan_id = ? AND s.group_id = ? AND e.convocatoria = ? AND e.status = 'evaluated'
        GROUP BY e.item_id`,
    )
    .all(planId, groupId, convocatoria) as Row[];
  const maxByItem: Record<string, number> = {};
  for (const row of rows) if (row.top != null) maxByItem[String(row.item_id)] = Number(row.top);
  return { maxByItem };
}
