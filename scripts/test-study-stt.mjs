// Study vault phase 3: pure model selection/dictation transformations plus
// source contracts for the local worker, external main-process route and UI.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-stt-'));

try {
  const outfile = path.join(tmp, 'sttModels.mjs');
  await build({ entryPoints: [path.join(root, 'shared/sttModels.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const stt = await import(pathToFileURL(outfile).href);

  assert.deepEqual(stt.STUDY_STT_MODELS.map((model) => model.id), [
    'Xenova/whisper-tiny', 'Xenova/whisper-base', 'Xenova/whisper-small', 'Xenova/whisper-medium',
  ], 'local catalog is ordered from lightest to most accurate');
  assert.equal(stt.recommendStudySttModel({ memoryGb: 4, logicalCores: 2 }).id, 'Xenova/whisper-tiny');
  assert.equal(stt.recommendStudySttModel({ memoryGb: 8, logicalCores: 4 }).id, 'Xenova/whisper-base');
  assert.equal(stt.recommendStudySttModel({ memoryGb: 16, logicalCores: 10 }).id, 'Xenova/whisper-small');
  assert.equal(stt.whisperLanguageName('es-ES'), 'spanish');
  assert.equal(stt.whisperLanguageName('fr-FR'), 'french');

  assert.deepEqual(stt.transformStudyDictation('borrar la última frase'), { text: '', action: 'delete_last_sentence' });
  assert.deepEqual(stt.transformStudyDictation('deshacer'), { text: '', action: 'undo' });
  assert.deepEqual(stt.transformStudyDictation('finalizar'), { text: '', action: 'finish' });
  assert.deepEqual(stt.transformStudyDictation('hola coma mundo punto nuevo párrafo segundo bloque'), {
    text: 'Hola, mundo.\n\nSegundo bloque', action: null,
  });
  assert.deepEqual(stt.transformStudyDictation('título fenomenología'), { text: '# Fenomenología', action: null });
  assert.deepEqual(stt.transformStudyDictation('subtítulo conceptos clave'), { text: '## Conceptos clave', action: null });
  assert.deepEqual(stt.transformStudyDictation('lista primer elemento'), { text: '- Primer elemento', action: null });
  assert.equal(stt.transformStudyDictation('eh este NODUS funciona', { removeFillers: true, customDictionary: ['Nodus'] }).text, 'Nodus funciona');
  assert.equal(stt.deleteLastStudySentence('Primera. Segunda. Tercera sin terminar'), 'Primera.');

  assert.deepEqual(stt.insertStudyDictation('Hola mundo', 'gran', 4), { markdown: 'Hola gran mundo', from: 5, to: 9 });
  assert.deepEqual(stt.insertStudyDictation('', 'Inicio', 50), { markdown: 'Inicio', from: 0, to: 6 });
  assert.equal(stt.buildStudySttPrompt(['Nodus', '  Husserl ', 'Nodus']), 'Vocabulario del curso: Nodus, Husserl.');
  assert.equal(stt.buildStudySttPrompt([]), '');

  const [pkg, worker, backend, ipc, preload, editor, html] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'src/lib/stt/stt.worker.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/studyTranscription.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/editor/StudyEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'index.html'), 'utf8'),
  ]);
  assert.match(pkg, /"@huggingface\/transformers"/, 'transformers is a direct runtime dependency');
  assert.match(pkg, /NSMicrophoneUsageDescription/, 'packaged macOS builds declare microphone use');
  assert.match(worker, /device: 'wasm'/, 'local Whisper explicitly runs on WASM');
  assert.match(worker, /automatic-speech-recognition/, 'worker owns ASR inference');
  assert.match(backend, /gpt-4o-transcribe/, 'official OpenAI transcription model is the fallback');
  assert.match(backend, /audio\.transcriptions\.create/, 'external audio uses the transcription endpoint');
  assert.match(ipc, /study:stt:transcribe/, 'STT is registered in main IPC');
  assert.match(preload, /study:stt:transcribe/, 'STT crosses the preload bridge');
  assert.match(editor, /StudyDictation/, 'dictation is mounted inside the editor');
  assert.match(editor, /editorViewCtx/, 'WYSIWYG insertion uses the real ProseMirror selection');
  assert.match(html, /worker-src 'self' blob:/, 'CSP permits the packaged Whisper worker');
  assert.match(html, /https:\/\/huggingface\.co/, 'CSP permits explicit model downloads');

  console.log('Study dictation phase 3 tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
