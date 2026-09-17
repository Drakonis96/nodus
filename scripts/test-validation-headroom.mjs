// A batch of judgements that comes back cut off must not end the pass that asked for it.
//
// Theme assignment, relation validation, semantic bridges and chapter typing all size their
// output budget from the item count, and a one-item batch has nothing to split: the adaptive
// batch can only clip its input text, which is not what ran out when a reasoning model spends
// the budget on its trace before writing any JSON. Measured on the shipped engine with
// Gemma 4 E2B, a single relation judgement at the old 512-token floor returned no content at
// all while the same judgement at 2.000 tokens finished with valid JSON.
//
// This drives the real helper — and through it the real aiClient — against a fake
// OpenAI-compatible server, so what is pinned is the request that reaches the wire: the
// larger ceiling on the retry, and the cases that must NOT spend that second call.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-validation-headroom-test')) {
  execFileSync(require('electron'),
    [path.join(repoRoot, 'scripts/test-validation-headroom.mjs'), '--electron-validation-headroom-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-validation-headroom-'));
const { installRuntimeHooks } = await import('./lib/tsRuntimeHooks.mjs');
installRuntimeHooks(root);

/** Replies for /v1/chat/completions, consumed in order; every hit is recorded. */
let queue = [];
let seen = [];
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    if (!request.url.includes('/chat/completions')) { response.writeHead(404).end('{}'); return; }
    seen.push(JSON.parse(body || '{}'));
    const reply = queue.shift() ?? { content: '', finish_reason: 'length' };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: reply.finish_reason }],
    }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { completeJsonWithHeadroom } = require(path.join(repoRoot, 'electron/ai/structuredHeadroom.ts'));
  const planner = require(path.join(repoRoot, 'electron/ai/localRequestPlanner.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });
  // The provider id is incidental: the helper sits above the transport, and every provider
  // reaches the same `completeJson`.
  const model = { provider: 'lmstudio', model: 'fake-judgement-model' };
  const guard = (value) => !!value && typeof value === 'object' && Array.isArray(value.relations);
  const validReply = JSON.stringify({ relations: [{ from: 'g-0001', to: 'g-0002', type: 'extends', confidence: 0.7 }] });
  const run = (replies) => { queue = replies; seen = []; };

  // --- 1. A cut-off batch is retried with more room, and lands --------------------------
  const budget = planner.localTaskOutputTokens('relation-validation', 1);
  assert.ok(budget >= planner.VALIDATION_MAX_TOKENS, 'a single judgement gets the measured trace allowance plus its JSON');
  run([{ content: '', finish_reason: 'length' }, { content: validReply, finish_reason: 'stop' }]);
  const recovered = await completeJsonWithHeadroom(
    { system: 'system', user: 'user', temperature: 0.1, maxTokens: budget },
    guard,
    model,
  );
  assert.deepEqual(recovered.relations.length, 1, 'the retried answer is the one that is used');
  assert.equal(seen.length, 2, 'a cut-off answer costs exactly one extra call');
  assert.equal(seen[0].max_tokens, budget, 'the first attempt asks for the budget the planner sized');
  assert.equal(seen[1].max_tokens, planner.VALIDATION_RETRY_MAX_TOKENS > budget * 2 ? budget * 2 : planner.VALIDATION_RETRY_MAX_TOKENS,
    'the retry asks for twice the budget, capped at the retry ceiling');
  assert.deepEqual(seen[1].messages, seen[0].messages, 'and repeats the same question');
  assert.equal(seen[1].temperature, seen[0].temperature, 'with the same sampling');

  // --- 2. A request already asking for the ceiling is left to the caller ----------------
  // Doubling it would exceed the ceiling the retry is allowed to reach, so replaying would
  // spend a call that cannot be any different; the caller splits the batch instead. The
  // planner's batch tasks cap below the ceiling, so this is the guard's own case: a budget
  // that already equals it.
  run([{ content: '', finish_reason: 'length' }]);
  await assert.rejects(
    () => completeJsonWithHeadroom(
      { system: 'system', user: 'user', maxTokens: planner.VALIDATION_RETRY_MAX_TOKENS },
      guard,
      model,
    ),
    (error) => {
      assert.equal(error.code, 'output_truncated');
      return true;
    },
  );
  assert.equal(seen.length, 1, 'a request at the retry ceiling is not replayed with the same budget');

  // --- 3. Only a cut-off answer earns more room ----------------------------------------
  // A well-formed reply that misses the schema would miss it at any budget: `completeJson`
  // resamples it unchanged (three attempts, its own ladder), and the helper must not turn
  // that into a bigger request.
  run(Array.from({ length: 3 }, () => ({ content: JSON.stringify({ wrong: true }), finish_reason: 'stop' })));
  await assert.rejects(
    () => completeJsonWithHeadroom({ system: 'system', user: 'user', maxTokens: budget }, guard, model),
    (error) => {
      assert.equal(error.code, 'schema_mismatch');
      return true;
    },
  );
  assert.ok(seen.length >= 2, 'the schema miss is resampled, as completeJson always did');
  assert.ok(
    seen.every((call) => call.max_tokens === budget),
    'and every resample asks for the same budget: more room would not change the shape',
  );

  run([{ content: validReply, finish_reason: 'length' }, { content: validReply, finish_reason: 'length' }]);
  await assert.rejects(
    () => completeJsonWithHeadroom({ system: 'system', user: 'user', maxTokens: budget }, guard, model),
    (error) => {
      assert.equal(error.code, 'output_truncated');
      return true;
    },
  );
  assert.equal(seen.length, 2, 'a model that keeps truncating stops after the one retry');

  // --- 4. Every batch judgement goes through it ----------------------------------------
  const wiring = [
    ['electron/ai/reprocessConnections.ts', 2],
    ['electron/ai/chapterIdeas.ts', 2],
    ['electron/ai/semanticBridges.ts', 1],
  ];
  for (const [file, expected] of wiring) {
    const source = read(file);
    assert.equal(
      (source.match(/completeJsonWithHeadroom</g) ?? []).length,
      expected,
      `${file} must route its batch judgements through the headroom recovery`,
    );
    assert.doesNotMatch(source, /from '\.\/aiClient'(.|\n)*completeJson[,}]/, `${file} must not call completeJson directly`);
    assert.match(source, /import \{ completeJsonWithHeadroom \} from '\.\/structuredHeadroom';/);
  }
  assert.match(
    read('electron/ai/structuredHeadroom.ts'),
    /import \{ VALIDATION_RETRY_MAX_TOKENS \} from '\.\/localRequestPlanner';/,
    'the ceiling is shared with the budgets it retries, not typed twice',
  );

  console.log('Validation headroom verified.');
} finally {
  try { closeDb(); } catch { /* database may not have opened */ }
  server.close();
  await rm(root, { recursive: true, force: true });
}
