import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const snapshot = read('electron/serverSync/serverSnapshot.ts');
const library = read('electron/serverSync/serverLibrary.ts');
const service = read('electron/serverSync/serverSyncService.ts');
const contract = read('shared/serverPublication.ts');

test('canonical snapshot excludes personal annotation/read tables', () => {
  const userTables = snapshot.slice(snapshot.indexOf('const USER_TABLES'), snapshot.indexOf('export const TEACHING_SERVER_TABLES'));
  for (const table of ['writing_draft_annotations', 'writing_draft_reads', 'note_annotations']) {
    assert.doesNotMatch(userTables, new RegExp(`['"]${table}['"]`));
  }
  const studyTables = snapshot.slice(snapshot.indexOf('export const STUDY_SERVER_TABLES'), snapshot.indexOf('export const PRIMARY_SOURCES_SERVER_TABLES'));
  for (const table of ['study_annotations', 'study_material_annotations']) {
    assert.doesNotMatch(studyTables, new RegExp(`['"]${table}['"]`));
  }
  assert.match(snapshot, /buildServerPersonalImport/);
});

test('library annotations are personal overlay data, not manifest data', () => {
  assert.match(library, /personalAnnotations/);
  const documentInterface = library.slice(library.indexOf('export interface PublishedLibraryDocument'), library.indexOf('export interface PublishedLibraryManifest'));
  assert.doesNotMatch(documentInterface, /annotations\s*:/);
});

test('primary-source/testimony projections and permanent denylist are explicit', () => {
  assert.match(snapshot, /PRIMARY_SOURCES_SERVER_TABLES/);
  assert.match(snapshot, /TESTIMONIES_SERVER_TABLES/);
  for (const table of ['testimony_media', 'testimony_agreements', 'teaching_students', 'teaching_grade_entries', 'study_attempts']) {
    assert.match(contract, new RegExp(`['"]${table}['"]`));
  }
  assert.match(snapshot, /DENIED_COLUMN_PATTERN/);
});

test('classic publisher consults policy before snapshot and posts a publisher envelope', () => {
  const policyAt = service.indexOf('readPublicationPolicy(config, token)');
  const snapshotAt = service.indexOf('buildServerSnapshotInUtility({');
  assert.ok(policyAt >= 0 && policyAt < snapshotAt);
  assert.match(contract, /personal-annotations\/import/);
  assert.match(service, /x-nodus-publisher-id/);
  assert.match(service, /annotations/);
  assert.match(contract, /nodus\.server-personal-import/);
});
