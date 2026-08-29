import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { UserAIStore } from '../lib/ai/userAIStore.mjs';
import { MAX_PROVIDER_RESPONSE_BYTES, ProviderGateway } from '../lib/ai/providerGateway.mjs';

test('concurrent provider calls resolve only the requesting user credential', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-gateway-'));
  const originalFetch = globalThis.fetch;
  try {
    const credentials = new UserAIStore(root, { keyringPath: path.join(root, 'external-keyring.json'), createKeyring: true, installationId: 'test-installation' });
    credentials.setUserCredential('alpha', 'openai', { apiKey: 'sk-alpha-only-123456789' });
    credentials.setUserCredential('beta', 'openai', { apiKey: 'sk-beta-only-987654321' });
    const seen = [];
    globalThis.fetch = async (_url, init) => {
      seen.push(init.headers.authorization);
      return new Response(JSON.stringify({ output_text: 'ok', authorization: init.headers.authorization }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const gateway = new ProviderGateway(credentials);
    const [alpha, beta] = await Promise.all([
      gateway.chat({ userId: 'alpha', provider: 'openai', model: 'gpt-test', messages: [{ role: 'user', content: 'A' }] }),
      gateway.chat({ userId: 'beta', provider: 'openai', model: 'gpt-test', messages: [{ role: 'user', content: 'B' }] }),
    ]);
    assert.deepEqual(new Set(seen), new Set(['Bearer sk-alpha-only-123456789', 'Bearer sk-beta-only-987654321']));
    assert.equal(alpha.authorization, '[REDACTED]');
    assert.equal(beta.authorization, '[REDACTED]');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('provider responses are bounded before they can reach private job storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-gateway-limit-'));
  const originalFetch = globalThis.fetch;
  try {
    const credentials = new UserAIStore(root, { keyringPath: path.join(root, 'external-keyring.json'), createKeyring: true, installationId: 'test-installation' });
    credentials.setUserCredential('alpha', 'openai', { apiKey: 'sk-alpha-only-123456789' });
    globalThis.fetch = async () => new Response('x'.repeat(MAX_PROVIDER_RESPONSE_BYTES + 1), { status: 200 });
    const gateway = new ProviderGateway(credentials);
    await assert.rejects(
      gateway.chat({ userId: 'alpha', provider: 'openai', model: 'gpt-test', messages: [{ role: 'user', content: 'A' }] }),
      /response exceeds the server safety limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
