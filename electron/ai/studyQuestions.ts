import type {
  StudyQuestionGenerationRequest,
  StudyQuestionGenerationResult,
  StudyQuestionInput,
} from '@shared/studyQuestions';
import { findSimilarStudyQuestion, parseStudyDevelopmentQuestionBlocks, parseStudyQuestionBlocks, studyQuestionSimilarity } from '@shared/studyQuestions';
import { compressStudyAssistantEvidence, studyAssistantSourceKey } from '@shared/studyAssistant';
import type { StudySearchIndexEntry, StudySearchOptions } from '@shared/studySearch';
import { listStudyQuestions } from '../db/studyQuestionsRepo';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { completeText } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { retrieveStudyAssistantEntries } from './studySearch';
import { retrieveStudyKnowledgeContext } from './studyKnowledge';
import type { StudyAssessmentKnowledgeContext } from '@shared/studyKnowledge';

function searchOptions(request: StudyQuestionGenerationRequest): StudySearchOptions {
  return {
    courseId: request.courseId || undefined,
    subjectId: request.subjectId || undefined,
    // Folder and topic scopes are resolved to explicit source keys below so
    // descendants remain included instead of being filtered out here.
  };
}

function nestedSourceKeys(request: StudyQuestionGenerationRequest): string[] {
  if (!request.folderId && !request.topicId) return request.sourceKeys;
  const db = getDb();
  const topicRows = request.topicId
    ? db.prepare(`WITH RECURSIVE nested(id) AS (SELECT ? UNION ALL SELECT t.id FROM study_topics t JOIN nested n ON t.parent_id=n.id) SELECT id FROM nested`).all(request.topicId) as Array<{ id: string }>
    : db.prepare(`WITH RECURSIVE folders(id) AS (SELECT ? UNION ALL SELECT f.id FROM study_folders f JOIN folders p ON f.parent_id=p.id)
      SELECT t.id FROM study_topics t WHERE t.folder_id IN (SELECT id FROM folders)`).all(request.folderId) as Array<{ id: string }>;
  const topicIds = topicRows.map((row) => String(row.id));
  const folderRows = request.folderId
    ? db.prepare(`WITH RECURSIVE folders(id) AS (SELECT ? UNION ALL SELECT f.id FROM study_folders f JOIN folders p ON f.parent_id=p.id) SELECT id FROM folders`).all(request.folderId) as Array<{ id: string }>
    : [];
  const folderIds = folderRows.map((row) => String(row.id));
  const where: string[] = []; const params: string[] = [];
  if (topicIds.length) { where.push(`topic_id IN (${topicIds.map(() => '?').join(',')})`); params.push(...topicIds); }
  if (folderIds.length) { where.push(`folder_id IN (${folderIds.map(() => '?').join(',')})`); params.push(...folderIds); }
  if (!where.length) return request.sourceKeys.length ? request.sourceKeys : ['__empty_scope__'];
  const clause = where.join(' OR ');
  const docs = (db.prepare(`SELECT DISTINCT document_id id FROM study_placements WHERE deleted_at IS NULL AND (${clause})`).all(...params) as Array<{ id: string }>).map((row) => `document:${row.id}`);
  const materials = (db.prepare(`SELECT DISTINCT material_id id FROM study_material_placements WHERE deleted_at IS NULL AND (${clause})`).all(...params) as Array<{ id: string }>).map((row) => `material:${row.id}`);
  const transcripts = topicIds.length ? (db.prepare(`SELECT DISTINCT t.id FROM study_transcripts t JOIN study_recordings r ON r.id=t.recording_id WHERE r.topic_id IN (${topicIds.map(() => '?').join(',')}) AND t.status='ready'`).all(...topicIds) as Array<{ id: string }>).map((row) => `transcript:${row.id}`) : [];
  const keys = [...new Set([...request.sourceKeys, ...docs, ...materials, ...transcripts])];
  return keys.length ? keys : ['__empty_scope__'];
}

