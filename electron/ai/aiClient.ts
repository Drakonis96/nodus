import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import { openAiCompatBase, supportsJsonMode } from './providers';
import type { AiProvider, ModelRef } from '@shared/types';
import { jsonrepair } from 'jsonrepair';

export class AiError extends Error {
  /**
   * @param retriable transient provider error (rate limit / 5xx) — worth a backoff retry.
   * @param config    misconfiguration (no model / no key) — the SAME for every job, so the
   *                  queue should pause and surface it once instead of failing every item.
   */
  constructor(message: string, public retriable = false, public config = false) {
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
    throw new AiError('No hay un modelo de IA configurado. Elige uno en Ajustes.', false, true);
  }
  return def;
}

async function rawComplete(model: ModelRef, opts: CallOpts, jsonMode = true): Promise<string> {
  const key = getApiKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

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
  const client = new OpenAI({ apiKey: key, baseURL: baseURL ?? undefined, timeout: 180_000, maxRetries: 0 });
  try {
    const res = await client.chat.completions.create({
      model: model.model,
      temperature: opts.temperature ?? 0.15,
      max_tokens: opts.maxTokens ?? 8000,
      ...(jsonMode && supportsJsonMode(model.provider) ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    });
    const choice = res.choices[0];
    const content = choice?.message?.content ?? '';
    if (!content.trim()) {
      throw new AiError(`Respuesta vacía del proveedor de IA (${choice?.finish_reason ?? 'sin finish_reason'}).`, false);
    }
    return content;
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
}

function wrapProviderError(e: any): AiError {
  const status = e?.status ?? e?.response?.status;
  if (e?.name?.includes('Timeout') || /timeout|timed out/i.test(e?.message ?? '')) {
    return new AiError('Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.', false);
  }
  if (status === 429 || status === 529) return new AiError('Límite de tasa del proveedor de IA', true);
  if (status >= 500) return new AiError(`Error del proveedor (${status})`, true);
  if (status === 401 || status === 403) return new AiError('Clave de IA inválida. Revísala en Ajustes.', false, true);
  return new AiError(e?.message ?? 'Error de IA', false);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Strip code fences and locate the outermost JSON object. */
function extractJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) throw new AiError('La respuesta no contiene JSON');
  const candidate = t.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

async function repairJson<T>(
  model: ModelRef,
  rawText: string,
  parseError: unknown,
  guard: (v: unknown) => v is T
): Promise<T | null> {
  const clipped = rawText.length > 60_000 ? rawText.slice(0, 60_000) : rawText;
  const system =
    'Eres un reparador estricto de JSON. Recibes una salida JSON mal formada. Devuelve únicamente el mismo objeto como JSON válido, sin añadir campos, sin inventar datos y sin vallas de código.';
  const user = JSON.stringify({
    parse_error: errorMessage(parseError),
    invalid_json: clipped,
  });
  try {
    const repaired = await rawComplete(
      model,
      {
        system,
        user,
        temperature: 0,
        maxTokens: Math.max(2000, Math.min(8000, Math.ceil(clipped.length / 3))),
      },
      false
    );
    const parsed = extractJson(repaired);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function parseOrRepair<T>(
  model: ModelRef,
  text: string,
  guard: (v: unknown) => v is T
): Promise<T> {
  try {
    const parsed = extractJson(text);
    if (guard(parsed)) return parsed;
    throw new AiError('El JSON no cumple el esquema esperado');
  } catch (e) {
    const repaired = await repairJson(model, text, e, guard);
    if (repaired) return repaired;
    throw e;
  }
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
  const attempts = [
    { temperature: opts.temperature ?? 0.15, jsonMode: true },
    { temperature: 0, jsonMode: true },
    { temperature: 0, jsonMode: false },
  ];
  for (const attempt of attempts) {
    try {
      const text = await rawComplete(resolved, { ...opts, temperature: attempt.temperature }, attempt.jsonMode);
      return await parseOrRepair(resolved, text, guard);
    } catch (e) {
      lastErr = e;
      if (e instanceof AiError && (e.retriable || e.config)) throw e;
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
