import type { AiProvider, EmbeddingProvider, ModelInfo } from '@shared/types';

export const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini', 'xiaomi'];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  xiaomi: 'Xiaomi MiMo',
};

/**
 * OpenAI-compatible chat base URL for a provider, or null for providers with a
 * native (non-OpenAI) API (Anthropic uses its own SDK).
 */
export function openAiCompatBase(provider: AiProvider): string | null {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'gemini':
      // Google exposes an OpenAI-compatible surface for chat + embeddings.
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'xiaomi':
      // Xiaomi MiMo's official API is OpenAI-compatible and accepts Bearer auth.
      return 'https://api.xiaomimimo.com/v1';
    case 'anthropic':
      return null;
  }
}

/**
 * Providers whose chat models accept OpenAI's response_format: json_object.
 * openai/deepseek honor it natively; openrouter and gemini accept it through their
 * OpenAI-compatible surfaces. A model that ignores/rejects it is caught by the
 * caller's 400 fallback, which strips the optional params and retries plainly — so
 * enabling it broadly trades a rare extra round-trip for far fewer JSON-repair calls.
 */
export function supportsJsonMode(provider: AiProvider): boolean {
  return (
    provider === 'openai' ||
    provider === 'deepseek' ||
    provider === 'openrouter' ||
    provider === 'gemini' ||
    provider === 'xiaomi'
  );
}

/** How hard a model should "think" before answering. `off` asks reasoning models to
 *  skip the chain-of-thought (much faster) where the provider supports it. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

/**
 * Extra request-body fields that control a model's reasoning, per provider. Returns
 * an empty object when the provider exposes no usable OpenAI-compat knob. The caller
 * retries without these on a 400, so it is safe to be slightly optimistic here.
 */
export function reasoningBody(provider: AiProvider, effort: ReasoningEffort): Record<string, unknown> {
  switch (provider) {
    case 'openrouter':
      // OpenRouter's unified `reasoning` param: disable entirely, or pick an effort.
      return effort === 'off' ? { reasoning: { enabled: false } } : { reasoning: { effort } };
    case 'gemini':
      // Gemini's OpenAI-compat surface accepts reasoning_effort, including "none".
      return { reasoning_effort: effort === 'off' ? 'none' : effort };
    case 'openai':
      // Only the reasoning (o-series / gpt-5) models honor reasoning_effort; sending
      // it elsewhere 400s and the caller strips it. Omit for "off" (the default).
      return effort === 'off' ? {} : { reasoning_effort: effort };
    case 'deepseek':
      // DeepSeek V4 is a hybrid model: thinking is ON by default and would slow
      // scans to a crawl (and waste tokens). Turn it off explicitly for "off";
      // otherwise pass the requested effort, which V4 honors via reasoning_effort.
      return effort === 'off' ? { thinking: { type: 'disabled' } } : { reasoning_effort: effort };
    case 'xiaomi':
      // Xiaomi MiMo is likewise a reasoning model with a thinking toggle (default ON).
      // Disable it for scans; leave the model's default for explicit efforts.
      return effort === 'off' ? { thinking: { type: 'disabled' } } : {};
    case 'anthropic':
      // Anthropic uses its own SDK path, not this OpenAI-compat reasoning knob.
      return {};
  }
}

/** OpenRouter-only provider routing preference: bias toward the fastest upstream. */
export function openRouterRoutingBody(sortByThroughput: boolean): Record<string, unknown> {
  return sortByThroughput ? { provider: { sort: 'throughput' } } : {};
}

/** Attribution headers OpenRouter uses for ranking/rate-limit identity. */
export const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/Drakonis96/nodus',
  'X-Title': 'Nodus',
};

function byId(a: ModelInfo, b: ModelInfo): number {
  return a.id.localeCompare(b.id);
}

/**
 * Fetch the live model list for a provider using its stored key. Sorted
 * alphabetically; OpenRouter is additionally grouped/sorted by upstream provider.
 */
