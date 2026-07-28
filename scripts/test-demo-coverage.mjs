// Cross-vault demo contract: every developed vault type must populate every
// persistent surface it exposes, and cleanup must leave no demo residue.
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
if (!process.argv.includes('--electron-demo-coverage-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-demo-coverage.mjs'), '--electron-demo-coverage-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-demo-coverage-'));
installRuntimeHooks(root);
try {
  const academic = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const genealogy = require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesDemoData.ts'));
  const study = require(path.join(repoRoot, 'electron/db/studyDemoData.ts'));
  const teaching = require(path.join(repoRoot, 'electron/db/teachingDemoData.ts'));
  const worldbuilding = require(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'));
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const studyChat = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const places = require(path.join(repoRoot, 'electron/db/worldPlacesRepo.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/worldGroupsRepo.ts'));
  const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
  const maps = require(path.join(repoRoot, 'electron/db/worldMapsRepo.ts'));
  const mapMarkers = require(path.join(repoRoot, 'electron/db/mapMarkersRepo.ts'));
  const calendar = require(path.join(repoRoot, 'electron/db/worldCalendarRepo.ts'));
  const encyclopedia = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
  const threads = require(path.join(repoRoot, 'electron/db/worldThreadsRepo.ts'));
  const rules = require(path.join(repoRoot, 'electron/db/worldRulesRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
  const manuscript = require(path.join(repoRoot, 'electron/db/worldManuscriptRepo.ts'));
  const presence = require(path.join(repoRoot, 'electron/db/worldPresenceRepo.ts'));
  const continuity = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  const count = (table, where = '1=1') => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n);
  const demoAssetDir = path.join(repoRoot, 'electron/assets/worldbuilding-demo');
  const demoAssetFiles = fs.readdirSync(demoAssetDir).filter((file) => file.endsWith('.webp'));
  const demoAssetBytes = demoAssetFiles.reduce((total, file) => total + fs.statSync(path.join(demoAssetDir, file)).size, 0);
  assert.equal(demoAssetFiles.length, 42, 'worldbuilding ships every generated demo illustration');
  assert.ok(demoAssetBytes < 1.25 * 1024 * 1024, 'the complete worldbuilding artwork bundle stays compact');
  for (const file of demoAssetFiles) {
    const header = fs.readFileSync(path.join(demoAssetDir, file)).subarray(0, 12);
    assert.equal(header.subarray(0, 4).toString(), 'RIFF', `${file} is a RIFF WebP`);
    assert.equal(header.subarray(8, 12).toString(), 'WEBP', `${file} is a RIFF WebP`);
  }

  assert.equal(academic.seedDemoData(), true);
  for (const [label, table, where] of [
    ['library', 'works', "nodus_id LIKE 'demo-%'"], ['ideas', 'ideas', "global_id LIKE 'demo-%'"],
    ['graph/debate', 'edges', "id LIKE 'demo-%'"], ['gaps/hypotheses', 'gaps', "id LIKE 'demo-%'"],
    ['authors', 'authors', "author_id LIKE 'demo-%'"], ['notes', 'notes', "id LIKE 'demo-%'"],
    ['research coverage', 'research_questions', "id LIKE 'demo-%'"], ['writing/deep research', 'writing_saved_drafts', "id LIKE 'demo-%'"],
    ['immersion', 'immersion_sessions', "id LIKE 'demo-%'"], ['projects', 'projects', "id LIKE 'demo-%'"],
  ]) assert.ok(count(table, where) > 0, `academic ${label} is populated`);
  assert.equal(count('works', "nodus_id LIKE 'demo-w%'"), 15, 'academic demo has a substantial source corpus');
  assert.equal(count('ideas', "global_id LIKE 'demo-i%'"), 27, 'academic demo has a substantial idea graph');
  assert.equal(count('themes', "theme_id LIKE 'demo-t%'"), 12, 'academic overview has a substantial theme constellation');
  academic.clearDemoData();

  assert.equal(genealogy.seedGenealogyDemoData(), true);
  for (const [label, table, where] of [
    ['persons', 'persons', "person_id LIKE 'demo-%'"], ['timeline', 'events', "event_id LIKE 'demo-%'"],
    ['archive', 'archive_items', "item_id LIKE 'demo-%'"], ['map', 'person_places', "id LIKE 'demo-%'"],
    ['relations', 'relationships', "rel_id LIKE 'demo-%'"], ['library/search', 'works', "nodus_id LIKE 'demo-genealogy-%'"],
    ['notes', 'notes', "id LIKE 'demo-genealogy-%'"], ['deep research', 'writing_saved_drafts', "id LIKE 'demo-genealogy-%'"],
  ]) assert.ok(count(table, where) > 0, `genealogy ${label} is populated`);
  genealogy.clearGenealogyDemoData();

  assert.equal(databases.seedDatabasesDemoData(), true);
  for (const [label, table, where] of [
    ['tables', 'db_databases', "id LIKE 'demo-%'"], ['rows/search/analysis', 'db_rows', "id LIKE 'demo-%'"],
    ['relations', 'db_relations', "id LIKE 'demo-%'"], ['notes', 'notes', "id LIKE 'demo-db-%'"],
    ['chat', 'database_chat_conversations', "id LIKE 'demo-%'"],
  ]) assert.ok(count(table, where) > 0, `databases ${label} is populated`);
  databases.clearDatabasesDemoData();

  vaults.setVaultType(vaults.getActiveVault().id, 'estudio');
  assert.equal(study.seedStudyDemoData(), true);
  for (const [label, table, where] of [
    ['courses/folders', 'study_courses', "id LIKE 'demo-study-%'"], ['notes', 'study_docs', "id LIKE 'demo-study-%'"],
    ['document history', 'study_doc_versions', "id LIKE 'demo-study-%'"], ['materials', 'study_materials', "id LIKE 'demo-study-%'"],
    ['recordings', 'study_recordings', "id LIKE 'demo-study-%'"], ['transcripts', 'study_transcripts', "id LIKE 'demo-study-%'"],
    ['ideas/graph', 'study_ideas', "id LIKE 'demo-study-%'"], ['question bank', 'study_questions', "id LIKE 'demo-study-%'"],
    ['tests', 'study_assessments', "id LIKE 'demo-study-%'"], ['attempt history', 'study_attempts', "id LIKE 'demo-study-%'"],
    ['flashcards', 'study_flashcards', "id LIKE 'demo-study-%'"], ['review history', 'study_reviews', "id LIKE 'demo-study-%'"],
    ['planner/calendar', 'study_plans', "id LIKE 'demo-study-%'"], ['schedule', 'study_schedule_periods', "id LIKE 'demo-study-%'"],
    ['study sessions', 'study_study_sessions', "id LIKE 'demo-study-%'"],
  ]) assert.ok(count(table, where) > 0, `study ${label} is populated`);
  assert.ok(studyChat.listStudyAssistantConversations().some((item) => item.id === 'demo-study-chat-membrane'), 'study chat is populated');
  study.clearStudyDemoData();
  assert.equal(count('study_courses', "id LIKE 'demo-study-%'"), 0);
  assert.equal(studyChat.listStudyAssistantConversations(true).filter((item) => item.id.startsWith('demo-study-')).length, 0);

  vaults.setVaultType(vaults.getActiveVault().id, 'docencia');
  assert.equal(teaching.seedTeachingDemoData(), true);
  for (const [label, table, where] of [
    ['courses/subjects', 'study_courses', "id LIKE 'demo-teaching-%'"], ['notes', 'study_docs', "id LIKE 'demo-teaching-%'"],
    ['materials', 'study_materials', "id LIKE 'demo-teaching-%'"], ['recordings', 'study_recordings', "id LIKE 'demo-teaching-%'"],
    ['transcripts', 'study_transcripts', "id LIKE 'demo-teaching-%'"], ['question bank', 'study_questions', "id LIKE 'demo-teaching-%'"],
    ['schedule', 'study_schedule_periods', "id LIKE 'demo-teaching-%'"], ['calendar', 'study_calendar_events', "id LIKE 'demo-teaching-%'"],
    ['groups', 'teaching_groups', "id LIKE 'demo-teaching-%'"], ['students', 'teaching_students', "id LIKE 'demo-teaching-%'"],
    ['rubrics', 'teaching_rubrics', "id LIKE 'demo-teaching-%'"], ['exams', 'teaching_exams', "id LIKE 'demo-teaching-%'"],
    ['exam questions', 'teaching_exam_questions', "id LIKE 'demo-teaching-%'"],
    ['gradebook plan', 'teaching_assessment_plans', "id LIKE 'demo-teaching-%'"],
    ['gradebook tree', 'teaching_assessment_items', "id LIKE 'demo-teaching-%'"],
    ['grades', 'teaching_grade_entries', "id LIKE 'demo-teaching-%'"],
    ['rubric marks', 'teaching_rubric_evaluations', "id LIKE 'demo-teaching-%'"],
  ]) assert.ok(count(table, where) > 0, `teaching ${label} is populated`);
  teaching.clearTeachingDemoData();
  assert.equal(count('study_courses', "id LIKE 'demo-teaching-%'"), 0);
  assert.equal(count('teaching_groups', "id LIKE 'demo-teaching-%'"), 0);

  vaults.setVaultType(vaults.getActiveVault().id, 'worldbuilding');
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), true);
  for (const [label, table, where] of [
    ['characters', 'persons', "person_id LIKE 'demo-world-%'"],
    ['character profiles', 'character_profiles', "person_id LIKE 'demo-world-%'"],
    ['primary portraits', 'person_portraits', "person_id LIKE 'demo-world-%'"],
    ['gallery images', 'world_images', "image_id LIKE 'demo-world-%'"],
    ['places', 'places', "place_id LIKE 'demo-world-%'"],
    ['place profiles', 'place_profiles', "place_id LIKE 'demo-world-%'"],
    ['factions and cultures', 'world_groups', "group_id LIKE 'demo-world-%'"],
    ['affiliations', 'character_affiliations', "affiliation_id LIKE 'demo-world-%'"],
    ['relationships and dynasty', 'relationships', "rel_id LIKE 'demo-world-%'"],
    ['social contacts', 'social_contacts', "contact_id LIKE 'demo-world-%'"],
    ['social relations', 'social_relations', "relation_id LIKE 'demo-world-%'"],
    ['timeline', 'events', "event_id LIKE 'demo-world-%'"],
    ['event participants', 'event_participants', "event_id LIKE 'demo-world-%'"],
    ['event evidence', 'record_evidence', "id LIKE 'demo-world-%'"],
    ['presence map', 'person_places', "id LIKE 'demo-world-%'"],
    ['calendar eras', 'world_calendar_eras', "era_id LIKE 'demo-world-%'"],
    ['calendar months', 'world_calendar_months', "month_id LIKE 'demo-world-%'"],
    ['secrets', 'world_secrets', "secret_id LIKE 'demo-world-%'"],
    ['secret knowledge', 'secret_knowers', "id LIKE 'demo-world-%'"],
    ['scenes', 'world_scenes', "scene_id LIKE 'demo-world-%'"],
    ['scene cast', 'scene_characters', "id LIKE 'demo-world-%'"],
    ['scene chronology', 'world_scene_days', "scene_id LIKE 'demo-world-%'"],
    ['maps', 'world_maps', "map_id LIKE 'demo-world-%'"],
    ['map canvases', 'map_images', "image_id LIKE 'demo-world-%'"],
    ['map layers', 'map_layers', "layer_id LIKE 'demo-world-%'"],
    ['map markers', 'map_markers', "marker_id LIKE 'demo-world-%'"],
    ['travel modes', 'map_travel_modes', "mode_id LIKE 'demo-world-%'"],
    ['encyclopedia articles', 'world_articles', "article_id LIKE 'demo-world-%'"],
    ['encyclopedia links', 'world_links', "source_id LIKE 'demo-world-%'"],
    ['entry proposals', 'world_entry_proposals', "proposal_id LIKE 'demo-world-%'"],
    ['conflicts and arcs', 'world_threads', "thread_id LIKE 'demo-world-%'"],
    ['thread parties', 'thread_parties', "party_id LIKE 'demo-world-%'"],
    ['beats', 'world_beats', "thread_id LIKE 'demo-world-%'"],
    ['rules', 'world_rules', "rule_id LIKE 'demo-world-%'"],
    ['questions', 'world_questions', "question_id LIKE 'demo-world-%'"],
    ['question options', 'world_question_options', "option_id LIKE 'demo-world-%'"],
    ['continuity mute workflow', 'world_notice_mutes', "reason LIKE 'demo-world-%'"],
    ['manuscript prose', 'world_scene_text', "scene_id LIKE 'demo-world-%'"],
    ['chapters', 'world_chapter_breaks', "scene_id LIKE 'demo-world-%'"],
    ['books', 'world_manuscript_starts', "scene_id LIKE 'demo-world-%'"],
    ['manuscript snapshots', 'world_scene_snapshots', "snapshot_id LIKE 'demo-world-%'"],
    ['writing diary', 'world_word_days', "day IN ('2000-01-01','2000-01-02','2000-01-03')"],
    ['notes', 'notes', "id LIKE 'demo-world-%'"],
    ['note folders', 'note_folders', "id LIKE 'demo-world-%'"],
  ]) assert.ok(count(table, where) > 0, `worldbuilding ${label} is populated`);
  assert.equal(count('persons', "person_id LIKE 'demo-world-char-%'"), 10, 'worldbuilding demo has a substantial cast');
  assert.equal(count('places', "place_id LIKE 'demo-world-place-%'"), 12, 'worldbuilding demo has a substantial geography');
  assert.equal(count('world_groups', "group_id LIKE 'demo-world-group-%'"), 9, 'worldbuilding demo covers organizations and cultures');
  assert.equal(count('world_scenes', "scene_id LIKE 'demo-world-scene-%'"), 9, 'worldbuilding demo covers the story sequence');
  assert.equal(count('world_maps', "map_id LIKE 'demo-world-map-%'"), 4, 'worldbuilding demo covers map scopes');
  assert.equal(count('world_articles', "article_id LIKE 'demo-world-article-%'"), 14, 'worldbuilding demo has a substantial encyclopedia');
  assert.equal(count('world_threads', "thread_id LIKE 'demo-world-%'"), 7, 'worldbuilding demo covers conflicts and arcs');
  assert.equal(count('world_rules', "rule_id LIKE 'demo-world-rule-%'"), 7, 'worldbuilding demo covers rule states and scopes');
  assert.equal(count('person_portraits', "person_id LIKE 'demo-world-%' AND mime = 'image/webp' AND generated = 1"), 10, 'every demo character has generated WebP cover art');
  assert.equal(count('world_images', "image_id LIKE 'demo-world-%' AND mime_type = 'image/webp' AND generated = 1"), 54, 'every visual world entity has generated WebP gallery art');
  assert.equal(count('map_images', "image_id LIKE 'demo-world-%' AND mime_type = 'image/webp' AND generated = 1"), 6, 'all map image roles use generated WebP artwork');
  const seededArtworkBytes = Number(db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM person_portraits WHERE person_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM world_images WHERE image_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM map_images WHERE image_id LIKE 'demo-world-%')
      AS bytes
  `).get().bytes);
  assert.ok(seededArtworkBytes < 4 * 1024 * 1024, 'the seeded visual corpus remains lightweight');

  // A populated table is not enough: every non-AI reader behind the eighteen
  // Worldbuilding sections must be able to interpret the same connected corpus.
  assert.equal(characters.listCharacters().length, 10);
  assert.equal(characters.characterCounts().total, 10);
  assert.equal(characters.listWorldEvents().length, 8);
  assert.equal(places.listWorldPlaces().length, 12);
  assert.ok(places.inhabitantsOfPlace('demo-world-place-faro').length > 0);
  assert.equal(groups.listWorldGroups().length, 9);
  assert.deepEqual(new Set(groups.listWorldGroups().map((group) => group.kind)), new Set(['faction', 'order', 'house', 'religion', 'culture', 'species', 'language']));
  assert.ok(groups.listAffiliationsForCharacter('demo-world-char-ilyra').length > 0);
  assert.equal(story.listScenes('narrative').length, 9);
  assert.equal(story.listScenes('chronological').length, 9);
  assert.equal(story.listSecrets().length, 3);
  assert.ok(story.listKnowers('demo-world-secret-name').length > 0);
  assert.equal(story.listSceneDayLinks().length, 9);
  assert.equal(maps.listWorldMaps().length, 4);
  assert.equal(maps.childMaps('demo-world-map-world').length, 2);
  assert.ok(maps.getMapThumbnail('demo-world-map-orthea')?.blob.length > 0);
  assert.ok(maps.worldMapCoverage().some((item) => item.markerPlaceIds.length > 0));
  assert.ok(mapMarkers.listMapLayers('demo-world-map-orthea').length >= 4);
  assert.ok(mapMarkers.listMapMarkers('demo-world-map-orthea').length >= 4);
  assert.equal(mapMarkers.listTravelModes().length, 4);
  assert.equal(calendar.getWorldCalendar().eras.length, 2);
  assert.equal(calendar.getWorldCalendar().months.length, 6);
  assert.equal(encyclopedia.listWorldArticles().length, 14);
  assert.ok(encyclopedia.listWorldEntries().length >= 50);
  assert.ok(encyclopedia.worldBacklinks({ kind: 'character', id: 'demo-world-char-ilyra' }).length > 0);
  assert.ok(encyclopedia.worldUnresolvedLinks().some((link) => link.label.includes('Ciudad Sepultada') || link.label.includes('Buried City')));
  assert.ok(encyclopedia.searchWorldBodies('Corazón').length > 0 || encyclopedia.searchWorldBodies('Heart').length > 0);
  assert.equal(threads.listWorldThreads('conflict').length, 4);
  assert.equal(threads.listWorldThreads('arc').length, 3);
  assert.equal(threads.threadBoardData().cast.length, 10);
  assert.ok(threads.listWorldBeats().length >= 20);
  assert.equal(rules.listWorldRules().length, 7);
  assert.ok(rules.rulesInPlay('demo-world-scene-archive').length > 0);
  assert.equal(questions.listWorldQuestions().length, 4);
  assert.ok(questions.questionFeed(true).length >= 4);
  assert.ok(questions.sceneQuestionLoad('demo-world-scene-arrival').count > 0);
  const spine = manuscript.manuscriptSpine();
  assert.equal(spine.books.length, 2);
  assert.equal(spine.totals.scenes, 9);
  assert.ok(spine.totals.words > 0);
  assert.equal(manuscript.listSceneSnapshots('demo-world-scene-archive').length, 1);
  assert.equal(manuscript.listWordDays().length, 3);
  assert.ok(presence.listPresences().length > 20);
  assert.ok(continuity.continuitySummary().facts > 0);
  assert.ok(continuity.runContinuityUnfiltered().length > continuity.runContinuity().length, 'the demo includes a real muted continuity exception');
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false, 'worldbuilding demo cannot be seeded twice');
  academic.clearDemoData();
  assert.equal(count('persons', "person_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_maps', "map_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_articles', "article_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_calendar'), 0);

  // An author may begin with geography or with the calendar. Neither path is "empty",
  // and the offer must never invite a demo that the seeder would then refuse.
  db.prepare(
    "INSERT INTO places (place_id,name,created_at,updated_at) VALUES ('real-place-only','Real place','2026-01-01','2026-01-01')"
  ).run();
  assert.equal(academic.hasAnyData(), true);
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false);
  db.prepare("DELETE FROM places WHERE place_id = 'real-place-only'").run();
  db.prepare(
    "INSERT INTO world_calendar (id,name,created_at,updated_at) VALUES (1,'Real calendar','2026-01-01','2026-01-01')"
  ).run();
  assert.equal(academic.hasAnyData(), true);
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false);
  db.prepare('DELETE FROM world_calendar WHERE id = 1').run();
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  console.log('Cross-vault demo coverage tests passed!');
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
    dialog: {}, shell: {}, BrowserWindow: class {}, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    // `@shared/assessment` is a directory, so a blind `.ts` suffix misses its index.
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return fs.existsSync(direct) ? direct : asIndex;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
