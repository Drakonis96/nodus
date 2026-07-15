import crypto from 'node:crypto';
import type { StudySchedule, StudyScheduleCell, StudyScheduleDay, StudySchedulePeriod } from '@shared/studySchedule';
import { STUDY_SCHEDULE_DAYS } from '@shared/studySchedule';
import { getDb } from './database';

type Row = Record<string, unknown>;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;

function ensureDefaults(): void {
  const db = getDb();
  if (Number((db.prepare('SELECT COUNT(*) value FROM study_schedule_periods').get() as Row).value) > 0) return;
  const insert = db.prepare('INSERT INTO study_schedule_periods (id, section, label, start_time, end_time, position) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    insert.run(crypto.randomUUID(), 'morning', 'Mañana', '09:00', '13:00', 0);
    insert.run(crypto.randomUUID(), 'afternoon', 'Tarde', '15:00', '18:00', 0);
  })();
}

function period(row: Row): StudySchedulePeriod {
  return { id: String(row.id), section: String(row.section) as StudySchedulePeriod['section'], label: String(row.label), startTime: String(row.start_time), endTime: String(row.end_time), position: Number(row.position) };
}

export function getStudySchedule(): StudySchedule {
  ensureDefaults();
  const db = getDb();
  const periods = (db.prepare("SELECT * FROM study_schedule_periods ORDER BY CASE section WHEN 'morning' THEN 0 ELSE 1 END, position, start_time").all() as Row[]).map(period);
  const cells = (db.prepare('SELECT day, period_id, subject_id, activity_title FROM study_schedule_cells').all() as Row[]).map((row): StudyScheduleCell => ({ day: String(row.day) as StudyScheduleDay, periodId: String(row.period_id), subjectId: row.subject_id ? String(row.subject_id) : null, activityTitle: row.activity_title ? String(row.activity_title) : null }));
  const dayColors = Object.fromEntries(STUDY_SCHEDULE_DAYS.map((day) => [day, null])) as StudySchedule['dayColors'];
  for (const row of db.prepare('SELECT day, color FROM study_schedule_day_styles').all() as Row[]) dayColors[String(row.day) as StudyScheduleDay] = row.color ? String(row.color) : null;
  return { periods, cells, dayColors };
}

export function saveStudySchedule(input: StudySchedule): StudySchedule {
  const periodIds = new Set<string>();
  for (const item of input.periods) {
    if (!item.id || periodIds.has(item.id)) throw new Error('Las franjas deben tener identificadores únicos.');
    if (!['morning', 'afternoon'].includes(item.section)) throw new Error('Sección de horario no válida.');
    if (!TIME.test(item.startTime) || !TIME.test(item.endTime) || item.startTime >= item.endTime) throw new Error('Revisa las horas de inicio y fin.');
    periodIds.add(item.id);
  }
  const db = getDb();
  const subjectIds = new Set((db.prepare('SELECT id FROM study_subjects WHERE deleted_at IS NULL').all() as Row[]).map((row) => String(row.id)));
  for (const cell of input.cells) {
    if (!STUDY_SCHEDULE_DAYS.includes(cell.day) || !periodIds.has(cell.periodId)) throw new Error('Celda de horario no válida.');
    if (cell.subjectId && !subjectIds.has(cell.subjectId)) throw new Error('La asignatura seleccionada ya no está disponible.');
    if (cell.subjectId && cell.activityTitle?.trim()) throw new Error('Una celda no puede contener una asignatura y una actividad a la vez.');
    if (cell.activityTitle && cell.activityTitle.trim().length > 160) throw new Error('El nombre de la actividad es demasiado largo.');
  }
  const insertPeriod = db.prepare('INSERT INTO study_schedule_periods (id, section, label, start_time, end_time, position) VALUES (?, ?, ?, ?, ?, ?)');
  const insertCell = db.prepare('INSERT INTO study_schedule_cells (day, period_id, subject_id, activity_title) VALUES (?, ?, ?, ?)');
  const insertColor = db.prepare('INSERT INTO study_schedule_day_styles (day, color) VALUES (?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM study_schedule_cells').run();
    db.prepare('DELETE FROM study_schedule_periods').run();
    db.prepare('DELETE FROM study_schedule_day_styles').run();
    input.periods.forEach((item, index) => insertPeriod.run(item.id, item.section, item.label.trim() || (item.section === 'morning' ? 'Mañana' : 'Tarde'), item.startTime, item.endTime, Number.isFinite(item.position) ? item.position : index));
    input.cells.filter((cell) => cell.subjectId || cell.activityTitle?.trim()).forEach((cell) => insertCell.run(cell.day, cell.periodId, cell.subjectId, cell.activityTitle?.trim() || null));
    STUDY_SCHEDULE_DAYS.forEach((day) => { const color = input.dayColors[day]; if (color && COLOR.test(color)) insertColor.run(day, color.toLowerCase()); });
  })();
  return getStudySchedule();
}
