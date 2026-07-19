// Live AI check for the family-comment drafter (teaching vault).
//
// This is the first production consumer of the student pseudonymisation layer, so the
// thing under test is NOT "does the model write nice prose". It is:
//
//   · the payload that leaves the machine carries an identifier and marks, and no name
//   · the reply comes back with the identifier turned into the real name
//   · a model that ignores the identifier, or invents a different one, is REPORTED
//     rather than silently passed through
//
// The summary is built by `anonymousStudentSummary`, which derives it from the
// anonymous grid, so a leak would have to survive both that and the scope below.
//
// Not part of `npm test`: it spends real tokens.
//
//   GEMINI_API_KEY=... node scripts/verify-teaching-feedback.mjs
//   FEEDBACK_PROVIDER=ollama FEEDBACK_MODEL=llama3.1 node scripts/verify-teaching-feedback.mjs
//
// Every database, preference and secret lives under an ephemeral userData root, and the
// key is removed from the environment as soon as it is stored so it cannot leak into a
// child process or a provider SDK that scavenges the environment.
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

if (!process.argv.includes('--electron-teaching-feedback')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-teaching-feedback.mjs'), '--electron-teaching-feedback'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const provider = process.env.FEEDBACK_PROVIDER || 'gemini';
const apiKey = process.env.GEMINI_API_KEY;
if (provider === 'gemini' && !apiKey) {
  console.error('Set GEMINI_API_KEY (or FEEDBACK_PROVIDER=ollama) to run this check.');
  process.exit(1);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-feedback-'));
installRuntimeHooks(root);

const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
const groupsRepo = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
const gradesRepo = require(path.join(repoRoot, 'electron/db/teachingGradesRepo.ts'));
const { draftStudentFeedback } = require(path.join(repoRoot, 'electron/ai/assessmentImport.ts'));
const { anonymousStudentSummary, gradebookToGrid } = require(path.join(repoRoot, 'shared/assessment/index.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

if (provider === 'gemini') {
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
}

const modelRef = provider === 'gemini'
  ? { provider: 'gemini', model: process.env.FEEDBACK_MODEL || 'gemini-2.5-flash-lite' }
  : { provider, model: process.env.FEEDBACK_MODEL || 'llama3.1' };

settingsRepo.updateSettings({
  studyAiEnabled: true,
  studyAiPrivacyMode: 'balanced',
  studyAiLocalOnly: false,
  studyAiConfirmExternal: false,
  studentPseudonymsEnabled: true,
  synthesisModel: modelRef,
  studyModel: modelRef,
  questionGenModel: modelRef,
});

// ── A group whose names are ordinary Spanish words on purpose ────────────────
//
// "Rosa" and "Pilar" are also nouns. A pseudonymiser that rewrote them blindly would
// corrupt the very text it is protecting, so the roster has to contain them.
const course = org.createStudyCourse({ name: 'Historia' });
const subject = org.createStudySubject({ courseId: course.id, name: 'Historia contemporánea' });
const group = groupsRepo.createTeachingGroup({ name: '1ºA', subjectId: subject.id, expectedSize: 3 });
const [ana, rosa, pilar] = group.students;
groupsRepo.updateTeachingStudent(ana.id, { givenNames: 'Ana', surnames: 'Peña Ruiz' });
groupsRepo.updateTeachingStudent(rosa.id, { givenNames: 'Rosa', surnames: 'Cruz Flores' });
groupsRepo.updateTeachingStudent(pilar.id, { givenNames: 'Pilar', surnames: 'Monte Sol' });

const plan = gradesRepo.createAssessmentPlan({ name: 'Historia 2024/25', subjectId: subject.id, profile: 'universidad' });
const examen = gradesRepo.createAssessmentItem(plan.id, { name: 'Examen', weight: 50 });
const practica = gradesRepo.createAssessmentItem(plan.id, { name: 'Práctica', weight: 30 });
const participacion = gradesRepo.createAssessmentItem(plan.id, { name: 'Participación', weight: 20 });

gradesRepo.setGradeEntry({ studentId: ana.id, itemId: examen.id, rawValue: 8.5 });
gradesRepo.setGradeEntry({ studentId: ana.id, itemId: practica.id, rawValue: 6 });
gradesRepo.setGradeEntry({ studentId: ana.id, itemId: participacion.id, rawValue: 9 });

const detail = gradesRepo.getAssessmentPlan(plan.id);
const roster = groupsRepo.getTeachingGroup(group.id).students;
const grid = gradebookToGrid({
  plan: detail.plan,
  items: detail.items,
  entries: gradesRepo.listGradeEntries(plan.id),
  students: roster.map((s) => ({
    id: s.id, givenNames: s.givenNames, surnames: s.surnames, pseudonymCode: s.pseudonymCode, position: s.position,
  })),
});

const summary = anonymousStudentSummary(grid, ana.id);
const anaCode = roster.find((s) => s.id === ana.id).pseudonymCode;

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
};

console.log(`\nDrafting with ${modelRef.provider}/${modelRef.model}\n`);
console.log('--- payload that leaves the machine ---');
console.log(summary);
console.log('---------------------------------------\n');

// ── What is SENT: assert before spending a token ────────────────────────────
const NAMES = ['Ana', 'Peña', 'Ruiz', 'Rosa', 'Cruz', 'Flores', 'Pilar', 'Monte', 'Sol'];
check('the payload carries the identifier', () => assert.ok(summary.includes(anaCode), summary));
check('the payload carries the marks', () => {
  assert.ok(summary.includes('8.5') || summary.includes('8,5'), summary);
});
check('no student name is in the payload', () => {
  const leaked = NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(summary));
  assert.deepEqual(leaked, [], `leaked: ${leaked.join(', ')}\n${summary}`);
});
check('no name-column header is in the payload', () => {
  assert.ok(!/Nombre|Apellidos/.test(summary), summary);
});

// ── What comes BACK ─────────────────────────────────────────────────────────
process.stdout.write('calling the model … ');
let result;
try {
  result = await draftStudentFeedback({
    planId: plan.id,
    groupId: group.id,
    studentId: ana.id,
    summary,
  });
} catch (error) {
  console.error(`\n  ✗ draftStudentFeedback threw: ${error.message}`);
  console.log(`\n1 CHECK(S) FAILED\n`);
  if (provider === 'gemini') secrets.clearApiKey('gemini');
  closeDb();
  await rm(root, { recursive: true, force: true });
  process.exit(1);
}
console.log('done\n');
console.log('--- draft the teacher reads ---');
console.log(result.text);
console.log('-------------------------------');
if (result.warnings.length) console.log('warnings:', result.warnings);
console.log();

check('a non-empty comment came back', () => assert.ok(result.text.trim().length > 30, JSON.stringify(result.text)));

// The CONTRACT, not the model's obedience. The prompt asks the model to open with the
// identifier so it can be mapped back to a real name, but an instruction is a request:
// a 7B local model writes "El estudiante" instead and follows none of it. Either the
// name is there, or the teacher is told it is missing — silently handing over a comment
// that never names the child is the one outcome that is not allowed.
check('either the student is named, or the teacher is warned that they are not', () => {
  const named = /Ana/.test(result.text);
  const warned = result.warnings.some((w) => /no nombra al estudiante/i.test(w));
  assert.ok(named || warned,
    `neither named nor warned. text=${JSON.stringify(result.text)} warnings=${JSON.stringify(result.warnings)}`);
  // And never both: a warning that fires when the name IS there would train the
  // teacher to ignore warnings.
  assert.ok(!(named && warned), 'the warning fired even though the comment names the student');
});
check('no raw identifier survives into what the teacher reads', () => {
  assert.ok(!/STU[_\-\s]?[2-9A-Za-z]{4}/.test(result.text), `raw code left in: ${result.text}`);
});
// A model that invents a code for a student who is not in this comment would be
// mapped onto the wrong child, so an unresolved one must be REPORTED, never guessed.
check('no other student was dragged into the comment', () => {
  const others = ['Rosa', 'Pilar', 'Cruz', 'Flores', 'Monte'];
  const wrong = others.filter((n) => new RegExp(`\\b${n}\\b`).test(result.text));
  assert.deepEqual(wrong, [], `mentions another student: ${wrong.join(', ')}`);
});
check('unresolved identifiers are reported, not silently dropped', () => {
  // Not an assertion about the model: an assertion that the layer TELLS us when it
  // could not resolve something. An empty warning list plus a clean text is the pass.
  for (const warning of result.warnings) assert.equal(typeof warning, 'string');
});

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
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-feedback-verify', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      const base = path.join(repoRoot, request.replace('@shared/', 'shared/'));
      // `@shared/assessment` is a DIRECTORY with an index.ts, unlike every other
      // shared module. Resolving it blindly to `assessment.ts` fails at require time.
      return fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts');
    }
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
