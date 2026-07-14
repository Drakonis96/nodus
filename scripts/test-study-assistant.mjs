// Study vault phase 8: grounded prompt assembly, strict citation validation,
// scoped source selection and local per-vault conversation history.

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

if (!process.argv.includes('--electron-study-assistant-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-assistant.mjs'), '--electron-study-assistant-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-assistant-test-'));
installRuntimeHooks(root);

try {
  const shared = require(path.join(repoRoot, 'shared/studyAssistant.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const assistant = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const location = { documentId: 'doc-1', from: 10, to: 42 };
  const citation = {
    id: 'S1', sourceKey: 'document:doc-1', indexId: 'document:doc-1:0', kind: 'document', sourceId: 'doc-1',
    title: 'Memoria', subtitle: 'Cognición', quote: 'La memoria de trabajo mantiene información activa.', location,
    scope: { courseId: 'c1', subjectId: 's1', topicId: 't1' },
  };
  const validated = shared.validateStudyAssistantAnswer('La mantiene activa [S1]. Cita inventada [S99](https://invalid.example).', [citation]);
  assert.match(validated.answer, /\[S1\]\(nodus:\/\/study\/evidence\/S1\)/);
  assert.doesNotMatch(validated.answer, /S99/, 'invented citation ids are removed');
  assert.deepEqual(validated.citations.map((item) => item.id), ['S1']);
  assert.equal(validated.citationWarning, false);
  assert.equal(shared.validateStudyAssistantAnswer('Respuesta sin evidencia.', [citation]).citationWarning, true);

  const long = `${'Introducción general. '.repeat(250)}La agenda visoespacial mantiene imágenes temporalmente. ${'Detalle secundario. '.repeat(250)}`;
  const compressed = shared.compressStudyAssistantEvidence(long, 'agenda visoespacial', 700);
  assert.equal(compressed.truncated, true);
  assert.match(compressed.text, /agenda visoespacial/, 'compression keeps query-relevant exact evidence');

  const course = org.createStudyCourse({ name: 'Psicología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Cognición' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Memoria' });
  const document = org.createStudyDocument({
    title: 'Apunte memoria', contentMarkdown: '# Memoria\n\nLa agenda visoespacial mantiene imágenes temporalmente.',
    placement: { courseId: course.id, subjectId: subject.id, topicId: topic.id },
  });
  const materialPath = path.join(root, 'manual.txt');
  fs.writeFileSync(materialPath, 'El bucle fonológico repasa información verbal.');
  const material = await materials.importStudyMaterialFile(materialPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id });
  const recording = recordings.createStudyRecording({ fileName: 'clase.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]), durationSeconds: 15, subjectId: subject.id, topicId: topic.id });
  recordings.saveStudyTranscript(recording.recording.id, { kind: 'literal', contentMarkdown: 'El ejecutivo central coordina recursos.', status: 'ready', segments: [{ tStart: 4, tEnd: 8, text: 'El ejecutivo central coordina recursos.' }] });

  const options = assistant.getStudyAssistantSources();
  assert.ok(options.some((item) => item.sourceKey === `document:${document.id}`));
  assert.ok(options.some((item) => item.sourceKey === `material:${material.material.id}`));
  assert.ok(options.some((item) => item.kind === 'transcript'));

  const prompt = assistant.buildStudyAssistantPrompt({
    messages: [{ id: 'u1', role: 'user', content: '¿Qué mantiene información?', createdAt: new Date().toISOString() }],
    selection: { scope: 'manual', sourceKeys: [`document:${document.id}`] }, task: 'answer', level: 'standard', tone: 'clear', language: 'es', allowExternalKnowledge: false,
  }, [citation]);
  assert.match(prompt.system, /PROHIBIDO usar conocimiento externo/);
  assert.match(prompt.system, /No inventes ids/);
  assert.match(prompt.user, /exact_fragment/);

  const conversation = assistant.createStudyAssistantConversation({ selection: { scope: 'topic', topicId: topic.id, sourceKeys: [] } });
  const messages = [
    { id: 'u1', role: 'user', content: 'Resume la memoria.', createdAt: new Date().toISOString() },
    { id: 'a1', role: 'assistant', content: validated.answer, citations: [citation], createdAt: new Date().toISOString() },
  ];
  const updated = assistant.updateStudyAssistantConversation(conversation.id, { title: 'Memoria de trabajo', messages, task: 'summary' });
  assert.equal(updated.title, 'Memoria de trabajo');
  assert.equal(updated.selection.topicId, topic.id, 'academic scope persists with conversation history');
  assert.equal(assistant.listStudyAssistantConversations()[0].messageCount, 2);
  assert.match(assistant.renderStudyAssistantConversation(updated), /Fuentes: S1 — Memoria/);
  assistant.updateStudyAssistantConversation(conversation.id, { archived: true });
  assert.equal(assistant.listStudyAssistantConversations().length, 0);
  assert.equal(assistant.listStudyAssistantConversations(true)[0].archived, true);
  assistant.deleteStudyAssistantConversation(conversation.id);
  assert.equal(assistant.getStudyAssistantConversation(conversation.id), null);

  closeDb();
  console.log('Study grounded assistant phase 8 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
