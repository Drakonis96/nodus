/**
 * Error classification for the subscription-backed providers.
 *
 * These providers do not return HTTP status codes — they speak JSON-RPC over stdio
 * or come back through a vendor SDK — so `wrapProviderError`'s status-based mapping
 * does not apply. Classification used to be four copies of a regex over the message
 * text, which was wrong in both directions: the timeouts these runtimes actually
 * emit matched no alternative and were reported as permanent, while the Spanish
 * spelling `autentic` never matched an English `authentication` error, so genuine
 * auth failures never pointed the user at Settings.
 *
 * The fix is for the provider modules to say what went wrong instead of describing
 * it, by throwing {@link ProviderRuntimeError}. {@link classifyProviderError} keeps a
 * bilingual heuristic for anything that arrives untyped from a vendor SDK.
 */

export type ProviderErrorKind =
  /** Transient: the runtime did not answer in time. */
  | 'timeout'
  /** Transient: rate limit, quota window or exhausted plan credit. */
  | 'rateLimit'
  /** Transient: the runtime crashed, is starting, or the transport dropped. */
  | 'unavailable'
  /** Permanent until the user acts: not signed in, expired or rejected session. */
  | 'auth'
  /** Permanent: bad request, unsupported model, protocol violation. */
  | 'invalid';

export class ProviderRuntimeError extends Error {
  constructor(message: string, readonly kind: ProviderErrorKind) {
    super(message);
    this.name = 'ProviderRuntimeError';
  }

  /** Worth another attempt without the user changing anything. */
  get retriable(): boolean {
    return this.kind === 'timeout' || this.kind === 'rateLimit' || this.kind === 'unavailable';
  }

  /** The user has to fix something in Settings before this can succeed. */
  get config(): boolean {
    return this.kind === 'auth';
  }
}

// Bilingual fallbacks. Nodus writes its own messages in Spanish while the vendor
// runtimes report in English, and both reach here, so every concept needs both
// spellings — `autentic` (es) and `authentic` (en) share no common substring.
const RETRIABLE = new RegExp([
  'l[íi]mite', 'limit', 'quota', 'cuota', 'saldo',
  'timeout', 'timed out', 'tiempo esperado', 'tempor',
  'conexi[óo]n', 'connection', 'network', 'socket', 'econnre', 'epipe',
  'overload', 'sobrecarg', 'unavailable', 'no est[áa] disponible', 'try again', 'int[ée]ntalo',
  'se cerr[óo]', 'closed unexpectedly', 'crash',
].join('|'), 'i');

const CONFIG = new RegExp([
  'autentic', 'authentic', 'unauthor', 'no autoriz', 'forbidden', 'prohibid',
  'credencial', 'credential', 'inicia sesi[óo]n', 'sign in', 'signed in', 'log in', 'logged in',
  'conecta', 'suscripci[óo]n', 'subscription', 'sesi[óo]n expirada', 'session expired',
].join('|'), 'i');

export interface ProviderErrorClassification {
  message: string;
  retriable: boolean;
  config: boolean;
}

/**
 * Map any thrown value into the retriable/config flags `AiError` expects. A
 * {@link ProviderRuntimeError} is authoritative; anything else falls back to the
 * bilingual heuristic, which is why an unrecognised failure defaults to retriable
 * only when it actually looks transient.
 */
export function classifyProviderError(error: unknown): ProviderErrorClassification {
  if (error instanceof ProviderRuntimeError) {
    return { message: error.message, retriable: error.retriable, config: error.config };
  }
  const message = error instanceof Error ? error.message : String(error);
  // An auth failure is never worth an automatic retry, so it wins over a message
  // that happens to mention both (e.g. "session expired, try again").
  if (CONFIG.test(message)) return { message, retriable: false, config: true };
  return { message, retriable: RETRIABLE.test(message), config: false };
}
