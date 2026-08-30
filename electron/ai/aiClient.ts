import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import {
  openAiCompatBase,
  supportsJsonMode,
  reasoningBody,
  samplingTemperatureBody,
  openRouterRoutingBody,
  OPENROUTER_HEADERS,
  isLocalProvider,
  localContextWindow,
  FREE_TIER_PROVIDERS,
  freeTierMaxTokens,
  groqFreeTpm,
  isGroqReasoningModel,
} from './providers';
import { DEFAULT_EMBEDDING_MODELS, normalizeEmbeddingModel, PROVIDER_LABELS } from '@shared/providers';
import type { AiProvider, CodexReasoningEffort, EmbeddingProvider, LocalProvider, ModelRef, PromptLanguage, ReasoningEffort } from '@shared/types';
import { vaultTypePromptPack } from '@shared/vaultTypes';
import { codexReasoningFor } from '@shared/codexReasoning';
import { anthropicVisionContent, openAiVisionContent, type VisionImagePart } from '@shared/imageAnalysis';
import { getActiveVault } from '../vaults/vaultRegistry';
import { jsonrepair } from 'jsonrepair';
import { perfLogNs, startPerf, type PerfContext } from '../perf';
import {
  embedWithNodusLocal,
  ensureNodusLocalServer,
  getNodusLocalSafeSlots,
  withNodusLocalServerLease,
} from './nodusLocalAi';
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
import { completeWithOpenCodeGo, OUTPUT_TRUNCATED_MARKER } from './openCodeGoCompletion';
import { recordOpenCodeGoUsage } from './openCodeGoUsage';
import { AI_MODEL_REQUIRED_ERROR_CODE } from '@shared/aiModelRequired';
import { createHash } from 'node:crypto';
import {
  AiRequestScheduler,
  type AiRequestClass,
  type AiRequestDescriptor,
} from './aiRequestGate';
import type { AiConcurrencySnapshot } from '@shared/types';
import { orderedEmbeddingEntries, requestEmbeddingBatchWithBisection, validateEmbeddingVectors } from './strictEmbeddings';
import {
  geminiBatchEmbeddingEndpoint,
  geminiBatchEmbeddingRequest,
  parseGeminiBatchEmbeddingResponse,
} from './geminiEmbeddings';
import { completeGeminiDeterministicJson } from './geminiDeterministicCompletion';
import { withTransportDeadline } from './transportDeadline';

const concurrencyListeners = new Set<(snapshots: AiConcurrencySnapshot[]) => void>();
const concurrencyTelemetry = new Map<string, string>();

function concurrencyPolicy(descriptor: AiRequestDescriptor) {
  const settings = getSettings();
  const manualLimit = Math.max(1, Math.min(8, Math.trunc(settings.concurrency || 1)));
  if (settings.aiConcurrencyMode !== 'automatic') {
    return { mode: 'manual' as const, initial: manualLimit, maximum: manualLimit, manualLimit };
  }
  if (settings.providerFreeTier?.[descriptor.provider as AiProvider]) {
    return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
  }
  // Only providers that pass the release campaign receive the accelerated 4→8
  // policy. Every other remote surface remains serial even though the UI default
  // is Automatic; certification can widen this allowlist in a later release.
  if (descriptor.provider === 'gemini' || descriptor.provider === 'deepseek') {
    return { mode: 'automatic' as const, initial: 4, maximum: 8, manualLimit };
  }
  if (descriptor.provider === 'nodus') {
    return { mode: 'automatic' as const, initial: 1, maximum: getNodusLocalSafeSlots(descriptor.model), manualLimit };
  }
  if (descriptor.provider === 'ollama' || descriptor.provider === 'lmstudio') {
    return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
  }
  return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
}

const aiRequestScheduler = new AiRequestScheduler({
  globalLimit: 12,
  policyFor: concurrencyPolicy,
  onSnapshot: (snapshots) => {
    for (const snapshot of snapshots) {
      const key = `${snapshot.provider}\u0000${snapshot.model}`;
      const fingerprint = JSON.stringify({
        currentLimit: snapshot.currentLimit,
        maximumLimit: snapshot.maximumLimit,
        cooldownUntil: snapshot.cooldownUntil,
        lastChangeReason: snapshot.lastChangeReason,
      });
      if (concurrencyTelemetry.get(key) === fingerprint) continue;
      concurrencyTelemetry.set(key, fingerprint);
      perfLogNs('AI concurrency change', 0n, {}, {
        provider: snapshot.provider,
        model: snapshot.model,
        active: snapshot.active,
        queued: snapshot.queued,
        currentLimit: snapshot.currentLimit,
        maximumLimit: snapshot.maximumLimit,
        cooldownUntil: snapshot.cooldownUntil,
        reason: snapshot.lastChangeReason,
      });
    }
    for (const listener of concurrencyListeners) listener(snapshots);
  },
});

export function getAiConcurrencySnapshot(): AiConcurrencySnapshot[] {
  return aiRequestScheduler.snapshots();
}

export function refreshAiConcurrencyPolicy(): void {
  aiRequestScheduler.reconfigure();
}

export function onAiConcurrencySnapshot(listener: (snapshots: AiConcurrencySnapshot[]) => void): () => void {
  concurrencyListeners.add(listener);
  return () => concurrencyListeners.delete(listener);
}

