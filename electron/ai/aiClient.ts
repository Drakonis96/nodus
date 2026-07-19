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
  FREE_TIER_PROVIDERS,
  freeTierMaxTokens,
  groqFreeTpm,
  isGroqReasoningModel,
} from './providers';
import { DEFAULT_EMBEDDING_MODELS, normalizeEmbeddingModel, PROVIDER_LABELS, supportsSamplingControls } from '@shared/providers';
import type { AiProvider, CodexReasoningEffort, EmbeddingProvider, LocalProvider, ModelRef, PromptLanguage, ReasoningEffort } from '@shared/types';
import { vaultTypePromptPack } from '@shared/vaultTypes';
import { anthropicVisionContent, openAiVisionContent, type VisionImagePart } from '@shared/imageAnalysis';
import { getActiveVault } from '../vaults/vaultRegistry';
import { jsonrepair } from 'jsonrepair';
import { startPerf, type PerfContext } from '../perf';
import { embedWithNodusLocal, ensureNodusLocalServer } from './nodusLocalAi';
import { getNodusLocalModel } from '@shared/localAiModels';
import { currentPrivacyScope, type ActivePrivacyScope } from './studentPrivacyContext';
import {
  anonymizeText,
  createStreamDeanonymizer,
  deanonymizeDeep,
  findResidualNames,
} from '@shared/studentPseudonyms';
import { classifyProviderError } from './providerErrors';
import { completeWithChatGptSubscription } from './codexSubscription';
import { completeWithGitHubCopilotSubscription } from './githubCopilotSubscription';
import { completeWithOpenCodeGo } from './openCodeGoCompletion';
import { recordOpenCodeGoUsage } from './openCodeGoUsage';

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

/** Subscription providers carry no HTTP status, so `wrapProviderError` cannot read
 *  them. They classify themselves instead — see `providerErrors.ts`. */
function subscriptionError(error: unknown): AiError {
  const { message, retriable, config } = classifyProviderError(error);
  return new AiError(message, retriable, config);
}

/**
 * The subscription runtimes accept no `response_format`, so JSON mode can only be
 * asked for in words. Without this `jsonMode` was silently inert for them and every
 * structured call leaned entirely on the repair round-trip.
 */
function withJsonModeDirective(system: string, jsonMode: boolean): string {
  if (!jsonMode) return system;
  return `${system}\n\nReturn only a single valid JSON value. No prose, no explanation, no Markdown code fences.`;
}

/** Stored key for a provider, or a harmless placeholder for local providers
 *  (Ollama / LM Studio need no key; the OpenAI SDK still requires a non-empty
 *  string). A user-supplied token for a secured local instance takes precedence. */
function resolveProviderKey(provider: AiProvider): string | null {
  const stored = getApiKey(provider);
  if (stored) return stored;
  return isLocalProvider(provider) || provider === 'nodus' ? 'local' : null;
}

// ── Local model context budgeting ────────────────────────────────────────────
// Cloud models expose huge context windows and manage the prompt server-side, so
// Nodus's large prompts (a scan can be tens of thousands of tokens) fit fine. Local
// servers load a model with a small, fixed window (LM Studio defaults to 4096), so
// the same prompt overflows with a cryptic "n_keep >= n_ctx". These helpers size
// max_tokens to the real window and refuse up front with an actionable message.

/** Smallest generation budget worth attempting; below this the window has no room. */
const MIN_LOCAL_GENERATION_TOKENS = 512;

/**
 * Pessimistic token estimate, used only by the local-model guards below.
 *
 * "~4 chars per token" describes English prose and nothing else, and these guards mostly see
 * the opposite: a database profile is `Fecha (number) · min 1945, max 2024`, ids like
 * `LV001-FG001`, URL-encoded paths like `BD%20Fotograf%C3%ADas`. Measured against qwen2.5,
 * that content runs at **2.4 chars/token** and URL-encoded runs at **1.7** — so the old
 * estimate was 41% low, the guard waved a 5,377-token prompt into a 4,096 window, and Ollama
 * silently dropped the middle. The model then answered a question about 7,172 rows from the
 * handful of sample rows that survived, confidently and wrongly.
 *
 * So this counts BPE-ish units instead of characters — a word run merges into roughly one
 * token per four characters, while punctuation and symbols usually cost one each — and then
 * pads by half. It overshoots plain prose by about 2x, which only ever costs an over-cautious
 * refusal carrying an actionable message; undershooting costs a wrong answer the user cannot
 * detect, which is the trade this exists to make.
 */
