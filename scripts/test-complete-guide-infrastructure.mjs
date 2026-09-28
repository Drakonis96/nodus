// Complete study guide, milestone 2: local run/cache/artifact persistence (migration
// 194 executed on node:sqlite), the job-scoped output language and the usage meter.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

const stubDatabase = {
  name: 'stub-database',
  setup(build) {
    build.onResolve({ filter: /^\.\/database$/ }, () => ({ path: 'database', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function getDb() { throw new Error("no default db in tests"); }', loader: 'js' }));
  },
};
async function load(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [stubDatabase], tsconfig: 'electron/tsconfig.json' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const repo = await load('electron/db/completeGuideRepo.ts');
const { withJobOutputLanguage, jobOutputLanguage } = await load('electron/ai/jobOutputLanguage.ts');
const meter = await load('electron/ai/usageMeter.ts');

function migratedDb() {
  const source = fs.readFileSync('electron/db/migrations.ts', 'utf8');
  const block = source.match(/\{ version: 194, up: \/\* sql \*\/ `([\s\S]*?)` \}/);
  assert.ok(block, 'migration 194 exists');
  const db = new DatabaseSync(':memory:');
  db.exec(block[1]);
  return db;
}

test('migration 194 tables are local-only (never synced) and the schema version advanced', () => {
  const sync = fs.readFileSync('electron/db/syncTables.ts', 'utf8');
  for (const table of ['complete_guide_runs', 'complete_guide_units', 'complete_guide_chunk_cache', 'complete_guide_artifacts']) {
    assert.match(sync, new RegExp(`'${table}'`), `${table} is classified as not synced`);
  }
  assert.match(fs.readFileSync('electron/db/migrations.ts', 'utf8'), /export const SCHEMA_VERSION = 194;/);
});

test('a run freezes its first snapshot; checkpoints resume by unit and are deleted with the run', () => {
  const db = migratedDb();
  repo.createCompleteGuideRun('run-1', { objective: 'x' }, { passages: ['A1.1'] }, db);
  repo.createCompleteGuideRun('run-1', { objective: 'changed' }, { passages: ['A1.1', 'A1.2'] }, db);
  const run = repo.getCompleteGuideRun('run-1', db);
  assert.deepEqual(run.snapshot, { passages: ['A1.1'] }, 'a re-queued job never re-snapshots edited sources');
  assert.equal(run.stage, 'snapshot');
  repo.setCompleteGuideRunStage('run-1', 'extract', db);
  assert.equal(repo.getCompleteGuideRun('run-1', db).stage, 'extract');
  repo.putCompleteGuideUnit('run-1', 'extract', 'w002', { items: 2 }, db);
  repo.putCompleteGuideUnit('run-1', 'extract', 'w001', { items: 1 }, db);
  repo.putCompleteGuideUnit('run-1', 'extract', 'w001', { items: 3 }, db);
  assert.deepEqual(repo.getCompleteGuideUnit('run-1', 'extract', 'w001', db), { items: 3 });
  assert.equal(repo.getCompleteGuideUnit('run-1', 'recon', 'w001', db), null);
  assert.deepEqual(repo.listCompleteGuideUnits('run-1', 'extract', db).map((unit) => unit.unitKey), ['w001', 'w002']);
  repo.deleteCompleteGuideRun('run-1', db);
  assert.equal(repo.getCompleteGuideRun('run-1', db), null);
  assert.deepEqual(repo.listCompleteGuideUnits('run-1', 'extract', db), []);
});

test('stale runs are pruned; the reading cache is shared across runs and LRU-bounded', () => {
  const db = migratedDb();
  repo.createCompleteGuideRun('old', {}, {}, db);
  db.prepare("UPDATE complete_guide_runs SET updated_at = '2000-01-01T00:00:00.000Z' WHERE run_id = 'old'").run();
  repo.createCompleteGuideRun('fresh', {}, {}, db);
  assert.equal(repo.pruneStaleCompleteGuideRuns(14, db), 1);
  assert.ok(repo.getCompleteGuideRun('fresh', db));
  for (let index = 0; index < 5; index += 1) repo.putCompleteGuideCache(`k${index}`, 'extract', { text: 'x'.repeat(100) }, db);
  db.prepare("UPDATE complete_guide_chunk_cache SET last_used_at = '2000-01-01T00:00:00.000Z' WHERE cache_key IN ('k0', 'k1')").run();
  assert.deepEqual([...repo.hasCompleteGuideCache(['k0', 'k4', 'missing'], db)].sort(), ['k0', 'k4']);
  const oneRow = Buffer.byteLength(JSON.stringify({ text: 'x'.repeat(100) }));
  assert.equal(repo.pruneCompleteGuideCache(oneRow * 3, db), 2);
  assert.equal(repo.getCompleteGuideCache('k0', db), null, 'least recently used first');
  assert.deepEqual(repo.getCompleteGuideCache('k4', db), { text: 'x'.repeat(100) });
});

test('evidence sidecar round-trips and is removed with its draft', () => {
  const db = migratedDb();
  repo.saveCompleteGuideArtifacts('draft-1', 'run-1', { items: [{ id: 'K0001' }] }, db);
  assert.deepEqual(repo.getCompleteGuideArtifacts('draft-1', db), { items: [{ id: 'K0001' }] });
  repo.deleteCompleteGuideArtifacts('draft-1', db);
  assert.equal(repo.getCompleteGuideArtifacts('draft-1', db), null);
  assert.match(fs.readFileSync('electron/db/writingDraftsRepo.ts', 'utf8'), /deleteCompleteGuideArtifacts\(id\)/);
});

test('the job output language scopes concurrent jobs independently and ignores invalid values', async () => {
  assert.equal(jobOutputLanguage(), undefined);
  const seen = await Promise.all([
    withJobOutputLanguage('vi', async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return jobOutputLanguage(); }),
    withJobOutputLanguage('en', async () => jobOutputLanguage()),
    withJobOutputLanguage('klingon', async () => jobOutputLanguage()),
  ]);
  assert.deepEqual(seen, ['vi', 'en', undefined]);
  const client = fs.readFileSync('electron/ai/aiClient.ts', 'utf8');
  assert.match(client, /jobOutputLanguage\(\) \?\? getSettings\(\)\.promptLanguage/, 'the job language wins over the vault setting');
  assert.match(fs.readFileSync('electron/ai/deepResearch.ts', 'utf8'), /withJobOutputLanguage\(request\.language/);
});

test('usage meters nest, count provider reports and estimates, and stay isolated', async () => {
  const job = meter.createUsageMeter();
  const call = meter.createUsageMeter();
  const other = meter.createUsageMeter();
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  await meter.withUsageMeter(job, async () => {
    await meter.withUsageMeter(call, async () => { meter.recordProviderUsage(model, 1_000, 200); });
    meter.recordEstimatedUsage(500, 50.4);
  });
  await meter.withUsageMeter(other, async () => meter.recordProviderUsage(model, 7, 7));
  meter.recordProviderUsage(model, 99, 99); // outside any scope: ignored
  assert.deepEqual({ calls: call.calls, reported: call.reported, input: call.inputTokens, output: call.outputTokens }, { calls: 1, reported: 1, input: 1_000, output: 200 });
  assert.deepEqual({ calls: job.calls, reported: job.reported, input: job.inputTokens, output: job.outputTokens }, { calls: 2, reported: 1, input: 1_500, output: 250 });
  assert.equal(other.inputTokens, 7);
  assert.deepEqual(job.model, model);
});
