import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';

test('paid gate reserves before dispatch, rejects other models and never logs credentials', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startResearchProviderProxy(root, { port: Number(process.env.NODUS_TEST_FIXTURE_PORT ?? 0), dispatch: async (url, options) => {
    dispatches++;
    assert.equal(proxy.ledger.read().calls.length, dispatches, 'durable reservation precedes any network dispatch');
    assert.equal(options.redirect, 'error');
    if (url.includes('openrouter')) return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 5, total_tokens: 5, cost: 0.00000005 } }));
    return new Response('data: {"choices":[{"delta":{"content":"evidence"}}]}\n\ndata: {"usage":{"prompt_tokens":20,"completion_tokens":5}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const post = (provider, route, body) => fetch(`${proxy.url}/${provider}/${route}`, { method: 'POST', headers: { Authorization: 'Bearer fixture-secret-never-log', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const base = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Synthetic evidence' }], max_tokens: 100 };
    assert.equal((await post('deepseek', 'chat/completions', { ...base, model: 'other' })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, tools: [{}] })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, max_tokens: 999999 })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, max_completion_tokens: 999999 })).status, 403);
    assert.equal(dispatches, 0);
    const chat = await post('deepseek', 'chat/completions', base);
    assert.equal(chat.status, 200); assert.match(await chat.text(), /evidence/);
    const embeddings = await post('openrouter', 'embeddings', { model: 'baai/bge-m3', input: ['Synthetic source'] });
    assert.equal(embeddings.status, 200); await embeddings.text();
    assert.equal(dispatches, 2);
    assert.equal(proxy.ledger.read().calls.every(call => call.actualUsd !== null), true);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'artifacts/provider-metrics.jsonl'), 'utf8'), /fixture-secret|Synthetic source/);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

// Deep extraction issues several model calls at once. A third concurrent call used to be
// refused with a 403 that the application reads as an invalid key, which paused its queue;
// it now waits for one of the two dispatch slots instead.
test('calls beyond the two dispatch slots wait for a slot instead of being refused', async () => {
  const root = createResearchTestRoot();
  let inFlight = 0, peak = 0, dispatches = 0;
  const proxy = await startResearchProviderProxy(root, { port: Number(process.env.NODUS_TEST_FIXTURE_PORT ?? 0), dispatch: async () => {
    dispatches++; inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 150));
    inFlight--;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  } });
  try {
    const body = JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Synthetic' }], max_tokens: 10 });
    // Fresh connections: the shared fetch pool would reuse sockets the previous test's
    // proxy closed on the same fixture port.
    const post = () => new Promise((resolve, reject) => {
      const request = http.request(`${proxy.url}/deepseek/chat/completions`, { method: 'POST', agent: false, headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end(body);
    });
    const statuses = await Promise.all(Array.from({ length: 5 }, post));
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    assert.equal(dispatches, 5);
    assert.ok(peak <= 2, `at most two paid calls in flight, saw ${peak}`);
    assert.equal(proxy.ledger.read().calls.length, 5);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
