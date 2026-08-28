// Durable database Deep Research repository contract. Runs under Electron-as-Node so
// better-sqlite3 uses the same ABI as the application.
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
const marker = '--electron-database-deep-research-repo-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-research-repo-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const research = require(path.join(repoRoot, 'electron/db/databaseDeepResearchRepo.ts'));
  const db = new Database(path.join(root, 'research.sqlite'));
  runMigrations(db); globalThis.__databaseDeepResearchRepoDb = db;
  const source = databases.createDatabase('Research source');

  const input = (title = 'Run') => ({ databaseId: source.id, objective: 'Check durable state', title, options: { budget: { maxRows: 10 } } });
  const report = (runId, finalStatus = 'completed', markdown = '# Report') => ({
    id: `report-${runId}`, runId, title: 'Report', markdown, summary: 'Summary', bibliography: [],
    metadata: {}, structured: { sections: [] }, quality: { score: 1 }, provenance: { source: 'test' }, finalStatus,
  });

  const run = research.createDatabaseResearchRun(input());
  assert.equal(run.status, 'queued');
  assert.equal(research.startDatabaseResearchRun(run.id).status, 'running');
  const running = research.getDatabaseResearchRun(run.id);
  assert.equal(research.startDatabaseResearchRun(run.id).status, 'running', 'running start is idempotent');
  assert.equal(research.getDatabaseResearchRun(run.id).revision, running.revision, 'idempotent start does not bump revision');
  const casRevision = research.getDatabaseResearchRun(run.id).revision;
  research.updateDatabaseResearchRun(run.id, { expectedRevision: casRevision, progressDetails: { source: 'test' } });
  assert.throws(() => research.updateDatabaseResearchRun(run.id, { expectedRevision: casRevision, progressDetails: { source: 'stale' } }), /Conflicto/);
  assert.equal(research.markDatabaseResearchRunStale(run.id, 'worker timeout'), true);
  assert.equal(research.getDatabaseResearchRun(run.id).status, 'stale');
  assert.equal(research.startDatabaseResearchRun(run.id).status, 'running');

  const queuedCancel = research.createDatabaseResearchRun(input('Queued cancel'));
  assert.equal(research.cancelDatabaseResearchRun(queuedCancel.id), true);
  assert.equal(research.getDatabaseResearchRun(queuedCancel.id).status, 'cancelled');
  assert.equal(research.cancelDatabaseResearchRun(queuedCancel.id), false);

  const cooperative = research.createDatabaseResearchRun(input('Cooperative cancel'));
  research.startDatabaseResearchRun(cooperative.id);
  assert.equal(research.cancelDatabaseResearchRun(cooperative.id), true);
  assert.equal(research.getDatabaseResearchRun(cooperative.id).status, 'cancelling');
  assert.equal(research.updateDatabaseResearchProgress(cooperative.id, { status: 'running', progress: 0.4 }).status, 'cancelling');
  assert.equal(research.finalizeDatabaseResearchCancellation(cooperative.id), true);
  assert.equal(research.getDatabaseResearchRun(cooperative.id).status, 'cancelled');

  const failed = research.createDatabaseResearchRun(input('Failed'));
  research.startDatabaseResearchRun(failed.id); research.failDatabaseResearchRun(failed.id, 'failed');
  assert.throws(() => research.startDatabaseResearchRun(failed.id), /No se puede iniciar/);

  const partial = research.createDatabaseResearchRun(input('Partial'));
  research.startDatabaseResearchRun(partial.id);
  research.saveDatabaseResearchReport(report(partial.id, 'partial'));
  assert.equal(research.getDatabaseResearchRun(partial.id).status, 'partial');
  assert.equal(research.getDatabaseResearchRun(partial.id).progress, 1);
  assert.throws(() => research.saveDatabaseResearchReport(report(partial.id, 'partial', 'x'.repeat(2_000_001))), /límite/);
  const completed = research.createDatabaseResearchRun(input('Completed'));
  research.startDatabaseResearchRun(completed.id); research.saveDatabaseResearchReport(report(completed.id));
  assert.throws(() => research.saveDatabaseResearchReport(report(completed.id, 'partial')), /degradar/);
  assert.equal(research.getDatabaseResearchRun(completed.id).status, 'completed');

  const bounded = research.createDatabaseResearchRun(input('Payload bounds'));
  assert.throws(() => research.upsertDatabaseResearchStep({ runId: bounded.id, kind: 'snapshot', ordinal: 0, output: { huge: 'x'.repeat(1_000_001) } }), /límite/);
  assert.throws(() => research.saveDatabaseResearchClaim({ id: 'claim-bounds', runId: bounded.id, text: 'claim', status: 'exploratory', confidence: 0.5, sourceRowIds: [], evidence: { huge: 'x'.repeat(1_000_001) }, artifactRefs: [], ordinal: 0 }), /límite/);
  assert.throws(() => research.updateDatabaseResearchProgress(bounded.id, { status: 'completed', progress: 1 }), /Transición/);

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  db.close();
  console.log('database Deep Research repository FSM, cancellation and payload bounds passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseDeepResearchRepoDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved;
  };
  Module._load = function load(request, parent) {
    if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot } };
    return originalLoad.call(this, request, parent);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
  };
}
