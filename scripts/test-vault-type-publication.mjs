// What each vault type publishes, and what it must never publish.
//
// Genealogy, teaching, study and databases used to publish nothing at all: only the academic
// core and Worldbuilding had a table family, so a connected replica of any other type
// received its images and not one row. These pin the families, and — more importantly — the
// four exclusions that a wildcard once let through.
//
// The study exclusions are the ones worth stating: the snapshot selected `study_*` by prefix,
// which swept in class recordings, attempt records and grading runs. That is a performance
// transcript, not shareable material.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-vault-type-publication.mjs'), '--electron-vault-types')) {
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-vault-types-'));
installRuntimeHooks(root);

const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const snapshotModule = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const { applySnapshotToReplica } = require(path.join(repoRoot, 'electron/serverSync/replicaApply.ts'));
const Database = require('better-sqlite3');

const NOW = '2026-01-01T00:00:00.000Z';

function fresh(name) {
  const db = new Database(path.join(root, `${name}.sqlite`));
  runMigrations(db);
  return db;
}

function publish(db, type) {
  const built = snapshotModule.buildServerSnapshot(
    { id: 'x', name: 'x', type },
    { nodusServerIncludeUserContent: true, nodusServerIncludePassages: false },
    db,
  );
  return { built, payload: JSON.parse(built.buffer.toString('utf8')) };
}

test('every vault type publishes its own corpus', async () => {
  const cases = [
    ['genealogy', 'GENEALOGY_SERVER_TABLES', ['persons', 'relationships', 'places', 'events']],
    ['estudio', 'STUDY_SERVER_TABLES', ['study_subjects', 'study_docs', 'study_flashcards']],
    ['docencia', 'TEACHING_SERVER_TABLES', ['teaching_exams', 'teaching_rubrics']],
    ['databases', 'DATABASES_SERVER_TABLES', ['db_databases', 'db_columns', 'db_rows', 'db_cells']],
  ];
  const db = fresh('families');
  try {
    for (const [type, exportName, expected] of cases) {
      const family = snapshotModule[exportName];
      assert.ok(Array.isArray(family), `${exportName} is not exported`);
      for (const table of expected) assert.ok(family.includes(table), `${type} must publish ${table}`);
      // A type with no family publishes nothing but the academic core, which is the state
      // these four were in.
      const { payload } = publish(db, type);
      for (const table of expected) {
        assert.ok(Array.isArray(payload.tables[table]), `${type} does not select ${table} at all`);
      }
    }
  } finally { db.close(); }
});

test('a study or teaching publication carries no rosters, recordings or performance records', async () => {
  const db = fresh('study-exclusions');
  try {
    for (const type of ['estudio', 'docencia']) {
      const { payload } = publish(db, type);
      for (const forbidden of [
        // Class audio. The bytes were already stripped, but the row says what was recorded.
        'study_recordings',
        // How well somebody did. A transcript, not a shareable material.
        'study_attempts', 'study_attempt_answers', 'study_grading_runs', 'study_grading_annotations',
        'study_mastery', 'study_reviews', 'study_srs_state',
        // Local telemetry that means nothing to a reader.
        'study_ai_usage',
        // Students, always.
        'teaching_students', 'teaching_groups', 'teaching_grade_entries', 'teaching_rubric_evaluations',
      ]) {
        assert.equal(payload.tables[forbidden], undefined, `${type} must not publish ${forbidden}`);
      }
    }
    // And the family itself names none of them, so a future migration cannot slip one in.
    for (const forbidden of ['study_recordings', 'study_attempts', 'study_mastery', 'study_ai_usage']) {
      assert.ok(!snapshotModule.STUDY_SERVER_TABLES.includes(forbidden));
    }
  } finally { db.close(); }
});

