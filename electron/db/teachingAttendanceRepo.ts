import crypto from 'node:crypto';
import { getDb } from './database';
import {
  isDayKey,
  normalizeAttendanceStatus,
  type AttendanceHoliday,
  type AttendanceRecord,
  type AttendanceSheet,
  type AttendanceStatus,
} from '@shared/teachingAttendance';
import type { TeachingGroup, TeachingStudent } from '@shared/teachingGroups';
import { getTeachingGroup } from './teachingGroupsRepo';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function day(value: string): string {
  if (!isDayKey(value)) throw new Error(`Invalid day: ${value}`);
  return value;
}

/** Null for a status this build does not know (written by a newer one): it is left
 * out rather than guessed, because reading it as "present" would falsify the totals. */
function toRecord(row: Row): AttendanceRecord | null {
  const status = normalizeAttendanceStatus(row.status);
  if (!status) return null;
  return { studentId: String(row.student_id), date: String(row.date), status, note: String(row.note ?? '') };
}

function toRecords(rows: Row[]): AttendanceRecord[] {
  return rows.map(toRecord).filter((record): record is AttendanceRecord => record !== null);
}

function toHoliday(row: Row): AttendanceHoliday {
  return { groupId: String(row.group_id), date: String(row.date), label: String(row.label ?? '') };
}

function recordsForGroup(groupId: string, from: string, to: string): AttendanceRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT a.* FROM teaching_attendance a
         JOIN teaching_students s ON s.id = a.student_id
        WHERE s.group_id = ? AND a.date BETWEEN ? AND ?
        ORDER BY a.date`,
    )
    .all(groupId, from, to) as Row[];
  return toRecords(rows);
}

function holidaysForGroup(groupId: string, from: string, to: string): AttendanceHoliday[] {
  const rows = getDb()
    .prepare('SELECT * FROM teaching_attendance_holidays WHERE group_id = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(groupId, from, to) as Row[];
  return rows.map(toHoliday);
}

/** Every mark and holiday of a group between two days, both included. */
export function getAttendanceSheet(groupId: string, from: string, to: string): AttendanceSheet {
  const [start, end] = [day(from), day(to)].sort();
  return { records: recordsForGroup(groupId, start, end), holidays: holidaysForGroup(groupId, start, end) };
}

export function setAttendance(input: {
  studentId: string;
  date: string;
  status: AttendanceStatus;
  note?: string;
}): AttendanceRecord {
  const db = getDb();
  const date = day(input.date);
  const status = normalizeAttendanceStatus(input.status);
  if (!status) throw new Error(`Invalid attendance status: ${String(input.status)}`);
  const stamp = now();
  const existing = db
    .prepare('SELECT id FROM teaching_attendance WHERE student_id = ? AND date = ?')
    .get(input.studentId, date) as Row | undefined;
  if (existing) {
    if (input.note === undefined) {
      db.prepare('UPDATE teaching_attendance SET status = ?, updated_at = ? WHERE id = ?').run(status, stamp, existing.id);
    } else {
      db.prepare('UPDATE teaching_attendance SET status = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(status, input.note, stamp, existing.id);
    }
  } else {
    db.prepare(
      `INSERT INTO teaching_attendance (id, student_id, date, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), input.studentId, date, status, input.note ?? '', stamp, stamp);
  }
  const saved = db.prepare('SELECT note FROM teaching_attendance WHERE student_id = ? AND date = ?').get(input.studentId, date) as Row;
  return { studentId: input.studentId, date, status, note: String(saved.note ?? '') };
}

/** Clearing a cell removes the mark and its comment: an empty cell has no row. */
export function clearAttendance(studentId: string, date: string): void {
  getDb().prepare('DELETE FROM teaching_attendance WHERE student_id = ? AND date = ?').run(studentId, day(date));
}

/**
 * "Todos asisten": marks every student with no mark that day. It never overwrites —
 * the point is to fill the column and then correct the exceptions, so a late arrival
 * recorded first must survive it.
 */
export function fillAttendanceDay(groupId: string, date: string, status: AttendanceStatus = 'present'): AttendanceRecord[] {
  const db = getDb();
  const target = day(date);
  const normalized = normalizeAttendanceStatus(status) ?? 'present';
  const stamp = now();
  const empty = db
    .prepare(
      `SELECT s.id FROM teaching_students s
        WHERE s.group_id = ?
          AND NOT EXISTS (SELECT 1 FROM teaching_attendance a WHERE a.student_id = s.id AND a.date = ?)`,
    )
    .all(groupId, target) as Row[];
  const insert = db.prepare(
    `INSERT INTO teaching_attendance (id, student_id, date, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?)`,
  );
  db.transaction(() => {
    for (const row of empty) insert.run(crypto.randomUUID(), String(row.id), target, normalized, stamp, stamp);
  })();
  return recordsForGroup(groupId, target, target);
}

// ── Holidays ─────────────────────────────────────────────────────────────────

/** Idempotent: a group that already has the holiday keeps it (its label is updated). */
export function setAttendanceHoliday(groupIds: string[], date: string, label = ''): void {
  const db = getDb();
  const target = day(date);
  const stamp = now();
  const find = db.prepare('SELECT id FROM teaching_attendance_holidays WHERE group_id = ? AND date = ?');
  const update = db.prepare('UPDATE teaching_attendance_holidays SET label = ?, updated_at = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO teaching_attendance_holidays (id, group_id, date, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const groupId of new Set(groupIds)) {
      const existing = find.get(groupId, target) as Row | undefined;
      if (existing) update.run(label.trim(), stamp, existing.id);
      else insert.run(crypto.randomUUID(), groupId, target, label.trim(), stamp, stamp);
    }
  })();
}

export function clearAttendanceHoliday(groupIds: string[], date: string): void {
  const db = getDb();
  const target = day(date);
  const remove = db.prepare('DELETE FROM teaching_attendance_holidays WHERE group_id = ? AND date = ?');
  db.transaction(() => {
    for (const groupId of new Set(groupIds)) remove.run(groupId, target);
  })();
}

/** Active groups where `date` is already a holiday — drives the propagation dialog. */
export function holidayGroupsOn(date: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT h.group_id FROM teaching_attendance_holidays h
         JOIN teaching_groups g ON g.id = h.group_id
        WHERE h.date = ? AND g.deleted_at IS NULL`,
    )
    .all(day(date)) as Row[];
  return rows.map((row) => String(row.group_id));
}

// ── Export ───────────────────────────────────────────────────────────────────

export interface AttendanceExportData {
  group: TeachingGroup;
  students: TeachingStudent[];
  records: AttendanceRecord[];
  holidays: AttendanceHoliday[];
}

/** Raw rows per group; the renderer turns them into labelled tables. */
export function getAttendanceExportData(request: { groupIds: string[]; from: string; to: string }): AttendanceExportData[] {
  const [start, end] = [day(request.from), day(request.to)].sort();
  const out: AttendanceExportData[] = [];
  for (const groupId of new Set(request.groupIds)) {
    let group: TeachingGroup;
    try {
      group = getTeachingGroup(groupId);
    } catch {
      continue; // deleted since the dialog opened
    }
    out.push({
      group,
      students: group.students ?? [],
      records: recordsForGroup(groupId, start, end),
      holidays: holidaysForGroup(groupId, start, end),
    });
  }
  return out;
}
