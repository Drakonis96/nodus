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
  /**
   * The academic year this grid belongs to. `null` is the unscoped timetable —
   * where vaults that predate academic years keep theirs, and where a user who
   * never defines a year keeps working.
   */
  academicYearId: string | null;
  periods: StudySchedulePeriod[];
  cells: StudyScheduleCell[];
  dayColors: Record<StudyScheduleDay, string | null>;
}
