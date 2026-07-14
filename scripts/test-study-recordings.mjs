// Study vault phase 6: durable local audio, scope, markers, timestamped transcript
// versions, literal/corrected/notes separation and independent deletion.

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

if (!process.argv.includes('--electron-study-recordings-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-recordings.mjs'), '--electron-study-recordings-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-recordings-test-'));
installRuntimeHooks(root);

try {
  const shared = require(path.join(repoRoot, 'shared/studyRecordings.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  for (const table of ['study_recordings', 'study_transcripts', 'study_transcript_segments', 'study_audio_markers']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }
  assert.equal(shared.formatStudyTimestamp(65), '1:05');
  assert.equal(shared.formatStudyTimestamp(3661), '1:01:01');
  assert.equal(shared.correctedStudyTranscript('hola mundo. siguiente idea'), 'Hola mundo. Siguiente idea');
  assert.equal(shared.detectStudyChapter('Tema 2: La memoria'), '2 · La memoria');
  const estimated = shared.normalizeStudyTranscriptSegments(undefined, 'Primera frase. Segunda frase.', 20);
  assert.equal(estimated.length, 2);
  assert.equal(Math.round(estimated.at(-1).tEnd), 20);
  assert.match(shared.structuredStudyNotes('Clase', 'Memoria procedimental. Memoria declarativa.'), /Preguntas de repaso sugeridas/);

  const course = org.createStudyCourse({ name: 'Curso audio' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Psicología' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Memoria' });
  const bytes = new Uint8Array(Buffer.from('RIFF-recording-WAVE-audio'));
  const first = recordings.createStudyRecording({
    title: 'Clase de memoria', fileName: 'clase.wav', mimeType: 'audio/wav', bytes, durationSeconds: 62,
    language: 'es', courseId: course.id, subjectId: subject.id, topicId: topic.id, sessionLabel: 'Semana 1',
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.recording.sizeBytes, bytes.length);
  assert.deepEqual(Buffer.from(recordings.getStudyRecordingContent(first.recording.id).bytes), Buffer.from(bytes));
  assert.equal(recordings.createStudyRecording({ fileName: 'copia.wav', mimeType: 'audio/wav', bytes }).duplicate, true, 'SHA-256 dedupe');
  assert.equal(recordings.listStudyRecordings({ subjectId: subject.id })[0].id, first.recording.id);

  const marker = recordings.createStudyAudioMarker(first.recording.id, { tSeconds: 12.5, label: 'Definición', note: 'Revisar' });
  assert.equal(marker.tSeconds, 12.5);
  assert.equal(recordings.updateStudyAudioMarker(marker.id, { label: 'Definición clave' }).label, 'Definición clave');

  const literal = recordings.saveStudyTranscript(first.recording.id, {
    kind: 'literal', contentMarkdown: 'Tema 1: memoria. La memoria procedimental funciona así.', language: 'es',
    modelProvider: 'local', modelName: 'Whisper Tiny', status: 'ready',
    segments: [
      { tStart: 0, tEnd: 9, text: 'Tema 1: memoria.', chapter: '1 · memoria' },
      { tStart: 9, tEnd: 22, text: 'La memoria procedimental funciona así.', speaker: 'Docente' },
    ],
  });
  assert.equal(literal.segments.length, 2);
  assert.equal(recordings.getStudyRecording(first.recording.id).processingStatus, 'ready');
  const changed = recordings.updateStudyTranscriptSegment(literal.segments[1].id, { speaker: 'Profesora' });
  assert.equal(changed.speaker, 'Profesora');

  const corrected = recordings.saveStudyTranscript(first.recording.id, {
    kind: 'corrected', contentMarkdown: shared.correctedStudyTranscript(literal.contentMarkdown), sourceTranscriptId: literal.id,
  });
  const notes = recordings.saveStudyTranscript(first.recording.id, {
    kind: 'notes', contentMarkdown: shared.structuredStudyNotes('Clase de memoria', corrected.contentMarkdown), sourceTranscriptId: literal.id,
  });
  assert.equal(recordings.getStudyRecording(first.recording.id).transcripts.length, 3);
  recordings.saveStudyTranscript(first.recording.id, { kind: 'literal', contentMarkdown: 'Reprocesado literal.', modelName: 'Whisper Base' });
  assert.equal(recordings.getStudyRecording(first.recording.id).transcripts.filter((item) => item.kind === 'literal')[0].versionNo, 2, 'reprocessing preserves literal history');
  assert.equal(recordings.listStudyRecordings({ search: 'procedimental' })[0].id, first.recording.id, 'transcript is searchable');

  const note = recordings.createStudyNoteFromTranscript(first.recording.id, notes.id);
  const noteDoc = org.getStudyWorkspace().documents.find((document) => document.id === note.documentId);
  assert.ok(noteDoc);
  assert.match(noteDoc.contentMarkdown, /nodus:\/\/study\/recording/);
  assert.equal(noteDoc.kind, 'apunte');

  recordings.deleteStudyRecordingAudio(first.recording.id);
  assert.throws(() => recordings.getStudyRecordingContent(first.recording.id), /audio se eliminó/);
  assert.ok(recordings.getStudyRecording(first.recording.id).transcripts.length >= 3, 'deleting audio preserves transcripts');
  recordings.deleteStudyTranscript(corrected.id);
  assert.equal(recordings.getStudyRecording(first.recording.id).transcripts.some((item) => item.id === corrected.id), false);
  recordings.deleteStudyAudioMarker(marker.id);
  assert.equal(recordings.getStudyRecording(first.recording.id).markers.length, 0);

  recordings.setStudyRecordingLifecycle(first.recording.id, 'archive');
  assert.equal(recordings.listStudyRecordings().length, 0);
  recordings.setStudyRecordingLifecycle(first.recording.id, 'restore');
  recordings.setStudyRecordingLifecycle(first.recording.id, 'trash');
  assert.equal(recordings.listStudyRecordings().length, 0);
  recordings.setStudyRecordingLifecycle(first.recording.id, 'recover');
  recordings.setStudyRecordingLifecycle(first.recording.id, 'delete');
  assert.throws(() => recordings.getStudyRecording(first.recording.id), /no encontrada/);

  closeDb();
  console.log('Study recordings phase 6 tests passed!');
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
