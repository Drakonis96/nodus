import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-adaptive-final-'));
const paperKeys = ['LORA0001', 'SELF0001', 'LLAMA001'];

function run(provider, model, mode) {
  const automatic = mode === 'automatic';
  const qualityPapers = paperKeys.map((zotero_key, index) => ({
    zotero_key, ideas: 20 + index, evidence: 30 + index, explicit: 28 + index, paraphrased: 2,
  }));
  const citations = { total: 3, valid: 3, invalid: 0 };
  return {
    schema: 'nodus-adaptive-raw-campaign/1', provider, model, mode,
    corpusSelection: { count: 3, keys: paperKeys }, outcome: { status: 'completed', error: null },
    sqliteIntegrity: 'ok', queue: { total: 7, done: 7, failed: 0 },
    documentIndex: { campaigns: [{ status: 'completed', totalJobs: 3, completedJobs: 3, failedJobs: 0 }] },
    qualityAudit: {
      pass: true, works: 3, papers: qualityPapers,
      evidence: { explicitLiteralPrecision: 1 },
      embeddings: {
        idea: { total: 63, valid: 63, invalid: 0 },
        passage: { total: 120, valid: 120, invalid: 0 },
        document: { total: 30, valid: 30, invalid: 0 },
      },
      profiles: { current: 3, audited: 3, minimumQualityScore: 0.8 },
    },
    sourceDatabaseHashes: { protected: { before: { 'nodus.sqlite': 'same' }, after: { 'nodus.sqlite': 'same' } } },
    featureChecks: {
      semantic: { available: true, results: 10 },
      chat: { chars: 100, citations }, nodi: { chars: 100, citations }, writing: { chars: 100, citations },
      immersion: { stations: 3, stoppedReason: null, citations: 4, invalidCitations: 0 },
      deepResearch: Array.from({ length: 3 }, () => ({
        words: 500, worksCited: 3, stoppedReason: null, citations,
        verification: { checked: 12, partial: 1, unsupported: 0, unverified: 0 },
      })),
    },
    workingTreeStateHash: 'candidate', corpusManifestHash: 'corpus', promptBundleHash: 'prompts',
    rootRequestHashes: ['a', 'b', 'c'],
    indexingWindowMs: automatic ? 400 : 1000,
    totalMs: automatic ? 900 : 1200,
    papers: paperKeys.map((key, index) => ({ title: key, totalMs: automatic ? 300 + index : 600 + index })),
  };
}

try {
  const fixtures = [
    run('gemini', 'gemini-2.5-flash-lite', 'manual'),
    run('gemini', 'gemini-2.5-flash-lite', 'automatic'),
    run('deepseek', 'deepseek-v4-flash', 'manual'),
    run('deepseek', 'deepseek-v4-flash', 'automatic'),
  ];
  await Promise.all(fixtures.map((fixture, index) =>
    writeFile(path.join(scratch, `run-${index}.json`), `${JSON.stringify(fixture)}\n`)));
  const reportPath = path.join(scratch, 'report.json');
  let result = spawnSync(process.execPath, [
    'scripts/evaluate-adaptive-concurrency-final.mjs', '--runs', scratch, '--out', reportPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).pass, true);

  fixtures[1].qualityAudit.evidence.explicitLiteralPrecision = 0.99;
  await writeFile(path.join(scratch, 'run-1.json'), `${JSON.stringify(fixtures[1])}\n`);
  result = spawnSync(process.execPath, [
    'scripts/evaluate-adaptive-concurrency-final.mjs', '--runs', scratch, '--out', reportPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1, 'a literal-citation regression must block release');
  assert.ok(JSON.parse(await readFile(reportPath, 'utf8')).failures.some((message) => message.includes('100%')));
  console.log('Final adaptive-concurrency verification tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
