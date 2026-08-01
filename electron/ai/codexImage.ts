import fs from 'node:fs';
import path from 'node:path';
import { codexFeatures } from './codexAppServerClient';
import type { CodexCompletionTransport } from './codexCompletion';
import { ProviderRuntimeError } from './providerErrors';

export interface IsolatedCodexImageOptions {
  model: string;
  prompt: string;
  workdir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CodexGeneratedImage {
  bytes: Buffer;
  mimeType: string;
  /** What the model actually asked the image tool for. Useful for diagnostics only. */
  revisedPrompt: string | null;
}

/** Shape of the `imageGeneration` thread item in the app-server v2 protocol. */
interface CodexImageItem {
  type: 'imageGeneration';
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  revisedPrompt: string | null;
  /** Base64 of the finished image. Empty while the item is still in progress. */
  result: string;
  /** Copy the runtime writes under CODEX_HOME/generated_images/<threadId>/. */
  savedPath?: string | null;
}

/** Every tool whose use means the image thread went somewhere it must not go. */
const FORBIDDEN_ITEMS = [
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'webSearch',
  'imageView',
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Trust the bytes, not the runtime: the protocol declares no mime type at all. */
function sniffImageMime(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // The built-in tool has only ever returned PNG; keep that as the honest default
  // rather than mislabelling unknown bytes as something a viewer would try to decode.
  return 'image/png';
}

function turnError(turn: any): Error {
  const message = turn?.error?.message ?? turn?.error?.additionalDetails;
  // The runtime's own message is the informative one and is passed through as it
  // comes. The fallback is a fixed sentence rather than one built around the turn
  // status, because a failed image is STORED with its reason and read back later
  // in whatever language the interface is in — an interpolated string could not be
  // translated, and the raw status told the user nothing they could act on.
  return new Error(message || 'La generación de imagen de Codex no llegó a completarse.');
}

/**
 * Delete the copy the runtime left in CODEX_HOME.
 *
 * Nodus stores the image in the vault, so the runtime's copy is a duplicate of user
 * content sitting outside every backup, export and deletion path Nodus offers — and
 * at roughly 2 MB per generation it would grow without limit. The thread is ephemeral
 * and its directory holds nothing else, so it goes too once emptied.
 */
function discardRuntimeCopy(savedPath: string | null | undefined): void {
  if (!savedPath) return;
  try {
    fs.rmSync(savedPath, { force: true });
    fs.rmdirSync(path.dirname(savedPath));
  } catch {
    /* another image still in the directory, or the runtime already cleaned up */
  }
}

/**
 * Generate one image on an ephemeral Codex thread that holds the `image_gen` tool and
 * nothing else. Kept free of Electron, like the text completion beside it, so the
 * isolation it depends on can be tested against a fake transport.
 */
export async function runIsolatedCodexImage(
  runtime: CodexCompletionTransport,
  options: IsolatedCodexImageOptions
): Promise<CodexGeneratedImage> {
  let threadId: string | null = null;
  let turnId: string | null = null;
  let unsubscribe: () => void = () => undefined;
  let timeout: NodeJS.Timeout | null = null;
  let abortHandler: (() => void) | null = null;
  let settleAborted: ((error: Error) => void) | null = null;
  const saved: string[] = [];
  const abortedEarly = new Promise<never>((_resolve, reject) => { settleAborted = reject; });
  // An abort that lands before the race is set up would otherwise reject with nobody
  // listening, and an unhandled rejection takes down the whole main process.
  abortedEarly.catch(() => undefined);

  // Teardown must never restart a dead runtime — see the same guard in codexCompletion.
  const cleanupRequest = (method: string, params: unknown): Promise<unknown> => {
    if (runtime.isRunning?.() === false) return Promise.resolve(undefined);
    return runtime.request(method, params).catch(() => undefined);
  };

  try {
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
        features: codexFeatures(true),
      },
      baseInstructions: [
        'You are a constrained image-generation runtime embedded in Nodus.',
        'Generate exactly one image from the user prompt with the built-in image generation tool, then stop.',
        'Never invoke shell commands, tools other than image generation, MCP servers, plugins, skills, subagents, file operations, or web search.',
        'Never ask questions and never explain: the prompt is complete as given.',
      ].join(' '),
      developerInstructions: [
        'Generate one image for the prompt exactly as written, without reinterpreting its subject.',
        'Once the image exists, reply with the single word DONE and nothing else.',
      ].join(' '),
    }, 60_000);
    threadId = thread.thread.id;