function credentialScope(provider: string, key: string | null, endpoint?: string | null): string {
  return createHash('sha256').update(`${provider}\u0000${key ?? 'subscription'}\u0000${endpoint ?? ''}`).digest('hex').slice(0, 16);
}

function providerRequestDescriptor(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
): AiRequestDescriptor {
  return {
    provider: model.provider,
    model: model.model,
    credentialScope: credentialScope(model.provider, key, endpoint),
    endpoint,
    requestClass: opts.requestClass ?? 'interactive',
    estimatedInputTokens: estimateTokens(opts.system) + estimateTokens(opts.user),
    estimatedOutputTokens: opts.maxTokens,
    signal: opts.signal,
    jobId: opts.jobId,
  };
}

function observeProviderQuota(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
  headers: Headers,
): void {
  aiRequestScheduler.observeQuota(providerRequestDescriptor(model, opts, key, endpoint), headers);
}

function scheduleProviderRequest<T>(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const queuedAt = process.hrtime.bigint();
  const requestHash = providerRequestHash(model, opts);
  return aiRequestScheduler.run(providerRequestDescriptor(model, opts, key, endpoint), async () => {
    const startedAt = process.hrtime.bigint();
    const meta = {
      provider: model.provider,
      model: model.model,
      class: opts.requestClass ?? 'interactive',
      jobId: opts.jobId ?? null,
      requestHash,
    };
    perfLogNs('AI queue wait', startedAt - queuedAt, opts.perf, meta);
    try {
      return await task();
    } finally {
      perfLogNs('AI inference', process.hrtime.bigint() - startedAt, opts.perf, meta);
    }
  });
}

function providerRequestHash(model: ModelRef, opts: CallOpts): string {
  return createHash('sha256').update(JSON.stringify({
    provider: model.provider,
    model: model.model,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature ?? null,
    maxTokens: opts.maxTokens ?? null,
    reasoning: opts.reasoning ?? null,
    deterministic: opts.deterministic ?? false,
    images: opts.images?.map((part) => ({
      mediaType: part.mediaType,
      sha256: createHash('sha256').update(part.base64).digest('hex'),
    })) ?? [],
  })).digest('hex');
}

export class AiError extends Error {
  /**
   * @param retriable transient provider error (rate limit / 5xx) — worth a backoff retry.
   * @param config    misconfiguration (no model / no key) — the SAME for every job, so the
   *                  queue should pause and surface it once instead of failing every item.
   */
  constructor(
    message: string,
    public retriable = false,
    public config = false,
    public code: 'output_truncated' | 'invalid_json' | 'timeout' | 'provider_empty_error' | typeof AI_MODEL_REQUIRED_ERROR_CODE | null = null,
  ) {
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
 * How long one non-streaming completion may take before the transport gives up.
 *
 * A cloud provider that has said nothing for three minutes is stuck: it runs the model
 * on hardware sized for it, and the request is billed whether or not we keep waiting.
 * A model on the user's own laptop is a different animal — the wait IS the work. Idea
 * extraction asks for up to 8.000 JSON tokens per chunk, which at the 15-40 tokens/s a
 * quantized 7B reaches on an M-series is 200-530 seconds of perfectly healthy
 * generation. Under one shared 180s ceiling that arrived as "timed out waiting for the
 * AI provider" on every chunk, which is why local models could produce Themes (1.500
 * tokens, one call) and never Ideas. Nothing is billed by the second here and the deep
 * scan ticks a heartbeat while it waits, so the local budget is generous; it stays
 * finite because a wedged local server must not hold the scan queue open forever.
 */
const CLOUD_COMPLETION_TIMEOUT_MS = 180_000;
const ON_DEVICE_COMPLETION_TIMEOUT_MS = 900_000;

/** True when the model runs on this machine: the built-in runtime, or a local server. */
function runsOnDevice(provider: AiProvider): boolean {
  return provider === 'nodus' || isLocalProvider(provider);
}

export function completionTimeoutMs(model: ModelRef): number {
  return runsOnDevice(model.provider) ? ON_DEVICE_COMPLETION_TIMEOUT_MS : CLOUD_COMPLETION_TIMEOUT_MS;
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
  /** Cooperative cancellation for long-running corpus jobs. */
  signal?: AbortSignal;
  /** Images to attach for vision models (base64 + media type). */
  images?: VisionImagePart[];
  /** Skip the vault-type prompt pack (keep only the output-language directive). Used
   *  for tasks that need consistent output regardless of vault type (image analysis). */
  plainContext?: boolean;
  /** Opt out of student pseudonymisation for a call that provably carries no roster
   *  data. Deliberately explicit: see electron/ai/studentPrivacyContext.ts. */
  skipStudentPseudonyms?: true;
  /** Scheduler priority. Background pipelines must opt in explicitly. */
  requestClass?: AiRequestClass;
  /** Stable, content-free identifier used only for diagnostics/checkpoints. */
  jobId?: string;
  /**
   * Ask a provider with a native seed contract to make a best effort at producing
   * the same structured result for the same frozen request. Extraction uses this;
   * creative and conversational calls deliberately do not.
   */
  deterministic?: boolean;
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
  it: 'ITALIANO (Italiano)',
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
    pack = vaultTypePromptPack(getActiveVault().type, getSettings().promptLanguage ?? 'es');
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
    throw new AiError('No hay un modelo de IA configurado. Elige uno en Ajustes.', false, true, AI_MODEL_REQUIRED_ERROR_CODE);
  }
  return def;
}

