// Study vault phase 10d: source-grounded streaming grading, weighted rubrics,
// uncertainty, annotations, auditable history and explicit manual override.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-grading-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-grading.mjs'), '--electron-study-grading-test'], { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }); process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-grading-')); installRuntimeHooks(root);
try {
  const shared = require(path.join(repoRoot, 'shared/studyGrading.ts'));
  const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const assessments = require(path.join(repoRoot, 'electron/db/studyAssessmentsRepo.ts'));
  const gradingRepo = require(path.join(repoRoot, 'electron/db/studyGradingRepo.ts'));
  const grading = require(path.join(repoRoot, 'electron/ai/studyGrading.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const normalized = shared.normalizeStudyRubricCriteria([{ id: 'a', label: 'A', description: '', weight: 2 }, { id: 'b', label: 'B', description: '', weight: 1 }]);
  assert.equal(Math.round(normalized.reduce((sum, item) => sum + item.weight, 0) * 100), 100); assert.throws(() => shared.normalizeStudyRubricCriteria([]), /criterio/);
  const rubrics = gradingRepo.listStudyRubrics(); assert.ok(rubrics.length >= 2); const rubric = rubrics.find((item) => item.name === 'Respuesta de desarrollo'); assert.equal(rubric.builtIn, true);
  assert.throws(() => gradingRepo.updateStudyRubric(rubric.id, { name: 'No permitido' }), /Duplica/); assert.equal(gradingRepo.duplicateStudyRubric(rubric.id).builtIn, false);

  const question = bank.createStudyQuestion({
    prompt: 'Explica los efectos sociales de la industrialización.', type: 'essay', difficulty: 'hard', cognitiveLevel: 'analyze', status: 'approved',
    answer: { text: 'Debe explicar urbanización, trabajo fabril y transformación social.' }, explanation: 'Derivada del fragmento exacto.',
    source: { title: 'Manual local', excerpt: 'La industrialización impulsó la urbanización y transformó el trabajo mediante el sistema fabril.' }, locked: true,
  });
  const exam = assessments.createStudyAssessment({ kind: 'exam', title: 'Examen corregible', questionIds: [question.id], points: { [question.id]: 10 }, config: { selection: 'manual', correctionMode: 'end', randomizeQuestions: false, randomizeOptions: false, showExplanations: true, negativePoints: 0, blankPoints: 0 } });
  const attempt = assessments.startStudyAttempt({ assessmentId: exam.id, mode: 'exam' }); const answer = assessments.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: exam.items[0].id, response: { text: 'La industrialización impulsó la urbanización y cambió el trabajo fabril.' }, responseMs: 20_000 }); assessments.submitStudyAttempt(attempt.id);
  const prompt = grading.buildStudyGradingPrompt({ question: question.prompt, answer: answer.response.text, modelAnswer: question.answer.text, rubric, sources: [{ title: question.source.title, excerpt: question.source.excerpt }], severity: 'strict', maxScore: 10 });
  assert.match(prompt.system, /únicamente/); assert.match(prompt.system, /ESTIMACIÓN/); assert.match(prompt.user, /Manual local/);
  let streamed = '';
  const run = await grading.gradeStudyAnswer({ attemptAnswerId: answer.id, rubricId: rubric.id, severity: 'balanced', model: { provider: 'ollama', model: 'grading-verifier' } }, (delta) => { streamed += delta; });
  assert.ok(streamed.length > 20, 'structured grading is delivered through the streaming path'); assert.equal(run.estimatedScore, 8.05); assert.equal(run.result.maxScore, 10);
  assert.equal(run.sources[0].excerpt, question.source.excerpt, 'stored provenance is the exact local source excerpt'); assert.match(run.result.uncertainty, /fuente local/); assert.equal(run.annotations.length, 2); assert.equal(run.annotations.find((annotation) => annotation.kind === 'omission').to, answer.response.text.length, 'annotation ranges are clamped to the submitted response');
  assert.equal(gradingRepo.listStudyGradingRuns(answer.id).length, 1); assert.equal(run.manualScore, null);
  const confirmed = gradingRepo.setStudyGradingManualScore(run.id, 7.5, 'Nota revisada por la docente.'); assert.equal(confirmed.manualScore, 7.5); assert.match(confirmed.manualComment, /docente/);
  const refreshedAttempt = assessments.getStudyAttempt(attempt.id); assert.equal(refreshedAttempt.score, 7.5, 'manual score becomes the official attempt score');
  assert.equal(refreshedAttempt.answers[0].feedback.manualScore, 7.5);
  const liveAttempt = assessments.startStudyAttempt({ assessmentId: exam.id, mode: 'exam' });
  const liveAnswer = assessments.saveStudyAttemptAnswer(liveAttempt.id, { assessmentItemId: exam.items[0].id, response: { text: 'La urbanización y el trabajo fabril transformaron las relaciones sociales.' } });
  const liveRun = await grading.gradeStudyAnswer({ attemptAnswerId: liveAnswer.id, rubricId: rubric.id, severity: 'balanced', model: { provider: 'ollama', model: 'grading-verifier' } }, () => undefined);
  gradingRepo.setStudyGradingManualScore(liveRun.id, liveRun.estimatedScore, liveRun.result.generalFeedback);
  const liveSubmitted = assessments.submitStudyAttempt(liveAttempt.id);
  assert.equal(liveSubmitted.score, liveRun.estimatedScore, 'AI score survives final exam submission');
  const refreshedQuestion = bank.getStudyQuestion(question.id);
  assert.match(refreshedQuestion.lastResponse, /urbanización/);
  assert.equal(refreshedQuestion.lastScore, liveRun.estimatedScore);
  assert.equal(refreshedQuestion.lastMaxScore, 10);

  closeDb(); console.log('Study grading phase 10d tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module'); const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) { if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`); return originalResolveFilename.call(this, request, parent, isMain, options); };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (parent?.filename?.endsWith('/electron/ai/studyGrading.ts') && request === './aiClient') return {
      resolveModelRef: (model) => model ?? { provider: 'ollama', model: 'grading-verifier' },
      completeTextStream: async (_options, onDelta) => {
        const payload = JSON.stringify({ criteria: [
          { criterionId: 'accuracy', score: 0.8, rationale: 'Conceptos principales correctos.', evidence: 'urbanización y trabajo fabril' },
          { criterionId: 'argument', score: 0.6, rationale: 'Relación breve pero coherente.', evidence: 'cambió el trabajo' },
          { criterionId: 'evidence', score: 1, rationale: 'Usa sólo conceptos respaldados.', evidence: 'industrialización y urbanización' },
          { criterionId: 'clarity', score: 0.9, rationale: 'Respuesta clara.', evidence: 'frase directa' },
        ], generalFeedback: 'Respuesta correcta pero poco desarrollada.', correctedAnswer: 'La industrialización impulsó la urbanización y transformó el trabajo mediante el sistema fabril.', strengths: ['Identifica la urbanización.'], errors: [], omissions: ['Falta desarrollar la transformación social.'], doubts: ['La respuesta es muy breve.'], uncertainty: 'Estimación limitada al fragmento de la fuente local.', annotations: [{ from: 3, to: 20, kind: 'strength', severity: 'info', message: 'Concepto respaldado.' }, { from: 0, to: 9999, kind: 'omission', severity: 'minor', message: 'Respuesta demasiado breve.', suggestion: 'Desarrollar la relación.' }] });
        onDelta(payload.slice(0, 80), 'content'); onDelta(payload.slice(80), 'content'); return payload;
      },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) { const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText; module._compile(output, filename); };
}
