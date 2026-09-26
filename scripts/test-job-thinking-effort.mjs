// Deep Research, Immersion and the databases' Deep Research carry the thinking level chosen
// in their form. The level follows the job's own calls to the model it was chosen for, on
// the wire, and nothing else: not a concurrent job with another level, not a call to another
// model, not a model with no thinking control, and not a request from an older build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--job-thinking-effort')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-job-thinking-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const seen = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push(body);
    const content = body.response_format ? '{"ok":true}' : `Answer for ${body.messages?.at(-1)?.content ?? ''}`;
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, new URL(base).origin, `External network forbidden: ${url.origin}`);
  return originalFetch(input, options);
};
try {
  load('electron/db/settingsRepo.ts').updateSettings({ chatReasoning: 'off', promptLanguage: 'en' });
  load('electron/secrets/secretStore.ts').getApiKey = () => 'test-key';
  load('electron/ai/providers.ts').openAiCompatBase = () => base;
  const ai = load('electron/ai/aiClient.ts');
  const { withJobThinkingEffort, currentJobThinkingEffort } = load('electron/ai/thinkingEffort.ts');
  const gpt = { provider: 'openai', model: 'gpt-5.4' };
  const other = { provider: 'openai', model: 'gpt-5.2' };
  const plain = { provider: 'openai', model: 'gpt-4o' };
  const call = async (model, user, kind = 'text') => {
    const before = seen.length;
    if (kind === 'json') await ai.completeJson({ system: 'Return JSON.', user, maxTokens: 1000 }, value => !!value && typeof value === 'object', model);
    else if (kind === 'stream') await ai.completeTextStream({ system: 'Answer.', user, maxTokens: 1000 }, () => {}, model);
    else await ai.completeText({ system: 'Answer.', user, maxTokens: 1000 }, model);
    assert.equal(seen.length, before + 1, `${user}: one request`);
    return seen.at(-1);
  };
  const budget = body => body.max_completion_tokens ?? body.max_tokens;

  // Outside any job: the model's usual reasoning, as before.
  const baseline = await call(gpt, 'baseline');
  assert.notEqual(baseline.reasoning_effort, 'high');

  // Inside a job: every kind of call to the job's model carries the chosen level, with room
  // for the thinking on top of the answer.
  for (const kind of ['text', 'json', 'stream']) {
    const body = await withJobThinkingEffort('high', gpt, () => call(gpt, `job ${kind}`, kind));
    assert.equal(body.reasoning_effort, 'high', `${kind}: the job's level reaches the provider`);
    assert.ok(budget(body) > 1000, `${kind}: the output budget makes room for thinking (${budget(body)})`);
  }
  const standard = await withJobThinkingEffort('standard', gpt, () => call(gpt, 'job standard'));
  assert.equal(standard.reasoning_effort, 'none', 'Standard, chosen, is the model\'s own first level (thinking off for GPT-5.4)');

  // Only the job's model: a call to another model in the same job keeps its usual reasoning.
  const audit = await withJobThinkingEffort('high', gpt, () => call(other, 'audit model'));
  const auditBaseline = await call(other, 'audit baseline');
  assert.equal(audit.reasoning_effort, auditBaseline.reasoning_effort, 'another model in the job is untouched');

  // Two jobs at once keep their own levels.
  const sent = user => seen.filter(body => JSON.stringify(body.messages).includes(user));
  await Promise.all([
    withJobThinkingEffort('low', gpt, async () => { await new Promise(resolve => setTimeout(resolve, 20)); await ai.completeText({ system: 'Answer.', user: 'concurrent low', maxTokens: 1000 }, gpt); }),
    withJobThinkingEffort('xhigh', gpt, () => ai.completeText({ system: 'Answer.', user: 'concurrent xhigh', maxTokens: 1000 }, gpt)),
  ]);
  assert.deepEqual(sent('concurrent low').map(body => body.reasoning_effort), ['low']);
  assert.deepEqual(sent('concurrent xhigh').map(body => body.reasoning_effort), ['xhigh']);
  assert.equal(currentJobThinkingEffort(gpt), undefined, 'the level does not outlive its job');

  // Nothing to choose, nothing changes: a model with no thinking control, a request without a
  // level (older builds, MCP, the Server) and a level this build does not know.
  const plainBaseline = await call(plain, 'plain baseline');
  const plainJob = await withJobThinkingEffort('high', plain, () => call(plain, 'plain baseline'));
  assert.deepEqual(plainJob, plainBaseline, 'a model with no thinking control is asked exactly as before');
  const legacy = await withJobThinkingEffort(undefined, gpt, () => call(gpt, 'baseline'));
  assert.deepEqual(legacy, baseline, 'a request without a level runs as before');
  const junk = await withJobThinkingEffort('turbo', gpt, () => call(gpt, 'baseline'));
  assert.deepEqual(junk, baseline, 'an unknown level is ignored');

  // The three jobs open their envelope with the level their form sent, for their own model.
  const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
  assert.match(read('electron/ai/deepResearch.ts'), /withJobThinkingEffort\(request\.thinkingEffort, request\.model \?\? settings\.deepResearchModel \?\? settings\.synthesisModel/);
  assert.match(read('electron/ai/immersion.ts'), /withJobThinkingEffort\(request\.thinkingEffort, request\.model \?\? settings\.immersionModel \?\? settings\.synthesisModel/);
  assert.match(read('electron/ai/databaseDeepResearchLane.ts'), /withJobThinkingEffort\(current\.options\.thinkingEffort, current\.model/);
  const { normalizeDatabaseDeepResearchJobInput } = load('shared/databaseDeepResearch.ts');
  const input = { objective: 'Compare', databaseIds: ['db'], viewIds: [], filters: {}, roles: {}, model: gpt, depth: 'quick' };
  assert.equal(normalizeDatabaseDeepResearchJobInput({ ...input, thinkingEffort: 'high' }).thinkingEffort, 'high', 'the databases\' durable request keeps the level');
  assert.equal('thinkingEffort' in normalizeDatabaseDeepResearchJobInput({ ...input, thinkingEffort: 'turbo' }), false, 'and drops one it does not know');
  console.log('Job thinking level: text, JSON and streamed calls carry it on the wire with room to think; other models, concurrent jobs, models without thinking, older requests and unknown levels are untouched; the three jobs open it from their forms.');
} finally {
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