function queryFor(request: StudyQuestionGenerationRequest): string {
  return [request.selection, ...(request.weakConcepts ?? []), 'conceptos principales relaciones definiciones aplicaciones']
    .filter(Boolean).join(' ').slice(0, 1200);
}

interface QuestionPromptSource { id: string; title: string; type: string; location: unknown; exactFragment: string }

export function studyQuestionGenerationTask(types: StudyQuestionGenerationRequest['types']): 'questions' | 'flashcards' {
  return types.length === 1 && types[0] === 'definition' ? 'flashcards' : 'questions';
}

function sourcePayload(entries: StudySearchIndexEntry[], selection?: string): QuestionPromptSource[] {
  const sources: QuestionPromptSource[] = entries.map((entry, index) => {
    const compressed = compressStudyAssistantEvidence(entry.text, queryFor({ sourceKeys: [], count: 1, difficulty: 'medium', cognitiveLevels: [], types: [], selection }), 4200);
    return { id: `S${index + 1}`, title: entry.title, type: entry.kind, location: entry.location, exactFragment: compressed.text };
  });
  if (selection?.trim()) sources.unshift({ id: 'S0', title: 'Selección del alumno', type: 'selection', location: {}, exactFragment: selection.trim().slice(0, 8000) });
  return sources;
}

const PROMPT_COPY = {
  es: { role: 'Creas preguntas tipo test a partir de materiales de estudio.', developmentRole: 'Creas preguntas de desarrollo breve para comprobar la comprensión de los conceptos clave.', source: 'CONTENIDO INDEXADO', custom: 'INDICACIONES ADICIONALES', grounding: 'Usa solamente el contenido proporcionado. No inventes datos y evita preguntas repetidas o ambiguas.', development: (count: number) => `Genera exactamente ${count} preguntas. Tras cada pregunta incluye una respuesta modelo breve y suficiente para corregirla.`, test: (count: number, options: number) => `Genera exactamente ${count} preguntas con ${options} respuestas cada una. Solo una debe ser correcta. Las respuestas incorrectas deben ser creíbles.`, rules: 'Devuelve solo las preguntas. No añadas introducciones, numeración, Markdown, bloques de código ni explicaciones.', format: 'Formato obligatorio para cada pregunta', question: 'Aquí va la pregunta', correct: 'Respuesta correcta', incorrect: 'Respuesta incorrecta' },
  en: { role: 'Create multiple-choice questions from study materials.', developmentRole: 'Create short-answer questions that check understanding of the key concepts.', source: 'INDEXED CONTENT', custom: 'ADDITIONAL INSTRUCTIONS', grounding: 'Use only the provided content. Do not invent facts, and avoid repeated or ambiguous questions.', development: (count: number) => `Generate exactly ${count} questions. After each question, include a concise model answer that is sufficient for grading.`, test: (count: number, options: number) => `Generate exactly ${count} questions with ${options} answers each. Only one answer may be correct. The incorrect answers must be plausible.`, rules: 'Return only the questions. Do not add an introduction, numbering, Markdown, code fences, or explanations.', format: 'Required format for every question', question: 'Question goes here', correct: 'Correct answer', incorrect: 'Incorrect answer' },
  fr: { role: 'Crée des questions à choix multiple à partir des supports de cours.', developmentRole: 'Crée des questions à réponse courte pour vérifier la compréhension des concepts clés.', source: 'CONTENU INDEXÉ', custom: 'CONSIGNES SUPPLÉMENTAIRES', grounding: 'Utilise uniquement le contenu fourni. N’invente aucune information et évite les questions répétitives ou ambiguës.', development: (count: number) => `Génère exactement ${count} questions. Après chaque question, ajoute une réponse modèle courte et suffisante pour la correction.`, test: (count: number, options: number) => `Génère exactement ${count} questions avec ${options} réponses chacune. Une seule réponse doit être correcte. Les réponses incorrectes doivent être plausibles.`, rules: 'Renvoie uniquement les questions. N’ajoute ni introduction, ni numérotation, ni Markdown, ni bloc de code, ni explication.', format: 'Format obligatoire pour chaque question', question: 'La question apparaît ici', correct: 'Réponse correcte', incorrect: 'Réponse incorrecte' },
  tr: { role: 'Ders materyallerinden çoktan seçmeli sorular oluştur.', developmentRole: 'Temel kavramların anlaşılıp anlaşılmadığını ölçen kısa yanıtlı sorular oluştur.', source: 'DİZİNE EKLENMİŞ İÇERİK', custom: 'EK TALİMATLAR', grounding: 'Yalnızca verilen içeriği kullan. Bilgi uydurma, tekrarlanan veya belirsiz sorulardan kaçın.', development: (count: number) => `Tam olarak ${count} soru oluştur. Her sorudan sonra değerlendirme için yeterli, kısa bir örnek yanıt ekle.`, test: (count: number, options: number) => `Her biri ${options} yanıt içeren tam olarak ${count} soru oluştur. Yalnızca bir yanıt doğru olmalı. Yanlış yanıtlar inandırıcı olmalı.`, rules: 'Yalnızca soruları döndür. Giriş, numaralandırma, Markdown, kod bloğu veya açıklama ekleme.', format: 'Her soru için zorunlu biçim', question: 'Soru buraya yazılır', correct: 'Doğru yanıt', incorrect: 'Yanlış yanıt' },
} as const;

