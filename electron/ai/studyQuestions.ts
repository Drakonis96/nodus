import type {
  StudyQuestionGenerationRequest,
  StudyQuestionGenerationResult,
  StudyQuestionInput,
} from '@shared/studyQuestions';
import { findSimilarStudyQuestion, normalizeGeneratedStudyQuestions } from '@shared/studyQuestions';
import { compressStudyAssistantEvidence, studyAssistantSourceKey } from '@shared/studyAssistant';
import type { StudySearchIndexEntry, StudySearchOptions } from '@shared/studySearch';
import { getSettings } from '../db/settingsRepo';
import { listStudyQuestions } from '../db/studyQuestionsRepo';
import { completeJson, resolveModelRef } from './aiClient';
import { retrieveStudyAssistantEntries } from './studySearch';

type RawQuestion = Record<string, unknown> & { prompt?: unknown; sourceId?: unknown };
interface RawQuestionResult { questions: RawQuestion[] }

function isRawQuestionResult(value: unknown): value is RawQuestionResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as { questions?: unknown }).questions);
}

function searchOptions(request: StudyQuestionGenerationRequest): StudySearchOptions {
  return {
    courseId: request.courseId || undefined,
    subjectId: request.subjectId || undefined,
    topicId: request.topicId || undefined,
  };
}

function queryFor(request: StudyQuestionGenerationRequest): string {
  return [request.selection, ...(request.weakConcepts ?? []), 'conceptos principales relaciones definiciones aplicaciones']
    .filter(Boolean).join(' ').slice(0, 1200);
}

interface QuestionPromptSource { id: string; title: string; type: string; location: unknown; exactFragment: string }

function sourcePayload(entries: StudySearchIndexEntry[], selection?: string): QuestionPromptSource[] {
  const sources: QuestionPromptSource[] = entries.map((entry, index) => {
    const compressed = compressStudyAssistantEvidence(entry.text, queryFor({ sourceKeys: [], count: 1, difficulty: 'medium', cognitiveLevels: [], types: [], selection }), 4200);
    return { id: `S${index + 1}`, title: entry.title, type: entry.kind, location: entry.location, exactFragment: compressed.text };
  });
  if (selection?.trim()) sources.unshift({ id: 'S0', title: 'Selección del alumno', type: 'selection', location: {}, exactFragment: selection.trim().slice(0, 8000) });
  return sources;
}

export function buildStudyQuestionPrompt(request: StudyQuestionGenerationRequest, sources: ReturnType<typeof sourcePayload>) {
  const count = Math.max(1, Math.min(40, Math.round(request.count)));
  return {
    system: `Eres el generador de preguntas del vault de estudio de Nodus.

REGLAS INNEGOCIABLES
- Usa exclusivamente los fragmentos exactos de FUENTES. No añadas conocimiento externo ni inventes datos, citas, páginas o respuestas.
- Cada pregunta debe indicar un sourceId existente. La explicación y respuesta deben poder justificarse literalmente con esa fuente.
- Evita preguntas duplicadas, vagas o que se respondan sin comprender el material.
- Los distractores deben ser plausibles: confusiones cercanas, errores habituales o conceptos relacionados; nunca opciones absurdas.
- Devuelve JSON {"questions": [...]}. Cada elemento: prompt, type, difficulty, cognitiveLevel, answer, options, explanation, competence, tags, sourceId.
- Tipos permitidos: ${request.types.join(', ')}.
- Niveles cognitivos: ${request.cognitiveLevels.join(', ')}. Dificultad: ${request.difficulty}.
- Para single_choice usa exactamente una opción correct=true; multiple_choice una o más; true_false usa answer.value boolean.
- Genera exactamente ${count} preguntas cuando las fuentes lo permitan. Si no bastan, genera menos; nunca rellenes inventando.`,
    user: JSON.stringify({ weakConcepts: request.weakConcepts ?? [], sources }, null, 2),
    count,
  };
}

function applySource(question: StudyQuestionInput, raw: RawQuestion, entries: StudySearchIndexEntry[], selection?: string): StudyQuestionInput {
  const rawId = String(raw.sourceId ?? '');
  if (rawId === 'S0' && selection?.trim()) return { ...question, source: { title: 'Selección del alumno', excerpt: selection.trim() } };
  const index = /^S(\d+)$/i.exec(rawId)?.[1];
  const entry = index ? entries[Number(index) - 1] : entries[0];
  if (!entry) return question;
  const excerpt = compressStudyAssistantEvidence(entry.text, question.prompt, 2200).text;
  return {
    ...question,
    courseId: entry.scope.courseId ?? null, subjectId: entry.scope.subjectId ?? null, topicId: entry.scope.topicId ?? null,
    documentId: entry.kind === 'document' ? entry.sourceId : null,
    materialId: entry.kind === 'material' ? entry.sourceId : null,
    recordingId: entry.location.recordingId ?? null,
    transcriptId: entry.kind === 'transcript' ? entry.sourceId : null,
    source: { sourceKey: studyAssistantSourceKey(entry.kind, entry.sourceId), title: entry.title, excerpt, location: entry.location },
  };
}

export async function generateStudyQuestions(request: StudyQuestionGenerationRequest): Promise<StudyQuestionGenerationResult> {
  if (!request.types.length) throw new Error('Selecciona al menos un tipo de pregunta.');
  if (!request.cognitiveLevels.length) throw new Error('Selecciona al menos un nivel cognitivo.');
  const entries = await retrieveStudyAssistantEntries(queryFor(request), searchOptions(request), request.sourceKeys, 18);
  if (!entries.length && !request.selection?.trim()) throw new Error('No hay fuentes de estudio disponibles para generar preguntas.');
  const sources = sourcePayload(entries, request.selection);
  const prompt = buildStudyQuestionPrompt(request, sources);
  const settings = getSettings();
  const model = resolveModelRef(request.model ?? settings.questionGenModel ?? settings.studyModel ?? settings.synthesisModel);
  const raw = await completeJson<RawQuestionResult>({ system: prompt.system, user: prompt.user, temperature: 0.18, maxTokens: Math.max(1600, prompt.count * 420) }, isRawQuestionResult, model);
  const existing = listStudyQuestions({ archived: true }); const accepted: StudyQuestionInput[] = []; let rejectedDuplicates = 0;
  for (const item of raw.questions) {
    const normalized = normalizeGeneratedStudyQuestions({ questions: [item] })[0];
    if (!normalized) continue;
    const duplicate = findSimilarStudyQuestion(normalized.prompt, [
      ...existing,
      ...accepted.map((question, index) => ({ id: `new-${index}`, prompt: question.prompt })),
    ]);
    if (duplicate) { rejectedDuplicates += 1; continue; }
    accepted.push({
      ...applySource(normalized, item, entries, request.selection),
      difficulty: request.difficulty === 'mixed' ? normalized.difficulty : request.difficulty,
      courseId: request.courseId ?? normalized.courseId ?? null,
      subjectId: request.subjectId ?? normalized.subjectId ?? null,
      topicId: request.topicId ?? normalized.topicId ?? null,
      model,
      generationPrompt: JSON.stringify({ types: request.types, cognitiveLevels: request.cognitiveLevels, weakConcepts: request.weakConcepts ?? [] }),
    });
    if (accepted.length >= prompt.count) break;
  }
  return { questions: accepted, rejectedDuplicates, sourceCount: sources.length, model };
}
