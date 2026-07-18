// Gradebook persistence (teaching vault): schema 87 + repo.
//
// The invariants that matter here are the ones a grade challenge depends on:
//
//   · a published plan is frozen, and revising it COPIES rather than rewrites, so a
//     mark given last term can still be recomputed against the rules of last term
//   · the copy re-points every parent link at the new tree — a child left pointing at
//     the old plan's parent would silently merge two versions
//   · a cell is keyed on (student, item, convocatoria), so an ordinary and an
//     extraordinary mark coexist instead of overwriting each other
//   · deleting a subject, a plan or a student takes exactly what it should with it

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

if (!process.argv.includes('--electron-teaching-grades-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-teaching-grades.mjs'), '--electron-teaching-grades-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-grades-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
try {
  const { SCHEMA_VERSION, migrations, runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/teachingGradesRepo.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const { computeGrade } = require(path.join(repoRoot, 'shared/assessment/index.ts'));
  const { getDb, ...db } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = db.closeDb;

  assert.equal(SCHEMA_VERSION, Math.max(...migrations.map((m) => m.version)), 'SCHEMA_VERSION matches the highest migration');
  assert.ok(SCHEMA_VERSION >= 87, 'the gradebook ships at schema 87 or later');

  const sql = getDb();
  assert.equal(sql.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'a fresh vault migrates to head');

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString();
  sql.prepare(`INSERT INTO study_academic_years (id, short_id, label, start_date, end_date, position, created_at, updated_at)
               VALUES ('y1','y1','2024/2025','2024-09-01','2025-06-30',0,?,?)`).run(stamp, stamp);
  sql.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
               VALUES ('c1','c1','Curso',0,?,?)`).run(stamp, stamp);
  sql.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
               VALUES ('sub1','sub1','c1','Historia',0,?,?)`).run(stamp, stamp);
  // A second subject that the cascade section below does NOT delete, so the exam and
  // rubric blocks still have something to hang off afterwards.
  sql.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
               VALUES ('sub2','sub2','c1','Lengua',0,?,?)`).run(stamp, stamp);

  const group = groups.createTeachingGroup({ name: '1ºA', subjectId: 'sub1', academicYearId: 'y1', expectedSize: 3 });
  const [ana, juan, rosa] = group.students;
  groups.updateTeachingStudent(ana.id, { givenNames: 'Ana', surnames: 'Peña' });

  // ── Plans ──────────────────────────────────────────────────────────────────
  const plan = repo.createAssessmentPlan({ name: 'Historia 2024/25', subjectId: 'sub1', academicYearId: 'y1', profile: 'universidad' });
  assert.match(plan.id, /[0-9a-f-]{36}/);
  assert.equal(plan.version, 1);
  assert.equal(plan.publishedAt, null);
  // The preset seeded real rules rather than an empty object.
  assert.equal(plan.rules.decimals, 1, 'the preset seeded its rules');
  assert.ok(plan.rules.advisories.source.length > 0, 'and its cited advisory');

  // Rules are fully editable — nothing about a preset is binding.
  const retuned = repo.updateAssessmentPlan(plan.id, {
    rules: { ...plan.rules, passAt: 0.45, rounding: 'threshold', roundingThreshold: 0.7, decimals: 0 },
  });
  assert.equal(retuned.rules.passAt, 0.45, 'every rule can be overridden');
  assert.equal(retuned.rules.rounding, 'threshold');
  repo.updateAssessmentPlan(plan.id, { rules: plan.rules });

  // Year scoping uses `IS ?`, so NULL-year plans stay reachable.
  const unscoped = repo.createAssessmentPlan({ name: 'Suelto', subjectId: 'sub1', academicYearId: null });
  assert.deepEqual(repo.listAssessmentPlans({ subjectId: 'sub1', academicYearId: null }).map((p) => p.id), [unscoped.id]);
  assert.deepEqual(repo.listAssessmentPlans({ subjectId: 'sub1', academicYearId: 'y1' }).map((p) => p.id), [plan.id]);
  repo.deleteAssessmentPlan(unscoped.id);

  // ── Item tree ──────────────────────────────────────────────────────────────
  const examen = repo.createAssessmentItem(plan.id, { name: 'Examen', kind: 'block', weight: 50, aggregation: 'sum', minToAverage: 0.4 });
  const q1 = repo.createAssessmentItem(plan.id, { name: 'P1', parentId: examen.id, maxPoints: 4 });
  const q2 = repo.createAssessmentItem(plan.id, { name: 'P2', parentId: examen.id, maxPoints: 6 });
  const practica = repo.createAssessmentItem(plan.id, { name: 'Práctica', weight: 30 });
  const aprov = repo.createAssessmentItem(plan.id, { name: 'Aprovechamiento', weight: 20, aggregation: 'normalizeGroupMax' });

  assert.equal(repo.listAssessmentItems(plan.id).length, 5);
  assert.equal(examen.minToAverage, 0.4, 'a threshold survives the round trip');
  assert.equal(q1.parentId, examen.id);
  // Positions are per-parent, so the first child of a block starts at 0 again.
  assert.equal(q1.position, 0);
  assert.equal(practica.position, 1, 'top-level items number independently of children');

  const renamed = repo.updateAssessmentItem(q1.id, { name: 'Pregunta 1', maxPoints: 3, isMandatory: true });
  assert.equal(renamed.name, 'Pregunta 1');
  assert.equal(renamed.maxPoints, 3);
  assert.equal(renamed.isMandatory, true, 'booleans survive the integer column');
  repo.updateAssessmentItem(q1.id, { maxPoints: 4, isMandatory: false });

  repo.reorderAssessmentItems(plan.id, [aprov.id, practica.id, examen.id]);
  const reordered = repo.listAssessmentItems(plan.id).filter((i) => i.parentId === null);
  assert.deepEqual(reordered.map((i) => i.name), ['Aprovechamiento', 'Práctica', 'Examen']);
  repo.reorderAssessmentItems(plan.id, [examen.id, practica.id, aprov.id]);

  // ── Entries ────────────────────────────────────────────────────────────────
  repo.setGradeEntry({ studentId: ana.id, itemId: q1.id, rawValue: 4 });
  repo.setGradeEntry({ studentId: ana.id, itemId: q2.id, rawValue: 5 });
  repo.setGradeEntry({ studentId: ana.id, itemId: practica.id, rawValue: 8 });
  repo.setGradeEntry({ studentId: ana.id, itemId: aprov.id, rawValue: 6 });

  let entries = repo.listGradeEntries(plan.id);
  assert.equal(entries.length, 4);
  // Typing a value into an empty cell implies it has been assessed.
  assert.equal(entries.find((e) => e.itemId === q1.id).status, 'evaluated', 'a typed value implies "evaluated"');

  // Upsert on the natural key: editing the same cell must not create a second row.
  repo.setGradeEntry({ studentId: ana.id, itemId: q1.id, rawValue: 3.5 });
  entries = repo.listGradeEntries(plan.id);
  assert.equal(entries.length, 4, 'editing a cell updates it rather than duplicating');
  assert.equal(entries.find((e) => e.itemId === q1.id).rawValue, 3.5);

  // Status without a value is a first-class thing, not an empty cell.
  repo.setGradeEntry({ studentId: juan.id, itemId: practica.id, status: 'not_submitted' });
  const juanEntry = repo.listGradeEntries(plan.id).find((e) => e.studentId === juan.id);
  assert.equal(juanEntry.status, 'not_submitted');
  assert.equal(juanEntry.rawValue, null, 'a non-submission carries no number');

  // A convocatoria is part of the key: both marks coexist.
  repo.setGradeEntry({ studentId: juan.id, itemId: practica.id, convocatoria: 'extraordinaria', rawValue: 5 });
  assert.equal(repo.listGradeEntries(plan.id, 'ordinaria').find((e) => e.studentId === juan.id).status, 'not_submitted');
  assert.equal(repo.listGradeEntries(plan.id, 'extraordinaria').find((e) => e.studentId === juan.id).rawValue, 5,
    'the resit mark does not overwrite the ordinary one');
  assert.throws(
    () => sql.prepare(`INSERT INTO teaching_grade_entries (id, student_id, item_id, convocatoria, created_at, updated_at)
                       VALUES ('dup', ?, ?, 'ordinaria', ?, ?)`).run(juan.id, practica.id, stamp, stamp),
    /UNIQUE/,
    'the key is enforced by the index, not only by the repo',
  );

  repo.clearGradeEntry(juan.id, practica.id, 'extraordinaria');
  assert.equal(repo.listGradeEntries(plan.id, 'extraordinaria').length, 0);

  // ── Cohort statistics for the class-relative aggregation ───────────────────
  repo.setGradeEntry({ studentId: juan.id, itemId: aprov.id, rawValue: 10 });
  repo.setGradeEntry({ studentId: rosa.id, itemId: aprov.id, status: 'not_submitted' });
  const cohort = repo.cohortStats(plan.id, group.id);
  assert.equal(cohort.maxByItem[aprov.id], 10, 'the class maximum comes from real marks');
  assert.equal(cohort.maxByItem[practica.id], 8, 'and only from marks that were actually earned');

  // A value can survive a status change (marking a cell exempt does not wipe what was
  // typed), so the ceiling must be filtered by STATUS, not merely by "has a number".
  // Otherwise one exempt student silently rescales the whole class.
  repo.setGradeEntry({ studentId: rosa.id, itemId: aprov.id, rawValue: 20, status: 'exempt' });
  assert.equal(
    repo.cohortStats(plan.id, group.id).maxByItem[aprov.id], 10,
    'an exempt mark never sets the class ceiling, even when it holds a number',
  );
  repo.setGradeEntry({ studentId: rosa.id, itemId: aprov.id, rawValue: null, status: 'not_submitted' });

  // ── The repo feeds the engine ──────────────────────────────────────────────
  {
    const { plan: loaded, items } = repo.getAssessmentPlan(plan.id);
    const mine = repo.listGradeEntries(plan.id).filter((e) => e.studentId === ana.id);
    const result = computeGrade({ plan: loaded, items, entries: mine, cohort });
    // examen = (3.5+5)/10 = 0.85 ; 8.5*0.5 + 8*0.3 + (6/10)*10*0.2 = 4.25+2.4+1.2 = 7.85 → 7.9
    assert.equal(result.record.numeric, 7.9, 'stored rows compute the grade end to end');
    assert.ok(result.trace, 'and carry their derivation');
  }

  // ── Publish and revise ─────────────────────────────────────────────────────
  const published = repo.publishAssessmentPlan(plan.id);
  assert.ok(published.publishedAt, 'publishing stamps the plan');

  const revised = repo.reviseAssessmentPlan(plan.id);
  assert.equal(revised.version, 2);
  assert.equal(revised.parentVersionId, plan.id, 'the new version points back at the old one');
  assert.equal(revised.publishedAt, null, 'a revision starts unpublished');
  assert.ok(repo.getAssessmentPlan(plan.id).plan.publishedAt, 'the published version is untouched');

  const copied = repo.listAssessmentItems(revised.id);
  assert.equal(copied.length, 5, 'the whole tree came across');
  // The critical bit: children must point at the NEW parents, never the old ones.
  const oldIds = new Set(repo.listAssessmentItems(plan.id).map((i) => i.id));
  for (const copy of copied) {
    assert.ok(!oldIds.has(copy.id), 'copied items get fresh ids');
    if (copy.parentId) {
      assert.ok(!oldIds.has(copy.parentId), 'and their parent link is re-pointed at the copy');
      assert.ok(copied.some((c) => c.id === copy.parentId), 'to an item inside the same new plan');
    }
  }
  const copiedExam = copied.find((i) => i.name === 'Examen');
  assert.equal(copied.filter((i) => i.parentId === copiedExam.id).length, 2, 'the tree keeps its shape');
  assert.equal(copiedExam.minToAverage, 0.4, 'and its rules');
  // Marks stay with the version they were given under.
  assert.equal(repo.listGradeEntries(revised.id).length, 0, 'a revision starts with no marks of its own');
  assert.ok(repo.listGradeEntries(plan.id).length > 0, 'while the published version keeps its own');

  // ── Referential rules ──────────────────────────────────────────────────────
  const count = (table, where, ...args) => sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;

  // Deleting a student takes their marks, not the plan.
  const before = count('teaching_grade_entries', '1=1');
  groups.deleteTeachingStudent(rosa.id);
  assert.ok(count('teaching_grade_entries', '1=1') < before, 'a deleted student takes their marks with them');
  assert.equal(repo.listAssessmentItems(plan.id).length, 5, 'and leaves the plan alone');

  // Deleting an item takes its own marks and its children.
  repo.deleteAssessmentItem(examen.id);
  assert.equal(count('teaching_assessment_items', 'id IN (?,?)', q1.id, q2.id), 0, 'children cascade with their block');
  assert.equal(count('teaching_grade_entries', 'item_id IN (?,?)', q1.id, q2.id), 0, 'and so do their marks');

  // Deleting the subject takes the whole plan.
  sql.prepare('DELETE FROM study_subjects WHERE id = ?').run('sub1');
  assert.equal(count('teaching_assessment_plans', 'subject_id = ?', 'sub1'), 0, 'plans cascade with their subject');
  assert.equal(count('teaching_assessment_items', 'plan_id = ?', plan.id), 0, 'taking their items');

  // ── From an exam: one column per QUESTION, never per section ───────────────
  {
    const examsRepo = require(path.join(repoRoot, 'electron/db/teachingExamsRepo.ts'));
    const exam = examsRepo.createTeachingExam({ title: 'Parcial', subjectId: 'sub2' });
    const section = examsRepo.addTeachingExamQuestion(exam.id, { type: 'section', prompt: 'Lee el texto' });
    examsRepo.addTeachingExamQuestion(exam.id, { type: 'short', prompt: 'Define romanticismo', points: 2, parentId: section.id });
    examsRepo.addTeachingExamQuestion(exam.id, { type: 'short', prompt: 'Cita dos autores', points: 3, parentId: section.id });
    examsRepo.addTeachingExamQuestion(exam.id, { type: 'essay', prompt: 'Comenta el fragmento', points: 7 });

    const p2 = repo.createAssessmentPlan({ name: 'Con examen', subjectId: 'sub2', profile: 'universidad' });
    const built = repo.addExamBlock(p2.id, exam.id, 60);
    const block = built.find((i) => i.parentId === null);
    const leaves = built.filter((i) => i.parentId === block.id);

    // The section statement is NOT a column: its worth IS the sum of its children, so
    // emitting one would double-count the paper.
    assert.equal(leaves.length, 3, 'one column per question, none for the section statement');
    assert.equal(block.maxPoints, 12, 'the block is worth the exam total (2+3+7), not the plan scale');
    assert.equal(block.aggregation, 'sum', 'an exam is marked out of its total, not averaged');
    assert.deepEqual(leaves.map((l) => l.maxPoints).sort((a, b) => a - b), [2, 3, 7]);
    assert.ok(leaves.every((l) => l.sourceExamQuestionId), 'every column traces back to its question');
    assert.ok(leaves[0].name.startsWith('1.'), `the header is the printed numbering, got ${leaves[0].name}`);

    // Marking it end to end lands on the plan's scale.
    const g2 = groups.createTeachingGroup({ name: 'X', subjectId: 'sub2', expectedSize: 1 });
    for (const leaf of leaves) repo.setGradeEntry({ studentId: g2.students[0].id, itemId: leaf.id, rawValue: leaf.maxPoints });
    const detail = repo.getAssessmentPlan(p2.id);
    const result = computeGrade({
      plan: detail.plan, items: detail.items,
      entries: repo.listGradeEntries(p2.id).filter((e) => e.studentId === g2.students[0].id),
    });
    assert.equal(result.record.numeric, 10, 'full marks on every question is a 10');
  }

  // ── From a rubric: the mark lands in the ordinary entry ────────────────────
  {
    const rubricsRepo = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));
    const rubric = rubricsRepo.createTeachingRubric({ title: 'Exposición', subjectId: 'sub2' });
    const full = rubricsRepo.getTeachingRubric(rubric.id);
    assert.ok(full.criteria.length > 0 && full.levels.length > 0, 'a new rubric starts with a usable grid');

    const p3 = repo.createAssessmentPlan({ name: 'Con rúbrica', subjectId: 'sub2', profile: 'universidad' });
    const withRubric = repo.addRubricItem(p3.id, rubric.id, 100);
    const item = withRubric[0];
    assert.equal(item.entryMode, 'rubric');
    assert.equal(item.sourceRubricId, rubric.id, 'the column remembers which rubric marks it');

    const g3 = groups.createTeachingGroup({ name: 'Y', subjectId: 'sub2', expectedSize: 1 });
    const best = full.levels.reduce((a, b) => (a.score >= b.score ? a : b));
    const levels = Object.fromEntries(full.criteria.map((c) => [c.id, best.id]));
    const entry = repo.setRubricEvaluation({ studentId: g3.students[0].id, itemId: item.id, levels });

    // The derived total is written into the ordinary entry, so filters, sorts, stats
    // and every export treat it as a plain number.
    assert.equal(entry.status, 'evaluated');
    assert.ok(entry.rawValue > 0, 'picking the top level everywhere yields the rubric maximum');
    assert.ok(Math.abs(entry.rawValue - item.maxPoints) < 0.01, 'and that maximum is the column maximum');
    assert.deepEqual(repo.getRubricEvaluation(g3.students[0].id, item.id), levels, 'the per-criterion picks round-trip');

    // A MIDDLE level is what separates "fraction of each criterion's worth" from a raw
    // sum of level scores: with the top level everywhere the two formulas coincide.
    if (full.levels.length > 2) {
      const mid = [...full.levels].sort((a, b) => a.score - b.score)[1];
      const midLevels = Object.fromEntries(full.criteria.map((c) => [c.id, mid.id]));
      const midEntry = repo.setRubricEvaluation({ studentId: g3.students[0].id, itemId: item.id, levels: midLevels });
      const expected = (mid.score / best.score) * item.maxPoints;
      assert.ok(Math.abs(midEntry.rawValue - expected) < 0.05,
        `a middle level scales with the criterion's worth: expected ~${expected}, got ${midEntry.rawValue}`);
    }

    // A WEIGHTED rubric is what actually distinguishes "fraction of each criterion's
    // worth" from a raw sum of level scores — on an unweighted one the two formulas are
    // mathematically identical, so testing only that proves nothing about the weighting.
    {
      const weighted = rubricsRepo.createTeachingRubric({ title: 'Ponderada', subjectId: 'sub2' });
      const base = rubricsRepo.getTeachingRubric(weighted.id);
      rubricsRepo.updateTeachingRubric(weighted.id, {
        weighted: true,
        criteria: base.criteria.map((c, i) => ({ ...c, weight: i === 0 ? 60 : 20 })),
      });
      const wr = rubricsRepo.getTeachingRubric(weighted.id);
      const wItems = repo.addRubricItem(p3.id, weighted.id, 0);
      const wItem = wItems.find((i) => i.sourceRubricId === weighted.id);
      const top = wr.levels.reduce((a, b) => (a.score >= b.score ? a : b));

      // Top level on the 60 % criterion only: the mark must reflect THAT criterion's
      // share, not one third of the scale.
      const only = repo.setRubricEvaluation({
        studentId: g3.students[0].id, itemId: wItem.id, levels: { [wr.criteria[0].id]: top.id },
      });
      const expected = (wr.scaleMax * 60) / 100;
      assert.ok(Math.abs(only.rawValue - expected) < 0.05,
        `a weighted criterion contributes its own share: expected ~${expected}, got ${only.rawValue}`);
    }

    // Re-marking replaces the previous picks rather than accumulating them.
    const worst = full.levels.reduce((a, b) => (a.score <= b.score ? a : b));
    repo.setRubricEvaluation({ studentId: g3.students[0].id, itemId: item.id, levels: { [full.criteria[0].id]: worst.id } });
    assert.equal(Object.keys(repo.getRubricEvaluation(g3.students[0].id, item.id)).length, 1,
      're-marking replaces the previous evaluation');
  }

  // ── Exports: the four formats are OPENED and inspected, not merely produced ──
  {
    const exp = require(path.join(repoRoot, 'electron/export/gradebookExport.ts'));
    const { gradebookToGrid } = require(path.join(repoRoot, 'shared/assessment/index.ts'));
    const zlib = require('node:zlib');

    const p4 = repo.createAssessmentPlan({ name: 'Salidas', subjectId: 'sub2', profile: 'universidad' });
    const t1 = repo.createAssessmentItem(p4.id, { name: 'Examen', weight: 100 });
    const g4 = groups.createTeachingGroup({ name: 'Z', subjectId: 'sub2', expectedSize: 2 });
    groups.updateTeachingStudent(g4.students[0].id, { givenNames: 'Ana', surnames: 'Peña' });
    groups.updateTeachingStudent(g4.students[1].id, { givenNames: 'Juan', surnames: 'García' });
    repo.setGradeEntry({ studentId: g4.students[0].id, itemId: t1.id, rawValue: 8 });
    repo.setGradeEntry({ studentId: g4.students[1].id, itemId: t1.id, status: 'not_submitted' });

    const detail = repo.getAssessmentPlan(p4.id);
    const students = repo.getTeachingGroupStudents
      ? repo.getTeachingGroupStudents(g4.id)
      : groups.getTeachingGroup(g4.id).students;
    const grid = gradebookToGrid({
      plan: detail.plan, items: detail.items,
      entries: repo.listGradeEntries(p4.id),
      students: students.map((s) => ({ id: s.id, givenNames: s.givenNames, surnames: s.surnames, pseudonymCode: s.pseudonymCode, position: s.position })),
    });
    const actaRows = students.map((s) => {
      const r = grid.results[s.id];
      return {
        code: s.pseudonymCode, name: `${s.givenNames} ${s.surnames}`.trim(),
        numeric: r.record.numeric, qualitative: r.record.qualitative,
        notPresented: r.record.notPresented, passed: r.passed,
      };
    });
    const header = { subject: 'Lengua', group: 'Z', date: '2026-01-01' };

    // PDF is deliberately NOT tested here: it renders through a real BrowserWindow,
    // which this as-Node harness cannot create. It is verified in the GUI walkthrough
    // (scripts/verify-teaching-groups-ui.mjs), where a browser exists — asserting it
    // here would only prove that a stub throws.
    //
    // What IS testable here is the HTML both PDF and DOCX are built from.
    const { renderActaHtml: renderActa, renderBoletinHtml } = require(path.join(repoRoot, 'shared/gradebookHtml.ts'));
    const actaHtml = renderActa(header, actaRows);
    assert.ok(actaHtml.includes('Ana'), 'the acta HTML names the students');
    assert.ok(/No presentado/.test(actaHtml), 'and marks the non-submission as not presented');
    assert.ok(!/undefined|NaN/.test(actaHtml), 'with no undefined or NaN leaking into the document');
    const boletinHtml = renderBoletinHtml(header, { code: 'STU_7K3Q', name: 'Ana Peña' },
      grid.results[students[0].id], 10);
    assert.ok(boletinHtml.includes('Examen'), 'the boletín shows the parts that produced the mark');
    assert.ok(!/undefined|NaN/.test(boletinHtml));

    // DOCX: a real zip whose document.xml carries the marks.
    const docx = await exp.actaDocxBytes({ header, rows: actaRows });
    assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK', 'the acta DOCX is a zip');
    const xml = extractFromZip(docx, 'word/document.xml', zlib);
    assert.ok(xml.includes('Ana'), 'the DOCX names the student');
    assert.ok(xml.includes('8'), 'and carries the mark');
    assert.ok(/No presentado|No apto/.test(xml), 'and states each situation');

    // CSV: header row plus one line per student, with the non-submission visible.
    const csv = exp.gradebookCsv(grid.columns, grid.rows);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, students.length + 1, 'one header row plus one row per student');
    assert.ok(lines[0].includes('Identificador'), 'the header carries the column names');
    assert.ok(csv.includes('Ana'), 'and the body the students');

    // XLSX: a zip whose sheet holds the numbers AS numbers, not as text.
    const xlsx = exp.gradebookXlsx(grid.columns, grid.rows);
    assert.equal(xlsx.subarray(0, 2).toString('latin1'), 'PK', 'the XLSX is a zip');
    const sheet = extractFromZip(xlsx, 'xl/worksheets/sheet1.xml', zlib);
    assert.ok(sheet.includes('Ana'), 'the sheet carries the roster');
    assert.ok(/<v>8<\/v>/.test(sheet), 'and the mark is a real number cell, not text');

    // A qualitative-only plan must emit NO number anywhere in the acta.
    repo.updateAssessmentPlan(p4.id, { rules: { record: 'qualitative' } });
    const qual = repo.getAssessmentPlan(p4.id);
    const qualGrid = gradebookToGrid({
      plan: qual.plan, items: qual.items, entries: repo.listGradeEntries(p4.id),
      students: students.map((s) => ({ id: s.id, givenNames: s.givenNames, surnames: s.surnames, pseudonymCode: s.pseudonymCode, position: s.position })),
    });
    const { renderActaHtml } = require(path.join(repoRoot, 'shared/gradebookHtml.ts'));
    const qualRows = students.map((s) => {
      const r = qualGrid.results[s.id];
      return { code: s.pseudonymCode, name: s.givenNames, numeric: r.record.numeric, qualitative: r.record.qualitative,
               notPresented: r.record.notPresented, passed: r.passed };
    });
    const qualHtml = renderActaHtml(header, qualRows);
    assert.ok(/NT|SB|BI|SU|IN/.test(qualHtml), 'a qualitative plan records a term');
    assert.ok(qualRows.every((r) => r.numeric === null), 'and no number at all — the projection decides, not the renderer');
  }

  console.log('teaching grades (repo): OK');

  // ── Legacy upgrade v86 → head ──────────────────────────────────────────────
  {
    const Database = require('better-sqlite3');
    const legacy = new Database(path.join(root, 'legacy.db'));
    for (const m of migrations.filter((m) => m.version <= 86).sort((a, b) => a.version - b.version)) {
      legacy.exec(m.up);
      legacy.pragma(`user_version = ${m.version}`);
    }
    legacy.pragma('foreign_keys = ON');
    legacy.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
                    VALUES ('lc','lc','Curso',0,?,?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
                    VALUES ('ls','ls','lc','Historia',0,?,?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_groups (id, short_id, name, subject_id, created_at, updated_at)
                    VALUES ('lg','lg','1ºA','ls',?,?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_students (id, group_id, given_names, pseudonym_code, created_at, updated_at)
                    VALUES ('lst','lg','Ana','STU_7K3Q',?,?)`).run(stamp, stamp);

    runMigrations(legacy);

    assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'an old vault reaches head');
    assert.equal(legacy.prepare('SELECT given_names FROM teaching_students WHERE id = ?').get('lst').given_names, 'Ana',
      'pre-existing rosters survive the upgrade untouched');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM teaching_assessment_plans').get().n, 0,
      'the new tables arrive empty rather than backfilled');
    // Usable, not merely present.
    legacy.prepare(`INSERT INTO teaching_assessment_plans (id, short_id, name, subject_id, rules_json, created_at, updated_at)
                    VALUES ('lp','lp','Plan','ls','{}',?,?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_assessment_items (id, plan_id, name, created_at, updated_at)
                    VALUES ('li','lp','Examen',?,?)`).run(stamp, stamp);
    legacy.prepare(`INSERT INTO teaching_grade_entries (id, student_id, item_id, raw_value, status, created_at, updated_at)
                    VALUES ('le','lst','li',7,'evaluated',?,?)`).run(stamp, stamp);
    assert.equal(legacy.prepare('SELECT raw_value FROM teaching_grade_entries WHERE id = ?').get('le').raw_value, 7);
    legacy.close();
  }

  console.log('teaching grades (migration): OK');
} finally {
  closeDb();
  await rm(root, { recursive: true, force: true });
}

/** Minimal stored/deflated zip entry reader, so an export can be OPENED in the test. */
function extractFromZip(buffer, name, zlib) {
  const target = Buffer.from(name, 'utf8');
  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buffer.readUInt16LE(i + 8);
    const compressed = buffer.readUInt32LE(i + 18);
    const nameLen = buffer.readUInt16LE(i + 26);
    const extraLen = buffer.readUInt16LE(i + 28);
    const start = i + 30;
    if (!buffer.subarray(start, start + nameLen).equals(target)) continue;
    const dataStart = start + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compressed);
    return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  }
  throw new Error(`${name} not found in the archive`);
}

function installRuntimeHooks(userData) {
  const Module = require('node:module');
  const ts = require('typescript');

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return originalResolve.call(this, fs.existsSync(direct) ? direct : asIndex, ...args);
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
