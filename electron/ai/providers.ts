import type { AiProvider, ModelInfo } from '@shared/types';

export const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini'];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
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
    case 'anthropic':
      return null;
  }
}

/** Providers whose chat models reliably honor OpenAI's response_format: json_object. */
export function supportsJsonMode(provider: AiProvider): boolean {
  return provider === 'openai';
}

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

async function listOpenRouter(): Promise<ModelInfo[]> {
  // OpenRouter's model list is public (no key required).
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string; name?: string }[] };
  const models: ModelInfo[] = (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    group: m.id.includes('/') ? m.id.split('/')[0] : 'other',
  }));
  // Sort by upstream provider, then model id.
  return models.sort((a, b) => (a.group! === b.group! ? a.id.localeCompare(b.id) : a.group!.localeCompare(b.group!)));
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
