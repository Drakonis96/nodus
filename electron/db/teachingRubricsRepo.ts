import crypto from 'node:crypto';
import { getDb } from './database';
import { createStudyShortId } from '@shared/studyOrg';
import {
  clampRubricScale,
  defaultRubric,
  normalizeRubricLanguage,
  type RubricCriterion,
  type RubricLevel,
  type TeachingRubric,
  type TeachingRubricInput,
} from '@shared/teachingRubrics';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

/** Stored JSON is user data that may predate a shape change — never trust it. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function toRubric(row: Row): TeachingRubric {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    courseId: row.course_id ? String(row.course_id) : null,
    language: normalizeRubricLanguage(row.language),
    scaleMax: Number(row.scale_max ?? 5),
    weighted: Number(row.weighted) === 1,
    levels: parseJson<RubricLevel[]>(row.levels_json, []),
    criteria: parseJson<RubricCriterion[]>(row.criteria_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rubricRow(id: string): Row {
  const row = getDb().prepare('SELECT * FROM teaching_rubrics WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Rúbrica no encontrada.');
  return row;
}

export function listTeachingRubrics(options: { subjectId?: string | null; search?: string } = {}): TeachingRubric[] {
  const clauses = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  if (options.subjectId) {
    clauses.push('subject_id = ?');
    values.push(options.subjectId);
  }
  if (options.search?.trim()) {
    clauses.push('(title LIKE ? OR description LIKE ?)');
    const query = `%${options.search.trim()}%`;
    values.push(query, query);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM teaching_rubrics WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`)
    .all(...values) as Row[];
  return rows.map(toRubric);
}

export function getTeachingRubric(id: string): TeachingRubric {
  return toRubric(rubricRow(id));
}

export function createTeachingRubric(input: TeachingRubricInput = {}): TeachingRubric {
  const language = normalizeRubricLanguage(input.language);
  const base = defaultRubric(language, input.scaleMax ?? 5);
  const key = ids('RUB');
  const timestamp = now();
  getDb()
    .prepare(`INSERT INTO teaching_rubrics
      (id, short_id, title, description, subject_id, course_id, language, scale_max, weighted, levels_json, criteria_json, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(
      key.id,
      key.shortId,
      input.title?.trim() || 'Rúbrica sin título',
      input.description ?? '',
      input.subjectId ?? null,
      input.courseId ?? null,
      language,
      clampRubricScale(input.scaleMax ?? base.scaleMax),
      input.weighted ?? base.weighted ? 1 : 0,
      JSON.stringify(input.levels ?? base.levels),
      JSON.stringify(input.criteria ?? base.criteria),
      timestamp,
      timestamp
    );
  return getTeachingRubric(key.id);
}

export function updateTeachingRubric(id: string, patch: Partial<TeachingRubricInput>): TeachingRubric {
  rubricRow(id);
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.title !== undefined) set('title', patch.title.trim() || 'Rúbrica sin título');
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.subjectId !== undefined) set('subject_id', patch.subjectId ?? null);
  if (patch.courseId !== undefined) set('course_id', patch.courseId ?? null);
  if (patch.language !== undefined) set('language', normalizeRubricLanguage(patch.language));
  if (patch.scaleMax !== undefined) set('scale_max', clampRubricScale(patch.scaleMax));
  if (patch.weighted !== undefined) set('weighted', patch.weighted ? 1 : 0);
  if (patch.levels !== undefined) set('levels_json', JSON.stringify(patch.levels));
  if (patch.criteria !== undefined) set('criteria_json', JSON.stringify(patch.criteria));
  if (assignments.length) {
    getDb().prepare(`UPDATE teaching_rubrics SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  return getTeachingRubric(id);
}

export function deleteTeachingRubric(id: string): void {
  rubricRow(id);
  getDb().prepare('UPDATE teaching_rubrics SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

export function duplicateTeachingRubric(id: string): TeachingRubric {
  const source = getTeachingRubric(id);
  return createTeachingRubric({
    title: `${source.title} (copia)`,
    description: source.description,
    subjectId: source.subjectId,
    courseId: source.courseId,
    language: source.language,
    scaleMax: source.scaleMax,
    weighted: source.weighted,
    levels: source.levels,
    criteria: source.criteria,
  });
}

/** Write one descriptor cell — the write behind the per-cell AI button. */
export function setTeachingRubricCell(id: string, criterionId: string, levelId: string, text: string): TeachingRubric {
  const rubric = getTeachingRubric(id);
  const criteria = rubric.criteria.map((criterion) =>
    criterion.id === criterionId ? { ...criterion, cells: { ...criterion.cells, [levelId]: text } } : criterion
  );
  return updateTeachingRubric(id, { criteria });
}