    const generated = new Promise<CodexImageItem>((resolve, reject) => {
      unsubscribe = runtime.onNotification((method, params: any) => {
        if (params?.threadId !== threadId) return;
        if (method === 'item/started' && FORBIDDEN_ITEMS.includes(params?.item?.type)) {
          void cleanupRequest('turn/interrupt', { threadId, turnId: params.turnId ?? turnId });
          reject(new Error('Codex intentó usar una herramienta deshabilitada; Nodus interrumpió la petición.'));
          return;
        }
        if (method === 'item/completed' && params?.item?.type === 'imageGeneration') {
          const item = params.item as CodexImageItem;
          if (item.savedPath) saved.push(item.savedPath);
          if (item.status !== 'completed') {
            reject(new ProviderRuntimeError('ChatGPT no pudo generar la imagen.', 'unavailable'));
            return;
          }
          // The image is done; the turn would only go on to narrate it. Interrupting
          // here spends neither the extra quota nor the seconds that message costs.
          void cleanupRequest('turn/interrupt', { threadId, turnId: params.turnId ?? turnId });
          resolve(item);
          return;
        }
        if (method !== 'turn/completed') return;
        const turn = params.turn;
        if (turn?.status === 'failed') return reject(turnError(turn));
        // A turn that ends without an image means the model answered in words. That
        // is a failed generation, not an empty one — say so instead of returning null.
        reject(new ProviderRuntimeError('ChatGPT terminó la petición sin generar ninguna imagen.', 'unavailable'));
      });
    });

    abortHandler = () => {
      if (threadId && turnId) void cleanupRequest('turn/interrupt', { threadId, turnId });
      // Unlike text, a cancelled image has no partial result worth returning, and the
      // runtime need not emit `turn/completed` after an interrupt: settle right away
      // rather than holding the caller for the remaining timeout.
      settleAborted?.(new ProviderRuntimeError('La generación de imagen se canceló.', 'unavailable'));
    };
    options.signal?.addEventListener('abort', abortHandler, { once: true });
    // Cancelled before the turn existed: there is nothing to interrupt and nothing to
    // wait for, so fail here instead of paying for a turn the caller no longer wants.
    if (options.signal?.aborted) throw new ProviderRuntimeError('La generación de imagen se canceló.', 'unavailable');

    const started = await runtime.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: options.prompt, text_elements: [] }],
      cwd: options.workdir,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: options.model,
      summary: 'none',
    }, 60_000);
    turnId = started.turn.id;

    const item = await Promise.race([
      generated,
      abortedEarly,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (threadId && turnId) void cleanupRequest('turn/interrupt', { threadId, turnId });
          reject(new ProviderRuntimeError('ChatGPT no generó la imagen dentro del tiempo esperado.', 'timeout'));
        }, options.timeoutMs ?? 240_000);
      }),
    ]);

    // The bytes travel inline in the item; the file on disk is the same image and only
    // matters as a fallback for a runtime that ever stops inlining them.
    const bytes = item.result
      ? Buffer.from(item.result, 'base64')
      : item.savedPath ? await fs.promises.readFile(item.savedPath) : Buffer.alloc(0);
    if (!bytes.length) throw new ProviderRuntimeError('ChatGPT devolvió una imagen vacía.', 'unavailable');
    return { bytes, mimeType: sniffImageMime(bytes), revisedPrompt: item.revisedPrompt ?? null };
  } finally {
    if (timeout) clearTimeout(timeout);
    unsubscribe();
    if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
    for (const file of saved) discardRuntimeCopy(file);
    if (threadId) await cleanupRequest('thread/unsubscribe', { threadId });
  }
}
