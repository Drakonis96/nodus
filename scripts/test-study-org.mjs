// Study vault phase 1: pure tree helpers, real SQLite CRUD, many-to-many
// placements, lifecycle states, duplication, tags/templates, and v52 -> v53
// migration preservation. Runs under Electron-as-Node for the native SQLite ABI.

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

if (!process.argv.includes('--electron-study-org-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-org.mjs'), '--electron-study-org-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-org-test-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const scheduleRepo = require(path.join(repoRoot, 'electron/db/studyScheduleRepo.ts'));
  const shared = require(path.join(repoRoot, 'shared/studyOrg.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 53, 'phase 1 requires schema v53 or later');
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION, `fresh vault migrates through v${SCHEMA_VERSION}`);
  for (const table of ['study_courses', 'study_subjects', 'study_topics', 'study_folders', 'study_docs', 'study_placements', 'study_tags', 'study_doc_tags', 'study_templates', 'study_schedule_periods', 'study_schedule_cells', 'study_schedule_day_styles']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  assert.equal(shared.normalizeStudyName('  Historia   moderna  '), 'Historia moderna');
  assert.match(shared.createStudyShortId('crs', '12345678-abcd'), /^CRS-12345678$/);
  assert.equal(shared.studyPlacementKey({ courseId: 'c', topicId: 't' }), 'c::t:');

  const course = org.createStudyCourse({ name: 'Historia', color: '#0f766e', icon: 'graduation', emoji: '🏛️', imageData: 'data:image/png;base64,aA==', year: 2026, description: 'Curso enriquecido' });
  assert.equal(course.emoji, '🏛️');
  assert.equal(course.imageData, 'data:image/png;base64,aA==');
  assert.equal(course.year, 2026);
  const subject = org.createStudySubject({ courseId: course.id, name: 'Historia contemporánea' });
  const defaultSchedule = scheduleRepo.getStudySchedule();
  assert.equal(defaultSchedule.periods.length, 2, 'schedule starts with morning and afternoon rows');
  assert.deepEqual(defaultSchedule.periods.map((period) => period.section), ['morning', 'afternoon']);
  const morning = defaultSchedule.periods[0];
  const savedSchedule = scheduleRepo.saveStudySchedule({ ...defaultSchedule, cells: [{ day: 'monday', periodId: morning.id, subjectId: subject.id, activityTitle: null }, { day: 'tuesday', periodId: morning.id, subjectId: null, activityTitle: 'Tutoría' }], dayColors: { ...defaultSchedule.dayColors, monday: '#0f766e' } });
  assert.equal(savedSchedule.cells[0].subjectId, subject.id, 'subject assignment persists in the selected cell');
  assert.equal(savedSchedule.cells.find((cell) => cell.day === 'tuesday').activityTitle, 'Tutoría', 'independent activity persists in the selected cell');
  assert.equal(savedSchedule.dayColors.monday, '#0f766e', 'weekday header color persists');
  const folder = org.createStudyFolder({ courseId: course.id, subjectId: subject.id, name: 'Unidad 1' });
  const topic = org.createStudyTopic({ subjectId: subject.id, folderId: folder.id, name: 'Revoluciones' });
  const subtopic = org.createStudyTopic({ subjectId: subject.id, parentId: topic.id, name: 'Revolución francesa' });
  assert.equal(subtopic.folderId, folder.id, 'subtopics inherit their parent folder');
  assert.throws(() => org.createStudyTopic({ subjectId: subject.id, folderId: 'missing', name: 'Inválido' }), /carpeta/, 'topics reject folders outside their subject');
  assert.throws(() => org.updateStudyEntity('topic', topic.id, { parentId: subtopic.id }), /ciclo/, 'topic cycles rejected');

  const document = org.createStudyDocument({
    title: 'Apuntes de clase',
    kind: 'apunte',
    contentMarkdown: '# Semana 1',
    placement: { courseId: course.id, subjectId: subject.id, topicId: subtopic.id },
  });
  const secondPlacement = org.addStudyPlacement(document.id, { folderId: folder.id });
  const duplicatePlacement = org.addStudyPlacement(document.id, { folderId: folder.id });
  assert.equal(secondPlacement.id, duplicatePlacement.id, 'same placement is idempotent');
  assert.equal(org.getStudyWorkspace().documents.length, 1, 'one document is not duplicated by multiple placements');
  assert.equal(org.getStudyWorkspace().placements.length, 2, 'document can appear in two locations');

  const updated = org.updateStudyEntity('document', document.id, {
    favorite: true, color: '#115e59', icon: 'book', emoji: '📝', imageData: 'data:image/png;base64,Yg==', year: 2025, title: 'Apuntes revisados',
  });
  assert.equal(updated.favorite, true);
  assert.equal(updated.color, '#115e59');
  assert.equal(updated.icon, 'book');
  assert.equal(updated.emoji, '📝');
  assert.equal(updated.imageData, 'data:image/png;base64,Yg==');
  assert.equal(updated.year, 2025);

  const tag = org.createStudyTag({ name: 'Examen', color: '#ef4444' });
  assert.equal(org.createStudyTag({ name: 'examen' }).id, tag.id, 'tags are case-insensitive and idempotent');
  assert.equal(org.setStudyDocumentTags(document.id, [tag.id, tag.id]).length, 1, 'tag links are deduplicated');
  assert.equal(org.updateStudyTag(tag.id, { color: '#dc2626', favorite: true }).favorite, true, 'tags are editable');

  const tree = shared.buildStudyTree(org.getStudyWorkspace());
  assert.equal(tree[0].subjects[0].topics[0].children[0].documents[0].id, document.id, 'pure tree nests topic documents');

  org.setStudyLifecycle('course', course.id, 'archive');
  assert.equal(org.getStudyWorkspace().courses.length, 0, 'archived course hidden by default');
  assert.equal(org.getStudyWorkspace({ includeArchived: true }).courses.length, 1, 'archived course remains recoverable');
  org.setStudyLifecycle('course', course.id, 'restore');
  assert.equal(org.getStudyWorkspace().courses.length, 1, 'course restored');

  org.setStudyLifecycle('document', document.id, 'trash');
  assert.equal(org.getStudyWorkspace().documents.length, 0, 'trashed document hidden');
  assert.equal(org.getStudyWorkspace({ includeDeleted: true }).documents.length, 1, 'trash retains document');
  org.setStudyLifecycle('document', document.id, 'recover');

  const copiedCourse = org.duplicateStudyTree('course', course.id);
  assert.notEqual(copiedCourse.id, course.id);
  assert.match(copiedCourse.name, /copia/);
  assert.equal(copiedCourse.imageData, course.imageData, 'rich visual metadata survives duplication');
  const afterCopy = org.getStudyWorkspace();
  assert.equal(afterCopy.courses.length, 2, 'course duplicated');
  assert.equal(afterCopy.subjects.length, 2, 'complete subject tree duplicated');
  assert.equal(afterCopy.topics.length, 4, 'complete topic tree duplicated');
  assert.equal(afterCopy.folders.length, 2, 'subject folders are duplicated with the course');
  const copiedFolder = afterCopy.folders.find((item) => item.id !== folder.id);
  assert.ok(afterCopy.topics.some((item) => item.folderId === copiedFolder.id), 'copied topics point at the copied folder');
  assert.equal(afterCopy.documents.length, 2, 'document inside tree duplicated once');

  const destinationCourse = org.createStudyCourse({ name: 'Historia comparada' });
  const destinationSubject = org.createStudySubject({ courseId: destinationCourse.id, name: 'Europa' });
  const copiedSubject = org.duplicateStudyTree('subject', subject.id);
  org.moveStudyEntity('subject', copiedSubject.id, { courseId: destinationCourse.id });
  let movedWorkspace = org.getStudyWorkspace();
  assert.equal(movedWorkspace.subjects.find((item) => item.id === copiedSubject.id).courseId, destinationCourse.id, 'subjects move between courses');
  assert.ok(movedWorkspace.folders.filter((item) => item.subjectId === copiedSubject.id).every((item) => item.courseId === destinationCourse.id), 'moving a subject updates descendant folder courses');
  assert.ok(movedWorkspace.placements.filter((item) => item.subjectId === copiedSubject.id).every((item) => item.courseId === destinationCourse.id), 'moving a subject updates document locations');

  const copiedFolderForMove = org.duplicateStudyTree('folder', folder.id);
  org.moveStudyEntity('folder', copiedFolderForMove.id, { subjectId: destinationSubject.id });
  movedWorkspace = org.getStudyWorkspace();
  assert.equal(movedWorkspace.folders.find((item) => item.id === copiedFolderForMove.id).subjectId, destinationSubject.id, 'folders move between subjects');
  assert.ok(movedWorkspace.topics.filter((item) => item.folderId === copiedFolderForMove.id).every((item) => item.subjectId === destinationSubject.id), 'moving a folder updates descendant topics');

  const copiedTopicForMove = org.duplicateStudyTree('topic', topic.id);
  org.moveStudyEntity('topic', copiedTopicForMove.id, { subjectId: destinationSubject.id });
  movedWorkspace = org.getStudyWorkspace();
  assert.equal(movedWorkspace.topics.find((item) => item.id === copiedTopicForMove.id).subjectId, destinationSubject.id, 'topics move between subjects');
  assert.ok(movedWorkspace.placements.filter((item) => item.topicId === copiedTopicForMove.id).every((item) => item.courseId === destinationCourse.id && item.subjectId === destinationSubject.id), 'moving a topic updates document locations');

  const template = org.createStudyTemplate({
    name: 'Curso trimestral',
    kind: 'organization',
    content: { course: { subjects: [{ name: 'Bloque A', topics: [{ name: 'Unidad 1' }, { name: 'Unidad 2' }] }] } },
  });
  assert.equal(org.updateStudyTemplate(template.id, { favorite: true }).favorite, true, 'templates are editable');
  const templatedCourse = org.applyStudyTemplate(template.id, 'Curso desde plantilla');
  assert.equal(templatedCourse.name, 'Curso desde plantilla');
  assert.ok(org.getStudyWorkspace().subjects.some((item) => item.courseId === templatedCourse.id && item.name === 'Bloque A'));
  org.deleteStudyTemplate(template.id);
  assert.equal(org.getStudyWorkspace().templates.length, 0, 'template deletion works');

  // An answer saved from the research chat: the dialog builds the note, the repo stores
  // it, and the vault lists it in the topic the dialog was pointed at.
  const { buildStudyNoteDocument } = require(path.join(repoRoot, 'src/studyNoteFromChat.ts'));
  const captured = org.createStudyDocument(buildStudyNoteDocument({
    title: 'Resumen del chat',
    content: '# Revoluciones\n\nLa respuesta que el usuario leyó.',
    source: {
      origin: 'assistant',
      researchChat: {
        surface: 'study', conversationId: 'chat-1', conversationTitle: 'Historia contemporánea',
        messageId: 'answer-1', messageIndex: 1,
        references: [{ label: 'Diapositivas', subtitle: 'Tema 2', href: 'nodus://study/material/mat-1' }],
      },
    },
    placement: { courseId: course.id, subjectId: subject.id, folderId: folder.id, topicId: subtopic.id },
    savedAt: '2026-09-17T10:00:00.000Z',
  }));
  assert.equal(captured.kind, 'apunte');
  assert.match(captured.contentMarkdown, /\*\*Procedencia:\*\*/);
  const capturedWorkspace = org.getStudyWorkspace();
  assert.equal(capturedWorkspace.documents.find((item) => item.id === captured.id).title, 'Resumen del chat');
  const capturedPlacement = capturedWorkspace.placements.find((item) => item.documentId === captured.id);
  assert.deepEqual(
    { courseId: capturedPlacement.courseId, subjectId: capturedPlacement.subjectId, folderId: capturedPlacement.folderId, topicId: capturedPlacement.topicId },
    { courseId: course.id, subjectId: subject.id, folderId: folder.id, topicId: subtopic.id },
    'the captured note is filed where the dialog said',
  );
  const capturedTreeDocs = shared.buildStudyTree(org.getStudyWorkspace())[0].subjects[0].topics[0].children[0].documents.map((item) => item.id);
  assert.ok(capturedTreeDocs.includes(captured.id), 'the captured note appears in the topic tree');

  // Moving one placement never drops other locations, tags, content, or identity.
  const moveDoc = org.createStudyDocument({ title: 'Mover sin perder datos', contentMarkdown: '**Contenido**', placement: { subjectId: subject.id } });
  org.setStudyDocumentTags(moveDoc.id, [tag.id]);
  const otherLink = org.addStudyPlacement(moveDoc.id, { subjectId: destinationSubject.id });
  const links = () => org.getStudyWorkspace({ includeArchived: true, includeDeleted: true }).placements.filter((p) => p.documentId === moveDoc.id);
  let origin = links().find((p) => p.id !== otherLink.id);
  const globalFolder = org.createStudyFolder({ name: 'Carpeta global' });
  const courseFolder = org.createStudyFolder({ name: 'Carpeta del curso', courseId: course.id });
  const nestedFolder = org.createStudyFolder({ name: 'Subcarpeta', courseId: course.id, subjectId: subject.id, parentId: folder.id });
  const destinations = [
    [{ courseId: course.id }, { courseId: course.id, subjectId: null, folderId: null, topicId: null }],
    [{ folderId: globalFolder.id }, { courseId: null, subjectId: null, folderId: globalFolder.id, topicId: null }],
    [{ folderId: courseFolder.id }, { courseId: course.id, subjectId: null, folderId: courseFolder.id, topicId: null }],
    [{ folderId: nestedFolder.id }, { courseId: course.id, subjectId: subject.id, folderId: nestedFolder.id, topicId: null }],
    [{ topicId: subtopic.id }, { courseId: course.id, subjectId: subject.id, folderId: folder.id, topicId: subtopic.id }],
  ];
  for (const [input, expected] of destinations) {
    const result = org.moveStudyPlacement(moveDoc.id, origin.id, input);
    assert.equal(result.id, origin.id, 'moving preserves the placement ID');
    for (const [field, value] of Object.entries(expected)) assert.equal(result[field], value, field);
    assert.equal(links().length, 2);
    assert.deepEqual(links().find((p) => p.id === otherLink.id), otherLink, 'unselected location is untouched');
    assert.deepEqual(org.getStudyEntity('document', moveDoc.id), moveDoc, 'content and metadata are untouched');
  }
  const beforeInvalid = links();
  for (const invalid of [{ courseId: 'missing' }, { subjectId: 'missing' }, { folderId: 'missing' }, { topicId: 'missing' }, { courseId: destinationCourse.id, topicId: topic.id }, { subjectId: destinationSubject.id, folderId: folder.id }, { folderId: nestedFolder.id, topicId: topic.id }]) {
    assert.throws(() => org.moveStudyPlacement(moveDoc.id, origin.id, invalid));
    assert.deepEqual(links(), beforeInvalid, 'an invalid move is atomic');
  }
  assert.throws(() => org.moveStudyPlacement(moveDoc.id, otherLink.id + '-stale', {}), /origen/);
  assert.throws(() => org.moveStudyPlacement(moveDoc.id, null, {}), /origen/);
  assert.throws(() => org.moveStudyPlacement(document.id, otherLink.id, {}), /origen/);
  assert.deepEqual(org.moveStudyPlacement(moveDoc.id, origin.id, { topicId: subtopic.id }), beforeInvalid.find((p) => p.id === origin.id), 'same destination is a no-op');
  org.setStudyLifecycle('folder', globalFolder.id, 'archive');
  assert.throws(() => org.moveStudyPlacement(moveDoc.id, origin.id, { folderId: globalFolder.id }), /disponible/);
  org.setStudyLifecycle('folder', globalFolder.id, 'restore');
  const merged = org.moveStudyPlacement(moveDoc.id, origin.id, { subjectId: destinationSubject.id });
  assert.equal(merged.id, otherLink.id, 'existing destination is reused');
  assert.equal(links().length, 1);
  assert.equal(org.moveStudyPlacement(moveDoc.id, otherLink.id, {}), null, 'can leave a note unfiled');
  assert.equal(links().length, 0);
  origin = org.moveStudyPlacement(moveDoc.id, null, { subjectId: subject.id });
  getDb().prepare('UPDATE study_placements SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), origin.id);
  const fresh = org.moveStudyPlacement(moveDoc.id, null, { subjectId: subject.id });
  assert.equal(fresh.id, origin.id, 'the unique archived location is reused');
  assert.equal(fresh.archivedAt, null, 'the reused location becomes visible');
  assert.equal(org.getStudyWorkspace().documentTags.filter((link) => link.documentId === moveDoc.id).length, 1);
  org.setStudyLifecycle('document', moveDoc.id, 'trash');
  assert.throws(() => org.moveStudyPlacement(moveDoc.id, fresh.id, {}), /disponible/);
  org.setStudyLifecycle('document', moveDoc.id, 'recover');

  // Folder moves preserve a full subtree and support course/global folders.
  const movableFolder = org.createStudyFolder({ name: 'Traslado', subjectId: subject.id, courseId: course.id });
  const movableChild = org.createStudyFolder({ name: 'Hija', parentId: movableFolder.id, subjectId: subject.id, courseId: course.id });
  const folderDoc = org.createStudyDocument({ title: 'Dentro', placement: { folderId: movableChild.id } });
  assert.throws(() => org.moveStudyEntity('folder', movableFolder.id, { parentId: movableChild.id }), /sí misma/);
  org.moveStudyEntity('folder', movableFolder.id, { parentId: globalFolder.id });
  let movedChild = org.getStudyEntity('folder', movableChild.id);
  assert.equal(movedChild.parentId, movableFolder.id);
  assert.equal(movedChild.subjectId, null);
  assert.equal(movedChild.courseId, null);
  org.moveStudyEntity('folder', movableFolder.id, { courseId: destinationCourse.id });
  assert.equal(org.getStudyEntity('folder', movableChild.id).courseId, destinationCourse.id);
  org.moveStudyEntity('folder', movableFolder.id, { subjectId: destinationSubject.id });
  assert.equal(org.getStudyWorkspace().placements.find((p) => p.documentId === folderDoc.id).subjectId, destinationSubject.id);
  const movableTopic = org.createStudyTopic({ name: 'Tema trasladable', subjectId: destinationSubject.id, folderId: movableChild.id });
  const movableSubtopic = org.createStudyTopic({ name: 'Subtema', subjectId: destinationSubject.id, parentId: movableTopic.id });
  assert.throws(() => org.moveStudyEntity('topic', movableTopic.id, { parentId: movableSubtopic.id }), /sí mismo/);
  assert.throws(() => org.moveStudyEntity('folder', movableFolder.id, {}), /asignatura/, 'topics require a subject');
  assert.equal(org.getStudyEntity('folder', movableFolder.id).subjectId, destinationSubject.id, 'failed move leaves the tree intact');
  org.moveStudyEntity('folder', movableFolder.id, { subjectId: subject.id });
  assert.equal(org.getStudyEntity('topic', movableSubtopic.id).subjectId, subject.id);
  org.moveStudyEntity('topic', movableTopic.id, { subjectId: destinationSubject.id });
  assert.equal(org.getStudyEntity('topic', movableSubtopic.id).subjectId, destinationSubject.id);
  assert.equal(org.getStudyEntity('topic', movableSubtopic.id).folderId, null);
  console.log('Placement move matrix and subtree integrity checks passed.');

  // Upgrade a genuine v52 database and prove unrelated content survives intact.
  const legacyPath = path.join(root, 'legacy-v52.sqlite');
  const legacy = new Database(legacyPath);
  for (const migration of migrations.filter((item) => item.version <= 52).sort((a, b) => a.version - b.version)) {
    legacy.exec(migration.up);
    legacy.pragma(`user_version = ${migration.version}`);
  }
  legacy.prepare('CREATE TABLE phase53_sentinel (value TEXT NOT NULL)').run();
  legacy.prepare('INSERT INTO phase53_sentinel (value) VALUES (?)').run('preserved');
  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(legacy.prepare('SELECT value FROM phase53_sentinel').get().value, 'preserved', 'v52 data preserved');
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='study_docs'").get());
  legacy.close();

  closeDb();
  console.log('Study organization phase 1 tests passed!');
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
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
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
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
