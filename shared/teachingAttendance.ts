/**
 * Attendance (teaching vault) — shared shapes and pure helpers.
 *
 * Days are LOCAL calendar days keyed `YYYY-MM-DD`. Every Date built here sits at
 * noon, so adding a day across a daylight-saving change can never land on the day
 * before or after — the classic bug of `toISOString().slice(0, 10)`, which reads the
 * UTC date and shifts every evening entry in Europe by one.
 *
 * No user-facing labels live here: the renderer passes them in (see
 * {@link AttendanceExportLabels}) so every string stays a literal `t('…')` call.
 */

export const ATTENDANCE_STATUSES = ['present', 'justified', 'unjustified', 'late'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceRecord {
  studentId: string;
  date: string;
  status: AttendanceStatus;
  note: string;
}

export interface AttendanceHoliday {
  groupId: string;
  date: string;
  label: string;
}

export interface AttendanceSheet {
  records: AttendanceRecord[];
  holidays: AttendanceHoliday[];
}

export function normalizeAttendanceStatus(value: unknown): AttendanceStatus | null {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value as string) ? (value as AttendanceStatus) : null;
}

// ── Local days ───────────────────────────────────────────────────────────────

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a well-formed key naming a real day (`2025-02-30` is not one). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return toDayKey(date) === value;
}

