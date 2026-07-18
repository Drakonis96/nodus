// Live AI check for the rubric builder: whole-rubric generation (from a prompt and
// from an uploaded document) and per-cell descriptor filling. Not in `npm test` — it
// spends real tokens.
//
//   GEMINI_API_KEY=... node scripts/verify-rubric-generation.mjs
//   RUBRIC_VERIFY_PROVIDER=ollama RUBRIC_VERIFY_MODEL=qwen2.5:7b node scripts/verify-rubric-generation.mjs
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

if (!process.argv.includes('--electron-rubric-generation')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-rubric-generation.mjs'), '--electron-rubric-generation'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const provider = process.env.RUBRIC_VERIFY_PROVIDER || 'gemini';
const apiKey = process.env.GEMINI_API_KEY;
if (provider === 'gemini' && !apiKey) {
  console.error('Set GEMINI_API_KEY (or RUBRIC_VERIFY_PROVIDER=ollama) to run this check.');
  process.exit(1);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-rubric-gen-'));
installRuntimeHooks(root);

const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
const repo = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));
const { fillRubricCell, generateRubric } = require(path.join(repoRoot, 'electron/ai/teachingRubrics.ts'));
const { rubricDocxBytes } = require(path.join(repoRoot, 'electron/export/rubricExport.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const model = require(path.join(repoRoot, 'shared/teachingRubrics.ts'));

if (provider === 'gemini') {
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
}

const modelRef = provider === 'gemini'
  ? { provider: 'gemini', model: process.env.RUBRIC_VERIFY_MODEL || 'gemini-2.5-flash-lite' }
  : { provider, model: process.env.RUBRIC_VERIFY_MODEL || 'qwen2.5:7b' };

settingsRepo.updateSettings({
  studyAiEnabled: true, studyAiPrivacyMode: 'balanced', studyAiLocalOnly: false, studyAiConfirmExternal: false,
  synthesisModel: modelRef, studyModel: modelRef, questionGenModel: modelRef,
});

const course = org.createStudyCourse({ name: 'Lengua castellana' });
const subject = org.createStudySubject({ courseId: course.id, name: 'Escritura académica' });

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (error) { failures += 1; console.error(`  ✗ ${name}: ${error.message}`); }
};

console.log(`\nGenerating with ${modelRef.provider}/${modelRef.model}\n`);

/* ---- 1. whole rubric from the teacher's prompt ---- */
process.stdout.write('generate from prompt … ');
let generated;
try {
  generated = await generateRubric({
    source: { kind: 'prompt' },
    instruction: 'Ensayo argumentativo de 1500 palabras sobre la Revolución Industrial, 2º de Bachillerato',
    subjectId: subject.id, courseId: course.id, language: 'es', scaleMax: 10,
    levelCount: 4, criteriaCount: 4, weighted: true,
  });
  console.log('done');
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ threw: ${error.message}`);
}

if (generated) {
  const r = generated.rubric;
  check('returns the requested number of levels', () => assert.equal(r.levels.length, 4));
  check('returns the requested number of criteria', () => assert.equal(r.criteria.length, 4));
  check('levels are ordered best-first with descending scores', () => {
    const scores = r.levels.map((level) => level.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `not descending: ${scores}`);
    assert.equal(scores[0], 10, 'top level must award the full scale');
  });
  check('every criterion is named', () => assert.ok(r.criteria.every((c) => c.name.trim())));
  check('every cell of every criterion is filled', () => {
    for (const criterion of r.criteria) {
      for (const level of r.levels) {
        assert.ok((criterion.cells[level.id] ?? '').trim(), `empty cell: ${criterion.name} / ${level.label}`);
      }
    }
  });
  check('weights total 100', () => assert.equal(model.rubricWeightTotal(r.criteria), 100));
  check('descriptors are in Spanish', () => {
    const sample = r.criteria[0].cells[r.levels[0].id];
    assert.ok(!/\b(the|and|with|student)\b/i.test(sample), `looks English: ${sample}`);
  });
  check('the generated rubric passes structural validation', () => {
    const saved = { ...r, id: 'X', shortId: 'X', createdAt: '', updatedAt: '', description: r.description ?? '' };
    const errors = model.validateRubric(saved).filter((issue) => issue.severity === 'error');
    assert.deepEqual(errors, [], JSON.stringify(errors));
  });
  // The AI draft is run through our own quality checks — that is the feature.
  const warnings = model.rubricQualityWarnings({ ...r, id: 'X', shortId: 'X', createdAt: '', updatedAt: '', description: '' });
  console.log(`    quality review of the AI draft: ${warnings.length} suggestion(s)`);
}

/* ---- 2. whole rubric from an uploaded document ---- */
const brief = path.join(root, 'tarea.txt');
fs.writeFileSync(brief, [
  'TAREA: Presentación oral en grupo (10 minutos) sobre un problema medioambiental local.',
  'Se valorará: la calidad de la investigación y las fuentes, la claridad de la exposición,',
  'el uso del soporte visual, el reparto del trabajo en el grupo y la respuesta a las preguntas del público.',
].join('\n'), 'utf8');

process.stdout.write('generate from document … ');
try {
  const fromDoc = await generateRubric({
    source: { kind: 'file', filePath: brief },
    instruction: 'Genera la rúbrica de esta tarea',
    subjectId: subject.id, language: 'es', scaleMax: 5, levelCount: 3, criteriaCount: 3, weighted: false,
  });
  console.log('done');
  check('the document was actually read', () => assert.ok(fromDoc.sourceChars > 100, `only ${fromDoc.sourceChars} chars`));
  check('respects the requested 3x3 shape', () => {
    assert.equal(fromDoc.rubric.levels.length, 3);
    assert.equal(fromDoc.rubric.criteria.length, 3);
  });
  check('the criteria reflect the brief', () => {
    const text = JSON.stringify(fromDoc.rubric.criteria).toLowerCase();
    assert.ok(/fuente|investiga|expos|visual|grupo|pregunt/.test(text), `unrelated to the brief: ${text.slice(0, 200)}`);
  });
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ generate-from-document threw: ${error.message}`);
}

