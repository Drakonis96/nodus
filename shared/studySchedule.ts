export const STUDY_SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
export type StudyScheduleDay = (typeof STUDY_SCHEDULE_DAYS)[number];
export type StudyScheduleSection = 'morning' | 'afternoon';

export interface StudySchedulePeriod {
  id: string;
  section: StudyScheduleSection;
  label: string;
  startTime: string;
  endTime: string;
  position: number;
}

export interface StudyScheduleCell {
  day: StudyScheduleDay;
  periodId: string;
  subjectId: string | null;
  activityTitle: string | null;
}

export interface StudySchedule {
  periods: StudySchedulePeriod[];
  cells: StudyScheduleCell[];
  dayColors: Record<StudyScheduleDay, string | null>;
}
