import { redactStructured, redactText } from './redact.mjs';

const CAPABILITIES = new Set([
  'assistant', 'nodi', 'content-query', 'deep-research', 'database-deep-research', 'dictionary', 'idea-analysis',
  'relation-generation', 'author-tools', 'argument-map', 'academic', 'database', 'teaching', 'study',
]);

// Provider responses are persisted in the per-user job store after redaction. Keep the
// upstream response bounded before it is materialised as a string, both to protect the
// event loop and to prevent a faulty provider from turning a private job into an unbounded
// disk write.
export const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;

export const SERVER_AI_PROVIDERS = Object.freeze({
  openai: { chat: 'https://api.openai.com/v1/responses', embeddings: 'https://api.openai.com/v1/embeddings', models: 'https://api.openai.com/v1/models' },
  openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions', embeddings: 'https://openrouter.ai/api/v1/embeddings', models: 'https://openrouter.ai/api/v1/models' },
  anthropic: { chat: 'https://api.anthropic.com/v1/messages', models: 'https://api.anthropic.com/v1/models?limit=1000' },
  gemini: { chat: 'https://generativelanguage.googleapis.com/v1beta/models', embeddings: 'https://generativelanguage.googleapis.com/v1beta/models', models: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' },
  mistral: { chat: 'https://api.mistral.ai/v1/chat/completions', embeddings: 'https://api.mistral.ai/v1/embeddings', models: 'https://api.mistral.ai/v1/models' },
  cohere: { chat: 'https://api.cohere.com/v2/chat', embeddings: 'https://api.cohere.com/v2/embed', models: 'https://api.cohere.com/v1/models?endpoint=chat' },
});

export function supportedCapability(value) { return CAPABILITIES.has(String(value)); }
export function supportedProvider(value) { return Object.hasOwn(SERVER_AI_PROVIDERS, String(value)); }

function apiKey(credential) {
  const value = typeof credential === 'string' ? credential : credential?.apiKey;
  if (typeof value !== 'string' || value.length < 8 || value.length > 16_384) throw new Error('The provider credential is invalid.');
  return value;
}

async function responseText(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Provider response exceeds the server safety limit.');
  if (!response.body) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      try { await response.body.cancel(); } catch { /* best effort */ }
      throw new Error('Provider response exceeds the server safety limit.');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function providerFetch(url, init, timeoutMs = 90_000) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await responseText(response);
    let value = null;
    try { value = text ? JSON.parse(text) : {}; } catch { value = { error: { message: 'Provider returned an unreadable response.' } }; }
    if (!response.ok) {
      const error = new Error(redactText(String(value?.error?.message || value?.message || `Provider request failed (${response.status}).`).slice(0, 500)));
      error.statusCode = response.status === 401 || response.status === 403 ? 422 : 502;
      throw error;
    }
    return redactStructured(value);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function normalizeModelCatalog(provider, value) {
  const rows = provider === 'gemini'
    ? (Array.isArray(value?.models) ? value.models : [])
    : (Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : []);
  const exclude = /embedding|whisper|tts|speech|orpheus|guard|dall-e|audio|realtime|moderation|image|davinci|babbage|computer-use|transcribe|search/i;
  const normalized = rows.flatMap((entry) => {
    const rawId = provider === 'cohere' ? entry?.name : entry?.id ?? entry?.name;
    const id = String(rawId ?? '').replace(/^models\//, '').trim();
    if (!id || id.length > 200) return [];
    if (provider === 'gemini' && !(entry?.supportedGenerationMethods ?? []).includes('generateContent')) return [];
    if (provider === 'openai' && exclude.test(id)) return [];
    const name = String(entry?.display_name ?? entry?.displayName ?? entry?.name ?? id).slice(0, 300);
    const contextLength = Number(entry?.context_window ?? entry?.max_context_length ?? entry?.context_length);
    const supported = Array.isArray(entry?.supported_parameters) ? entry.supported_parameters : [];
    const inputModalities = Array.isArray(entry?.architecture?.input_modalities) ? entry.architecture.input_modalities : [];
    return [{
      id,
      name,
      ...(Number.isFinite(contextLength) && contextLength > 0 ? { contextLength } : {}),
      ...(entry?.capabilities?.vision === true || inputModalities.includes('image') ? { vision: true } : {}),
      ...(entry?.capabilities?.reasoning === true || supported.includes('reasoning') ? { reasoning: true } : {}),
      ...(provider === 'openrouter' && id.includes('/') ? { group: id.split('/')[0] } : {}),
    }];
  });
  return [...new Map(normalized.map((entry) => [entry.id, entry])).values()]
    .sort((left, right) => provider === 'openrouter'
      ? String(left.group ?? '').localeCompare(String(right.group ?? '')) || left.id.localeCompare(right.id)
      : left.id.localeCompare(right.id))
    .slice(0, 1_000);
}

/** The only module allowed to make Server-side model-provider network calls. */
export class ProviderGateway {
  constructor(userAIStore) { this.credentials = userAIStore; }

  async listModels({ userId, provider }) {
    if (!supportedProvider(provider)) throw new Error('Unsupported Server AI provider.');
    // OpenRouter publishes its catalogue without authentication, matching Desktop.
    if (provider === 'openrouter') {
      return normalizeModelCatalog(provider, await providerFetch(SERVER_AI_PROVIDERS.openrouter.models, {
        headers: { accept: 'application/json', 'HTTP-Referer': 'https://github.com/Drakonis96/nodus', 'X-Title': 'Nodus' },
      }, 15_000));
    }
    const result = await this.credentials.withUserCredential(userId, provider, async (credential) => {
      const key = apiKey(credential);
      const headers = provider === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', accept: 'application/json' }
        : provider === 'gemini'
          ? { 'x-goog-api-key': key, accept: 'application/json' }
          : { authorization: `Bearer ${key}`, accept: 'application/json' };
      return providerFetch(SERVER_AI_PROVIDERS[provider].models, { headers }, 15_000);
    });
    if (result === undefined) { const error = new Error('No credential is configured for this provider.'); error.statusCode = 409; throw error; }
    return normalizeModelCatalog(provider, result);
  }

  async chat({ userId, provider, model, messages, maxTokens = 2_048, signal }) {
    if (!supportedProvider(provider)) throw new Error('Unsupported Server AI provider.');
    const safeModel = String(model || '').trim();
    if (!safeModel || safeModel.length > 200) throw new Error('A valid model is required.');
    const safeMessages = (Array.isArray(messages) ? messages : []).slice(-100).map((entry) => ({
      role: ['system', 'assistant'].includes(entry?.role) ? entry.role : 'user', content: String(entry?.content || '').slice(0, 1_000_000),
    }));
    const result = await this.credentials.withUserCredential(userId, provider, async (credential) => {
      const key = apiKey(credential);
      if (provider === 'openai') return providerFetch(SERVER_AI_PROVIDERS.openai.chat, {
        signal,
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: safeModel, input: safeMessages, max_output_tokens: Math.max(1, Math.min(32_000, Number(maxTokens) || 2_048)) }),
      });
      if (provider === 'anthropic') return providerFetch(SERVER_AI_PROVIDERS.anthropic.chat, {
        signal,
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: safeModel, messages: safeMessages.filter((entry) => entry.role !== 'system'), max_tokens: Math.max(1, Math.min(32_000, Number(maxTokens) || 2_048)), ...(safeMessages.find((entry) => entry.role === 'system') ? { system: safeMessages.find((entry) => entry.role === 'system').content } : {}) }),
      });
      if (provider === 'gemini') return providerFetch(`${SERVER_AI_PROVIDERS.gemini.chat}/${encodeURIComponent(safeModel)}:generateContent`, {
        signal,
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: safeMessages.filter((entry) => entry.role !== 'system').map((entry) => ({ role: entry.role === 'assistant' ? 'model' : 'user', parts: [{ text: entry.content }] })) }),
      });
      const endpoint = SERVER_AI_PROVIDERS[provider].chat;
      return providerFetch(endpoint, {
        signal,
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/Drakonis96/nodus', 'X-Title': 'Nodus' } : {}) },
        body: JSON.stringify(provider === 'cohere'
          ? { model: safeModel, messages: safeMessages, max_tokens: Math.max(1, Math.min(32_000, Number(maxTokens) || 2_048)) }
          : { model: safeModel, messages: safeMessages, max_tokens: Math.max(1, Math.min(32_000, Number(maxTokens) || 2_048)) }),
      });
    });
    if (result === undefined) { const error = new Error('No credential is configured for this provider.'); error.statusCode = 409; throw error; }
    return result;
  }

  async embeddings({ userId, provider, contract, inputs }) {
    if (!supportedProvider(provider) || !SERVER_AI_PROVIDERS[provider].embeddings) throw new Error('This provider is not supported for Server embeddings.');
    const result = await this.credentials.withUserCredential(userId, provider, async (credential) => {
      const key = apiKey(credential);
      const endpoint = provider === 'gemini'
        ? `${SERVER_AI_PROVIDERS.gemini.embeddings}/${encodeURIComponent(contract.model)}:batchEmbedContents`
        : SERVER_AI_PROVIDERS[provider].embeddings;
      const headers = provider === 'gemini'
        ? { 'x-goog-api-key': key, 'content-type': 'application/json' }
        : { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/Drakonis96/nodus', 'X-Title': 'Nodus' } : {}) };
      const body = provider === 'gemini'
        ? { requests: inputs.map((text) => ({ model: `models/${contract.model}`, content: { parts: [{ text }] }, ...(typeof contract.task === 'string' && contract.task !== 'unknown' ? { taskType: contract.task } : {}), outputDimensionality: contract.dim })) }
        : provider === 'cohere'
        ? { model: contract.model, texts: inputs, input_type: contract.task || 'search_document', embedding_types: ['float'] }
        : { model: contract.model, input: inputs, ...(contract.dim && provider !== 'openrouter' ? { dimensions: contract.dim } : {}) };
      return providerFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    });
    if (result === undefined) { const error = new Error('No credential is configured for this provider.'); error.statusCode = 409; throw error; }
    return result;
  }
}