export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Noon of the day, so arithmetic on it never crosses midnight on a DST change. */
export function parseDayKey(key: string): Date {
  const match = DAY_KEY.exec(key);
  if (!match) throw new Error(`Invalid day: ${key}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function addDays(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

export function addMonths(key: string, months: number): string {
  const date = parseDayKey(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  // Clamp: one month after 31 January is the end of February, not 3 March.
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
  date.setDate(Math.min(day, last));
  return toDayKey(date);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  return (parseDayKey(key).getDay() + 6) % 7;
}

export function isWeekend(key: string): boolean {
  return weekdayIndex(key) >= 5;
}

export function mondayOf(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

/** Monday to Friday, or Monday to Sunday. */
export function weekDays(anchor: string, includeWeekend: boolean): string[] {
  const monday = mondayOf(anchor);
  return Array.from({ length: includeWeekend ? 7 : 5 }, (_, i) => addDays(monday, i));
}

export function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function monthEnd(key: string): string {
  const date = parseDayKey(monthStart(key));
  return toDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
}

/** Every day of the anchor's month, weekends included. */
export function monthDays(anchor: string): string[] {
  return dayRange(monthStart(anchor), monthEnd(anchor));
}

/** Upper bound on a range: a school year is ~300 days, a typo like 2205 is not. */
export const MAX_RANGE_DAYS = 800;

/** Inclusive on both ends. An inverted range is swapped rather than empty. */
export function dayRange(from: string, to: string): string[] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const days: string[] = [];
  for (let day = start; day <= end && days.length < MAX_RANGE_DAYS; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Keeps `day` inside `[min, max]`, either bound optional. */
export function clampDay(day: string, min?: string | null, max?: string | null): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface AttendanceSummary {
  present: number;
  justified: number;
  unjustified: number;
  late: number;
  /** Days with a mark, holidays excluded. */
  recorded: number;
  /** (present + late) / recorded, or null when nothing is recorded yet. */
  rate: number | null;
}

export function emptySummary(): AttendanceSummary {
  return { present: 0, justified: 0, unjustified: 0, late: 0, recorded: 0, rate: null };
}

/**
 * Per-student counts over `days`. A blank cell counts for nothing (it means "not
 * recorded", not "present"), and a mark under a holiday is hidden, not counted.
 */
export function summarizeAttendance(
  records: AttendanceRecord[],
  holidayDates: Iterable<string>,
  days: string[],
): Map<string, AttendanceSummary> {
  const inRange = new Set(days);
  const holidays = new Set(holidayDates);
  const out = new Map<string, AttendanceSummary>();
  for (const record of records) {
    if (!inRange.has(record.date) || holidays.has(record.date)) continue;
    const summary = out.get(record.studentId) ?? emptySummary();
    summary[record.status] += 1;
    summary.recorded += 1;
    out.set(record.studentId, summary);
  }
  for (const summary of out.values()) {
    summary.rate = summary.recorded ? (summary.present + summary.late) / summary.recorded : null;
  }
  return out;
}

// ── Holiday propagation ──────────────────────────────────────────────────────

interface CandidateGroup {
  id: string;
  academicYearId: string | null;
}

interface CandidateYear {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * The other groups a holiday can sensibly be copied to: those whose academic year
 * contains the day, plus those with no year (or a year that no longer exists). A
 * holiday on 12 October 2025 means nothing to a 2024/2025 class.
 */
export function holidayCandidates<G extends CandidateGroup>(
  groups: G[],
  years: CandidateYear[],
  date: string,
  currentGroupId: string,
): G[] {
  const byId = new Map(years.map((year) => [year.id, year]));
  return groups.filter((group) => {
    if (group.id === currentGroupId) return false;
    const year = group.academicYearId ? byId.get(group.academicYearId) : undefined;
    return !year || (year.startDate <= date && date <= year.endDate);
  });
}

// ── Export ───────────────────────────────────────────────────────────────────

export interface AttendanceExportStudent {
  id: string;
  code: string;
  name: string;
}

export interface AttendanceExportGroup {
  groupName: string;
  courseName: string;
  subjectName: string;
  students: AttendanceExportStudent[];
  records: AttendanceRecord[];
  holidays: AttendanceHoliday[];
}

/** Every string the export prints, supplied by the renderer in the interface language. */
export interface AttendanceExportLabels {
  course: string;
  subject: string;
  group: string;
  code: string;
  student: string;
  present: string;
  justified: string;
  unjustified: string;
  late: string;
  recorded: string;
  rate: string;
  summarySheet: string;
  holidayCode: string;
  codes: Record<AttendanceStatus, string>;
  formatDay: (day: string) => string;
}

export interface AttendanceExportOptions {
  days: string[];
  layout: 'detail' | 'summary';
  /** Drop the name column: the identifier alone is enough outside the school. */
  pseudonymOnly: boolean;
  /** Restrict to one student (their group's sheet only). */
  studentId?: string | null;
  labels: AttendanceExportLabels;
}

export type ExportValue = string | number;

export interface ExportTable {
  name: string;
  header: string[];
  rows: ExportValue[][];
}

export interface AttendanceExportTables {
  /** One per group (plus a summary sheet when several groups are detailed) — XLSX. */
  sheets: ExportTable[];
  /** Everything in one table with the group columns up front — CSV. */
  flat: ExportTable;
}

const SHEET_FORBIDDEN = /[[\]:*?/\\]/g;
const SHEET_MAX = 31;

/** Excel's rules: ≤31 characters, none of `[]:*?/\`, unique ignoring case. */
export function sanitizeSheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(SHEET_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, SHEET_MAX);
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, SHEET_MAX - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

function ratePercent(rate: number | null): ExportValue {
  return rate === null ? '' : Math.round(rate * 1000) / 10;
}

export function buildAttendanceExport(
  groups: AttendanceExportGroup[],
  options: AttendanceExportOptions,
): AttendanceExportTables {
  const { labels, days } = options;
  const detail = options.layout === 'detail';
  const who = options.pseudonymOnly ? [labels.code] : [labels.code, labels.student];
  const totalsHeader = [labels.present, labels.justified, labels.unjustified, labels.late, labels.recorded, labels.rate];
  const dayHeader = detail ? days.map(labels.formatDay) : [];
  const groupHeader = [labels.course, labels.subject, labels.group];

  const taken = new Set<string>();
  const sheets: ExportTable[] = [];
  const flatRows: ExportValue[][] = [];
  const summaryRows: ExportValue[][] = [];

  for (const group of groups) {
    const students = options.studentId
      ? group.students.filter((student) => student.id === options.studentId)
      : group.students;
    if (!students.length) continue;

    const holidayDates = new Set(group.holidays.map((holiday) => holiday.date));
    const summaries = summarizeAttendance(group.records, holidayDates, days);
    const byCell = new Map(group.records.map((record) => [`${record.studentId}|${record.date}`, record]));
    const rows: ExportValue[][] = [];

    for (const student of students) {
      const identity = options.pseudonymOnly ? [student.code] : [student.code, student.name];
      const cells = detail
        ? days.map((day) => {
            if (holidayDates.has(day)) return labels.holidayCode;
            const record = byCell.get(`${student.id}|${day}`);
            if (!record) return '';
            const code = labels.codes[record.status];
            return record.note.trim() ? `${code} (${record.note.trim()})` : code;
          })
        : [];
      const s = summaries.get(student.id) ?? emptySummary();
      const totals: ExportValue[] = [s.present, s.justified, s.unjustified, s.late, s.recorded, ratePercent(s.rate)];
      rows.push([...identity, ...cells, ...totals]);
      flatRows.push([group.courseName, group.subjectName, group.groupName, ...identity, ...cells, ...totals]);
      summaryRows.push([group.courseName, group.subjectName, group.groupName, ...identity, ...totals]);
    }

    sheets.push({ name: sanitizeSheetName(group.groupName, taken), header: [...who, ...dayHeader, ...totalsHeader], rows });
  }

  if (detail && sheets.length > 1) {
    sheets.push({
      name: sanitizeSheetName(labels.summarySheet, taken),
      header: [...groupHeader, ...who, ...totalsHeader],
      rows: summaryRows,
    });
  }

  return {
    sheets,
    flat: { name: labels.summarySheet, header: [...groupHeader, ...who, ...dayHeader, ...totalsHeader], rows: flatRows },
  };
}
