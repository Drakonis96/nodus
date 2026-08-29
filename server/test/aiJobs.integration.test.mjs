import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAIRoutes } from '../lib/routes/ai.mjs';
import { UserPrivateDataStore } from '../lib/privateDataStore.mjs';

function responseJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

async function body(req) {
  let value = '';
  for await (const chunk of req) value += chunk;
  return JSON.parse(value || '{}');
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-jobs-'));
  const privateData = new UserPrivateDataStore(root, options.store);
  const gateway = options.gateway ?? { chat: async () => ({ answer: 'ok' }) };
  const routes = createAIRoutes({
    authorize: (req) => {
      const userId = String(req.headers['x-test-user'] || 'alpha');
      return { user: { id: userId }, principal: { kind: 'device' }, device: { spaceId: 'vault-1' }, space: { id: 'vault-1', embeddingContracts: options.embeddingContracts ?? {} } };
    },
    json: responseJson, jsonBody: body, publicUrl: () => 'http://localhost', privateData, gateway,
    aiStore: { getUserCredential: () => ({ configured: true }), listUserCredentials: () => [] },
    store: options.membershipStore, rateLimit: () => true,
    maxActiveJobsPerUser: options.maxActiveJobsPerUser ?? 4,
    maxActiveJobsGlobal: options.maxActiveJobsGlobal ?? 32,
  });
  const server = http.createServer((req, res) => {
    const userId = String(req.headers['x-test-user'] || 'alpha');
    void userId;
    void routes.handle(req, res, new URL(req.url, 'http://localhost'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { root, privateData, origin, close: async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

async function api(origin, pathname, options = {}) {
  return fetch(`${origin}${pathname}`, {
    ...options,
    headers: { ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
}

test('AI jobs enforce owner isolation and stamp context from the authenticated principal', async () => {
  const fx = await fixture();
  try {
    const created = await api(fx.origin, '/api/v2/vaults/vault-1/ai/assistant', {
      method: 'POST', headers: { 'x-test-user': 'alpha' },
      json: { provider: 'openai', model: 'test-model', userId: 'forged-beta', messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(created.status, 202);
    const job = (await created.json()).job;
    assert.equal(job.userId, 'alpha');
    assert.equal(job.ownerUserId, 'alpha');
    assert.equal(job.model, 'test-model');
    assert.equal(Object.hasOwn(job, 'request'), false);

    const idor = await api(fx.origin, `/api/v2/me/jobs/${job.id}`, { headers: { 'x-test-user': 'beta' } });
    assert.equal(idor.status, 404);
    const own = await api(fx.origin, `/api/v2/me/jobs/${job.id}`, { headers: { 'x-test-user': 'alpha' } });
    assert.equal(own.status, 200);
  } finally { await fx.close(); }
});

test('AI provider work has explicit per-user and global concurrency bounds', async () => {
  const gateway = { chat: () => new Promise(() => {}) };
  const fx = await fixture({ gateway, maxActiveJobsPerUser: 2, maxActiveJobsGlobal: 2 });
  try {
    const request = () => api(fx.origin, '/api/v2/vaults/vault-1/ai/assistant', {
      method: 'POST', headers: { 'x-test-user': 'alpha' },
      json: { provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal((await request()).status, 202);
    assert.equal((await request()).status, 202);
    const refused = await request();
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).error, 'ai_concurrency_limit');
  } finally { await fx.close(); }
});

test('embedding calls and chat jobs share the same concurrency budget', async () => {
  let releaseEmbedding;
  let markEmbeddingStarted;
  const embeddingStarted = new Promise((resolve) => { markEmbeddingStarted = resolve; });
  const gateway = {
    chat: async () => ({ answer: 'unused' }),
    embeddings: () => new Promise((resolve) => {
      releaseEmbedding = () => resolve({ data: [{ embedding: [0.25, 0.75] }] });
      markEmbeddingStarted();
    }),
  };
  const contract = {
    provider: 'openai', model: 'text-embedding-test', dim: 2, protocol: 'nodus.embedding.v2', task: 'retrieval',
    preprocessing: { unicode: 'NFKC', trim: true }, normalization: { method: 'l2', epsilon: 1e-12 },
    quantization: 'float32', configVersion: 2,
  };
  const fx = await fixture({
    gateway, maxActiveJobsPerUser: 1, maxActiveJobsGlobal: 1,
    embeddingContracts: { notes: { contract } },
  });
  try {
    const embedding = api(fx.origin, '/api/v2/vaults/vault-1/embeddings/notes', {
      method: 'POST', headers: { 'x-test-user': 'alpha' }, json: { inputs: ['hello'] },
    });
    await embeddingStarted;
    const sameUser = await api(fx.origin, '/api/v2/vaults/vault-1/ai/assistant', {
      method: 'POST', headers: { 'x-test-user': 'alpha' },
      json: { provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(sameUser.status, 429);
    const otherUser = await api(fx.origin, '/api/v2/vaults/vault-1/ai/assistant', {
      method: 'POST', headers: { 'x-test-user': 'beta' },
      json: { provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(otherUser.status, 503);
    releaseEmbedding();
    assert.equal((await embedding).status, 200);
  } finally { await fx.close(); }
});

test('durable jobs recover deterministically, retain bounded history, and redact results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-jobs-store-'));
  try {
    const first = new UserPrivateDataStore(root, { jobRetentionMs: 1_000, maxJobs: 2 });
    const queued = first.createJob('alpha', { userId: 'forged', vaultId: 'vault-1', capability: 'assistant', provider: 'openai', model: 'test-model', request: { messages: [] } });
    first.updateJob('alpha', queued.id, { status: 'running' });
    const restarted = new UserPrivateDataStore(root, { jobRetentionMs: 1_000, maxJobs: 2 });
    assert.equal(restarted.recoverJobs(), 1);
    assert.equal(restarted.job('alpha', queued.id).error.code, 'server_restart');
    restarted.updateJob('alpha', queued.id, { status: 'queued' });
    restarted.updateJob('alpha', queued.id, { status: 'running' });
    restarted.updateJob('alpha', queued.id, { status: 'completed', result: { apiKey: 'sk-super-secret-abcdefghijklmnop' } });
    const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'users', 'alpha', 'private.json'), 'utf8'));
    assert.equal(persisted.jobs[0].result.apiKey, '[REDACTED]');

    const concurrent = await Promise.all(Array.from({ length: 20 }, (_, index) => restarted.createJob('alpha', {
      vaultId: 'vault-1', capability: 'assistant', provider: 'openai', model: `model-${index}`, request: { messages: [] },
    })));
    assert.equal(new Set(concurrent.map((job) => job.id)).size, 20);
    // The count cap removes terminal history only; active jobs remain available for recovery.
    assert.ok(restarted.jobs('alpha').length <= 2 + 20);
    const old = restarted.createJob('beta', { vaultId: 'vault-1', capability: 'assistant', provider: 'openai', model: 'test-model', request: { messages: [] } });
    const betaState = restarted.read('beta');
    betaState.jobs[0].status = 'completed'; betaState.jobs[0].updatedAt = new Date(Date.now() - 10_000).toISOString();
    restarted.write('beta', betaState);
    assert.equal(restarted.pruneJobs('beta'), 1);
    assert.equal(restarted.job('beta', old.id), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('private store rejects symlinks and cross-owner records instead of laundering ownership', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-private-store-hardening-'));
  try {
    const store = new UserPrivateDataStore(root);
    store.createConversation('alpha', { vaultId: 'vault-1', title: 'owned' });
    const file = path.join(root, 'users', 'alpha', 'private.json');
    const state = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    state.conversations[0].ownerUserId = 'beta';
    fsSync.writeFileSync(file, JSON.stringify(state));
    assert.throws(() => store.read('alpha'), /conversation ownership mismatch/);
    fsSync.unlinkSync(file);
    const outside = path.join(root, 'outside.json');
    fsSync.writeFileSync(outside, JSON.stringify({ version: 1, ownerUserId: 'alpha', conversations: [], jobs: [] }));
    fsSync.symlinkSync(outside, file);
    assert.throws(() => store.read('alpha'), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('revoking vault membership aborts an in-flight provider job and discards its result', async () => {
  const membershipStore = { state: { memberships: [{ userId: 'alpha', spaceId: 'vault-1', role: 'reader' }] } };
  const gateway = { chat: ({ signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ answer: 'must not survive revocation' }), 5_000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }, { once: true });
  }) };
  const fx = await fixture({ gateway, membershipStore });
  try {
    const created = await api(fx.origin, '/api/v2/vaults/vault-1/ai/assistant', {
      method: 'POST', headers: { 'x-test-user': 'alpha' },
      json: { provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
    });
    const id = (await created.json()).job.id;
    for (let attempt = 0; attempt < 20 && fx.privateData.job('alpha', id)?.status !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    membershipStore.state.memberships = [];
    for (let attempt = 0; attempt < 40 && fx.privateData.job('alpha', id)?.status !== 'cancelled'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const job = fx.privateData.job('alpha', id);
    assert.equal(job.status, 'cancelled');
    assert.equal(job.result, null);
  } finally { await fx.close(); }
});
