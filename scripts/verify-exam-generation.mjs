// Live AI check for the exam paper builder.
//
// Generates one question of several types against a real provider and asserts the
// structured shape each type needs (options + a marked answer, matching pairs, ordered
// items…). Not part of `npm test`: it spends real tokens.
//
//   GEMINI_API_KEY=... node scripts/verify-exam-generation.mjs
//   EXAM_VERIFY_PROVIDER=ollama EXAM_VERIFY_MODEL=llama3.1 node scripts/verify-exam-generation.mjs
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

if (!process.argv.includes('--electron-exam-generation')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-exam-generation.mjs'), '--electron-exam-generation'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const provider = process.env.EXAM_VERIFY_PROVIDER || 'gemini';
const apiKey = process.env.GEMINI_API_KEY;
if (provider === 'gemini' && !apiKey) {
  console.error('Set GEMINI_API_KEY (or EXAM_VERIFY_PROVIDER=ollama) to run this check.');
  process.exit(1);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-exam-gen-'));
installRuntimeHooks(root);

const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
const exams = require(path.join(repoRoot, 'electron/db/teachingExamsRepo.ts'));
const { generateExamQuestion } = require(path.join(repoRoot, 'electron/ai/teachingExamQuestions.ts'));
const { examDocxBytes } = require(path.join(repoRoot, 'electron/export/examExport.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const model = require(path.join(repoRoot, 'shared/teachingExams.ts'));

if (provider === 'gemini') {
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
}

const modelRef = provider === 'gemini'
  ? { provider: 'gemini', model: process.env.EXAM_VERIFY_MODEL || 'gemini-2.5-flash-lite' }
  : { provider, model: process.env.EXAM_VERIFY_MODEL || 'llama3.1' };

settingsRepo.updateSettings({
  studyAiEnabled: true,
  studyAiPrivacyMode: 'balanced',
  studyAiLocalOnly: false,
  studyAiConfirmExternal: false,
  synthesisModel: modelRef,
  studyModel: modelRef,
  questionGenModel: modelRef,
});

const course = org.createStudyCourse({ name: 'Historia contemporánea' });
const subject = org.createStudySubject({ courseId: course.id, name: 'Revoluciones industriales' });

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

console.log(`\nGenerating with ${modelRef.provider}/${modelRef.model}\n`);

const cases = [
  { type: 'multiple_choice', instruction: 'Una pregunta sobre las causas de la Revolución Industrial', optionCount: 4, language: 'es' },
  { type: 'true_false', instruction: 'Una afirmación sobre la máquina de vapor', language: 'es' },
  { type: 'matching', instruction: 'Relacionar inventos del siglo XIX con sus autores', language: 'es' },
  { type: 'ordering', instruction: 'Ordenar cronológicamente cuatro hitos de la industrialización', language: 'es' },
  { type: 'short_essay', instruction: 'Explain the social consequences of industrialisation', language: 'en' },
];

const generated = [];
for (const testCase of cases) {
  process.stdout.write(`${testCase.type} … `);
  let result;
  try {
    result = await generateExamQuestion({
      type: testCase.type,
      instruction: testCase.instruction,
      subjectId: subject.id,
      courseId: course.id,
      language: testCase.language,
      optionCount: testCase.optionCount,
    });
  } catch (error) {
    failures += 1;
    console.error(`\n  ✗ ${testCase.type} threw: ${error.message}`);
    continue;
  }
  console.log('done');
  const question = result.question;
  generated.push({ ...question, id: `q${generated.length}`, shortId: `S${generated.length}`, examId: 'E', position: generated.length, createdAt: '', updatedAt: '' });

  check(`${testCase.type}: has a prompt`, () => assert.ok(question.prompt.trim().length > 10, `prompt too short: ${JSON.stringify(question.prompt)}`));
  check(`${testCase.type}: marked as AI generated`, () => assert.equal(question.generatedBy, 'ai'));
  check(`${testCase.type}: keeps the teacher's instruction`, () => assert.equal(question.aiPrompt, testCase.instruction));

  if (testCase.type === 'multiple_choice') {
    check('multiple_choice: option count respected', () => assert.equal(question.options.length, 4));
    check('multiple_choice: every option has text', () => assert.ok(question.options.every((o) => o.text.trim())));
    check('multiple_choice: exactly one correct answer', () => assert.equal(question.options.filter((o) => o.correct).length, 1));
  }
  if (testCase.type === 'true_false') {
    check('true_false: two options', () => assert.equal(question.options.length, 2));
    check('true_false: exactly one correct', () => assert.equal(question.options.filter((o) => o.correct).length, 1));
  }
  if (testCase.type === 'matching') {
    check('matching: at least two complete pairs', () => assert.ok(question.pairs.filter((p) => p.left.trim() && p.right.trim()).length >= 2, `got ${question.pairs.length} pairs`));
  }
  if (testCase.type === 'ordering') {
    check('ordering: at least two items', () => assert.ok(question.items.filter(Boolean).length >= 2, `got ${question.items.length} items`));
  }
  if (testCase.language === 'en') {
    // A Spanish-only answer would mean the language directive was ignored.
    check('english question is not written in Spanish', () => {
      assert.ok(!/\b(el|la|los|las|una|qué|cuáles|explica)\b/i.test(question.prompt), `looks Spanish: ${question.prompt}`);
    });
  }
  // The generated shape must survive validation, or the teacher cannot export.
  check(`${testCase.type}: passes exam validation`, () => {
    const issues = model.validateExam({ id: 'E', subjectId: subject.id, language: testCase.language }, [{ ...question, id: 'q', options: question.options ?? [], pairs: question.pairs ?? [], items: question.items ?? [], imageDataUrl: question.type === 'image_comment' ? 'data:image/png;base64,x' : null }]);
    assert.deepEqual(issues.filter((i) => i.field !== 'subject'), [], JSON.stringify(issues));
  });
}

// The whole point is a printable document: prove the generated questions export.
const exam = exams.createTeachingExam({ title: 'Examen generado', subjectId: subject.id, language: 'es' });
for (const question of generated) exams.addTeachingExamQuestion(exam.id, question);
const detail = exams.getTeachingExam(exam.id);
const docx = await examDocxBytes(detail, detail.questions, { includeAnswerKey: true });
check('generated questions export to a real .docx', () => {
  assert.ok(docx.length > 5000 && docx.subarray(0, 2).toString('latin1') === 'PK', `bad docx (${docx.length} bytes)`);
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
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-exam-verify', getAppPath: () => repoRoot, isPackaged: false },
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
