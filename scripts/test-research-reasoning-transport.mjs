import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { researchOpenAiModels } from './fixtures/research-openai-models.mjs';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-transport')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-wire-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const seen = []; let rejectOnce = false;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    const body = JSON.parse(raw || '{}'); seen.push(body);
    if (rejectOnce) { rejectOnce = false; res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Unsupported parameter: provider', type: 'invalid_request_error', param: 'provider', code: 'unsupported_parameter' } })); return; }
    if (req.url.endsWith('/messages')) {
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('event: content_block_delta\ndata: '+JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer' } })+'\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
      } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: 'Answer' }], stop_reason: 'end_turn' }));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
// No provider host can be contacted, even if a production route changes later.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, new URL(base).origin, `External network forbidden in compatibility tests: ${url.origin}`);
  return originalFetch(input, options);
};
try {
  const settings = load('electron/db/settingsRepo.ts');
  settings.updateSettings({ chatReasoning: 'high', openRouterThroughput: true, promptLanguage: 'es' });
  load('electron/secrets/secretStore.ts').getApiKey = () => 'test-key';
  load('electron/ai/providers.ts').openAiCompatBase = () => base;
  process.env.ANTHROPIC_BASE_URL = base;
  // A synthetic App Server catalogue deliberately differs from the public API:
  // subscriptions must follow runtime capabilities, including old/unknown models.
  const subscriptionModels = [
    { id: 'gpt-5-codex', levels: ['low', 'medium', 'high'] },
    { id: 'gpt-5.3-codex', levels: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.6-sol', levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { id: 'gpt-5.6-luna', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'gpt-6-astra', levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { id: 'future-optional-thinking', levels: ['none', 'low', 'high'] },
    { id: 'legacy-without-thinking', levels: [] },
  ];
  const turns = [];
  load('electron/ai/codexAppServerClient.ts').CodexAppServerClient = class {
    listeners = new Set();
    onNotification(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    isRunning() { return true; }
    async request(method, params) {
      if (method === 'account/read') return { account: { type: 'chatgpt', email: null, planType: 'test' } };
      if (method === 'account/rateLimits/read') return { rateLimits: null };
      if (method === 'model/list') return { nextCursor: null, data: subscriptionModels.map(({ id, levels }) => ({
        id, displayName: id, hidden: false, defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [...levels].reverse().map(reasoningEffort => ({ reasoningEffort, description: '' })),
      })) };
      if (method === 'thread/start') return { thread: { id: 'local-test-thread' } };
      if (method === 'thread/unsubscribe') return {};
      if (method === 'turn/start') {
        turns.push(params);
        queueMicrotask(() => {
          for (const fn of this.listeners) {
            fn('item/agentMessage/delta', { threadId: params.threadId, delta: 'Answer' });
            fn('turn/completed', { threadId: params.threadId, turn: { status: 'completed', items: [] } });
          }
        });
        return { turn: { id: 'local-test-turn' } };
      }
      throw new Error(`Unexpected mock App Server method: ${method}`);
    }
  };
  const ai = load('electron/ai/aiClient.ts');
  const cases = [
    ...researchOpenAiModels.flatMap(({ model, levels }) => ['standard', ...levels.slice(1)].map((effort, index) => [
      'openai', model, effort, b => {
        assert.equal(b.model, model);
        assert.equal(b.reasoning_effort, levels[index], `${model}: ${effort}`);
        const reasoningModel = levels.length > 0;
        assert.equal(b[reasoningModel ? 'max_completion_tokens' : 'max_tokens'], 16000);
        assert.equal(b[reasoningModel ? 'max_tokens' : 'max_completion_tokens'], undefined);
        assert.equal(b.temperature, !reasoningModel || levels[index] === 'none' ? .2 : undefined);
        for (const field of ['top_p', 'logprobs', 'top_logprobs', 'prompt_cache_retention']) assert.equal(b[field], undefined);
      },
    ])),
    ['anthropic', 'claude-sonnet-4-5', 'high', b => { assert.deepEqual(b.thinking, { type: 'enabled', budget_tokens: 8192 }); assert.equal(b.temperature, undefined); }],
    ['anthropic', 'claude-opus-4-6', 'standard', b => { assert.deepEqual(b.thinking, { type: 'disabled' }); assert.equal(b.output_config.effort, 'low'); }],
    ['anthropic', 'claude-mythos-5', 'standard', b => { assert.deepEqual(b.thinking, { type: 'adaptive' }); assert.equal(b.output_config.effort, 'low'); }],
    ['openai', 'gpt-5.4', 'standard', b => { assert.equal(b.reasoning_effort, 'none'); assert.equal(b.temperature, .2); }],
    ['openai', 'gpt-5.4', 'xhigh', b => { assert.equal(b.reasoning_effort, 'xhigh'); assert.equal(b.temperature, undefined); }],
    ['openai', 'gpt-5', 'standard', b => { assert.equal(b.reasoning_effort, 'minimal'); assert.equal(b.temperature, undefined); }],
    ['gemini', 'gemini-3.1-pro-preview', 'standard', b => assert.deepEqual(b.extra_body.google.thinking_config, { thinking_level: 'low' })],
    ['gemini', 'gemini-2.5-flash', 'standard', b => assert.equal(b.extra_body.google.thinking_config.thinking_budget, 0)],
    ['deepseek', 'deepseek-v4-pro', 'max', b => { assert.equal(b.thinking.type, 'enabled'); assert.equal(b.reasoning_effort, 'max'); }],
    ['groq', 'openai/gpt-oss-120b', 'high', b => assert.equal(b.reasoning_effort, 'high')],
    ['cerebras', 'qwen-3.8-27b', 'standard', b => assert.equal(b.reasoning_effort, 'none')],
    ['xiaomi', 'mimo-v2.5', 'on', b => assert.equal(b.thinking.type, 'enabled')],
    ['openrouter', 'openai/gpt-5.4', 'high', b => assert.deepEqual(b.reasoning, { effort: 'high' })],
  ];
  for (const [provider, model, researchEffort, check] of cases) {
    const opts = { system: 'Test', user: 'Question', temperature: .2, maxTokens: 16000, reasoning: 'off', researchEffort };
    for (const streaming of [false, true]) {
      const output = streaming ? await ai.completeTextStream(opts, () => {}, { provider, model }) : await ai.completeText(opts, { provider, model });
      assert.equal(output, 'Answer'); check(seen.at(-1));
    }
  }
  // Optional routing rejection must not discard the explicitly selected thinking.
  for (const streaming of [false, true]) {
    rejectOnce = true; const before = seen.length;
    const opts = { system: 'Test', user: 'Question', reasoning: 'off', researchEffort: 'high' };
    if (streaming) await ai.completeTextStream(opts, () => {}, { provider: 'openrouter', model: 'openai/gpt-5.4' });
    else await ai.completeText(opts, { provider: 'openrouter', model: 'openai/gpt-5.4' });
    assert.equal(seen.length - before, 2);
    assert.deepEqual(seen.at(-1).reasoning, { effort: 'high' });
  }
  // A normal chat/Nodi call keeps its original global policy.
  await ai.completeText({ system: 'Test', user: 'Question' }, { provider: 'openai', model: 'gpt-5.4' });
  assert.equal(seen.at(-1).reasoning_effort, 'high');
  let subscriptionCases = 0;
  for (const { id: model, levels } of [...subscriptionModels, { id: 'missing-from-catalogue', levels: [] }]) {
    for (const researchEffort of ['standard', ...levels.slice(1), 'minimal']) {
      const opts = { system: 'Test', user: 'Question', researchEffort, reasoning: 'off' };
      const expected = levels.includes(researchEffort) ? researchEffort : levels[0];
      for (const streaming of [false, true]) {
        const output = streaming ? await ai.completeTextStream(opts, () => {}, { provider: 'codex', model })
          : await ai.completeText(opts, { provider: 'codex', model });
        assert.equal(output, 'Answer');
        assert.equal(turns.at(-1).effort, expected, `${model}: ${researchEffort}`);
        subscriptionCases++;
      }
    }
  }
  await ai.completeText({ system: 'Test', user: 'Question' }, { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
  assert.equal(turns.at(-1).effort, 'ultra', 'ordinary chat retains its configured Codex effort');
  console.log(`Research reasoning: ${cases.length * 2} real SDK request cases (${researchOpenAiModels.length} old/current OpenAI models at every effort), 2 retry cases and global-policy isolation passed.`);
  console.log(`Research reasoning: ${subscriptionCases} mocked App Server turns verify catalogue choices and missing capabilities; no Codex process or paid inference started.`);
} finally {
  globalThis.fetch = originalFetch;
  load('electron/db/database.ts').closeDb();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
