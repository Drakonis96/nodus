import crypto from 'node:crypto';
import { getDb } from './database';
import { createStudyShortId } from '@shared/studyOrg';
import {
  defaultExamHeader,
  defaultExamQuestion,
  examQuestionTypeDef,
  isExamQuestionType,
  isExamSection,
  MAX_EXAM_LOGOS,
  normalizeExamLanguage,
  type ExamLogo,
  type ExamOption,
  type ExamPair,
  type ExamQuestion,
  type ExamQuestionInput,
  type TeachingExam,
  type TeachingExamDetail,
  type TeachingExamInput,
} from '@shared/teachingExams';

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

function toExam(row: Row): TeachingExam {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    title: String(row.title ?? ''),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    courseId: row.course_id ? String(row.course_id) : null,
    language: normalizeExamLanguage(row.language),
    languageLocked: Number(row.language_locked) === 1,
    targetQuestionCount: Number(row.target_question_count ?? 10),
    header: defaultExamHeader(parseJson(row.header_json, {})),
    logos: parseJson<ExamLogo[]>(row.logos_json, []).slice(0, MAX_EXAM_LOGOS),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toQuestion(row: Row): ExamQuestion {
  const type = isExamQuestionType(row.type) ? row.type : 'short_essay';
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    examId: String(row.exam_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    position: Number(row.position ?? 0),
    type,
    prompt: String(row.prompt ?? ''),
    points: Number(row.points ?? examQuestionTypeDef(type).defaultPoints),
    options: parseJson<ExamOption[]>(row.options_json, []),
    pairs: parseJson<ExamPair[]>(row.pairs_json, []),
    items: parseJson<string[]>(row.items_json, []),
    imageDataUrl: row.image_data_url ? String(row.image_data_url) : null,
    imageCaption: String(row.image_caption ?? ''),
    answerLines: row.answer_lines == null ? null : Number(row.answer_lines),
    solution: String(row.solution ?? ''),
    aiPrompt: String(row.ai_prompt ?? ''),
    generatedBy: row.generated_by === 'ai' ? 'ai' : 'manual',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function examRow(id: string): Row {
  const row = getDb().prepare('SELECT * FROM teaching_exams WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Examen no encontrado.');
  return row;
}

function questionRow(id: string): Row {
  const row = getDb().prepare('SELECT * FROM teaching_exam_questions WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Pregunta de examen no encontrada.');
  return row;
}

export function listTeachingExams(options: { subjectId?: string | null; includeArchived?: boolean } = {}): TeachingExam[] {
  const clauses = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  if (!options.includeArchived) clauses.push('archived_at IS NULL');
  if (options.subjectId) {
    clauses.push('subject_id = ?');
    values.push(options.subjectId);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM teaching_exams WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`)
    .all(...values) as Row[];
  return rows.map(toExam);
}

export function getTeachingExam(id: string): TeachingExamDetail {
  const exam = toExam(examRow(id));
  const questions = (getDb()
    .prepare('SELECT * FROM teaching_exam_questions WHERE exam_id = ? ORDER BY position, created_at')
    .all(id) as Row[]).map(toQuestion);
  return { ...exam, questions };
}

export function createTeachingExam(input: TeachingExamInput): TeachingExamDetail {
  const title = input.title?.trim() || 'Examen sin título';
  const key = ids('EXM');
  const timestamp = now();
  const header = defaultExamHeader(input.header ?? {});
  getDb()
    .prepare(`INSERT INTO teaching_exams
      (id, short_id, title, subject_id, course_id, language, language_locked, target_question_count, header_json, logos_json, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(
      key.id,
      key.shortId,
      title,
      input.subjectId ?? null,
      input.courseId ?? null,
      normalizeExamLanguage(input.language),
      input.languageLocked ? 1 : 0,
      Math.max(1, Math.min(100, Math.round(input.targetQuestionCount ?? 10))),
      JSON.stringify(header),
      JSON.stringify((input.logos ?? []).slice(0, MAX_EXAM_LOGOS)),
      timestamp,
      timestamp
    );
  return getTeachingExam(key.id);
}

export function updateTeachingExam(id: string, patch: Partial<TeachingExamInput>): TeachingExamDetail {
  const current = toExam(examRow(id));
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.title !== undefined) set('title', patch.title.trim() || 'Examen sin título');
  if (patch.subjectId !== undefined) set('subject_id', patch.subjectId ?? null);
  if (patch.courseId !== undefined) set('course_id', patch.courseId ?? null);
  if (patch.language !== undefined) set('language', normalizeExamLanguage(patch.language));
  if (patch.languageLocked !== undefined) set('language_locked', patch.languageLocked ? 1 : 0);
  if (patch.targetQuestionCount !== undefined) set('target_question_count', Math.max(1, Math.min(100, Math.round(patch.targetQuestionCount))));
  // The header is merged, not replaced, so a partial patch from one panel cannot wipe
  // fields owned by another.
  if (patch.header !== undefined) set('header_json', JSON.stringify({ ...current.header, ...patch.header }));
  if (patch.logos !== undefined) set('logos_json', JSON.stringify(patch.logos.slice(0, MAX_EXAM_LOGOS)));
  if (assignments.length) {
    getDb().prepare(`UPDATE teaching_exams SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  return getTeachingExam(id);
}

export function deleteTeachingExam(id: string): void {
  examRow(id);
  getDb().prepare('UPDATE teaching_exams SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

export function duplicateTeachingExam(id: string): TeachingExamDetail {
  const source = getTeachingExam(id);
  const copy = createTeachingExam({
    title: `${source.title} (copia)`,
    subjectId: source.subjectId,
    courseId: source.courseId,
    language: source.language,
    languageLocked: source.languageLocked,
    targetQuestionCount: source.targetQuestionCount,
    header: source.header,
    logos: source.logos,
  });
  const ordered = [...source.questions].sort((a, b) => a.position - b.position);
  // old id → new id. Sections are copied first so a sub-question always finds its
  // statement already there; parent_id must never point across exams.
  const idMap = new Map<string, string>();
  const copyQuestion = (question: (typeof ordered)[number]) => {
    const created = addTeachingExamQuestion(copy.id, {
      type: question.type,
      parentId: question.parentId ? idMap.get(question.parentId) ?? null : null,
      prompt: question.prompt,
      points: question.points,
      options: question.options,
      pairs: question.pairs,
      items: question.items,
      imageDataUrl: question.imageDataUrl,
      imageCaption: question.imageCaption,
      answerLines: question.answerLines,
      solution: question.solution,
      aiPrompt: question.aiPrompt,
      generatedBy: question.generatedBy,
    });
    idMap.set(question.id, created.id);
  };
  ordered.filter((question) => isExamSection(question.type)).forEach(copyQuestion);
  ordered.filter((question) => !isExamSection(question.type)).forEach(copyQuestion);
  // Copying in two passes scrambled `position`; restore the order the teacher arranged.
  reorderTeachingExamQuestions(copy.id, ordered.map((question) => idMap.get(question.id)!));
  return getTeachingExam(copy.id);
}

function nextQuestionPosition(examId: string): number {
  const row = getDb().prepare('SELECT COALESCE(MAX(position), -1) AS max FROM teaching_exam_questions WHERE exam_id = ?').get(examId) as Row;
  return Number(row.max ?? -1) + 1;
}

/**
 * Resolve the section a new question hangs from.
 *
 * Sections do not nest and cannot cross exams, so an id that is neither is treated as
 * "no parent" rather than accepted and left to corrupt the numbering later.
 */
function resolveParentId(examId: string, parentId: string | null | undefined, type: string): string | null {
  if (!parentId || isExamSection(type)) return null;
  const row = getDb()
    .prepare('SELECT id FROM teaching_exam_questions WHERE id = ? AND exam_id = ? AND type = ?')
    .get(parentId, examId, 'section') as Row | undefined;
  return row ? String(row.id) : null;
}

export function addTeachingExamQuestion(examId: string, input: ExamQuestionInput): ExamQuestion {
  examRow(examId);
  const type = isExamQuestionType(input.type) ? input.type : 'short_essay';
  const defaults = defaultExamQuestion(type);
  const key = ids('EXQ');
  const timestamp = now();
  getDb()
    .prepare(`INSERT INTO teaching_exam_questions
      (id, short_id, exam_id, parent_id, position, type, prompt, points, options_json, pairs_json, items_json,
       image_data_url, image_caption, answer_lines, solution, ai_prompt, generated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      key.id,
      key.shortId,
      examId,
      resolveParentId(examId, input.parentId, type),
      nextQuestionPosition(examId),
      type,
      input.prompt ?? defaults.prompt ?? '',
      Number.isFinite(input.points) ? Number(input.points) : defaults.points ?? 1,
      JSON.stringify(input.options ?? defaults.options ?? []),
      JSON.stringify(input.pairs ?? defaults.pairs ?? []),
      JSON.stringify(input.items ?? defaults.items ?? []),
      input.imageDataUrl ?? null,
      input.imageCaption ?? '',
      input.answerLines ?? null,
      input.solution ?? '',
      input.aiPrompt ?? '',
      input.generatedBy === 'ai' ? 'ai' : 'manual',
      timestamp,
      timestamp
    );
  touchExam(examId);
  return toQuestion(questionRow(key.id));
}

export function updateTeachingExamQuestion(id: string, patch: Partial<ExamQuestionInput>): ExamQuestion {
  const row = questionRow(id);
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.type !== undefined && isExamQuestionType(patch.type)) set('type', patch.type);
  if (patch.parentId !== undefined) {
    const type = patch.type !== undefined && isExamQuestionType(patch.type) ? patch.type : String(row.type);
    set('parent_id', resolveParentId(String(row.exam_id), patch.parentId, type));
  }
  if (patch.prompt !== undefined) set('prompt', patch.prompt);
  if (patch.points !== undefined) set('points', Math.max(0, Number(patch.points) || 0));
  if (patch.options !== undefined) set('options_json', JSON.stringify(patch.options));
  if (patch.pairs !== undefined) set('pairs_json', JSON.stringify(patch.pairs));
  if (patch.items !== undefined) set('items_json', JSON.stringify(patch.items));
  if (patch.imageDataUrl !== undefined) set('image_data_url', patch.imageDataUrl ?? null);
  if (patch.imageCaption !== undefined) set('image_caption', patch.imageCaption);
  if (patch.answerLines !== undefined) set('answer_lines', patch.answerLines ?? null);
  if (patch.solution !== undefined) set('solution', patch.solution);
  if (patch.aiPrompt !== undefined) set('ai_prompt', patch.aiPrompt);
  if (patch.generatedBy !== undefined) set('generated_by', patch.generatedBy === 'ai' ? 'ai' : 'manual');
  if (assignments.length) {
    getDb().prepare(`UPDATE teaching_exam_questions SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  touchExam(String(row.exam_id));
  return toQuestion(questionRow(id));
}

export function deleteTeachingExamQuestion(id: string): void {
  const row = questionRow(id);
  getDb().prepare('DELETE FROM teaching_exam_questions WHERE id = ?').run(id);
  reindexQuestions(String(row.exam_id));
  touchExam(String(row.exam_id));
}

/** Persist an explicit order (the builder sends the full id list after a move). */
export function reorderTeachingExamQuestions(examId: string, orderedIds: string[]): ExamQuestion[] {
  examRow(examId);
  const db = getDb();
  const update = db.prepare('UPDATE teaching_exam_questions SET position = ?, updated_at = ? WHERE id = ? AND exam_id = ?');
  const timestamp = now();
  db.transaction(() => {
    orderedIds.forEach((id, index) => update.run(index, timestamp, id, examId));
  })();
  touchExam(examId);
  return getTeachingExam(examId).questions;
}

function reindexQuestions(examId: string): void {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM teaching_exam_questions WHERE exam_id = ? ORDER BY position, created_at').all(examId) as Row[];
  const update = db.prepare('UPDATE teaching_exam_questions SET position = ? WHERE id = ?');
  db.transaction(() => {
    rows.forEach((row, index) => update.run(index, String(row.id)));
  })();
}

function touchExam(examId: string): void {
  getDb().prepare('UPDATE teaching_exams SET updated_at = ? WHERE id = ?').run(now(), examId);
}