/* ---- 3. per-cell fill, with the whole table as context ---- */
const saved = repo.createTeachingRubric({
  title: 'Presentación oral', subjectId: subject.id, courseId: course.id, language: 'es', scaleMax: 5,
});
const criterion = saved.criteria[0];
repo.updateTeachingRubric(saved.id, {
  criteria: saved.criteria.map((entry, index) =>
    index === 0
      ? { ...entry, name: 'Claridad de la exposición', cells: { [saved.levels[0].id]: 'Expone con un hilo argumental nítido y un ritmo que el público sigue sin esfuerzo.' } }
      : entry
  ),
});

process.stdout.write('fill one cell … ');
try {
  const filled = await fillRubricCell({ rubricId: saved.id, criterionId: criterion.id, levelId: saved.levels[1].id });
  console.log('done');
  check('returns a usable descriptor', () => assert.ok(filled.text.length > 15, `too short: ${filled.text}`));
  check('is plain text, not markdown or a quoted string', () => {
    assert.ok(!/^["'`]|["'`]$/.test(filled.text), `wrapped: ${filled.text}`);
    assert.ok(!/^[-*#]/.test(filled.text), `markdown: ${filled.text}`);
  });
  check('does not just repeat the level name', () => {
    assert.notEqual(filled.text.trim().toLowerCase(), saved.levels[1].label.toLowerCase());
  });
  check('writes into the right cell only', () => {
    const after = repo.setTeachingRubricCell(saved.id, criterion.id, saved.levels[1].id, filled.text);
    assert.equal(after.criteria[0].cells[saved.levels[1].id], filled.text);
    assert.ok((after.criteria[0].cells[saved.levels[0].id] ?? '').includes('hilo argumental'), 'the neighbouring cell was disturbed');
  });
  console.log(`    → "${filled.text.slice(0, 110)}${filled.text.length > 110 ? '…' : ''}"`);
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ fill-cell threw: ${error.message}`);
}

/* ---- 4. the result exports ---- */
try {
  const detail = repo.getTeachingRubric(saved.id);
  const docx = await rubricDocxBytes(detail, { includeScores: true, includeScoreColumn: true });
  check('the saved rubric exports to a real .docx', () => {
    assert.ok(docx.length > 4000 && docx.subarray(0, 2).toString('latin1') === 'PK', `bad docx (${docx.length})`);
  });
} catch (error) {
  failures += 1;
  console.error(`  ✗ export threw: ${error.message}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
if (provider === 'gemini') secrets.clearApiKey('gemini');
closeDb();
await rm(root, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-rubric-verify', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
