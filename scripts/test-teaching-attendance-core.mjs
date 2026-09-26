// Attendance (teaching vault): the pure core.
//
// Two properties carry the feature. Days are LOCAL calendar days — a key derived from
// UTC shifts every evening entry in Europe by one, and a week built by adding 24 h
// loses or repeats a day across a DST change — so the date assertions re-run under
// two real time zones with DST, one per hemisphere. And a blank cell means "not
// recorded": the summary must neither count it nor count a mark hidden by a holiday.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(self), '..');

if (!process.env.ATTENDANCE_TZ_CHILD) {
  for (const tz of ['Europe/Madrid', 'Pacific/Auckland']) {
    execFileSync(process.execPath, [self], { env: { ...process.env, TZ: tz, ATTENDANCE_TZ_CHILD: '1' }, stdio: 'inherit' });
  }
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-attendance-core-'));
try {
  const outfile = path.join(tmp, 'teachingAttendance.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/teachingAttendance.ts')],
    outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const A = await import(pathToFileURL(outfile).href);
  const tz = process.env.TZ || 'local';

  // ── Keys ───────────────────────────────────────────────────────────────────
  assert.equal(A.toDayKey(new Date(2025, 9, 12, 23, 30)), '2025-10-12', `[${tz}] a late evening stays on its own day`);
  assert.equal(A.toDayKey(new Date(2025, 9, 12, 0, 5)), '2025-10-12', `[${tz}] so does just after midnight`);
  assert.ok(A.isDayKey('2024-02-29'));
  assert.ok(!A.isDayKey('2025-02-29'), 'a day that does not exist is not a key');
  assert.ok(!A.isDayKey('2025-2-3'));
  assert.ok(!A.isDayKey(20250203));

  // ── DST: Europe changes on the last Sunday of March and October; NZ in April and September.
  for (const [from, days, expected] of [
    ['2025-03-29', 3, '2025-04-01'],
    ['2025-10-25', 3, '2025-10-28'],
    ['2025-04-05', 2, '2025-04-07'],
    ['2025-09-27', 2, '2025-09-29'],
  ]) {
    assert.equal(A.addDays(from, days), expected, `[${tz}] adding days across a DST change lands on ${expected}`);
  }
  const acrossDst = A.dayRange('2025-10-20', '2025-11-02');
  assert.equal(acrossDst.length, 14, `[${tz}] no day lost or repeated across the October change`);
  assert.equal(new Set(acrossDst).size, 14);

  // ── Weeks ──────────────────────────────────────────────────────────────────
  assert.deepEqual(A.weekDays('2025-09-24', false),
    ['2025-09-22', '2025-09-23', '2025-09-24', '2025-09-25', '2025-09-26'], 'a week is Monday to Friday by default');
  assert.deepEqual(A.weekDays('2025-09-28', true),
    ['2025-09-22', '2025-09-23', '2025-09-24', '2025-09-25', '2025-09-26', '2025-09-27', '2025-09-28'],
    'Sunday belongs to the week that started on the Monday before it');
  assert.equal(A.mondayOf('2025-03-30'), '2025-03-24', `[${tz}] the DST Sunday still finds its Monday`);
  assert.ok(A.isWeekend('2025-09-27') && A.isWeekend('2025-09-28') && !A.isWeekend('2025-09-26'));

  // ── Months ─────────────────────────────────────────────────────────────────
  assert.equal(A.monthDays('2025-02-10').length, 28);
  assert.equal(A.monthDays('2024-02-10').length, 29, 'leap February');
  assert.equal(A.monthDays('2025-04-30').length, 30);
  assert.equal(A.monthDays('2025-10-01').length, 31, `[${tz}] October has 31 days even with the DST change inside it`);
  assert.equal(A.monthDays('2025-10-01').at(-1), '2025-10-31');
  assert.equal(A.addMonths('2025-01-31', 1), '2025-02-28', 'one month after 31 January is the end of February');
  assert.equal(A.addMonths('2025-12-15', 1), '2026-01-15');
  assert.equal(A.addMonths('2026-01-15', -1), '2025-12-15');

  assert.deepEqual(A.dayRange('2025-09-03', '2025-09-01'), ['2025-09-01', '2025-09-02', '2025-09-03'], 'an inverted range is swapped');
  assert.equal(A.dayRange('2000-01-01', '2099-01-01').length, A.MAX_RANGE_DAYS, 'a typo cannot build a century of columns');
  assert.equal(A.clampDay('2025-08-01', '2025-09-01', '2026-06-30'), '2025-09-01');
  assert.equal(A.clampDay('2026-07-15', '2025-09-01', '2026-06-30'), '2026-06-30');
  assert.equal(A.clampDay('2025-10-01', null, null), '2025-10-01');

  // The checks below do not depend on the time zone.
  if (process.env.ATTENDANCE_TZ_CHILD) process.exit(0);

  // ── Status ─────────────────────────────────────────────────────────────────
  assert.deepEqual([...A.ATTENDANCE_STATUSES], ['present', 'justified', 'unjustified', 'late']);
  assert.equal(A.normalizeAttendanceStatus('late'), 'late');
  assert.equal(A.normalizeAttendanceStatus('absent'), null);

  // ── Summary ────────────────────────────────────────────────────────────────
  const rec = (studentId, date, status, note = '') => ({ studentId, date, status, note });
  const week = A.weekDays('2025-10-08', false); // 6–10 October 2025
  const records = [
    rec('s1', '2025-10-06', 'present'),
    rec('s1', '2025-10-07', 'late'),
    rec('s1', '2025-10-08', 'unjustified'),
    rec('s1', '2025-10-09', 'justified'),
    rec('s1', '2025-10-10', 'present'), // hidden under the holiday below
    rec('s1', '2025-10-13', 'unjustified'), // outside the week
    rec('s2', '2025-10-06', 'present'),
  ];
  const summary = A.summarizeAttendance(records, ['2025-10-10'], week);
  assert.deepEqual(summary.get('s1'), { present: 1, justified: 1, unjustified: 1, late: 1, recorded: 4, rate: 0.5 },
    'a mark under a holiday is hidden, a mark outside the period is ignored, and late counts as attending');
  assert.equal(summary.get('s2').rate, 1, 'blank days are not recorded, so they do not lower the rate');
  assert.equal(summary.get('s3'), undefined, 'a student with nothing recorded has no summary, not a 0 %');

  // ── Holiday candidates ─────────────────────────────────────────────────────
  const years = [
    { id: 'y24', startDate: '2024-09-01', endDate: '2025-06-30' },
    { id: 'y25', startDate: '2025-09-01', endDate: '2026-06-30' },
  ];
  const groups = [
    { id: 'g1', academicYearId: 'y25' },
    { id: 'g2', academicYearId: 'y25' },
    { id: 'g3', academicYearId: 'y24' },
    { id: 'g4', academicYearId: null },
    { id: 'g5', academicYearId: 'gone' },
  ];
  assert.deepEqual(A.holidayCandidates(groups, years, '2025-10-12', 'g1').map((g) => g.id), ['g2', 'g4', 'g5'],
    'same year and year-less groups qualify; last year’s class and the current group do not');
  assert.deepEqual(A.holidayCandidates(groups, years, '2026-06-30', 'g1').map((g) => g.id), ['g2', 'g4', 'g5'],
    'the last day of the year is inside it');

  // ── Export tables ──────────────────────────────────────────────────────────
  const labels = {
    course: 'Curso', subject: 'Asignatura', group: 'Grupo', code: 'Identificador', student: 'Alumno',
    present: 'Asiste', justified: 'F. just.', unjustified: 'F. injust.', late: 'Retrasos',
    recorded: 'Días registrados', rate: '% asistencia', summarySheet: 'Resumen', holidayCode: 'Festivo',
    codes: { present: 'A', justified: 'FJ', unjustified: 'FI', late: 'R' },
    formatDay: (day) => day.slice(5),
  };
  const exportGroups = [
    {
      groupName: '1º ESO A', courseName: '1º ESO', subjectName: 'Lengua',
      students: [{ id: 's1', code: 'STU_AAAA', name: 'Ana Peña' }, { id: 's2', code: 'STU_BBBB', name: 'Luis Mora' }],
      records: [...records, rec('s2', '2025-10-07', 'justified', 'médico')],
      holidays: [{ groupId: 'g1', date: '2025-10-10', label: 'Puente' }],
    },
    {
      groupName: 'Grupo: B/C*', courseName: '1º ESO', subjectName: 'Lengua',
      students: [{ id: 's9', code: 'STU_CCCC', name: 'Rosa Vidal' }],
      records: [], holidays: [],
    },
  ];

  const detail = A.buildAttendanceExport(exportGroups, { days: week, layout: 'detail', pseudonymOnly: false, labels });
  assert.deepEqual(detail.sheets.map((s) => s.name), ['1º ESO A', 'Grupo B C', 'Resumen'],
    'one sheet per group with Excel-safe names, plus a summary when several groups are detailed');
  const [sheetA] = detail.sheets;
  assert.deepEqual(sheetA.header,
    ['Identificador', 'Alumno', '10-06', '10-07', '10-08', '10-09', '10-10',
      'Asiste', 'F. just.', 'F. injust.', 'Retrasos', 'Días registrados', '% asistencia']);
  assert.deepEqual(sheetA.rows[0], ['STU_AAAA', 'Ana Peña', 'A', 'R', 'FI', 'FJ', 'Festivo', 1, 1, 1, 1, 4, 50]);
  assert.deepEqual(sheetA.rows[1].slice(2, 4), ['A', 'FJ (médico)'], 'the cell comment travels with its code');
  assert.equal(detail.sheets[1].rows[0].at(-1), '', 'nothing recorded exports a blank rate, not 0');
  assert.deepEqual(detail.flat.header.slice(0, 5), ['Curso', 'Asignatura', 'Grupo', 'Identificador', 'Alumno']);
  assert.equal(detail.flat.rows.length, 3, 'the CSV table holds every group');

  const anonymous = A.buildAttendanceExport(exportGroups, { days: week, layout: 'summary', pseudonymOnly: true, labels });
  const everything = JSON.stringify(anonymous);
  for (const name of ['Ana Peña', 'Luis Mora', 'Rosa Vidal']) assert.ok(!everything.includes(name), `“solo identificadores” drops ${name}`);
  assert.deepEqual(anonymous.sheets.map((s) => s.name), ['1º ESO A', 'Grupo B C'], 'the summary layout adds no extra sheet');
  assert.deepEqual(anonymous.sheets[0].header, ['Identificador', 'Asiste', 'F. just.', 'F. injust.', 'Retrasos', 'Días registrados', '% asistencia']);

  const one = A.buildAttendanceExport(exportGroups, { days: week, layout: 'detail', pseudonymOnly: false, studentId: 's2', labels });
  assert.deepEqual(one.sheets.map((s) => s.name), ['1º ESO A'], 'one student exports their group’s sheet only');
  assert.deepEqual(one.sheets[0].rows.map((r) => r[0]), ['STU_BBBB']);

  // ── Sheet names ────────────────────────────────────────────────────────────
  const taken = new Set();
  assert.equal(A.sanitizeSheetName('a'.repeat(40), taken).length, 31);
  assert.equal(A.sanitizeSheetName('a'.repeat(40), taken), `${'a'.repeat(27)} (2)`, 'a clash gets a suffix within 31 characters');
  assert.equal(A.sanitizeSheetName('RESUMEN', taken), 'RESUMEN');
  assert.equal(A.sanitizeSheetName('resumen', taken), 'resumen (2)', 'uniqueness ignores case, as Excel does');
  assert.equal(A.sanitizeSheetName('[]', taken), 'Sheet');

  console.log('teaching attendance (core): OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