/** Public wrapper so prompt-assembly code (e.g. the research chat) can resolve the same
 *  effective model the completion calls will use, to size its payload accordingly. */
export function resolveModelRef(override?: ModelRef | null): ModelRef {
  return resolveModel(override);
}

/**
 * The Codex reasoning level this call runs at, or null to leave it to the provider.
 * The role's own choice travels on the `ModelRef` the caller handed us, so the level a
 * user set beside one task's picker cannot leak into another task that happens to run
 * the same model; the Providers tab's per-model entry remains the default underneath.
 */
function configuredCodexReasoning(model: ModelRef): CodexReasoningEffort | null {
  return codexReasoningFor(model, getSettings().codexReasoningEfforts);
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
  const auditedOpenRouterProvider = process.env.NODUS_AUDIT_OPENROUTER_PROVIDER?.trim();
  return {
    ...(jsonMode && supportsJsonMode(model.provider) ? { response_format: { type: 'json_object' as const } } : {}),
    ...reasoningBody(model.provider, reasoning, model.model),
    // Groq's reasoning models (gpt-oss/qwen3) reason at medium by default, which slows scans and
    // burns tokens. reasoningBody can't send it (no model id), so minimise it here. Groq rejects
    // reasoning_effort:'none' — 'low' is its floor; non-reasoning models 400 and the caller strips it.
    ...(model.provider === 'groq' && reasoning === 'off' && isGroqReasoningModel(model.model)
      ? { reasoning_effort: 'low' as const }
      : {}),
    ...(model.provider === 'openrouter'
      ? auditedOpenRouterProvider
        ? { provider: { only: [auditedOpenRouterProvider], allow_fallbacks: false } }
        : openRouterRoutingBody(getSettings().openRouterThroughput)
      : {}),
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

/**
 * Only retry a 400 when the provider explicitly names an unsupported optional
 * transport field. A generic 400 can be an ambiguous timeout or rejected payload;
 * replaying it would violate the no-blind-retry contract and may double-charge.
 */
function rejectsOptionalTransportField(e: any): boolean {
  if ((e?.status ?? e?.response?.status) !== 400) return false;
  const message = String(e?.error?.message ?? e?.message ?? '');
  return /(?:unknown|unrecognized|unsupported|not supported|extra|invalid)\s+(?:field|parameter|argument)|response_format|reasoning_effort|include_reasoning|provider\.only|allow_fallbacks/i.test(message);
}

/** True for provider throttling. OpenRouter also uses 529 when the selected
 * upstream is temporarily over capacity and can attach the same retry hints. */
function isRateLimited(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  return status === 429 || status === 529;
}

/** How long to wait after a 429, from Retry-After/reset headers, bounded to 15 minutes. */
function retryAfterMs(e: any): number {
  const h = e?.headers;
  const raw = typeof h?.get === 'function'
    ? h.get('retry-after') ?? h.get('x-ratelimit-reset')
    : h?.['retry-after'] ?? h?.['x-ratelimit-reset'];
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) {
    const duration = secs > 1_000_000_000 ? secs * 1000 - Date.now() : secs * 1000;
    return Math.max(0, Math.min(15 * 60_000, Math.ceil(duration)));
  }
  const parsed = Date.parse(String(raw ?? ''));
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(15 * 60_000, parsed - Date.now()));
  return 3_000; // provider gave no usable hint — a short, bounded pause
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** True for a provider 5xx: the request did not run, so repeating it is not a double charge. */
function isTransientServerError(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  return typeof status === 'number' && status >= 500 && status < 600;
}

/**
 * Run a provider call, absorbing the two failures that are not the caller's fault.
 *
 * · 429 (rate limit): sólo en las capas gratuitas se espera el Retry-After, hasta cuatro
 *   veces. En una cuenta de pago el error sube y lo gestiona el backoff de la cola.
 * · 5xx: se reintenta SIEMPRE, dos veces con espera creciente. Un 503 puntual del
 *   proveedor no debe tumbar una operación larga —corregir una transcripción de trescientos
 *   tramos, indexar un corpus— cuando la petición ni siquiera llegó a ejecutarse. Y por eso
 *   mismo no es doble facturación: no hubo primera.
 */
async function withProviderRetries<T>(
  freeTier: boolean,
  make: () => Promise<T>,
  signal?: AbortSignal,
  allowRetries = true,
): Promise<T> {
  // Automatic mode owns rate recovery for paid providers too. Each `make` call
  // reacquires the scheduler, so these waits never consume useful capacity.
  const maxRateWaits = allowRetries && (freeTier || getSettings().aiConcurrencyMode === 'automatic') ? 4 : 0;
  const maxServerRetries = allowRetries ? 2 : 0;
  let serverRetries = 0;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await make();
    } catch (e) {
      if (attempt < maxRateWaits && isRateLimited(e)) {
        await sleep(retryAfterMs(e), signal);
        continue;
      }
      if (serverRetries < maxServerRetries && isTransientServerError(e)) {
        await sleep(500 * (serverRetries + 1) ** 2, signal);
        serverRetries += 1;
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
  return rawCompleteTransport(model, opts, jsonMode, reasoning, codexReasoning);
}

async function rawCompleteTransport(
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
      return await scheduleProviderRequest(model, opts, null, 'codex-subscription', () => completeWithChatGptSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning: codexReasoning === undefined ? reasoning : codexReasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal: opts.signal,
      }));
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  if (model.provider === 'github-copilot') {
    try {
      return await scheduleProviderRequest(model, opts, null, 'github-copilot-subscription', () => completeWithGitHubCopilotSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal: opts.signal,
      }));
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);

  if (model.provider === 'opencode-go') {
    try {
      const result = await scheduleProviderRequest(model, opts, key, 'opencode-go', () => completeWithOpenCodeGo({
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
        signal: opts.signal,
      }));
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
      const res = await scheduleProviderRequest(model, opts, key, 'anthropic', () => client.messages.create({
        model: model.model,
        max_tokens: opts.maxTokens ?? 8000,
        temperature: opts.temperature ?? 0.15,
        system: opts.system,
        messages: [
          { role: 'user', content: opts.images?.length ? (anthropicVisionContent(opts.user, opts.images) as any) : opts.user },
        ],
      }, { signal: opts.signal }));
      const block = res.content.find((b: any) => b.type === 'text');
      if (jsonMode && (res as any).stop_reason === 'max_tokens') {
        throw new AiError(truncatedJsonMessage(model, opts.maxTokens ?? 8000), true, false, 'output_truncated');
      }
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
  const schedulerEndpoint = model.provider === 'nodus' ? 'nodus-local-runtime' : baseURL;

  // Google's OpenAI compatibility layer does not expose GenerationConfig.seed. For
  // extraction, use the native endpoint so identical manual/automatic requests do not
  // receive a fresh random seed merely because they were dispatched at a different
  // time. Seed is documented as best-effort, so schema validation and fail-closed
  // chunk recovery remain mandatory.
  if (model.provider === 'gemini' && jsonMode && opts.deterministic) {
    const requestHash = providerRequestHash(model, opts);
    const seed = Number.parseInt(requestHash.slice(0, 8), 16) & 0x7fffffff;
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/native';
    try {
      const result = await scheduleProviderRequest(model, opts, key, endpoint, () =>
        completeGeminiDeterministicJson({
          apiKey: key,
          model: model.model,
          system: opts.system,
          user: opts.user,
          temperature: opts.temperature ?? 0.15,
          maxTokens,
          seed,
          timeoutMs: opts.timeoutMs ?? completionTimeoutMs(model),
          signal: opts.signal,
          images: opts.images,
        }));
      if (result.headers) observeProviderQuota(model, opts, key, endpoint, result.headers);
      perfLogNs('AI response metadata', 0n, opts.perf, {
        provider: model.provider,
        model: model.model,
        class: opts.requestClass ?? 'interactive',
        jobId: opts.jobId ?? null,
        requestHash,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        deterministicSeed: seed,
      });
      if (result.finishReason === 'MAX_TOKENS') {
        throw new AiError(truncatedJsonMessage(model, maxTokens), true, false, 'output_truncated');
      }
      if (!result.text.trim()) {
        throw new AiError(`Respuesta vacía del proveedor de IA (${result.finishReason ?? 'sin finish_reason'}).`, false);
      }
      return result.text;
    } catch (error: any) {
      if (error instanceof AiError) throw error;
      throw wrapProviderError(error);
    }
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: opts.timeoutMs ?? completionTimeoutMs(model),
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const createCompletion = (body: any) => model.provider === 'nodus'
    ? withNodusLocalServerLease(model.model, 'chat', async (apiUrl) => {
      const timeoutMs = opts.timeoutMs ?? completionTimeoutMs(model);
      const result = await withTransportDeadline(timeoutMs, opts.signal, (signal) => new OpenAI({
          apiKey: key,
          baseURL: apiUrl,
          timeout: timeoutMs,
          maxRetries: 0,
        }).chat.completions.create(body, { signal }).withResponse());
      observeProviderQuota(model, opts, key, schedulerEndpoint, result.response.headers);
      return result.data;
    })
    : withTransportDeadline(opts.timeoutMs ?? completionTimeoutMs(model), opts.signal, (signal) =>
      client.chat.completions.create(body, { signal }).withResponse()).then((result) => {
      observeProviderQuota(model, opts, key, schedulerEndpoint, result.response.headers);
      return result.data;
    });
  const baseBody = {
    model: model.model,
    ...samplingTemperatureBody(model.provider, model.model, opts.temperature ?? 0.15),
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
      res = await withProviderRetries(freeTier, () => scheduleProviderRequest(
        model, opts, key, schedulerEndpoint, () => createCompletion({ ...baseBody, ...extras } as any),
      ), opts.signal, !opts.noRetry);
    } catch (e: any) {
      // The optional reasoning/JSON/routing params may be unsupported by this model.
      // Retry once as a plain request before surfacing the error.
      if (!opts.noRetry && rejectsOptionalTransportField(e) && Object.keys(extras).length > 0) {
        res = await withProviderRetries(freeTier, () => scheduleProviderRequest(
          model, opts, key, schedulerEndpoint, () => createCompletion({
            ...baseBody,
            ...(model.provider === 'openrouter' && process.env.NODUS_AUDIT_OPENROUTER_PROVIDER?.trim()
              ? { provider: (extras as any).provider }
              : {}),
          } as any),
        ), opts.signal, !opts.noRetry);
      } else {
        throw e;
      }
    }
    const choice = res.choices[0];
    perfLogNs('AI response metadata', 0n, opts.perf, {
      provider: model.provider,
      model: model.model,
      class: opts.requestClass ?? 'interactive',
      jobId: opts.jobId ?? null,
      requestHash: providerRequestHash(model, opts),
      backend: typeof (res as any).provider === 'string' ? (res as any).provider : null,
      inputTokens: Number((res as any).usage?.prompt_tokens) || null,
      outputTokens: Number((res as any).usage?.completion_tokens) || null,
    });
    const content = choice?.message?.content ?? '';
    // A structured response cut off at the output ceiling is not partial data, it is
    // broken data: extractJson's jsonrepair pass closes the dangling braces without a
    // word, so the caller silently stores a fraction of the ideas — or trips the schema
    // guard and reports "el JSON no cumple el esquema esperado", which sends the reader
    // hunting for a prompt bug that isn't there. Refuse instead. Prose (jsonMode=false)
    // stays untouched: a clipped sentence is still usable, an unterminated object is not.
    if (jsonMode && choice?.finish_reason === 'length') {
      throw new AiError(truncatedJsonMessage(model, maxTokens), true, false, 'output_truncated');
    }
    // Some mandatory-reasoning models can spend the complete output allowance before
    // emitting the first JSON character. Test `finish_reason` before the generic empty
    // response guard so chunk-aware callers can recover by bisecting the input instead
    // of treating a recoverable truncation as a terminal provider failure.
    if (!content.trim()) {
      if ((choice as any)?.finish_reason === 'error') {
        // OpenRouter can surface an upstream failure as a syntactically successful
        // HTTP response with an empty choice. Unlike an ambiguous timeout, the server
        // has explicitly said that no completion was produced, so an exact bounded
        // replay is safe and cannot duplicate a usable result.
        throw new AiError('El backend de IA terminó la solicitud sin producir respuesta.', true, false, 'provider_empty_error');
      }
      throw new AiError(`Respuesta vacía del proveedor de IA (${choice?.finish_reason ?? 'sin finish_reason'}).`, false);
    }
    return content;
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
}

function wrapProviderError(e: any): AiError {
  // Only OUR OWN cutoff errors are re-typed. Matching prose used to catch anything that
  // said "truncated" — an upstream gateway timeout was enough to send a deep scan
  // doubling its budget and splitting a chunk to chase a network hiccup.
  const message: string = e?.message ?? '';
  if (message.includes(OUTPUT_TRUNCATED_MARKER)) {
    return new AiError(message.replace(new RegExp(`^${OUTPUT_TRUNCATED_MARKER}:\\s*`), '') || 'La respuesta JSON quedó truncada.', true, false, 'output_truncated');
  }
  const status = e?.status ?? e?.response?.status;
  // A prompt that overflows the model's context window can arrive at various statuses
  // (400 from local servers, 400/413 from cloud). Reword it before status-based mapping
  // so the user gets an actionable message instead of a raw "n_keep >= n_ctx".
  if (isContextOverflow(e?.error?.message ?? e?.message)) {
    return new AiError(genericContextOverflowMessage(), false, true);
  }
  // Tagged, not merely worded: the deep scan answers a timeout by splitting the chunk
  // (less to generate → it fits), which it must not do for an unrelated failure.
  if (e?.name?.includes('Timeout') || /timeout|timed out/i.test(e?.message ?? '')) {
    return new AiError('Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.', false, false, 'timeout');
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

/**
 * True when the text ends inside an unclosed JSON structure — the response was cut off.
 *
 * The provider's own signal is checked first everywhere it exists (`finish_reason`,
 * `stop_reason`), but the subscription runtimes (codex, github-copilot) return a bare
 * string with no signal at all. Without this, `extractJson` slices to the last `}` — the
 * end of the last COMPLETE inner object — and jsonrepair closes the remains into
 * something the schema guard happily accepts, so a chunk cut in half is checkpointed as
 * a success and its ideas are lost with no error anywhere.
 */
function endsMidJson(text: string): boolean {
  const start = text.indexOf('{');
  if (start === -1) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let closed = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) closed = true;
    }
  }
  return inString || depth > 0 || !closed;
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

async function parseOrRepair<T>(
  model: ModelRef,
  text: string,
  guard: (v: unknown) => v is T,
  maxTokens?: number,
): Promise<T> {
  if (endsMidJson(text)) {
    throw new AiError(truncatedJsonMessage(model, maxTokens ?? 0), true, false, 'output_truncated');
  }
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (parseError) {
    // extractJson already attempts deterministic local repair. Anything still invalid
    // must be resampled from the frozen request; a remote repair prompt could invent
    // fields and would invalidate manual-versus-automatic comparisons.
    throw new AiError(`JSON inválido: ${errorMessage(parseError)}`, false, false, 'invalid_json');
  }
  if (guard(parsed)) return parsed;
  // Well-formed JSON that misses the schema is also resampled without changing the
  // prompt, model, temperature, context or output budget.
  throw new AiError('El JSON no cumple el esquema esperado');
}

/**
 * JSON completion retries the exact same request only when text came back but failed
 * validation. It never changes prompt, temperature, JSON mode, context, output budget,
 * model or provider as a hidden recovery strategy. Provider/transport failures
 * (timeout, empty, etc.) abort on the first attempt so an ambiguous request is not
 * blindly replayed.
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
  // An explicit level chosen for this role (or for the model in Providers) is honoured
  // here too, or the selector beside the extraction and scan pickers would silently
  // govern nothing. Absent a choice this stays undefined and `off` keeps driving, so
  // the fast default for a corpus-wide run is unchanged.
  const codexReasoning = configuredCodexReasoning(resolved) ?? undefined;
  let lastErr: unknown;
  const attempts = langOpts.noRetry ? 1 : 3;
  for (let i = 0; i < attempts; i++) {
    langOpts.signal?.throwIfAborted();
    const retryDone = startPerf('JSON retry', langOpts.perf, { attempt: i + 1, jsonMode: true, invariantRequest: true });
    let text: string;
    try {
      text = await rawComplete(resolved, langOpts, true, reasoning, codexReasoning);
    } catch (e) {
      const explicitEmptyProviderFailure = e instanceof AiError && e.code === 'provider_empty_error';
      if (explicitEmptyProviderFailure && i < attempts - 1) {
        retryDone({ status: 'error', error: errorMessage(e), retry: true });
        lastErr = e;
        continue;
      }
      // Provider/transport failure (timeout, empty response, rate limit, 5xx, bad key).
      // Each call can burn the full 180s timeout, so looping here would let a hung
      // provider stall for minutes. The JSON retries below only help when text DID come
      // back but failed to parse — so on a transport failure, abort immediately.
      retryDone({ status: 'error', error: errorMessage(e), retry: false });
      throw e;
    }
    try {
      // A different repair prompt would violate the invariant request contract and
      // could invent data. Reject and resample the frozen request instead.
      const parsed = await parseOrRepair(resolved, text, guard, langOpts.maxTokens);
      if (i > 0) retryDone({ status: 'ok' });
      return deanonymizeResult(parsed);
    } catch (e) {
      // Replaying a response that already consumed the full output budget cannot
      // make it fit. Surface it immediately so chunk-aware callers can bisect the
      // input; invariant resampling remains useful only for malformed/schema JSON.
      const outputTruncated = e instanceof AiError && e.code === 'output_truncated';
      retryDone({ status: 'error', error: errorMessage(e), retry: !outputTruncated && i < attempts - 1 });
      if (outputTruncated) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiError('Fallo de parseo JSON');
}

/** Plain-text completion for conversational assistant responses. */
export async function completeText(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
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
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
    : undefined;
  return rawCompleteStream(resolved, withPromptContext(opts), onDelta, reasoning, signal, codexReasoning);
}

/**
 * Streaming completion that leaves the output language entirely to the caller.
 * Conversational surfaces whose language follows the latest user turn use this
 * instead of inheriting the vault-wide promptLanguage override.
 */
export async function completeTextStreamNeutral(
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  model?: ModelRef | null,
  signal?: AbortSignal
): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
    : undefined;
  return rawCompleteStream(resolved, opts, onDelta, reasoning, signal, codexReasoning);
}

async function rawCompleteStream(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal,
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  return rawCompleteStreamTransport(model, opts, onDelta, reasoning, signal, codexReasoning);
}

async function rawCompleteStreamTransport(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal,
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  const { sent, privacy } = anonymizeCallOpts(opts);
  opts = sent;
  const scheduleOpts = { ...opts, signal: signal ?? opts.signal };

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
      const answer = await scheduleProviderRequest(model, scheduleOpts, null, 'codex-subscription', () => completeWithChatGptSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning: codexReasoning === undefined ? reasoning : codexReasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
      }));
      if (!full && answer) emitContent(answer);
      return finish();
    } catch (error) {
      if (signal?.aborted) return finish();
      throw subscriptionError(error);
    }
  }

  if (model.provider === 'github-copilot') {
    try {
      const answer = await scheduleProviderRequest(model, scheduleOpts, null, 'github-copilot-subscription', () => completeWithGitHubCopilotSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
        onReasoningDelta: emitReasoning,
      }));
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
      const result = await scheduleProviderRequest(model, scheduleOpts, key, 'opencode-go', () => completeWithOpenCodeGo({
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
      }));
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
      await scheduleProviderRequest(model, scheduleOpts, key, 'anthropic', async () => {
        const stream = await (client.messages.create as any)({
          model: model.model,
          max_tokens: opts.maxTokens ?? 8000,
          temperature: opts.temperature ?? 0.15,
          system: opts.system,
          stream: true,
          messages: [{ role: 'user', content: opts.user }],
        }, { signal });
        for await (const event of stream as AsyncIterable<any>) {
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') emitContent(event.delta.text);
          else if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') emitReasoning(event.delta.thinking);
          else if (event?.type === 'text') emitContent(event.text);
        }
      });
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
  const streamTimeoutMs = opts.timeoutMs ?? completionTimeoutMs(model);
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: streamTimeoutMs,
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const baseBody = {
    model: model.model,
    ...samplingTemperatureBody(model.provider, model.model, opts.temperature ?? 0.15),
    ...completionTokensBody(model, maxTokens),
    stream: true as const,
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  // Streaming is plain text (no JSON mode); only reasoning + routing apply.
  const extras = optionalBody(model, false, reasoning);
  const schedulerEndpoint = model.provider === 'nodus' ? 'nodus-local-runtime' : baseURL;
  const consumeStream = async (
    streamClient: InstanceType<typeof OpenAI>,
    body: any,
    transportSignal: AbortSignal,
  ): Promise<void> => {
    const contentBefore = full.length;
    try {
      const result = await streamClient.chat.completions.create(body, { signal: transportSignal }).withResponse();
      observeProviderQuota(model, scheduleOpts, key, schedulerEndpoint, result.response.headers);
      const stream = result.data;
      for await (const chunk of stream as any) {
        if (chunk?.error) {
          const msg = chunk.error.message ?? 'Error del proveedor durante el streaming.';
          if (isLocalProvider(model.provider) && isContextOverflow(msg)) {
            throw new AiError(contextOverflowMessage(model.provider, model.model, null, null), false, true);
          }
          throw new AiError(msg, false);
        }
        const delta = chunk?.choices?.[0]?.delta;
        emitReasoning(delta?.reasoning ?? delta?.reasoning_content);
        emitContent(delta?.content);
      }
    } catch (error) {
      // A timeout after deltas is ambiguous: retrying would duplicate already emitted
      // content. Re-type it without raw status so the retry layer cannot repeat it.
      if (full.length > contentBefore && !(error instanceof AiError)) throw wrapProviderError(error);
      throw error;
    }
  };
  const executeStream = (body: any) => withTransportDeadline(
    streamTimeoutMs,
    signal ?? opts.signal,
    (transportSignal) => model.provider === 'nodus'
      ? withNodusLocalServerLease(model.model, 'chat', (apiUrl) => consumeStream(new OpenAI({
          apiKey: key, baseURL: apiUrl, timeout: streamTimeoutMs, maxRetries: 0,
        }), body, transportSignal))
      : consumeStream(client, body, transportSignal),
  );
  try {
    try {
      await withProviderRetries(freeTier, () => scheduleProviderRequest(
        model, scheduleOpts, key, schedulerEndpoint,
        () => executeStream({ ...baseBody, ...extras } as any),
      ), signal, !opts.noRetry);
    } catch (e: any) {
      if (rejectsOptionalTransportField(e) && Object.keys(extras).length > 0) {
        await withProviderRetries(freeTier, () => scheduleProviderRequest(
          model, scheduleOpts, key, schedulerEndpoint,
          () => executeStream({
            ...baseBody,
            ...(model.provider === 'openrouter' && process.env.NODUS_AUDIT_OPENROUTER_PROVIDER?.trim()
              ? { provider: (extras as any).provider }
              : {}),
          } as any),
        ), signal, !opts.noRetry);
      } else {
        throw e;
      }
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

interface EmbeddingRequestOptions {
  perf?: PerfContext;
  jobId?: string;
}

async function requestEmbeddings(
  provider: EmbeddingProvider,
  key: string,
  modelId: string,
  input: string | string[],
  signal?: AbortSignal,
  options: EmbeddingRequestOptions = {},
): Promise<number[][]> {
  const expected = Array.isArray(input) ? input.length : 1;
  const validate = (vectors: number[][]): number[][] => {
    try { return validateEmbeddingVectors(vectors, expected, modelId); }
    catch (error) { throw new AiError(error instanceof Error ? error.message : String(error), false); }
  };
  signal?.throwIfAborted();
  const endpoint = provider === 'nodus'
    ? 'nodus-local-runtime'
    : provider === 'gemini'
      ? geminiBatchEmbeddingEndpoint(modelId)
      : openAiCompatBase(provider) ?? undefined;
  const descriptor: AiRequestDescriptor = {
    provider,
    model: modelId,
    credentialScope: credentialScope(provider, key, endpoint),
    endpoint,
    requestClass: 'embedding',
    estimatedInputTokens: (Array.isArray(input) ? input : [input]).reduce((sum, value) => sum + estimateTokens(value), 0),
    signal,
    jobId: options.jobId,
  };
  const runEmbeddingRequest = <T>(task: () => Promise<T>): Promise<T> => {
    const queuedAt = process.hrtime.bigint();
    const requestHash = createHash('sha256').update(JSON.stringify({
      provider,
      model: modelId,
      input: Array.isArray(input) ? input : [input],
    })).digest('hex');
    return aiRequestScheduler.run(descriptor, async () => {
      const startedAt = process.hrtime.bigint();
      const meta = { provider, model: modelId, class: 'embedding', inputs: expected, jobId: options.jobId ?? null, requestHash };
      perfLogNs('AI queue wait', startedAt - queuedAt, options.perf, meta);
      try { return await task(); }
      finally { perfLogNs('AI inference', process.hrtime.bigint() - startedAt, options.perf, meta); }
    });
  };
  if (provider === 'nodus') {
    return validate(await runEmbeddingRequest(() => embedWithNodusLocal(modelId, input, signal)));
  }
  const freeTier = isProviderFreeTier(provider);
  if (provider === 'gemini') {
    const texts = Array.isArray(input) ? input : [input];
    const nativeEndpoint = endpoint!;
    try {
      const vectors = await withProviderRetries(freeTier, () => runEmbeddingRequest(async () => {
        const timeoutController = new AbortController();
        const timeout = setTimeout(
          () => timeoutController.abort(new DOMException('Gemini embedding request timed out.', 'TimeoutError')),
          completionTimeoutMs({ provider, model: modelId }),
        );
        const abortFromCaller = () => timeoutController.abort(signal?.reason);
        signal?.addEventListener('abort', abortFromCaller, { once: true });
        try {
          const response = await fetch(nativeEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify(geminiBatchEmbeddingRequest(modelId, texts)),
            signal: timeoutController.signal,
          });
          aiRequestScheduler.observeQuota(descriptor, response.headers);
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            const detail = body && typeof body === 'object'
              ? (body as any).error?.message ?? JSON.stringify(body)
              : `HTTP ${response.status}`;
            const error = new Error(String(detail || `HTTP ${response.status}`)) as Error & {
              status: number;
              headers: Headers;
              error?: { message: string };
            };
            error.status = response.status;
            error.headers = response.headers;
            error.error = { message: String(detail || '') };
            throw error;
          }
          return parseGeminiBatchEmbeddingResponse(body);
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abortFromCaller);
        }
      }), signal);
      return validate(vectors);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AiError) throw error;
      throw wrapProviderError(error);
    }
  }
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: endpoint,
    defaultHeaders:
      provider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://github.com/Drakonis96/nodus',
            'X-Title': 'Nodus',
          }
        : undefined,
  });
  try {
    const res = await withProviderRetries(freeTier, () => runEmbeddingRequest(async () => {
      const result = await client.embeddings.create({ model: modelId, input }, { signal }).withResponse();
      aiRequestScheduler.observeQuota(descriptor, result.response.headers);
      return result.data;
    }), signal);
    return orderedEmbeddingEntries(res.data.map((entry) => ({ index: entry.index, embedding: entry.embedding })), expected, modelId);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof AiError) throw error;
    const wrapped = wrapProviderError(error);
    if (wrapped.config || wrapped.retriable || wrapped.code === 'timeout') throw wrapped;
    throw new AiError(error instanceof Error ? error.message : String(error), false);
  }
}