export function buildStudyQuestionPrompt(request: StudyQuestionGenerationRequest, sources: ReturnType<typeof sourcePayload>, knowledge?: StudyAssessmentKnowledgeContext) {
  const count = Math.max(1, Math.min(40, Math.round(request.count)));
  const development = request.types.includes('essay');
  const optionCount = Math.max(2, Math.min(10, Math.round(request.optionCount ?? 4)));
  const language = getSettings().promptLanguage ?? 'es';
  const copy = PROMPT_COPY[language];
  return {
    system: `${development ? copy.developmentRole : copy.role}
${copy.grounding}
El mapa conceptual sirve para elegir qué evaluar, pero no es evidencia. Toda respuesta correcta y todo distractor deben poder verificarse en CONTENIDO INDEXADO.
${development ? copy.development(count) : copy.test(count, optionCount)}
${copy.rules}

${copy.format}
Q: ${copy.question}
* ${copy.correct}
${development ? '' : Array.from({ length: optionCount - 1 }, () => `- ${copy.incorrect}`).join('\n')}`,
    user: `${knowledge?.outline ? `MAPA CONCEPTUAL DE LA ASIGNATURA\n${knowledge.outline}\n\n` : ''}${copy.source}\n${sources.map((source) => `[${source.title}]\n${source.exactFragment}`).join('\n\n')}${request.customPrompt?.trim() ? `\n\n${copy.custom}\n${request.customPrompt.trim()}` : ''}`,
    count, optionCount, development,
  };
}

export function mergeStudyAssessmentKnowledgeContexts(contexts: StudyAssessmentKnowledgeContext[]): StudyAssessmentKnowledgeContext {
  const ideas = new Map(contexts.flatMap((context) => context.ideas).map((idea) => [idea.id, idea]));
  const connections = new Map(contexts.flatMap((context) => context.connections).map((edge) => [edge.id, edge]));
  return {
    ideas: [...ideas.values()],
    connections: [...connections.values()],
    outline: [...new Set(contexts.flatMap((context) => context.outline.split('\n')).filter(Boolean))].join('\n'),
    embeddingAvailable: contexts.some((context) => context.embeddingAvailable),
  };
}

