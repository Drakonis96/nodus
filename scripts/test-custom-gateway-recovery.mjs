// A custom gateway that refuses Nodus's optional request body without saying which field it
// disliked must not end a scan.
//
// Every JSON call carries `response_format: {type:"json_object"}`, and a deep scan of a
// thinking model also carries a `reasoning_effort` hint. Both are optional to the plain
// OpenAI contract, and a proxy in front of a real API often answers a refusal with a bare
// 400 and no body at all — the OpenAI SDK reports that as "400 status code (no body)", so
// nothing names the field. The old recovery only ran when Nodus had sent the reasoning hint
// and only dropped that one field, so a gateway that refused `response_format` matched no
// branch at all: one request, no replay, and the whole library ended on "the provider
// rejected the request (400) without explaining why" (issue #802).
//
// This drives the real aiClient against a fake gateway and pins the recovery from both
// sides: what it must recover, and how far it may go before it stops.
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

if (!process.argv.includes('--electron-custom-gateway-recovery-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-custom-gateway-recovery.mjs'), '--electron-custom-gateway-recovery-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-gateway-recovery-'));
const { installRuntimeHooks } = await import('./lib/tsRuntimeHooks.mjs');
installRuntimeHooks(root);

/** `refuse(body)` returns the field the gateway dislikes, or null to answer normally. */
let refuse = () => null;
/** Whether the refusal says which field it refused — the shape that always had a replay. */
let namesTheField = false;
let seen = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push(body);
    const field = refuse(body);
    if (field) {
      res.writeHead(400, { 'content-type': 'application/json' });
      // An empty body is what a proxy answers: the SDK reports "400 status code (no body)",
      // and no field is named. `namesTheField` switches to the explicit shape.
      if (namesTheField) res.end(JSON.stringify({ error: { message: `Unknown field ${field}` } }));
      else res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ideas":["ok"]}' }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({
    customProvider: {
      baseUrl,
      models: ['plain-model', 'thinking-model:thinking', 'hint-only-model:thinking', 'named-model', 'stubborn-model', 'stubborn-thinking:thinking', 'single-shot:thinking', 'other-model'],
    },
  });

  const guard = (value) => !!value && typeof value === 'object' && Array.isArray(value.ideas);
  const callOpts = { system: 'system', user: 'user', maxTokens: 64, requestClass: 'background' };
  const ask = (model) => aiClient.completeJson(callOpts, guard, { provider: 'custom', model });
  const run = (refuseWith, named = false) => { refuse = refuseWith; namesTheField = named; seen = []; };

  // --- 1. The refusal that used to end the library: response_format, unnamed 400 ----
  run((body) => (body.response_format ? 'response_format' : null));
  assert.deepEqual(await ask('plain-model'), { ideas: ['ok'] }, 'the scan completes');
  assert.equal(seen.length, 2, 'one refused request plus exactly one replay');
  assert.ok('response_format' in seen[0], 'the first request asks for JSON mode, as every scan does');
  assert.ok(!('response_format' in seen[1]), 'the replay drops exactly the field the gateway refused');
  assert.equal(seen[1].model, 'plain-model', 'and changes nothing else about the request');
  assert.deepEqual(seen[1].messages, seen[0].messages, 'the prompt survives the replay untouched');
  assert.equal(seen[1].max_tokens, seen[0].max_tokens, 'the output budget is not quietly reduced');

  // --- 2. The rung that landed is remembered, so the rest of the scan costs one call --
  seen = [];
  await ask('plain-model');
  assert.equal(seen.length, 1, 'the session remembers what this gateway refuses');
  assert.ok(!('response_format' in seen[0]), 'and starts from the body that lands');

  // --- 3. A thinking model walks the ladder from the smallest change ---------------
  // The reasoning hint is the field Nodus added most recently, so dropping just it keeps
  // JSON mode, which is the contract the scan asked for. Only if that is refused too does
  // the request fall back to the plain OpenAI body.
  run((body) => (body.response_format || body.reasoning_effort ? 'reasoning_effort' : null));
  await ask('thinking-model:thinking');
  assert.equal(seen.length, 3, 'full body, then JSON mode alone, then the plain body');
  assert.ok('reasoning_effort' in seen[0] && 'response_format' in seen[0], 'the deep scan asks for both');
  assert.ok(!('reasoning_effort' in seen[1]) && 'response_format' in seen[1], 'the first replay keeps JSON mode');
  assert.ok(!('reasoning_effort' in seen[2]) && !('response_format' in seen[2]), 'the last replay is the plain OpenAI body');
  seen = [];
  await ask('thinking-model:thinking');
  assert.equal(seen.length, 1, 'both refusals are remembered, so the next chunk is a single call');
  assert.ok(!('reasoning_effort' in seen[0]) && !('response_format' in seen[0]), 'and it sends neither field');

  // --- 4. A gateway that refuses only the hint keeps JSON mode ----------------------
  run((body) => ('reasoning_effort' in body ? 'reasoning_effort' : null));
  await ask('hint-only-model:thinking');
  assert.equal(seen.length, 2, 'the hint is refused and dropped');
  assert.ok('response_format' in seen[1], 'JSON mode is not sacrificed when the hint was the problem');
  seen = [];
  await ask('hint-only-model:thinking');
  assert.equal(seen.length, 1, 'the hint is left out from the start for the rest of the session');
  assert.ok(!('reasoning_effort' in seen[0]) && 'response_format' in seen[0], 'and JSON mode is still asked for');

  // --- 5. A refusal that names the field keeps the original single replay -----------
  run((body) => (body.response_format ? 'response_format' : null), true);
  await ask('named-model');
  assert.equal(seen.length, 2, 'a named refusal is still answered with one replay');
  assert.ok(!('response_format' in seen[1]), 'and the named field is dropped');

  // --- 6. Bounded: a gateway that refuses everything ends the ladder ----------------
  // Nothing is billed for a refusal, but an unbounded ladder would still hold a scan slot
  // open, so the recovery stops at the plain body and reports the refusal it got.
  run(() => 'request');
  await assert.rejects(() => ask('stubborn-model'), (error) => {
    assert.equal(error.code, 'bad_request', 'the failure is reported as the provider rejection it is');
    assert.match(error.message, /rechazó la solicitud \(400\)/, 'and it still reads as a rejection');
    return true;
  });
  assert.equal(seen.length, 2, 'the ladder ends instead of looping');
  seen = [];
  await assert.rejects(() => ask('stubborn-thinking:thinking'), (error) => {
    assert.equal(error.code, 'bad_request');
    return true;
  });
  assert.equal(seen.length, 3, 'and it is bounded at three even with both optional fields sent');

  // --- 7. `noRetry` still means one attempt ----------------------------------------
  // Surfaces that asked for a single attempt (vision, one-shot utilities) must not be
  // pushed through a recovery ladder they did not ask for.
  run(() => 'request');
  seen = [];
  await assert.rejects(
    () => aiClient.completeText({ ...callOpts, noRetry: true }, { provider: 'custom', model: 'single-shot:thinking' }),
    (error) => {
      assert.equal(error.code, 'bad_request');
      return true;
    },
  );
  assert.equal(seen.length, 1, 'a caller that asked for a single attempt gets one');

  // --- 8. The memory is per model, not per endpoint --------------------------------
  run(() => null);
  seen = [];
  await ask('other-model');
  assert.equal(seen.length, 1, 'a model the gateway accepts needs no recovery');
  assert.ok('response_format' in seen[0], 'and is not punished for another model\'s contract');

  // --- 9. Both transports resolve a refusal through the same ladder ----------------
  const client = read('electron/ai/aiClient.ts');
  assert.equal(
    (client.match(/replayRefusedOptionalFields\(model, extras, e, sentReasoning, replay(?:Body|Stream)\)/g) ?? []).length,
    2,
    'the buffered and streaming transports share one recovery',
  );
  assert.equal(
    (client.match(/shouldRetryWithoutOptionalFields\(e, \{ provider: model\.provider \}\)/g) ?? []).length,
    2,
    'and neither decides by itself whether a refusal is replayable',
  );

  console.log('Custom gateway recovery verified.');
} finally {
  try { closeDb(); } catch { /* database may not have opened */ }
  server.close();
  await rm(root, { recursive: true, force: true });
}
