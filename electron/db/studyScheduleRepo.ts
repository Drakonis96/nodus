import crypto from 'node:crypto';
import type { StudySchedule, StudyScheduleCell, StudyScheduleDay, StudySchedulePeriod } from '@shared/studySchedule';
import { STUDY_SCHEDULE_DAYS } from '@shared/studySchedule';
import { getDb } from './database';

type Row = Record<string, unknown>;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * There is one timetable per academic year, plus an unscoped one (`null`) that
 * holds what vaults had before academic years existed.
 *
 * Every statement here is scoped by the year — `saveStudySchedule` clears before
 * it writes, and an unscoped DELETE would take every other year's grid with it.
 * `academic_year_id IS ?` rather than `= ?` because the unscoped timetable is a
 * NULL and `= NULL` matches nothing.
 */
function scope(academicYearId: string | null): { clause: string; value: string | null } {
  return { clause: 'academic_year_id IS ?', value: academicYearId ?? null };
}

function assertAcademicYearExists(academicYearId: string | null): void {
  if (!academicYearId) return;
  if (!getDb().prepare('SELECT 1 FROM study_academic_years WHERE id = ? AND deleted_at IS NULL').get(academicYearId)) {
    throw new Error('El curso académico seleccionado no existe.');
  }
}

function ensureDefaults(academicYearId: string | null): void {
  const db = getDb();
  const { clause, value } = scope(academicYearId);
  if (Number((db.prepare(`SELECT COUNT(*) value FROM study_schedule_periods WHERE ${clause}`).get(value) as Row).value) > 0) return;
  const insert = db.prepare('INSERT INTO study_schedule_periods (id, section, label, start_time, end_time, position, academic_year_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    insert.run(crypto.randomUUID(), 'morning', 'Mañana', '09:00', '13:00', 0, value);
    insert.run(crypto.randomUUID(), 'afternoon', 'Tarde', '15:00', '18:00', 0, value);
  })();
}

function period(row: Row): StudySchedulePeriod {
  return { id: String(row.id), section: String(row.section) as StudySchedulePeriod['section'], label: String(row.label), startTime: String(row.start_time), endTime: String(row.end_time), position: Number(row.position) };
}

export function getStudySchedule(academicYearId: string | null = null): StudySchedule {
  assertAcademicYearExists(academicYearId);
  ensureDefaults(academicYearId);
  const db = getDb();
  const { clause, value } = scope(academicYearId);
  const periods = (db.prepare(`SELECT * FROM study_schedule_periods WHERE ${clause} ORDER BY CASE section WHEN 'morning' THEN 0 ELSE 1 END, position, start_time`).all(value) as Row[]).map(period);
  const periodIds = new Set(periods.map((item) => item.id));
  const cells = (db.prepare('SELECT day, period_id, subject_id, activity_title FROM study_schedule_cells').all() as Row[])
    // Cells have no year of their own; they belong to whichever year owns their period.
    .filter((row) => periodIds.has(String(row.period_id)))
    .map((row): StudyScheduleCell => ({ day: String(row.day) as StudyScheduleDay, periodId: String(row.period_id), subjectId: row.subject_id ? String(row.subject_id) : null, activityTitle: row.activity_title ? String(row.activity_title) : null }));
  const dayColors = Object.fromEntries(STUDY_SCHEDULE_DAYS.map((day) => [day, null])) as StudySchedule['dayColors'];
  for (const row of db.prepare(`SELECT day, color FROM study_schedule_day_styles WHERE ${clause}`).all(value) as Row[]) {
    dayColors[String(row.day) as StudyScheduleDay] = row.color ? String(row.color) : null;
  }
  return { academicYearId, periods, cells, dayColors };
}

