import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import {
  openAiCompatBase,
  supportsJsonMode,
  reasoningBody,
  openRouterRoutingBody,
  OPENROUTER_HEADERS,
  isLocalProvider,
  localContextWindow,
} from './providers';
import { DEFAULT_EMBEDDING_MODELS, normalizeEmbeddingModel, PROVIDER_LABELS } from '@shared/providers';
import type { AiProvider, EmbeddingProvider, LocalProvider, ModelRef, PromptLanguage, ReasoningEffort } from '@shared/types';
import { vaultTypePromptPack } from '@shared/vaultTypes';
import { anthropicVisionContent, openAiVisionContent, type VisionImagePart } from '@shared/imageAnalysis';
import { getActiveVault } from '../vaults/vaultRegistry';
import { jsonrepair } from 'jsonrepair';
import { startPerf, type PerfContext } from '../perf';

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

/** Stored key for a provider, or a harmless placeholder for local providers
 *  (Ollama / LM Studio need no key; the OpenAI SDK still requires a non-empty
 *  string). A user-supplied token for a secured local instance takes precedence. */
function resolveProviderKey(provider: AiProvider): string | null {
  const stored = getApiKey(provider);
  if (stored) return stored;
  return isLocalProvider(provider) ? 'local' : null;
}

// ── Local model context budgeting ────────────────────────────────────────────
// Cloud models expose huge context windows and manage the prompt server-side, so
// Nodus's large prompts (a scan can be tens of thousands of tokens) fit fine. Local
// servers load a model with a small, fixed window (LM Studio defaults to 4096), so
// the same prompt overflows with a cryptic "n_keep >= n_ctx". These helpers size
// max_tokens to the real window and refuse up front with an actionable message.

/** Smallest generation budget worth attempting; below this the window has no room. */
const MIN_LOCAL_GENERATION_TOKENS = 512;

/** Rough token estimate (~4 chars/token) for sizing local-model requests. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Match llama.cpp's "prompt doesn't fit the context window" runtime error (LM Studio
 *  surfaces it mid-stream or as a 400) — and cloud providers' equivalent — so it can be
 *  reworded into something the user can act on. */
function isContextOverflow(message: string | null | undefined): boolean {
  if (!message) return false;
  return /n_ctx|n_keep|tokens to keep|context length|context window|maximum context/i.test(message);
}

/** Actionable message for a prompt that overflows a model's context window. */
function contextOverflowMessage(provider: AiProvider, model: string, ctx: number | null, promptTokens: number | null): string {
  const label = PROVIDER_LABELS[provider] ?? provider;
  const knob = provider === 'ollama' ? 'num_ctx' : 'Context Length';
  const need = promptTokens ? `~${promptTokens.toLocaleString('es')} tokens` : 'más tokens de los que caben';
  const has = ctx ? ` (ventana actual: ${ctx.toLocaleString('es')} tokens)` : '';
  return `El modelo local «${model}» no tiene suficiente contexto para esta tarea: necesita ${need}${has}. Aumenta el contexto del modelo en ${label} (${knob}), elige un modelo con más contexto, reduce el tamaño de la tarea (menos texto por lote) o usa un proveedor en la nube para tareas grandes.`;
}

/** Neutral variant when the provider/model aren't at hand (error-translation fallback). */
function genericContextOverflowMessage(): string {
  return 'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.';
}

/**
 * Size max_tokens to a local model's real context window, refusing up front when the
 * prompt itself won't fit. Returns the max_tokens to use; throws an actionable AiError
 * (config → the scan queue pauses once instead of failing every item) when there is no
 * room to generate. No-ops (returns the requested value) when the window can't be
 * detected — the runtime-error translation is the safety net for that case.
 */
async function localMaxTokens(model: ModelRef, opts: CallOpts, requestedMax: number): Promise<number> {
  const ctx = await localContextWindow(model.provider as LocalProvider, model.model, getApiKey(model.provider));
  if (!ctx) return requestedMax;
  const promptTokens = estimateTokens(opts.system) + estimateTokens(opts.user) + 16;
  const reserve = Math.max(256, Math.round(ctx * 0.05));
  const available = ctx - promptTokens - reserve;
  if (available < MIN_LOCAL_GENERATION_TOKENS) {
    throw new AiError(contextOverflowMessage(model.provider, model.model, ctx, promptTokens), false, true);
  }
  return Math.min(requestedMax, available);
}