function estimateTokens(text: string): number {
  let units = 0;
  for (const m of text.matchAll(/[A-Za-z0-9]+|[^A-Za-z0-9\s]|\s+/g)) {
    const chunk = m[0];
    if (/\s/.test(chunk[0])) continue; // whitespace mostly merges into the next token
    units += /[A-Za-z0-9]/.test(chunk[0]) ? Math.max(1, Math.ceil(chunk.length / 4)) : 1;
  }
  return Math.ceil(units * 1.5);
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
 * Output ceiling hit mid-JSON: retrying the same request verbatim reproduces it, so this
 * has to say what the reader can actually change. On a local server that is the context
 * window and nothing else — the budget here is whatever is left of it after the prompt,
 * so a 4k window leaves ~1.7k for output while a full idea extraction wants ~7k, and no
 * amount of retrying closes that gap. Telling someone to "analyse a smaller fragment"
 * would be advice they cannot take: chunk sizes are fixed in code, not exposed in the UI.
 */
function truncatedJsonMessage(model: ModelRef, maxTokens: number): string {
  const label = PROVIDER_LABELS[model.provider] ?? model.provider;
  const cut = `La respuesta de «${model.model}» (${label}) se cortó al alcanzar el límite de ${maxTokens.toLocaleString('es')} tokens de salida y el JSON quedó incompleto.`;
  if (isLocalProvider(model.provider) || model.provider === 'nodus') {
    const knob = model.provider === 'ollama' ? 'num_ctx' : 'Context Length';
    return `${cut} El espacio de salida es lo que queda de la ventana de contexto tras el prompt: amplíala en ${label} (${knob}), elige un modelo local con más contexto o usa un proveedor en la nube para esta tarea.`;
  }
  return `${cut} Usa un modelo con mayor límite de salida o reduce el tamaño de la tarea.`;
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

function nodusLocalMaxTokens(model: ModelRef, opts: CallOpts, requestedMax: number): number {
  const ctx = getNodusLocalModel(model.model)?.contextLength ?? 8192;
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
  /** Let Codex use its per-model setting while retaining an explicit portable effort
   * for other providers (used by latency-sensitive conversational surfaces). */
  useConfiguredCodexReasoning?: boolean;
  /** Disable SDK/compatibility retries for explicitly single-attempt workflows. */
  noRetry?: boolean;
  /** Per-request transport timeout override. */
  timeoutMs?: number;
  /** Images to attach for vision models (base64 + media type). */
  images?: VisionImagePart[];
  /** Skip the vault-type prompt pack (keep only the output-language directive). Used
   *  for tasks that need consistent output regardless of vault type (image analysis). */
  plainContext?: boolean;
  /** Opt out of student pseudonymisation for a call that provably carries no roster
   *  data. Deliberately explicit: see electron/ai/studentPrivacyContext.ts. */
  skipStudentPseudonyms?: true;
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
  de: 'ALEMÁN (Deutsch)',
  pt: 'PORTUGUÉS DE PORTUGAL (português europeu)',
  'pt-BR': 'PORTUGUÉS DE BRASIL (português brasileiro)',
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
  if (model.provider === 'nodus') return getNodusLocalModel(model.model)?.contextLength ?? null;
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
    // Groq's reasoning models (gpt-oss/qwen3) reason at medium by default, which slows scans and
    // burns tokens. reasoningBody can't send it (no model id), so minimise it here. Groq rejects
    // reasoning_effort:'none' — 'low' is its floor; non-reasoning models 400 and the caller strips it.
    ...(model.provider === 'groq' && reasoning === 'off' && isGroqReasoningModel(model.model)
      ? { reasoning_effort: 'low' as const }
      : {}),
    ...(model.provider === 'openrouter' ? openRouterRoutingBody(getSettings().openRouterThroughput) : {}),
  };
}

/** Whether the user flagged this provider as free-tier (so requests get shaped to its limits). */
function isProviderFreeTier(provider: AiProvider): boolean {
  return FREE_TIER_PROVIDERS.includes(provider) && getSettings().providerFreeTier?.[provider] === true;
}

/**
 * The max_tokens for a free-tier request, or an actionable error when the prompt alone overflows the
 * provider's per-minute budget (Groq's small models can't hold a full scan chunk). Refusing here — as
 * a config error, so the queue pauses once — beats firing a request that just 413s "Request too large".
 */
function freeTierBudget(model: ModelRef, opts: CallOpts, localMax: number): number {
  const promptTokens = estimateTokens(opts.system) + estimateTokens(opts.user) + 16;
  const budget = freeTierMaxTokens(model.provider, model.model, promptTokens, localMax);
  if (budget <= 0) {
    throw new AiError(
      `El nivel gratuito de ${model.provider} (modelo «${model.model}») limita a ${groqFreeTpm(model.model)} tokens/min y este fragmento ya usa ~${promptTokens}. Elige un modelo con mayor límite (p.ej. llama-3.3-70b) o desmarca «Uso mi plan gratuito» para ese proveedor.`,
      false,
      true,
    );
  }
  return budget;
}

function openAiClientHeaders(model: ModelRef): Record<string, string> | undefined {
  return model.provider === 'openrouter' ? OPENROUTER_HEADERS : undefined;
}

/** Cerebras documents the current Chat Completions token cap as
 * `max_completion_tokens`; the other compatible providers used here accept the
 * legacy OpenAI `max_tokens` field. Keep the difference at the transport seam. */
function completionTokensBody(model: ModelRef, maxTokens: number): Record<string, number> {
  return model.provider === 'cerebras'
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

/** True for a provider 400 (bad request) — used to retry without the optional params. */
function isBadRequest(e: any): boolean {
  return (e?.status ?? e?.response?.status) === 400;
}

/** True for a provider 429 (rate limit) — worth waiting out on a free tier instead of failing. */
function isRateLimited(e: any): boolean {
  return (e?.status ?? e?.response?.status) === 429;
}

/** How long to wait after a 429, from the provider's Retry-After header (seconds), clamped to 60s. */
function retryAfterMs(e: any): number {
  const h = e?.headers;
  const raw = typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after'];
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) return Math.min(60_000, Math.ceil(secs * 1000));
  return 3_000; // provider gave no usable hint — a short, bounded pause
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a provider call, and — only on a free tier — wait out 429s (up to a few times) instead of
 * letting the rate limit fail the whole scan. Normal (paid) usage is unchanged: no retry, the error
 * propagates immediately so the queue's own backoff handles it.
 */
async function withFreeTierRateLimit<T>(freeTier: boolean, make: () => Promise<T>): Promise<T> {
  const maxWaits = freeTier ? 4 : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await make();
    } catch (e) {
      if (attempt < maxWaits && isRateLimited(e)) {
        await sleep(retryAfterMs(e));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Swaps student names for opaque codes when a teaching feature has opened a privacy
 * scope. Sits at the very top of both transports, ABOVE the provider branch, so local
 * and cloud are covered by the same code — the two diverge further down, and the
 * fallback model can flip a request from one to the other mid-flight.
 *
 * FAILS CLOSED. If anonymisation throws, or if a name that should have gone is still
 * in the payload, nothing is sent. The costs are wildly asymmetric: failing open turns
 * a bug into an undetectable, irreversible disclosure of minors' names to a third
 * party, while failing closed costs a blocked action with an obvious way out. A
 * privacy layer that silently degrades to no privacy is worse than none, because it
 * manufactures confidence.
 *
 * The residual check is what gives "fails closed" any teeth: the likely bug is not an
 * exception but a silent no-op — an empty scope, a regex that matched nothing — and a
 * no-op is indistinguishable from success without it.
 */
function anonymizeCallOpts(opts: CallOpts): { sent: CallOpts; privacy: ActivePrivacyScope | null } {
  if (opts.skipStudentPseudonyms) return { sent: opts, privacy: null };
  const privacy = currentPrivacyScope();
  if (!privacy) return { sent: opts, privacy: null };

  // Text substitution cannot redact a name written on a scanned exam, and silently
  // exempting images is exactly the leak this layer claims to prevent.
  if (opts.images?.length) {
    throw new AiError(
      'No se pueden enviar imágenes mientras la seudonimización del alumnado está activa: ' +
        'el nombre escrito en una imagen no se puede sustituir. Desactívala en Ajustes si aceptas el riesgo.',
      false
    );
  }

  const system = anonymizeText(opts.system, privacy.scope);
  const user = anonymizeText(opts.user, privacy.scope);
  privacy.warnings.push(...system.warnings, ...user.warnings);

  const residual = [
    ...findResidualNames(system.text, privacy.scope),
    ...findResidualNames(user.text, privacy.scope),
  ];
  if (residual.length) {
    throw new AiError(
      'No se pudo anonimizar el nombre del alumnado; la solicitud no se ha enviado. ' +
        'Revisa el listado del grupo o desactiva la seudonimización en Ajustes si aceptas el riesgo.',
      false
    );
  }

  return { sent: { ...opts, system: system.text, user: user.text }, privacy };
}

/**
 * Maps codes back to real names on the way in.
 *
 * FAILS OPEN, unlike the outbound half: by this point the payload has already been
 * transmitted, so withholding the answer protects nothing and destroys a result the
 * user has already paid for. An unresolvable code renders raw rather than being
 * guessed at.
 */
function deanonymizeResult<T>(value: T): T {
  const privacy = currentPrivacyScope();
  if (!privacy) return value;
  try {
    return deanonymizeDeep(value, privacy.scope);
  } catch {
    return value;
  }
}

async function rawComplete(
  model: ModelRef,
  opts: CallOpts,
  jsonMode = true,
  reasoning: ReasoningEffort = 'off',
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  // Student names must leave before any provider-specific branch. Subscription
  // providers do not use API keys, so this deliberately precedes key resolution.
  // The public entry points map the opaque codes back after parsing/repair.
  opts = anonymizeCallOpts(opts).sent;

  if (model.provider === 'codex') {
    try {
      return await completeWithChatGptSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning: codexReasoning === undefined ? reasoning : codexReasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
      });
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  if (model.provider === 'github-copilot') {
    try {
      return await completeWithGitHubCopilotSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
      });
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

  if (model.provider === 'opencode-go') {
    try {
      const result = await completeWithOpenCodeGo({
        apiKey: key,
        model: model.model,
        system: opts.system,
        user: opts.user,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        reasoning,
        jsonMode,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
      });
      await recordOpenCodeGoUsage(model.model, result.usage);
      return result.text;
    } catch (error: any) {
      throw wrapProviderError(error);
    }
  }

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
  const baseURL = model.provider === 'nodus'
    ? await ensureNodusLocalServer(model.model, 'chat')
    : openAiCompatBase(model.provider);
  // Local models load a small, fixed context window; size the request to it (and bail
  // early with an actionable error) instead of overflowing with a cryptic llama.cpp error.
  const requestedMax = opts.maxTokens ?? 8000;
  const localMax = model.provider === 'nodus'
    ? nodusLocalMaxTokens(model, opts, requestedMax)
    : isLocalProvider(model.provider) ? await localMaxTokens(model, opts, requestedMax) : requestedMax;
  // On a flagged free tier, shrink max_tokens so prompt + output fits the provider's per-minute
  // token budget (Groq) — otherwise the request 400s with "Request too large". No-op off free tier.
  const freeTier = isProviderFreeTier(model.provider);
  const maxTokens = freeTier ? freeTierBudget(model, opts, localMax) : localMax;
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
    ...completionTokensBody(model, maxTokens),
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  const extras = optionalBody(model, jsonMode, reasoning);
  try {
    let res;
    try {
      res = await withFreeTierRateLimit(freeTier, () => client.chat.completions.create({ ...baseBody, ...extras } as any));
    } catch (e: any) {
      // The optional reasoning/JSON/routing params may be unsupported by this model.
      // Retry once as a plain request before surfacing the error.
      if (!opts.noRetry && isBadRequest(e) && Object.keys(extras).length > 0) {
        res = await withFreeTierRateLimit(freeTier, () => client.chat.completions.create(baseBody as any));
      } else {
        throw e;
      }
    }
    const choice = res.choices[0];
    const content = choice?.message?.content ?? '';
    if (!content.trim()) {
      throw new AiError(`Respuesta vacía del proveedor de IA (${choice?.finish_reason ?? 'sin finish_reason'}).`, false);
    }
    // A structured response cut off at the output ceiling is not partial data, it is
    // broken data: extractJson's jsonrepair pass closes the dangling braces without a
    // word, so the caller silently stores a fraction of the ideas — or trips the schema
    // guard and reports "el JSON no cumple el esquema esperado", which sends the reader
    // hunting for a prompt bug that isn't there. Refuse instead. Prose (jsonMode=false)
    // stays untouched: a clipped sentence is still usable, an unterminated object is not.
    if (jsonMode && choice?.finish_reason === 'length') {
      throw new AiError(truncatedJsonMessage(model, maxTokens), false);
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
    const readable = detail && !/no body/i.test(detail) ? detail : null;
    // Not every provider answers a bad key with 401: Gemini returns 400 "Invalid Auth key.".
    if (readable && /invalid auth|api[ _-]?key|API_KEY_INVALID|unauthenticated|invalid credential/i.test(readable)) {
      return new AiError('Clave de IA inválida. Revísala en Ajustes.', false, true);
    }
    // With a readable reason, say it. Without one, say only what we know: Gemini returns its
    // error as a JSON array that the OpenAI SDK cannot parse, so its 400s arrive as "no body"
    // — and blaming the context size there sends someone with a mistyped key off to trim their
    // data. A 400 we cannot explain should name the likely causes, not pick one.
    if (readable) return new AiError(`El proveedor rechazó la solicitud (400). Detalle: ${readable}`, false);
    return new AiError(
      'El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.',
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
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (parseError) {
    // Genuinely unparseable output — extractJson already recovers code fences, prose
    // wrappers and truncation locally via jsonrepair, so reaching here means only a
    // repair round-trip can still salvage the text (e.g. two objects run together).
    const repaired = await repairJson(model, text, parseError, guard, perf);
    if (repaired) return repaired;
    throw parseError;
  }
  if (guard(parsed)) return parsed;
  // Well-formed JSON that misses the schema. repairJson asks the model for "the same
  // object as valid JSON, sin añadir campos, sin inventar datos" — instructions it
  // cannot follow and also fix a missing field, so it can only echo the mismatch back
  // and fail this same guard. Skip the billed call and let completeJson retry the real
  // prompt at a lower temperature, which is what actually recovers.
  throw new AiError('El JSON no cumple el esquema esperado');
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
  // Each rung escalates by lowering temperature, then by dropping JSON mode. A
  // provider that honours neither (the subscription runtimes) would send the exact
  // same request three times and bill three turns for it, so it gets one retry —
  // the only lever left there is a fresh sample — instead of two identical ones.
  const attempts = supportsSamplingControls(resolved.provider)
    ? [
        { temperature: langOpts.temperature ?? 0.15, jsonMode: true },
        { temperature: 0, jsonMode: true },
        { temperature: 0, jsonMode: false },
      ]
    : [
        { temperature: langOpts.temperature ?? 0.15, jsonMode: true },
        { temperature: langOpts.temperature ?? 0.15, jsonMode: true },
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
      return deanonymizeResult(parsed);
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
  const codexReasoning = resolved.provider === 'codex' && (opts.reasoning === undefined || opts.useConfiguredCodexReasoning)
    ? getSettings().codexReasoningEfforts?.[resolved.model] ?? null
    : undefined;
  return deanonymizeResult(await rawComplete(resolved, withPromptContext(opts), false, reasoning, codexReasoning));
}

/**
 * Plain-text completion that does NOT apply the output-language directive. Use this
 * for tasks that must fully control their own output language (e.g. translation),
 * where forcing English/Spanish would defeat the purpose.
 */
export async function completeTextNeutral(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? 'off';
  return deanonymizeResult(await rawComplete(resolved, opts, false, reasoning));
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
  const codexReasoning = resolved.provider === 'codex' && (opts.reasoning === undefined || opts.useConfiguredCodexReasoning)
    ? getSettings().codexReasoningEfforts?.[resolved.model] ?? null
    : undefined;
  return rawCompleteStream(resolved, withPromptContext(opts), onDelta, reasoning, signal, codexReasoning);
}

async function rawCompleteStream(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal,
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  const { sent, privacy } = anonymizeCallOpts(opts);
  opts = sent;

  let full = '';
  // Placeholders arrive split across chunk boundaries ("STU_" + "7K3Q"), so the reverse
  // mapping has to buffer rather than rewrite each delta on its own. Content and
  // reasoning are independent streams and MUST NOT share a rewriter.
  const contentRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;
  const reasoningRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;

  // Content deltas accumulate into the returned answer; reasoning deltas are streamed
  // for live display only and never become part of the saved answer.
  const emitContent = (delta: string | null | undefined) => {
    if (!delta) return;
    const text = contentRw ? contentRw.push(delta) : delta;
    if (!text) return; // the rewriter is holding a partial placeholder
    full += text;
    onDelta(text, 'content');
  };
  const emitReasoning = (delta: string | null | undefined) => {
    if (!delta) return;
    const text = reasoningRw ? reasoningRw.push(delta) : delta;
    if (!text) return;
    onDelta(text, 'reasoning');
  };

  /**
   * Drains both rewriters. This MUST run on every exit path, including the abort
   * returns below: an interrupted stream would otherwise silently lose its last few
   * characters. A `finally` block cannot do this job — `return full` evaluates before
   * `finally` runs, so the flushed text would never reach the caller.
   */
  const finish = (): string => {
    const restContent = contentRw?.flush();
    if (restContent) {
      full += restContent;
      onDelta(restContent, 'content');
    }
    const restReasoning = reasoningRw?.flush();
    if (restReasoning) onDelta(restReasoning, 'reasoning');
    return full;
  };

  if (model.provider === 'codex') {
    try {
      const answer = await completeWithChatGptSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning: codexReasoning === undefined ? reasoning : codexReasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
      });
      if (!full && answer) emitContent(answer);
      return finish();
    } catch (error) {
      if (signal?.aborted) return finish();
      throw subscriptionError(error);
    }
  }

  if (model.provider === 'github-copilot') {
    try {
      const answer = await completeWithGitHubCopilotSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
        onReasoningDelta: emitReasoning,
      });
      if (!full && answer) emitContent(answer);
      return finish();
    } catch (error) {
      if (signal?.aborted) return finish();
      throw subscriptionError(error);
    }
  }

  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

  if (model.provider === 'opencode-go') {
    try {
      const result = await completeWithOpenCodeGo({
        apiKey: key,
        model: model.model,
        system: opts.system,
        user: opts.user,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        reasoning,
        jsonMode: false,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
        onReasoningDelta: emitReasoning,
      });
      await recordOpenCodeGoUsage(model.model, result.usage);
      if (!full && result.text) emitContent(result.text);
      return finish();
    } catch (error: any) {
      if (signal?.aborted) return finish();
      throw wrapProviderError(error);
    }
  }

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
      if (signal?.aborted) return finish();
      throw wrapProviderError(e);
    }
    // Flush before the emptiness check: the held tail can be the whole answer.
    const answer = finish();
    if (!answer.trim()) throw new AiError('Respuesta vacía del proveedor de IA.', false);
    return answer;
  }

  const baseURL = model.provider === 'nodus'
    ? await ensureNodusLocalServer(model.model, 'chat')
    : openAiCompatBase(model.provider);
  // See rawComplete: fit the request to a local model's real context window.
  const requestedMax = opts.maxTokens ?? 8000;
  const localMax = model.provider === 'nodus'
    ? nodusLocalMaxTokens(model, opts, requestedMax)
    : isLocalProvider(model.provider) ? await localMaxTokens(model, opts, requestedMax) : requestedMax;
  const freeTier = isProviderFreeTier(model.provider);
  const maxTokens = freeTier ? freeTierBudget(model, opts, localMax) : localMax;
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
    ...completionTokensBody(model, maxTokens),
    stream: true as const,
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  // Streaming is plain text (no JSON mode); only reasoning + routing apply.
  const extras = optionalBody(model, false, reasoning);
  try {
    let stream;
    try {
      stream = await withFreeTierRateLimit(freeTier, () => client.chat.completions.create({ ...baseBody, ...extras } as any, { signal }));
    } catch (e: any) {
      if (isBadRequest(e) && Object.keys(extras).length > 0) {
        stream = await withFreeTierRateLimit(freeTier, () => client.chat.completions.create(baseBody as any, { signal }));
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
    if (signal?.aborted) return finish();
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
  // Flush before the emptiness check: the held tail can be the whole answer.
  const answer = finish();
  if (!answer.trim()) throw new AiError('Respuesta vacía del proveedor de IA.', false);
  return answer;
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
  if (provider === 'nodus') return embedWithNodusLocal(modelId, input);
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
