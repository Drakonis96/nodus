import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { extractServerProfilePreferences } from '../../shared/serverProfilePreferences.mjs';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';

function desktopSettings(overrides = {}) {
  return {
    theme: 'light', uiLanguage: 'es', promptLanguage: 'es', animationSpeed: 0.8, interfaceScale: 1.1,
    accessibleFont: true, highContrast: false, reduceMotion: true, readingFocusMode: false,
    mascotEnabled: true, mascotScale: 1, mascotVaultCostumes: true, mascotStyle: 'classic',
    mascotOrbColorMode: 'auto', mascotOrbColor: '#6366f1',
    favorites: [{ provider: 'openai', model: 'gpt-5.4' }, { provider: 'anthropic', model: 'claude-sonnet-4-5' }],
    modelSettingsMode: 'advanced', modelSettingsVersion: 3,
    synthesisModel: { provider: 'openai', model: 'gpt-5.4' },
    chatModel: { provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'medium' },
    nodiModel: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    deepResearchModel: { provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'high' },
    dictionaryModel: { provider: 'openai', model: 'gpt-5.4' },
    authorModel: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    chatReasoning: 'medium', codexReasoningEfforts: { 'gpt-5.4': 'high' }, openRouterThroughput: true,
    providerFreeTier: { groq: true }, imageProvider: 'openai', imageModel: 'gpt-image-1',
    imageQuality: 'balanced', imageStyle: 'antique_book', audioProvider: 'piper', audioVoice: '', audioSpeed: 1,
    studyAiEnabled: true, studyAiPrivacyMode: 'hybrid', studyAiConfirmExternal: true,
    studyAiMonthlyBudgetUsd: 25, studyAiBudgetWarningPercent: 80, studyAiMaxInputChars: 120000,
    studyAiMaxOutputTokens: 4000, studyAiTemperature: 0.15, studyAiRetryCount: 1,
    studentPseudonymsEnabled: true, sidebarOrder: ['home', 'ideas'], sidebarHidden: ['tools'],
    sidebarCustomized: true, concurrency: 2, deepContextMode: 'standard', deepStandardChunkWords: 1800,
    deepLongChunkWords: 30000,
    // These values prove that the exporter is an allowlist rather than a broad object copy.
    providerKeys: { openai: true }, lockedProviderKeys: ['openai'], embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-large', mcpToken: 'mcp-secret-never-upload',
    copilotToken: 'copilot-secret-never-upload', browserConnectorToken: 'browser-secret-never-upload',
    localProviders: { ollama: { baseUrl: 'http://private-lan.invalid:11434' } },
    autoBackupFolder: '/private/backups', legacyApiKey: 'sk-desktop-secret-never-upload',
    ...overrides,
  };
}

