// Attendance (teaching vault): schema 179 + repo + XLSX workbook.
//
// The invariants: one mark per student per day (the unique key, not the caller, is
// what guarantees it), a blank cell has no row, "Todos asisten" fills only the blanks,
// holidays are per group and idempotent to copy, and deleting a student takes their
// attendance along. Plus the upgrade path from 178 on a vault that already has groups.

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

if (!process.argv.includes('--electron-teaching-attendance-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-teaching-attendance.mjs'), '--electron-teaching-attendance-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-attendance-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
try {
  const { SCHEMA_VERSION, migrations, runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/teachingAttendanceRepo.ts'));
  const { buildXlsxWorkbook, buildXlsx } = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));
  const { getDb, ...db } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = db.closeDb;

  assert.equal(SCHEMA_VERSION, Math.max(...migrations.map((m) => m.version)), 'SCHEMA_VERSION is the highest migration');
  assert.ok(SCHEMA_VERSION >= 179, 'attendance ships at schema 179 or later');

  const sql = getDb();
  const stamp = new Date().toISOString();
  sql.prepare(`INSERT INTO study_academic_years (id, short_id, label, start_date, end_date, position, created_at, updated_at)
               VALUES ('y25', 'ay-y25', '2025/2026', '2025-09-01', '2026-06-30', 0, ?, ?)`).run(stamp, stamp);
  sql.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
               VALUES ('c1', 'c-c1', '1º ESO', 0, ?, ?)`).run(stamp, stamp);
  sql.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
               VALUES ('sub1', 's-sub1', 'c1', 'Lengua', 0, ?, ?)`).run(stamp, stamp);

  const g1 = groups.createTeachingGroup({ name: 'A', subjectId: 'sub1', academicYearId: 'y25', expectedSize: 3 });
  const g2 = groups.createTeachingGroup({ name: 'B', subjectId: 'sub1', academicYearId: 'y25', expectedSize: 1 });
  const [s1, s2, s3] = g1.students.map((s) => s.id);
  const count = () => sql.prepare('SELECT COUNT(*) AS n FROM teaching_attendance').get().n;

  // ── One mark per student per day ───────────────────────────────────────────
  repo.setAttendance({ studentId: s1, date: '2025-10-06', status: 'present' });
  const late = repo.setAttendance({ studentId: s1, date: '2025-10-06', status: 'late', note: 'Autobús' });
  assert.deepEqual(late, { studentId: s1, date: '2025-10-06', status: 'late', note: 'Autobús' });
  assert.equal(count(), 1, 'setting a cell twice updates it rather than adding a row');
  repo.setAttendance({ studentId: s1, date: '2025-10-06', status: 'justified' });
  assert.equal(repo.getAttendanceSheet(g1.id, '2025-10-06', '2025-10-06').records[0].note, 'Autobús',
    'changing the status without a note keeps the comment');
  assert.throws(
    () => sql.prepare(`INSERT INTO teaching_attendance (id, student_id, date, status, created_at, updated_at)
                       VALUES ('dup', ?, '2025-10-06', 'present', ?, ?)`).run(s1, stamp, stamp),
    /UNIQUE/, 'the index, not just the repo, refuses a second mark for the same day');

  assert.throws(() => repo.setAttendance({ studentId: s1, date: '2025-10-6', status: 'present' }), /Invalid day/);
  assert.throws(() => repo.setAttendance({ studentId: s1, date: '2025-10-07', status: 'absent' }), /Invalid attendance status/);

  // ── Clearing removes the row, comment and all ──────────────────────────────
  repo.clearAttendance(s1, '2025-10-06');
  assert.equal(count(), 0, 'an empty cell has no row');

  // ── "Todos asisten" fills only the blanks ──────────────────────────────────
  repo.setAttendance({ studentId: s2, date: '2025-10-07', status: 'late' });
  const filled = repo.fillAttendanceDay(g1.id, '2025-10-07');
  assert.equal(filled.length, 3);
  assert.equal(filled.find((r) => r.studentId === s2).status, 'late', 'a mark recorded first survives the bulk fill');
  assert.deepEqual(filled.filter((r) => r.studentId !== s2).map((r) => r.status), ['present', 'present']);
  repo.fillAttendanceDay(g1.id, '2025-10-07');
  assert.equal(count(), 3, 'filling twice adds nothing');
  assert.equal(repo.getAttendanceSheet(g2.id, '2025-10-01', '2025-10-31').records.length, 0, 'another group is untouched');

  // ── Range: both ends included ──────────────────────────────────────────────
  repo.setAttendance({ studentId: s3, date: '2025-10-01', status: 'unjustified' });
  repo.setAttendance({ studentId: s3, date: '2025-10-31', status: 'unjustified' });
  repo.setAttendance({ studentId: s3, date: '2025-11-01', status: 'unjustified' });
  const october = repo.getAttendanceSheet(g1.id, '2025-10-31', '2025-10-01');
  assert.deepEqual(october.records.filter((r) => r.studentId === s3 && r.status === 'unjustified').map((r) => r.date), ['2025-10-01', '2025-10-31'],
    'the range includes both ends, and an inverted one is swapped');

  // A status from a newer build is left out, never guessed.
  sql.prepare(`INSERT INTO teaching_attendance (id, student_id, date, status, created_at, updated_at)
               VALUES ('future', ?, '2025-10-02', 'remote', ?, ?)`).run(s3, stamp, stamp);
  assert.ok(!repo.getAttendanceSheet(g1.id, '2025-10-02', '2025-10-02').records.length, 'an unknown status is not read as present');
  sql.prepare(`DELETE FROM teaching_attendance WHERE id = 'future'`).run();

  // ── Holidays: per group, idempotent ────────────────────────────────────────
  repo.setAttendanceHoliday([g1.id], '2025-10-13', 'Puente');
  repo.setAttendanceHoliday([g1.id, g2.id, g2.id], '2025-10-13', 'Puente del Pilar');
  const holidays = () => sql.prepare('SELECT group_id, label FROM teaching_attendance_holidays ORDER BY group_id').all();
  assert.equal(holidays().length, 2, 'copying a holiday to a group that has it adds no row');
  assert.ok(holidays().every((h) => h.label === 'Puente del Pilar'), 'and updates its label');
  assert.deepEqual(repo.holidayGroupsOn('2025-10-13').sort(), [g1.id, g2.id].sort());
  assert.deepEqual(repo.getAttendanceSheet(g2.id, '2025-10-13', '2025-10-13').holidays,
    [{ groupId: g2.id, date: '2025-10-13', label: 'Puente del Pilar' }]);

  groups.deleteTeachingGroup(g2.id);
  assert.deepEqual(repo.holidayGroupsOn('2025-10-13'), [g1.id], 'a deleted group is not offered in the dialog');
  repo.clearAttendanceHoliday([g1.id], '2025-10-13');
  assert.deepEqual(repo.holidayGroupsOn('2025-10-13'), []);

  // A holiday hides marks, it does not delete them.
  repo.setAttendanceHoliday([g1.id], '2025-10-07');
  assert.equal(count(), 6, 'marking a holiday keeps the marks under it');
  repo.clearAttendanceHoliday([g1.id], '2025-10-07');

  // ── Export data ────────────────────────────────────────────────────────────
  const exported = repo.getAttendanceExportData({ groupIds: [g1.id, 'missing'], from: '2025-10-01', to: '2025-10-31' });
  assert.equal(exported.length, 1, 'a group that no longer exists is skipped');
  assert.equal(exported[0].students.length, 3);
  assert.equal(exported[0].records.length, 5);

  // ── Deleting a student takes their attendance along ────────────────────────
  groups.deleteTeachingStudent(s3);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM teaching_attendance WHERE student_id = ?').get(s3).n, 0,
    'attendance cascades with its student');

  console.log('teaching attendance (repo): OK');

  // ── XLSX workbook ──────────────────────────────────────────────────────────
  {
    const AdmZip = require('adm-zip');
    const book = new AdmZip(buildXlsxWorkbook([
      { name: '1º ESO A', header: ['Alumno', '%'], body: [[{ text: 'Ana & Co', numeric: null }, { text: '50', numeric: 50 }]] },
      { name: 'Resumen', header: ['x'], body: [] },
    ]));
    const names = book.getEntries().map((e) => e.entryName);
    assert.ok(names.includes('xl/worksheets/sheet1.xml') && names.includes('xl/worksheets/sheet2.xml'), 'one part per sheet');
    const workbook = book.readAsText('xl/workbook.xml');
    assert.match(workbook, /<sheet name="1º ESO A" sheetId="1" r:id="rId1"\/><sheet name="Resumen" sheetId="2" r:id="rId2"\/>/);
    assert.match(book.readAsText('xl/_rels/workbook.xml.rels'), /Id="rId2"[^>]*Target="worksheets\/sheet2.xml"/);
    assert.match(book.readAsText('[Content_Types].xml'), /sheet2\.xml/);
    const sheet1 = book.readAsText('xl/worksheets/sheet1.xml');
    assert.match(sheet1, /Ana &amp; Co/, 'text is escaped');
    assert.match(sheet1, /<c r="B2"><v>50<\/v><\/c>/, 'numbers stay numbers');

    const single = new AdmZip(buildXlsx(['h'], [[{ text: 'v', numeric: null }]]));
    assert.match(single.readAsText('xl/workbook.xml'), /<sheet name="Datos" sheetId="1" r:id="rId1"\/>/,
      'the single-sheet writer the database vault uses is unchanged');
  }

  console.log('teaching attendance (xlsx): OK');

  // ── Upgrade 178 → head on a vault that already has groups ──────────────────
  {
    const Database = require('better-sqlite3');
    const legacy = new Database(path.join(root, 'legacy.db'));
    for (const m of migrations.filter((m) => m.version <= 178).sort((a, b) => a.version - b.version)) {
      legacy.exec(m.up);
      legacy.pragma(`user_version = ${m.version}`);
    }
    legacy.pragma('foreign_keys = ON');
    legacy.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at) VALUES ('lc', 'lc', 'C', 0, ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at) VALUES ('ls', 'ls', 'lc', 'S', 0, ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_groups (id, short_id, name, subject_id, created_at, updated_at) VALUES ('lg', 'lg', '1ºA', 'ls', ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_students (id, group_id, pseudonym_code, created_at, updated_at) VALUES ('lst', 'lg', 'STU_7K3Q', ?, ?)`).run(stamp, stamp);

    runMigrations(legacy);

    assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'a 178 vault reaches head');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_students').get().n, 1, 'the roster survives');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_attendance').get().n, 0, 'attendance arrives empty');
    legacy.prepare(`INSERT INTO teaching_attendance (id, student_id, date, status, created_at, updated_at)
                    VALUES ('la', 'lst', '2025-10-06', 'present', ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_attendance_holidays (id, group_id, date, created_at, updated_at)
                    VALUES ('lh', 'lg', '2025-10-13', ?, ?)`).run(stamp, stamp);
    legacy.prepare(`DELETE FROM teaching_groups WHERE id = 'lg'`).run();
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_attendance').get().n, 0, 'hard-deleting a group cascades through its students');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_attendance_holidays').get().n, 0, 'and takes its holidays');
    legacy.close();
  }

  console.log('teaching attendance (migration): OK');
} finally {
  closeDb();
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userData) {
  const Module = require('node:module');
  const ts = require('typescript');

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (request.startsWith('@shared/')) {
      const base = path.join(repoRoot, 'shared', request.slice('@shared/'.length));
      const file = fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts');
      return originalResolve.call(this, file, ...args);
    }
    return originalResolve.call(this, request, ...args);
  };

  const electronStub = {
    app: { getPath: () => userData, getName: () => 'Nodus', getVersion: () => '0.0.0-test', on: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
    },
    dialog: { showMessageBoxSync: () => 0 },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, ...args);
  };

  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
