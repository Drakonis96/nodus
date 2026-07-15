export type StudyCalendarEventType = 'exam' | 'assignment' | 'class' | 'session';
export interface StudyPlan { id: string; shortId: string; title: string; description: string; courseId: string | null; subjectId: string | null; examAt: string | null; availableMinutes: number; enabled: boolean; config: Record<string, unknown>; archivedAt: string | null; createdAt: string; updatedAt: string }
export interface StudyPlanBlock { id: string; shortId: string; planId: string | null; title: string; type: string; courseId: string | null; subjectId: string | null; topicId: string | null; startsAt: string; durationMinutes: number; status: 'planned' | 'completed' | 'skipped'; priority: number; notes: string; createdAt: string; updatedAt: string }
export interface StudyCalendarEvent { id: string; shortId: string; title: string; type: StudyCalendarEventType; icon: string; emoji: string; description: string; url: string; startsAt: string; endsAt: string | null; allDay: boolean; courseId: string | null; subjectId: string | null; topicId: string | null; notes: string; reminderMinutes: number | null; reminderAt: string | null; notifiedAt: string | null; completed: boolean; createdAt: string; updatedAt: string }
export interface StudyCalendarEventInput { title: string; type?: StudyCalendarEventType; icon?: string; emoji?: string; description?: string; url?: string; startsAt: string; endsAt?: string | null; allDay?: boolean; courseId?: string | null; subjectId?: string | null; topicId?: string | null; notes?: string; reminderMinutes?: number | null; reminderAt?: string | null }
export interface StudyGoal { id: string; shortId: string; title: string; period: 'daily' | 'weekly' | 'monthly'; targetValue: number; currentValue: number; unit: string; startsAt: string; endsAt: string | null; subjectId: string | null; completed: boolean; createdAt: string; updatedAt: string }
export interface StudyStudySession { id: string; shortId: string; planBlockId: string | null; subjectId: string | null; topicId: string | null; mode: string; plannedMinutes: number; actualSeconds: number; interruptions: number; startedAt: string; endedAt: string | null; notes: string; createdAt: string; updatedAt: string }
export interface StudyPlannerSnapshot { plans: StudyPlan[]; blocks: StudyPlanBlock[]; events: StudyCalendarEvent[]; goals: StudyGoal[]; sessions: StudyStudySession[] }

export function distributeStudyBlocks(input: { startsAt: string; examAt: string; totalMinutes: number; topics: Array<{ id: string; title: string; mastery: number }> }): Array<{ topicId: string; title: string; startsAt: string; durationMinutes: number; priority: number }> {
  if (!input.topics.length || input.totalMinutes <= 0) return [];
  const weights = input.topics.map((topic) => Math.max(0.1, 1 - topic.mastery / 100));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const start = new Date(input.startsAt).getTime(); const end = new Date(input.examAt).getTime();
  return input.topics.map((topic, index) => ({
    topicId: topic.id, title: topic.title,
    startsAt: new Date(start + Math.max(0, end - start) * index / Math.max(1, input.topics.length)).toISOString(),
    durationMinutes: Math.max(10, Math.round(input.totalMinutes * weights[index] / totalWeight)),
    priority: Math.round(weights[index] * 100),
  }));
}
