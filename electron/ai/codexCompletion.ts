import fs from 'node:fs';
import path from 'node:path';
import type { CodexReasoningEffort, ReasoningEffort } from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';
import { ProviderRuntimeError } from './providerErrors';

export interface CodexCompletionTransport {
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  onNotification(handler: (method: string, params: unknown) => void): () => void;
  /** Whether the underlying runtime is live. Best-effort cleanup is skipped when it
   *  is not, so tearing a turn down cannot respawn the process it belongs to. */
  isRunning?(): boolean;
}

export interface IsolatedCodexCompletionOptions {
  model: string;
  system: string;
  user: string;
  /** Already validated against the selected model's catalog. Null uses its default. */
  reasoning: CodexReasoningEffort | null;
  workdir: string;
  timeoutMs?: number;
  images?: VisionImagePart[];
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface CodexReasoningModelCapabilities {
  supportedReasoningEfforts?: Array<{ reasoningEffort: CodexReasoningEffort; description?: string }>;
  defaultReasoningEffort?: CodexReasoningEffort;
}

/**
 * Resolve portable Nodus reasoning into the exact per-model Codex catalog. A saved
 * option that disappeared after a catalog update safely falls back to the model
 * default (null); `off` selects the least expensive advertised effort.
 */
export function resolveCodexReasoningEffort(
  model: CodexReasoningModelCapabilities | null,
  requested: ReasoningEffort | CodexReasoningEffort | null
): CodexReasoningEffort | null {
  if (requested === null) return null;
  const supported = model?.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
  if (supported.length === 0) {
    if (requested === 'off') return 'low';
    return (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as readonly string[])
      .includes(requested) ? requested : null;
  }
  if (requested === 'off') {
    return (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const)
      .find((effort) => supported.includes(effort)) ?? supported[0] ?? null;
  }
  return supported.includes(requested) ? requested : null;
}

function imageExtension(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    default: return '.png';
  }
}

function completionError(turn: any): Error {
  const message = turn?.error?.message ?? turn?.error?.additionalDetails;
  return new Error(message || `La ejecución de Codex terminó con estado «${turn?.status ?? 'desconocido'}».`);
}

/** Protocol-level completion kept independent from Electron so isolation can be tested. */
export async function runIsolatedCodexCompletion(
  runtime: CodexCompletionTransport,
  options: IsolatedCodexCompletionOptions
): Promise<string> {
  let threadId: string | null = null;
  let turnId: string | null = null;
  let full = '';
  let aborted = options.signal?.aborted ?? false;
  let unsubscribe: () => void = () => undefined;
  let timeout: NodeJS.Timeout | null = null;
  let abortHandler: (() => void) | null = null;
  let settleAborted: ((value: string) => void) | null = null;
  const abortedEarly = new Promise<string>((resolve) => { settleAborted = resolve; });

  // Teardown is best-effort and must never restart a dead runtime: every transport
  // request goes through ensureStarted(), so an unguarded `turn/interrupt` or
  // `thread/unsubscribe` after a crash would respawn the whole Codex process just to
  // clean up a thread that no longer exists — and block for the request timeout.
  const cleanupRequest = (method: string, params: unknown): Promise<unknown> => {
    if (runtime.isRunning?.() === false) return Promise.resolve(undefined);
    return runtime.request(method, params).catch(() => undefined);
  };

  try {
    const input: any[] = [{ type: 'text', text: options.user, text_elements: [] }];
    for (const [index, image] of (options.images ?? []).entries()) {
      const imagePath = path.join(options.workdir, `image-${index + 1}${imageExtension(image.mediaType)}`);
      await fs.promises.writeFile(imagePath, Buffer.from(image.base64, 'base64'), { mode: 0o600 });
      input.push({ type: 'localImage', path: imagePath });
    }

    const thread = await runtime.request<{ thread: { id: string } }>('thread/start', {
      model: options.model,
      modelProvider: 'openai',
      cwd: options.workdir,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'nodus_desktop',
      ephemeral: true,
      config: {
        web_search: 'disabled',
        mcp_servers: {},
        features: {
          apps: false,
          browser_use: false,
          code_mode_host: false,
          computer_use: false,
          goals: false,
          hooks: false,
          image_generation: false,
          in_app_browser: false,
          multi_agent: false,
          plugins: false,
          shell_tool: false,
          tool_suggest: false,
          unified_exec: false,
          workspace_dependencies: false,
        },
      },
      baseInstructions: [
        'You are a constrained text-generation runtime embedded in Nodus.',
        'Answer the user request directly and return only the requested content.',
        'Never invoke shell commands, tools, MCP servers, plugins, skills, subagents, file operations, or web search.',
        'All context required for the answer is included in the request.',
      ].join(' '),
      developerInstructions: options.system,
    }, 60_000);
    threadId = thread.thread.id;

    const completed = new Promise<string>((resolve, reject) => {
      unsubscribe = runtime.onNotification((method, params: any) => {
        if (params?.threadId !== threadId) return;
        if (method === 'item/started' && [
          'commandExecution',
          'fileChange',
          'mcpToolCall',
          'dynamicToolCall',
          'collabAgentToolCall',
          'subAgentActivity',
          'webSearch',
          'imageView',
          'imageGeneration',
        ].includes(params?.item?.type)) {
          void cleanupRequest('turn/interrupt', { threadId, turnId: params.turnId });
          reject(new Error('Codex intentó usar una herramienta deshabilitada; Nodus interrumpió la petición.'));
          return;
        }
        if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
          full += params.delta;
          options.onDelta?.(params.delta);
          return;
        }
        if (method !== 'turn/completed') return;
        const turn = params.turn;
        if (turn?.status === 'failed') return reject(completionError(turn));
        const final = [...(turn?.items ?? [])]
          .reverse()
          .find((item: any) => item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim());
        if (turn?.status === 'interrupted') return resolve(full || final?.text || '');
        const answer = final?.text || full;
        if (!answer.trim()) return reject(new ProviderRuntimeError('ChatGPT devolvió una respuesta vacía.', 'unavailable'));
        resolve(answer);
      });
    });

    abortHandler = () => {
      aborted = true;
      if (threadId && turnId) void cleanupRequest('turn/interrupt', { threadId, turnId });
      // Settle on whatever already streamed instead of waiting for `turn/completed`.
      // The runtime is not guaranteed to emit it after an interrupt, and the caller
      // has already cancelled — holding them for the remaining timeout is the one
      // outcome a cancel must never produce.
      settleAborted?.(full);
    };
    options.signal?.addEventListener('abort', abortHandler, { once: true });

    const started = await runtime.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input,
      cwd: options.workdir,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: options.model,
      ...(options.reasoning ? { effort: options.reasoning } : {}),
      summary: 'none',
    }, 60_000);
    turnId = started.turn.id;
    // Aborted before the turn id existed: the 'abort' event already fired, so the
    // listener could not interrupt anything and will never fire again. Interrupt now
    // and return directly rather than racing a promise that can no longer settle.
    if (aborted) {
      await cleanupRequest('turn/interrupt', { threadId, turnId });
      return full;
    }

    return await Promise.race([
      completed,
      abortedEarly,
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (threadId && turnId) void cleanupRequest('turn/interrupt', { threadId, turnId });
          reject(new ProviderRuntimeError('ChatGPT no completó la petición dentro del tiempo esperado.', 'timeout'));
        }, options.timeoutMs ?? 180_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    unsubscribe();
    if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
    if (threadId) await cleanupRequest('thread/unsubscribe', { threadId });
  }
}
