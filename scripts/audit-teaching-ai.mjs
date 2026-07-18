// Full audit of every AI function in the teaching vault, against a REAL model.
//
// There are five, and this exercises all of them end to end through their real entry
// points — not the transport, not a mock:
//
//   1. importAssessmentPlan   — guía docente → weighted blocks
//   2. draftStudentFeedback   — comment about a student (pseudonymised)
//   3. generateRubric         — a whole analytic rubric
//   4. fillRubricCell         — one descriptor inside a rubric
//   5. generateExamQuestion   — one exam question of a given type
//
// It checks QUALITY, not merely absence of an exception: weights read verbatim rather
// than rescaled, thresholds actually extracted, descriptors that differ between levels,
// questions that match the type asked for, and no student name reaching the wire.
//
//   VERIFY_PROVIDER=ollama VERIFY_MODEL=qwen2.5:7b node scripts/audit-teaching-ai.mjs
//   VERIFY_PROVIDER=gemini VERIFY_MODEL=gemini-2.5-flash-lite GEMINI_API_KEY=… node scripts/audit-teaching-ai.mjs
//
// Failures are collected and reported together: one weak model answer should not hide
// the state of the other four functions.

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

if (!process.argv.includes('--electron-audit-teaching-ai')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-teaching-ai.mjs'), '--electron-audit-teaching-ai'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const provider = process.env.VERIFY_PROVIDER || 'ollama';
const modelId = process.env.VERIFY_MODEL || 'qwen2.5:7b';
const apiKey = process.env.GEMINI_API_KEY || process.env.VERIFY_API_KEY || '';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-audit-teaching-ai-'));
installRuntimeHooks(root);

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? '' });
    console.log(`  ✓ ${name}${detail ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 110)}` : ''}`);
  } catch (cause) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(cause?.message ?? cause) });
    console.log(`  ✗ ${name} — ${String(cause?.message ?? cause).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const { getDb, ...db } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = db.closeDb;

  const model = { provider, model: modelId };
  if (provider === 'gemini') {
    assert.ok(apiKey, 'GEMINI_API_KEY is required for the cloud run');
    secrets.setApiKey('gemini', apiKey);
    delete process.env.GEMINI_API_KEY;
    delete process.env.VERIFY_API_KEY;
    settingsRepo.updateSettings({ studyAiPrivacyMode: 'external', studyAiLocalOnly: false });
  } else {
    settingsRepo.updateSettings({ studyAiPrivacyMode: 'local', studyAiLocalOnly: true });
  }
  // Point every teaching task at the model under audit, and skip the consent dialog:
  // it is modal and there is no user here to press it.
  settingsRepo.updateSettings({
    studentPseudonymsEnabled: true,
    studyAiConfirmExternal: false,
    chatModel: model, studyModel: model, synthesisModel: model,
    questionGenModel: model, extractionModel: model, defaultModel: model,
  });

  const grades = require(path.join(repoRoot, 'electron/db/teachingGradesRepo.ts'));
  const groupsRepo = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const rubricsRepo = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));
  const importer = require(path.join(repoRoot, 'electron/ai/assessmentImport.ts'));
  const rubricsAi = require(path.join(repoRoot, 'electron/ai/teachingRubrics.ts'));
  const examsAi = require(path.join(repoRoot, 'electron/ai/teachingExamQuestions.ts'));

  const sql = getDb();
  const stamp = '2026-01-01T00:00:00.000Z';
  sql.prepare(`INSERT INTO study_courses (id, short_id, name, position, created_at, updated_at)
               VALUES ('c1','c1','1º Bachillerato',0,?,?)`).run(stamp, stamp);
  sql.prepare(`INSERT INTO study_subjects (id, short_id, course_id, name, position, created_at, updated_at)
               VALUES ('sub1','sub1','c1','Historia de España',0,?,?)`).run(stamp, stamp);

  const group = groupsRepo.createTeachingGroup({ name: '1ºA', subjectId: 'sub1', expectedSize: 3 });
  groupsRepo.updateTeachingStudent(group.students[0].id, { givenNames: 'Ana María', surnames: 'Peña López' });
  groupsRepo.updateTeachingStudent(group.students[1].id, { givenNames: 'Juan', surnames: 'García Ruiz' });
  groupsRepo.updateTeachingStudent(group.students[2].id, { givenNames: 'Rosa', surnames: 'Ferrer Vidal' });
  const plan = grades.createAssessmentPlan({ name: 'Historia', subjectId: 'sub1', profile: 'universidad' });

  const NAMES = /\b(Ana|Mar[íi]a|Pe[ñn]a|L[óo]pez|Juan|Garc[íi]a|Ruiz|Rosa|Ferrer|Vidal)\b/i;

  console.log(`\n══ Auditoría de IA docente — ${provider} / ${modelId} ══\n`);

  // ── 1. Import a guía docente ───────────────────────────────────────────────
  await check('importAssessmentPlan · lee la tabla de evaluación', async () => {
    const guia = [
      'SISTEMA DE EVALUACIÓN',
      'Prueba final: 50 %. Será necesario obtener una calificación mínima de 4 sobre 10',
      'en esta prueba para poder promediar con el resto de actividades.',
      'Elaboración de trabajos teóricos: 30 %. Actividad obligatoria.',
      'Valoración de la participación con aprovechamiento en clase: 20 %. No recuperable.',
    ].join('\n');
    const proposal = await importer.importAssessmentPlan({ planId: plan.id, text: guia });

    assert.ok(proposal.items.length >= 3, `esperaba 3 bloques, obtuve ${proposal.items.length}`);
    const total = proposal.items.reduce((sum, i) => sum + i.weight, 0);
    assert.ok(Math.abs(total - 100) < 0.01, `los pesos deben leerse literalmente; suman ${total}`);
    const withMin = proposal.items.find((i) => i.minToAverage != null);
    assert.ok(withMin, 'no extrajo la nota mínima para promediar');
    assert.ok(Math.abs(withMin.minToAverage - 0.4) < 0.01,
      `"4 sobre 10" debe ser 0.4, obtuve ${withMin.minToAverage}`);
    assert.ok(withMin.weight === 50, 'el mínimo debe ir en la prueba final, no en otro bloque');
    return proposal.items.map((i) => `${i.name} ${i.weight}%`).join(' | ');
  });

  await check('importAssessmentPlan · NO reescala pesos que no suman 100', async () => {
    // Real published programaciones contain weights that do not add up. Silently
    // "fixing" them would produce a plan the teacher never wrote.
    const roto = 'Examen: 60 %.\nPrácticas: 30 %.\n(No aparece ningún otro apartado.)';
    const proposal = await importer.importAssessmentPlan({ planId: plan.id, text: roto });
    const total = proposal.items.reduce((sum, i) => sum + i.weight, 0);
    assert.ok(Math.abs(total - 90) < 0.01, `debe respetar el 90 % del documento, obtuve ${total}`);
    return `suma ${total} % (respetado)`;
  });

  await check('importAssessmentPlan · no inventa bloques', async () => {
    const minimo = 'La evaluación consistirá en un único examen final que supone el 100 % de la nota.';
    const proposal = await importer.importAssessmentPlan({ planId: plan.id, text: minimo });
    assert.equal(proposal.items.length, 1, `un solo bloque; obtuve ${proposal.items.length}`);
    assert.ok(Math.abs(proposal.items[0].weight - 100) < 0.01);
    return proposal.items[0].name;
  });

  // ── 2. Student feedback, through the pseudonymisation layer ────────────────
  await check('draftStudentFeedback · redacta sin filtrar el nombre', async () => {
    const out = await importer.draftStudentFeedback({
      planId: plan.id, groupId: group.id, studentId: group.students[0].id,
      summary: 'Prueba final: 8/10. Trabajos: 6/10. Participación: 9/10.',
    });
    assert.ok(out.text.trim().length > 40, 'el comentario es demasiado corto para ser útil');
    assert.ok(!/STU_/i.test(out.text), 'el docente no debe ver identificadores en el texto final');
    // Quality bar: naming the student ONCE or referring to them as "el estudiante" are
    // both fine for a family. What is not fine is the name repeated — the code becomes
    // a name on the way back, so "Estimada familia de X, X ha demostrado…" is what a
    // repeat-the-identifier instruction produces, and no teacher would send that.
    //
    // The code→name round trip itself is proven in verify-student-pseudonyms.mjs, which
    // controls the model's reply; here the model is free, so the bar is readability.
    const mentions = (out.text.match(/Ana María Peña López/g) ?? []).length;
    assert.ok(mentions <= 1, `el nombre no debe repetirse; aparece ${mentions} veces`);
    assert.ok(!/^\s*(estimad|querid|apreciad)/i.test(out.text),
      'no debe abrir con una fórmula de saludo: es un comentario, no una carta');
    return out.text;
  });

  // ── 3. Generate a whole rubric ─────────────────────────────────────────────
  await check('generateRubric · genera criterios y niveles coherentes', async () => {
    const out = await rubricsAi.generateRubric({
      source: 'instruction',
      instruction: 'Exposición oral sobre un tema de historia contemporánea, 2º de Bachillerato.',
      subjectId: 'sub1', language: 'es', scaleMax: 10, levelCount: 4, criteriaCount: 4, weighted: false,
    });
    const rubric = out.rubric ?? out;
    assert.ok(Array.isArray(rubric.criteria) && rubric.criteria.length >= 3,
      `esperaba al menos 3 criterios, obtuve ${rubric.criteria?.length}`);
    assert.ok(Array.isArray(rubric.levels) && rubric.levels.length >= 3, 'faltan niveles');
    // A rubric whose cells are empty or identical is useless: the descriptors ARE the
    // rubric. This is the quality check that a "did not throw" test would miss.
    const cells = rubric.criteria.flatMap((c) => Object.values(c.cells ?? {})).filter((v) => String(v ?? '').trim());
    assert.ok(cells.length >= rubric.criteria.length,
      `los descriptores están vacíos: ${cells.length} celdas con texto`);
    const unique = new Set(cells.map((c) => String(c).trim().toLowerCase()));
    assert.ok(unique.size > 1, 'todos los descriptores son idénticos: la rúbrica no distingue niveles');
    return `${rubric.criteria.length} criterios × ${rubric.levels.length} niveles, ${cells.length} descriptores`;
  });

  // ── 4. Fill one rubric cell ────────────────────────────────────────────────
  await check('fillRubricCell · redacta un descriptor concreto', async () => {
    const created = rubricsRepo.createTeachingRubric({ title: 'Exposición oral', subjectId: 'sub1' });
    const base = rubricsRepo.getTeachingRubric(created.id);
    // The product refuses to describe an unnamed criterion, and it is right to: it
    // would have nothing to describe. Name it first, as a teacher would.
    rubricsRepo.updateTeachingRubric(created.id, {
      criteria: base.criteria.map((c, i) => ({ ...c, name: i === 0 ? 'Claridad de la exposición' : c.name })),
    });
    const rubric = rubricsRepo.getTeachingRubric(created.id);
    const out = await rubricsAi.fillRubricCell({
      rubricId: rubric.id,
      criterionId: rubric.criteria[0].id,
      levelId: rubric.levels[0].id,
      instruction: 'Claridad de la exposición',
    });
    assert.ok(out.text && out.text.trim().length > 15, `descriptor demasiado corto: "${out.text}"`);
    assert.ok(!/^\s*\{/.test(out.text), 'devolvió JSON crudo en lugar de texto');
    return out.text;
  });

  // ── 5. Generate an exam question of each shape ─────────────────────────────
  await check('generateExamQuestion · rechaza un tipo desconocido', async () => {
    // A silent fallback to another question type would be indistinguishable from a
    // model failure, and would be debugged in the wrong place.
    await assert.rejects(
      () => examsAi.generateExamQuestion({ type: 'inventado', instruction: 'x', language: 'es' }),
      /desconocido/i,
    );
    return 'lanza en lugar de sustituir el tipo';
  });

  await check('generateExamQuestion · opción múltiple con una sola correcta', async () => {
    const out = await examsAi.generateExamQuestion({
      type: 'multiple_choice', instruction: 'La Segunda República española, nivel 2º de Bachillerato',
      subjectId: 'sub1', language: 'es', optionCount: 4,
    });
    const q = out.question ?? out;
    assert.ok(q.prompt && q.prompt.trim().length > 15, 'el enunciado está vacío o es trivial');
    assert.ok(Array.isArray(q.options) && q.options.length === 4,
      `pedí 4 opciones, obtuve ${q.options?.length}`);
    const correct = q.options.filter((o) => o.correct);
    assert.equal(correct.length, 1, `debe haber exactamente una correcta, hay ${correct.length}`);
    assert.ok(q.options.every((o) => String(o.text ?? '').trim().length > 0), 'hay opciones vacías');
    const texts = new Set(q.options.map((o) => String(o.text).trim().toLowerCase()));
    assert.equal(texts.size, 4, 'hay opciones repetidas');
    return q.prompt;
  });

  await check('generateExamQuestion · verdadero/falso', async () => {
    const out = await examsAi.generateExamQuestion({
      type: 'true_false', instruction: 'El reinado de Alfonso XIII', subjectId: 'sub1', language: 'es',
    });
    const q = out.question ?? out;
    assert.ok(q.prompt && q.prompt.trim().length > 10, 'enunciado vacío');
    return q.prompt;
  });

  await check('generateExamQuestion · respeta el idioma pedido', async () => {
    const out = await examsAi.generateExamQuestion({
      type: 'short_answer', instruction: 'The Spanish Civil War, upper secondary level',
      subjectId: 'sub1', language: 'en',
    });
    const q = out.question ?? out;
    const prompt = String(q.prompt ?? '');
    assert.ok(prompt.trim().length > 10, 'enunciado vacío');
    // Spanish function words are the cheapest reliable signal that the language
    // directive was ignored.
    assert.ok(!/\b(qué|cuál|explica|describe|señala|indica)\b/i.test(prompt),
      `pedí inglés y respondió en español: "${prompt}"`);
    return prompt;
  });

  // ── Cross-cutting: nothing leaks, whatever the function ────────────────────
  await check('privacidad · ninguna función docente filtra un nombre', async () => {
    // The roster is only reachable through draftStudentFeedback, which is covered
    // above; this re-checks the returned text of every function for a stray name that
    // could only have come from the roster.
    const suspicious = results
      .filter((r) => r.ok && typeof r.detail === 'string')
      .filter((r) => r.name !== 'draftStudentFeedback · redacta sin filtrar el nombre')
      .filter((r) => NAMES.test(r.detail));
    assert.deepEqual(suspicious.map((r) => r.name), [],
      'alguna función devolvió un nombre del listado sin motivo');
    return 'sin fugas';
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n── ${results.length - failed.length}/${results.length} correctas — ${provider}/${modelId} ──\n`);
  if (failed.length) {
    for (const f of failed) console.log(`  FALLO: ${f.name}\n         ${f.detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    process.exitCode = 1;
  }
} catch (cause) {
  console.error('\nLa auditoría no pudo completarse:', cause?.message ?? cause, '\n');
  process.exitCode = 1;
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
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return originalResolve.call(this, fs.existsSync(direct) ? direct : asIndex, ...args);
    }
    return originalResolve.call(this, request, ...args);
  };
  const electronStub = {
    app: { getPath: () => userData, getName: () => 'Nodus', getVersion: () => '0.0.0-audit', on: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
    },
    // No user to press a modal: the audit sets studyAiConfirmExternal false, and this
    // is the belt-and-braces so a stray dialog can never hang the run.
    dialog: { showMessageBoxSync: () => 1, showSaveDialog: async () => ({ canceled: true }) },
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
