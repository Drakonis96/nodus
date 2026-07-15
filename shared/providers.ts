import type { AiProvider, EmbeddingProvider, LocalProvider, ModelRef } from './types';

// Single source of truth for provider identity, labels and defaults, shared by
// the main process (electron/) and the renderer (src/). Adding a provider to
// the AiProvider/EmbeddingProvider unions in types.ts forces every Record and
// switch below to be updated — lean on typecheck.

/** Every AI provider, in the order pickers and Settings show them. */
export const AI_PROVIDERS: AiProvider[] = [
  'anthropic',
  'openai',
  'openrouter',
  'groq',
  'cerebras',
  'deepseek',
  'gemini',
  'xiaomi',
  'ollama',
  'lmstudio',
];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  cerebras: 'Cerebras',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  xiaomi: 'Xiaomi MiMo',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  nodus: 'Nodus local',
};

/** Order two model refs for the pickers: by provider label (A→Z), then model id (A→Z). */
export function compareModelRefs(a: ModelRef, b: ModelRef): number {
  const byProvider = (PROVIDER_LABELS[a.provider] ?? a.provider).localeCompare(
    PROVIDER_LABELS[b.provider] ?? b.provider,
    undefined,
    { sensitivity: 'base' }
  );
  if (byProvider !== 0) return byProvider;
  return a.model.localeCompare(b.model, undefined, { sensitivity: 'base' });
}

/** Sorted copy of `models`: alphabetical by provider label, then by model name. */
export function sortModelRefs(models: ModelRef[]): ModelRef[] {
  return [...models].sort(compareModelRefs);
}

/** Providers whose connection is a user-configured local/LAN server (no API key). */
export const LOCAL_PROVIDERS: LocalProvider[] = ['ollama', 'lmstudio'];

export function isLocalProvider(provider: AiProvider): provider is LocalProvider {
  return provider === 'ollama' || provider === 'lmstudio';
}

/** Server base URL each local provider ships with (no trailing slash). */
export const DEFAULT_LOCAL_BASE_URLS: Record<LocalProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

/** Embedding-capable providers, in the order the Settings selector shows them. */
export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'nodus'];

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'baai/bge-m3',
  ollama: 'nomic-embed-text',
  lmstudio: 'text-embedding-nomic-embed-text-v1.5',
  nodus: 'multilingual-e5-small-int8',
};

/** Coerce a stored/unknown value to a valid embedding provider ('openai' fallback). */
export function normalizeEmbeddingProvider(provider: unknown): EmbeddingProvider {
  return (EMBEDDING_PROVIDERS as unknown[]).includes(provider) ? (provider as EmbeddingProvider) : 'openai';
}

/** Repair a user-typed embedding model id: empty → provider default; legacy
 *  OpenRouter "author:slug" → "author/slug". */
export function normalizeEmbeddingModel(provider: EmbeddingProvider, modelId: string): string {
  const trimmed = modelId.trim() || DEFAULT_EMBEDDING_MODELS[provider];
  if (provider === 'openrouter' && !trimmed.includes('/') && trimmed.includes(':')) {
    const [author, slug] = trimmed.split(':', 2);
    if (author && slug) return `${author.toLowerCase()}/${slug}`;
  }
  return trimmed;
}