interface CallOpts {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  perf?: PerfContext;
  /** Reasoning effort. Defaults to `off` for JSON/scan calls and to the configured
   *  `chatReasoning` for conversational calls. */
  reasoning?: ReasoningEffort;
  /** Disable SDK/compatibility retries for explicitly single-attempt workflows. */
  noRetry?: boolean;
  /** Per-request transport timeout override. */
  timeoutMs?: number;
  /** Images to attach for vision models (base64 + media type). */
  images?: VisionImagePart[];
  /** Skip the vault-type prompt pack (keep only the output-language directive). Used
   *  for tasks that need consistent output regardless of vault type (image analysis). */
  plainContext?: boolean;
}

/** Streaming delta. `kind` distinguishes the final answer (`content`, default) from
 *  the model's reasoning/thinking trace (`reasoning`). */
type TextDeltaHandler = (delta: string, kind?: 'content' | 'reasoning') => void;

/**
 * Output-language control. The prompts are authored in Spanish; when the user picks
 * a non-Spanish prompt language we APPEND a high-priority directive instead of
 * rewriting the prompt, so all generated free-text fields come back in that language.
 * The directive explicitly supersedes the inline "escribe en español" instructions the
 * base prompts carry — the same override mechanism that has always driven the English
 * option — which is far safer than a blind find/replace over hand-tuned prompts (that
 * would also corrupt JSON examples and cases where "español" denotes the source text).
 * `quote`/verbatim evidence always stays in the source language. Applied at the public
 * entry points only (not the internal JSON-repair call, which must not translate
 * existing content).
 */
const OUTPUT_LANGUAGE_NAME: Record<Exclude<PromptLanguage, 'es'>, string> = {
  en: 'INGLÉS (English)',
  fr: 'FRANCÉS (Français)',
  tr: 'TURCO (Türkçe)',
};

function outputLanguageDirective(lang: Exclude<PromptLanguage, 'es'>): string {
  return `

═══ IDIOMA DE SALIDA — PRIORIDAD MÁXIMA / OUTPUT LANGUAGE — HIGHEST PRIORITY ═══
Escribe TODOS los campos de salida de texto libre / lenguaje natural en ${OUTPUT_LANGUAGE_NAME[lang]}, independientemente del idioma del documento de origen Y de cualquier instrucción anterior de este prompt que pida escribir "en español". Esto incluye label, statement, development, summary, rationale, explanation, notes, title, body, reason y cualquier prosa que produzcas. La ÚNICA excepción: cualquier campo "quote" / evidencia literal debe copiarse EXACTAMENTE en el idioma original de la fuente (nunca traduzcas las citas). Las claves JSON y los valores enum se mantienen exactamente como se especifican.`;
}

/** Exported for unit testing: appends the output-language directive per the current
 *  `promptLanguage` setting without mutating the base prompt. */
export function withPromptLanguage<T extends { system: string }>(opts: T): T {
  const lang = getSettings().promptLanguage ?? 'es';
  if (lang === 'es') return opts;
  return { ...opts, system: `${opts.system}${outputLanguageDirective(lang)}` };
}

/**
 * Appends the active vault type's prompt-pack persona to the system prompt (empty
 * for academic, so a no-op for existing vaults). Applied at the same public entry
 * points as the language directive, but BEFORE it, so the highest-priority
 * output-language directive always stays at the very end of the prompt. Robust to
 * contexts where the vault registry isn't ready (headless/MCP) — falls back to no
 * pack rather than throwing. Exported for unit testing.
 */
export function withVaultTypeContext<T extends { system: string }>(opts: T): T {
  let pack = '';
  try {
    pack = vaultTypePromptPack(getActiveVault().type);
  } catch {
    pack = '';
  }
  if (!pack) return opts;
  return { ...opts, system: `${opts.system}${pack}` };
}

/** Compose both context directives: vault-type persona first, then the language
 *  override last (highest priority). `plainContext` skips the vault pack so tasks
 *  that need consistent output (image analysis) aren't steered by the vault type. */
function withPromptContext<T extends { system: string; plainContext?: boolean }>(opts: T): T {
  return opts.plainContext ? withPromptLanguage(opts) : withPromptLanguage(withVaultTypeContext(opts));
}

/** Resolve which model to use: explicit override, else the synthesis workload. */
function resolveModel(override?: ModelRef | null): ModelRef {
  if (override?.provider && override.model) return override;
  const def = getSettings().synthesisModel;
  if (!def?.provider || !def.model) {
    throw new AiError('No hay un modelo de IA configurado. Elige uno en Ajustes.', false, true);
  }
  return def;
}

/** Public wrapper so prompt-assembly code (e.g. the research chat) can resolve the same
 *  effective model the completion calls will use, to size its payload accordingly. */
export function resolveModelRef(override?: ModelRef | null): ModelRef {
  return resolveModel(override);
}

