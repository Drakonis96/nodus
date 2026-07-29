import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const audioPath = process.argv.find((value) => value.startsWith('--audio='))?.slice('--audio='.length);

if (!process.argv.includes('--electron-live-diarization')) {
  if (!audioPath) throw new Error('Usage: node scripts/audit-live-diarization.mjs --audio=/absolute/audio.wav');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-live-diarization.mjs'), '--electron-live-diarization', `--audio=${audioPath}`],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const key = process.env.NODUS_AUDIT_GEMINI_KEY;
if (!key) throw new Error('NODUS_AUDIT_GEMINI_KEY is required.');
if (!audioPath || !path.isAbsolute(audioPath)) throw new Error('An absolute --audio path is required.');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-live-diarization-'));
installRuntimeHooks(userDataPath);
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { diarizeStudyRecording, STUDY_DIARIZATION_MODEL } =
    require(path.join(repoRoot, 'electron/ai/studyDiarization.ts'));
  assert.equal(STUDY_DIARIZATION_MODEL, 'gemini-2.5-flash-lite');
  secrets.setApiKey('gemini', key);
  const literal = 'Hola, hoy hablaremos de historia. Las fuentes primarias exigen contexto. Estoy de acuerdo. Empecemos por las fuentes secundarias para poder contrastar. Perfecto. Así podremos distinguir los hechos de las interpretaciones.';
  const bytes = fs.readFileSync(audioPath);
  const created = recordings.createStudyRecording({
    fileName: path.basename(audioPath),
    mimeType: 'audio/wav',
    bytes,
    durationSeconds: 12.826125,
    language: 'es',
  });
  const transcript = recordings.saveStudyTranscript(created.recording.id, {
    kind: 'literal',
    contentMarkdown: literal,
    language: 'es',
    status: 'ready',
    segments: [{ tStart: 0, tEnd: 12.826125, text: literal }],
  });
  const result = await diarizeStudyRecording({
    recordingId: created.recording.id,
    transcriptId: transcript.id,
    expectedSpeakers: 2,
  });
  assert.ok(result.transcript.segments.length >= 2, 'the provider should return multiple speech turns');
  assert.ok(result.speakers.length >= 2, 'the provider should distinguish the two synthetic voices');
  assert.equal(result.transcript.contentMarkdown, literal, 'the literal transcript content must remain byte-for-byte unchanged');
  assert.equal(result.transcript.segments.map((segment) => segment.text).join(' '), literal,
    'splitting speaker turns must preserve every literal word in order');
  const persisted = recordings.getStudyRecording(created.recording.id).transcripts.find((entry) => entry.id === transcript.id);
  assert.equal(persisted?.contentMarkdown, literal);
  assert.equal(new Set(persisted?.segments.map((segment) => segment.speaker)).size, 2);
  database.closeDb();
  console.log(JSON.stringify({
    model: STUDY_DIARIZATION_MODEL,
    turns: result.transcript.segments.length,
    speakers: result.speakers.length,
    validTimeline: result.transcript.segments.every((segment) => segment.tEnd > segment.tStart),
    literalPreserved: true,
    persisted: true,
  }));
} finally {
  fs.rmSync(userDataPath, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-audit', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function compile(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
