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
      { name: 'models/gemini-chat', displayName: 'Gemini Chat', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embed', displayName: 'Gemini Embed', supportedGenerationMethods: ['embedContent'] },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const gateway = new ProviderGateway({ withUserCredential: async (_userId, _provider, callback) => callback({ apiKey: 'private-test-key' }) });
    assert.deepEqual(await gateway.listModels({ userId: 'user-1', provider: 'gemini' }), [{ id: 'gemini-chat', name: 'Gemini Chat' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
