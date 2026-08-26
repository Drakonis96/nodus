import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';

async function api(origin, cookie, csrf, pathname, method = 'GET', value) {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: {
      cookie,
      ...(csrf ? { origin, 'x-csrf-token': csrf } : {}),
      ...(value !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
  });
}

test('credentials, conversations and preferences are strictly isolated by authenticated user', async () => {
  await withServer({ label: 'multi-user-ai', ai: true }, async (ctx) => {
    const spaceId = await ctx.createSpace('Shared vault');
    const alpha = await ctx.createUser('alpha@example.test', 'alpha-user-password-long', [{ spaceId, role: 'writer' }]);
    const beta = await ctx.createUser('beta@example.test', 'beta-user-password-long', [{ spaceId, role: 'writer' }]);
    const alphaCookie = await ctx.signIn(alpha.email, alpha.password);
    const betaCookie = await ctx.signIn(beta.email, beta.password);
    const alphaCsrf = await ctx.csrf(alphaCookie);
    const betaCsrf = await ctx.csrf(betaCookie);
    const alphaSecret = 'sk-alpha-super-secret-1234567890';
    const betaSecret = 'sk-beta-super-secret-0987654321';

    const storedAlpha = await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/ai/credentials/openai', 'PUT', { apiKey: alphaSecret, userId: 'forged-beta' });
    assert.equal(storedAlpha.status, 200);
    const alphaMeta = await storedAlpha.json();
    assert.equal(alphaMeta.provider, 'openai');
    assert.equal(alphaMeta.configured, true);
    assert.equal(Object.hasOwn(alphaMeta, 'apiKey'), false);

    const storedBeta = await api(ctx.origin, betaCookie, betaCsrf, '/api/v2/me/ai/credentials/anthropic', 'PUT', { apiKey: betaSecret });
    assert.equal(storedBeta.status, 200);
    assert.equal(Object.hasOwn(await storedBeta.json(), 'apiKey'), false);

    const alphaProviders = await (await api(ctx.origin, alphaCookie, null, '/api/v2/me/ai/providers')).json();
    const betaProviders = await (await api(ctx.origin, betaCookie, null, '/api/v2/me/ai/providers')).json();
    assert.equal(alphaProviders.providers.find((entry) => entry.provider === 'openai').configured, true);
    assert.equal(alphaProviders.providers.find((entry) => entry.provider === 'anthropic').configured, false);
    assert.equal(betaProviders.providers.find((entry) => entry.provider === 'openai').configured, false);
    assert.equal(betaProviders.providers.find((entry) => entry.provider === 'anthropic').configured, true);

    const adminProviders = await (await api(ctx.origin, ctx.adminCookie, null, '/api/v2/me/ai/providers')).json();
    assert.equal(adminProviders.providers.every((entry) => entry.configured === false), true, 'server admin sees only their own credential metadata');

    const credentialFile = await fs.readFile(path.join(ctx.root, 'private', 'ai-credentials.json'), 'utf8');
    assert.equal(credentialFile.includes(alphaSecret), false);
    assert.equal(credentialFile.includes(betaSecret), false);

    const created = await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/conversations', 'POST', { vaultId: spaceId, title: 'Alpha private chat' });
    assert.equal(created.status, 201);
    const alphaConversation = (await created.json()).conversation;
    assert.equal(alphaConversation.ownerUserId.length > 0, true);

    const alphaRead = await api(ctx.origin, alphaCookie, null, `/api/v2/me/conversations/${alphaConversation.id}`);
    assert.equal(alphaRead.status, 200);
    const betaIdor = await api(ctx.origin, betaCookie, null, `/api/v2/me/conversations/${alphaConversation.id}`);
    assert.equal(betaIdor.status, 404);
    const adminIdor = await api(ctx.origin, ctx.adminCookie, null, `/api/v2/me/conversations/${alphaConversation.id}`);
    assert.equal(adminIdor.status, 404);

    const state = await ctx.readState();
    const alphaUserId = state.users.find((entry) => entry.email === alpha.email).id;
    await ctx.revokeAccess(alphaUserId, spaceId);
    assert.equal((await api(ctx.origin, alphaCookie, null, `/api/v2/me/conversations/${alphaConversation.id}`)).status, 404, 'revoked members cannot retain conversation access through an old session');
    const afterRevocation = await (await api(ctx.origin, alphaCookie, null, `/api/v2/me/conversations?vaultId=${spaceId}`)).json();
    assert.deepEqual(afterRevocation.conversations, [], 'conversation listings omit revoked vaults');

    const embeddingPreference = await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/ai/preferences', 'PATCH', { embeddingModel: 'text-embedding-other' });
    assert.equal(embeddingPreference.status, 400);
    assert.equal((await embeddingPreference.json()).error, 'embedding_model_locked');

    const forgedWithoutCsrf = await api(ctx.origin, alphaCookie, null, '/api/v2/me/ai/credentials/openai', 'DELETE');
    assert.equal(forgedWithoutCsrf.status, 403);
  });
});

test('device credentials cannot escape the vault they were issued for', async () => {
  await withServer({ label: 'device-vault-ai-boundary', ai: true }, async (ctx) => {
    const vaultA = await ctx.createSpace('Vault A');
    const vaultB = await ctx.createSpace('Vault B');
    const member = await ctx.createUser('device-bound@example.test', 'device-bound-password-long', [
      { spaceId: vaultA, role: 'writer' }, { spaceId: vaultB, role: 'writer' },
    ]);
    const cookie = await ctx.signIn(member.email, member.password);
    const csrf = await ctx.csrf(cookie);
    const created = await api(ctx.origin, cookie, csrf, '/api/v2/me/conversations', 'POST', { vaultId: vaultB, title: 'Vault B private conversation' });
    assert.equal(created.status, 201);
    const conversation = (await created.json()).conversation;

    const deviceA = await ctx.deviceToken(member.email, member.password, vaultA);
    const deviceB = await ctx.deviceToken(member.email, member.password, vaultB);
    assert.equal((await ctx.api(deviceA.deviceToken, 'GET', `/api/v2/me/conversations/${conversation.id}`)).status, 404);
    const listedA = await (await ctx.api(deviceA.deviceToken, 'GET', '/api/v2/me/conversations')).json();
    assert.deepEqual(listedA.conversations, []);
    assert.equal((await ctx.api(deviceB.deviceToken, 'GET', `/api/v2/me/conversations/${conversation.id}`)).status, 200);
  });
});