/**
 * Embeddings for idea fusion. Uses the embedding provider selected in Settings.
 * Returns null only when no embedding credential exists. Once configured, errors
 * are explicit: callers must checkpoint/retry rather than degrade silently.
 */
export async function embed(text: string, signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<number[] | null> {
  signal?.throwIfAborted();
  const { provider, modelId } = embeddingConfig();
  const key = resolveProviderKey(provider);
  if (!key) return null;
  const vectors = await requestEmbeddings(provider, key, modelId, text.slice(0, 8000), signal, options);
  return vectors[0] ?? null;
}

function embeddingBatchSize(provider: EmbeddingProvider, modelId: string): number {
  if (provider === 'nodus') return 64;
  if (provider === 'gemini' && /embedding-2/i.test(modelId)) return 1;
  if (provider === 'gemini') return 32;
  return 64;
}

async function embedBatchBisect(
  provider: EmbeddingProvider,
  key: string,
  modelId: string,
  texts: string[],
  signal?: AbortSignal,
  options: EmbeddingRequestOptions = {},
): Promise<number[][]> {
  return requestEmbeddingBatchWithBisection(
    texts,
    (batch) => requestEmbeddings(provider, key, modelId, batch, signal, options),
    signal,
    (error) => !(error instanceof AiError && (error.config || error.retriable)),
  );
}

/** Strict, ordered embedding batches. No configured input may disappear. */
export async function embedManyStrict(texts: string[], signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<number[][]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];
  const clipped = texts.map((t) => t.slice(0, 8000));
  const { provider, modelId } = embeddingConfig();
  const key = resolveProviderKey(provider);
  if (!key) throw new AiError(`Falta la clave de IA para embeddings (${provider}). Configúrala en Ajustes o usa el modo léxico.`, false, true);

  const size = embeddingBatchSize(provider, modelId);
  const batches: string[][] = [];
  for (let index = 0; index < clipped.length; index += size) batches.push(clipped.slice(index, index + size));
  const vectors = (await Promise.all(batches.map((batch, index) => embedBatchBisect(
    provider,
    key,
    modelId,
    batch,
    signal,
    { ...options, jobId: options.jobId ? `${options.jobId}:batch:${index}` : undefined },
  )))).flat();
  if (vectors.length !== texts.length) {
    throw new AiError(`La indexación produjo ${vectors.length} embeddings para ${texts.length} entradas; no se publicará un índice incompleto.`, false);
  }
  return vectors;
}

export async function embedMany(texts: string[], signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<(number[] | null)[]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];
  const { provider } = embeddingConfig();
  if (!resolveProviderKey(provider)) return texts.map(() => null);
  return embedManyStrict(texts, signal, options);
}
