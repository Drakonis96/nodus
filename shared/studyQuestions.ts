import type { ModelRef } from './types';
import type { StudySearchLocation } from './studySearch';

export const STUDY_QUESTION_TYPES = [
  'short', 'essay', 'definition', 'relation', 'comparison', 'commentary', 'case',
  'true_false', 'single_choice', 'multiple_choice', 'fill_blank', 'ordering', 'matching',
] as const;
export type StudyQuestionType = typeof STUDY_QUESTION_TYPES[number];
export type StudyQuestionDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type StudyCognitiveLevel = 'remember' | 'understand' | 'analyze' | 'apply' | 'synthesize';
export type StudyQuestionStatus = 'pending' | 'approved' | 'problematic' | 'discarded';

export interface StudyQuestionOption { id: string; text: string; correct: boolean; feedback?: string }
export interface StudyQuestionAnswer { text?: string; value?: boolean | string | string[]; items?: string[]; pairs?: Array<[string, string]> }
export interface StudyQuestionSource {
  sourceKey?: string;
  title: string;
  excerpt: string;
  location?: StudySearchLocation;
}

export interface StudyQuestion {
  id: string;
  shortId: string;
  prompt: string;
  type: StudyQuestionType;
  difficulty: Exclude<StudyQuestionDifficulty, 'mixed'>;
  cognitiveLevel: StudyCognitiveLevel;
  status: StudyQuestionStatus;
  answer: StudyQuestionAnswer;
  options: StudyQuestionOption[];
  explanation: string;
  rubric: Record<string, unknown>;
  competence: string;
  tags: string[];
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  documentId: string | null;
  materialId: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  source: StudyQuestionSource;
  model: ModelRef | null;
  generationPrompt: string;
  favorite: boolean;
  locked: boolean;
  usageCount: number;
  correctCount: number;
  incorrectCount: number;
  omittedCount: number;
  totalResponseMs: number;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyQuestionInput {
  prompt: string;
  type: StudyQuestionType;
  difficulty?: Exclude<StudyQuestionDifficulty, 'mixed'>;
  cognitiveLevel?: StudyCognitiveLevel;
  status?: StudyQuestionStatus;
  answer?: StudyQuestionAnswer;
  options?: StudyQuestionOption[];
  explanation?: string;
  rubric?: Record<string, unknown>;
  competence?: string;
  tags?: string[];
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  documentId?: string | null;
  materialId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  source?: Partial<StudyQuestionSource>;
  model?: ModelRef | null;
  generationPrompt?: string;
  favorite?: boolean;
  locked?: boolean;
}

export interface StudyQuestionFilters {
  search?: string;
  courseId?: string;
  subjectId?: string;
  topicId?: string;
  type?: StudyQuestionType | 'all';
  difficulty?: Exclude<StudyQuestionDifficulty, 'mixed'> | 'all';
  status?: StudyQuestionStatus | 'all';
  favorite?: boolean;
  archived?: boolean;
  sourceKind?: 'document' | 'material' | 'recording' | 'all';
}

export interface StudyQuestionGenerationRequest {
  sourceKeys: string[];
  count: number;
  difficulty: StudyQuestionDifficulty;
  cognitiveLevels: StudyCognitiveLevel[];
  types: StudyQuestionType[];
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  selection?: string;
  weakConcepts?: string[];
  model?: ModelRef | null;
}

export interface StudyQuestionGenerationResult {
  questions: StudyQuestionInput[];
  rejectedDuplicates: number;
  sourceCount: number;
  model: ModelRef;
}

export interface StudyQuestionCollection {
  id: string; shortId: string; name: string; description: string; color: string;
  favorite: boolean; position: number; archivedAt: string | null; questionCount: number;
  questionIds: string[]; createdAt: string; updatedAt: string;
}

export interface StudyQuestionSimilar { question: StudyQuestion; similarity: number }
export interface StudyQuestionAnalytics {
  averageResponseMs: number;
  successRate: number | null;
  observedDifficulty: 'unrated' | 'too_easy' | 'balanced' | 'too_hard';
  optionSelections: Array<{ optionId: string; text: string; selectedCount: number; correct: boolean }>;
}

export interface StudyQuestionVersion {
  id: string; shortId: string; questionId: string; versionNo: number;
  snapshot: StudyQuestionInput; reason: 'create' | 'update' | 'restore' | 'duplicate' | 'import'; createdAt: string;
}

export interface StudyQuestionExport { format: 'nodus-study-questions'; version: 1; exportedAt: string; questions: StudyQuestionInput[] }

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function studyQuestionTokens(value: string): Set<string> {
  return new Set(normalize(value).split(' ').filter((token) => token.length > 2));
}

export function studyQuestionSimilarity(a: string, b: string): number {
  const left = studyQuestionTokens(a); const right = studyQuestionTokens(b);
  if (!left.size || !right.size) return normalize(a) === normalize(b) ? 1 : 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function findSimilarStudyQuestion(prompt: string, questions: Array<Pick<StudyQuestion, 'id' | 'prompt'>>, threshold = 0.78) {
  return questions.map((question) => ({ question, similarity: studyQuestionSimilarity(prompt, question.prompt) }))
    .filter((entry) => entry.similarity >= threshold).sort((a, b) => b.similarity - a.similarity)[0] ?? null;
}

export function validateStudyQuestionInput(input: StudyQuestionInput): string[] {
  const errors: string[] = [];
  if (input.prompt.trim().length < 8) errors.push('El enunciado debe tener al menos 8 caracteres.');
  if (!STUDY_QUESTION_TYPES.includes(input.type)) errors.push('Tipo de pregunta no válido.');
  if (['single_choice', 'multiple_choice'].includes(input.type)) {
    if ((input.options?.length ?? 0) < 2) errors.push('Las preguntas de elección necesitan al menos dos opciones.');
    if (!(input.options ?? []).some((option) => option.correct)) errors.push('Marca al menos una respuesta correcta.');
    if (input.type === 'single_choice' && (input.options ?? []).filter((option) => option.correct).length !== 1) errors.push('La elección simple debe tener una sola respuesta correcta.');
  }
  if (input.type === 'true_false' && typeof input.answer?.value !== 'boolean') errors.push('Verdadero/falso necesita una respuesta booleana.');
  if (!input.answer?.text?.trim() && input.answer?.value == null && !['ordering', 'matching'].includes(input.type)) errors.push('Añade una respuesta correcta o modelo.');
  if (!input.source?.excerpt?.trim() && !input.explanation?.trim()) errors.push('Añade una explicación o un fragmento de fuente justificativo.');
  return errors;
}

export function normalizeGeneratedStudyQuestions(value: unknown): StudyQuestionInput[] {
  const raw = Array.isArray(value) ? value : typeof value === 'object' && value !== null && Array.isArray((value as { questions?: unknown }).questions)
    ? (value as { questions: unknown[] }).questions : [];
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const type = STUDY_QUESTION_TYPES.includes(item.type as StudyQuestionType) ? item.type as StudyQuestionType : 'short';
    const prompt = String(item.prompt ?? '').trim();
    const sourceExcerpt = String(item.sourceExcerpt ?? item.source_excerpt ?? '').trim();
    const options = Array.isArray(item.options) ? item.options.map((option, optionIndex) => {
      const value = option as Record<string, unknown>;
      return { id: String(value.id ?? `O${optionIndex + 1}`), text: String(value.text ?? ''), correct: Boolean(value.correct), feedback: String(value.feedback ?? '') };
    }).filter((option) => option.text.trim()) : [];
    const question: StudyQuestionInput = {
      prompt, type,
      difficulty: ['easy', 'medium', 'hard'].includes(String(item.difficulty)) ? item.difficulty as StudyQuestion['difficulty'] : 'medium',
      cognitiveLevel: ['remember', 'understand', 'analyze', 'apply', 'synthesize'].includes(String(item.cognitiveLevel)) ? item.cognitiveLevel as StudyCognitiveLevel : 'understand',
      answer: typeof item.answer === 'object' && item.answer !== null ? item.answer as StudyQuestionAnswer : { text: String(item.answer ?? '') },
      options, explanation: String(item.explanation ?? ''), tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      competence: String(item.competence ?? ''), source: { title: String(item.sourceTitle ?? `Fuente ${index + 1}`), excerpt: sourceExcerpt },
      status: 'pending',
    };
    return validateStudyQuestionInput(question).length ? [] : [question];
  });
}
