import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import { openAiCompatBase, supportsJsonMode } from './providers';
import type { AiProvider, ModelRef } from '@shared/types';

export class AiError extends Error {
  constructor(message: string, public retriable = false) {
    super(message);
  }
}

interface CallOpts {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

/** Resolve which model to use: explicit override, else the configured default. */
function resolveModel(override?: ModelRef | null): ModelRef {
  if (override?.provider && override.model) return override;
  const def = getSettings().defaultModel;
  if (!def?.provider || !def.model) {
    throw new AiError('No hay un modelo de IA configurado. Elige uno en Ajustes.', false);
  }
  return def;
}

async function rawComplete(model: ModelRef, opts: CallOpts): Promise<string> {
  const key = getApiKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false);

  if (model.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: key });
    try {
      const res = await client.messages.create({
        model: model.model,
        max_tokens: opts.maxTokens ?? 8000,
        temperature: opts.temperature ?? 0.15,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      });
      const block = res.content.find((b: any) => b.type === 'text');
      return (block as any)?.text ?? '';
    } catch (e: any) {
      throw wrapProviderError(e);
    }
  }

  // OpenAI-compatible providers: openai, openrouter, deepseek, gemini.
  const baseURL = openAiCompatBase(model.provider);
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: key, baseURL: baseURL ?? undefined });
  try {
    const res = await client.chat.completions.create({
      model: model.model,
      temperature: opts.temperature ?? 0.15,
      max_tokens: opts.maxTokens ?? 8000,
      ...(supportsJsonMode(model.provider) ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  } catch (e: any) {
    throw wrapProviderError(e);
  }
}

function wrapProviderError(e: any): AiError {
  const status = e?.status ?? e?.response?.status;
  if (status === 429 || status === 529) return new AiError('Límite de tasa del proveedor de IA', true);
  if (status >= 500) return new AiError(`Error del proveedor (${status})`, true);
  if (status === 401 || status === 403) return new AiError('Clave de IA inválida', false);
  return new AiError(e?.message ?? 'Error de IA', false);
}

/** Strip code fences and locate the outermost JSON object. */
function extractJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) throw new AiError('La respuesta no contiene JSON');
  return JSON.parse(t.slice(first, last + 1));
}

/**
 * JSON completion with one retry at temperature 0 if parsing fails.
 * Uses the given model override or the configured default model.
 */
export async function completeJson<T>(
  opts: CallOpts,
  guard: (v: unknown) => v is T,
  model?: ModelRef | null
): Promise<T> {
  const resolved = resolveModel(model);
  let lastErr: unknown;
  for (const temperature of [opts.temperature ?? 0.15, 0]) {
    try {
      const text = await rawComplete(resolved, { ...opts, temperature });
      const parsed = extractJson(text);
      if (guard(parsed)) return parsed;
      lastErr = new AiError('El JSON no cumple el esquema esperado');
    } catch (e) {
      lastErr = e;
      if (e instanceof AiError && e.retriable) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiError('Fallo de parseo JSON');
}

const EMBED_MODELS: Partial<Record<AiProvider, string>> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
};

/**
 * Embeddings for idea fusion. Uses whichever embedding-capable provider has a key
 * (OpenAI or Gemini). Returns null when none is available — fusion then stays
 * conservative (treats ideas as new).
 */
export async function embed(text: string): Promise<number[] | null> {
  const settings = getSettings();
  for (const provider of ['openai', 'gemini'] as AiProvider[]) {
    const key = getApiKey(provider);
    if (!key) continue;
    const baseURL = openAiCompatBase(provider) ?? undefined;
    const modelId = (provider === 'openai' && settings.embeddingModel) || EMBED_MODELS[provider]!;
    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: key, baseURL });
      const res = await client.embeddings.create({ model: modelId, input: text.slice(0, 8000) });
      return res.data[0]?.embedding ?? null;
    } catch {
      /* try next provider */
    }
  }
  return null;
}