function applySource(question: StudyQuestionInput, entries: StudySearchIndexEntry[], selection?: string): StudyQuestionInput {
  if (!entries.length && selection?.trim()) return { ...question, source: { title: 'Selección del alumno', excerpt: selection.trim() } };
  const entry = [...entries].sort((a, b) => studyQuestionSimilarity(question.prompt, b.text) - studyQuestionSimilarity(question.prompt, a.text))[0];
  if (!entry) return question;
  const excerpt = compressStudyAssistantEvidence(entry.text, question.prompt, 2200).text;
  return {
    ...question,
    courseId: entry.scope.courseId ?? null, subjectId: entry.scope.subjectId ?? null, folderId: entry.scope.folderId ?? null, topicId: entry.scope.topicId ?? null,
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
  const sourceKeys = nestedSourceKeys(request);
  const retrievalQuery = queryFor(request);
  const entries = await retrieveStudyAssistantEntries(retrievalQuery, searchOptions(request), sourceKeys, Math.min(80, Math.max(24, sourceKeys.length * 4)));
  const subjectIds = [...new Set([
    request.subjectId,
    ...entries.map((entry) => entry.scope.subjectId),
  ].filter((id): id is string => Boolean(id)))];
  const knowledgeContexts = await Promise.all(subjectIds.map((subjectId) => retrieveStudyKnowledgeContext(subjectId, retrievalQuery, sourceKeys)));
  const knowledge = knowledgeContexts.length ? mergeStudyAssessmentKnowledgeContexts(knowledgeContexts) : undefined;
  if (!entries.length && !request.selection?.trim()) throw new Error('No hay fuentes de estudio disponibles para generar preguntas.');
  const sources = sourcePayload(entries, request.selection);
  const prompt = buildStudyQuestionPrompt(request, sources, knowledge);
  const aiSettings = getSettings();
  const task = studyQuestionGenerationTask(request.types);
  const completed = await runStudyAiTask<string>({ task, explicitModel: request.model, subjectId: request.subjectId ?? (subjectIds.length === 1 ? subjectIds[0] : undefined), inputChars: prompt.system.length + prompt.user.length, outputChars: (value) => value.length },
    (model) => completeText({ system: prompt.system, user: prompt.user, temperature: aiSettings.studyAiTemperature, maxTokens: Math.min(aiSettings.studyAiMaxOutputTokens, Math.max(1800, prompt.count * prompt.optionCount * 90)), reasoning: 'off' }, model));
  const raw = prompt.development ? parseStudyDevelopmentQuestionBlocks(completed.value) : parseStudyQuestionBlocks(completed.value, prompt.optionCount); const model = completed.model;
  if (!raw.length) throw new Error('La IA no devolvió preguntas con el formato Q, * y - solicitado.');
  const existing = listStudyQuestions({ archived: true }); const accepted: StudyQuestionInput[] = []; let rejectedDuplicates = 0;
  for (const normalized of raw) {
    const duplicate = findSimilarStudyQuestion(normalized.prompt, [
      ...existing,
      ...accepted.map((question, index) => ({ id: `new-${index}`, prompt: question.prompt })),
    ]);
    if (duplicate) { rejectedDuplicates += 1; continue; }
    accepted.push({
      ...applySource(normalized, entries, request.selection),
      difficulty: request.difficulty === 'mixed' ? normalized.difficulty : request.difficulty,
      courseId: request.courseId ?? normalized.courseId ?? null,
      subjectId: request.subjectId ?? normalized.subjectId ?? null,
      folderId: request.folderId ?? normalized.folderId ?? null,
      topicId: request.topicId ?? normalized.topicId ?? null,
      model,
      generationPrompt: JSON.stringify({ format: prompt.development ? 'Q-star-development' : 'Q-star-dash', optionCount: prompt.development ? 0 : prompt.optionCount, customPrompt: request.customPrompt ?? '', language: aiSettings.promptLanguage,
        knowledgeIdeaIds: knowledge?.ideas.map((idea) => idea.id) ?? [], knowledgeConnectionIds: knowledge?.connections.map((edge) => edge.id) ?? [] }),
    });
    if (accepted.length >= prompt.count) break;
  }
  return { questions: accepted, rejectedDuplicates, sourceCount: sources.length, ideaCount: knowledge?.ideas.length ?? 0, connectionCount: knowledge?.connections.length ?? 0, model };
}
