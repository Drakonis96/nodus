// Live Gemini integration smoke test for Study mode. Every database, preference,
// secret and imported file is placed under an ephemeral Electron userData root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pdfPath = path.resolve(process.env.NODUS_SHADOW_PDF || path.join(repoRoot, 'tmp/pdfs/shadow-study-source.pdf'));
const reportPath = path.resolve(process.env.NODUS_GEMINI_REPORT || path.join(os.tmpdir(), 'nodus-study-gemini-shadow-report.json'));

if (!process.argv.includes('--electron-study-gemini-shadow')) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this one isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/verify-study-gemini-shadow.mjs'), '--electron-study-gemini-shadow'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}

assert.ok(fs.existsSync(pdfPath), 'the shadow PDF fixture exists');
const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Gemini API key is available only to this process');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-gemini-shadow-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
let clearApiKey = () => undefined;
const startedAt = Date.now();
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const materialIndex = require(path.join(repoRoot, 'electron/ai/studyMaterialIndex.ts'));
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const knowledge = require(path.join(repoRoot, 'electron/ai/studyKnowledge.ts'));
  const knowledgeRepo = require(path.join(repoRoot, 'electron/db/studyKnowledgeRepo.ts'));
  const improve = require(path.join(repoRoot, 'electron/ai/studyImprove.ts'));
  const questionsAi = require(path.join(repoRoot, 'electron/ai/studyQuestions.ts'));
  const questionBank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const learning = require(path.join(repoRoot, 'electron/db/studyLearningRepo.ts'));
  const assessments = require(path.join(repoRoot, 'electron/db/studyAssessmentsRepo.ts'));
  const usageRepo = require(path.join(repoRoot, 'electron/db/studyAiUsageRepo.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  clearApiKey = () => secrets.clearApiKey('gemini');

  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
  const [chatModels, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('gemini', secrets.getApiKey('gemini')),
  ]);
  const preferred = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];
  const modelName = preferred.find((id) => chatModels.some((model) => model.id === id));
  assert.ok(modelName, `one cheap Gemini Flash Lite model is available (${preferred.join(', ')})`);
  const embeddingName = ['gemini-embedding-001', 'text-embedding-004'].find((id) => embeddingModels.some((model) => model.id === id));
  assert.ok(embeddingName, 'a stable Gemini embedding model is available');
  const model = { provider: 'gemini', model: modelName };

  settingsRepo.updateSettings({
    promptLanguage: 'es',
    embeddingProvider: 'gemini',
    embeddingModel: embeddingName,
    modelSettingsMode: 'advanced',
    studyAiEnabled: true,
    studyAiPrivacyMode: 'external',
    studyAiLocalOnly: false,
    studyAiConfirmExternal: false,
    studyAiRetryCount: 1,
    studyAiMonthlyBudgetUsd: 0,
    studyAiMaxInputChars: 40_000,
    studyAiMaxOutputTokens: 2_200,
    studyAiTemperature: 0.1,
    studyModel: model,
    improveModel: model,
    questionGenModel: model,
    flashcardModel: model,
  });

  const course = org.createStudyCourse({ name: 'Curso shadow', emoji: '🧪' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Biologia shadow', emoji: '🌿' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Fotosintesis shadow' });
  const originalNote = 'la fotosintesis combierte luz en energia quimica. ocurre en cloroplastos y conserva el dato 50%. la fase luminosa produce ATP y NADPH';
  const note = org.createStudyDocument({
    title: 'Apunte shadow',
    kind: 'apunte',
    contentMarkdown: originalNote,
    placement: { courseId: course.id, subjectId: subject.id, topicId: topic.id },
  });
  const imported = await materials.importStudyMaterialFile(pdfPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id, tags: ['shadow', 'gemini-smoke'] });
  assert.equal(imported.duplicate, false);
  const material = materials.getStudyMaterial(imported.material.id);
  assert.ok(material.extractedText.includes('fotosintesis'), 'PDF text extraction is real');

  const indexed = await materialIndex.reindexStudyMaterial(material.id);
  assert.equal(indexed.status, 'indexed', indexed.error || 'PDF material is embedded');
  const indexedMaterial = materials.getStudyMaterial(material.id);
  assert.equal(indexedMaterial.embeddingProvider, 'gemini');
  assert.equal(indexedMaterial.embeddingModel, embeddingName);
  assert.ok((indexedMaterial.embeddingDim ?? 0) > 0, 'material embedding has dimensions');
  await search.rebuildStudySearchIndex();
  const searchStatus = await waitForSearch(search);
  assert.equal(searchStatus.state, 'ready', searchStatus.error || 'study search index is ready');
  assert.ok(searchStatus.embeddedEntries >= 2, 'both the note and PDF are embedded in the shadow search index');

  knowledge.queueStudyKnowledgeSources('document', [note.id], true);
  await waitForKnowledge(knowledge, knowledgeRepo, subject.id, [
    `document:${note.id}`,
    `material:${material.id}`,
  ]);
  const ideas = knowledgeRepo.listStudyIdeas(subject.id);
  const graph = knowledgeRepo.getStudyKnowledgeGraph(subject.id);
  assert.ok(ideas.length >= 3, 'idea extraction produced a substantive result');
  assert.ok(graph.nodes.length >= 3, 'knowledge graph has nodes');
  assert.ok(graph.edges.length >= 1, 'knowledge graph has relations');

  const improveDeltas = [];
  const improved = await improve.improveStudyText({
    documentId: note.id,
    text: originalNote,
    styleId: 'builtin:proofread',
    scope: 'document',
    level: 'minimal',
    length: 'similar',
    mode: 'preserve',
    variables: { language: 'es', documentType: 'apunte' },
    model,
  }, (delta) => { if (delta) improveDeltas.push(delta); });
  assert.ok(improveDeltas.length > 0, 'Gemini emitted visible streaming deltas while improving notes');
  assert.equal(improveDeltas.join(''), improved.text, 'the streamed text is the persisted result');
  assert.notEqual(improved.text.trim(), originalNote.trim(), 'the note text changed');
  assert.ok(improved.text.includes('50%'), 'the protected numeric evidence survived');

  const sourceKeys = [`document:${note.id}`, `material:${material.id}`];
  const testGenerated = await questionsAi.generateStudyQuestions({
    sourceKeys, count: 2, optionCount: 4, difficulty: 'mixed', cognitiveLevels: ['remember', 'understand'], types: ['single_choice'],
    subjectId: subject.id, customPrompt: 'Dos preguntas distintas y directas.', model,
  });
  assert.ok(testGenerated.questions.length >= 1, 'test question generation returned valid questions');
  assert.ok(testGenerated.questions.every((question) => question.options.length === 4));
  const savedTestQuestions = testGenerated.questions.map((question) => questionBank.createStudyQuestion({ ...question, status: 'approved', locked: true }, 'create', true));
  const testAssessment = assessments.createStudyAssessment({ kind: 'test', title: 'Test shadow', subjectId: subject.id, questionIds: savedTestQuestions.map((question) => question.id) });
  assert.ok(testAssessment.items.length >= 1, 'the generated test was created');

  const examGenerated = await questionsAi.generateStudyQuestions({
    sourceKeys, count: 1, difficulty: 'medium', cognitiveLevels: ['analyze'], types: ['essay'],
    subjectId: subject.id, customPrompt: 'Pregunta sobre la relacion entre la fase luminosa y el ciclo de Calvin.', model,
  });
  assert.equal(examGenerated.questions.length, 1, 'exam generation returned one development question');
  const examQuestion = questionBank.createStudyQuestion({ ...examGenerated.questions[0], status: 'approved', locked: true }, 'create', true);
  const exam = assessments.createStudyAssessment({ kind: 'exam', title: 'Examen shadow', subjectId: subject.id, questionIds: [examQuestion.id], points: { [examQuestion.id]: 10 } });
  assert.equal(exam.items.length, 1, 'AI generated exam content without receiving a student answer');

  const flashcardGenerated = await questionsAi.generateStudyQuestions({
    sourceKeys, count: 2, difficulty: 'medium', cognitiveLevels: ['remember', 'understand'], types: ['definition'],
    subjectId: subject.id, customPrompt: 'Flashcards breves sobre conceptos diferentes.',
  });
  assert.ok(flashcardGenerated.questions.length >= 1, 'flashcard generation returned valid prompts');
  const flashQuestions = flashcardGenerated.questions.map((question) => questionBank.createStudyQuestion({ ...question, status: 'approved', locked: true }, 'create', true));
  const flashcards = learning.createStudyFlashcardsFromQuestions(flashQuestions.map((question) => question.id));
  assert.equal(flashcards.length, flashQuestions.length);
  assert.ok(flashcards.every((card) => card.front.trim() && card.back.trim()), 'flashcards have front and back content');

  const usage = usageRepo.listStudyAiUsage(100);
  assert.ok(usage.some((entry) => entry.task === 'flashcards' && entry.status === 'ok'), 'flashcards use the dedicated AI task/model route');
  assert.equal(usage.some((entry) => entry.task === 'grading'), false, 'no grading task reaches Gemini');
  assert.ok(usage.some((entry) => entry.task === 'improve' && entry.status === 'ok'));
  assert.ok(usage.some((entry) => entry.task === 'questions' && entry.status === 'ok'));

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    model: modelName,
    embeddingModel: embeddingName,
    fixture: { pdfPages: material.pageCount, extractedChars: material.extractedText.length, noteChars: originalNote.length },
    embeddings: { materialDimensions: indexedMaterial.embeddingDim, indexedEntries: searchStatus.indexedEntries, embeddedEntries: searchStatus.embeddedEntries },
    knowledge: { ideas: ideas.length, nodes: graph.nodes.length, edges: graph.edges.length, completedJobs: knowledgeRepo.listStudyKnowledgeJobs(subject.id).filter((job) => job.status === 'done').length },
    improvement: { deltaEvents: improveDeltas.length, changed: improved.text !== originalNote, protectedSpans: improved.protectedSpanCount },
    test: { generatedQuestions: testGenerated.questions.length, assessmentItems: testAssessment.items.length },
    exam: { generatedQuestions: examGenerated.questions.length, assessmentItems: exam.items.length, studentAnswersSentToAi: 0 },
    flashcards: { generatedQuestions: flashQuestions.length, cards: flashcards.length, dedicatedTaskCalls: usage.filter((entry) => entry.task === 'flashcards' && entry.status === 'ok').length },
    usage: { calls: usage.length, successful: usage.filter((entry) => entry.status === 'ok').length, failed: usage.filter((entry) => entry.status === 'error').length },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Gemini Study verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  try { clearApiKey(); } catch { /* the whole profile is deleted below */ }
  try { closeDb(); } catch { /* database may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

async function waitForKnowledge(knowledge, repo, subjectId, expectedKeys, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = repo.listStudyKnowledgeJobs(subjectId);
    const byKey = new Map(jobs.map((job) => [`${job.sourceKind}:${job.sourceId}`, job]));
    const expected = expectedKeys.map((key) => byKey.get(key));
    const failed = expected.find((job) => job?.status === 'error');
    if (failed) throw new Error(`Study knowledge failed for ${failed.sourceKind}: ${failed.error}`);
    if (expected.every((job) => job?.status === 'done')) return;
    const progress = knowledge.getStudyKnowledgeProgress();
    if (!progress.running && progress.pending === 0 && expected.some((job) => !job)) throw new Error('Study knowledge queue stopped before all shadow sources were analyzed.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out while waiting for shadow knowledge extraction.');
}

async function waitForSearch(search, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = search.getStudySearchIndexStatus();
    if (current.state === 'error') throw new Error(current.error || 'Shadow search indexing failed.');
    if (current.state === 'ready') return current;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out while waiting for the shadow search index.');
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-gemini-shadow-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: { showMessageBoxSync: () => 1 }, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
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
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
