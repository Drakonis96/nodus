import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';

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

/** Low-level chat completion returning raw text, provider-agnostic. */
async function rawComplete(opts: CallOpts): Promise<string> {
  const settings = getSettings();
  const key = getApiKey();
  if (!key) throw new AiError('Falta la clave de IA. Configúrala en Ajustes.', false);

  if (settings.aiProvider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: key });
    try {
      const res = await client.messages.create({
        model: settings.aiModel,
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

  // OpenAI
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: key });
  try {
    const res = await client.chat.completions.create({
      model: settings.aiModel,
      temperature: opts.temperature ?? 0.15,
      max_tokens: opts.maxTokens ?? 8000,
      response_format: { type: 'json_object' },
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
  if (status === 401) return new AiError('Clave de IA inválida', false);
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
 * JSON completion with one retry at temperature 0 if parsing fails (per spec).
 * Validates with the provided guard before returning.
 */
export async function completeJson<T>(opts: CallOpts, guard: (v: unknown) => v is T): Promise<T> {
  let lastErr: unknown;
  for (const temperature of [opts.temperature ?? 0.15, 0]) {
    try {
      const text = await rawComplete({ ...opts, temperature });
      const parsed = extractJson(text);
      if (guard(parsed)) return parsed;
      lastErr = new AiError('El JSON no cumple el esquema esperado');
    } catch (e) {
      lastErr = e;
      if (e instanceof AiError && e.retriable) throw e; // rate-limit: let the queue back off
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiError('Fallo de parseo JSON');
}

/** Embeddings via OpenAI embeddings endpoint (works for both providers' keys when OpenAI selected). */
export async function embed(text: string): Promise<number[] | null> {
  const settings = getSettings();
  const key = getApiKey();
  if (!key) return null;
  // Embeddings require an OpenAI-compatible endpoint; only attempt when using OpenAI.
  if (settings.aiProvider !== 'openai') return null;
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: key });
  try {
    const res = await client.embeddings.create({ model: settings.embeddingModel, input: text.slice(0, 8000) });
    return res.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}
