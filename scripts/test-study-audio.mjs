// Study vault phase 9: generalized local narration segments, regenerable clip
// catalogue, per-subject pronunciations, bookmarks and playlists.

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

if (!process.argv.includes('--electron-study-audio-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-audio.mjs'), '--electron-study-audio-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-audio-test-'));
installRuntimeHooks(root);

try {
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const audio = require(path.join(repoRoot, 'electron/audio/audioService.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const course = org.createStudyCourse({ name: 'Psicología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Cognición' });
  const document = org.createStudyDocument({
    title: 'Memoria operativa', contentMarkdown: '# Memoria\n\nLa TCC usa $x^2$ como ejemplo.\n\n## Referencias\n\nEsto no debe narrarse.',
    placement: { courseId: course.id, subjectId: subject.id },
  });
  audio.setStudyPronunciations(subject.id, [{ written: 'TCC', spoken: 'te ce ce' }]);
  const segments = audio.getEntitySegments('study_document', document.id, { pronunciations: audio.getStudyPronunciations(subject.id) });
  assert.ok(segments.some((segment) => segment.text.includes('te ce ce')));
  assert.ok(segments.some((segment) => segment.text.includes('al cuadrado')));
  assert.ok(!segments.some((segment) => segment.text.includes('no debe narrarse')));

  const selection = audio.getEntitySegments('study_document', document.id, { mode: 'selection', selection: 'Sólo la selección.' });
  assert.equal(selection.length, 1);
  const clip = audio.saveClip('study_document', document.id, {
    segmentIndex: 0, segmentLabel: segments[0].label, provider: 'piper', voice: 'es_ES-test', language: 'es', bytes: minimalWav(),
  });
  assert.equal(audio.listEntityClips('study_document', document.id)[0].id, clip.id);
  assert.ok(audio.readClipBytes(clip.id)?.bytes.length >= 44);
  const bookmark = audio.createStudyAudioBookmark('study_document', document.id, 0, 'Definición clave');
  assert.equal(audio.listStudyAudioBookmarks('study_document', document.id)[0].label, 'Definición clave');
  assert.equal(audio.listStudyAudioPlaylist(subject.id)[0].title, document.title);
  audio.deleteStudyAudioBookmark(bookmark.id);
  assert.equal(audio.listStudyAudioBookmarks('study_document', document.id).length, 0);
  audio.clearEntityClips('study_document', document.id);
  assert.equal(audio.listEntityClips('study_document', document.id).length, 0);
  assert.equal(fs.existsSync(path.join(root, 'study-audio-meta.json')), true, 'regenerable study audio metadata stays outside SQLite');

  closeDb();
  console.log('Study local narration phase 9 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function minimalWav() {
  const buffer = Buffer.alloc(48);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(40, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(4, 40);
  return new Uint8Array(buffer);
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
