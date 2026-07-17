/**
 * The academic year ("2024/2025") a student or a teacher organizes by.
 *
 * Everything here is pure so the label rules and the "which year is it now?"
 * question can be tested without a database or an Electron window.
 *
 * The canonical label is always derived from the starting calendar year, never
 * stored as typed. Users write the year a dozen ways ("24/25", "2024-25",
 * "2024") and every one of them means the same course; normalizing on the way
 * in is what keeps the unique index — and the year selector — from filling up
 * with duplicates of the same year.
 */

export interface StudyAcademicYear {
  id: string;
  shortId: string;
  /** Canonical `YYYY/YYYY+1`, derived from {@link startYear}. */
  label: string;
  /** Inclusive `YYYY-MM-DD`. Drives which year "today" falls into. */
  startDate: string;
  /** Inclusive `YYYY-MM-DD`. */
  endDate: string;
  color: string | null;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudyAcademicYearInput {
  /** Anything {@link parseAcademicYearStart} accepts. */
  label: string;
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
}

export interface UpdateStudyAcademicYearInput {
  label?: string;
  startDate?: string;
  endDate?: string;
  color?: string | null;
  position?: number;
}

/**
 * The month an academic year starts in. September for Spain and most of Europe;
 * the pure helpers take it as an argument so a January- or April-start calendar
 * is a caller's decision rather than a rewrite.
 */
export const DEFAULT_ACADEMIC_YEAR_START_MONTH = 9;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export function isAcademicYearDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  // Rejects the impossible days a regex happily accepts (2025-02-31): round-tripping
  // through Date normalizes them, so a mismatch means the day never existed.
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Reads the starting calendar year out of whatever the user typed, or null when
 * there is no sensible reading. Accepts `2024/2025`, `2024-2025`, `2024/25`,
 * `24/25`, `2024 25`, and a bare `2024`.
 *
 * Two-digit years are windowed into 2000-2099: a study vault is a record of
 * school years, and nobody is entering 1925 as `25`.
 */
export function parseAcademicYearStart(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2}|\d{4})\s*(?:[/\-–—\s]\s*(\d{2}|\d{4}))?$/.exec(trimmed);
  if (!match) return null;
  const widen = (raw: string) => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));
  const start = widen(match[1]);
  if (!Number.isInteger(start) || start < MIN_YEAR || start > MAX_YEAR) return null;
  if (match[2]) {
    // A stated second half has to be the year right after the first, otherwise the
    // input is a range we would silently redefine ("2024/2030" is not a course).
    const end = widen(match[2]);
    if (end !== start + 1) return null;
  }
  return start;
}

/** `2024` → `2024/2025`. */
export function formatAcademicYearLabel(startYear: number): string {
  return `${startYear}/${startYear + 1}`;
}

/** Canonical label for whatever the user typed, or null when unreadable. */
export function normalizeAcademicYearLabel(value: string): string | null {
  const start = parseAcademicYearStart(value);
  return start == null ? null : formatAcademicYearLabel(start);
}

/**
 * The default span of an academic year: from its start month through the day
 * before that month comes round again. Deliberately generous at both ends —
 * this range decides which year a September orientation day or a late-August
 * resit belongs to, so leaving gaps between consecutive years would strand
 * exactly the dates people care about.
 */
export function defaultAcademicYearRange(
  startYear: number,
  startMonth: number = DEFAULT_ACADEMIC_YEAR_START_MONTH,
): { startDate: string; endDate: string } {
  const month = Math.min(12, Math.max(1, Math.trunc(startMonth)));
  const start = new Date(Date.UTC(startYear, month - 1, 1));
  const end = new Date(Date.UTC(startYear + 1, month - 1, 0));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

/** The label of the academic year a given `YYYY-MM-DD` falls into. */
export function academicYearLabelForDate(
  isoDate: string,
  startMonth: number = DEFAULT_ACADEMIC_YEAR_START_MONTH,
): string {
  const [year, month] = isoDate.split('-').map(Number);
  const boundary = Math.min(12, Math.max(1, Math.trunc(startMonth)));
  return formatAcademicYearLabel(month >= boundary ? year : year - 1);
}

export function nextAcademicYearLabel(label: string): string | null {
  const start = parseAcademicYearStart(label);
  return start == null || start + 1 > MAX_YEAR ? null : formatAcademicYearLabel(start + 1);
}

export function previousAcademicYearLabel(label: string): string | null {
  const start = parseAcademicYearStart(label);
  return start == null || start - 1 < MIN_YEAR ? null : formatAcademicYearLabel(start - 1);
}

/**
 * The year to preselect. Derived from the dates rather than a stored "current"
 * flag, because a flag is right the day it is set and wrong every September
 * after — nobody remembers to move it, and a stale one silently files new work
 * under last year.
 *
 * Falls back to the most recent year that has already started, so a vault whose
 * years all lie in the past still opens on the newest one instead of nothing.
 */
export function pickCurrentAcademicYear<T extends { startDate: string; endDate: string }>(
  years: readonly T[],
  today: string,
): T | null {
  const usable = years.filter((year) => isAcademicYearDate(year.startDate) && isAcademicYearDate(year.endDate));
  if (!usable.length) return null;
  const containing = usable.filter((year) => year.startDate <= today && today <= year.endDate);
  if (containing.length) {
    // Overlapping ranges are legal (a user may keep a custom calendar); the one
    // that started most recently is the one they are living in.
    return containing.reduce((best, year) => (year.startDate > best.startDate ? year : best));
  }
  const started = usable.filter((year) => year.startDate <= today);
  const pool = started.length ? started : usable;
  return pool.reduce((best, year) => (year.startDate > best.startDate ? year : best));
}

/**
 * The academic year a subject actually belongs to: its own when set, otherwise
 * the one its course carries.
 *
 * The inheritance is what lets one column serve both real shapes. A school
 * course *is* a year ("3º ESO A", 2024/2025) so the year lives on the course and
 * every subject under it follows. A degree spans years ("Grado en Historia") so
 * the course stays open and each subject states its own.
 */
export function effectiveAcademicYearId(
  subject: { academicYearId: string | null; courseId: string },
  courses: readonly { id: string; academicYearId: string | null }[],
): string | null {
  if (subject.academicYearId) return subject.academicYearId;
  return courses.find((course) => course.id === subject.courseId)?.academicYearId ?? null;
}

export function sortAcademicYears<T extends { startDate: string; label: string }>(years: readonly T[]): T[] {
  return [...years].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.label.localeCompare(a.label));
}
