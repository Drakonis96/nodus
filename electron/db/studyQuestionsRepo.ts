import crypto from 'node:crypto';
import type {
  StudyQuestion,
  StudyQuestionBulkAction,
  StudyQuestionCollection,
  StudyQuestionExport,
  StudyQuestionFilters,
  StudyQuestionInput,
  StudyQuestionSort,
  StudyQuestionVersion,
  StudyQuestionAnalytics,
  StudyQuestionSimilar,
} from '@shared/studyQuestions';
import { findSimilarStudyQuestion, studyQuestionSimilarity, validateStudyQuestionInput } from '@shared/studyQuestions';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

function toQuestion(row: Row): StudyQuestion {
  const provider = row.model_provider ? String(row.model_provider) : '';
  const model = row.model_name ? String(row.model_name) : '';
  return {
    id: String(row.id), shortId: String(row.short_id), prompt: String(row.prompt),
    type: String(row.question_type) as StudyQuestion['type'], difficulty: String(row.difficulty) as StudyQuestion['difficulty'],
    cognitiveLevel: String(row.cognitive_level) as StudyQuestion['cognitiveLevel'], status: String(row.status) as StudyQuestion['status'],
    answer: json(row.answer_json, {}), options: json(row.options_json, []), explanation: String(row.explanation ?? ''),
    rubric: json(row.rubric_json, {}), competence: String(row.competence ?? ''), tags: json(row.tags_json, []),
    courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null, documentId: row.document_id ? String(row.document_id) : null,
    materialId: row.material_id ? String(row.material_id) : null, recordingId: row.recording_id ? String(row.recording_id) : null,
    transcriptId: row.transcript_id ? String(row.transcript_id) : null,
    source: { title: String(row.source_title ?? ''), excerpt: String(row.source_excerpt ?? ''), location: json(row.source_location_json, {}) },
    model: provider && model ? { provider, model } as StudyQuestion['model'] : null,
    generationPrompt: String(row.generation_prompt ?? ''), favorite: bool(row.favorite), locked: bool(row.locked),
    usageCount: Number(row.usage_count ?? 0), correctCount: Number(row.correct_count ?? 0),
    incorrectCount: Number(row.incorrect_count ?? 0), omittedCount: Number(row.omitted_count ?? 0),
    totalResponseMs: Number(row.total_response_ms ?? 0), position: Number(row.position ?? 0),
    lastResponse: String(row.last_response ?? ''), lastScore: row.last_score == null ? null : Number(row.last_score),
    lastMaxScore: row.last_max_score == null ? null : Number(row.last_max_score), lastFeedback: String(row.last_feedback ?? ''),
    lastAnsweredAt: row.last_answered_at ? String(row.last_answered_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toInput(question: StudyQuestion): StudyQuestionInput {
  return {
    prompt: question.prompt, type: question.type, difficulty: question.difficulty, cognitiveLevel: question.cognitiveLevel,
    status: question.status, answer: question.answer, options: question.options, explanation: question.explanation,
    rubric: question.rubric, competence: question.competence, tags: question.tags, courseId: question.courseId,
    subjectId: question.subjectId, folderId: question.folderId, topicId: question.topicId, documentId: question.documentId, materialId: question.materialId,
    recordingId: question.recordingId, transcriptId: question.transcriptId, source: question.source, model: question.model,
    generationPrompt: question.generationPrompt, favorite: question.favorite, locked: question.locked,
  };
}

function rowFor(id: string): Row | undefined {
  return getDb().prepare('SELECT * FROM study_questions WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
}

function snapshot(question: StudyQuestion, reason: StudyQuestionVersion['reason']): StudyQuestionVersion {
  const db = getDb(); const key = ids('QVR'); const timestamp = now();
  const versionNo = Number((db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM study_question_versions WHERE question_id = ?').get(question.id) as Row).value);
  const input = toInput(question);
  db.prepare('INSERT INTO study_question_versions (id, short_id, question_id, version_no, snapshot_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key.id, key.shortId, question.id, versionNo, JSON.stringify(input), reason, timestamp);
  return { id: key.id, shortId: key.shortId, questionId: question.id, versionNo, snapshot: input, reason, createdAt: timestamp };
}

export function getStudyQuestion(id: string): StudyQuestion | null {
  const row = rowFor(id); return row ? toQuestion(row) : null;
}

const QUESTION_SORT_SQL: Record<StudyQuestionSort, string> = {
  updated: 'favorite DESC, updated_at DESC, position',
  created: 'created_at DESC, position',
  prompt: 'prompt COLLATE NOCASE ASC',
  difficulty: "CASE difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END, updated_at DESC",
  status: "CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 WHEN 'problematic' THEN 2 ELSE 3 END, updated_at DESC",
  source: "COALESCE(source_title, '') COLLATE NOCASE ASC, updated_at DESC",
  usage: 'usage_count DESC, updated_at DESC',
  answered: 'last_answered_at DESC, updated_at DESC',
};

export function listStudyQuestions(filters: StudyQuestionFilters = {}): StudyQuestion[] {
  const conditions = ['deleted_at IS NULL']; const params: unknown[] = [];
  if (!filters.archived) conditions.push('archived_at IS NULL');
  if (filters.courseId) { conditions.push('course_id = ?'); params.push(filters.courseId); }
  if (filters.subjectId) { conditions.push('subject_id = ?'); params.push(filters.subjectId); }
  if (filters.folderId) { conditions.push('folder_id = ?'); params.push(filters.folderId); }
  if (filters.topicId) { conditions.push('topic_id = ?'); params.push(filters.topicId); }
  if (filters.documentId) { conditions.push('document_id = ?'); params.push(filters.documentId); }
  if (filters.materialId) { conditions.push('material_id = ?'); params.push(filters.materialId); }
  if (filters.type && filters.type !== 'all') { conditions.push('question_type = ?'); params.push(filters.type); }
  if (filters.difficulty && filters.difficulty !== 'all') { conditions.push('difficulty = ?'); params.push(filters.difficulty); }
  if (filters.status && filters.status !== 'all') { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.favorite) conditions.push('favorite = 1');
  if (filters.sourceKind === 'document') conditions.push('document_id IS NOT NULL');
  if (filters.sourceKind === 'material') conditions.push('material_id IS NOT NULL');
  if (filters.sourceKind === 'recording') conditions.push('(recording_id IS NOT NULL OR transcript_id IS NOT NULL)');
  if (filters.collectionId) { conditions.push('id IN (SELECT question_id FROM study_question_collection_items WHERE collection_id = ?)'); params.push(filters.collectionId); }
  if (filters.tag?.trim()) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(study_questions.tags_json) WHERE json_each.value = ?)");
    params.push(filters.tag.trim());
  }
  if (filters.search?.trim()) {
    conditions.push("(prompt LIKE ? ESCAPE '\\' OR explanation LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR source_title LIKE ? ESCAPE '\\')");
    const escaped = filters.search.trim().replace(/[\\%_]/g, '\\$&'); params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  const order = QUESTION_SORT_SQL[filters.sort ?? 'updated'] ?? QUESTION_SORT_SQL.updated;
  return (getDb().prepare(`SELECT * FROM study_questions WHERE ${conditions.join(' AND ')} ORDER BY ${order}`).all(...params) as Row[]).map(toQuestion);
}

/** Distinct tags with how many live questions use them, for the bank's tag filter. */
export function listStudyQuestionTags(): Array<{ tag: string; count: number }> {
  const rows = getDb().prepare(`SELECT json_each.value AS tag, COUNT(*) AS count FROM study_questions, json_each(study_questions.tags_json)
    WHERE deleted_at IS NULL AND json_each.value IS NOT NULL AND TRIM(json_each.value) != ''
    GROUP BY json_each.value ORDER BY count DESC, tag COLLATE NOCASE ASC`).all() as Row[];
  return rows.map((row) => ({ tag: String(row.tag), count: Number(row.count) }));
}

function normalizedInput(input: StudyQuestionInput, current?: StudyQuestion): Required<Pick<StudyQuestionInput, 'prompt' | 'type' | 'difficulty' | 'cognitiveLevel' | 'status' | 'answer' | 'options' | 'explanation' | 'rubric' | 'competence' | 'tags'>> & StudyQuestionInput {
  const merged = { ...(current ? toInput(current) : {}), ...input };
  const prompt = normalizeStudyName(merged.prompt);
  const clean: StudyQuestionInput = {
    ...merged, prompt, type: merged.type, difficulty: merged.difficulty ?? 'medium', cognitiveLevel: merged.cognitiveLevel ?? 'understand',
    status: merged.status ?? 'pending', answer: merged.answer ?? {}, options: merged.options ?? [], explanation: merged.explanation?.trim() ?? '',
    rubric: merged.rubric ?? {}, competence: merged.competence?.trim() ?? '', tags: [...new Set((merged.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 40),
  };
  const errors = validateStudyQuestionInput(clean);
  if (errors.length) throw new Error(errors.join(' '));
  return clean as ReturnType<typeof normalizedInput>;
}

export function createStudyQuestion(input: StudyQuestionInput, reason: StudyQuestionVersion['reason'] = 'create', allowSimilar = false): StudyQuestion {
  const clean = normalizedInput(input); const db = getDb();
  if (!allowSimilar) {
    const similar = findSimilarStudyQuestion(clean.prompt, listStudyQuestions({ archived: true }));
    if (similar) throw new Error(`Ya existe una pregunta similar (${Math.round(similar.similarity * 100)}%): ${similar.question.prompt}`);
  }
  const key = ids('QUE'); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_questions').get() as Row).value);
  db.prepare(`INSERT INTO study_questions
    (id, short_id, prompt, question_type, difficulty, cognitive_level, status, answer_json, options_json, explanation, rubric_json,
     competence, tags_json, course_id, subject_id, folder_id, topic_id, document_id, material_id, recording_id, transcript_id,
     source_title, source_excerpt, source_location_json, model_provider, model_name, generation_prompt, favorite, locked, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    key.id, key.shortId, clean.prompt, clean.type, clean.difficulty, clean.cognitiveLevel, clean.status, JSON.stringify(clean.answer),
    JSON.stringify(clean.options), clean.explanation, JSON.stringify(clean.rubric), clean.competence || null, JSON.stringify(clean.tags),
    clean.courseId ?? null, clean.subjectId ?? null, clean.folderId ?? null, clean.topicId ?? null, clean.documentId ?? null, clean.materialId ?? null,
    clean.recordingId ?? null, clean.transcriptId ?? null, clean.source?.title?.trim() || null, clean.source?.excerpt?.trim() ?? '',
    JSON.stringify(clean.source?.location ?? {}), clean.model?.provider ?? null, clean.model?.model ?? null, clean.generationPrompt?.trim() || null,
    clean.favorite ? 1 : 0, clean.locked ? 1 : 0, position, timestamp, timestamp,
  );
  const created = getStudyQuestion(key.id)!; snapshot(created, reason); return created;
}

export function updateStudyQuestion(id: string, patch: Partial<StudyQuestionInput>): StudyQuestion {
  const current = getStudyQuestion(id); if (!current) throw new Error('Pregunta no encontrada.');
  const contentKeys: Array<keyof StudyQuestionInput> = ['prompt', 'type', 'difficulty', 'cognitiveLevel', 'answer', 'options', 'explanation', 'rubric', 'competence', 'tags', 'source'];
  if (current.locked && patch.locked !== false && contentKeys.some((key) => patch[key] !== undefined)) throw new Error('Desbloquea la pregunta validada antes de editarla.');
  const clean = normalizedInput({ ...toInput(current), ...patch, prompt: patch.prompt ?? current.prompt, type: patch.type ?? current.type }, current);
  const timestamp = now();
  getDb().prepare(`UPDATE study_questions SET prompt=?, question_type=?, difficulty=?, cognitive_level=?, status=?, answer_json=?, options_json=?,
    explanation=?, rubric_json=?, competence=?, tags_json=?, course_id=?, subject_id=?, folder_id=?, topic_id=?, document_id=?, material_id=?, recording_id=?, transcript_id=?,
    source_title=?, source_excerpt=?, source_location_json=?, model_provider=?, model_name=?, generation_prompt=?, favorite=?, locked=?, updated_at=? WHERE id=?`).run(
    clean.prompt, clean.type, clean.difficulty, clean.cognitiveLevel, clean.status, JSON.stringify(clean.answer), JSON.stringify(clean.options),
    clean.explanation, JSON.stringify(clean.rubric), clean.competence || null, JSON.stringify(clean.tags), clean.courseId ?? null,
    clean.subjectId ?? null, clean.folderId ?? null, clean.topicId ?? null, clean.documentId ?? null, clean.materialId ?? null, clean.recordingId ?? null,
    clean.transcriptId ?? null, clean.source?.title?.trim() || null, clean.source?.excerpt?.trim() ?? '', JSON.stringify(clean.source?.location ?? {}),
    clean.model?.provider ?? null, clean.model?.model ?? null, clean.generationPrompt?.trim() || null, clean.favorite ? 1 : 0,
    clean.locked ? 1 : 0, timestamp, id,
  );
  const updated = getStudyQuestion(id)!; snapshot(updated, 'update'); return updated;
}

export function duplicateStudyQuestion(id: string): StudyQuestion {
  const current = getStudyQuestion(id); if (!current) throw new Error('Pregunta no encontrada.');
  return createStudyQuestion({ ...toInput(current), prompt: `${current.prompt} (variante)`, status: 'pending', locked: false, favorite: false }, 'duplicate', true);
}

export function listStudyQuestionVersions(questionId: string): StudyQuestionVersion[] {
  return (getDb().prepare('SELECT * FROM study_question_versions WHERE question_id = ? ORDER BY version_no DESC').all(questionId) as Row[]).map((row) => ({
    id: String(row.id), shortId: String(row.short_id), questionId: String(row.question_id), versionNo: Number(row.version_no),
    snapshot: json(row.snapshot_json, {} as StudyQuestionInput), reason: String(row.reason) as StudyQuestionVersion['reason'], createdAt: String(row.created_at),
  }));
}

export function restoreStudyQuestionVersion(questionId: string, versionId: string): StudyQuestion {
  const version = listStudyQuestionVersions(questionId).find((item) => item.id === versionId); if (!version) throw new Error('Versión no encontrada.');
  return updateStudyQuestion(questionId, { ...version.snapshot, locked: false });
}

export function setStudyQuestionLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete'): void {
  const db = getDb(); const timestamp = now();
  if (action === 'delete') { db.prepare('DELETE FROM study_questions WHERE id = ?').run(id); return; }
  if (action === 'archive' || action === 'restore') db.prepare('UPDATE study_questions SET archived_at=?, updated_at=? WHERE id=?').run(action === 'archive' ? timestamp : null, timestamp, id);
  else db.prepare('UPDATE study_questions SET deleted_at=?, updated_at=? WHERE id=?').run(action === 'trash' ? timestamp : null, timestamp, id);
}

export function exportStudyQuestions(idsToExport?: string[]): StudyQuestionExport {
  const all = listStudyQuestions({ archived: true }); const selected = idsToExport?.length ? all.filter((question) => idsToExport.includes(question.id)) : all;
  return { format: 'nodus-study-questions', version: 1, exportedAt: now(), questions: selected.map(toInput) };
}

export function importStudyQuestions(payload: StudyQuestionExport): StudyQuestion[] {
  if (payload.format !== 'nodus-study-questions' || payload.version !== 1 || !Array.isArray(payload.questions)) throw new Error('Fichero de preguntas no válido.');
  return payload.questions.map((question) => createStudyQuestion(question, 'import', true));
}

/**
 * Applies one metadata action to many questions at once. Bulk metadata edits update
 * `updated_at` but deliberately do not write a version snapshot per row: a version
 * history entry is for editing content, and a 200-row move would bury the real edits.
 */
export function bulkStudyQuestions(ids: string[], action: StudyQuestionBulkAction): number {
  const unique = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (!unique.length) return 0;
  const db = getDb(); const timestamp = now();
  const placeholders = unique.map(() => '?').join(',');
  let affected = 0;
  db.transaction(() => {
    if (action.kind === 'status') {
      affected = db.prepare(`UPDATE study_questions SET status=?, updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(action.status, timestamp, ...unique).changes;
    } else if (action.kind === 'difficulty') {
      affected = db.prepare(`UPDATE study_questions SET difficulty=?, updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(action.difficulty, timestamp, ...unique).changes;
    } else if (action.kind === 'favorite') {
      affected = db.prepare(`UPDATE study_questions SET favorite=?, updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(action.favorite ? 1 : 0, timestamp, ...unique).changes;
    } else if (action.kind === 'move') {
      const assignments: string[] = []; const values: unknown[] = [];
      const columns: Array<['courseId' | 'subjectId' | 'folderId' | 'topicId' | 'documentId' | 'materialId', string]> = [['courseId', 'course_id'], ['subjectId', 'subject_id'], ['folderId', 'folder_id'], ['topicId', 'topic_id'], ['documentId', 'document_id'], ['materialId', 'material_id']];
      for (const [key, column] of columns) {
        if (action[key] === undefined) continue;
        assignments.push(`${column}=?`); values.push(action[key] || null);
      }
      if (assignments.length) {
        affected = db.prepare(`UPDATE study_questions SET ${assignments.join(', ')}, updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(...values, timestamp, ...unique).changes;
      }
    } else if (action.kind === 'tags') {
      const add = [...new Set((action.add ?? []).map((tag) => tag.trim()).filter(Boolean))];
      const remove = new Set((action.remove ?? []).map((tag) => tag.trim()).filter(Boolean));
      const rows = db.prepare(`SELECT id, tags_json FROM study_questions WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...unique) as Row[];
      const update = db.prepare('UPDATE study_questions SET tags_json=?, updated_at=? WHERE id=?');
      for (const row of rows) {
        const current = json<string[]>(row.tags_json, []);
        const next = [...new Set([...current.filter((tag) => !remove.has(tag)), ...add])];
        if (next.length !== current.length || next.some((tag, index) => tag !== current[index])) { update.run(JSON.stringify(next), timestamp, String(row.id)); affected += 1; }
      }
    } else if (action.kind === 'collections') {
      for (const collectionId of [...new Set(action.add ?? [])]) {
        const start = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_question_collection_items WHERE collection_id=?').get(collectionId) as Row).value);
        const insert = db.prepare('INSERT OR IGNORE INTO study_question_collection_items (collection_id, question_id, position, created_at) VALUES (?, ?, ?, ?)');
        unique.forEach((questionId, index) => { affected += insert.run(collectionId, questionId, start + index, timestamp).changes; });
        db.prepare('UPDATE study_question_collections SET updated_at=? WHERE id=?').run(timestamp, collectionId);
      }
      for (const collectionId of [...new Set(action.remove ?? [])]) {
        affected += db.prepare(`DELETE FROM study_question_collection_items WHERE collection_id=? AND question_id IN (${placeholders})`).run(collectionId, ...unique).changes;
        db.prepare('UPDATE study_question_collections SET updated_at=? WHERE id=?').run(timestamp, collectionId);
      }
    } else if (action.kind === 'lifecycle') {
      if (action.action === 'delete') affected = db.prepare(`DELETE FROM study_questions WHERE id IN (${placeholders})`).run(...unique).changes;
      else if (action.action === 'archive' || action.action === 'restore') affected = db.prepare(`UPDATE study_questions SET archived_at=?, updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(action.action === 'archive' ? timestamp : null, timestamp, ...unique).changes;
      else affected = db.prepare(`UPDATE study_questions SET deleted_at=?, updated_at=? WHERE id IN (${placeholders})`).run(action.action === 'trash' ? timestamp : null, timestamp, ...unique).changes;
    }
  })();
  return affected;
}

export function listStudyQuestionCollections(): StudyQuestionCollection[] {
  return (getDb().prepare(`SELECT c.*, COUNT(i.question_id) AS question_count FROM study_question_collections c
    LEFT JOIN study_question_collection_items i ON i.collection_id=c.id GROUP BY c.id ORDER BY c.favorite DESC, c.position, c.name`).all() as Row[]).map((row) => ({
    id: String(row.id), shortId: String(row.short_id), name: String(row.name), description: String(row.description ?? ''), color: String(row.color ?? '#0f766e'),
    favorite: bool(row.favorite), position: Number(row.position), archivedAt: row.archived_at ? String(row.archived_at) : null,
    questionCount: Number(row.question_count), questionIds: (getDb().prepare('SELECT question_id FROM study_question_collection_items WHERE collection_id=? ORDER BY position').all(String(row.id)) as Row[]).map((item) => String(item.question_id)), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function createStudyQuestionCollection(name: string, description = ''): StudyQuestionCollection {
  const db = getDb(); const key = ids('QCO'); const timestamp = now(); const clean = normalizeStudyName(name);
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_question_collections').get() as Row).value);
  db.prepare('INSERT INTO study_question_collections (id, short_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key.id, key.shortId, clean, description.trim(), position, timestamp, timestamp);
  return listStudyQuestionCollections().find((collection) => collection.id === key.id)!;
}

export function setStudyQuestionCollectionItems(collectionId: string, questionIds: string[]): void {
  const db = getDb(); const timestamp = now(); const unique = [...new Set(questionIds)];
  db.transaction(() => {
    db.prepare('DELETE FROM study_question_collection_items WHERE collection_id = ?').run(collectionId);
    const insert = db.prepare('INSERT INTO study_question_collection_items (collection_id, question_id, position, created_at) VALUES (?, ?, ?, ?)');
    unique.forEach((questionId, position) => insert.run(collectionId, questionId, position, timestamp));
    db.prepare('UPDATE study_question_collections SET updated_at=? WHERE id=?').run(timestamp, collectionId);
  })();
}

export function deleteStudyQuestionCollection(id: string): void { getDb().prepare('DELETE FROM study_question_collections WHERE id=?').run(id); }

export function findSimilarStudyQuestions(id: string, threshold = 0.45): StudyQuestionSimilar[] {
  const current = getStudyQuestion(id); if (!current) return [];
  return listStudyQuestions({ archived: true }).filter((question) => question.id !== id)
    .map((question) => ({ question, similarity: studyQuestionSimilarity(current.prompt, question.prompt) }))
    .filter((entry) => entry.similarity >= threshold).sort((left, right) => right.similarity - left.similarity).slice(0, 12);
}

export function getStudyQuestionAnalytics(id: string): StudyQuestionAnalytics {
  const question = getStudyQuestion(id); if (!question) throw new Error('Pregunta no encontrada.');
  const rows = getDb().prepare('SELECT response_json FROM study_attempt_answers WHERE question_id=?').all(id) as Row[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const response = json<{ value?: string | string[] }>(row.response_json, {}); const values = Array.isArray(response.value) ? response.value : response.value == null ? [] : [response.value];
    for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }
  const successRate = question.usageCount ? question.correctCount / question.usageCount : null;
  const observedDifficulty = successRate == null ? 'unrated' : successRate >= 0.88 ? 'too_easy' : successRate <= 0.35 ? 'too_hard' : 'balanced';
  return {
    averageResponseMs: question.usageCount ? Math.round(question.totalResponseMs / question.usageCount) : 0, successRate, observedDifficulty,
    optionSelections: question.options.map((option) => ({ optionId: option.id, text: option.text, selectedCount: counts.get(option.id) ?? 0, correct: option.correct })),
  };
}
