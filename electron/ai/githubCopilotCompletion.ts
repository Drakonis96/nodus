import type { ReasoningEffort } from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';

interface CopilotSessionLike {
  sessionId: string;
  rpc?: { usage?: { getMetrics?: () => Promise<any> } };
  on(handler: (event: any) => void): () => void;
  sendAndWait(options: any, timeout?: number): Promise<any>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CopilotClientLike {
  createSession(config: any): Promise<CopilotSessionLike>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface GitHubCopilotCompletionOptions {
  model: string;
  system: string;
  user: string;
  reasoning: ReasoningEffort;
  supportsReasoning: boolean;
  workdir: string;
  timeoutMs?: number;
  images?: VisionImagePart[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

export interface GitHubCopilotCompletionUsage {
  model: string;
  premiumRequestCost: number;
  userRequests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GitHubCopilotCompletionResult {
  text: string;
  usage: GitHubCopilotCompletionUsage | null;
}

function messageContent(response: any): string {
  return typeof response?.data?.content === 'string' ? response.data.content : '';
}

function usageFrom(metrics: any, model: string): GitHubCopilotCompletionUsage | null {
  if (!metrics) return null;
  return {
    model: metrics.currentModel ?? model,
    premiumRequestCost: Number(metrics.totalPremiumRequestCost ?? 0),
    userRequests: Number(metrics.totalUserRequests ?? 0),
    inputTokens: Number(metrics.lastCallInputTokens ?? 0),
    outputTokens: Number(metrics.lastCallOutputTokens ?? 0),
  };
}

/** One ephemeral no-tools session. The empty SDK mode disables ambient CLI
 * features; the explicit filters and rejection handler are a second fail-closed
 * layer, while the empty workdir prevents instruction-file discovery. */
export async function runIsolatedGitHubCopilotCompletion(
  client: CopilotClientLike,
  options: GitHubCopilotCompletionOptions
): Promise<GitHubCopilotCompletionResult> {
  let session: CopilotSessionLike | null = null;
  let unsubscribe: () => void = () => undefined;
  let abortHandler: (() => void) | null = null;
  let partial = '';
  let eventError: ((error: Error) => void) | null = null;
  let eventFailure: Error | null = null;

  try {
    session = await client.createSession({
      clientName: 'nodus-desktop',
      model: options.model,
      ...(options.supportsReasoning && options.reasoning !== 'off'
        ? { reasoningEffort: options.reasoning }
        : {}),
      workingDirectory: options.workdir,
      streaming: Boolean(options.onDelta || options.onReasoningDelta),
      systemMessage: {
        mode: 'append',
        content: [
          'You are a constrained text-generation runtime embedded in Nodus.',
          'Answer the supplied request directly and return only the requested content.',
          'Never use tools, shell commands, files, URLs, MCP servers, plugins, skills, memory, subagents, or GitHub context.',
          'All context required for the answer is included in this request.',
          options.system,
        ].join(' '),
      },
      tools: [],
      availableTools: [],
      excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
      mcpServers: {},
      enableConfigDiscovery: false,
      skillDirectories: [],
      instructionDirectories: [],
      enableSkills: false,
      infiniteSessions: { enabled: false },
      memory: { enabled: false },
      skipEmbeddingRetrieval: true,
      embeddingCacheStorage: 'in-memory',
      enableOnDemandInstructionDiscovery: false,
      enableFileHooks: false,
      enableHostGitOperations: false,
      enableSessionStore: false,
      remoteSession: 'off',
      enableSessionTelemetry: false,
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Nodus does not expose tools for text generation.' }),
    });

    const unexpectedExecution = new Promise<never>((_resolve, reject) => { eventError = reject; });
    unsubscribe = session.on((event) => {
      if (event?.agentId) return;
      if (event?.type === 'assistant.message_delta' && typeof event.data?.deltaContent === 'string') {
        partial += event.data.deltaContent;
        options.onDelta?.(event.data.deltaContent);
        return;
      }
      if (event?.type === 'assistant.reasoning_delta' && typeof event.data?.deltaContent === 'string') {
        options.onReasoningDelta?.(event.data.deltaContent);
        return;
      }
      if (['tool.execution_start', 'permission.requested', 'external_tool.requested'].includes(event?.type)) {
        eventFailure = new Error('GitHub Copilot intentó usar una herramienta deshabilitada; Nodus interrumpió la petición.');
        void session?.abort().catch(() => undefined);
        eventError?.(eventFailure);
        return;
      }
      if (event?.type === 'session.error') {
        const message = event.data?.message ?? event.data?.error ?? 'GitHub Copilot devolvió un error de sesión.';
        eventFailure = new Error(message);
        eventError?.(eventFailure);
      }
    });

    abortHandler = () => { void session?.abort().catch(() => undefined); };
    if (options.signal?.aborted) abortHandler();
    else options.signal?.addEventListener('abort', abortHandler, { once: true });

    const attachments = (options.images ?? []).map((image, index) => ({
      type: 'blob' as const,
      data: image.base64,
      mimeType: image.mediaType,
      displayName: `nodus-image-${index + 1}`,
    }));
    const response = await Promise.race([
      session.sendAndWait({ prompt: options.user, ...(attachments.length ? { attachments } : {}) }, options.timeoutMs ?? 180_000),
      unexpectedExecution,
    ]);
    if (eventFailure) throw eventFailure;
    const text = messageContent(response) || partial;
    if (!text.trim() && !options.signal?.aborted) throw new Error('GitHub Copilot devolvió una respuesta vacía.');

    let metrics: any = null;
    try { metrics = await session.rpc?.usage?.getMetrics?.(); } catch { /* completion remains valid */ }
    return { text, usage: usageFrom(metrics, options.model) };
  } finally {
    unsubscribe();
    if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
    if (session) {
      const id = session.sessionId;
      try { await session.disconnect(); } catch { /* delete is the definitive cleanup */ }
      await client.deleteSession(id).catch(() => undefined);
    }
  }
}
