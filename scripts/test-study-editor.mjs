// Study vault phase 2: pure Markdown helpers plus real v54 versioning,
// annotations, links/backlinks, style isolation and v53 upgrade preservation.

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

if (!process.argv.includes('--electron-study-editor-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-editor.mjs'), '--electron-study-editor-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-editor-test-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const shared = require(path.join(repoRoot, 'shared/studyEditor.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const editor = require(path.join(repoRoot, 'electron/db/studyEditorRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.equal(SCHEMA_VERSION, 54, 'phase 2 owns schema v54');
  assert.equal(getDb().pragma('user_version', { simple: true }), 54);
  for (const table of ['study_doc_versions', 'study_annotations', 'study_doc_links']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  const markdown = '# Uno\n\n## Dos\n\n```md\n# No es título\n```\n\n### Tres';
  assert.deepEqual(shared.extractStudyOutline(markdown).map((item) => [item.level, item.text]), [[1, 'Uno'], [2, 'Dos'], [3, 'Tres']]);
  assert.deepEqual(shared.studyDocumentStats('Uno dos tres\n\nCuatro cinco'), { words: 5, characters: 26, paragraphs: 2, readingMinutes: 1 });
  assert.deepEqual(shared.parseStudyDocLinks('[B](nodus://study/doc/doc-2) y [[DOC-ABCD|otra]]'), [
    { targetRef: 'doc-2', label: 'B' }, { targetRef: 'DOC-ABCD', label: 'otra' },
  ]);
  assert.equal(shared.normalizeStudyDocStyle({ fontSize: 100, pageWidth: 20 }).fontSize, 32, 'style values clamp');
  assert.match(shared.studyCommandMarkdown('tabla'), /\| --- \|/);

  const target = org.createStudyDocument({ title: 'Documento B', contentMarkdown: '# B' });
  const source = org.createStudyDocument({ title: 'Documento A', contentMarkdown: '# Original' });
  const originalContent = source.contentMarkdown;
  const complex = `# Documento A\n\nTexto **fuerte** y $x^2$.\n\n[[${target.shortId}|Documento B]]`;
  const updated = editor.updateStudyDoc(source.id, {
    title: 'Documento A revisado',
    contentMarkdown: complex,
    style: { fontFamily: 'sans', fontSize: 19, alignment: 'justify' },
    customDictionary: ['Milkdown', 'Nodus'],
    reason: 'manual',
  });
  assert.equal(updated.contentMarkdown, complex, 'clean Markdown round-trips exactly');

  let sourceData = editor.getStudyDocEditorData(source.id);
  assert.equal(sourceData.versions.length, 1, 'pre-save state captured');
  assert.equal(sourceData.versions[0].contentMarkdown, originalContent);
  assert.equal(sourceData.style.fontFamily, 'sans');
  assert.equal(sourceData.style.fontSize, 19);
  assert.deepEqual(sourceData.customDictionary, ['Milkdown', 'Nodus']);
  assert.equal(sourceData.outgoingLinks[0].targetDocumentId, target.id, 'short id resolves to target');
  assert.equal(editor.getStudyDocEditorData(target.id).backlinks[0].sourceDocumentId, source.id, 'backlink generated');

  editor.updateStudyDoc(source.id, { title: updated.title, contentMarkdown: `${complex}\n\nCambio 2`, reason: 'autosave' });
  sourceData = editor.getStudyDocEditorData(source.id);
  assert.equal(sourceData.versions.length, 2, 'each distinct saved state is recoverable');

  const annotation = editor.createStudyAnnotation(source.id, {
    from: 2, to: 13, selectedText: 'Documento A', comment: 'Revisar esta sección', pinned: true, locked: true,
  });
  assert.equal(annotation.pinned, true);
  assert.equal(annotation.locked, true);
  assert.throws(() => editor.updateStudyDoc(source.id, { title: updated.title, contentMarkdown: 'Fragmento eliminado' }), /bloqueado/, 'locked fragment cannot be removed');
  assert.ok(editor.updateStudyAnnotation(annotation.id, { resolved: true }).resolvedAt, 'annotation resolves');
  assert.equal(editor.updateStudyAnnotation(annotation.id, { resolved: false, pinned: false }).resolvedAt, null, 'annotation reopens');
  editor.deleteStudyAnnotation(annotation.id);
  assert.equal(editor.getStudyDocEditorData(source.id).annotations.length, 0, 'annotation deletion works');

  const firstVersion = sourceData.versions.find((version) => version.contentMarkdown === originalContent);
  assert.ok(firstVersion);
  const restored = editor.restoreStudyDocVersion(source.id, firstVersion.id);
  assert.equal(restored.contentMarkdown, originalContent, 'version restoration works');
  assert.ok(editor.getStudyDocEditorData(source.id).versions.some((version) => version.contentMarkdown.includes('Cambio 2')), 'state before restore retained');

  // Upgrade a real v53 file with an existing study document.
  const legacy = new Database(path.join(root, 'legacy-v53.sqlite'));
  for (const migration of migrations.filter((item) => item.version <= 53).sort((a, b) => a.version - b.version)) {
    legacy.exec(migration.up); legacy.pragma(`user_version = ${migration.version}`);
  }
  const timestamp = new Date().toISOString();
  legacy.prepare(`INSERT INTO study_docs
    (id, short_id, title, kind, content_markdown, position, created_at, updated_at) VALUES (?, ?, ?, 'apunte', ?, 0, ?, ?)`)
    .run('legacy-doc', 'DOC-LEGACY', 'Legado', '# Conservado', timestamp, timestamp);
  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), 54);
  const legacyDoc = legacy.prepare('SELECT title, content_markdown, style_json FROM study_docs WHERE id = ?').get('legacy-doc');
  assert.deepEqual(legacyDoc, { title: 'Legado', content_markdown: '# Conservado', style_json: '{}' }, 'v53 document preserved');
  legacy.close();

  closeDb();
  console.log('Study editor phase 2 tests passed!');
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
