// Study vault phase 5: multi-format local ingestion, hash dedupe, placements,
// annotations, note provenance, replacement/versioning and lifecycle.

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

if (!process.argv.includes('--electron-study-materials-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-materials.mjs'), '--electron-study-materials-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-materials-test-'));
installRuntimeHooks(root);

try {
  const AdmZip = require('adm-zip');
  const shared = require(path.join(repoRoot, 'shared/studyMaterials.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 57);
  for (const table of ['study_materials', 'study_material_placements', 'study_material_annotations', 'study_material_fragment_links', 'study_material_versions']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }
  assert.equal(shared.studyMaterialPreviewKind('pdf'), 'pdf');
  assert.equal(shared.studyMaterialPreviewKind('mp3'), 'audio');
  assert.equal(shared.studyMaterialLocationLabel({ materialId: 'm', materialTitle: 'Manual', pageNumber: 7 }), 'Manual · p. 7');
  assert.deepEqual(shared.parseStudyMaterialMarkers('[[p. 2]] A [[slide. 3]] B').map((item) => [item.kind, item.number]), [['page', 2], ['slide', 3]]);

  const course = org.createStudyCourse({ name: 'Curso materiales' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Asignatura materiales' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Tema fuentes' });

  const textPath = path.join(root, 'manual.txt');
  const replacementPath = path.join(root, 'manual-revisado.md');
  const htmlPath = path.join(root, 'articulo.html');
  const pptxPath = path.join(root, 'clase.pptx');
  const audioPath = path.join(root, 'clase.wav');
  fs.writeFileSync(textPath, 'Manual inicial con concepto de prueba.');
  fs.writeFileSync(replacementPath, '# Manual actualizado\n\nNueva redacción conservada.');
  fs.writeFileSync(htmlPath, '<html><body><h1>Artículo</h1><p>Texto HTML extraído.</p></body></html>');
  fs.writeFileSync(audioPath, Buffer.from('RIFFfakeWAVE'));
  const zip = new AdmZip();
  zip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld xmlns:a="a" xmlns:p="p"><a:t>Primera diapositiva</a:t><a:t>Concepto A</a:t></p:sld>'));
  zip.addFile('ppt/slides/slide2.xml', Buffer.from('<p:sld xmlns:a="a" xmlns:p="p"><a:t>Segunda diapositiva</a:t></p:sld>'));
  zip.writeZip(pptxPath);

  const first = await materials.importStudyMaterialFile(textPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id, tags: ['manual'] });
  assert.equal(first.duplicate, false);
  assert.equal(first.material.previewKind, 'document');
  assert.equal(first.material.extractionStatus, 'ready');
  assert.ok(first.material.extractedChars > 20);
  const duplicate = await materials.importStudyMaterialFile(textPath, { courseId: course.id });
  assert.equal(duplicate.duplicate, true, 'same bytes dedupe by SHA-256');
  assert.equal(materials.getStudyMaterial(first.material.id).placements.length, 2, 'duplicate import adds a missing placement without copying the blob');
  assert.deepEqual(Buffer.from(materials.getStudyMaterialContent(first.material.id).bytes), fs.readFileSync(textPath));

  const updated = materials.updateStudyMaterial(first.material.id, {
    readState: 'reviewed', favorite: true, metadata: { tags: ['manual', 'examen'], comments: ['Útil'] },
    bibliography: { citation: 'Autora (2026). Manual.', authors: ['Autora'] },
  });
  assert.equal(updated.readState, 'reviewed');
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.metadata.tags, ['manual', 'examen']);
  assert.equal(updated.bibliography.citation, 'Autora (2026). Manual.');
  assert.equal(materials.listStudyMaterials({ search: 'concepto de prueba' })[0].id, first.material.id, 'extracted text is searchable');
  assert.equal(materials.listStudyMaterials({ readState: 'reviewed', favorite: true }).length, 1);

  await materials.replaceStudyMaterialFile(first.material.id, replacementPath);
  let detail = materials.getStudyMaterial(first.material.id);
  assert.match(detail.extractedText, /Manual actualizado/);
  assert.equal(detail.versions.length, 1, 'replacement snapshots the prior blob and extraction');
  assert.equal(detail.placements.length, 2, 'replacement preserves placements');
  materials.restoreStudyMaterialVersion(first.material.id, detail.versions[0].id);
  detail = materials.getStudyMaterial(first.material.id);
  assert.match(detail.extractedText, /Manual inicial/);
  assert.ok(detail.versions.length >= 2, 'restoring also preserves the replaced version');

  const annotation = materials.createStudyMaterialAnnotation(first.material.id, {
    pageNumber: 1, rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 }, selectedText: 'concepto de prueba', note: 'Convertir en apunte',
  });
  assert.equal(annotation.pageNumber, 1);
  assert.equal(materials.updateStudyMaterialAnnotation(annotation.id, { color: '#00ff00' }).color, '#00ff00');
  const note = materials.createStudyNoteFromMaterial(first.material.id, annotation.id, 'Nota enlazada');
  const noteDoc = org.getStudyWorkspace().documents.find((document) => document.id === note.documentId);
  assert.ok(noteDoc);
  assert.match(noteDoc.contentMarkdown, /nodus:\/\/study\/material/);
  assert.match(noteDoc.contentMarkdown, /concepto de prueba/);
  assert.equal(materials.getStudyMaterial(first.material.id).fragmentLinks[0].documentId, note.documentId, 'fragment-to-note provenance is durable');
  materials.deleteStudyMaterialAnnotation(annotation.id);
  assert.equal(materials.getStudyMaterial(first.material.id).annotations.length, 0);

  const html = await materials.importStudyMaterialFile(htmlPath);
  assert.match(materials.getStudyMaterial(html.material.id).extractedText, /Texto HTML extraído/);
  const presentation = await materials.importStudyMaterialFile(pptxPath);
  assert.equal(presentation.material.previewKind, 'presentation');
  assert.equal(presentation.material.metadata.slideCount, 2);
  assert.match(materials.getStudyMaterial(presentation.material.id).extractedText, /\[\[slide\. 2\]\]/);
  const audio = await materials.importStudyMaterialFile(audioPath);
  assert.equal(audio.material.previewKind, 'audio');
  assert.equal(audio.material.extractionStatus, 'unsupported');

  materials.setStudyMaterialLifecycle(html.material.id, 'archive');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === html.material.id), false);
  materials.setStudyMaterialLifecycle(html.material.id, 'restore');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === html.material.id), true);
  materials.setStudyMaterialLifecycle(audio.material.id, 'trash');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === audio.material.id), false);
  materials.setStudyMaterialLifecycle(audio.material.id, 'recover');
  materials.setStudyMaterialLifecycle(audio.material.id, 'delete');
  assert.throws(() => materials.getStudyMaterial(audio.material.id), /no encontrado/);

  closeDb();
  console.log('Study materials phase 5 tests passed!');
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
