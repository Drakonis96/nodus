import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-summary-resilience-'));
const virtual = new Map([
  ['./aiClient', `
    export class AiError extends Error {
      constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; }
    }
    globalThis.__SummaryAiError = AiError;
    export const completeText = (...args) => globalThis.__summaryComplete(...args);
    export const embed = (...args) => globalThis.__summaryEmbed(...args);
  `],
  ['./prompts', `export const coreStructuredPrompt = () => 'summary-system';`],
  ['../db/database', `export const getDb = () => globalThis.__summaryDb;`],
  ['../db/settingsRepo', `export const getSettings = () => ({
    summaryModel: { provider: 'test', model: 'summary-model' }, synthesisModel: null,
    zoteroUserId: '0', zoteroStoragePath: '', unpaywallEmail: '', preferZoteroFulltext: true,
    ocrEnabled: false, ocrLanguages: ['eng'], ocrMaxPages: 1,
  });`],
  ['../db/worksRepo', `export const setSummaryResult = (...args) => globalThis.__summaryEvents.results.push(args);`],
  ['../zotero/zoteroClient', `export const getItem = async () => ({ abstract: 'A source abstract.' });`],
  ['../extraction/textExtractor', `export const resolveWorkText = async () => { throw new Error('text fallback should not run'); };`],
  ['../db/workSummariesRepo', `
    export const upsertWorkSummary = (input) => globalThis.__summaryEvents.upserts.push(input);
    export const updateWorkSummaryEmbedding = (...args) => globalThis.__summaryEvents.embeddings.push(args);
  `],
  ['../library/libraryVaultProvenance', `
    export const recordLinkedLibraryAnalysis = (input) => {
      globalThis.__summaryEvents.provenance.push(input);
      if (globalThis.__summaryProvenanceFails) throw new Error('provenance unavailable');
    };
  `],
  ['@shared/localAiModels', `export const modelRefSupportsCapability = () => true;`],
  ['../perf', `export const startPerf = () => (result) => globalThis.__summaryEvents.perf.push(result);`],
]);

try {
  const output = path.join(scratch, 'summary-scan.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/summaryScan.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'summary-dependencies',
      setup(builder) {
        for (const specifier of virtual.keys()) {
          const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          builder.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({ path: specifier, namespace: 'summary-stub' }));
        }
        builder.onLoad({ filter: /.*/, namespace: 'summary-stub' }, ({ path: specifier }) => ({
          contents: virtual.get(specifier),
          loader: 'js',
        }));
      },
    }],
  });
  const scan = await import(pathToFileURL(output).href);
  const work = {
    nodus_id: 'work-1', title: 'A work', authors_json: '[]', year: 2026, item_type: 'article',
    zotero_key: 'Z1', doi: null, deep_hash: 'deep-hash', light_hash: 'light-hash',
    deep_status: 'done', summary_status: 'pending', summary_hash: null,
  };
  const freshEvents = () => ({ results: [], upserts: [], embeddings: [], provenance: [], perf: [], transactions: 0 });
  globalThis.__summaryDb = {
    prepare: () => ({ all: () => [] }),
    transaction: (operation) => () => {
      globalThis.__summaryEvents.transactions += 1;
      return operation();
    },
  };

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => 'A committed orientation summary.';
    globalThis.__summaryEmbed = async () => { throw new Error('embedding runtime unavailable'); };
    globalThis.__summaryProvenanceFails = true;
    await scan.runSummaryScan(work);
    assert.equal(globalThis.__summaryEvents.results.length, 1);
    assert.equal(globalThis.__summaryEvents.results[0][1], 'done');
    assert.match(globalThis.__summaryEvents.results[0][2], /^[a-f0-9]{40}$/);
    assert.equal(globalThis.__summaryEvents.results.some((entry) => entry[1] === 'failed'), false,
      'an optional embedding/provenance failure cannot revoke a committed summary');
    assert.equal(globalThis.__summaryEvents.upserts.length, 1);
    assert.equal(globalThis.__summaryEvents.embeddings.length, 0);
    assert.equal(globalThis.__summaryEvents.transactions, 1, 'summary text and status publish atomically');
    assert.deepEqual(globalThis.__summaryEvents.perf.at(-1), { status: 'ok', embedding: 'deferred' });

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new Error('generation exploded'); };
    globalThis.__summaryEmbed = async () => [1, 0];
    globalThis.__summaryProvenanceFails = false;
    await assert.rejects(scan.runSummaryScan(work), /generation exploded/);
    assert.equal(globalThis.__summaryEvents.upserts.length, 0);
    assert.equal(globalThis.__summaryEvents.results[0][1], 'failed');
    assert.match(globalThis.__summaryEvents.results[0][2], /^[a-f0-9]{40}$/);
    assert.equal(globalThis.__summaryEvents.results[0][3], 'generation exploded',
      'the actual generation error is persisted for the status modal');

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new globalThis.__SummaryAiError('configuration missing', false, true); };
    await assert.rejects(scan.runSummaryScan(work), /configuration missing/);
    assert.equal(globalThis.__summaryEvents.results.length, 0,
      'a configuration pause remains pending so the queue can resume after settings are fixed');
  } finally {
    console.warn = originalWarn;
  }

  console.log('Summary scan resilience tests passed!');
} finally {
  delete globalThis.__summaryComplete;
  delete globalThis.__summaryEmbed;
  delete globalThis.__summaryDb;
  delete globalThis.__summaryEvents;
  delete globalThis.__summaryProvenanceFails;
  delete globalThis.__SummaryAiError;
  await rm(scratch, { recursive: true, force: true });
}
