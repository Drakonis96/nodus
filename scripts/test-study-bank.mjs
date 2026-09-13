// Question-bank and flashcard management: metadata filters, sorting, bulk actions,
// and the portable interchange formats (Nodus JSON, CSV, Anki TSV/APKG, Moodle XML/GIFT).
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
if (!process.argv.includes('--electron-study-bank-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-bank.mjs'), '--electron-study-bank-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-bank-'));
installRuntimeHooks(root);
try {
  const interchange = require(path.join(repoRoot, 'shared/studyInterchange.ts'));
  const anki = require(path.join(repoRoot, 'electron/import/ankiApkg.ts'));
  const orchestrator = require(path.join(repoRoot, 'electron/studyInterchange.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const learning = require(path.join(repoRoot, 'electron/db/studyLearningRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 176, 'schema version keeps advancing');
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const table of ['study_questions', 'study_flashcards', 'study_srs_state', 'study_question_collections', 'study_question_collection_items']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  const course = org.createStudyCourse({ name: 'Historia' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Moderna' });
  const secondSubject = org.createStudySubject({ courseId: course.id, name: 'Contemporánea' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Ilustración' });
  const document = org.createStudyDocument({ title: 'Manual de historia', contentMarkdown: '# Ilustración\n\nLa Ilustración defendió la razón y la crítica.' });

  const first = bank.createStudyQuestion({
    prompt: '¿Qué defendió la Ilustración según el manual?', type: 'short', difficulty: 'easy', cognitiveLevel: 'remember', status: 'approved',
    answer: { text: 'La razón y la crítica.' }, explanation: 'La Ilustración defendió la razón.', tags: ['ilustración', 'siglo XVIII'],
    courseId: course.id, subjectId: subject.id, topicId: topic.id, documentId: document.id,
    source: { title: document.title, excerpt: 'La Ilustración defendió la razón y la crítica.' },
  });
  const second = bank.createStudyQuestion({
    prompt: '¿Qué corriente cuestionó la autoridad tradicional?', type: 'short', difficulty: 'hard', cognitiveLevel: 'analyze', status: 'pending',
    answer: { text: 'La Ilustración.' }, explanation: 'Cuestionó la autoridad.', tags: ['ilustración'],
    courseId: course.id, subjectId: subject.id, topicId: topic.id, source: { title: 'Apuntes', excerpt: 'Corriente crítica.' },
  });
  const third = bank.createStudyQuestion({
    prompt: 'Elige el principio ilustrado central.', type: 'single_choice', difficulty: 'medium', status: 'pending',
    options: [{ id: 'O1', text: 'La razón', correct: true }, { id: 'O2', text: 'El dogma', correct: false }],
    answer: { text: 'La razón', value: 'O1' }, explanation: 'La razón organiza el conocimiento.', tags: ['razón'],
    subjectId: subject.id, source: { title: 'Manual', excerpt: 'La razón organiza el conocimiento.' },
  });

  // ── Filtering, sorting and tags ────────────────────────────────────────────
  assert.deepEqual(bank.listStudyQuestions({ sort: 'prompt' }).map((question) => question.prompt), [
    'Elige el principio ilustrado central.',
    '¿Qué corriente cuestionó la autoridad tradicional?',
    '¿Qué defendió la Ilustración según el manual?',
  ], 'prompt sort is alphabetical');
  assert.equal(bank.listStudyQuestions({ difficulty: 'hard' })[0].id, second.id, 'difficulty filter');
  assert.equal(bank.listStudyQuestions({ status: 'approved' })[0].id, first.id, 'status filter');
  assert.equal(bank.listStudyQuestions({ subjectId: subject.id }).length, 3, 'subject filter');
  assert.equal(bank.listStudyQuestions({ topicId: topic.id }).length, 2, 'topic filter');
  assert.equal(bank.listStudyQuestions({ documentId: document.id }).length, 1, 'document/source filter');
  assert.equal(bank.listStudyQuestions({ tag: 'razón' }).length, 1, 'tag filter uses exact membership');
  assert.equal(bank.listStudyQuestions({ search: 'corriente' }).length, 1, 'search includes explanation');
  assert.equal(bank.listStudyQuestions({ favorite: true }).length, 0, 'favorite filter');
  assert.deepEqual(bank.listStudyQuestionTags()[0], { tag: 'ilustración', count: 2 }, 'tags are aggregated with counts');

  // ── Bulk question actions ─────────────────────────────────────────────────
  const collection = bank.createStudyQuestionCollection('Clase 1');
  assert.equal(bank.bulkStudyQuestions([first.id, second.id], { kind: 'status', status: 'problematic' }), 2);
  assert.ok(bank.listStudyQuestions().filter((question) => [first.id, second.id].includes(question.id)).every((question) => question.status === 'problematic'));
  assert.equal(bank.bulkStudyQuestions([first.id, second.id], { kind: 'difficulty', difficulty: 'hard' }), 2);
  assert.ok(bank.listStudyQuestions({ difficulty: 'hard' }).some((question) => question.id === first.id));
  assert.equal(bank.bulkStudyQuestions([first.id, second.id], { kind: 'tags', add: ['examen', 'parcial'] }), 2);
  assert.ok(bank.getStudyQuestion(first.id).tags.includes('examen'));
  bank.bulkStudyQuestions([first.id, second.id], { kind: 'tags', remove: ['parcial'] });
  assert.ok(!bank.getStudyQuestion(first.id).tags.includes('parcial'), 'bulk tag removal');
  assert.equal(bank.bulkStudyQuestions([first.id, second.id], { kind: 'collections', add: [collection.id] }), 2);
  assert.equal(bank.listStudyQuestionCollections()[0].questionCount, 2, 'bulk collection membership');
  bank.bulkStudyQuestions([second.id], { kind: 'collections', remove: [collection.id] });
  assert.deepEqual(bank.listStudyQuestionCollections()[0].questionIds, [first.id]);
  assert.equal(bank.bulkStudyQuestions([third.id], { kind: 'move', subjectId: secondSubject.id, courseId: course.id }), 1);
  assert.equal(bank.getStudyQuestion(third.id).subjectId, secondSubject.id, 'bulk move changes the category');
  assert.equal(bank.listStudyQuestions({ collectionId: collection.id }).length, 1, 'collection filter');
  bank.bulkStudyQuestions([second.id], { kind: 'lifecycle', action: 'archive' });
  assert.equal(bank.listStudyQuestions().some((question) => question.id === second.id), false, 'archived questions leave the default list');
  bank.bulkStudyQuestions([second.id], { kind: 'lifecycle', action: 'restore' });
  assert.ok(bank.listStudyQuestions().some((question) => question.id === second.id), 'archived questions can be restored');
  bank.bulkStudyQuestions([third.id], { kind: 'favorite', favorite: true });
  assert.equal(bank.getStudyQuestion(third.id).favorite, true);

  // ── Flashcard filters, sorting, bulk and JSON export/import ───────────────
  const cardA = learning.createStudyFlashcard({ type: 'front_back', front: 'Anverso alfa', back: 'Reverso alfa', difficulty: 'easy', tags: ['uno'], subjectId: subject.id, topicId: topic.id });
  const cardB = learning.createStudyFlashcard({ type: 'front_back', front: 'Anverso beta', back: 'Reverso beta', difficulty: 'hard', tags: ['dos'], subjectId: subject.id });
  const cardC = learning.createStudyFlashcard({ type: 'cloze', front: 'La {{c1::razón}} guía.', back: 'razón', difficulty: 'medium', tags: ['dos'] });
  assert.equal(learning.listStudyFlashcards({ difficulty: 'hard' })[0].id, cardB.id, 'flashcard difficulty filter');
  assert.equal(learning.listStudyFlashcards({ tag: 'dos' }).length, 2, 'flashcard tag filter');
  assert.equal(learning.listStudyFlashcards({ sort: 'front' }).map((card) => card.id)[0], cardA.id, 'flashcard prompt sort');
  assert.ok(learning.listStudyFlashcardTags().some((entry) => entry.tag === 'dos' && entry.count === 2));
  assert.equal(learning.bulkStudyFlashcards([cardA.id, cardB.id], { kind: 'difficulty', difficulty: 'hard' }), 2);
  assert.equal(learning.bulkStudyFlashcards([cardA.id], { kind: 'tags', add: ['repaso'] }), 1);
  assert.ok(learning.listStudyFlashcards({ includeArchived: true }).find((card) => card.id === cardA.id).tags.includes('repaso'));
  learning.bulkStudyFlashcards([cardB.id], { kind: 'state', action: 'master' });
  assert.equal(learning.listStudyFlashcards({ includeArchived: true }).find((card) => card.id === cardB.id).srs.mastered, true);
  learning.bulkStudyFlashcards([cardB.id], { kind: 'state', action: 'reset' });
  assert.equal(learning.listStudyFlashcards({ includeArchived: true }).find((card) => card.id === cardB.id).srs.mastered, false);
  assert.equal(learning.bulkStudyFlashcards([cardA.id, cardB.id], { kind: 'move', subjectId: secondSubject.id }), 2);
  assert.ok(learning.listStudyFlashcards({ subjectId: secondSubject.id }).length >= 2, 'bulk move relocates cards');
  const cardExport = learning.exportStudyFlashcards([cardC.id]);
  assert.equal(cardExport.format, 'nodus-study-flashcards');
  assert.equal(learning.importStudyFlashcards(cardExport).length, 1, 'Nodus flashcard JSON re-imports');
  learning.bulkStudyFlashcards([cardB.id], { kind: 'state', action: 'delete' });
  assert.equal(learning.listStudyFlashcards().some((card) => card.id === cardB.id), false, 'deleted cards leave the deck');

  // ── Pure interchange: CSV, Anki TSV, Moodle XML, GIFT ─────────────────────
  const questionCsv = interchange.serializeStudyQuestionsCsv([first, third]);
  const parsedCsv = interchange.parseStudyQuestionsCsv(questionCsv);
  assert.equal(parsedCsv.questions.length, 2, 'question CSV roundtrips');
  assert.equal(parsedCsv.questions[0].prompt, first.prompt);
  assert.deepEqual(parsedCsv.questions[1].options?.map((option) => option.correct), [true, false], 'CSV options keep the correct marker');
  const cardCsv = interchange.serializeStudyFlashcardsCsv([cardC]);
  const parsedCardCsv = interchange.parseStudyFlashcardsCsv(cardCsv);
  assert.equal(parsedCardCsv.cards[0].type, 'cloze', 'card CSV roundtrips its type');
  assert.equal(parsedCardCsv.cards[0].front, cardC.front);

  const ankiText = interchange.serializeAnkiTsv([cardA, cardC]);
  const parsedAnki = interchange.parseAnkiTsv(ankiText);
  assert.equal(parsedAnki.cards.length, 2, 'Anki text keeps one card per line');
  assert.equal(parsedAnki.cards[1].type, 'cloze', 'Anki text detects cloze cards');

  const moodleXml = interchange.serializeMoodleXml([first, third], { category: 'Historia' });
  const parsedMoodle = interchange.parseMoodleXml(moodleXml);
  assert.ok(parsedMoodle.categories.includes('Historia'), 'Moodle category is preserved');
  assert.equal(parsedMoodle.questions.length, 2, 'Moodle XML roundtrips');
  assert.equal(parsedMoodle.questions[1].type, 'single_choice', 'Moodle multichoice keeps single choice');
  assert.equal(parsedMoodle.questions[1].options.filter((option) => option.correct).length, 1);
  assert.match(moodleXml, /<question type="category">/);

  const gift = interchange.serializeGift([third, first]);
  const parsedGift = interchange.parseGift(gift);
  assert.equal(parsedGift.questions.length, 2, 'GIFT roundtrips');
  assert.equal(parsedGift.questions[0].type, 'single_choice');
  assert.equal(parsedGift.questions[0].options.filter((option) => option.correct).length, 1);
  assert.equal(parsedGift.questions[1].type, 'short');
  const trueFalse = interchange.studyQuestionFromImport({ prompt: 'La razón guía la crítica ilustrada.', type: 'true_false', answerText: 'true' }, 'Prueba');
  assert.equal(trueFalse.answer.value, true, 'true/false import answers are booleans');
  const clozeToQuestion = interchange.studyFlashcardToQuestionInput({ type: 'cloze', front: 'La {{c1::razón}} guía {{c2::todo}}.', back: 'razón · todo' }, 'Anki');
  assert.equal(clozeToQuestion.type, 'fill_blank');
  assert.equal(clozeToQuestion.answer.text, 'razón · todo');

  // ── Anki .apkg package ────────────────────────────────────────────────────
  const apkgBytes = anki.buildAnkiApkg([cardA, cardC], { deckName: 'Nodus Historia' });
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(apkgBytes);
  assert.ok(zip.getEntry('collection.anki2'), 'apkg carries a collection database');
  assert.ok(zip.getEntry('media'), 'apkg carries the media map');
  const Database = require('better-sqlite3');
  const apkgPath = path.join(root, 'roundtrip.anki2');
  fs.writeFileSync(apkgPath, zip.getEntry('collection.anki2').getData());
  const apkgDb = new Database(apkgPath, { readonly: true });
  assert.equal(apkgDb.prepare('SELECT COUNT(*) AS value FROM notes').get().value, 2, 'apkg exports one note per card');
  assert.equal(apkgDb.prepare('SELECT COUNT(*) AS value FROM cards').get().value, 2, 'apkg exports one card per note');
  assert.match(String(apkgDb.prepare('SELECT decks FROM col').get().decks), /Nodus Historia/, 'deck name is written');
  apkgDb.close();
  const parsedApkg = anki.parseAnkiApkg(apkgBytes);
  assert.equal(parsedApkg.cards.length, 2, 'apkg roundtrips its cards');
  assert.equal(parsedApkg.cards.find((card) => card.type === 'cloze')?.front, cardC.front, 'apkg preserves cloze text');
  assert.ok(parsedApkg.cards.every((card) => card.tags.length > 0), 'apkg preserves tags');

  // ── Orchestrator: export/import through the app boundary ──────────────────
  const exportedCsv = orchestrator.exportStudyInterchange('questions', 'csv');
  assert.equal(typeof exportedCsv, 'string');
  assert.match(exportedCsv, /enunciado/);
  const parsedForQuestions = orchestrator.parseStudyInterchange('questions', 'csv', exportedCsv);
  assert.ok(parsedForQuestions.questions.length >= 3, 'all bank questions export and parse');
  const imported = orchestrator.writeStudyInterchange('questions', { ...parsedForQuestions, questions: parsedForQuestions.questions.map((question) => ({ ...question, prompt: `${question.prompt} (copia)` })) }, { subjectId: secondSubject.id });
  assert.equal(imported.imported, parsedForQuestions.questions.length, 'questions can be written back with a target subject');
  assert.ok(bank.listStudyQuestions({ subjectId: secondSubject.id }).every((question) => question.subjectId === secondSubject.id));
  const detected = orchestrator.detectStudyInterchangeFormat('banco.xml', '<quiz></quiz>');
  assert.equal(detected, 'moodle-xml', 'format detection uses the extension');
  const detectedJson = orchestrator.detectStudyInterchangeFormat('sin-extension', '{"format":"nodus-study-questions"}');
  assert.equal(detectedJson, 'nodus', 'format detection sniffs JSON');

  // ── Renderer wiring: the UI really exposes the new workflow ───────────────
  const view = fs.readFileSync(path.join(repoRoot, 'src/views/StudyBankView.tsx'), 'utf8');
  for (const marker of [
    'study-bank-tab-questions', 'study-bank-tab-flashcards', 'study-bank-topic-filter', 'study-bank-source-kind',
    'study-bank-material-filter', 'study-bank-tag-filter', 'study-bank-favorite-filter', 'study-bank-sort',
    'study-bank-bulk', 'study-bank-bulk-status', 'study-bank-bulk-difficulty', 'study-bank-bulk-state',
    'study-bank-bulk-move', 'study-bank-bulk-cards', 'study-bank-bulk-export', 'study-bank-flashcard-new',
    'study-bank-flashcard-edit', 'study-bank-flashcard-front', 'study-bank-flashcard-back', 'study-bank-flashcard-save',
    'study-question-metadata', 'study-question-select-', 'StudyInterchangeDialog',
  ]) assert.ok(view.includes(marker), `bank view exposes ${marker}`);
  const dialog = fs.readFileSync(path.join(repoRoot, 'src/components/StudyInterchangeDialog.tsx'), 'utf8');
  for (const marker of ['study-interchange-dialog', 'study-interchange-import', 'study-interchange-export', 'study-interchange-format-', 'study-interchange-scope', 'Moodle XML', 'Anki (paquete .apkg)']) {
    assert.ok(dialog.includes(marker), `interchange dialog exposes ${marker}`);
  }
  const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload/academic.ts'), 'utf8');
  for (const method of ['bulkStudyQuestions', 'listStudyQuestionTags', 'bulkStudyFlashcards', 'listStudyFlashcardTags', 'exportStudyInterchange', 'importStudyInterchange', 'exportStudyFlashcards', 'importStudyFlashcards']) {
    assert.ok(preload.includes(method), `preload exposes ${method}`);
  }
  const api = fs.readFileSync(path.join(repoRoot, 'shared/api/academic.ts'), 'utf8');
  for (const method of ['bulkStudyQuestions', 'listStudyQuestionTags', 'bulkStudyFlashcards', 'exportStudyInterchange', 'importStudyInterchange']) {
    assert.ok(api.includes(method), `API contract declares ${method}`);
  }
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipc/academic.ts'), 'utf8');
  for (const channel of ["study:questions:bulk", "study:questions:tags", "study:flashcards:bulk", "study:flashcards:tags", "study:interchange:export", "study:interchange:import"]) {
    assert.ok(ipc.includes(channel), `main process handles ${channel}`);
  }

  closeDb();
  console.log('Study bank management + interchange tests passed!');
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
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
