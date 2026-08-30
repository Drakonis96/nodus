import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-adaptive-gates-'));
const paperKeys = ['LORA0001', 'SELF0001', 'LLAMA001', 'SAM00001', 'RWKV0001', 'QLORA001', 'DPO00001', 'ARENA001', 'AGENT001', 'HUGGPT01'];
const requestHashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

function campaign({ mode, pairId, campaignIndex, totalMs, build = 'candidate' }) {
  return {
    schema: 'nodus-adaptive-campaign/1',
    id: `${mode}-${campaignIndex}`,
    pairId,
    build,
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    routingMode: 'direct',
    mode,
    campaignIndex,
    cold: campaignIndex === 1,
    totalMs,
    papers: paperKeys.map((key) => ({
      key,
      totalMs: totalMs / 10,
      ideaRecall: 0.92,
      evidencePrecision: 1,
      citationPrecision: 1,
    })),
    plannedChunks: 100,
    completedChunks: 100,
    checkpointedChunks: 0,
    invalidAcceptedJson: 0,
    invalidEmbeddings: 0,
    sqliteIntegrity: 'ok',
    terminalFailures: 0,
    requestHashes,
    backendEffective: ['Google'],
    quality: { ndcg10: 0.94, recall20: 0.96, falseDistinctMerges: 0, equivalentFusionRecall: 0.93 },
    embeddings: { validVectors: 250, expectedVectors: 250, minimumScalarBatchCosine: 1, retrievalMetricRegression: 0 },
    profileHashes: { before: 'untouched', after: 'untouched' },
  };
}

try {
  const fixtures = [campaign({ mode: 'historical', pairId: 'historical', campaignIndex: 1, totalMs: 1200, build: 'historical' })];
  for (let index = 1; index <= 3; index += 1) {
    fixtures.push(campaign({ mode: 'manual', pairId: `pair-${index}`, campaignIndex: index, totalMs: 1000 }));
    fixtures.push(campaign({ mode: 'automatic', pairId: `pair-${index}`, campaignIndex: index, totalMs: 400 }));
  }
  await Promise.all(fixtures.map((fixture, index) => writeFile(path.join(scratch, `run-${index}.json`), `${JSON.stringify(fixture)}\n`)));
  const reportPath = path.join(scratch, 'report.json');
  let result = spawnSync(process.execPath, ['scripts/adaptive-concurrency-audit.mjs', 'evaluate', '--runs', scratch, '--out', reportPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.pass, true);
  assert.equal(Object.values(report.groups)[0].speedup, 2.5);

  const broken = { ...fixtures[2], requestHashes: ['d'.repeat(64)] };
  await writeFile(path.join(scratch, 'run-2.json'), `${JSON.stringify(broken)}\n`);
  result = spawnSync(process.execPath, ['scripts/adaptive-concurrency-audit.mjs', 'evaluate', '--runs', scratch, '--out', reportPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1, 'a changed request set must block certification');
  report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.pass, false);
  assert.ok(report.failures.some((message) => message.includes('conjunto idéntico')));
  const runner = await readFile(path.join(root, 'scripts/run-adaptive-concurrency-campaign.mjs'), 'utf8');
  assert.match(runner, /process\.once\('SIGINT', onSigint\)/, 'campaign cancellation installs graceful cleanup');
  assert.match(runner, /void app\?\.close\(\)\.catch/, 'campaign cancellation closes Electron so local runtimes are released');
  assert.match(runner, /perfil aislado conserva sus checkpoints/, 'interrupted campaigns remain explicitly resumable');
  assert.match(runner, /--paper-count/, 'the billable release campaign can use an explicit reduced corpus');
  const harness = await readFile(path.join(root, 'scripts/adaptive-concurrency-audit.mjs'), 'utf8');
  assert.match(harness, /selectedPapers = corpus\.papers\.slice\(0, paperCount\)/, 'the fake Zotero corpus is reduced deterministically');
  console.log('Adaptive-concurrency gate evaluator tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
