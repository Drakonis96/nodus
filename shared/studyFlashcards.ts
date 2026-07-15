import type { StudySrsState } from './studySrs';

export type StudyFlashcardType = 'front_back' | 'term_definition' | 'image_explanation' | 'cloze';
export interface StudyFlashcard {
  id: string; shortId: string; type: StudyFlashcardType; front: string; back: string; hint: string;
  tags: string[]; courseId: string | null; subjectId: string | null; topicId: string | null;
  documentId: string | null; materialId: string | null; transcriptId: string | null; questionId: string | null;
  sourceExcerpt: string; difficulty: 'easy' | 'medium' | 'hard'; favorite: boolean; position: number;
  archivedAt: string | null; createdAt: string; updatedAt: string; srs: StudySrsState;
}
export interface StudyFlashcardInput {
  type?: StudyFlashcardType; front: string; back: string; hint?: string; tags?: string[];
  courseId?: string | null; subjectId?: string | null; topicId?: string | null; documentId?: string | null;
  materialId?: string | null; transcriptId?: string | null; questionId?: string | null; sourceExcerpt?: string;
  difficulty?: StudyFlashcard['difficulty']; favorite?: boolean;
}
export interface StudyReviewInput { cardId: string; rating: 0 | 1 | 2 | 3 | 4 | 5; confidence?: number; elapsedMs?: number }
export interface StudyReviewRecord { id: string; shortId: string; cardId: string; rating: number; confidence: number | null; correct: boolean; elapsedMs: number; previousIntervalDays: number; nextIntervalDays: number; createdAt: string }

export function validateStudyFlashcard(input: StudyFlashcardInput): string[] {
  const errors: string[] = [];
  if (input.front.trim().length < 2) errors.push('La cara frontal no puede estar vacía.');
  if (input.back.trim().length < 1) errors.push('La respuesta no puede estar vacía.');
  if (input.type === 'cloze' && !/\{\{c\d+::.+?\}\}/.test(input.front)) errors.push('Una tarjeta de huecos necesita una marca {{c1::respuesta}}.');
  return errors;
}

export function clozeStudyFlashcard(front: string): { question: string; answer: string } {
  const answers: string[] = [];
  const question = front.replace(/\{\{c\d+::(.+?)\}\}/g, (_match, answer: string) => { answers.push(answer); return '_____'; });
  return { question, answer: answers.join(' · ') };
}