/**
 * The loaded context window (in tokens) of a model, or null when it is a cloud model or
 * the window can't be detected. Only local servers (LM Studio / Ollama) load a small,
 * fixed window; cloud models manage context server-side, so they return null and callers
 * keep their cloud-sized budget. Lets large-prompt callers fit the payload to what a local
 * model can actually hold instead of overflowing.
 */
export async function localModelContextWindow(model: ModelRef): Promise<number | null> {
  if (!isLocalProvider(model.provider)) return null;
  return localContextWindow(model.provider as LocalProvider, model.model, getApiKey(model.provider));
}

/**
 * Optional, model-specific request-body fields layered onto an OpenAI-compatible
 * call: JSON mode, reasoning control, and OpenRouter throughput routing. These can
 * be rejected by some models, so callers retry once without them on a 400.
 */
function optionalBody(model: ModelRef, jsonMode: boolean, reasoning: ReasoningEffort): Record<string, unknown> {
  return {
    ...(jsonMode && supportsJsonMode(model.provider) ? { response_format: { type: 'json_object' as const } } : {}),
    ...reasoningBody(model.provider, reasoning),
    ...(model.provider === 'openrouter' ? openRouterRoutingBody(getSettings().openRouterThroughput) : {}),
  };
}

function openAiClientHeaders(model: ModelRef): Record<string, string> | undefined {
  return model.provider === 'openrouter' ? OPENROUTER_HEADERS : undefined;
}

/** True for a provider 400 (bad request) — used to retry without the optional params. */
function isBadRequest(e: any): boolean {
  return (e?.status ?? e?.response?.status) === 400;
}

