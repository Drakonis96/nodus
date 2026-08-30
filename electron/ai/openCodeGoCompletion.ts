import type { ReasoningEffort } from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';

/**
 * Prefix that marks an output-ceiling cutoff. aiClient re-types errors carrying it as
 * `output_truncated` so the deep scan can widen or split the chunk. It is a stable token
 * rather than a phrase because matching prose classified unrelated failures as
 * truncation — an upstream gateway saying "output may have been truncated" was enough.
 */
export const OUTPUT_TRUNCATED_MARKER = 'NODUS_OUTPUT_TRUNCATED';

export type OpenCodeGoProtocol = 'openai' | 'anthropic' | 'responses';

export interface OpenCodeGoNormalizedUsage {
  uncachedInputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
}

export interface OpenCodeGoCompletionOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: ReasoningEffort;
  jsonMode?: boolean;
  timeoutMs?: number;
  images?: VisionImagePart[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  /** Test seam; production always uses the documented OpenCode Go endpoint. */
  baseUrl?: string;
}

export interface OpenCodeGoCompletionResult {
  text: string;
  usage: OpenCodeGoNormalizedUsage | null;
}

const ANTHROPIC_MODEL_PREFIXES = ['minimax-', 'qwen'];
const RESPONSES_MODEL_PREFIXES = ['grok-4.6', 'gpt-5.6-', 'muse-spark-'];

/** The official Go catalogue documents MiniMax/Qwen on Messages and the rest on
 * Chat Completions. Unknown future models use the OpenAI-compatible route unless
 * their family is explicitly one of the Messages families. */
export function openCodeGoProtocol(model: string): OpenCodeGoProtocol {
  const normalized = model.toLowerCase();
  if (RESPONSES_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'responses';
  return ANTHROPIC_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? 'anthropic'
    : 'openai';
}

function apiError(status: number, payload: unknown): Error & { status: number } {
  const detail = (() => {
    if (typeof payload === 'string') return payload;
    const body = payload as any;
    return body?.error?.message ?? body?.message ?? body?.error?.type ?? `HTTP ${status}`;
  })();
  return Object.assign(new Error(`OpenCode Go rechazó la solicitud: ${detail}`), { status });
}

/**
 * Status to attribute to an error delivered *inside* a 200 stream.
 *
 * `wrapProviderError` classifies by status, and the response status is 200 by the
 * time these arrive — so passing it through marked every mid-stream overload or rate
 * limit as permanent. Map the payload's own error type instead, and default to 502:
 * the request was accepted and the upstream failed afterwards, which is transient.
 */
function streamErrorStatus(payload: unknown): number {
  const body = payload as any;
  const kind = String(body?.error?.type ?? body?.error?.code ?? body?.type ?? '').toLowerCase();
  if (kind.includes('overload')) return 529;
  if (kind.includes('rate_limit') || kind.includes('quota')) return 429;
  if (kind.includes('authentication') || kind.includes('api_key') || kind.includes('permission')) return 401;
  if (kind.includes('invalid_request') || kind.includes('not_found')) return 400;
  return 502;
}

async function readError(response: Response): Promise<never> {
  const raw = await response.text();
  let payload: unknown = raw;
  try { payload = JSON.parse(raw); } catch { /* retain readable text */ }
  throw apiError(response.status, payload);
}

function linkedSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

async function* sseEvents(response: Response): AsyncGenerator<{ event: string | null; data: string }> {
  if (!response.body) throw new Error('OpenCode Go devolvió un stream vacío.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        let event: string | null = null;
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart());
      if (data.length) yield { event: null, data: data.join('\n') };
    }
  } finally {
    // Releasing the lock alone leaves the body undrained when the consumer throws
    // mid-stream (an inline error event), so the connection was leaked on exactly
    // the path that fires most often under load. Cancel first, then release.
    try { await reader.cancel(); } catch { /* already closed */ }
    reader.releaseLock();
  }
}

/**
 * OpenCode Go's Chat Completions surface forwards OpenAI's `reasoning_effort` to the
 * reasoning models in its catalogue — the streaming side already parses the
 * `reasoning`/`reasoning_content` deltas they send back. This used to be accepted as
 * an option and never read, so picking an effort silently did nothing.
 */
function reasoningExtras(reasoning: ReasoningEffort | undefined): Record<string, unknown> {
  return !reasoning || reasoning === 'off' ? {} : { reasoning_effort: reasoning };
}

/**
 * Send the optional params, and on a 400 retry once without them.
 *
 * The generic OpenAI path in `aiClient` has always done this, which is what makes it
 * safe to be optimistic about `response_format` and `reasoning_effort` on a mixed
 * catalogue. This branch returned before reaching that fallback, so a single model
 * rejecting an optional field turned every structured call into a hard failure.
 */
async function postWithOptionalExtras(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  body: Record<string, unknown>,
  extras: Record<string, unknown>
): Promise<Response> {
  const send = (payload: Record<string, unknown>) =>
    fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(payload) });

  const response = await send({ ...body, ...extras });
  if (response.status !== 400 || Object.keys(extras).length === 0) return response;
  // Discard the rejected body so the retry does not leak the connection.
  try { await response.body?.cancel(); } catch { /* already closed */ }
  return send(body);
}

function assertText(text: string): string {
  if (!text.trim()) throw new Error('OpenCode Go devolvió una respuesta vacía.');
  return text;
}

function openAiUsage(usage: any): OpenCodeGoNormalizedUsage | null {
  if (!usage) return null;
  const totalInput = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cachedRead = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
  return {
    uncachedInputTokens: Math.max(0, totalInput - cachedRead),
    outputTokens: Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? 0)),
    cachedReadTokens: Math.max(0, cachedRead),
    cachedWriteTokens: 0,
  };
}

function anthropicUsage(usage: any): OpenCodeGoNormalizedUsage | null {
  if (!usage) return null;
  return {
    // Anthropic's input_tokens excludes cache read/creation tokens.
    uncachedInputTokens: Math.max(0, Number(usage.input_tokens ?? 0)),
    outputTokens: Math.max(0, Number(usage.output_tokens ?? 0)),
    cachedReadTokens: Math.max(0, Number(usage.cache_read_input_tokens ?? 0)),
    cachedWriteTokens: Math.max(0, Number(usage.cache_creation_input_tokens ?? 0)),
  };
}

function responseText(body: any): string {
  if (typeof body?.output_text === 'string') return body.output_text;
  return (body?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((content: any) => content?.type === 'output_text' || content?.type === 'text')
    .map((content: any) => content?.text ?? '')
    .join('');
}

function responsesInstructions(options: OpenCodeGoCompletionOptions): string {
  return options.jsonMode
    ? `${options.system}\n\nReturn only a single valid JSON value. No prose, no explanation, no Markdown code fences.`
    : options.system;
}

function responsesTruncated(body: any): boolean {
  const reason = String(body?.incomplete_details?.reason ?? body?.response?.incomplete_details?.reason ?? '').toLowerCase();
  return body?.status === 'incomplete' || body?.response?.status === 'incomplete'
    ? reason.includes('max_output') || reason.includes('max_token') || !reason
    : false;
}

/** OpenCode documents Muse Spark (plus its GPT/Grok catalogue entries) on the
 * OpenAI Responses surface, not Chat Completions. Keep this transport distinct:
 * silently sending those models to /chat/completions produces misleading 404/400
 * failures and prevents a fair provider benchmark. */
async function completeResponses(options: OpenCodeGoCompletionOptions, url: string, signal: AbortSignal): Promise<OpenCodeGoCompletionResult> {
  const streaming = Boolean(options.onDelta);
  const response = await postWithOptionalExtras(
    `${url}/v1/responses`,
    { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal,
    {
      model: options.model,
      instructions: responsesInstructions(options),
      input: options.user,
      max_output_tokens: options.maxTokens ?? 8_000,
      stream: streaming,
    },
    {
      ...(options.temperature == null ? {} : { temperature: options.temperature }),
      ...(!options.reasoning || options.reasoning === 'off'
        ? {}
        : { reasoning: { effort: options.reasoning } }),
    },
  );
  if (!response.ok) return readError(response);

  if (!streaming) {
    const body = await response.json() as any;
    if (body?.error || body?.status === 'failed') throw apiError(response.status, body);
    if (options.jsonMode && responsesTruncated(body)) {
      throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
    }
    return { text: assertText(responseText(body)), usage: openAiUsage(body?.usage) };
  }

  let text = '';
  let usage: OpenCodeGoNormalizedUsage | null = null;
  let incomplete = false;
  for await (const event of sseEvents(response)) {
    let chunk: any;
    try { chunk = JSON.parse(event.data); } catch { continue; }
    const kind = String(chunk?.type ?? event.event ?? '');
    if (kind === 'error' || kind === 'response.failed' || chunk?.error) {
      throw apiError(streamErrorStatus(chunk), chunk);
    }
    if (kind === 'response.output_text.delta' && typeof chunk?.delta === 'string') {
      text += chunk.delta;
      options.onDelta?.(chunk.delta);
    } else if ((kind === 'response.reasoning_text.delta' || kind === 'response.reasoning_summary_text.delta')
      && typeof chunk?.delta === 'string') {
      options.onReasoningDelta?.(chunk.delta);
    }
    if (kind === 'response.incomplete' || responsesTruncated(chunk)) incomplete = true;
    usage = openAiUsage(chunk?.response?.usage ?? chunk?.usage) ?? usage;
  }
  if (options.jsonMode && incomplete) {
    throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
  }
  return { text: assertText(text), usage };
}

async function completeOpenAi(options: OpenCodeGoCompletionOptions, url: string, signal: AbortSignal): Promise<OpenCodeGoCompletionResult> {
  const streaming = Boolean(options.onDelta);
  const response = await postWithOptionalExtras(
    `${url}/v1/chat/completions`,
    { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal,
    {
      model: options.model,
      temperature: options.temperature ?? 0.15,
      max_tokens: options.maxTokens ?? 8_000,
      stream: streaming,
      ...(streaming ? { stream_options: { include_usage: true } } : {}),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
    },
    {
      ...reasoningExtras(options.reasoning),
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }
  );
  if (!response.ok) return readError(response);

  if (!streaming) {
    const body = await response.json() as any;
    if (body?.error) throw apiError(response.status, body);
    const choice = body?.choices?.[0];
    if (options.jsonMode && choice?.finish_reason === 'length') {
      throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
    }
    return { text: assertText(choice?.message?.content ?? ''), usage: openAiUsage(body?.usage) };
  }

  let text = '';
  let usage: OpenCodeGoNormalizedUsage | null = null;
  let finishReason: string | null = null;
  for await (const event of sseEvents(response)) {
    if (event.data === '[DONE]') continue;
    let chunk: any;
    try { chunk = JSON.parse(event.data); } catch { continue; }
    if (chunk?.error) throw apiError(streamErrorStatus(chunk), chunk);
    const delta = chunk?.choices?.[0]?.delta;
    const reasoning = delta?.reasoning ?? delta?.reasoning_content;
    if (typeof reasoning === 'string') options.onReasoningDelta?.(reasoning);
    if (typeof delta?.content === 'string' && delta.content) {
      text += delta.content;
      options.onDelta?.(delta.content);
    }
    finishReason = chunk?.choices?.[0]?.finish_reason ?? finishReason;
    usage = openAiUsage(chunk?.usage) ?? usage;
  }
  if (options.jsonMode && finishReason === 'length') {
    throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
  }
  return { text: assertText(text), usage };
}

async function completeAnthropic(options: OpenCodeGoCompletionOptions, url: string, signal: AbortSignal): Promise<OpenCodeGoCompletionResult> {
  const streaming = Boolean(options.onDelta);
  const isQwen = options.model.toLowerCase().startsWith('qwen');
  const response = await fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: options.model,
      // The Messages surface has no `response_format`, so the only way to honour
      // jsonMode on this route is to ask in words. Without it the flag was inert
      // here while the Chat Completions route enforced it — the same request shape
      // behaved differently depending on which model the caller happened to pick.
      system: options.jsonMode
        ? `${options.system}\n\nReturn only a single valid JSON value. No prose, no explanation, no Markdown code fences.`
        : options.system,
      temperature: options.temperature ?? 0.15,
      max_tokens: options.maxTokens ?? 8_000,
      stream: streaming,
      // Qwen's hybrid-thinking mode is enabled by default on OpenCode Go. If the
      // caller selected "off", make that intent explicit on the Messages surface:
      // otherwise hidden thinking consumes the shared max_tokens budget and can
      // truncate an otherwise valid structured response. OpenCode accepts the
      // Anthropic-compatible disabled form for Qwen; do not send it to unrelated
      // Messages models whose gateways may reject the extension.
      ...(isQwen && options.reasoning === 'off' ? { thinking: { type: 'disabled' } } : {}),
      messages: [{ role: 'user', content: options.user }],
    }),
  });
  if (!response.ok) return readError(response);

  if (!streaming) {
    const body = await response.json() as any;
    if (body?.error) throw apiError(response.status, body);
    if (options.jsonMode && body?.stop_reason === 'max_tokens') {
      throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
    }
    const text = (body?.content ?? []).filter((block: any) => block?.type === 'text').map((block: any) => block.text ?? '').join('');
    return { text: assertText(text), usage: anthropicUsage(body?.usage) };
  }

  let text = '';
  let inputUsage: any = null;
  let outputUsage: any = null;
  let stopReason: string | null = null;
  for await (const event of sseEvents(response)) {
    let chunk: any;
    try { chunk = JSON.parse(event.data); } catch { continue; }
    if (chunk?.type === 'error' || chunk?.error) throw apiError(streamErrorStatus(chunk), chunk);
    if (chunk?.type === 'message_start') inputUsage = chunk.message?.usage ?? inputUsage;
    if (chunk?.type === 'message_delta') {
      outputUsage = chunk.usage ?? outputUsage;
      stopReason = chunk.delta?.stop_reason ?? stopReason;
    }
    if (chunk?.type === 'content_block_delta' && chunk.delta?.type === 'thinking_delta') {
      options.onReasoningDelta?.(chunk.delta.thinking ?? '');
    }
    if (chunk?.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && chunk.delta.text) {
      text += chunk.delta.text;
      options.onDelta?.(chunk.delta.text);
    }
  }
  if (options.jsonMode && stopReason === 'max_tokens') {
    throw new Error(`${OUTPUT_TRUNCATED_MARKER}: OpenCode Go cortó la respuesta al alcanzar el límite de salida y el JSON quedó incompleto.`);
  }
  return { text: assertText(text), usage: anthropicUsage({ ...(inputUsage ?? {}), ...(outputUsage ?? {}) }) };
}

/** Direct use of OpenCode's documented Go endpoints. No OpenCode CLI, browser
 * session or private Console cookie is involved. */
export async function completeWithOpenCodeGo(options: OpenCodeGoCompletionOptions): Promise<OpenCodeGoCompletionResult> {
  if (options.images?.length) {
    throw new Error('El catálogo público de OpenCode Go no anuncia entrada de imágenes para estos modelos.');
  }
  const linked = linkedSignal(options.signal, options.timeoutMs ?? 180_000);
  const baseUrl = (options.baseUrl ?? 'https://opencode.ai/zen/go').replace(/\/+$/, '');
  try {
    const protocol = openCodeGoProtocol(options.model);
    if (protocol === 'anthropic') return await completeAnthropic(options, baseUrl, linked.signal);
    if (protocol === 'responses') return await completeResponses(options, baseUrl, linked.signal);
    return await completeOpenAi(options, baseUrl, linked.signal);
  } catch (error) {
    if (linked.signal.aborted && !options.signal?.aborted) {
      throw new Error('OpenCode Go no completó la petición dentro del tiempo esperado.');
    }
    throw error;
  } finally {
    linked.dispose();
  }
}
