export type StudySrsRating = 0 | 1 | 2 | 3 | 4 | 5;

export interface StudySrsState {
  easeFactor: number;
  intervalDays: number;
  dueAt: string;
  repetitions: number;
  lapses: number;
  lastRating: StudySrsRating | null;
  lastReviewedAt: string | null;
  confidence: number | null;
  mastered: boolean;
  excluded: boolean;
}

export interface StudySrsReviewResult extends StudySrsState {
  correct: boolean;
  previousIntervalDays: number;
}

export function initialStudySrsState(now = new Date()): StudySrsState {
  return { easeFactor: 2.5, intervalDays: 0, dueAt: now.toISOString(), repetitions: 0, lapses: 0, lastRating: null, lastReviewedAt: null, confidence: null, mastered: false, excluded: false };
}

export function scheduleStudySrsReview(state: StudySrsState, rating: StudySrsRating, reviewedAt = new Date(), confidence?: number): StudySrsReviewResult {
  const previousIntervalDays = state.intervalDays;
  const correct = rating >= 3;
  const repetitions = correct ? state.repetitions + 1 : 0;
  const lapses = state.lapses + (correct ? 0 : 1);
  const easeFactor = Math.max(1.3, state.easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02)));
  let intervalDays: number;
  if (!correct) intervalDays = rating <= 1 ? 0.04 : 1;
  else if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.max(1, Math.round(previousIntervalDays * easeFactor));
  if (confidence != null && confidence <= 2 && correct) intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
  const dueAt = new Date(reviewedAt.getTime() + intervalDays * 86_400_000).toISOString();
  return { ...state, easeFactor, intervalDays, dueAt, repetitions, lapses, lastRating: rating, lastReviewedAt: reviewedAt.toISOString(), confidence: confidence ?? state.confidence, mastered: state.mastered || (repetitions >= 5 && intervalDays >= 30), correct, previousIntervalDays };
}

export function studySrsPriority(state: StudySrsState, now = new Date(), examAt?: Date | null): number {
  if (state.excluded || state.mastered) return -Infinity;
  const overdueDays = Math.max(0, (now.getTime() - new Date(state.dueAt).getTime()) / 86_400_000);
  const examBoost = examAt ? Math.max(0, 14 - (examAt.getTime() - now.getTime()) / 86_400_000) : 0;
  return overdueDays * 4 + state.lapses * 2 + (state.confidence == null ? 1 : Math.max(0, 4 - state.confidence)) + examBoost;
}