async function rawComplete(
  model: ModelRef,
  opts: CallOpts,
  jsonMode = true,
  reasoning: ReasoningEffort = 'off'
): Promise<string> {
  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

  if (model.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey: key,
      ...(opts.noRetry ? { maxRetries: 0 } : {}),
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
    try {
      const res = await client.messages.create({
        model: model.model,
        max_tokens: opts.maxTokens ?? 8000,
        temperature: opts.temperature ?? 0.15,
        system: opts.system,
        messages: [
          { role: 'user', content: opts.images?.length ? (anthropicVisionContent(opts.user, opts.images) as any) : opts.user },
        ],
      });
      const block = res.content.find((b: any) => b.type === 'text');
      return (block as any)?.text ?? '';
    } catch (e: any) {
      throw wrapProviderError(e);
    }
  }

  // OpenAI-compatible providers: openai, openrouter, deepseek, gemini, local servers.
  const baseURL = openAiCompatBase(model.provider);
  // Local models load a small, fixed context window; size the request to it (and bail
  // early with an actionable error) instead of overflowing with a cryptic llama.cpp error.
  const requestedMax = opts.maxTokens ?? 8000;
  const maxTokens = isLocalProvider(model.provider) ? await localMaxTokens(model, opts, requestedMax) : requestedMax;
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: opts.timeoutMs ?? 180_000,
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const baseBody = {
    model: model.model,
    temperature: opts.temperature ?? 0.15,
    max_tokens: maxTokens,
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  const extras = optionalBody(model, jsonMode, reasoning);
  try {
    let res;
    try {
      res = await client.chat.completions.create({ ...baseBody, ...extras } as any);
    } catch (e: any) {
      // The optional reasoning/JSON/routing params may be unsupported by this model.
      // Retry once as a plain request before surfacing the error.
      if (!opts.noRetry && isBadRequest(e) && Object.keys(extras).length > 0) {
        res = await client.chat.completions.create(baseBody as any);
      } else {
        throw e;
      }
    }
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
  // A prompt that overflows the model's context window can arrive at various statuses
  // (400 from local servers, 400/413 from cloud). Reword it before status-based mapping
  // so the user gets an actionable message instead of a raw "n_keep >= n_ctx".
  if (isContextOverflow(e?.error?.message ?? e?.message)) {
    return new AiError(genericContextOverflowMessage(), false, true);
  }
  if (e?.name?.includes('Timeout') || /timeout|timed out/i.test(e?.message ?? '')) {
    return new AiError('Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.', false);
  }
  if (status === 429 || status === 529) return new AiError('Límite de tasa del proveedor de IA', true);
  if (status >= 500) return new AiError(`Error del proveedor (${status})`, true);
  if (status === 401 || status === 403) return new AiError('Clave de IA inválida. Revísala en Ajustes.', false, true);
  if (status === 400) {
    const detail = e?.error?.message ?? e?.message;
    const suffix = detail && !/no body/i.test(detail) ? ` Detalle: ${detail}` : '';
    return new AiError(
      `El proveedor rechazó la solicitud (400). Si ocurre al abrir el asistente con mucho contexto, la petición supera el límite del modelo.${suffix}`,
      false
    );
  }
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
  guard: (v: unknown) => v is T,
  perf?: PerfContext
): Promise<T | null> {
  const repairDone = startPerf('JSON repair', perf, { rawChars: rawText.length });
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
    const ok = guard(parsed);
    repairDone({ status: ok ? 'ok' : 'schema_mismatch' });
    return ok ? parsed : null;
  } catch (e) {
    repairDone({ status: 'error', error: errorMessage(e) });
    return null;
  }
}

async function parseOrRepair<T>(
  model: ModelRef,
  text: string,
  guard: (v: unknown) => v is T,
  perf?: PerfContext
): Promise<T> {
  try {
    const parsed = extractJson(text);
    if (guard(parsed)) return parsed;
    throw new AiError('El JSON no cumple el esquema esperado');
  } catch (e) {
    const repaired = await repairJson(model, text, e, guard, perf);
    if (repaired) return repaired;
    throw e;
  }
}

/**
 * JSON completion that retries (lower temperature, then no JSON mode) only when text
 * came back but failed to parse. A provider/transport failure (timeout, empty, etc.)
 * aborts on the first attempt so a hung provider can't stall for minutes.
 * Uses the given model override or the configured synthesis model.
 */
export async function completeJson<T>(
  opts: CallOpts,
  guard: (v: unknown) => v is T,
  model?: ModelRef | null
): Promise<T> {
  const resolved = resolveModel(model);
  const langOpts = withPromptContext(opts);
  // JSON/structured calls (scans, extraction) default to reasoning off for speed.
  const reasoning = langOpts.reasoning ?? 'off';
  let lastErr: unknown;
  const attempts = [
    { temperature: langOpts.temperature ?? 0.15, jsonMode: true },
    { temperature: 0, jsonMode: true },
    { temperature: 0, jsonMode: false },
  ];
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const retryDone = startPerf('JSON retry', langOpts.perf, { attempt: i + 1, jsonMode: attempt.jsonMode });
    let text: string;
    try {
      text = await rawComplete(resolved, { ...langOpts, temperature: attempt.temperature }, attempt.jsonMode, reasoning);
    } catch (e) {
      // Provider/transport failure (timeout, empty response, rate limit, 5xx, bad key).
      // Each call can burn the full 180s timeout, so looping here would let a hung
      // provider stall for minutes. The JSON retries below only help when text DID come
      // back but failed to parse — so on a transport failure, abort immediately.
      retryDone({ status: 'error', error: errorMessage(e), retry: false });
      throw e;
    }
    try {
      const parsed = await parseOrRepair(resolved, text, guard, langOpts.perf);
      if (i > 0) retryDone({ status: 'ok' });
      return parsed;
    } catch (e) {
      retryDone({ status: 'error', error: errorMessage(e), retry: i < attempts.length - 1 });
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiError('Fallo de parseo JSON');
}

/** Plain-text completion for conversational assistant responses. */
export async function completeText(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  return rawComplete(resolved, withPromptContext(opts), false, reasoning);
}

/**
 * Plain-text completion that does NOT apply the output-language directive. Use this
 * for tasks that must fully control their own output language (e.g. translation),
 * where forcing English/Spanish would defeat the purpose.
 */
export async function completeTextNeutral(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? 'off';
  return rawComplete(resolved, opts, false, reasoning);
}

/** Plain-text streaming completion. The returned string is the full accumulated answer. */
export async function completeTextStream(
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  model?: ModelRef | null,
  signal?: AbortSignal
): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  return rawCompleteStream(resolved, withPromptContext(opts), onDelta, reasoning, signal);
}

async function rawCompleteStream(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal
): Promise<string> {
  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

  let full = '';
  // Content deltas accumulate into the returned answer; reasoning deltas are streamed
  // for live display only and never become part of the saved answer.
  const emitContent = (delta: string | null | undefined) => {
    if (!delta) return;
    full += delta;
    onDelta(delta, 'content');
  };
  const emitReasoning = (delta: string | null | undefined) => {
    if (!delta) return;
    onDelta(delta, 'reasoning');
  };

  if (model.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: key });
    try {
      const stream = await (client.messages.create as any)(
        {
          model: model.model,
          max_tokens: opts.maxTokens ?? 8000,
          temperature: opts.temperature ?? 0.15,
          system: opts.system,
          stream: true,
          messages: [{ role: 'user', content: opts.user }],
        },
        { signal }
      );
      for await (const event of stream as AsyncIterable<any>) {
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') emitContent(event.delta.text);
        else if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') emitReasoning(event.delta.thinking);
        else if (event?.type === 'text') emitContent(event.text);
      }
    } catch (e: any) {
      // A user-triggered stop surfaces as an abort here — keep the partial answer
      // that already streamed instead of failing the whole turn.
      if (signal?.aborted) return full;
      throw wrapProviderError(e);
    }
    if (!full.trim()) throw new AiError('Respuesta vacía del proveedor de IA.', false);
    return full;
  }

  const baseURL = openAiCompatBase(model.provider);
  // See rawComplete: fit the request to a local model's real context window.
  const requestedMax = opts.maxTokens ?? 8000;
  const maxTokens = isLocalProvider(model.provider) ? await localMaxTokens(model, opts, requestedMax) : requestedMax;
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: 180_000,
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const baseBody = {
    model: model.model,
    temperature: opts.temperature ?? 0.15,
    max_tokens: maxTokens,
    stream: true as const,
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.user },
    ],
  };
  // Streaming is plain text (no JSON mode); only reasoning + routing apply.
  const extras = optionalBody(model, false, reasoning);
  try {
    let stream;
    try {
      stream = await client.chat.completions.create({ ...baseBody, ...extras } as any, { signal });
    } catch (e: any) {
      if (isBadRequest(e) && Object.keys(extras).length > 0) {
        stream = await client.chat.completions.create(baseBody as any, { signal });
      } else {
        throw e;
      }
    }
    for await (const chunk of stream as any) {
      if (chunk?.error) {
        const msg = chunk.error.message ?? 'Error del proveedor durante el streaming.';
        // LM Studio/llama.cpp report a too-large prompt mid-stream; reword it actionably.
        if (isLocalProvider(model.provider) && isContextOverflow(msg)) {
          throw new AiError(contextOverflowMessage(model.provider, model.model, null, null), false, true);
        }
        throw new AiError(msg, false);
      }
      const delta = chunk?.choices?.[0]?.delta;
      // Reasoning trace: OpenRouter exposes `reasoning`, DeepSeek `reasoning_content`.
      emitReasoning(delta?.reasoning ?? delta?.reasoning_content);
      emitContent(delta?.content);
    }
  } catch (e: any) {
    // A user-triggered stop surfaces as an abort here — keep the partial answer.
    if (signal?.aborted) return full;
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
  if (!full.trim()) throw new AiError('Respuesta vacía del proveedor de IA.', false);
  return full;
}

