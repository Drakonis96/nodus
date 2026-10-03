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
// `read ETIMEDOUT` is an established connection the OS dropped mid-read (a long reasoning stream
// lost after 84 KB of thinking, before any answer text) — the same class as a reset. A connect
// timeout is not matched and stays excluded below.
const TRANSIENT_NETWORK = /connection error|connection reset|connection refused|connection closed|connection lost|socket hang up|socket closed|network error|fetch failed|other side closed|premature close|terminated|econnreset|econnrefused|econnaborted|enotfound|eai_again|epipe|und_err|read etimedout/i;

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
  const e = error as { error?: { message?: unknown; error?: { message?: unknown } | null } | null; message?: unknown } | null;
  const nested = e?.error?.error?.message ?? e?.error?.message;
  if (typeof nested === 'string') return nested;
  const message = String(e?.message ?? '');
  // SDK errors can also reach us after their structured payload was discarded.
  // Decode the JSON envelope rather than matching its escaped quotes.
  try {
    const start = message.indexOf('{');
    if (start >= 0) {
      const payload = JSON.parse(message.slice(start));
      if (typeof payload?.error?.message === 'string') return payload.error.message;
      if (typeof payload?.message === 'string') return payload.message;
    }
  } catch { /* Plain provider wording remains useful. */ }
  return message;
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
 * A 400 that rejects `thinking.type.disabled` and points at the adaptive contract. Newer Claude
 * models (`claude-opus-5-5`) drop the ability to turn thinking off: they answer
 * `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and
 * "output_config.effort" to control thinking behavior.` (claude-opus-5-5), or `To turn thinking
 * off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.`
 * (claude-sonnet-5-5). The transport replays the request with the type the provider names, else
 * adaptive (effort still set), and remembers the model for the session.
 */
const ADAPTIVE_THINKING_REJECTION = /thinking\.type\.disabled[^\n]{0,80}(?:not\s+supported|unsupported|not\s+accepted|not\s+allowed|invalid)|thinking\.type\.adaptive|instead\s+of\s+\{\s*\\?"type\\?"\s*:\s*\\?"disabled\\?"\s*\}/i;

export function rejectsAdaptiveThinking(error: unknown): boolean {
  return statusOf(error) === 400 && ADAPTIVE_THINKING_REJECTION.test(messageOf(error));
}

/** The thinking type a provider says to send instead of `disabled`, when its rejection names one:
 *  `To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of
 *  {"type": "disabled"}.` (claude-sonnet-5-5), or a named adaptive replacement. */
export function thinkingOffReplacement(error: unknown): string | null {
  const message = messageOf(error);
  return /send\s+"thinking"\s*:\s*\{\s*"type"\s*:\s*"(between_tools|adaptive|enabled)"\s*\}\s*instead\s+of/i.exec(message)?.[1]
    ?? /(?:use|send)\s+"?thinking\.type\.(adaptive|between_tools|enabled)"?/i.exec(message)?.[1] ?? null;
}

/** A refused request explicitly says its reasoning opt-out is impossible. */
export function rejectsThinkingOff(error: unknown): boolean {
  if (![400, 422].includes(statusOf(error) ?? 0)) return false;
  return ADAPTIVE_THINKING_REJECTION.test(messageOf(error)) || /(?:thinking|reasoning)\b\s+(?:is\s+)?(?:mandatory|required|always on)|(?:thinking|reasoning)\b[^\n]{0,60}cannot be disabled|(?:cannot|can't)\s+disable\s+(?:thinking|reasoning)\b|(?:thinking|reasoning)(?:\.type|\.enabled|_effort)?\b[^\n]{0,30}(?:disabled|false|none|off)[^\n]{0,70}(?:not supported|unsupported|not accepted|not allowed|invalid)|(?:thinking|reasoning)(?:\.type|\.enabled|_effort)?\b[^\n]{0,40}(?:does not support|not supported|unsupported|not allowed)[^\n]{0,30}(?:disabled|false|none|off)\b|(?:none|off)[^\n]{0,40}(?:not supported|unsupported|not allowed)[^\n]{0,40}(?:reasoning|thinking)\b/i.test(messageOf(error));
}

/** Some compatible APIs publish the accepted effort values in their refusal. */
export function thinkingEffortReplacement(error: unknown): string | undefined {
  const values = /supported (?:values|efforts) (?:are|include)\s*:\s*([^\n]+)/i.exec(messageOf(error))?.[1];
  if (!values) return undefined;
  return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'default'].find(effort =>
    new RegExp(`(?:^|[\\s'",\\[])${effort}(?=$|[\\s'",.\\]])`, 'i').test(values));
}

/** The statuses a provider answers with when it refused a request before running it. */
const REFUSAL_STATUSES = new Set([400, 422]);

/**
 * A refusal that did NOT name the field it disliked — the shape every proxy in front of a
 * real API produces, and the only case where which field to drop has to be guessed.
 */
export function rejectsOptionalBodyWithoutNaming(error: unknown): boolean {
  return !rejectsOptionalTransportField(error) && REFUSAL_STATUSES.has(statusOf(error) ?? 0);
}

/**
 * Whether one request should be replayed without its optional body fields.
 *
 * The second case is why this cannot live inside the transport alone: a custom gateway may
 * refuse the optional body Nodus added *without naming it*, because a proxy in front of the
 * real API often answers a bare "Bad Request". Nodus added those fields, so Nodus owns the
 * recovery; refusing to replay there turns a fix that helps some setups into scans that fail
 * on the ones it does not help.
 *
 * It used to require that Nodus had sent the reasoning hint, on the theory that a gateway
 * cannot object to a field it was never sent. That held only while the reasoning hint was
 * the sole optional field — but every JSON call also carries `response_format`, and a
 * gateway that refuses *that* with an opaque 400 matched no branch here at all: one request,
 * no replay, and the whole scan ended on "the provider rejected the request (400)". The
 * question is not what Nodus remembers sending, it is whether the request carried anything
 * optional at all, which the caller checks before replaying.
 *
 * A 400/422 is a refusal, not a completed generation: the request was rejected before
 * running, so replays cannot double-charge. Rejections of any *other* optional field are
 * still only replayed when the provider names it.
 */
export function shouldRetryWithoutOptionalFields(
  error: unknown,
  options: { provider?: string } = {},
): boolean {
  if (rejectsOptionalTransportField(error)) return true;
  return options.provider === 'custom' && REFUSAL_STATUSES.has(statusOf(error) ?? 0);
}
