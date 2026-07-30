import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-study-diarization-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-diarization.mjs'), '--electron-study-diarization-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

installRuntimeHooks();
const diarization = require(path.join(repoRoot, 'electron/ai/studyDiarization.ts'));

const originalSegments = [
  { tStart: 0, tEnd: 10, text: 'uno dos tres cuatro cinco seis siete ocho nueve diez', chapter: '' },
  { tStart: 10, tEnd: 15, text: 'once doce trece', chapter: '' },
];
const turns = [
  { startSeconds: 0, endSeconds: 4, speaker: 'Hablante 1', text: '', confidence: 0.92 },
  { startSeconds: 4, endSeconds: 10, speaker: 'Hablante 2', text: '', confidence: 0.88 },
  { startSeconds: 10, endSeconds: 15, speaker: 'Hablante 1', text: '', confidence: 0.9 },
];
const aligned = diarization.alignDiarizationTurns(originalSegments, turns);
assert.equal(aligned.length, 3, 'a cross-speaker STT segment is split into acoustic turns');
assert.deepEqual(aligned.map((segment) => segment.speaker), ['Hablante 1', 'Hablante 2', 'Hablante 1']);
assert.equal(aligned.map((segment) => segment.text).join(' '), originalSegments.map((segment) => segment.text).join(' '),
  'diarization preserves every literal word in order');
assert.deepEqual(aligned.map((segment) => [segment.tStart, segment.tEnd]), [[0, 4], [4, 10], [10, 15]]);

const source = fs.readFileSync(path.join(repoRoot, 'src/views/StudyRecordingsView.tsx'), 'utf8');
const preload = readSource('@bridge');
const ipc = readSource('@main');
assert.match(source, /data-testid="study-recording-diarize"/);
assert.match(source, /diarizeStudyRecording/);
assert.match(preload, /study:recordings:diarize/);
assert.match(ipc, /study:recordings:diarize/);
assert.equal(diarization.STUDY_DIARIZATION_MODEL, 'gemini-2.5-flash-lite');
assert.match(fs.readFileSync(path.join(repoRoot, 'electron/ai/studyDiarization.ts'), 'utf8'),
  /analysis\.speakers\.length < expectedSpeakers[\s\S]+requestGeminiDiarization/,
  'an explicitly expected speaker count gets one bounded retry');

console.log('Study diarization contract tests passed!');

function installRuntimeHooks() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === '../db/studyRecordingsRepo' && parent?.filename?.endsWith('/electron/ai/studyDiarization.ts')) return {};
    if (request === '../secrets/secretStore' && parent?.filename?.endsWith('/electron/ai/studyDiarization.ts')) return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function compile(module, filename) {
    const sourceText = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(sourceText, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
