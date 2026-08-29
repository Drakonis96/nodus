import type { AIPreferences } from './types';

export const SERVER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-4-5',
  codex: 'gpt-5.6-sol',
  'github-copilot': 'gpt-5.4',
  'opencode-go': 'mimo-v2.5',
  gemini: 'gemini-3.1-flash-lite',
  openrouter: 'xiaomi/mimo-v2.5',
  groq: 'openai/gpt-oss-120b',
  cerebras: 'gpt-oss-120b',
  deepseek: 'deepseek-chat',
  xiaomi: 'mimo-v2.5',
  ollama: 'gemma3',
  lmstudio: 'qwen_qwen3.5-9b',
  nodus: 'gemma-4-e2b-q4',
  mistral: 'mistral-large-latest',
  cohere: 'command-a-03-2025',
};

export const SERVER_MODEL_CATALOG: Record<string, string[]> = {
  openai: ['gpt-5.4', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini'],
  anthropic: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4'],
  'github-copilot': ['gpt-5.4', 'claude-sonnet-4-5', 'gemini-2.5-pro'],
  'opencode-go': ['mimo-v2.5', 'mimo-v2.5-pro', 'minimax-m2.5', 'qwen3-coder-plus'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  openrouter: ['xiaomi/mimo-v2.5', 'xiaomi/mimo-v2.5-pro', 'z-ai/glm-5.3-flash', 'inclusionai/ling-3.0-flash', 'openai/gpt-5.4', 'anthropic/claude-sonnet-4-5', 'google/gemini-2.5-pro'],
  groq: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  cerebras: ['gpt-oss-120b', 'llama-3.3-70b'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xiaomi: ['mimo-v2.5', 'mimo-v2.5-pro'],
  ollama: ['gemma3', 'qwen3.5', 'llama3.3'],
  lmstudio: ['qwen_qwen3.5-9b', 'gemma-4-12b-it-qat'],
  nodus: ['gemma-4-e2b-q4'],
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
  cohere: ['command-a-03-2025', 'command-r-plus', 'command-r'],
};

export function serverModelsFor(preferences: AIPreferences, provider: string, current = ''): string[] {
  const candidates = [
    current,
    preferences.chatModels?.[provider],
    SERVER_DEFAULT_MODELS[provider],
    ...(preferences.favorites || []).filter((entry) => entry.provider === provider).map((entry) => entry.model),
  ];
  // Desktop's in-context picker is intentionally favorites-first: the catalog is
  // only used by Settings when adding a favorite. Keeping chat controls on this
  // projection makes a portable profile render identically in every vault while
  // retaining the selected/default value when a provider has no favorite yet.
  return [...new Set(candidates.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