export function saveStudySchedule(input: StudySchedule): StudySchedule {
  const academicYearId = input.academicYearId ?? null;
  assertAcademicYearExists(academicYearId);
  const periodIds = new Set<string>();
  for (const item of input.periods) {
    if (!item.id || periodIds.has(item.id)) throw new Error('Las franjas deben tener identificadores únicos.');
    if (!['morning', 'afternoon'].includes(item.section)) throw new Error('Sección de horario no válida.');
    if (!TIME.test(item.startTime) || !TIME.test(item.endTime) || item.startTime >= item.endTime) throw new Error('Revisa las horas de inicio y fin.');
    periodIds.add(item.id);
  }
  const db = getDb();
  const { clause, value } = scope(academicYearId);
  // A period id belonging to another year would be silently re-homed by the insert
  // below, moving a row out of a timetable the caller never asked to touch.
  const foreign = input.periods.filter((item) => {
    const row = db.prepare('SELECT academic_year_id FROM study_schedule_periods WHERE id = ?').get(item.id) as Row | undefined;
    return row && (row.academic_year_id ? String(row.academic_year_id) : null) !== academicYearId;
  });
  if (foreign.length) throw new Error('Una franja pertenece a otro curso académico.');
  const subjectIds = new Set((db.prepare('SELECT id FROM study_subjects WHERE deleted_at IS NULL').all() as Row[]).map((row) => String(row.id)));
  for (const cell of input.cells) {
    if (!STUDY_SCHEDULE_DAYS.includes(cell.day) || !periodIds.has(cell.periodId)) throw new Error('Celda de horario no válida.');
    if (cell.subjectId && !subjectIds.has(cell.subjectId)) throw new Error('La asignatura seleccionada ya no está disponible.');
    if (cell.subjectId && cell.activityTitle?.trim()) throw new Error('Una celda no puede contener una asignatura y una actividad a la vez.');
    if (cell.activityTitle && cell.activityTitle.trim().length > 160) throw new Error('El nombre de la actividad es demasiado largo.');
  }
  const insertPeriod = db.prepare('INSERT INTO study_schedule_periods (id, section, label, start_time, end_time, position, academic_year_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertCell = db.prepare('INSERT INTO study_schedule_cells (day, period_id, subject_id, activity_title) VALUES (?, ?, ?, ?)');
  const insertColor = db.prepare('INSERT INTO study_schedule_day_styles (day, academic_year_id, color) VALUES (?, ?, ?)');
  db.transaction(() => {
    // Cells cascade from their period, so clearing this year's periods clears this
    // year's cells; the explicit DELETE keeps that true even if the FK is off.
    db.prepare(`DELETE FROM study_schedule_cells WHERE period_id IN (SELECT id FROM study_schedule_periods WHERE ${clause})`).run(value);
    db.prepare(`DELETE FROM study_schedule_periods WHERE ${clause}`).run(value);
    db.prepare(`DELETE FROM study_schedule_day_styles WHERE ${clause}`).run(value);
    input.periods.forEach((item, index) => insertPeriod.run(item.id, item.section, item.label.trim() || (item.section === 'morning' ? 'Mañana' : 'Tarde'), item.startTime, item.endTime, Number.isFinite(item.position) ? item.position : index, value));
    input.cells.filter((cell) => cell.subjectId || cell.activityTitle?.trim()).forEach((cell) => insertCell.run(cell.day, cell.periodId, cell.subjectId, cell.activityTitle?.trim() || null));
    STUDY_SCHEDULE_DAYS.forEach((day) => { const color = input.dayColors[day]; if (color && COLOR.test(color)) insertColor.run(day, value, color.toLowerCase()); });
  })();
  return getStudySchedule(academicYearId);
}

/**
 * Copies a whole timetable onto another academic year, replacing whatever was
 * there. This is the September shortcut: most timetables are last year's with a
 * few cells moved, and retyping the grid is the reason people keep it in a
 * spreadsheet instead.
 *
 * Periods are re-created with fresh ids rather than reused, so editing the copy
 * cannot reach back and rewrite the year it came from.
 */
export function copyStudySchedule(fromAcademicYearId: string | null, toAcademicYearId: string | null): StudySchedule {
  if (fromAcademicYearId === toAcademicYearId) throw new Error('Elige un curso académico de destino distinto.');
  assertAcademicYearExists(fromAcademicYearId);
  assertAcademicYearExists(toAcademicYearId);
  const source = getStudySchedule(fromAcademicYearId);
  const remap = new Map(source.periods.map((item) => [item.id, crypto.randomUUID()]));
  return saveStudySchedule({
    academicYearId: toAcademicYearId,
    periods: source.periods.map((item) => ({ ...item, id: remap.get(item.id)! })),
    cells: source.cells.map((cell) => ({ ...cell, periodId: remap.get(cell.periodId)! })),
    dayColors: source.dayColors,
  });
}
