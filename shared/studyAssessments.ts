import type { StudyQuestion, StudyQuestionDifficulty, StudyQuestionType } from './studyQuestions';

export type StudyAssessmentKind = 'test' | 'exam';
export type StudyAssessmentMode = 'practice' | 'exam';
export type StudyAssessmentSelection = 'manual' | 'random' | 'adaptive';
export type StudyCorrectionMode = 'immediate' | 'end';
export type StudyAttemptStatus = 'in_progress' | 'submitted' | 'expired' | 'abandoned';

export interface StudyAssessmentConfig {
  selection: StudyAssessmentSelection;
  correctionMode: StudyCorrectionMode;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  showExplanations: boolean;
  negativePoints: number;
  blankPoints: number;
  questionCount?: number;
  difficulty?: StudyQuestionDifficulty;
  questionTypes?: StudyQuestionType[];
  seed?: number;
}

export interface StudyAssessmentInput {
  kind?: StudyAssessmentKind;
  title: string;
  description?: string;
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  durationMinutes?: number | null;
  maxAttempts?: number | null;
  favorite?: boolean;
  config?: Partial<StudyAssessmentConfig>;
  questionIds: string[];
  points?: Record<string, number>;
}

export interface StudyTestBuildRequest extends Omit<StudyAssessmentInput, 'questionIds'> {
  questionIds?: string[];
  count: number;
  difficulty?: StudyQuestionDifficulty;
  questionTypes?: StudyQuestionType[];
  selection: StudyAssessmentSelection;
}

export interface StudyAssessmentItem {
  id: string;
  shortId: string;
  assessmentId: string;
  questionId: string;
  points: number;
  required: boolean;
  position: number;
  question: StudyQuestion;
  createdAt: string;
}

