// Workspace notes linked to courses, subjects, folders, topics and materials of a study or
// teaching vault, against the real repositories and SQLite. Runs under Electron-as-Node
// for the native SQLite ABI.
//
// The promises under test: a link shows its note wherever its path reaches and nowhere
// else; the trash on either side hides a link without destroying it; moving part of the
// organisation carries the link along; and only deleting the note or the material for
// good removes it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-study-note-links-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-note-links.mjs'), '--electron-study-note-links-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-note-links-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const notes = require(path.join(repoRoot, 'electron/db/notesRepo.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const links = require(path.join(repoRoot, 'electron/db/studyNoteLinksRepo.ts'));
  const shared = require(path.join(repoRoot, 'shared/studyNoteLinks.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { syncedTablesByGroup } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));

  assert.ok(SCHEMA_VERSION >= 196, 'note links need schema v196 or later');
  assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='study_note_links'").get());
  assert.ok(syncedTablesByGroup().find((group) => group.key === 'study')?.tables.includes('study_note_links'), 'links travel with the study group');

  // ── The migration is create-only and can replay ────────────────────────────────
  {
    const scratch = new Database(path.join(root, 'replay.sqlite'));
    runMigrations(scratch);
    scratch.pragma('user_version = 195');
    runMigrations(scratch);
    assert.equal(scratch.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'replaying 196 over an existing table is harmless');
    scratch.exec('DROP TABLE study_note_links');
    runMigrations(scratch);
    assert.ok(scratch.prepare("SELECT 1 FROM sqlite_master WHERE name='study_note_links'").get(), 'a vault past 196 without the table gets it back');
    scratch.close();
  }

  // ── Organisation ────────────────────────────────────────────────────────────────
  const courseA = org.createStudyCourse({ name: 'Curso A' });
  const courseB = org.createStudyCourse({ name: 'Curso B' });
  const subjectA = org.createStudySubject({ name: 'Asignatura A', courseId: courseA.id });
  const subjectB = org.createStudySubject({ name: 'Asignatura B', courseId: courseB.id });
  const folder = org.createStudyFolder({ name: 'Bloque 1', courseId: courseA.id, subjectId: subjectA.id });
  const topic = org.createStudyTopic({ name: 'Unidad 1', subjectId: subjectA.id, folderId: folder.id });
  const otherTopic = org.createStudyTopic({ name: 'Unidad 2', subjectId: subjectA.id });

  const note = notes.createNote({ title: 'Resumen de la unidad', content: '# Resumen\n\nIdeas **clave** de la [unidad](nodus://x).', tags: ['repaso'] });
  const other = notes.createNote({ title: 'Otra nota', content: 'Texto.' });

  // ── A topic link resolves its whole path ───────────────────────────────────────
  const topicLink = links.addStudyNoteLink({ noteId: note.id, topicId: topic.id });
  assert.deepEqual(
    [topicLink.courseId, topicLink.subjectId, topicLink.folderId, topicLink.topicId, topicLink.materialId],
    [courseA.id, subjectA.id, folder.id, topic.id, null],
    'a topic brings its folder, subject and course'
  );
  assert.equal(topicLink.note.title, 'Resumen de la unidad');
  assert.equal(topicLink.note.excerpt, 'Resumen Ideas clave de la unidad.', 'the excerpt is readable text, not Markdown');
  assert.deepEqual(topicLink.note.tags, ['repaso']);

  const again = links.addStudyNoteLink({ noteId: note.id, topicId: topic.id, subjectId: subjectB.id });
  assert.equal(again.id, topicLink.id, 'linking twice returns the same link, and the topic decides over a stray subject');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM study_note_links').get().c, 1);

  const subjectLink = links.addStudyNoteLink({ noteId: note.id, subjectId: subjectB.id });
  assert.equal(subjectLink.courseId, courseB.id, 'a subject brings its course');
  const folderLink = links.addStudyNoteLink({ noteId: other.id, folderId: folder.id });
  assert.deepEqual([folderLink.courseId, folderLink.subjectId, folderLink.folderId, folderLink.topicId], [courseA.id, subjectA.id, folder.id, null]);

  // ── Where each note shows ───────────────────────────────────────────────────────
  const ids = (filter) => links.listStudyNoteLinks(filter).map((link) => link.noteId).sort();
  assert.deepEqual(ids({ topicId: topic.id }), [note.id]);
  assert.deepEqual(ids({ topicId: otherTopic.id }), [], 'a sibling topic shows nothing');
  assert.deepEqual(ids({ folderId: folder.id }), [note.id, other.id].sort());
  assert.deepEqual(ids({ subjectId: subjectA.id }), [note.id, other.id].sort());
  assert.deepEqual(ids({ courseId: courseB.id }), [note.id]);
  assert.deepEqual(links.listStudyNoteLinks({ noteId: note.id }).map((link) => link.id), [topicLink.id, subjectLink.id], 'a note lists its links in the order they were made');

  const all = links.listStudyNoteLinks();
  assert.equal(shared.groupStudyNoteLinks(all).length, 2);
  assert.equal(shared.groupStudyNoteLinks(all).find((entry) => entry.note.id === note.id).links.length, 2);
  assert.ok(shared.studyNoteLinkShowsIn(topicLink, { kind: 'subject', id: subjectA.id }));
  assert.ok(!shared.studyNoteLinkShowsIn(topicLink, { kind: 'subject', id: subjectB.id }));
  assert.deepEqual(shared.studyNoteLinkTarget(topicLink), { kind: 'topic', id: topic.id });
  const workspace = org.getStudyWorkspace();
  assert.equal(shared.studyNoteLinkLabel(topicLink, workspace), 'Curso A / Asignatura A / Bloque 1 / Unidad 1');

  // ── Errors ──────────────────────────────────────────────────────────────────────
  assert.throws(() => links.addStudyNoteLink({ noteId: 'missing', subjectId: subjectA.id }), /La nota no existe\./);
  assert.throws(() => links.addStudyNoteLink({ noteId: note.id }), /La ubicación necesita un destino\./);
  assert.throws(() => links.addStudyNoteLink({ noteId: note.id, topicId: 'missing' }), /El destino ya no está disponible\./);
  assert.throws(() => links.addStudyNoteLink({ noteId: note.id, materialId: 'missing' }), /El material no está disponible\./);

  // ── Trash hides, restore brings back ────────────────────────────────────────────
  notes.trashNotes([note.id]);
  assert.deepEqual(ids({ subjectId: subjectA.id }), [other.id], 'a note in the Workspace trash disappears from its places');
  assert.throws(() => links.addStudyNoteLink({ noteId: note.id, courseId: courseA.id }), /La nota está en la papelera\./);
  notes.restoreNotes([note.id]);
  assert.deepEqual(ids({ subjectId: subjectA.id }), [note.id, other.id].sort(), 'restoring the note restores its links');

  org.setStudyLifecycle('topic', topic.id, 'trash');
  assert.deepEqual(ids({ noteId: note.id }), [note.id], 'a topic in the study trash hides that link only');
  assert.equal(notes.getNote(note.id)?.trashedAt, null, 'trashing a topic never touches the Workspace note');
  org.setStudyLifecycle('topic', topic.id, 'recover');
  assert.equal(links.listStudyNoteLinks({ noteId: note.id }).length, 2);

  org.setStudyLifecycle('subject', subjectB.id, 'archive');
  assert.deepEqual(ids({ courseId: courseB.id }), [], 'an archived subject hides its links');
  org.setStudyLifecycle('subject', subjectB.id, 'restore');
  assert.deepEqual(ids({ courseId: courseB.id }), [note.id]);

  // ── Moving the organisation carries the link along ─────────────────────────────
  org.moveStudyEntity('topic', topic.id, { subjectId: subjectB.id, folderId: null, parentId: null });
  const moved = links.listStudyNoteLinks({ topicId: topic.id })[0];
  assert.deepEqual([moved.courseId, moved.subjectId, moved.folderId], [courseB.id, subjectB.id, null], 'the link follows its topic');
  assert.deepEqual(ids({ subjectId: subjectA.id }), [other.id]);

  // ── Materials ───────────────────────────────────────────────────────────────────
  const file = path.join(root, 'Material.txt');
  fs.writeFileSync(file, 'Contenido del material.');
  const imported = await materials.importStudyMaterialFile(file, { courseId: courseA.id, subjectId: subjectA.id });
  const materialLink = links.addStudyNoteLink({ noteId: note.id, materialId: imported.material.id });
  assert.deepEqual([materialLink.courseId, materialLink.subjectId, materialLink.materialId], [null, null, imported.material.id], 'a material link carries only the material');
  assert.equal(materialLink.materialTitle, imported.material.title);
  assert.equal(shared.studyNoteLinkLabel(materialLink, workspace), imported.material.title);
  assert.deepEqual(ids({ materialId: imported.material.id }), [note.id]);
  assert.deepEqual(ids({ subjectId: subjectA.id }), [other.id], 'a material link does not show in the material\'s own locations');
  materials.setStudyMaterialLifecycle(imported.material.id, 'trash');
  assert.deepEqual(ids({ materialId: imported.material.id }), []);
  materials.setStudyMaterialLifecycle(imported.material.id, 'recover');
  assert.deepEqual(ids({ materialId: imported.material.id }), [note.id]);
  materials.setStudyMaterialLifecycle(imported.material.id, 'delete');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM study_note_links WHERE material_id = ?').get(imported.material.id).c, 0, 'deleting a material for good takes its links');

  // ── Unlinking and deleting for good ─────────────────────────────────────────────
  links.removeStudyNoteLinks([subjectLink.id]);
  assert.deepEqual(links.listStudyNoteLinks({ noteId: note.id }).map((link) => link.id), [topicLink.id]);
  assert.ok(notes.getNote(note.id), 'unlinking leaves the note in the Workspace');

  // A link whose note has not arrived yet (another sync group) is kept, just not shown.
  getDb().prepare(`INSERT INTO study_note_links (id, note_id, subject_id, course_id, created_at, updated_at) VALUES ('early', 'not-synced-yet', ?, ?, ?, ?)`)
    .run(subjectA.id, courseA.id, new Date().toISOString(), new Date().toISOString());
  assert.ok(!links.listStudyNoteLinks().some((link) => link.id === 'early'));
  assert.ok(getDb().prepare("SELECT 1 FROM study_note_links WHERE id = 'early'").get(), 'reading never deletes an orphan link');

  notes.deleteNote(note.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM study_note_links WHERE note_id = ?').get(note.id).c, 0, 'deleting a note for good takes its links');

  closeDb();
  console.log('Study note links test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
