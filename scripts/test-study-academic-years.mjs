// Academic years ("2024/2025") for the study vault: the pure label/date rules, the
// repo's create-or-return and unlink-not-cascade semantics, the course -> subject
// inheritance, and the per-year timetable — including the two ways a year-scoped
// save could quietly destroy another year's grid. Also asserts the v80 -> v81
// migration keeps an existing timetable rather than adopting or dropping it.
// Runs under Electron-as-Node for the native SQLite ABI.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-study-academic-years-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-academic-years.mjs'), '--electron-study-academic-years-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-academic-years-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const years = require(path.join(repoRoot, 'shared/studyAcademicYears.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const scheduleRepo = require(path.join(repoRoot, 'electron/db/studyScheduleRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 81, 'academic years require schema v81 or later');

  // ── Pure label parsing ────────────────────────────────────────────────────
  // Everything a user might type for the same year has to land on one canonical
  // label, or the unique index stops deduplicating and the picker fills with twins.
  for (const input of ['2024/2025', '2024-2025', '2024/25', '24/25', '2024 2025', '2024', ' 2024 / 2025 ', '2024–2025']) {
    assert.equal(years.normalizeAcademicYearLabel(input), '2024/2025', `"${input}" normalizes to 2024/2025`);
  }
  for (const input of ['', 'curso', '2024/2030', '2024/2024', '20244', '2024/', 'abc/def', '1899']) {
    assert.equal(years.normalizeAcademicYearLabel(input), null, `"${input}" is rejected`);
  }
  assert.equal(years.formatAcademicYearLabel(2025), '2025/2026');
  assert.equal(years.nextAcademicYearLabel('2024/2025'), '2025/2026');
  assert.equal(years.previousAcademicYearLabel('2024/2025'), '2023/2024');

  // ── Dates ─────────────────────────────────────────────────────────────────
  assert.deepEqual(years.defaultAcademicYearRange(2024), { startDate: '2024-09-01', endDate: '2025-08-31' });
  assert.deepEqual(years.defaultAcademicYearRange(2024, 1), { startDate: '2024-01-01', endDate: '2024-12-31' });
  // Consecutive default years must meet with no gap, or a date in between belongs
  // to no year at all.
  const first = years.defaultAcademicYearRange(2024);
  const second = years.defaultAcademicYearRange(2025);
  assert.equal(new Date(`${first.endDate}T00:00:00Z`).getTime() + 86_400_000, new Date(`${second.startDate}T00:00:00Z`).getTime(), 'default ranges are contiguous');
  assert.equal(years.academicYearLabelForDate('2025-09-01'), '2025/2026', 'September starts the new year');
  assert.equal(years.academicYearLabelForDate('2025-08-31'), '2024/2025', 'August still belongs to the old year');
  assert.ok(years.isAcademicYearDate('2025-02-28'));
  assert.equal(years.isAcademicYearDate('2025-02-31'), false, 'a day that never existed is rejected');
  assert.equal(years.isAcademicYearDate('2025-13-01'), false);

  // ── Picking the current year ──────────────────────────────────────────────
  const y24 = { id: 'a', startDate: '2024-09-01', endDate: '2025-08-31' };
  const y25 = { id: 'b', startDate: '2025-09-01', endDate: '2026-08-31' };
  assert.equal(years.pickCurrentAcademicYear([y24, y25], '2025-10-01').id, 'b', 'today lands inside its year');
  assert.equal(years.pickCurrentAcademicYear([y24, y25], '2024-10-01').id, 'a');
  assert.equal(years.pickCurrentAcademicYear([y24, y25], '2030-01-01').id, 'b', 'past-only vaults fall back to the newest');
  assert.equal(years.pickCurrentAcademicYear([y24, y25], '2000-01-01').id, 'b', 'future-only vaults still answer');
  assert.equal(years.pickCurrentAcademicYear([], '2025-10-01'), null);

  // ── Inheritance (pure) ────────────────────────────────────────────────────
  const courses = [{ id: 'c1', academicYearId: 'y1' }, { id: 'c2', academicYearId: null }];
  assert.equal(years.effectiveAcademicYearId({ academicYearId: null, courseId: 'c1' }, courses), 'y1', 'subject inherits its course');
  assert.equal(years.effectiveAcademicYearId({ academicYearId: 'y2', courseId: 'c1' }, courses), 'y2', 'own year overrides the course');
  assert.equal(years.effectiveAcademicYearId({ academicYearId: null, courseId: 'c2' }, courses), null);
  assert.equal(years.effectiveAcademicYearId({ academicYearId: null, courseId: 'missing' }, courses), null);

  // ── Repo: create is create-or-return ──────────────────────────────────────
  const year2425 = org.createStudyAcademicYear({ label: '2024/2025' });
  assert.equal(year2425.label, '2024/2025');
  assert.equal(year2425.startDate, '2024-09-01');
  assert.equal(year2425.endDate, '2025-08-31');
  assert.match(year2425.shortId, /^ACY-[0-9A-F]{8}$/);
  assert.equal(org.createStudyAcademicYear({ label: '24/25' }).id, year2425.id, 'a differently-typed same year returns the existing row');
  const year2526 = org.createStudyAcademicYear({ label: '2025/2026' });
  assert.notEqual(year2526.id, year2425.id);
  assert.throws(() => org.createStudyAcademicYear({ label: 'no' }), /2024\/2025/, 'an unreadable label is refused');
  assert.throws(() => org.createStudyAcademicYear({ label: '2030/2031', startDate: '2031-09-01', endDate: '2030-09-01' }), /terminar después/, 'an inverted range is refused');

  assert.equal(org.updateStudyAcademicYear(year2526.id, { label: '2026/2027' }).label, '2026/2027');
  org.updateStudyAcademicYear(year2526.id, { label: '2025/2026' });
  assert.throws(() => org.updateStudyAcademicYear(year2526.id, { label: '2024/2025' }), /ya existe/, 'renaming onto another year is refused');

  // ── Repo: courses and subjects ────────────────────────────────────────────
  const school = org.createStudyCourse({ name: '3º ESO A', academicYearId: year2425.id });
  assert.equal(school.academicYearId, year2425.id);
  const maths = org.createStudySubject({ courseId: school.id, name: 'Matemáticas' });
  assert.equal(maths.academicYearId, null, 'a subject stays unset so it keeps inheriting');
  const degree = org.createStudyCourse({ name: 'Grado en Historia' });
  assert.equal(degree.academicYearId, null);
  const modern = org.createStudySubject({ courseId: degree.id, name: 'Historia moderna', academicYearId: year2526.id });
  assert.equal(modern.academicYearId, year2526.id, 'a subject can state its own year');
  assert.throws(() => org.createStudyCourse({ name: 'X', academicYearId: 'nope' }), /no existe/, 'an unknown year is refused rather than dropped');

  const workspace = org.getStudyWorkspace();
  assert.equal(workspace.academicYears.length, 2, 'the workspace carries the years');
  assert.deepEqual(workspace.academicYears.map((year) => year.label), ['2025/2026', '2024/2025'], 'years come back newest first');
  assert.equal(years.effectiveAcademicYearId(workspace.subjects.find((s) => s.id === maths.id), workspace.courses), year2425.id, 'inheritance resolves over real rows');

  assert.equal(org.updateStudyEntity('subject', maths.id, { academicYearId: year2526.id }).academicYearId, year2526.id, 'a subject year can be overridden');
  org.updateStudyEntity('subject', maths.id, { academicYearId: null });
  assert.equal(org.getStudyEntity('subject', maths.id).academicYearId, null, 'and cleared back to inheriting');
  assert.throws(() => org.updateStudyEntity('course', school.id, { academicYearId: 'nope' }), /no existe/);
  // A topic has no such column; the patch must be ignored, not turned into bad SQL.
  const topic = org.createStudyTopic({ subjectId: maths.id, name: 'Ecuaciones' });
  assert.ok(org.updateStudyEntity('topic', topic.id, { academicYearId: year2425.id, name: 'Ecuaciones II' }));
  assert.equal(org.getStudyEntity('topic', topic.id).name, 'Ecuaciones II', 'the rest of the patch still applies');

  // ── Duplicating a course, then re-filing it into next year ────────────────
  // This is the September flow the UI offers: duplicate, then change the copy's
  // year. It only works if a duplicate preserves the year and leaves an
  // inheriting subject inheriting, so moving the copy carries its subjects along.
  const copy = org.duplicateStudyTree('course', school.id);
  assert.equal(copy.academicYearId, year2425.id, 'the duplicate keeps the original year');
  const copiedSubjects = org.getStudyWorkspace().subjects.filter((s) => s.courseId === copy.id);
  assert.equal(copiedSubjects.length, 1);
  assert.equal(copiedSubjects[0].academicYearId, null, 'a copied subject keeps inheriting instead of being pinned');
  org.updateStudyEntity('course', copy.id, { academicYearId: year2526.id });
  assert.equal(org.getStudyEntity('course', school.id).academicYearId, year2425.id, 'the original is untouched');
  const refiled = org.getStudyWorkspace();
  assert.equal(years.effectiveAcademicYearId(refiled.subjects.find((s) => s.id === copiedSubjects[0].id), refiled.courses), year2526.id, 'the copied subject follows its course into the new year');

  // ── Per-year timetables ───────────────────────────────────────────────────
  const gridA = scheduleRepo.getStudySchedule(year2425.id);
  assert.equal(gridA.academicYearId, year2425.id);
  assert.equal(gridA.periods.length, 2, 'each year gets its own starter grid');
  const gridB = scheduleRepo.getStudySchedule(year2526.id);
  assert.notEqual(gridB.periods[0].id, gridA.periods[0].id, 'the starter grids are distinct rows');

  scheduleRepo.saveStudySchedule({ ...gridA, cells: [{ day: 'monday', periodId: gridA.periods[0].id, subjectId: maths.id, activityTitle: null }], dayColors: { ...gridA.dayColors, monday: '#0f766e' } });
  scheduleRepo.saveStudySchedule({ ...gridB, cells: [{ day: 'friday', periodId: gridB.periods[0].id, subjectId: null, activityTitle: 'Claustro' }], dayColors: { ...gridB.dayColors, monday: '#b91c1c' } });

  // The regression that matters: saving one year wiped every year before scoping.
  const reloadedA = scheduleRepo.getStudySchedule(year2425.id);
  assert.equal(reloadedA.periods.length, 2, "saving another year leaves this year's periods alone");
  assert.equal(reloadedA.cells.length, 1);
  assert.equal(reloadedA.cells[0].subjectId, maths.id, "and this year's cells");
  assert.equal(reloadedA.dayColors.monday, '#0f766e', "and this year's colours");
  const reloadedB = scheduleRepo.getStudySchedule(year2526.id);
  assert.equal(reloadedB.cells[0].activityTitle, 'Claustro');
  assert.equal(reloadedB.dayColors.monday, '#b91c1c', 'day colours are per year, not shared');

  // The unscoped timetable is its own bucket and must survive both of the above.
  const unscoped = scheduleRepo.getStudySchedule(null);
  assert.equal(unscoped.academicYearId, null);
  assert.equal(unscoped.cells.length, 0, 'the unscoped grid is untouched by year saves');
  scheduleRepo.saveStudySchedule({ ...unscoped, cells: [{ day: 'wednesday', periodId: unscoped.periods[0].id, subjectId: null, activityTitle: 'Libre' }] });
  assert.equal(scheduleRepo.getStudySchedule(year2425.id).cells.length, 1, 'saving the unscoped grid leaves the years alone');
  assert.equal(scheduleRepo.getStudySchedule(null).cells[0].activityTitle, 'Libre');

  // A period id from another year must be refused, not silently re-homed.
  assert.throws(
    () => scheduleRepo.saveStudySchedule({ academicYearId: year2425.id, periods: [gridB.periods[0]], cells: [], dayColors: reloadedA.dayColors }),
    /otro curso académico/,
    'a foreign period is rejected',
  );
  assert.throws(() => scheduleRepo.getStudySchedule('nope'), /no existe/);

  // ── Copying a timetable to another year ───────────────────────────────────
  const copied = scheduleRepo.copyStudySchedule(year2425.id, year2526.id);
  assert.equal(copied.academicYearId, year2526.id);
  assert.equal(copied.cells.length, 1, "the source year's cells come across");
  assert.equal(copied.cells[0].subjectId, maths.id);
  assert.equal(copied.dayColors.monday, '#0f766e', 'and its colours, replacing the destination');
  const sourceAfterCopy = scheduleRepo.getStudySchedule(year2425.id);
  assert.equal(sourceAfterCopy.cells.length, 1, 'the source is unchanged');
  // Fresh ids are the point: editing the copy must not reach back into the source.
  assert.equal(copied.periods.some((period) => sourceAfterCopy.periods.some((other) => other.id === period.id)), false, 'the copy gets its own period rows');
  scheduleRepo.saveStudySchedule({ ...copied, cells: [] });
  assert.equal(scheduleRepo.getStudySchedule(year2425.id).cells.length, 1, 'clearing the copy leaves the source intact');
  assert.throws(() => scheduleRepo.copyStudySchedule(year2425.id, year2425.id), /destino distinto/);

  // ── Deleting a year unlinks, never cascades into content ───────────────────
  const doomed = org.createStudyAcademicYear({ label: '2019/2020' });
  const doomedCourse = org.createStudyCourse({ name: 'Antiguo', academicYearId: doomed.id });
  const doomedSubject = org.createStudySubject({ courseId: doomedCourse.id, name: 'Latín', academicYearId: doomed.id });
  scheduleRepo.saveStudySchedule({ ...scheduleRepo.getStudySchedule(doomed.id), cells: [] });
  const doomedPeriods = getDb().prepare('SELECT COUNT(*) v FROM study_schedule_periods WHERE academic_year_id = ?').get(doomed.id).v;
  assert.ok(doomedPeriods > 0, 'the doomed year has a timetable to lose');
  org.deleteStudyAcademicYear(doomed.id);
  assert.equal(org.getStudyEntity('course', doomedCourse.id).academicYearId, null, 'the course survives without a year');
  assert.equal(org.getStudyEntity('subject', doomedSubject.id).academicYearId, null, 'so does the subject');
  assert.equal(getDb().prepare('SELECT COUNT(*) v FROM study_schedule_periods WHERE academic_year_id = ?').get(doomed.id).v, 0, 'its timetable goes with it');

  // ── The day-styles unique index ───────────────────────────────────────────
  // NULLs are distinct in a SQLite index, so the unscoped timetable could hold two
  // colours for one Monday unless the index goes through COALESCE.
  const dayStyleInsert = 'INSERT INTO study_schedule_day_styles (day, academic_year_id, color) VALUES (?, ?, ?)';
  getDb().prepare('DELETE FROM study_schedule_day_styles').run();
  getDb().prepare(dayStyleInsert).run('monday', null, '#111111');
  assert.throws(() => getDb().prepare(dayStyleInsert).run('monday', null, '#222222'), /UNIQUE|constraint/i, 'the unscoped day styles stay unique');
  getDb().prepare(dayStyleInsert).run('monday', year2425.id, '#333333');
  assert.throws(() => getDb().prepare(dayStyleInsert).run('monday', year2425.id, '#444444'), /UNIQUE|constraint/i, 'so do a year’s');

  closeDb();

  // ── v80 -> v81 migration ──────────────────────────────────────────────────
  // An existing vault's timetable must stay exactly where it was: unscoped and
  // intact, not adopted into an invented year and not dropped by the day-styles
  // table rebuild.
  const legacyPath = path.join(root, 'legacy.sqlite');
  const legacy = new Database(legacyPath);
  legacy.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= 80).sort((a, b) => a.version - b.version)) {
    legacy.exec(migration.up);
    legacy.pragma(`user_version = ${migration.version}`);
  }
  const stamp = new Date().toISOString();
  legacy.prepare('INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('c-old', 'CRS-OLD', 'Curso previo', 0, stamp, stamp);
  legacy.prepare('INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('s-old', 'SUB-OLD', 'c-old', 'Asignatura previa', 0, stamp, stamp);
  legacy.prepare('INSERT INTO study_schedule_periods (id, section, label, start_time, end_time, position) VALUES (?, ?, ?, ?, ?, ?)').run('p-old', 'morning', 'Mañana', '09:00', '13:00', 0);
  legacy.prepare('INSERT INTO study_schedule_cells (day, period_id, subject_id, activity_title) VALUES (?, ?, ?, ?)').run('monday', 'p-old', 's-old', null);
  legacy.prepare('INSERT INTO study_schedule_day_styles (day, color) VALUES (?, ?)').run('monday', '#0f766e');

  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'the legacy vault migrates to head');
  assert.equal(legacy.prepare('SELECT academic_year_id FROM study_courses WHERE id = ?').get('c-old').academic_year_id, null, 'an existing course gains no invented year');
  const migratedPeriod = legacy.prepare('SELECT * FROM study_schedule_periods WHERE id = ?').get('p-old');
  assert.equal(migratedPeriod.academic_year_id, null, 'the existing timetable stays unscoped');
  assert.equal(migratedPeriod.start_time, '09:00', 'and keeps its hours');
  assert.equal(legacy.prepare('SELECT COUNT(*) v FROM study_schedule_cells WHERE period_id = ?').get('p-old').v, 1, 'its cells survive');
  const migratedStyle = legacy.prepare('SELECT * FROM study_schedule_day_styles WHERE day = ?').get('monday');
  assert.equal(migratedStyle.color, '#0f766e', 'the rebuilt day styles keep their colours');
  assert.equal(migratedStyle.academic_year_id, null);
  assert.equal(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='study_schedule_day_styles_v81'").get(), undefined, 'the rebuild leaves no scaffolding behind');
  legacy.close();

  console.log('study academic year tests passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