async function sessionApi(origin, cookie, csrf, pathname, method = 'GET', value) {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: {
      cookie,
      ...(csrf ? { origin, 'x-csrf-token': csrf } : {}),
      ...(value === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

test('Desktop profile preferences persist per user without secrets or embedding configuration', async () => {
  const portable = extractServerProfilePreferences(desktopSettings());
  const serialized = JSON.stringify(portable);
  for (const forbidden of ['sk-desktop-secret-never-upload', 'mcp-secret-never-upload', 'private-lan.invalid', '/private/backups', 'text-embedding-3-large']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} crossed the portable profile boundary`);
  }
  assert.equal(portable.ai.models.assistant.model, 'gpt-5.4');
  assert.equal(portable.appearance.interfaceScale, 1.1);

  await withServer({ label: 'user-profile-preferences', ai: true }, async (ctx) => {
    const spaceId = await ctx.createSpace('Shared preferences vault');
    const alpha = await ctx.createUser('profile-alpha@example.test', 'profile-alpha-password-long', [{ spaceId, role: 'reader' }]);
    const beta = await ctx.createUser('profile-beta@example.test', 'profile-beta-password-long', [{ spaceId, role: 'reader' }]);
    const alphaDevice = await ctx.deviceToken(alpha.email, alpha.password, spaceId, 'Alpha Desktop');
    const betaDevice = await ctx.deviceToken(beta.email, beta.password, spaceId, 'Beta Desktop');

    const stored = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: portable });
    assert.equal(stored.status, 200);
    const first = await stored.json();
    assert.equal(first.unchanged, false);
    assert.equal(first.profile.revision, 1);
    assert.deepEqual(first.profile.source, { kind: 'desktop' });
    assert.equal(Object.hasOwn(first.profile, 'sourceDigests'), false, 'device hashes are private storage metadata');

    const alphaProfile = await (await ctx.api(alphaDevice.deviceToken, 'GET', '/api/v2/me/preferences')).json();
    assert.equal(alphaProfile.profile.values.ai.models.nodi.model, 'claude-sonnet-4-5');
    const alphaAI = await (await ctx.api(alphaDevice.deviceToken, 'GET', '/api/v2/me/ai/preferences')).json();
    assert.equal(alphaAI.preferences.defaultProvider, 'openai');
    assert.equal(alphaAI.preferences.chatModels.openai, 'gpt-5.4');
    assert.equal(alphaAI.preferences.featureModels.deepResearch.model, 'gpt-5.4');

    const betaProfile = await (await ctx.api(betaDevice.deviceToken, 'GET', '/api/v2/me/preferences')).json();
    assert.equal(betaProfile.profile.revision, 0, 'another user cannot inherit or observe Alpha preferences');
    assert.equal(betaProfile.profile.values, null);

    const forgedOwner = await ctx.api(betaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: { ...portable, userId: 'forged-alpha-user' } });
    assert.equal(forgedOwner.status, 400);
    assert.equal((await forgedOwner.json()).error, 'invalid_profile_preferences');

    const secret = 'sk-forged-profile-secret-123456789';
    const secretAttempt = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: { ...portable, apiKey: secret } });
    assert.equal(secretAttempt.status, 400);
    assert.equal((await secretAttempt.json()).error, 'secret_preferences_forbidden');
    const nestedSecretProfile = structuredClone(portable);
    nestedSecretProfile.ai.models.assistant = { provider: 'openai', model: secret };
    const nestedSecretAttempt = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: nestedSecretProfile });
    assert.equal(nestedSecretAttempt.status, 400);
    assert.equal((await nestedSecretAttempt.json()).error, 'secret_preferences_forbidden');
    const embeddingAttempt = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: { ...portable, embeddingModel: 'forged-embedding' } });
    assert.equal(embeddingAttempt.status, 400);
    assert.equal((await embeddingAttempt.json()).error, 'embedding_model_locked');

    // An unchanged Desktop restart is idempotent and must not undo a later Web choice.
    const alphaCookie = await ctx.signIn(alpha.email, alpha.password);
    const alphaCsrf = await ctx.csrf(alphaCookie);
    const manual = await sessionApi(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/ai/preferences', 'PATCH', {
      defaultProvider: 'anthropic', chatModels: { anthropic: 'claude-server-choice' },
    });
    assert.equal(manual.status, 200);
    const repeated = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: portable });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).unchanged, true);
    const preserved = await (await ctx.api(alphaDevice.deviceToken, 'GET', '/api/v2/me/ai/preferences')).json();
    assert.equal(preserved.preferences.defaultProvider, 'anthropic');
    assert.equal(preserved.preferences.chatModels.anthropic, 'claude-server-choice');

    // A genuine Desktop model change advances provenance and becomes the new Server default.
    const changed = structuredClone(portable);
    changed.ai.models.assistant = { provider: 'openai', model: 'gpt-5.6' };
    const updated = await ctx.api(alphaDevice.deviceToken, 'PUT', '/api/v2/me/preferences', { json: changed });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).profile.revision, 2);
    const inheritedAI = await (await ctx.api(alphaDevice.deviceToken, 'GET', '/api/v2/me/ai/preferences')).json();
    assert.equal(inheritedAI.preferences.defaultProvider, 'openai');
    assert.equal(inheritedAI.preferences.chatModels.openai, 'gpt-5.6');

    const state = await ctx.readState();
    const alphaId = state.users.find((entry) => entry.email === alpha.email).id;
    const privateFile = await fs.readFile(path.join(ctx.root, 'private', 'users', alphaId, 'private.json'), 'utf8');
    assert.equal(privateFile.includes(secret), false);
    assert.equal(privateFile.includes('text-embedding-3-large'), false);
    assert.equal(privateFile.includes('private-lan.invalid'), false);
    assert.equal(privateFile.includes('gpt-5.6'), true, 'portable preferences are durable per user');
  });
});
