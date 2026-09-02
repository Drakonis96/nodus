import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = function loadTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const planner = require(path.join(root, 'electron/ai/localRequestPlanner.ts'));
const native = require(path.join(root, 'electron/ai/localNativeCompletion.ts'));
const adaptive = require(path.join(root, 'electron/ai/adaptiveStructuredBatch.ts'));

test('Auto chooses only 4K/8K/16K and keeps output independent', () => {
  const small = planner.buildLocalRequestPlan({
    provider: 'ollama', model: 'qwen', task: 'summary', promptTokens: 500,
    requestedOutputTokens: 800, contextMode: 'auto', trainedContextTokens: 131072, nativeTransport: true,
  });
  assert.equal(small.contextTokens, 4096);
  assert.equal(small.outputTokens, 800);

  const large = planner.buildLocalRequestPlan({
    provider: 'ollama', model: 'qwen', task: 'deep-extraction', promptTokens: 9000,
    requestedOutputTokens: 8000, contextMode: 'auto', trainedContextTokens: 131072, nativeTransport: true,
  });
  assert.equal(large.contextTokens, 16384);
  assert.ok(large.outputTokens < 8000, 'remaining context, not context itself, caps output');
  assert.ok(large.promptTokens + large.outputTokens + large.reserveTokens <= large.contextTokens);
});

test('65K and 128K manual context never become output limits', () => {
  for (const context of [65536, 131072]) {
    const plan = planner.buildLocalRequestPlan({
      provider: 'lmstudio', model: 'qwen', task: 'relation-validation', promptTokens: 2000,
      requestedOutputTokens: 4000, contextMode: 'manual', manualContextTokens: context,
      trainedContextTokens: 131072, nativeTransport: true,
    });
    assert.equal(plan.contextTokens, context);
    assert.equal(plan.outputTokens, 4000);
  }
});

test('chapter tasks use bounded per-batch output budgets instead of context-sized output', () => {
  assert.equal(planner.localTaskOutputTokens('chapter-idea-extraction', 1), 1500);
  assert.equal(planner.localTaskOutputTokens('chapter-idea-extraction', 6), 4500);
  assert.equal(planner.localTaskOutputTokens('chapter-idea-extraction', 100), 6000);
  assert.equal(planner.localTaskOutputTokens('chapter-relation-typing', 1), 768);
  assert.equal(planner.localTaskOutputTokens('chapter-relation-typing', 12), 2176);
  assert.equal(planner.localTaskOutputTokens('chapter-relation-typing', 36), 4000);
});

test('compatibility fallback obeys loaded context and cannot pretend to apply manual context', () => {
  const plan = planner.buildLocalRequestPlan({
    provider: 'lmstudio', model: 'old', task: 'summary', promptTokens: 1000,
    requestedOutputTokens: 800, contextMode: 'manual', manualContextTokens: 65536,
    trainedContextTokens: 131072, loadedContextTokens: 4096, nativeTransport: false,
  });
  assert.equal(plan.contextTokens, 4096);
  assert.equal(plan.outputTokens, 800);
});

test('native providers receive separate exact context/output fields', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(body) });
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content: '{"ok":true}' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 4 }));
      } else if (Object.hasOwn(JSON.parse(body), 'reasoning')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown field reasoning' }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output_text: '{"ok":true}', stats: { input_tokens: 11, total_output_tokens: 5 } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const common = {
    baseUrl, key: null, model: 'tiny', system: 's', user: 'u', temperature: 0,
    contextTokens: 16384, outputTokens: 777, jsonMode: true, timeoutMs: 5000,
  };
  await native.completeLocalNative({ ...common, provider: 'ollama' });
  await native.completeLocalNative({ ...common, provider: 'lmstudio' });

  assert.equal(seen[0].body.options.num_ctx, 16384);
  assert.equal(seen[0].body.options.num_predict, 777);
  assert.equal(seen[0].body.format, 'json');
  assert.equal(seen[1].body.reasoning, 'off');
  assert.equal(seen[2].body.context_length, 16384);
  assert.equal(seen[2].body.max_output_tokens, 777);
  assert.equal(seen[2].body.store, false);
  assert.ok(!Object.hasOwn(seen[2].body, 'reasoning'));
});

test('native timeout remains active while the response body is stalled', async (t) => {
  const sockets = new Set();
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    // Intentionally never finish the body: the request must be aborted by Nodus.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();
  await assert.rejects(native.completeLocalNative({
    provider: 'ollama', baseUrl, key: null, model: 'tiny', system: 's', user: 'u',
    temperature: 0, contextTokens: 4096, outputTokens: 32, jsonMode: true, timeoutMs: 80,
  }), /abort|timeout/i);
  assert.ok(Date.now() - started < 2_000, 'stalled body was bounded by the request deadline');
});

test('LM Studio native streaming keeps reasoning separate and reads final usage', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end([
      'event: reasoning.delta',
      'data: {"type":"reasoning.delta","content":"private thought"}',
      '',
      'event: message.delta',
      'data: {"type":"message.delta","content":"public answer"}',
      '',
      'event: chat.end',
      'data: {"type":"chat.end","result":{"output":[{"type":"message","content":"public answer"}],"stats":{"input_tokens":12,"total_output_tokens":7,"reasoning_output_tokens":3}}}',
      '',
    ].join('\n'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const deltas = [];
  const result = await native.streamLocalNative({
    provider: 'lmstudio', baseUrl: `http://127.0.0.1:${server.address().port}`,
    key: null, model: 'tiny', system: 's', user: 'u', temperature: 0,
    contextTokens: 4096, outputTokens: 64, jsonMode: false, timeoutMs: 5000,
  }, (text, kind) => deltas.push({ text, kind }));
  assert.equal(result.text, 'public answer');
  assert.deepEqual(deltas, [
    { text: 'private thought', kind: 'reasoning' },
    { text: 'public answer', kind: 'content' },
  ]);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.reasoningTokens, 3);
});

test('structured relation batches split, validate every leaf, and combine only complete results', async () => {
  const calls = [];
  const output = await adaptive.adaptiveStructuredBatch({
    items: [1, 2, 3, 4, 5, 6, 7, 8],
    initialBatchSize: 8,
    execute: async (batch, context) => {
      calls.push({ batch: [...batch], ...context });
      if (batch.length > 2) {
        const error = new Error('context overflow');
        error.code = 'context_overflow';
        throw error;
      }
      return batch;
    },
    combine: (parts) => parts.flat(),
  });
  assert.deepEqual(output, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(calls.filter((call) => call.batch.length <= 2).length, 4);
});

test('a single malformed item gets bounded clipping and unrelated errors fail immediately', async () => {
  const limits = [];
  const clipped = await adaptive.adaptiveStructuredBatch({
    items: ['idea'], initialBatchSize: 1,
    execute: async (_batch, context) => {
      limits.push(context.textLimit);
      if (context.textLimit !== 600) {
        const error = new Error('invalid JSON');
        error.code = 'invalid_json';
        throw error;
      }
      return ['ok'];
    },
    combine: (parts) => parts.flat(),
  });
  assert.deepEqual(limits, [2000, 1200, 600]);
  assert.deepEqual(clipped, ['ok']);

  let attempts = 0;
  await assert.rejects(adaptive.adaptiveStructuredBatch({
    items: [1, 2, 3, 4], initialBatchSize: 4,
    execute: async () => { attempts += 1; throw new Error('authentication failed'); },
    combine: (parts) => parts.flat(),
  }), /authentication failed/);
  assert.equal(attempts, 1);
});
