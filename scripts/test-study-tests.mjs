// Study vault phase 10b: deterministic objective grading, durable timed attempts,
// manual/random/adaptive construction, retries, statistics and printable export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-tests-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-tests.mjs'), '--electron-study-tests-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-tests-'));
installRuntimeHooks(root);
try {
  const shared = require(path.join(repoRoot, 'shared/studyAssessments.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const tests = require(path.join(repoRoot, 'electron/db/studyAssessmentsRepo.ts'));
  const builder = require(path.join(repoRoot, 'electron/ai/studyTests.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const course = org.createStudyCourse({ name: 'Biología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Genética' });
  const base = { status: 'approved', difficulty: 'medium', cognitiveLevel: 'understand', courseId: course.id, subjectId: subject.id, explanation: 'Comprobado en el manual.', source: { title: 'Manual', excerpt: 'El ADN contiene la información genética y la adenina se empareja con timina.' } };
  const single = bank.createStudyQuestion({ ...base, prompt: '¿Qué molécula contiene la información genética?', type: 'single_choice', answer: { text: 'ADN' }, options: [{ id: 'A', text: 'ADN', correct: true }, { id: 'B', text: 'ATP', correct: false }] });
  const truth = bank.createStudyQuestion({ ...base, prompt: 'La adenina se empareja con timina.', type: 'true_false', answer: { value: true } });
  const short = bank.createStudyQuestion({ ...base, prompt: 'Escribe la sigla del ácido desoxirribonucleico.', type: 'short', answer: { text: 'ADN', value: ['ADN', 'DNA'] } });

  const singleEvaluation = shared.evaluateStudyQuestionResponse(single, { value: 'A' }, 2, { negativePoints: 0.5, blankPoints: 0 });
  assert.equal(singleEvaluation.correct, true); assert.equal(singleEvaluation.pointsAwarded, 2);
  assert.equal(shared.evaluateStudyQuestionResponse(truth, { value: false }, 1, { negativePoints: 0.25, blankPoints: 0 }).pointsAwarded, -0.25);
  assert.equal(shared.evaluateStudyQuestionResponse(short, { text: 'dna' }, 1, { negativePoints: 0, blankPoints: 0 }).correct, true, 'accepted alternatives are accent/case insensitive');
  assert.equal(shared.evaluateStudyQuestionResponse(short, {}, 1, { negativePoints: 0, blankPoints: 0 }).omitted, true);
  assert.deepEqual(shared.seededShuffle([1, 2, 3, 4], 42), shared.seededShuffle([1, 2, 3, 4], 42), 'seeded ordering is reproducible');

  getDb().prepare('UPDATE study_questions SET usage_count=10, correct_count=9, incorrect_count=1 WHERE id=?').run(single.id);
  getDb().prepare('UPDATE study_questions SET usage_count=10, correct_count=2, incorrect_count=8 WHERE id=?').run(truth.id);
  const adaptive = builder.selectStudyTestQuestions({ title: 'Adaptativo', count: 2, selection: 'adaptive', subjectId: subject.id }, bank.listStudyQuestions({ status: 'approved' }));
  assert.equal(adaptive[0].id, truth.id, 'adaptive selection starts with the weakest question');

  const assessment = builder.buildStudyTest({
    title: 'Test genética', count: 3, selection: 'manual', questionIds: [single.id, truth.id, short.id], subjectId: subject.id, durationMinutes: 15,
    config: { correctionMode: 'immediate', randomizeQuestions: true, randomizeOptions: true, showExplanations: true, negativePoints: 0.25, blankPoints: 0, seed: 73 },
  });
  assert.equal(assessment.items.length, 3); assert.equal(assessment.config.seed, 73);
  const attempt = tests.startStudyAttempt({ assessmentId: assessment.id, mode: 'practice' });
  assert.equal(attempt.config.questionOrder.length, 3); assert.equal(attempt.status, 'in_progress');
  const singleItem = assessment.items.find((item) => item.questionId === single.id);
  const truthItem = assessment.items.find((item) => item.questionId === truth.id);
  const shortItem = assessment.items.find((item) => item.questionId === short.id);
  const immediate = tests.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: singleItem.id, response: { value: 'A' }, responseMs: 1200, confidence: 3 });
  assert.equal(immediate.isCorrect, true, 'practice mode reveals immediate correction');
  const wrong = tests.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: truthItem.id, response: { value: false }, responseMs: 900, flagged: true });
  assert.equal(wrong.isCorrect, false); assert.equal(wrong.flagged, true);
  tests.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: shortItem.id, response: {}, responseMs: 300 });
  assert.equal(bank.getStudyQuestion(single.id).usageCount, 10, 'saving never changes statistics before submission');
  const submitted = tests.submitStudyAttempt(attempt.id);
  assert.equal(submitted.status, 'submitted'); assert.equal(submitted.correctCount, 1); assert.equal(submitted.incorrectCount, 1); assert.equal(submitted.omittedCount, 1);
  assert.equal(submitted.score, 0.75); assert.equal(submitted.maxScore, 3);
  assert.equal(bank.getStudyQuestion(single.id).usageCount, 11, 'submission records exactly one use');
  const analytics = bank.getStudyQuestionAnalytics(single.id);
  assert.equal(analytics.observedDifficulty, 'too_easy');
  assert.equal(analytics.optionSelections.find((option) => option.optionId === 'A').selectedCount, 1, 'distractor analysis reads durable answers');
  assert.ok(analytics.averageResponseMs > 0, 'response time is aggregated');
  tests.submitStudyAttempt(attempt.id);
  assert.equal(bank.getStudyQuestion(single.id).usageCount, 11, 'resubmission is idempotent');
  const retryErrors = tests.startStudyAttempt({ assessmentId: assessment.id, mode: 'practice', retryKind: 'errors', sourceAttemptId: submitted.id });
  assert.equal(retryErrors.config.questionOrder.length, 2, 'errors retry includes wrong and blank objective responses');
  const retryFlagged = tests.startStudyAttempt({ assessmentId: assessment.id, mode: 'practice', retryKind: 'flagged', sourceAttemptId: submitted.id });
  assert.equal(retryFlagged.config.questionOrder.length, 1);
  assert.match(tests.renderStudyAssessmentMarkdown(assessment, true), /# Test genética/); assert.match(tests.renderStudyAssessmentMarkdown(assessment, true), /Respuesta:/);
  assert.equal(tests.listStudyAttempts(assessment.id).length, 3);

  const view = await readFile(path.join(repoRoot, 'src/views/StudyTestView.tsx'), 'utf8');
  for (const marker of ['study-tests-view', 'study-test-builder', 'study-test-runner', 'study-test-results', 'study-test-submit']) assert.match(view, new RegExp(marker));
  closeDb(); console.log('Study tests phase 10b tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) { if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`); return originalResolveFilename.call(this, request, parent, isMain, options); };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) { const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText; module._compile(output, filename); };
}