function embeddingConfig(): { provider: EmbeddingProvider; modelId: string } {
  const settings = getSettings();
  const provider = settings.embeddingProvider ?? 'openai';
  return {
    provider,
    modelId: normalizeEmbeddingModel(provider, settings.embeddingModel || DEFAULT_EMBEDDING_MODELS[provider]),
  };
}

async function requestEmbeddings(provider: EmbeddingProvider, key: string, modelId: string, input: string | string[]): Promise<number[][]> {
  const baseURL = openAiCompatBase(provider) ?? undefined;
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL,
    defaultHeaders:
      provider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://github.com/Drakonis96/nodus',
            'X-Title': 'Nodus',
          }
        : undefined,
  });
  const res = await client.embeddings.create({ model: modelId, input });
  return [...res.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

/**
 * Embeddings for idea fusion. Uses the embedding provider selected in Settings.
 * Returns null when unavailable — fusion then stays conservative (treats ideas
 * as new).
 */
export async function embed(text: string): Promise<number[] | null> {
  const { provider, modelId } = embeddingConfig();
  const key = resolveProviderKey(provider);
  if (!key) return null;
  try {
    const vectors = await requestEmbeddings(provider, key, modelId, text.slice(0, 8000));
    return vectors[0] ?? null;
  } catch {
    return null;
  }
}

export async function embedMany(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const clipped = texts.map((t) => t.slice(0, 8000));
  const { provider, modelId } = embeddingConfig();
  const key = resolveProviderKey(provider);
  if (!key) return texts.map(() => null);

  // Gemini Embedding 2's native API aggregates multiple inputs; the OpenAI
  // compatibility endpoint can evolve, so keep this path one-text-per-call.
  if (provider === 'gemini' && /embedding-2/i.test(modelId)) {
    return Promise.all(clipped.map((text) => embed(text)));
  }

  try {
    const vectors = await requestEmbeddings(provider, key, modelId, clipped);
    if (vectors.length === clipped.length) return vectors;
  } catch {
    /* fall back below */
  }
  return Promise.all(clipped.map((text) => embed(text)));
}
