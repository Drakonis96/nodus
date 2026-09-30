import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderGateway } from '../lib/ai/providerGateway.mjs';

test('Server live model catalogue uses the private credential without exposing it', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers ?? {}) } });
    return new Response(JSON.stringify({
      data: [
        { id: 'gpt-zeta', name: 'GPT Zeta', context_window: 123_456, capabilities: { reasoning: true } },
        { id: 'text-embedding-private', name: 'Embedding' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const gateway = new ProviderGateway({
      withUserCredential: async (userId, provider, callback) => {
        assert.equal(userId, 'user-1');
        assert.equal(provider, 'openai');
        return callback({ apiKey: 'private-test-key' });
      },
    });
    const models = await gateway.listModels({ userId: 'user-1', provider: 'openai' });
    assert.deepEqual(models, [{ id: 'gpt-zeta', name: 'GPT Zeta', contextLength: 123_456, reasoning: true }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
    assert.equal(calls[0].headers.authorization, 'Bearer private-test-key');
    assert.equal(JSON.stringify(models).includes('private-test-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini catalogue keeps only generateContent models', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    models: [
      { name: 'models/gemini-chat', displayName: 'Gemini Chat', inputTokenLimit: 1_048_576, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embed', displayName: 'Gemini Embed', supportedGenerationMethods: ['embedContent'] },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const gateway = new ProviderGateway({ withUserCredential: async (_userId, _provider, callback) => callback({ apiKey: 'private-test-key' }) });
    assert.deepEqual(await gateway.listModels({ userId: 'user-1', provider: 'gemini' }), [{ id: 'gemini-chat', name: 'Gemini Chat', contextLength: 1_048_576 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Server windows preserve advertised limits and use only provider-specific documented fallbacks', async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  const gateway = new ProviderGateway({ withUserCredential: async (_userId, _provider, callback) => callback({ apiKey: 'private-test-key' }) });
  const list = provider => gateway.listModels({ userId: 'user-1', provider });
  try {
    payload = { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-5.4', context_length: 8192 }, { id: 'gpt-future', context_window: '1000000' }] };
    const openai = await list('openai');
    assert.equal(openai.find(model => model.id === 'gpt-6.1-sol').contextLength, 1_050_000);
    assert.equal(openai.find(model => model.id === 'gpt-5.4').contextLength, 8192);
    assert.equal(openai.find(model => model.id === 'gpt-future').contextLength, undefined);
    payload = { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-catalogue-only', max_input_tokens: 600_000 }] };
    const anthropic = await list('anthropic');
    assert.equal(anthropic.find(model => model.id === 'claude-opus-5-5').contextLength, 1_000_000);
    assert.equal(anthropic.find(model => model.id === 'claude-catalogue-only').contextLength, 600_000);
    payload = { data: [
      { id: 'anthropic/claude-opus-5-5', context_length: 1_000_000, top_provider: { context_length: 4096 } },
      { id: 'route-only', top_provider: { context_length: 8192 } },
      { id: 'gpt-6.1-sol' },
    ] };
    const routed = await list('openrouter');
    assert.equal(routed.find(model => model.id === 'anthropic/claude-opus-5-5').contextLength, 4096);
    assert.equal(routed.find(model => model.id === 'route-only').contextLength, 8192);
    assert.equal(routed.find(model => model.id === 'gpt-6.1-sol').contextLength, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