export interface StudyAssessment {
  id: string;
  shortId: string;
  kind: StudyAssessmentKind;
  title: string;
  description: string;
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  config: StudyAssessmentConfig;
  rubricId: string | null;
  availableAt: string | null;
  durationMinutes: number | null;
  maxAttempts: number | null;
  favorite: boolean;
  archivedAt: string | null;
  items: StudyAssessmentItem[];
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyQuestionResponse {
  text?: string;
  value?: boolean | string | string[];
  items?: string[];
  pairs?: Array<[string, string]>;
}

export interface StudyAnswerEvaluation {
  gradable: boolean;
  omitted: boolean;
  correct: boolean | null;
  pointsAwarded: number | null;
  maxPoints: number;
  feedback: string;
  expected: string;
}

export interface StudyAttemptAnswer {
  id: string;
  shortId: string;
  attemptId: string;
  assessmentItemId: string;
  questionId: string;
  response: StudyQuestionResponse;
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  responseMs: number;
  flagged: boolean;
  confidence: number | null;
  feedback: StudyAnswerEvaluation | Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StudyAttemptConfig {
  questionOrder: string[];
  optionOrder: Record<string, string[]>;
  retryKind?: 'all' | 'errors' | 'flagged';
  sourceAttemptId?: string;
}

export interface StudyAttempt {
  id: string;
  shortId: string;
  assessmentId: string;
  mode: StudyAssessmentMode;
  status: StudyAttemptStatus;
  score: number | null;
  maxScore: number | null;
  correctCount: number;
  incorrectCount: number;
  omittedCount: number;
  durationSeconds: number;
  startedAt: string;
  submittedAt: string | null;
  config: StudyAttemptConfig;
  answers: StudyAttemptAnswer[];
  assessment?: StudyAssessment;
  createdAt: string;
  updatedAt: string;
}

export interface StudyAttemptAnswerInput {
  assessmentItemId: string;
  response: StudyQuestionResponse;
  responseMs?: number;
  flagged?: boolean;
  confidence?: number | null;
}

export interface StudyAttemptStartInput {
  assessmentId: string;
  mode: StudyAssessmentMode;
  retryKind?: 'all' | 'errors' | 'flagged';
  sourceAttemptId?: string;
}

export const DEFAULT_STUDY_ASSESSMENT_CONFIG: StudyAssessmentConfig = {
  selection: 'manual',
  correctionMode: 'end',
  randomizeQuestions: false,
  randomizeOptions: false,
  showExplanations: true,
  negativePoints: 0,
  blankPoints: 0,
};

function normalize(value: unknown): string {
  return String(value ?? '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function sorted(values: unknown[]): string[] { return values.map(normalize).filter(Boolean).sort(); }

export function isStudyQuestionResponseEmpty(response: StudyQuestionResponse): boolean {
  return !normalize(response.text) && response.value == null && !(response.items?.length) && !(response.pairs?.length);
}

export function formatStudyQuestionExpected(question: StudyQuestion): string {
  if (question.type === 'true_false') return question.answer.value === true ? 'Verdadero' : 'Falso';
  if (['single_choice', 'multiple_choice'].includes(question.type)) return question.options.filter((option) => option.correct).map((option) => option.text).join(', ');
  if (question.type === 'ordering') return (question.answer.items ?? []).join(' → ');
  if (question.type === 'matching') return (question.answer.pairs ?? []).map(([left, right]) => `${left} → ${right}`).join('; ');
  return question.answer.text ?? (Array.isArray(question.answer.value) ? question.answer.value.join(', ') : String(question.answer.value ?? ''));
}

export function evaluateStudyQuestionResponse(
  question: StudyQuestion,
  response: StudyQuestionResponse,
  points: number,
  config: Pick<StudyAssessmentConfig, 'negativePoints' | 'blankPoints'>,
): StudyAnswerEvaluation {
  const omitted = isStudyQuestionResponseEmpty(response);
  const expected = formatStudyQuestionExpected(question);
  if (omitted) return { gradable: true, omitted: true, correct: false, pointsAwarded: config.blankPoints, maxPoints: points, feedback: 'Sin respuesta.', expected };

  let correct: boolean | null = null;
  if (question.type === 'true_false') correct = response.value === question.answer.value;
  else if (question.type === 'single_choice') {
    const correctIds = question.options.filter((option) => option.correct).map((option) => option.id);
    correct = correctIds.length === 1 && normalize(response.value) === normalize(correctIds[0]);
  } else if (question.type === 'multiple_choice') {
    correct = JSON.stringify(sorted(Array.isArray(response.value) ? response.value : [])) === JSON.stringify(sorted(question.options.filter((option) => option.correct).map((option) => option.id)));
  } else if (question.type === 'ordering') correct = JSON.stringify((response.items ?? []).map(normalize)) === JSON.stringify((question.answer.items ?? []).map(normalize));
  else if (question.type === 'matching') {
    const pairs = (value: Array<[string, string]> | undefined) => (value ?? []).map(([left, right]) => `${normalize(left)}::${normalize(right)}`).sort();
    correct = JSON.stringify(pairs(response.pairs)) === JSON.stringify(pairs(question.answer.pairs));
  } else if (['short', 'definition', 'fill_blank'].includes(question.type)) {
    const answer = normalize(response.text ?? response.value);
    const accepted = [question.answer.text, ...(Array.isArray(question.answer.value) ? question.answer.value : [question.answer.value])].map(normalize).filter(Boolean);
    correct = accepted.some((candidate) => candidate === answer);
  }

  if (correct == null) return { gradable: false, omitted: false, correct: null, pointsAwarded: null, maxPoints: points, feedback: 'Pendiente de corrección manual.', expected };
  return {
    gradable: true, omitted: false, correct, pointsAwarded: correct ? points : -Math.abs(config.negativePoints), maxPoints: points,
    feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', expected,
  };
}

export function seededShuffle<T>(values: T[], seed: number): T[] {
  const result = [...values]; let state = (seed >>> 0) || 1;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = result.length - 1; index > 0; index -= 1) { const other = Math.floor(random() * (index + 1)); [result[index], result[other]] = [result[other], result[index]]; }
  return result;
}
