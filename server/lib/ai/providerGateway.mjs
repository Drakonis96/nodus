import { redactStructured, redactText } from './redact.mjs';

const CAPABILITIES = new Set([
  'assistant', 'nodi', 'content-query', 'deep-research', 'dictionary', 'idea-analysis',
  'relation-generation', 'author-tools', 'argument-map', 'academic', 'database', 'teaching', 'study',
]);

export const SERVER_AI_PROVIDERS = Object.freeze({
  openai: { chat: 'https://api.openai.com/v1/responses', embeddings: 'https://api.openai.com/v1/embeddings' },
  openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions', embeddings: 'https://openrouter.ai/api/v1/embeddings' },
  anthropic: { chat: 'https://api.anthropic.com/v1/messages' },
  gemini: { chat: 'https://generativelanguage.googleapis.com/v1beta/models', embeddings: 'https://generativelanguage.googleapis.com/v1beta/models' },
  mistral: { chat: 'https://api.mistral.ai/v1/chat/completions', embeddings: 'https://api.mistral.ai/v1/embeddings' },
  cohere: { chat: 'https://api.cohere.com/v2/chat', embeddings: 'https://api.cohere.com/v2/embed' },
});

export function supportedCapability(value) { return CAPABILITIES.has(String(value)); }
export function supportedProvider(value) { return Object.hasOwn(SERVER_AI_PROVIDERS, String(value)); }

function apiKey(credential) {
  const value = typeof credential === 'string' ? credential : credential?.apiKey;
  if (typeof value !== 'string' || value.length < 8 || value.length > 16_384) throw new Error('The provider credential is invalid.');
  return value;
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
    const text = await response.text();
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

/** The only module allowed to make Server-side model-provider network calls. */
export class ProviderGateway {
  constructor(userAIStore) { this.credentials = userAIStore; }

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
