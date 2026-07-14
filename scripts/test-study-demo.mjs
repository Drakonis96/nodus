// Study vault phase 14: real SQLite demo seeding and surgical cleanup.
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
if (!process.argv.includes('--electron-study-demo-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-demo.mjs'), '--electron-study-demo-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-demo-'));
installRuntimeHooks(root);
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/studyDemoData.ts'));
  const generalDemo = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const learning = require(path.join(repoRoot, 'electron/db/studyLearningRepo.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const active = vaults.getActiveVault();
  vaults.setVaultType(active.id, 'estudio');
  assert.equal(demo.seedStudyDemoData(), true, 'an empty study vault accepts the sample workspace');
  assert.equal(demo.seedStudyDemoData(), false, 'seeding is idempotent and never overlays existing data');

  const workspace = org.getStudyWorkspace();
  assert.equal(workspace.courses.length, 1);
  assert.equal(workspace.subjects.length, 2);
  assert.equal(workspace.topics.length, 2);
  assert.equal(workspace.documents.length, 2);
  assert.ok(workspace.placements.every((placement) => placement.documentId.startsWith('demo-study-')));
  assert.equal(questions.listStudyQuestions().length, 1);
  assert.equal(learning.listStudyFlashcards().length, 1);
  assert.equal(learning.getStudyPlanner().plans.length, 1);
  assert.equal(learning.getStudyPlanner().blocks.length, 1);
  assert.equal(learning.getStudyProgressDashboard().dueCards, 1);
  assert.equal(settings.getSettings().demoMode, true);
  assert.equal(generalDemo.hasAnyData(), true, 'study content participates in the global presence check');
  assert.deepEqual(getDb().pragma('foreign_key_check'), [], 'sample hierarchy satisfies every foreign key');

  // A user-owned row added after the sample must survive demo cleanup.
  const userCourse = org.createStudyCourse({ name: 'Curso del usuario' });
  generalDemo.clearDemoData();
  const remaining = org.getStudyWorkspace({ includeArchived: true, includeDeleted: true });
  assert.deepEqual(remaining.courses.map((course) => course.id), [userCourse.id]);
  assert.equal(remaining.documents.length, 0);
  assert.equal(questions.listStudyQuestions({ archived: true }).length, 0);
  assert.equal(learning.listStudyFlashcards({ includeArchived: true }).length, 0);
  assert.equal(learning.getStudyPlanner().plans.length, 0);
  assert.equal(settings.getSettings().demoMode, false);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  closeDb();
  console.log('Study demo phase 14 tests passed!');
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
