// Student groups (teaching vault): schema 86 + repo.
//
// The load-bearing invariant is the one the whole feature was asked for: a group
// belongs to ONE academic year, so creating next year's course must start from an
// empty list rather than dragging this year's students along. Everything else here
// guards the referential rules that make that true — CASCADE from the subject,
// SET NULL from the year — plus the legacy upgrade path from v85.

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

if (!process.argv.includes('--electron-teaching-groups-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-teaching-groups.mjs'), '--electron-teaching-groups-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-groups-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
try {
  const { SCHEMA_VERSION, migrations, runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const { getDb, ...db } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = db.closeDb;

  // ── The version invariant nothing else checks ──────────────────────────────
  //
  // Adding a migration and forgetting to bump the constant is currently caught only
  // by e2e, and only when dist/ happens to be fresh — which it often is not, because
  // test:e2e rebuilds only when the build is entirely absent. One line closes it.
  const highest = Math.max(...migrations.map((m) => m.version));
  assert.equal(SCHEMA_VERSION, highest,
    `SCHEMA_VERSION (${SCHEMA_VERSION}) must equal the highest migration (${highest})`);
  assert.ok(SCHEMA_VERSION >= 86, 'student groups ship at schema 86 or later');
  assert.equal(new Set(migrations.map((m) => m.version)).size, migrations.length, 'migration versions are unique');

  const sql = getDb();
  assert.equal(sql.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'a fresh vault migrates to head');

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString();
  const mkYear = (id, label) =>
    sql.prepare(`INSERT INTO study_academic_years (id, short_id, label, start_date, end_date, position, created_at, updated_at)
                 VALUES (?, ?, ?, '2024-09-01', '2025-06-30', 0, ?, ?)`).run(id, `ay-${id}`, label, stamp, stamp);
  const mkCourse = (id) =>
    sql.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
                 VALUES (?, ?, 'Curso', 0, ?, ?)`).run(id, `c-${id}`, stamp, stamp);
  const mkSubject = (id, courseId) =>
    sql.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
                 VALUES (?, ?, ?, 'Historia', 0, ?, ?)`).run(id, `s-${id}`, courseId, stamp, stamp);

  mkYear('y24', '2024/2025');
  mkYear('y25', '2025/2026');
  mkCourse('c1');
  mkSubject('sub1', 'c1');
  mkSubject('sub2', 'c1');

  // ── Create: the declared total pre-creates blank rows ──────────────────────
  const group = repo.createTeachingGroup({ name: '1ºA', subjectId: 'sub1', academicYearId: 'y24', expectedSize: 3 });
  assert.equal(group.students.length, 3, 'the declared total becomes that many editable rows');
  assert.equal(group.expectedSize, 3);
  assert.match(group.shortId, /^GRP-[0-9A-F]{8}$/, 'groups get a short id like every other study entity');

  // Codes are unique inside the group and are not derived from anything.
  const codes = group.students.map((s) => s.pseudonymCode);
  assert.equal(new Set(codes).size, 3, 'codes are unique within a group');
  for (const code of codes) assert.match(code, /^STU_[2-9A-HJKMNP-TV-Z]{4}$/);

  // Blank rows carry a code but no name — nothing to leak yet.
  assert.deepEqual(group.students.map((s) => s.givenNames), ['', '', '']);

  // The total is a head start, not a limit.
  const oversized = repo.createTeachingGroup({ name: 'X', subjectId: 'sub1', expectedSize: 10_000 });
  assert.equal(oversized.students.length, 200, 'a mistyped total is clamped rather than freezing the grid');
  repo.deleteTeachingGroup(oversized.id);

  // ── Edit ───────────────────────────────────────────────────────────────────
  repo.updateTeachingStudent(group.students[0].id, { givenNames: 'Ana María', surnames: 'Peña López' });
  repo.updateTeachingStudent(group.students[1].id, { givenNames: 'Juan', surnames: 'García Ruiz', comments: 'Va bien' });
  let reloaded = repo.getTeachingGroup(group.id);
  assert.equal(reloaded.students[0].givenNames, 'Ana María');
  assert.equal(reloaded.students[1].comments, 'Va bien');
  assert.equal(reloaded.students[0].pseudonymCode, codes[0], 'editing a name never changes the code');

  repo.addTeachingStudent(group.id, 2);
  reloaded = repo.getTeachingGroup(group.id);
  assert.equal(reloaded.students.length, 5, 'rows can be added past the declared total');
  assert.equal(new Set(reloaded.students.map((s) => s.pseudonymCode)).size, 5, 'added rows get fresh codes');

  repo.deleteTeachingStudent(reloaded.students[4].id);
  assert.equal(repo.getTeachingGroup(group.id).students.length, 4);

  // ── THE requirement: a new academic year starts empty ──────────────────────
  const nextYear = repo.createTeachingGroup({ name: '1ºA', subjectId: 'sub1', academicYearId: 'y25', expectedSize: 0 });
  assert.equal(nextYear.students.length, 0, 'a new academic year does NOT drag last year’s students along');

  const y24 = repo.listTeachingGroups({ subjectId: 'sub1', academicYearId: 'y24' });
  const y25 = repo.listTeachingGroups({ subjectId: 'sub1', academicYearId: 'y25' });
  assert.deepEqual(y24.map((g) => g.id), [group.id], 'listing is scoped to the year');
  assert.deepEqual(y25.map((g) => g.id), [nextYear.id]);
  assert.equal(y24[0].studentCount, 4, 'the list view carries a count without loading every student');

  // Groups predating academic years carry NULL, and `IS ?` is what still finds them —
  // `= NULL` is never true in SQL and would silently hide them.
  const unscoped = repo.createTeachingGroup({ name: 'Suelto', subjectId: 'sub2', academicYearId: null });
  assert.deepEqual(
    repo.listTeachingGroups({ subjectId: 'sub2', academicYearId: null }).map((g) => g.id),
    [unscoped.id],
    'NULL-year groups are reachable, not orphaned',
  );

  // ── Import from another group ──────────────────────────────────────────────
  const imported = repo.importStudentsFromGroup(nextYear.id, group.id);
  assert.equal(imported.students.length, 4, 'the roster is copied over');
  assert.deepEqual(imported.students.map((s) => s.givenNames), ['Ana María', 'Juan', '', '']);
  assert.equal(imported.students[1].comments, '', 'comments are subject-scoped and deliberately not copied');
  const importedCodes = imported.students.map((s) => s.pseudonymCode);
  assert.equal(importedCodes.filter((c) => codes.includes(c)).length, 0,
    'imported rows get NEW codes: a code identifies a row in a group, not a person across groups');

  // A copy, not a link: editing the source must not touch the copy.
  repo.updateTeachingStudent(repo.getTeachingGroup(group.id).students[0].id, { givenNames: 'CAMBIADO' });
  assert.equal(repo.getTeachingGroup(nextYear.id).students[0].givenNames, 'Ana María', 'import copies, never links');

  // ── Referential rules ──────────────────────────────────────────────────────
  // Deleting the YEAR must not delete the roster — only unscope it.
  sql.prepare('DELETE FROM study_academic_years WHERE id = ?').run('y25');
  const orphaned = repo.getTeachingGroup(nextYear.id);
  assert.equal(orphaned.academicYearId, null, 'deleting a year unscopes the group');
  assert.equal(orphaned.students.length, 4, 'and keeps every student');

  // Deleting the SUBJECT does remove its groups and their students.
  sql.prepare('DELETE FROM study_subjects WHERE id = ?').run('sub1');
  assert.equal(
    sql.prepare('SELECT COUNT(*) AS n FROM teaching_groups WHERE subject_id = ?').get('sub1').n, 0,
    'groups cascade with their subject',
  );
  assert.equal(
    sql.prepare('SELECT COUNT(*) AS n FROM teaching_students WHERE group_id = ?').get(group.id).n, 0,
    'and take their students with them',
  );

  // ── The shape the privacy layer consumes ───────────────────────────────────
  const forAi = repo.pseudonymStudentsForGroup(unscoped.id);
  assert.ok(Array.isArray(forAi));
  const g2 = repo.createTeachingGroup({ name: 'Z', subjectId: 'sub2', expectedSize: 1 });
  repo.updateTeachingStudent(g2.students[0].id, { givenNames: 'Rosa', surnames: 'Ferrer Vidal' });
  const [first] = repo.pseudonymStudentsForGroup(g2.id);
  assert.deepEqual(
    { code: first.code, givenNames: first.givenNames, surnames: first.surnames },
    { code: g2.students[0].pseudonymCode, givenNames: 'Rosa', surnames: 'Ferrer Vidal' },
  );

  console.log('teaching groups (repo): OK');

  // ── Legacy upgrade v85 → head ──────────────────────────────────────────────
  {
    const Database = require('better-sqlite3');
    const legacyPath = path.join(root, 'legacy.db');
    const legacy = new Database(legacyPath);
    for (const m of migrations.filter((m) => m.version <= 85).sort((a, b) => a.version - b.version)) {
      legacy.exec(m.up);
      legacy.pragma(`user_version = ${m.version}`);
    }
    legacy.pragma('foreign_keys = ON');
    legacy.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
                    VALUES ('lc', 'lc', 'Curso', 0, ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
                    VALUES ('ls', 'ls', 'lc', 'Historia', 0, ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_rubrics (id, short_id, title, created_at, updated_at)
                    VALUES ('lr', 'lr', 'Rúbrica previa', ?, ?)`).run(stamp, stamp);

    runMigrations(legacy);

    assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'an old vault reaches head');
    assert.equal(legacy.prepare('SELECT title FROM teaching_rubrics WHERE id = ?').get('lr').title, 'Rúbrica previa',
      'pre-existing teaching data survives the upgrade untouched');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_groups').get().n, 0,
      'the new tables arrive empty rather than backfilled');
    // The tables really are usable after the upgrade, not just present.
    legacy.prepare(`INSERT INTO teaching_groups (id, short_id, name, subject_id, created_at, updated_at)
                    VALUES ('lg', 'lg', '1ºA', 'ls', ?, ?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_students (id, group_id, pseudonym_code, created_at, updated_at)
                    VALUES ('lst', 'lg', 'STU_7K3Q', ?, ?)`).run(stamp, stamp);
    assert.throws(
      () => legacy.prepare(`INSERT INTO teaching_students (id, group_id, pseudonym_code, created_at, updated_at)
                            VALUES ('lst2', 'lg', 'STU_7K3Q', ?, ?)`).run(stamp, stamp),
      /UNIQUE/,
      'a duplicate code inside one group is rejected by the index, not just by the generator',
    );
    legacy.close();
  }

  console.log('teaching groups (migration): OK');
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
      return originalResolve.call(this, path.join(repoRoot, 'shared', `${request.slice('@shared/'.length)}.ts`), ...args);
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