export async function listModels(provider: AiProvider, key: string | null): Promise<ModelInfo[]> {
  switch (provider) {
    case 'anthropic':
      return listAnthropic(key);
    case 'openai':
      return listOpenAiStyle('https://api.openai.com/v1/models', key, true);
    case 'deepseek':
      return listOpenAiStyle('https://api.deepseek.com/models', key, false);
    case 'openrouter':
      return listOpenRouter();
    case 'gemini':
      return listGemini(key);
    case 'xiaomi':
      return listOpenAiStyle('https://api.xiaomimimo.com/v1/models', key, false);
  }
}

/** Fetch embedding-capable models for the configured embedding provider. */
export async function listEmbeddingModels(provider: EmbeddingProvider, key: string | null): Promise<ModelInfo[]> {
  switch (provider) {
    case 'openai':
      return listOpenAiEmbeddingModels(key);
    case 'openrouter':
      return listOpenRouterEmbeddingModels(key);
    case 'gemini':
      return listGeminiEmbeddingModels(key);
  }
}

async function listAnthropic(key: string | null): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave de Anthropic.');
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  if (!res.ok) throw new Error(`Anthropic /models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string; display_name?: string }[] };
  return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name })).sort(byId);
}

async function listOpenAiStyle(url: string, key: string | null, filterChat: boolean): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave del proveedor.');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`/models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  let models = (data.data ?? []).map((m) => ({ id: m.id }) as ModelInfo);
  if (filterChat) {
    // Hide non-chat OpenAI models (embeddings, audio, image, moderation, legacy).
    const exclude = /embedding|whisper|tts|dall-e|audio|realtime|moderation|image|davinci|babbage|computer-use|transcribe|search/i;
    models = models.filter((m) => !exclude.test(m.id));
  }
  return models.sort(byId);
}

async function listOpenAiEmbeddingModels(key: string | null): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave de OpenAI.');
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAI /models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? [])
    .filter((m) => /embedding/i.test(m.id))
    .map((m) => ({ id: m.id }) as ModelInfo)
    .sort(byId);
}

async function listOpenRouter(): Promise<ModelInfo[]> {
  // OpenRouter's model list is public (no key required).
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string; name?: string; supported_parameters?: string[] }[] };
  const models: ModelInfo[] = (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    group: m.id.includes('/') ? m.id.split('/')[0] : 'other',
    // Flag reasoning models so the picker can warn they are slower for scanning.
    reasoning: (m.supported_parameters ?? []).includes('reasoning'),
  }));
  // Sort by upstream provider, then model id.
  return models.sort((a, b) => (a.group! === b.group! ? a.id.localeCompare(b.id) : a.group!.localeCompare(b.group!)));
}

async function listOpenRouterEmbeddingModels(key: string | null): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave de OpenRouter.');
  const res = await fetch('https://openrouter.ai/api/v1/embeddings/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /embeddings/models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string; name?: string }[] };
  return (data.data ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      group: m.id.includes('/') ? m.id.split('/')[0] : 'other',
    }))
    .sort((a, b) => (a.group! === b.group! ? a.id.localeCompare(b.id) : a.group!.localeCompare(b.group!)));
}

async function listGemini(key: string | null): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave de Gemini.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`);
  if (!res.ok) throw new Error(`Gemini /models HTTP ${res.status}`);
  const data = (await res.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }))
    .sort(byId);
}

async function listGeminiEmbeddingModels(key: string | null): Promise<ModelInfo[]> {
  if (!key) throw new Error('Falta la clave de Gemini.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`);
  if (!res.ok) throw new Error(`Gemini /models HTTP ${res.status}`);
  const data = (await res.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  const models = (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('embedContent') || /embedding/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }))
    .sort(byId);
  if (models.length > 0) return models;
  return [
    { id: 'gemini-embedding-001', name: 'Gemini Embedding 001' },
    { id: 'gemini-embedding-2-preview', name: 'Gemini Embedding 2 Preview' },
  ];
}
