// Study vault phase 10a: migration v58, pure question validation/similarity,
// source-grounded generation, versioned bank CRUD and collections.
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
let mockStudyEntries = [];

if (!process.argv.includes('--electron-study-questions-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-questions.mjs'), '--electron-study-questions-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-questions-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const shared = require(path.join(repoRoot, 'shared/studyQuestions.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const ai = require(path.join(repoRoot, 'electron/ai/studyQuestions.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.equal(SCHEMA_VERSION, 62);
  assert.equal(getDb().pragma('user_version', { simple: true }), 62);
  for (const table of ['study_questions', 'study_question_versions', 'study_question_collections', 'study_assessments', 'study_attempts', 'study_rubrics', 'study_grading_runs']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }
  assert.equal(shared.STUDY_QUESTION_TYPES.length, 13, 'all planned question types are represented');
  assert.ok(shared.studyQuestionSimilarity('¿Qué es la memoria de trabajo?', 'Define la memoria de trabajo') > 0.45);
  assert.equal(shared.validateStudyQuestionInput({ prompt: '¿Verdadero o falso?', type: 'true_false', answer: { value: true }, explanation: 'Fuente literal.' }).length, 0);
  assert.ok(shared.validateStudyQuestionInput({ prompt: 'Elige una', type: 'single_choice', options: [], answer: {}, explanation: '' }).length >= 2);

  const course = org.createStudyCourse({ name: 'Psicología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Cognición' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Memoria' });
  const document = org.createStudyDocument({ title: 'Manual de memoria', contentMarkdown: '# Memoria\n\nLa memoria de trabajo mantiene información durante periodos breves.' });
  org.addStudyPlacement(document.id, { courseId: course.id, subjectId: subject.id, topicId: topic.id });

  const manual = bank.createStudyQuestion({
    prompt: '¿Qué función cumple la memoria de trabajo?', type: 'short', difficulty: 'medium', cognitiveLevel: 'understand',
    answer: { text: 'Mantener información durante periodos breves.' }, explanation: 'Se deriva del manual.',
    courseId: course.id, subjectId: subject.id, topicId: topic.id, documentId: document.id,
    source: { title: document.title, excerpt: 'La memoria de trabajo mantiene información durante periodos breves.' }, tags: ['memoria'],
  });
  assert.equal(bank.listStudyQuestionVersions(manual.id).length, 1);
  assert.throws(() => bank.createStudyQuestion({ ...manual, prompt: '¿Qué función cumple la memoria de trabajo?' }), /similar/);
  const updated = bank.updateStudyQuestion(manual.id, { explanation: 'Justificación revisada.', favorite: true });
  assert.equal(updated.favorite, true);
  assert.equal(bank.listStudyQuestionVersions(manual.id).length, 2);
  const approved = bank.updateStudyQuestion(manual.id, { status: 'approved', locked: true });
  assert.throws(() => bank.updateStudyQuestion(approved.id, { prompt: 'Cambio bloqueado' }), /Desbloquea/);
  assert.equal(bank.duplicateStudyQuestion(manual.id).status, 'pending');

  const collection = bank.createStudyQuestionCollection('Parcial 1', 'Selección revisada');
  bank.setStudyQuestionCollectionItems(collection.id, [manual.id]);
  const variant = bank.duplicateStudyQuestion(manual.id);
  bank.setStudyQuestionCollectionItems(collection.id, [manual.id, variant.id]);
  const populatedCollection = bank.listStudyQuestionCollections().find((item) => item.id === collection.id);
  assert.equal(populatedCollection.questionCount, 2);
  assert.deepEqual(populatedCollection.questionIds, [manual.id, variant.id], 'collection membership is durable and additive');
  assert.ok(bank.findSimilarStudyQuestions(manual.id, 0.35).some((entry) => entry.question.id === variant.id));
  assert.equal(bank.getStudyQuestionAnalytics(manual.id).observedDifficulty, 'unrated');
  const exported = bank.exportStudyQuestions([manual.id]);
  assert.equal(exported.questions.length, 1);
  assert.equal(bank.importStudyQuestions(exported).length, 1);

  mockStudyEntries = [{
    indexId: 'document:manual:0', kind: 'document', sourceId: document.id, title: document.title,
    text: 'La memoria de trabajo mantiene información durante periodos breves y posee capacidad limitada.', subtitle: 'Cognición · Memoria', tags: ['memoria'],
    scope: { courseId: course.id, subjectId: subject.id, topicId: topic.id }, location: { documentId: document.id, from: 0, to: 90 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: 'hash', embedding: null, excluded: false,
  }];
  const prompt = ai.buildStudyQuestionPrompt({ sourceKeys: [`document:${document.id}`], count: 3, difficulty: 'mixed', cognitiveLevels: ['remember', 'understand'], types: ['short', 'single_choice'] }, [{ id: 'S1', title: document.title, type: 'document', location: {}, exactFragment: mockStudyEntries[0].text }]);
  assert.match(prompt.system, /exclusivamente los fragmentos exactos/);
  const generated = await ai.generateStudyQuestions({ sourceKeys: [`document:${document.id}`], count: 3, difficulty: 'mixed', cognitiveLevels: ['remember', 'understand'], types: ['short', 'single_choice'], subjectId: subject.id });
  assert.equal(generated.questions.length, 2, 'near-identical generated question is rejected');
  assert.equal(generated.rejectedDuplicates, 1);
  assert.equal(generated.questions[0].documentId, document.id);
  assert.equal(generated.questions[0].source.excerpt, mockStudyEntries[0].text, 'source evidence is copied from the index, never trusted from model output');

  const legacy = new Database(path.join(root, 'legacy-v57.sqlite'));
  for (const migration of migrations.filter((item) => item.version <= 57).sort((a, b) => a.version - b.version)) {
    legacy.exec(migration.up); legacy.pragma(`user_version = ${migration.version}`);
  }
  const timestamp = new Date().toISOString();
  legacy.prepare("INSERT INTO study_docs (id, short_id, title, kind, content_markdown, position, created_at, updated_at) VALUES (?, ?, ?, 'apunte', ?, 0, ?, ?)")
    .run('legacy-question-doc', 'DOC-LEGACY-Q', 'Documento v57', '# Se conserva', timestamp, timestamp);
  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), 62);
  assert.equal(legacy.prepare('SELECT content_markdown FROM study_docs WHERE id=?').get('legacy-question-doc').content_markdown, '# Se conserva');
  legacy.close();

  const view = await readFile(path.join(repoRoot, 'src/views/StudyBankView.tsx'), 'utf8');
  for (const marker of ['study-question-bank', 'study-question-save', 'study-question-search-mode', 'study-question-edit', 'study-question-versions', 'study-question-similar']) assert.match(view, new RegExp(marker));
  assert.match(view, /Abrir fuente/);
  closeDb();
  console.log('Study questions phase 10a tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (parent?.filename?.endsWith('/electron/ai/studyQuestions.ts') && request === './aiClient') return {
      resolveModelRef: (model) => model ?? { provider: 'ollama', model: 'question-verifier' },
      completeJson: async () => ({ questions: [
        { prompt: '¿Durante cuánto tiempo mantiene información la memoria de trabajo?', type: 'short', difficulty: 'easy', cognitiveLevel: 'remember', answer: { text: 'Durante periodos breves.' }, explanation: 'El fragmento lo afirma.', sourceId: 'S1' },
        { prompt: '¿Durante cuánto tiempo mantiene la información la memoria de trabajo?', type: 'short', difficulty: 'easy', cognitiveLevel: 'remember', answer: { text: 'Periodos breves.' }, explanation: 'El fragmento lo afirma.', sourceId: 'S1' },
        { prompt: '¿Qué propiedad limita la memoria de trabajo?', type: 'single_choice', difficulty: 'medium', cognitiveLevel: 'understand', answer: { text: 'Su capacidad limitada.' }, options: [{ id: 'A', text: 'Capacidad limitada', correct: true }, { id: 'B', text: 'Duración infinita', correct: false }], explanation: 'La fuente indica capacidad limitada.', sourceId: 'S1' },
      ] }),
    };
    if (parent?.filename?.endsWith('/electron/ai/studyQuestions.ts') && request === './studySearch') return { retrieveStudyAssistantEntries: async () => mockStudyEntries };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
