// The Documentary Index rail must show a per-work job.
//
// A job created by a per-work scan (`enqueueDocumentProfile`) or by Deep Research
// preparation (`ensureProfiles`) carries no campaign. The rail kept only the jobs of
// live campaigns, so those standalone jobs had no row: pressing retry enqueued real
// work the reader could not see, and a failure left nothing to retry from. This pins
// the selection and the row action that fixes it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-document-rail-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { summarizeDocumentIndexRail, compareDocumentIndexJobsForDisplay } = load('shared/documentIndexProgress.ts');

const stamp = '2026-09-14T10:00:00.000Z';
const job = (overrides) => ({
  jobId: 'job', campaignId: null, vaultId: 'vault', nodusId: 'work', title: 'Work',
  priority: 0, reason: 'manual', status: 'queued', phase: 'queued', progress: 0,
  progressMessage: null, currentUnit: null, totalUnits: null, sourceFingerprint: null,
  generatorModel: null, auditorModel: null, attempts: 0, maxAttempts: 5, error: null,
  createdAt: stamp, updatedAt: stamp, ...overrides,
});
const campaign = (overrides) => ({
  campaignId: 'campaign', vaultId: 'vault', mode: 'manual', status: 'running', includeArchived: false,
  totalJobs: 10, completedJobs: 4, failedJobs: 1, runningJobs: 1, queuedJobs: 5, pausedJobs: 0,
  estimatedUnits: 10, completedUnits: 5, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null,
  error: null, createdAt: stamp, updatedAt: stamp, ...overrides,
});
const progress = (jobs, campaigns = []) => ({ campaigns, jobs, active: 0, queued: 0, failed: 0 });

test('nothing to show when there are no campaigns and no standalone jobs', () => {
  assert.equal(summarizeDocumentIndexRail(null).visible, false);
  assert.equal(summarizeDocumentIndexRail(progress([])).visible, false);
});

test('a standalone queued job is visible and is the current row', () => {
  const summary = summarizeDocumentIndexRail(progress([job({ jobId: 'solo', status: 'queued' })]));
  assert.equal(summary.visible, true, 'a per-work scan must have a row');
  assert.deepEqual(summary.jobs.map((entry) => entry.jobId), ['solo']);
  assert.equal(summary.current?.jobId, 'solo');
  assert.equal(summary.total, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.estimatedUnits, 1);
  assert.equal(summary.completedUnits, 0, 'a queued job has made no progress');
});

test('a failed standalone job is visible, retryable and carries its error', () => {
  const summary = summarizeDocumentIndexRail(progress([
    job({ jobId: 'solo', status: 'failed', phase: 'done', progress: 0.6, error: 'Connection error.' }),
  ]));
  assert.equal(summary.visible, true, 'the retry needs a row to live on');
  assert.equal(summary.failed, 1);
  assert.equal(summary.error, 'Connection error.');
  assert.equal(summary.completedUnits, 1, 'a settled attempt counts as a completed unit');
});

test('a finished standalone job leaves the rail', () => {
  const summary = summarizeDocumentIndexRail(progress([job({ jobId: 'solo', status: 'completed', phase: 'done', progress: 1 })]));
  assert.equal(summary.visible, false);
});

test('only jobs of live campaigns are listed', () => {
  const live = campaign({ campaignId: 'live', status: 'running' });
  const finished = campaign({ campaignId: 'done', status: 'completed' });
  const summary = summarizeDocumentIndexRail(progress([
    job({ jobId: 'a', campaignId: 'live', status: 'running' }),
    job({ jobId: 'b', campaignId: 'done', status: 'queued' }),
  ], [live, finished]));
  assert.deepEqual(summary.jobs.map((entry) => entry.jobId), ['a']);
  assert.equal(summary.allPaused, false);
});

test('a paused campaign is live, and its jobs still show', () => {
  const paused = campaign({ status: 'paused' });
  const summary = summarizeDocumentIndexRail(progress([job({ jobId: 'a', campaignId: 'campaign', status: 'paused' })], [paused]));
  assert.equal(summary.visible, true);
  assert.equal(summary.allPaused, true);
  assert.deepEqual(summary.jobs.map((entry) => entry.jobId), ['a']);
});

test('standalone totals add to the campaign totals', () => {
  const summary = summarizeDocumentIndexRail(progress([
    job({ jobId: 'a', campaignId: 'campaign', status: 'running' }),
    job({ jobId: 'solo', status: 'failed', phase: 'done', progress: 0.5, error: 'boom' }),
  ], [campaign()]));
  assert.equal(summary.total, 11, '10 campaign jobs + 1 standalone');
  assert.equal(summary.completed, 4);
  assert.equal(summary.failed, 2, '1 campaign failure + 1 standalone failure');
  assert.equal(summary.estimatedUnits, 11);
  assert.equal(summary.completedUnits, 6);
});

test('the rail sorts live rows before terminal ones', () => {
  const summary = summarizeDocumentIndexRail(progress([
    job({ jobId: 'failed', status: 'failed', phase: 'done' }),
    job({ jobId: 'running', status: 'running', phase: 'analyzing_sections' }),
    job({ jobId: 'queued', status: 'queued' }),
  ]));
  const ordered = [...summary.jobs].sort(compareDocumentIndexJobsForDisplay).map((entry) => entry.jobId);
  assert.deepEqual(ordered, ['running', 'queued', 'failed']);
  assert.equal(summary.current?.jobId, 'running');
});

test('the rail renders standalone rows with a retry action wired to the enqueue endpoint', () => {
  const source = readFileSync(path.join(repoRoot, 'src/components/DocumentIndexProgressBar.tsx'), 'utf8');
  assert.match(source, /summarizeDocumentIndexRail/, 'the rail must use the shared selection');
  assert.match(source, /!job\.campaignId &&/, 'standalone rows are the ones that carry their own actions');
  assert.match(source, /data-testid=\{`document-index-rail-retry-\$\{job\.jobId\}`\}/);
  assert.match(source, /window\.nodus\.enqueueDocumentProfile\(nodusId\)/);
  assert.match(source, /onClick=\{\(\) => void retryJob\(job\.nodusId\)\}/);
  assert.match(source, /data-testid=\{`document-index-rail-cancel-\$\{job\.jobId\}`\}/);
  // The campaign bulk controls must not appear when only standalone jobs are live.
  assert.match(source, /\{liveCampaigns\.length > 0 && <>/);
});
