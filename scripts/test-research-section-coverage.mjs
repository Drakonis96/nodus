import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-section-coverage')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-section-coverage-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const ai = load('electron/ai/aiClient.ts');
  const { withJobThinkingEffort, currentJobThinkingEffort } = load('electron/ai/thinkingEffort.ts');
  const { createResearchSectionCoverage } = load('electron/ai/researchSectionCoverage.ts');
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  const fact = 'The measured area fell by half in 1782.';
  const token = '[Record](nodus://passage/inside)';
  const draft = 'The source discusses irrigation.';
  const input = { language: 'en', objective: 'Explain the measured change.', section: { id: 's', title: 'Change', keyClaims: [fact] },
    citationMenu: [{ kind: 'passage', token, note: fact }] };
  let checks = 0, repairs = 0;
  let answer = { items: [{ index: 0, status: 'missing', sourceToken: token, sourceQuote: fact, draftQuote: '' }] };
  ai.completeJson = async () => { checks++; assert.equal(currentJobThinkingEffort(model), 'standard'); return answer; };
  ai.completeText = async () => { repairs++; assert.equal(currentJobThinkingEffort(model), 'low'); return `${fact} ${token}`; };
  await withJobThinkingEffort('low', model, async () => {
    const coverage = createResearchSectionCoverage(model);
    const revised = await coverage.repair(input, draft);
    assert.ok(revised.startsWith(draft));
    assert.match(revised, /fell by half/);
    assert.equal(repairs, 1);
    assert.equal(await coverage.repair(input, revised), revised, 'only one repair per section');
    assert.equal(await coverage.check(input, draft), false, 'a missing proposition is not covered');
    assert.equal(checks, 1, 'unchanged evidence and prose reuse the verdict');
    answer = { items: [{ index: 0, status: 'covered', sourceToken: token, sourceQuote: fact, draftQuote: fact }] };
    assert.equal(await coverage.check(input, revised), true);
    assert.equal(checks, 2, 'changed final prose is checked again');
    assert.equal(await coverage.check(input, draft), false, 'a later factual removal cannot keep the old coverage');
    for (const bad of [
      { items: [] },
      { items: [answer.items[0], answer.items[0]] },
      { items: [{ ...answer.items[0], index: 7 }] },
      { items: [{ ...answer.items[0], sourceToken: 'foreign' }] },
      { items: [{ ...answer.items[0], sourceQuote: 'The measured area doubled.' }] },
      { items: [{ ...answer.items[0], draftQuote: 'Absent from the draft.' }] },
    ]) {
      answer = bad;
      const guarded = createResearchSectionCoverage(model);
      assert.equal(await guarded.check(input, revised), false, 'malformed/ungrounded verdict never proves coverage');
      assert.equal(await guarded.repair(input, draft), draft, 'bad anchors never authorize adding a claim');
    }
    answer = { items: [{ index: 0, status: 'unsupported', sourceToken: '', sourceQuote: '', draftQuote: '' }] };
    assert.equal(await createResearchSectionCoverage(model).repair(input, draft), draft, 'unsupported plan claims are never forced into prose');
    ai.completeJson = async () => { throw new Error('unavailable'); };
    assert.equal(await createResearchSectionCoverage(model).check(input, draft), false);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(createResearchSectionCoverage(model, abort.signal).repair(input, draft), /abort/i);
    assert.equal(repairs, 1);
  });
  console.log('Section coverage: bounded repair, literal evidence, final removal, caching, malformed verdicts, provider failure and cancellation passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