test('a database attachment travels as metadata and never as bytes', async () => {
  const db = fresh('databases');
  try {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
    db.prepare('INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('db-1', 'AAA', 'Fotografías', '📷', 0, NOW, NOW);
    db.prepare('INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('c-1', 'db-1', 'Título', 'text', 0, '{}', NOW);
    db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?,?,?,?,?)').run('r-1', 'db-1', 0, NOW, NOW);
    db.prepare(`INSERT INTO db_cells
      (database_id, row_id, column_id, value_type, value_text, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`)
      .run('db-1', 'r-1', 'c-1', 'text', 'Una fotografía', NOW, NOW);
    db.prepare(`INSERT INTO db_attachments
      (id, database_id, row_id, column_id, file_name, mime_type, bytes, blob, content_hash,
       position, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('a-1', 'db-1', 'r-1', 'c-1', 'expediente.pdf', 'application/pdf', pdf.length, pdf, 'hash', 0, NOW, NOW);

    const { built, payload } = publish(db, 'databases');
    const attachment = payload.tables.db_attachments[0];
    // The reader learns a file exists and what it is called…
    assert.equal(attachment.file_name, 'expediente.pdf');
    assert.equal(attachment.mime_type, 'application/pdf');
    // …and never receives one byte of it, on either channel.
    assert.equal(attachment.blob, undefined);
    assert.equal(attachment.thumb, undefined);
    assert.equal(built.assets.length, 0, 'a database attachment must not become a published asset');
    assert.ok(!built.buffer.toString('binary').includes('%PDF'), 'the document leaked into the publication');
  } finally { db.close(); }
});

test('a replica applies a publication twice without cascades destroying it', async () => {
  // Two faults met here on a real study vault. Emptying a parent fired ON DELETE SET NULL
  // into a child whose CHECK then failed, aborting the whole pull; and `person_portraits.blob`
  // is NOT NULL while a snapshot never carries binary, so the row could not be inserted at
  // all. A genealogy replica arrived completely empty and said nothing.
  const source = fresh('cascade-source');
  const target = fresh('cascade-target');
  try {
    // A TEXT PRIMARY KEY is not reported as NOT NULL by SQLite, so it has to be named
    // explicitly or the portrait's foreign key has nothing to point at.
    source.prepare('INSERT INTO persons (person_id, display_name, created_at, updated_at) VALUES (?,?,?,?)')
      .run('p-1', 'Ana Pérez', NOW, NOW);
    source.prepare('INSERT INTO person_names (id, person_id, name, kind) VALUES (?,?,?,?)').run('n-1', 'p-1', 'Ana Pérez', 'birth');
    source.prepare('INSERT INTO person_portraits (person_id, blob, mime, updated_at) VALUES (?,?,?,?)')
      .run('p-1', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png', NOW);

    const { payload } = publish(source, 'genealogy');
    assert.ok(Array.isArray(payload.tables.person_portraits), 'the portrait row must travel as metadata');

    for (const pass of [1, 2]) {
      applySnapshotToReplica(target, payload);
      assert.equal(target.prepare('SELECT COUNT(*) n FROM persons').get().n, 1, `persons missing after pass ${pass}`);
      assert.equal(target.prepare('SELECT COUNT(*) n FROM person_portraits').get().n, 1, `portrait row missing after pass ${pass}`);
    }
    // The row exists with an empty placeholder, which is exactly what the asset pass treats
    // as "not downloaded yet".
    const portrait = target.prepare("SELECT blob FROM person_portraits WHERE person_id = 'p-1'").get();
    assert.ok(Buffer.isBuffer(portrait.blob));
    assert.equal(portrait.blob.length, 0);

    // Once the bytes are there, a further pull must not reset them to the placeholder —
    // otherwise every pull re-downloads the whole gallery.
    const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    target.prepare("UPDATE person_portraits SET blob = ? WHERE person_id = 'p-1'").run(bytes);
    applySnapshotToReplica(target, payload);
    assert.ok(target.prepare("SELECT blob FROM person_portraits WHERE person_id = 'p-1'").get().blob.equals(bytes),
      'a pull reset an image the replica had already downloaded');
  } finally {
    source.close();
    target.close();
  }
});

test('a pull never carries away the queue this machine is running', async () => {
  const source = fresh('queue-source');
  const target = fresh('queue-target');
  try {
    for (const db of [source, target]) {
      db.prepare(`INSERT INTO works (nodus_id, zotero_key, title, authors_json, deep_status, deep_hash)
        VALUES ('w-queue','ZQ','Obra','[]','done','h1')`).run();
    }
    // The replica queued a rescan of a work that already holds an analysis: deep_status
    // stays 'done', so deep_queued is the ONLY record that the job exists, and
    // resumePending is the only thing that survives a restart to find it.
    target.prepare("UPDATE works SET deep_queued = 1 WHERE nodus_id = 'w-queue'").run();

    const { payload } = publish(source, 'academico');
    assert.ok(Array.isArray(payload.tables.works), 'works travel in a publication');
    assert.ok(payload.tables.works.every((row) => !('deep_queued' in row) || row.deep_queued === 0),
      'the owner never publishes a queue for anyone else to run');

    applySnapshotToReplica(target, payload);
    assert.equal(target.prepare("SELECT deep_queued FROM works WHERE nodus_id = 'w-queue'").get().deep_queued, 1,
      'a pull wiped a rescan this replica had queued');
  } finally {
    source.close();
    target.close();
  }
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });
