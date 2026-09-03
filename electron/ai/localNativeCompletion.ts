import type { LocalProvider } from '@shared/types';

export interface LocalNativeRequest {
  provider: LocalProvider;
  baseUrl: string;
  key: string | null;
  model: string;
  system: string;
  user: string;
  temperature: number;
  contextTokens: number;
  outputTokens: number;
  jsonMode: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  deterministic?: boolean;
}

export interface LocalNativeResult {
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export class LocalNativeUnavailableError extends Error {}

function headers(key: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

interface NativeResponseHandle {
  response: Response;
  cleanup: () => void;
}

async function postJson(url: string, body: unknown, request: LocalNativeRequest): Promise<NativeResponseHandle> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Local native completion timeout')), request.timeoutMs);
  const cleanup = () => {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(request.key),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { response, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function errorFor(res: Response): Promise<Error & { status?: number; error?: { message: string } }> {
  const raw = await res.text();
  let message = raw || `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? message;
  } catch { /* keep text */ }
  const error = new Error(String(message)) as Error & { status?: number; error?: { message: string } };
  error.status = res.status;
  error.error = { message: String(message) };
  return error;
}

async function ollama(request: LocalNativeRequest): Promise<LocalNativeResult> {
  const body = {
    model: request.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    stream: false,
    ...(request.jsonMode ? { format: 'json' } : {}),
    think: false,
    options: {
      temperature: request.temperature,
      num_ctx: request.contextTokens,
      num_predict: request.outputTokens,
      ...(request.deterministic ? { seed: 0 } : {}),
    },
  };
  const handle = await postJson(`${request.baseUrl}/api/chat`, body, request);
  try {
    const res = handle.response;
    if (res.status === 404 || res.status === 405) throw new LocalNativeUnavailableError('Ollama native chat unavailable');
    if (!res.ok) throw await errorFor(res);
    const data = await res.json() as any;
    return {
      text: String(data?.message?.content ?? ''),
      finishReason: data?.done_reason ?? (data?.done ? 'stop' : undefined),
      inputTokens: Number(data?.prompt_eval_count) || undefined,
      outputTokens: Number(data?.eval_count) || undefined,
    };
  } finally {
    handle.cleanup();
  }
}

function lmStudioText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  if (typeof data?.response === 'string') return data.response;
  if (typeof data?.message?.content === 'string') return data.message.content;
  const output = Array.isArray(data?.output) ? data.output : [];
  return output.flatMap((item: any) => {
    // Native v1 returns reasoning and assistant messages as sibling output items.
    // Reasoning is not part of the answer and may itself contain JSON fragments.
    if (item?.type && item.type !== 'message') return [];
    if (typeof item?.content === 'string') return [item.content];
    if (!Array.isArray(item?.content)) return [];
    return item.content
      .filter((part: any) => part?.type !== 'reasoning')
      .map((part: any) => part?.text ?? part?.content ?? '')
      .filter(Boolean);
  }).join('');
}

async function lmStudio(request: LocalNativeRequest): Promise<LocalNativeResult> {
  const baseBody = {
    model: request.model,
    system_prompt: request.jsonMode
      ? `${request.system}\n\nReturn only one complete valid JSON value. No Markdown or prose.`
      : request.system,
    input: request.user,
    stream: false,
    temperature: request.temperature,
    context_length: request.contextTokens,
    max_output_tokens: request.outputTokens,
    store: false,
  };
  let handle = await postJson(`${request.baseUrl}/api/v1/chat`, { ...baseBody, reasoning: 'off' }, request);
  try {
    if (handle.response.status === 404 || handle.response.status === 405) {
      throw new LocalNativeUnavailableError('LM Studio native chat unavailable');
    }
    if (handle.response.status === 400) {
      const detail = await handle.response.clone().text();
      if (/reasoning|unknown field|unexpected/i.test(detail)) {
        handle.cleanup();
        handle = await postJson(`${request.baseUrl}/api/v1/chat`, baseBody, request);
      }
    }
    const res = handle.response;
    if (!res.ok) throw await errorFor(res);
    const data = await res.json() as any;
    const stats = data?.stats ?? data?.usage ?? {};
    const outputTokens = Number(stats?.total_output_tokens ?? stats?.output_tokens ?? stats?.completion_tokens) || undefined;
    const reportedFinishReason = data?.finish_reason ?? data?.stop_reason ?? data?.status;
    // LM Studio native v1 does not consistently expose a finish reason. Its total
    // output count includes reasoning, so equality with the allowance is the durable
    // signal for a model that spent the whole budget before emitting complete JSON.
    const finishReason = outputTokens != null && outputTokens >= request.outputTokens
      ? 'max_output_tokens'
      : reportedFinishReason;
    return {
      text: lmStudioText(data),
      finishReason,
      inputTokens: Number(stats?.input_tokens ?? stats?.prompt_tokens) || undefined,
      outputTokens,
      reasoningTokens: Number(stats?.reasoning_output_tokens ?? stats?.reasoning_tokens) || undefined,
    };
  } finally {
    handle.cleanup();
  }
}

export function completeLocalNative(request: LocalNativeRequest): Promise<LocalNativeResult> {
  return request.provider === 'ollama' ? ollama(request) : lmStudio(request);
}

async function consumeLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
  if (!response.body) throw new Error('El servidor local no devolvió un stream legible.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let finished = false;
  while (!finished) {
    const read = await reader.read();
    finished = read.done;
    pending += decoder.decode(read.value, { stream: !finished });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  }
  if (pending.trim()) onLine(pending);
}

export async function streamLocalNative(
  request: LocalNativeRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
): Promise<LocalNativeResult> {
  if (request.provider === 'ollama') {
    const handle = await postJson(`${request.baseUrl}/api/chat`, {
      model: request.model,
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
      stream: true,
      think: false,
      options: {
        temperature: request.temperature,
        num_ctx: request.contextTokens,
        num_predict: request.outputTokens,
      },
    }, request);
    try {
      const res = handle.response;
      if (res.status === 404 || res.status === 405) throw new LocalNativeUnavailableError('Ollama native stream unavailable');
      if (!res.ok) throw await errorFor(res);
      let text = '';
      let finishReason: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      await consumeLines(res, (line) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        const delta = String(event?.message?.content ?? '');
        if (delta) { text += delta; onDelta(delta, 'content'); }
        const thinking = String(event?.message?.thinking ?? '');
        if (thinking) onDelta(thinking, 'reasoning');
        finishReason = event?.done_reason ?? finishReason;
        inputTokens = Number(event?.prompt_eval_count) || inputTokens;
        outputTokens = Number(event?.eval_count) || outputTokens;
      });
      return { text, finishReason, inputTokens, outputTokens };
    } finally {
      handle.cleanup();
    }
  }

  const body = {
    model: request.model,
    system_prompt: request.system,
    input: request.user,
    stream: true,
    temperature: request.temperature,
    context_length: request.contextTokens,
    max_output_tokens: request.outputTokens,
    reasoning: 'off',
    store: false,
  };
  let handle = await postJson(`${request.baseUrl}/api/v1/chat`, body, request);
  try {
    if (handle.response.status === 404 || handle.response.status === 405) {
      throw new LocalNativeUnavailableError('LM Studio native stream unavailable');
    }
    if (handle.response.status === 400) {
      const detail = await handle.response.clone().text();
      if (/reasoning|unknown field|unexpected/i.test(detail)) {
        handle.cleanup();
        const { reasoning: _reasoning, ...compatibleBody } = body;
        handle = await postJson(`${request.baseUrl}/api/v1/chat`, compatibleBody, request);
      }
    }
    const res = handle.response;
    if (!res.ok) throw await errorFor(res);
    let text = '';
    let finishReason: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    await consumeLines(res, (line) => {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') return;
      const event = JSON.parse(raw);
      const type = String(event?.type ?? '');
      if (type === 'error') {
        throw new Error(String(event?.error?.message ?? 'LM Studio streaming error'));
      }
      if (type === 'message.delta') {
        const delta = String(event?.content ?? '');
        if (delta) { text += delta; onDelta(delta, 'content'); }
      } else if (type === 'reasoning.delta') {
        const delta = String(event?.content ?? '');
        if (delta) onDelta(delta, 'reasoning');
      }
      const finalResult = type === 'chat.end' ? event?.result : null;
      if (finalResult && !text) {
        const complete = lmStudioText(finalResult);
        if (complete) { text = complete; onDelta(complete, 'content'); }
      }
      const stats = finalResult?.stats ?? event?.stats ?? event?.usage ?? {};
      finishReason = event?.finish_reason ?? event?.stop_reason ?? finishReason;
      inputTokens = Number(stats?.input_tokens ?? stats?.prompt_tokens) || inputTokens;
      outputTokens = Number(stats?.total_output_tokens ?? stats?.output_tokens) || outputTokens;
      reasoningTokens = Number(stats?.reasoning_output_tokens ?? stats?.reasoning_tokens) || reasoningTokens;
    });
    return { text, finishReason, inputTokens, outputTokens, reasoningTokens };
  } finally {
    handle.cleanup();
  }
}
