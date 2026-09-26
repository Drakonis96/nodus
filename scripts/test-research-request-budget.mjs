import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-request-budget')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-request-budget-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const { withResearchRequestBudget: bounded, currentResearchRequestBudget: current, researchPromptUpperBound: size } = load('electron/ai/researchRequestBudget.ts');
  assert.equal(size('你好', 'é', 100), 8 + 100 + 1024, 'UTF-8 bounds multilingual text rather than assuming English characters/token');
  let release;
  const pending = bounded(4096, () => {}, async () => { await new Promise(resolve => { release = resolve; }); assert.equal(current().window, 4096); });
  assert.equal(current(), undefined, 'concurrent ordinary work has no inherited report limit');
  await bounded(8192, () => {}, async () => { assert.equal(current().window, 8192); release(); });
  await pending;
  const { ResearchRetrievalBudget } = load('shared/researchRetrievalBudget.ts');
  const budget = new ResearchRetrievalBudget(load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep);
  budget.constrainToWindow(4096, 3500);
  assert.equal(budget.evidenceTokenLimit, 596);
  assert.equal(budget.accept('first', 'a'.repeat(500)), true);
  assert.equal(budget.accept('second', '界'.repeat(40)), false);
  assert.equal(budget.partial, true);
  budget.constrainToWindow(8192, 0);
  assert.equal(budget.evidenceTokenLimit, 596, 'later requests cannot reset or enlarge a run budget');
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No external provider is permitted in this test'); };
  const ai = load('electron/ai/aiClient.ts');
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  assert.deepEqual(await ai.researchModelContextWindow(model), { tokens: 1000000, known: true });
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'custom', model: 'unknown' }), { tokens: 32768, known: false });
  let overflows = 0;
  const opts = { system: 'Instructions'.repeat(100), user: JSON.stringify({ history: ['historic'.repeat(1000)], tools: [], evidence: 'text' }), maxTokens: 2048 };
  for (const complete of [() => ai.completeText(opts, model), () => ai.completeTextStream(opts, () => {}, model), () => ai.completeJson(opts, () => true, model)]) {
    await assert.rejects(() => bounded(4096, () => { overflows++; }, complete), error => error.code === 'context_overflow');
  }
  assert.equal(overflows, 3);
  assert.equal(calls, 0, 'overflow is rejected before credentials, transport or paid dispatch');
  await assert.rejects(() => ai.completeText({ ...opts, corpusContext: true, user: 'x'.repeat(33000) }, { provider: 'custom', model: 'unknown' }), error => error.code === 'context_overflow');
  assert.equal(calls, 0);
  const providers = load('electron/ai/providers.ts');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ id: 'synthetic/model', context_length: 8192, top_provider: { context_length: 4096 } }] }) });
  await providers.listModels('openrouter', null);
  assert.equal(providers.cachedModelContextWindow('openrouter', 'synthetic/model'), 4096, 'respect the smaller advertised route window');
  console.log('Research context: run isolation, multilingual accounting, output/history reserve, provider metadata and pre-dispatch rejection passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
