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

/**
 * Network-level transport failures, for the OpenAI-compatible path.
 *
 * These carry no HTTP status: the socket failed, so every status-based branch in
 * `wrapProviderError` skips them and they used to reach the generic catch-all,
 * which marks them permanent. A dropped connection is the textbook transient
 * failure a background scan should ride out, and `classifyProviderError` above
 * already treats `connection`/`network`/`socket` as retriable — but that path is
 * only wired for the subscription runtimes, so a custom or vendor OpenAI-compatible
 * endpoint failed the whole work on one gateway hiccup.
 *
 * Deliberately excluded:
 *  · an abort — a cancelled or paused job asked for it, and retrying would fight
 *    the user;
 *  · a timeout — `wrapProviderError` classifies those separately (and, like the
 *    transport deadline, must not be replayed blindly);
 *  · anything carrying a status — another branch owns that decision.
 */
const TRANSIENT_NETWORK = /connection error|connection reset|connection refused|connection closed|connection lost|socket hang up|socket closed|network error|fetch failed|other side closed|premature close|terminated|econnreset|econnrefused|econnaborted|enotfound|eai_again|epipe|und_err/i;

export function isTransientNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    name?: unknown; message?: unknown; code?: unknown; status?: unknown;
    cause?: unknown; response?: { status?: unknown } | null;
  };
  if (typeof e.status === 'number' || typeof e.response?.status === 'number') return false;
  const name = typeof e.name === 'string' ? e.name : '';
  if (/abort|timeout/i.test(name)) return false;
  const cause = (e.cause && typeof e.cause === 'object' ? e.cause : {}) as Record<string, unknown>;
  const codes = [e.code, cause.code, cause.name]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  // Substring, not word-boundary: undici spells its codes UND_ERR_CONNECT_TIMEOUT
  // and ECONNABORTED, where the trailing word is glued on by an underscore.
  if (/abort|timeout/i.test(codes)) return false;
  // The OpenAI SDK's canonical "Connection error." — no status, so nothing else
  // in `wrapProviderError` can recognise it.
  if (/APIConnectionError/i.test(name)) return true;
  const text = [
    typeof e.message === 'string' ? e.message : '',
    typeof cause.message === 'string' ? cause.message : '',
    codes,
  ].join(' ');
  return TRANSIENT_NETWORK.test(text);
}

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: unknown; response?: { status?: unknown } | null } | null;
  if (typeof e?.status === 'number') return e.status;
  const nested = e?.response?.status;
  return typeof nested === 'number' ? nested : undefined;
}

function messageOf(error: unknown): string {
  const e = error as { error?: { message?: unknown } | null; message?: unknown } | null;
  const nested = e?.error && typeof e.error === 'object' ? e.error.message : undefined;
  return String((typeof nested === 'string' ? nested : undefined) ?? e?.message ?? '');
}

/**
 * A 400 that names an optional transport field it does not accept: JSON mode, the
 * reasoning hint, or OpenRouter's routing preference. The transport replays the request
 * once without the optional body on this signal. Keep it strict: only a field the
 * provider named may be dropped on a *named* rejection.
 */
const OPTIONAL_FIELD_REJECTION = /(?:unknown|unrecognized|unsupported|not supported|extra|invalid)\s+(?:field|parameter|argument)|response_format|reasoning_effort|include_reasoning|provider\.only|allow_fallbacks/i;

export function rejectsOptionalTransportField(error: unknown): boolean {
  return statusOf(error) === 400 && OPTIONAL_FIELD_REJECTION.test(messageOf(error));
}

/**
 * A 400 that names `temperature` as deprecated or unsupported for the model. Newer reasoning
 * models (DeepSeek's `deepseek-flash`, OpenAI's o-series) reject the sampling knob even though
 * their siblings accept it, so the transport replays the request once without it and remembers
 * the model for the session. Kept strict: only a message that names temperature qualifies.
 *
 * Probed against the live DeepSeek and OpenCode Go endpoints on 2026-09-16: both still accept
 * `temperature` on the unversioned DeepSeek ids, so this recovery is dormant for them today —
 * it exists because a provider can flip that contract between two calls, which is exactly how
 * the unversioned ids arrived.
 */
const TEMPERATURE_REJECTION = /temperature[^\n]{0,60}(?:deprecated|unsupported|not\s+supported|not\s+accepted|not\s+allowed)|(?:unsupported|unknown|invalid|unexpected)[^\n]{0,40}temperature/i;

export function rejectsTemperatureParameter(error: unknown): boolean {
  return statusOf(error) === 400 && TEMPERATURE_REJECTION.test(messageOf(error));
}

/**
 * Whether one request should be replayed without its optional body fields.
 *
 * The second case is why this cannot live inside the transport alone: a custom gateway
 * may refuse the reasoning hint Nodus added *without naming it* — a proxy in front of
 * the real API often answers a bare "Bad Request". Nodus added that field, so Nodus
 * owns the recovery; refusing to replay there would turn a fix that helps some setups
 * into scans that fail on the ones it does not help.
 *
 * A 400/422 is a refusal, not a completed generation: the request was rejected before
 * running, so a single replay without the extras cannot double-charge. Rejections of
 * any *other* optional field are still only replayed when the provider names it.
 */
export function shouldRetryWithoutOptionalFields(
  error: unknown,
  options: { provider?: string; sentReasoning?: boolean } = {},
): boolean {
  if (rejectsOptionalTransportField(error)) return true;
  const status = statusOf(error);
  return options.provider === 'custom'
    && options.sentReasoning === true
    && (status === 400 || status === 422);
}
