import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';

test('paid gate reserves before dispatch, rejects other models and never logs credentials', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startResearchProviderProxy(root, { dispatch: async (url, options) => {
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
