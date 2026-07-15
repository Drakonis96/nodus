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
  assert.equal(stt.whisperLanguageName('auto'), undefined);
  assert.ok(stt.WHISPER_CPP_MODELS.some((model) => model.id === 'large-v3-turbo-q5_0'), 'whisper.cpp catalog exposes an official multilingual turbo model');

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

  const [pkg, worker, backend, cppBackend, ipc, preload, editor, settingsUi, recordingsUi, html] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'src/lib/stt/stt.worker.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/studyTranscription.ts'), 'utf8'),
    readFile(path.join(root, 'electron/stt/whisperCpp.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/editor/StudyEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/SttSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/StudyRecordingsView.tsx'), 'utf8'),
    readFile(path.join(root, 'index.html'), 'utf8'),
  ]);
  assert.match(pkg, /"@huggingface\/transformers"/, 'transformers is a direct runtime dependency');
  assert.match(pkg, /NSMicrophoneUsageDescription/, 'packaged macOS builds declare microphone use');
  assert.match(worker, /device: 'wasm'/, 'local Whisper explicitly runs on WASM');
  assert.match(worker, /automatic-speech-recognition/, 'worker owns ASR inference');
  assert.match(worker, /WhisperTextStreamer/, 'ONNX transcription streams partial text from the worker');
  assert.match(backend, /gpt-4o-transcribe/, 'official OpenAI transcription model is the fallback');
  assert.match(backend, /audio\.transcriptions\.create/, 'external audio uses the transcription endpoint');
  assert.match(cppBackend, /spawn\(executable/, 'whisper.cpp runs in a child process outside the UI thread');
  assert.match(cppBackend, /print-progress/, 'whisper.cpp exposes incremental progress');
  assert.match(cppBackend, /onPartial/, 'whisper.cpp streams completed segments');
  assert.match(ipc, /study:stt:transcribe/, 'STT is registered in main IPC');
  assert.match(preload, /study:stt:transcribe/, 'STT crosses the preload bridge');
  assert.match(settingsUi, /Transformers\.js \+ ONNX/, 'Settings exposes the ONNX engine');
  assert.match(settingsUi, /whisper\.cpp/, 'Settings exposes the whisper.cpp engine and model manager');
  assert.match(cppBackend, /installWhisperCpp/, 'whisper.cpp can be installed with one click');
  assert.match(cppBackend, /if \(!before\.executableReady\) await installWhisperCpp\(\)/, 'downloading a GGML model automatically installs whisper.cpp first');
  assert.match(cppBackend, /uninstallWhisperCpp/, 'whisper.cpp can be uninstalled with one click');
  assert.match(settingsUi, /window\.nodus\.installWhisperCpp/, 'Settings uses the managed installer');
  assert.match(settingsUi, /cpp:runtime:\$\{model\}/, 'the requested model remains queued while its engine is prepared');
  assert.match(settingsUi, /window\.nodus\.uninstallWhisperCpp/, 'Settings uses the managed uninstaller');
  assert.doesNotMatch(settingsUi, /chooseWhisperCppExecutable/, 'Settings no longer asks the user to attach an executable');
  assert.match(settingsUi, /stt-transformers-model-list/, 'Transformers models use the shared settings list pattern');
  assert.match(settingsUi, /stt-whisper-model-list/, 'whisper.cpp models use the shared settings list pattern');
  assert.doesNotMatch(settingsUi, /xl:grid-cols-[45]/, 'transcription model catalogs do not regress to card grids');
  assert.match(settingsUi, /bg-white[^\n]*dark:bg-neutral-950/, 'STT settings has explicit light and dark surfaces');
  assert.match(recordingsUi, /study-recording-language/, 'recordings expose per-audio language selection');
  assert.match(recordingsUi, /study-transcription-stream/, 'recordings render partial transcription while processing');
  assert.match(editor, /StudyDictation/, 'dictation is mounted inside the editor');
  assert.match(editor, /editorViewCtx/, 'WYSIWYG insertion uses the real ProseMirror selection');
  assert.match(html, /worker-src 'self' blob:/, 'CSP permits the packaged Whisper worker');
  assert.match(html, /https:\/\/huggingface\.co/, 'CSP permits explicit model downloads');
  assert.match(html, /xethub\.hf\.co/, 'CSP permits Hugging Face model-file redirects');

  console.log('Study dictation phase 3 tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
