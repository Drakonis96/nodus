import type { StudyQuestion } from '@shared/studyQuestions';
import type { StudyAssessment, StudyTestBuildRequest } from '@shared/studyAssessments';
import { seededShuffle } from '@shared/studyAssessments';
import { createStudyAssessment } from '../db/studyAssessmentsRepo';
import { listStudyQuestions } from '../db/studyQuestionsRepo';

function successRate(question: StudyQuestion): number {
  return question.usageCount ? question.correctCount / question.usageCount : 0.5;
}

export function selectStudyTestQuestions(request: StudyTestBuildRequest, pool = listStudyQuestions({ status: 'approved' })): StudyQuestion[] {
  const requested = new Set(request.questionIds ?? []);
  let candidates = pool.filter((question) => question.status === 'approved' && !question.archivedAt);
  if (request.courseId) candidates = candidates.filter((question) => question.courseId === request.courseId);
  if (request.subjectId) candidates = candidates.filter((question) => question.subjectId === request.subjectId);
  if (request.topicId) candidates = candidates.filter((question) => question.topicId === request.topicId);
  if (request.difficulty && request.difficulty !== 'mixed') candidates = candidates.filter((question) => question.difficulty === request.difficulty);
  if (request.questionTypes?.length) candidates = candidates.filter((question) => request.questionTypes!.includes(question.type));
  if (request.selection === 'manual') candidates = candidates.filter((question) => requested.has(question.id));
  else if (request.selection === 'adaptive') candidates.sort((left, right) => successRate(left) - successRate(right) || right.incorrectCount - left.incorrectCount || left.updatedAt.localeCompare(right.updatedAt));
  else candidates = seededShuffle(candidates, request.config?.seed ?? Date.now());
  return candidates.slice(0, Math.max(1, Math.min(200, request.count)));
}

export function buildStudyTest(request: StudyTestBuildRequest): StudyAssessment {
  const selected = selectStudyTestQuestions(request);
  if (!selected.length) throw new Error(request.selection === 'manual' ? 'Selecciona al menos una pregunta aprobada.' : 'No hay preguntas aprobadas que cumplan estos filtros.');
  return createStudyAssessment({
    kind: request.kind ?? 'test', title: request.title, description: request.description, courseId: request.courseId, subjectId: request.subjectId,
    topicId: request.topicId, durationMinutes: request.durationMinutes, maxAttempts: request.maxAttempts, favorite: request.favorite,
    questionIds: selected.map((question) => question.id), points: request.points,
    config: { ...request.config, selection: request.selection, questionCount: selected.length, difficulty: request.difficulty, questionTypes: request.questionTypes },
  });
}
