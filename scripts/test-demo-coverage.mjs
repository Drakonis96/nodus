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
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const studyChat = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  const count = (table, where = '1=1') => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n);

  assert.equal(academic.seedDemoData(), true);
  for (const [label, table, where] of [
    ['library', 'works', "nodus_id LIKE 'demo-%'"], ['ideas', 'ideas', "global_id LIKE 'demo-%'"],
    ['graph/debate', 'edges', "id LIKE 'demo-%'"], ['gaps/hypotheses', 'gaps', "id LIKE 'demo-%'"],
    ['authors', 'authors', "author_id LIKE 'demo-%'"], ['notes', 'notes', "id LIKE 'demo-%'"],
    ['research coverage', 'research_questions', "id LIKE 'demo-%'"], ['writing/deep research', 'writing_saved_drafts', "id LIKE 'demo-%'"],
    ['immersion', 'immersion_sessions', "id LIKE 'demo-%'"], ['projects', 'projects', "id LIKE 'demo-%'"],
  ]) assert.ok(count(table, where) > 0, `academic ${label} is populated`);
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
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
