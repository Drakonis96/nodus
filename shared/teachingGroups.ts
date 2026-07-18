/**
 * Student groups (teaching vault) — shared shapes.
 *
 * A group is one subject's class list for one academic year. Deliberately NOT a
 * shared roster across subjects: the per-student comment is subject-scoped, so
 * sharing the list would mean splitting identity from annotation to save typing —
 * which `importStudentsFromGroup` solves without the extra table.
 *
 * Pure types and helpers only: no user-facing labels live here, so the renderer keeps
 * every translatable string inline in `t('…')` where the i18n coverage test can see it.
 */

export interface TeachingStudent {
  id: string;
  groupId: string;
  givenNames: string;
  surnames: string;
  comments: string;
  /** Opaque `STU_XXXX` shown to AI models in place of the name. */
  pseudonymCode: string;
  position: number;
}

export interface TeachingGroup {
  id: string;
  shortId: string;
  name: string;
  subjectId: string;
  academicYearId: string | null;
  /** How many students the teacher declared up front; blank rows are pre-created once. */
  expectedSize: number;
  position: number;
  createdAt: string;
  updatedAt: string;
  /** Present on detail reads, absent on list reads. */
  students?: TeachingStudent[];
  studentCount?: number;
}

export interface TeachingGroupInput {
  name: string;
  subjectId: string;
  academicYearId?: string | null;
  expectedSize?: number;
}

/** Blank rows are capped so a mistyped "300" cannot lock up the grid. */
export const MAX_GROUP_SIZE = 200;

export function clampExpectedSize(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_GROUP_SIZE);
}

export function studentFullName(student: Pick<TeachingStudent, 'givenNames' | 'surnames'>): string {
  return [student.givenNames.trim(), student.surnames.trim()].filter(Boolean).join(' ');
}

/** True once a row carries anything worth keeping — used to skip blank pre-created rows. */
export function isStudentFilled(student: Pick<TeachingStudent, 'givenNames' | 'surnames' | 'comments'>): boolean {
  return Boolean(student.givenNames.trim() || student.surnames.trim() || student.comments.trim());
}
