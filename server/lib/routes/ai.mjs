import { can } from '../roles.mjs';
import { createHash } from 'node:crypto';
import { SERVER_AI_PROVIDERS, supportedCapability, supportedProvider } from '../ai/providerGateway.mjs';
import { redactStructured, redactText } from '../ai/redact.mjs';
import { createEmbeddingContract, fingerprintEmbeddingContract } from '../core/embeddingContract.mjs';
import {
  aiPreferencesFromServerProfile,
  sanitizeServerProfilePreferences,
} from '../../../shared/serverProfilePreferences.mjs';

const JSON_LIMIT = 2 * 1024 * 1024;
const PROVIDER_NAMES = Object.freeze(Object.keys(SERVER_AI_PROVIDERS));

function providerId(value) { return String(value || '').trim().toLowerCase(); }

/** Per-user AI/profile API shared by Web and Desktop. No route accepts a user id. */
export function createAIRoutes({
  authorize, json, jsonBody, publicUrl, aiStore, privateData, gateway, store, rateLimit,
  maxActiveJobsPerUser = 4, maxActiveJobsGlobal = 32,
}) {
  const cancelled = new Set();
  const activeControllers = new Map();
  const activeRunTokens = new Map();
  const scheduled = new Set();
  const activeEmbeddings = new Map();

  function scheduledForUser(userId) {
    const prefix = `${userId}:`;
    return [...scheduled].filter((key) => key.startsWith(prefix)).length;
  }

  function embeddingsForUser(userId) {
    return Number(activeEmbeddings.get(userId) || 0);
  }

  function totalEmbeddings() {
    return [...activeEmbeddings.values()].reduce((sum, count) => sum + Number(count || 0), 0);
  }

  function publicJob(job) {
    if (!job) return null;
    const { request: _request, ...safe } = job;
    return safe;
  }

  function ownedJob(userId, id) {
    try { return privateData.job(userId, id); } catch { return null; }
  }

  function canStillReadVault(userId, vaultId) {
    if (vaultId == null || !store?.state) return true;
    return (store.state.memberships ?? []).some((entry) => entry.userId === userId && entry.spaceId === vaultId);
  }

  function principalCanReadVault(auth, vaultId) {
    if (auth.device && String(auth.device.spaceId) !== String(vaultId || '')) return false;
    return canStillReadVault(auth.user.id, vaultId);
  }

  function enqueue(userId, id) {
    const scheduledKey = `${userId}:${id}`;
    if (scheduled.has(scheduledKey)) return;
    scheduled.add(scheduledKey);
    queueMicrotask(async () => {
      const initial = ownedJob(userId, id);
      const runToken = initial ? `${userId}:${id}:${initial.attempt}` : '';
      if (!initial || initial.status !== 'queued' || cancelled.has(`${userId}:${id}`) || cancelled.has(runToken)) {
        scheduled.delete(scheduledKey); return;
      }
      if (!canStillReadVault(userId, initial.vaultId)) {
        privateData.updateJob(userId, id, { status: 'cancelled', result: null, error: null });
        scheduled.delete(scheduledKey); return;
      }
      const started = privateData.updateJob(userId, id, { status: 'running' });
      if (!started || started.status !== 'running') { scheduled.delete(scheduledKey); return; }
      const controller = new AbortController();
      const key = `${userId}:${id}`;
      activeRunTokens.set(key, runToken);
      activeControllers.set(key, controller);
      const membershipMonitor = setInterval(() => {
        if (!canStillReadVault(userId, initial.vaultId)) {
          cancelled.add(runToken);
          controller.abort(new Error('Vault access was revoked.'));
        }
      }, 250);
      membershipMonitor.unref?.();
      try {
        const request = initial.request || {};
        const result = await gateway.chat({
          userId, provider: initial.provider, model: initial.model,
          messages: request.messages, maxTokens: request.maxTokens, signal: controller.signal,
        });
        // A cancellation may have arrived while the provider request was in flight. Never let
        // its late response resurrect a cancelled or deleted job.
        const current = ownedJob(userId, id);
        if (current?.status === 'running' && current.attempt === initial.attempt && canStillReadVault(userId, initial.vaultId) && !cancelled.has(runToken)) {
          privateData.updateJob(userId, id, { status: 'completed', result: redactStructured(result), error: null });
        }
      } catch (error) {
        const current = ownedJob(userId, id);
        if (current?.status === 'running' && current.attempt === initial.attempt && (controller.signal.aborted || !canStillReadVault(userId, initial.vaultId))) {
          privateData.updateJob(userId, id, { status: 'cancelled', result: null, error: null });
        } else if (current?.status === 'running' && current.attempt === initial.attempt && !cancelled.has(runToken)) {
          privateData.updateJob(userId, id, {
            status: 'failed', result: null,
            error: { code: 'provider_error', message: redactText(String(error?.message || 'Provider request failed.')).slice(0, 500) },
          });
        }
      } finally {
        clearInterval(membershipMonitor);
        if (activeRunTokens.get(key) === runToken) {
          activeRunTokens.delete(key);
          activeControllers.delete(key);
        }
        cancelled.delete(runToken);
        scheduled.delete(scheduledKey);
        if (ownedJob(userId, id)?.status === 'queued') queueMicrotask(() => enqueue(userId, id));
      }
    });
  }

  function unavailable(res) {
    json(res, 503, { error: 'ai_credentials_unavailable', error_description: 'Server AI is disabled until an external key-encryption keyring is configured.' });
    return true;
  }

  function sameOrigin(req, res, auth) {
    if (auth.principal.kind !== 'session') return true;
    let origin = String(req.headers.origin || '');
    if (!origin) { try { origin = new URL(String(req.headers.referer || '')).origin; } catch { origin = ''; } }
    const csrf = String(req.headers['x-csrf-token'] || req.headers['x-csrf'] || '');
    if (origin !== new URL(publicUrl()).origin || csrf !== String(auth.principal.session?.csrf || '')) {
      json(res, 403, { error: 'csrf_failed' }); return false;
    }
    return true;
  }

  function me(req, res, { mutation = false, via = ['session', 'device', 'oauth'] } = {}) {
    const auth = authorize(req, res, { via, resource: 'api', scope: mutation ? 'materials.write' : 'materials.read' });
    if (!auth || (mutation && !sameOrigin(req, res, auth))) return null;
    return auth;
  }

  function providerMetadata(userId) {
    const configured = new Map((aiStore?.listUserCredentials(userId) ?? []).map((entry) => [entry.provider, entry]));
    return PROVIDER_NAMES.map((provider) => ({
      provider, configured: configured.has(provider), updatedAt: configured.get(provider)?.updatedAt ?? null,
      supportsEmbeddings: Boolean(SERVER_AI_PROVIDERS[provider].embeddings),
    }));
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/v2/')) return false;
    let segments;
    try { segments = url.pathname.split('/').filter(Boolean).map((value) => decodeURIComponent(value)); }
    catch { json(res, 400, { error: 'bad_path' }); return true; }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'preferences' && !segments[4]) {
      const auth = me(req, res, { mutation: req.method === 'PUT' }); if (!auth) return true;
      if (req.method === 'GET') {
        json(res, 200, { profile: privateData.profilePreferences(auth.user.id) }); return true;
      }
      if (req.method === 'PUT') {
        const input = await jsonBody(req, 128 * 1024);
        let values;
        try { values = sanitizeServerProfilePreferences(input); }
        catch (error) {
          const code = error?.code === 'embedding_model_locked' || error?.code === 'secret_preferences_forbidden'
            ? error.code
            : error?.code === 'unsupported_profile_preferences_version'
              ? error.code
              : 'invalid_profile_preferences';
          json(res, 400, { error: code }); return true;
        }
        const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
        const sourceKind = auth.principal.kind === 'device' ? 'desktop' : auth.principal.kind === 'session' ? 'server-web' : 'api';
        const aiPatch = aiPreferencesFromServerProfile(values, PROVIDER_NAMES);
        const result = privateData.setProfilePreferences(auth.user.id, values, {
          sourceKind,
          // Principal ids are hashes generated by the server. No client-supplied user,
          // device or owner identifier participates in preference ownership/provenance.
          sourceId: `${auth.principal.kind}:${auth.principal.id}`,
          digest,
          aiPatch,
        });
        json(res, 200, result); return true;
      }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'ai' && segments[4] === 'providers' && !segments[5]) {
      const auth = me(req, res); if (!auth) return true;
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      json(res, 200, { providers: providerMetadata(auth.user.id), credentialsAvailable: Boolean(aiStore) }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'ai' && segments[4] === 'providers' && segments[5] && segments[6] === 'models' && !segments[7]) {
      const auth = me(req, res); if (!auth) return true;
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const provider = providerId(segments[5]);
      if (!supportedProvider(provider)) { json(res, 404, { error: 'unsupported_provider' }); return true; }
      try {
        const models = await gateway.listModels({ userId: auth.user.id, provider });
        json(res, 200, { provider, models, source: 'live' });
      } catch (error) {
        const status = Number(error?.statusCode) || (String(error?.message || '').includes('No credential') ? 409 : 502);
        json(res, status, { error: status === 409 ? 'credential_required' : 'provider_catalog_error', error_description: redactText(String(error?.message || 'The provider model catalogue is unavailable.')).slice(0, 500) });
      }
      return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'ai' && segments[4] === 'credentials' && segments[5]) {
      const provider = providerId(segments[5]);
      if (!supportedProvider(provider)) { json(res, 404, { error: 'unsupported_provider' }); return true; }
      // Secrets may only be managed from an authenticated browser profile. OAuth and paired
      // devices can use a configured key, but cannot replace it without the user's session.
      const auth = me(req, res, { mutation: req.method !== 'GET', via: ['session'] }); if (!auth) return true;
      if (!aiStore) return unavailable(res);
      if (req.method === 'GET') {
        const meta = aiStore.getUserCredential(auth.user.id, provider);
        json(res, 200, { provider, configured: Boolean(meta), updatedAt: meta?.updatedAt ?? null }); return true;
      }
      if (req.method === 'PUT') {
        const input = await jsonBody(req, 32 * 1024);
        if (typeof input.apiKey !== 'string' || input.apiKey.trim().length < 8 || input.apiKey.length > 16_384) {
          json(res, 400, { error: 'invalid_credential' }); return true;
        }
        const meta = aiStore.setUserCredential(auth.user.id, provider, { apiKey: input.apiKey.trim() });
        json(res, 200, { provider, configured: true, updatedAt: meta.updatedAt }); return true;
      }
      if (req.method === 'DELETE') {
        aiStore.removeUserCredential(auth.user.id, provider);
        json(res, 200, { provider, configured: false }); return true;
      }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'ai' && segments[4] === 'preferences') {
      const auth = me(req, res, { mutation: req.method === 'PATCH' }); if (!auth) return true;
      if (req.method === 'GET') { json(res, 200, { preferences: privateData.aiPreferences(auth.user.id) }); return true; }
      if (req.method === 'PATCH') {
        const input = await jsonBody(req, 64 * 1024);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          json(res, 400, { error: 'invalid_preferences' }); return true;
        }
        if (Object.keys(input).some((key) => /embed/i.test(key))) {
          json(res, 400, { error: 'embedding_model_locked', error_description: 'Embedding configuration belongs to the vault index and cannot be a user preference.' }); return true;
        }
        if (Object.keys(input).some((key) => !['defaultProvider', 'chatModels'].includes(key))) {
          json(res, 400, { error: /key|token|secret|password|credential/i.test(Object.keys(input).join(' ')) ? 'secret_preferences_forbidden' : 'invalid_preferences' }); return true;
        }
        const patch = {};
        if (input.defaultProvider !== undefined) {
          const provider = providerId(input.defaultProvider);
          if (!supportedProvider(provider)) { json(res, 400, { error: 'unsupported_provider' }); return true; }
          patch.defaultProvider = provider;
        }
        if (input.chatModels !== undefined) {
          if (!input.chatModels || typeof input.chatModels !== 'object' || Array.isArray(input.chatModels)) { json(res, 400, { error: 'invalid_preferences' }); return true; }
          const entries = Object.entries(input.chatModels);
          if (entries.length > PROVIDER_NAMES.length || entries.some(([provider, model]) => (
            !supportedProvider(provider) || typeof model !== 'string' || !model.trim() || model.length > 200 || /[\u0000\r\n]/.test(model)
          ))) { json(res, 400, { error: 'invalid_preferences' }); return true; }
          patch.chatModels = Object.fromEntries(entries.map(([provider, model]) => [provider, model.trim()]));
        }
        json(res, 200, { preferences: privateData.setAIPreferences(auth.user.id, patch) }); return true;
      }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'conversations') {
      const id = segments[4] || null;
      const auth = me(req, res, { mutation: !['GET', 'HEAD'].includes(req.method) }); if (!auth) return true;
      if (!id && req.method === 'GET') { json(res, 200, { conversations: privateData.conversations(auth.user.id).filter((entry) => principalCanReadVault(auth, entry.vaultId)) }); return true; }
      if (!id && req.method === 'POST') {
        const input = await jsonBody(req, 64 * 1024);
        const vaultId = input.vaultId || auth.device?.spaceId || null;
        if (vaultId) {
          const vaultAuth = authorize(req, res, { spaceId: String(vaultId), need: 'read', via: [auth.principal.kind], resource: 'api', scope: 'materials.read' });
          if (!vaultAuth) return true;
        }
        if (auth.device && !vaultId) { json(res, 400, { error: 'vault_required' }); return true; }
        json(res, 201, { conversation: privateData.createConversation(auth.user.id, { ...input, vaultId }) }); return true;
      }
      const conversation = id ? privateData.conversation(auth.user.id, id) : null;
      // Ownership failures intentionally look exactly like unknown identifiers (IDOR).
      if (!conversation || !principalCanReadVault(auth, conversation.vaultId)) { json(res, 404, { error: 'conversation_not_found' }); return true; }
      if (req.method === 'GET') { json(res, 200, { conversation }); return true; }
      if (req.method === 'POST' && segments[5] === 'messages') {
        const input = await jsonBody(req, JSON_LIMIT);
        json(res, 201, { conversation: privateData.appendMessage(auth.user.id, id, input) }); return true;
      }
      if (req.method === 'DELETE') { privateData.removeConversation(auth.user.id, id); json(res, 200, { ok: true }); return true; }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'me' && segments[3] === 'jobs') {
      const id = segments[4] || null;
      const mutation = req.method !== 'GET' && req.method !== 'HEAD';
      const auth = me(req, res, { mutation }); if (!auth) return true;
      if (req.method === 'GET') {
        if (!id) { json(res, 200, { jobs: privateData.jobs(auth.user.id).filter((entry) => principalCanReadVault(auth, entry.vaultId)).map(publicJob) }); return true; }
        const job = ownedJob(auth.user.id, id);
        if (!job || !principalCanReadVault(auth, job.vaultId)) { json(res, 404, { error: 'job_not_found' }); return true; }
        json(res, 200, { job: publicJob(job) }); return true;
      }
      if (!id) { json(res, 405, { error: 'method_not_allowed' }); return true; }
      if (req.method === 'DELETE') {
        const job = ownedJob(auth.user.id, id);
        if (!job || !principalCanReadVault(auth, job.vaultId) || !privateData.deleteJob(auth.user.id, id)) { json(res, 404, { error: 'job_not_found' }); return true; }
        cancelled.add(`${auth.user.id}:${id}`);
        const activeToken = activeRunTokens.get(`${auth.user.id}:${id}`);
        if (activeToken) cancelled.add(activeToken);
        activeControllers.get(`${auth.user.id}:${id}`)?.abort(new Error('Job deleted.'));
        json(res, 200, { ok: true }); return true;
      }
      if (req.method === 'POST' && segments[5] === 'cancel') {
        const job = ownedJob(auth.user.id, id);
        if (!job || !principalCanReadVault(auth, job.vaultId)) { json(res, 404, { error: 'job_not_found' }); return true; }
        if (!['queued', 'running'].includes(job.status)) { json(res, 409, { error: 'job_not_active' }); return true; }
        cancelled.add(`${auth.user.id}:${id}`);
        const activeToken = activeRunTokens.get(`${auth.user.id}:${id}`);
        if (activeToken) cancelled.add(activeToken);
        activeControllers.get(`${auth.user.id}:${id}`)?.abort(new Error('Job cancelled.'));
        const updated = privateData.updateJob(auth.user.id, id, { status: 'cancelled', result: null });
        json(res, 200, { job: publicJob(updated) }); return true;
      }
      if (req.method === 'POST' && segments[5] === 'retry') {
        const job = ownedJob(auth.user.id, id);
        if (!job || !principalCanReadVault(auth, job.vaultId)) { json(res, 404, { error: 'job_not_found' }); return true; }
        if (!['failed', 'cancelled'].includes(job.status)) { json(res, 409, { error: 'job_not_retryable' }); return true; }
        // Older attempts retain their token until their provider promise unwinds. The new
        // attempt has a distinct token, so a late response can never settle the retry.
        cancelled.delete(`${auth.user.id}:${id}`);
        const updated = privateData.updateJob(auth.user.id, id, { status: 'queued', result: null, error: null, attempt: (job.attempt || 1) + 1 });
        enqueue(auth.user.id, id);
        json(res, 202, { job: publicJob(updated) }); return true;
      }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'vaults' && segments[3] && segments[4] === 'embedding-contracts') {
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const auth = authorize(req, res, { spaceId: segments[3], need: 'read', via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.read' });
      if (!auth) return true;
      json(res, 200, { vaultId: auth.space.id, indexes: auth.space.embeddingContracts ?? {} }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'vaults' && segments[3] && segments[4] === 'embeddings' && segments[5]) {
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const auth = authorize(req, res, { spaceId: segments[3], need: 'read', via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.write' });
      if (!auth || !sameOrigin(req, res, auth)) return true;
      if (!aiStore || !gateway) return unavailable(res);
      if (rateLimit && !rateLimit(req, res, 'ai-embeddings-user', 60, 60_000, auth.user.id)) return true;
      const userEmbeddingCalls = embeddingsForUser(auth.user.id);
      if (scheduledForUser(auth.user.id) + userEmbeddingCalls >= maxActiveJobsPerUser
        || scheduled.size + totalEmbeddings() >= maxActiveJobsGlobal) {
        json(res, 429, { error: 'ai_concurrency_limit', error_description: 'Wait for an active AI operation to finish before starting another.' }, { 'retry-after': '5' }); return true;
      }
      const locked = auth.space.embeddingContracts?.[segments[5]];
      if (!locked?.contract) { json(res, 409, { error: 'embedding_index_missing' }); return true; }
      let contract;
      try { contract = createEmbeddingContract(locked.contract); } catch { json(res, 409, { error: 'embedding_contract_invalid' }); return true; }
      if (contract.protocol === 'legacy_locked') {
        json(res, 409, { error: 'embedding_contract_ambiguous', error_description: 'This legacy index lacks enough metadata to generate provably compatible vectors. Rebuild it explicitly with a full contract.' }); return true;
      }
      if (!aiStore.getUserCredential(auth.user.id, contract.provider)) { json(res, 409, { error: 'credential_required', provider: contract.provider }); return true; }
      const input = await jsonBody(req, JSON_LIMIT);
      const texts = (Array.isArray(input.inputs) ? input.inputs : []).slice(0, 128).map((value) => String(value).slice(0, 32_000));
      if (!texts.length) { json(res, 400, { error: 'inputs_required' }); return true; }
      activeEmbeddings.set(auth.user.id, userEmbeddingCalls + 1);
      let output;
      try { output = await gateway.embeddings({ userId: auth.user.id, provider: contract.provider, contract, inputs: texts }); }
      finally {
        const remaining = Number(activeEmbeddings.get(auth.user.id) || 1) - 1;
        if (remaining > 0) activeEmbeddings.set(auth.user.id, remaining); else activeEmbeddings.delete(auth.user.id);
      }
      const vectors = Array.isArray(output?.data) ? output.data.map((entry) => entry.embedding)
        : Array.isArray(output?.embeddings?.float) ? output.embeddings.float
          : Array.isArray(output?.embeddings) ? output.embeddings.map((entry) => entry.values ?? entry)
            : [];
      if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== contract.dim || !vector.every(Number.isFinite))) {
        json(res, 502, { error: 'embedding_shape_mismatch' }); return true;
      }
      json(res, 200, { vectors, contract, fingerprint: fingerprintEmbeddingContract(contract) }); return true;
    }

    if (segments[1] === 'v2' && segments[2] === 'vaults' && segments[3] && segments[4] === 'ai' && segments[5]) {
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const capability = String(segments[5]);
      if (!supportedCapability(capability)) { json(res, 404, { error: 'unknown_ai_capability' }); return true; }
      const auth = authorize(req, res, { spaceId: segments[3], need: 'read', via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.write' });
      if (!auth || !sameOrigin(req, res, auth)) return true;
      if (!aiStore || !gateway) return unavailable(res);
      if (rateLimit && !rateLimit(req, res, 'ai-jobs-user', 60, 60_000, auth.user.id)) return true;
      if (scheduledForUser(auth.user.id) + embeddingsForUser(auth.user.id) >= maxActiveJobsPerUser) {
        json(res, 429, { error: 'ai_concurrency_limit', error_description: 'Wait for an active AI job to finish before starting another.' }, { 'retry-after': '5' }); return true;
      }
      if (scheduled.size + totalEmbeddings() >= maxActiveJobsGlobal) {
        json(res, 503, { error: 'ai_capacity_reached', error_description: 'The server AI queue is temporarily full.' }, { 'retry-after': '5' }); return true;
      }
      const input = await jsonBody(req, JSON_LIMIT);
      const preferences = privateData.aiPreferences(auth.user.id);
      const provider = providerId(input.provider || preferences.defaultProvider);
      const model = String(input.model || preferences.chatModels?.[provider] || '');
      if (!supportedProvider(provider) || !model) { json(res, 400, { error: 'ai_configuration_required' }); return true; }
      if (model.length > 200 || /[\u0000\r\n]/.test(model)) { json(res, 400, { error: 'invalid_model' }); return true; }
      if (!aiStore.getUserCredential(auth.user.id, provider)) { json(res, 409, { error: 'credential_required', provider }); return true; }
      const messages = (Array.isArray(input.messages) ? input.messages : []).slice(-100).map((entry) => ({
        role: ['system', 'assistant'].includes(entry?.role) ? entry.role : 'user',
        content: String(entry?.content || '').slice(0, 1_000_000),
      }));
      const job = privateData.createJob(auth.user.id, {
        // userId is deliberately taken only from the authenticated principal. Any input.userId
        // is ignored, including a forged value sent alongside an otherwise valid request.
        userId: auth.user.id, vaultId: auth.space.id, capability, provider, model,
        request: redactStructured({ messages, maxTokens: input.maxTokens }),
      });
      enqueue(auth.user.id, job.id);
      json(res, 202, { job: publicJob(job) }); return true;
    }

    json(res, 404, { error: 'not_found' }); return true;
  }

  return { handle, providerMetadata };
}
