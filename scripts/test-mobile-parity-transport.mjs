import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Desktop Bridge is explicit, pinned and unavailable through Cloudflare', () => {
  const bridge = read('electron/desktopBridge/server.ts');
  const worker = read('cloudflare/src/worker.mjs');
  assert.match(bridge, /createServer\(\{ cert: certPem, key:/);
  assert.match(bridge, /safeStorage\.encryptString/);
  assert.match(bridge, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.doesNotMatch(bridge, /b64:|createServer\(\(request/);
  assert.match(bridge, /createDesktopBridgeOffer[\s\S]+await ensureServer\(\)/);
  assert.doesNotMatch(worker, /pathname.*bridge\/v1|resource === ['"]bridge['"]|head === ['"]bridge['"]/i);
  assert.match(worker, /desktopBridgeRelay: false/);
});

test('private tables have fixed domain grants and are absent from the public mutation registry', () => {
  const bridge = read('electron/desktopBridge/server.ts');
  const registry = JSON.parse(read('shared/mutableTables.json'));
  const privateTables = [
    'testimony_interviews', 'testimony_participant_profiles', 'testimony_sessions',
    'testimony_media', 'testimony_transcripts', 'testimony_annotations',
    'teaching_groups', 'teaching_students', 'teaching_grade_entries',
    'study_recordings', 'study_transcripts', 'study_audio_markers',
    'archive_items', 'archive_repositories', 'archive_description_units', 'archive_item_files',
    'archive_text_versions', 'archive_text_segments', 'archive_audit_log',
    'prosop_studies', 'prosop_person_profiles', 'prosop_factoids', 'prosop_network_edges', 'prosop_audit_log',
  ];
  for (const table of privateTables) {
    assert.match(bridge, new RegExp(`['"]${table}['"]`), `${table} is not Bridge-scoped`);
    assert.equal(registry.tables[table], undefined, `${table} must never enter cloud mutation sync`);
  }
  assert.match(bridge, /if \(!DOMAIN_TABLES\[domain\]\.includes\(table\)\) throw new Error\('table_forbidden'\)/);
});

test('Desktop consumes only enumerated SpaceAction kinds', () => {
  const processor = read('electron/serverSync/spaceActionProcessor.ts');
  const actionKinds = [
    'idea.delete', 'idea.saveToNotes', 'author.synthesis.generate', 'authors.matrix.generate',
    'argumentMap.generate', 'deepResearch.generate', 'deepResearch.saveToNotes', 'worldbuilding.continuity',
    'worldbuilding.entityDelete', 'worldbuilding.proseReview',
    'pages.restoreRevision', 'databases.importCSV',
    'hypothesis.saveToNotes', 'writing.generate', 'projects.create', 'projects.update',
    'projects.section.update', 'projects.chapter.import',
    'library.importToSpace', 'academic.recompute', 'pages.automationRun', 'toolkit.desktopRun',
  ];
  for (const kind of actionKinds) assert.match(processor, new RegExp(`['"]${kind.replace('.', '\\.')}`));
  assert.match(processor, /executeRemoteToolkitAction/);
  const toolkitAction = fs.readFileSync(path.join(root, 'electron/serverSync/toolkitAction.ts'), 'utf8');
  assert.match(toolkitAction, /docx-to-text/);
  assert.match(toolkitAction, /ocr-pdf-searchable/);
  assert.match(toolkitAction, /libraryObjectIds/);
  assert.doesNotMatch(toolkitAction, /child_process|execFile|spawn\(/);
  assert.doesNotMatch(processor, /ipcMain|webContents|eval\(|Function\(|payload\.(?:method|sql|ipc)/);
});

test('Bridge revocation stops locally and Desktop does not auto-start it', () => {
  const bridge = read('electron/desktopBridge/server.ts');
  const main = read('electron/main.ts');
  assert.match(bridge, /pairing\.revokedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(main, /stopDesktopBridge/);
  assert.doesNotMatch(main, /createDesktopBridgeOffer\(/);
});

test('an open Deep Research reader converges through the server on both platforms', () => {
  const registry = JSON.parse(read('shared/mutableTables.json'));
  assert.deepEqual(registry.tables.writing_draft_reads.key, ['draft_id']);
  assert.deepEqual(registry.tables.content_translations.key, ['id']);
  assert.deepEqual(registry.tables.decorative_images.require, { entity_kind: 'deep_research' });

  const publisher = read('electron/serverSync/serverSyncService.ts');
  const inbox = read('electron/serverSync/inboxPoller.ts');
  const desktopReader = read('src/views/DeepResearchView.tsx');
  assert.match(publisher, /CHECK_INTERVAL_MS = 2_000/);
  assert.match(publisher, /QUIET_PERIOD_MS = 1_000/);
  assert.match(inbox, /TICK_MS = 2_000/);
  assert.match(inbox, /writing_draft_reads[\s\S]+content_translations[\s\S]+decorative_images/);
  assert.match(desktopReader, /onWritingDraftsChanged[\s\S]+setOpenDraft\(refreshed\)/);
  assert.match(desktopReader, /onContentTranslationsChanged/);

  const mobileRoot = path.resolve(root, '../nodus-mobile');
  const session = fs.readFileSync(path.join(mobileRoot, 'ios/Nodus/State/SpaceSession.swift'), 'utf8');
  const mobileReader = fs.readFileSync(path.join(mobileRoot, 'ios/Nodus/Screens/ResearchLibraryView.swift'), 'utf8');
  const translationStore = fs.readFileSync(path.join(mobileRoot, 'ios/Nodus/State/DeepResearchTranslationStore.swift'), 'utf8');
  assert.match(session, /monitorPublishedContent\(every interval: Duration = \.seconds\(2\)\)/);
  assert.match(mobileReader, /\.task\(id: session\.publishedRevision\) \{ await refreshPublishedCopy\(\) \}/);
  assert.match(mobileReader, /\.task\(id: session\.publishedRevision\) \{ await load\(\) \}/);
  assert.match(translationStore, /replaceFromServer\(rows:/);
});
