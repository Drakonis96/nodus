import type {
  StudyCriterionGrade,
  StudyGradingAnnotationInput,
  StudyGradingRequest,
  StudyGradingResult,
  StudyGradingRun,
  StudyGradingSource,
  StudyRubric,
} from '@shared/studyGrading';
import { calculateStudyGradingScore } from '@shared/studyGrading';
import { getSettings } from '../db/settingsRepo';
import { getStudyAttemptAnswerContext } from '../db/studyAssessmentsRepo';
import { getStudyRubric, saveStudyGradingRun } from '../db/studyGradingRepo';
import { completeTextStream, resolveModelRef } from './aiClient';

type Raw = Record<string, unknown>;

function parseJson(text: string): Raw {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const from = fenced.indexOf('{'); const to = fenced.lastIndexOf('}');
  if (from < 0 || to <= from) throw new Error('El modelo no devolvió una corrección estructurada válida.');
  const parsed = JSON.parse(fenced.slice(from, to + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('La corrección no tiene el formato esperado.');
  return parsed as Raw;
}

function stringList(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20) : []; }

function normalizeResult(raw: Raw, rubric: StudyRubric, response: string, maxScore: number): StudyGradingResult {
  const rawCriteria = Array.isArray(raw.criteria) ? raw.criteria as Raw[] : [];
  const criteria: StudyCriterionGrade[] = rubric.criteria.map((criterion) => {
    const grade = rawCriteria.find((item) => String(item.criterionId ?? item.id) === criterion.id) ?? {};
    return { criterionId: criterion.id, score: Math.min(1, Math.max(0, Number(grade.score) || 0)), rationale: String(grade.rationale ?? '').trim(), evidence: String(grade.evidence ?? '').trim() };
  });
  const allowedKinds = new Set(['strength', 'error', 'omission', 'doubt']); const allowedSeverities = new Set(['info', 'minor', 'major']);
  const annotations: StudyGradingAnnotationInput[] = (Array.isArray(raw.annotations) ? raw.annotations as Raw[] : []).flatMap((annotation) => {
    const kind = String(annotation.kind); const severity = String(annotation.severity); if (!allowedKinds.has(kind) || !allowedSeverities.has(severity)) return [];
    const from = Math.min(response.length, Math.max(0, Math.round(Number(annotation.from) || 0))); const to = Math.min(response.length, Math.max(from, Math.round(Number(annotation.to) || from)));
    const message = String(annotation.message ?? '').trim(); if (!message) return [];
    return [{ from, to, kind: kind as StudyGradingAnnotationInput['kind'], severity: severity as StudyGradingAnnotationInput['severity'], message, suggestion: String(annotation.suggestion ?? '').trim() || undefined }];
  }).slice(0, 40);
  return {
    criteria, estimatedScore: calculateStudyGradingScore(rubric.criteria, criteria, maxScore), maxScore,
    generalFeedback: String(raw.generalFeedback ?? '').trim(), correctedAnswer: String(raw.correctedAnswer ?? '').trim(),
    strengths: stringList(raw.strengths), errors: stringList(raw.errors), omissions: stringList(raw.omissions), doubts: stringList(raw.doubts),
    uncertainty: String(raw.uncertainty ?? '').trim() || 'La corrección es una estimación asistida y debe revisarse manualmente.', annotations,
  };
}

export function buildStudyGradingPrompt(input: { question: string; answer: string; modelAnswer: string; rubric: StudyRubric; sources: StudyGradingSource[]; severity: StudyGradingRequest['severity']; maxScore: number }) {
  return {
    system: `Eres el corrector asistido del vault de estudio de Nodus.

REGLAS INNEGOCIABLES
- Evalúa únicamente a partir del ENUNCIADO, la RESPUESTA MODELO, la RÚBRICA y los fragmentos exactos de FUENTES. No añadas conocimiento externo ni inventes hechos.
- La nota es una ESTIMACIÓN pendiente de decisión humana. Expresa dudas y límites de evidencia; nunca presentes inferencias como hechos.
- Puntúa cada criterio entre 0 y 1. Aplica un nivel de exigencia ${input.severity} de forma consistente, sin cambiar los pesos.
- Señala fortalezas, errores, omisiones y dudas. La respuesta corregida debe conservar las ideas acertadas y reparar sólo con información respaldada.
- Las anotaciones usan índices de caracteres de RESPUESTA (from inclusive, to exclusive), kind strength|error|omission|doubt y severity info|minor|major.
- Devuelve sólo JSON: {"criteria":[{"criterionId":"...","score":0.0,"rationale":"...","evidence":"..."}],"generalFeedback":"...","correctedAnswer":"...","strengths":[],"errors":[],"omissions":[],"doubts":[],"uncertainty":"...","annotations":[]}.`,
    user: JSON.stringify({ question: input.question, answer: input.answer, modelAnswer: input.modelAnswer, maxScore: input.maxScore, rubric: input.rubric.criteria, sources: input.sources }, null, 2),
  };
}

export async function gradeStudyAnswer(
  request: StudyGradingRequest,
  onDelta: (delta: string, kind: 'content' | 'reasoning') => void = () => undefined,
  signal?: AbortSignal,
): Promise<StudyGradingRun> {
  const context = getStudyAttemptAnswerContext(request.attemptAnswerId); if (!context) throw new Error('Respuesta no encontrada.');
  const answer = String(context.answer.response.text ?? '').trim(); if (!answer) throw new Error('No se puede corregir una respuesta en blanco.');
  const rubric = getStudyRubric(request.rubricId); if (!rubric) throw new Error('Rúbrica no encontrada.');
  const source: StudyGradingSource = { title: context.question.source.title || 'Fuente de la pregunta', excerpt: context.question.source.excerpt, location: context.question.source.location as Record<string, unknown> };
  if (!source.excerpt.trim()) throw new Error('La pregunta no tiene evidencia local suficiente para una corrección fundamentada.');
  const sources = [source]; const prompt = buildStudyGradingPrompt({ question: context.question.prompt, answer, modelAnswer: context.question.answer.text ?? '', rubric, sources, severity: request.severity, maxScore: context.item.points });
  const settings = getSettings(); const model = resolveModelRef(request.model ?? settings.studyModel ?? settings.questionGenModel ?? settings.synthesisModel);
  const text = await completeTextStream({ system: prompt.system, user: prompt.user, temperature: 0.08, maxTokens: 4000, reasoning: 'off' }, (delta, kind) => onDelta(delta, kind ?? 'content'), model, signal);
  const result = normalizeResult(parseJson(text), rubric, answer, context.item.points);
  return saveStudyGradingRun({ attemptAnswerId: request.attemptAnswerId, rubricId: rubric.id, severity: request.severity, model, sources, result });
}
