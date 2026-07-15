export interface StudyPerformanceEvidence { correct: number; incorrect: number; omitted: number; studySeconds: number; reviews: number; lapses: number }
export interface StudyPerformanceSummary extends StudyPerformanceEvidence { attempts: number; accuracy: number | null; mastery: number; status: 'unrated' | 'problematic' | 'learning' | 'strong' | 'mastered' }
export interface StudyProgressScope extends StudyPerformanceSummary { id: string; name: string; lastActivityAt: string | null }
export interface StudyProgressDashboard { overall: StudyPerformanceSummary; bySubject: StudyProgressScope[]; byTopic: StudyProgressScope[]; dueCards: number; completedGoals: number; totalGoals: number; plannedMinutes: number; actualMinutes: number; recommendations: string[] }

export function summarizeStudyPerformance(evidence: StudyPerformanceEvidence): StudyPerformanceSummary {
  const attempts = evidence.correct + evidence.incorrect + evidence.omitted;
  const accuracy = attempts ? evidence.correct / attempts : null;
  const volume = Math.min(1, (attempts + evidence.reviews) / 20);
  const retention = accuracy ?? (evidence.reviews ? Math.max(0, 1 - evidence.lapses / evidence.reviews) : 0);
  const mastery = Math.round(Math.max(0, Math.min(1, retention * 0.8 + volume * 0.2)) * 100);
  const status = attempts + evidence.reviews === 0 ? 'unrated' : mastery < 35 ? 'problematic' : mastery < 65 ? 'learning' : mastery < 85 ? 'strong' : 'mastered';
  return { ...evidence, attempts, accuracy, mastery, status };
}

export function recommendStudyFocus<T extends { mastery: number; lastActivityAt?: string | null }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.mastery - right.mastery || String(left.lastActivityAt ?? '').localeCompare(String(right.lastActivityAt ?? '')));
}
