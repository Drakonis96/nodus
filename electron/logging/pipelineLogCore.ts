/**
 * The processing-log façade: what every pipeline (extraction, OCR, indexing, embeddings,
 * scans) calls to record what happened.
 *
 * Three properties drove this design:
 *
 *  - **It cannot break the work it describes.** Every entry point swallows its own
 *    failures. Logging a provider outage must not be the thing that loses a document.
 *  - **It must be importable from a unit test.** `aiClient.ts` cannot be imported outside
 *    Electron (it pulls the database and the native SQLite driver), so nothing here may
 *    touch Electron, the database or the filesystem. The sink is injected at startup by
 *    `pipelineLogHost.ts` and defaults to a no-op; `scripts/test-pipeline-logs-core.mjs`
 *    injects its own.
 *  - **A line is an id plus values, never prose.** The store is global while the UI
 *    language is per vault, and the reader can pick a different language for the log, so
 *    the sentence is built at paint time by the renderer (see shared/pipelineLogMessages).
 *
 * The AsyncLocalStorage scope is what makes `aiClient` (called from everywhere) attribute
 * a failure to the right vault, document and job without threading parameters through
 * dozens of call signatures — the same trick `withVaultDatabase` uses for the connection.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PipelineLogText, PipelineLogTextId } from '@shared/pipelineLogMessages';
import { PIPELINE_LOG_SUBJECTS } from '@shared/pipelineLogMessages';
import type {
  PipelineLogCategory,
  PipelineLogEntry,
  PipelineLogLevel,
  PipelineLogScope,
} from '@shared/pipelineLogs';

export type PipelineLogSubjectId = keyof typeof PIPELINE_LOG_SUBJECTS;

/** Category and default severity for each language-neutral code we can emit. */
interface PipelineLogCodeInfo {
  category: PipelineLogCategory;
  /** Overrides the level a caller would otherwise get (warnings, cancellations…). */
  level?: PipelineLogLevel;
  /** The code itself already means "worth retrying", unless the caller says otherwise. */
  retriable?: boolean;
}

/**
 * Every code the log can carry. They are deliberately language-neutral and stable: they
 * are the badge shown next to the line, the value a maintainer greps for in a GitHub
 * issue, and the mapping that decides which category filter an entry falls under.
 */
export const PIPELINE_LOG_CODES = {
  invalid_json: { category: 'json' },
  schema_mismatch: { category: 'json' },
  output_truncated: { category: 'json' },
  timeout: { category: 'connection' },
  connection: { category: 'connection' },
  rate_limit: { category: 'provider', retriable: true },
  provider_5xx: { category: 'provider', retriable: true },
  auth: { category: 'provider' },
  bad_request: { category: 'provider' },
  context_overflow: { category: 'provider' },
  provider_empty: { category: 'provider', retriable: true },
  model_missing: { category: 'model' },
  model_unavailable: { category: 'model' },
  embedding_failed: { category: 'embedding' },
  embedding_count_mismatch: { category: 'embedding' },
  extract_failed: { category: 'extraction' },
  no_legible_text: { category: 'extraction', level: 'warning' },
  ocr_failed: { category: 'ocr' },
  index_failed: { category: 'indexing' },
  publish_failed: { category: 'indexing' },
  source_changed: { category: 'indexing', level: 'warning' },
  queue_paused: { category: 'queue', level: 'warning' },
  cancelled: { category: 'queue', level: 'warning' },
  db_error: { category: 'storage' },
  burst_limit: { category: 'system', level: 'warning' },
  uncaught: { category: 'system' },
  unknown: { category: 'system' },
} as const satisfies Record<string, PipelineLogCodeInfo>;

export type PipelineLogCode = keyof typeof PIPELINE_LOG_CODES;

export function isPipelineLogCode(value: unknown): value is PipelineLogCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PIPELINE_LOG_CODES, value);
}

/**
 * Producers that spell the same failure differently. `AiError.code` is the case that matters:
 * it carries `provider_empty_error` and `model_required`, and without these aliases a failure
 * that had already been named precisely would be re-guessed from its prose — the exact thing
 * the explicit code exists to avoid.
 */
const PIPELINE_LOG_CODE_ALIASES: Record<string, PipelineLogCode> = {
  provider_empty_error: 'provider_empty',
  model_required: 'model_missing',
};

/** The log code a producer's own code maps to, or null when it says nothing we know. */
function resolveLogCode(value: string | null): PipelineLogCode | null {
  if (!value) return null;
  if (isPipelineLogCode(value)) return value;
  return PIPELINE_LOG_CODE_ALIASES[value] ?? null;
}

function codeInfo(code: PipelineLogCode): PipelineLogCodeInfo {
  return PIPELINE_LOG_CODES[code];
}

export function pipelineLogCategoryForCode(code: PipelineLogCode): PipelineLogCategory {
  return codeInfo(code).category;
}

export function pipelineLogRetriableForCode(code: PipelineLogCode): boolean {
  return codeInfo(code).retriable === true;
}

/** Where the work was happening. Merged into every line recorded inside the scope. */
export interface PipelineLogContext {
  scope: PipelineLogScope;
  vaultId?: string | null;
  vaultName?: string | null;
  nodusId?: string | null;
  documentTitle?: string | null;
  jobId?: string | null;
  provider?: string | null;
  model?: string | null;
  phase?: string | null;
}

/** The subsystem a line is about, when the caller does not name one. */
const SUBJECT_BY_SCOPE: Record<PipelineLogScope, PipelineLogSubjectId> = {
  extraction: 'subjectExtraction',
  library: 'subjectLibraryExtraction',
  ocr: 'subjectOcr',
  indexing: 'subjectIndexing',
  embeddings: 'subjectEmbeddings',
  scan: 'subjectScan',
  chat: 'subjectModelCall',
  research: 'subjectModelCall',
  app: 'subjectApp',
};

/**
 * Where lines go. Injected at startup by the Electron host; a no-op until then, so
 * importing this module from a worker or a test has no side effect.
 */
export interface PipelineLogSink {
  record(entry: PipelineLogEntry): void;
}

let sink: PipelineLogSink | null = null;

/** Install (or clear, with `null`) the destination for recorded lines. */
export function setPipelineLogSink(next: PipelineLogSink | null): void {
  sink = next;
}

const scopeStorage = new AsyncLocalStorage<PipelineLogContext>();

/**
 * Run `work` with the pipeline context every line inside it inherits. Nested scopes merge,
 * so a queue can set vault + job and a document step can add the title without losing them.
 */
export function withPipelineLogScope<T>(
  context: Partial<PipelineLogContext> & { scope: PipelineLogScope },
  work: () => T
): T {
  const parent = scopeStorage.getStore();
  return scopeStorage.run({ ...parent, ...stripUndefined(context) }, work);
}

/** The context in force, if any. `app` with no ids when the caller is outside every pipeline. */
export function currentPipelineLogContext(): PipelineLogContext {
  return scopeStorage.getStore() ?? { scope: 'app' };
}

function stripUndefined<T extends object>(value: T): T {
  const out = { ...value };
  for (const key of Object.keys(out) as (keyof T)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export function pipelineSubjectForScope(scope: PipelineLogScope): PipelineLogSubjectId {
  return SUBJECT_BY_SCOPE[scope] ?? 'subjectApp';
}

/**
 * The category a line belongs to when nothing more specific is known. A successful index
 * run and a document that failed for an unrecognised reason both have to land under a
 * filter the reader can find, and "the subsystem that produced it" is the honest answer —
 * `system` is reserved for lines that genuinely cannot be attributed to a pipeline.
 */
const CATEGORY_BY_SUBJECT: Record<PipelineLogSubjectId, PipelineLogCategory> = {
  subjectExtraction: 'extraction',
  subjectLibraryExtraction: 'extraction',
  subjectOcr: 'ocr',
  subjectModelCall: 'model',
  subjectJsonResponse: 'json',
  subjectEmbeddings: 'embedding',
  subjectIndexing: 'indexing',
  subjectPassages: 'embedding',
  subjectProfileScan: 'indexing',
  subjectFigureAnalysis: 'extraction',
  subjectScan: 'model',
  subjectPublish: 'storage',
  subjectDatabase: 'storage',
  subjectQueue: 'queue',
  subjectApp: 'system',
};

export function pipelineCategoryForSubject(subject: PipelineLogSubjectId): PipelineLogCategory {
  return CATEGORY_BY_SUBJECT[subject] ?? 'system';
}

let sequence = 0;

function nextId(now: number): string {
  sequence = (sequence + 1) % 0xffffff;
  const random = Math.random().toString(36).slice(2, 6);
  return `pl-${now.toString(36)}-${sequence.toString(36)}-${random}`;
}

type ParamValue = string | number | boolean | null | { id: PipelineLogTextId };

/** What a caller can say about one line. Everything but the subject is optional. */
export interface PipelineLogInput {
  /** Catalogue id of the sentence. Defaults to a template chosen from `level` + detail. */
  message?: PipelineLogText;
  /** Shorthand for the line's subject when using a template. */
  subject?: PipelineLogSubjectId;
  /** Shorthand for the cause, interpolated as `{ reason }` of the templates. */
  reason?: PipelineLogTextId;
  level?: PipelineLogLevel;
  category?: PipelineLogCategory;
  code?: PipelineLogCode | (string & {});
  /** Raw runtime text with no key (a provider's own error), shown verbatim. */
  detail?: string | null;
  params?: Record<string, ParamValue>;
  error?: unknown;
  retriable?: boolean | null;
  attempts?: number | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  stack?: string | null;
  /** Overrides the ambient context for this line. */
  context?: Partial<PipelineLogContext>;
}

interface ClassifiedError {
  code: PipelineLogCode;
  category: PipelineLogCategory;
  detail: string;
  retriable: boolean | null;
  httpStatus: number | null;
  stack: string | null;
}

const ABORT_CODES = new Set(['ABORT_ERR', 'ABORTED', 'ERR_CANCELED']);
const CONNECTION_ERRNOS = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
  'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'EPROTO', 'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'Error';
  if (typeof error === 'string') return error;
  if (error == null) return '';
  try {
    return String(error);
  } catch {
    return '';
  }
}

function errorStack(error: unknown): string | null {
  return error instanceof Error && error.stack ? error.stack : null;
}

/** HTTP status a provider reported, from either the error or its response wrapper. */
function readStatus(error: unknown): number | null {
  const direct = (error as { status?: unknown })?.status;
  if (typeof direct === 'number') return direct;
  const nested = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof nested === 'number' ? nested : null;
}

interface MessageClassification {
  code: PipelineLogCode;
  category: PipelineLogCategory;
  retriable?: boolean;
}

function classifyMessage(message: string, status: number | null): MessageClassification | null {
  // The provider's own prose reaches us in whichever language `wrapProviderError` used, so
  // the few known sentences are matched in both. `aiClient` states its code explicitly
  // wherever it knows one; this heuristic only covers errors that arrive untyped.
  if (/JSON inválido|invalid json|unexpected token|unexpected end of json|not valid json/i.test(message)) {
    return { code: 'invalid_json', category: 'json' };
  }
  if (/json/i.test(message) && /no cumple el esquema|does not match the schema|schema/i.test(message)) {
    return { code: 'schema_mismatch', category: 'json' };
  }
  if (/truncat|cortada|cortado/i.test(message)) {
    return { code: 'output_truncated', category: 'json' };
  }
  if (/no contiene json|contains no json/i.test(message)) {
    return { code: 'invalid_json', category: 'json' };
  }
  if (/no hay un modelo|modelo de ia configurado|model_required|no model/i.test(message)) {
    return { code: 'model_missing', category: 'model' };
  }
  if (/context (window|length|overflow)|n_ctx|too many tokens|maximum context|se queda sin contexto/i.test(message)) {
    return { code: 'context_overflow', category: 'provider' };
  }
  if (/límite de tasa|rate limit|too many requests|quota/i.test(message) || status === 429 || status === 529) {
    return { code: 'rate_limit', category: 'provider', retriable: true };
  }
  if (/clave de ia inválida|invalid auth|api[_ -]?key|unauthenticated|invalid credential|unauthorized|forbidden/i.test(message)
    || status === 401 || status === 403) {
    return { code: 'auth', category: 'provider' };
  }
  if (/error del proveedor|provider error|bad gateway|service unavailable/i.test(message)
    || (status != null && status >= 500)) {
    return { code: 'provider_5xx', category: 'provider', retriable: true };
  }
  if (/rechazó la solicitud|rejected the request/i.test(message) || status === 400) {
    return { code: 'bad_request', category: 'provider' };
  }
  if (/error de conexión|connection error|fetch failed|socket hang up|network error/i.test(message)) {
    return { code: 'connection', category: 'connection', retriable: true };
  }
  if (/tiempo agotado|timed out|timeout/i.test(message)) {
    return { code: 'timeout', category: 'connection' };
  }
  return null;
}

/**
 * Decide what an arbitrary thrown value means. Called by the pipeline catches (queues,
 * extraction, the worker host) that cannot know the code themselves; `aiClient` states its
 * own code instead, because it knows exactly which branch it took.
 */
export function classifyPipelineError(error: unknown, fallbackCategory: PipelineLogCategory = 'system'): ClassifiedError {
  const message = rawMessage(error);
  const detail = message.slice(0, 2_000);
  const status = readStatus(error);
  const explicitCode = readString(error, 'code');
  const explicitKind = readString(error, 'kind');
  const retriable = typeof (error as { retriable?: unknown })?.retriable === 'boolean'
    ? (error as { retriable: boolean }).retriable
    : null;
  const stack = errorStack(error);

  if ((explicitCode && ABORT_CODES.has(explicitCode)) || readString(error, 'name') === 'AbortError' || /\baborted\b|abortado/i.test(message)) {
    return { code: 'cancelled', category: 'queue', detail, retriable: false, httpStatus: null, stack };
  }

  // The code the producer set wins: it is the only party that knows which branch ran.
  const explicitLogCode = resolveLogCode(explicitCode);
  if (explicitLogCode) {
    return {
      code: explicitLogCode,
      category: codeInfo(explicitLogCode).category,
      detail,
      retriable: retriable ?? pipelineLogRetriableForCode(explicitLogCode),
      httpStatus: status,
      stack,
    };
  }

  // Subscription runtimes tag their own failures with a ProviderErrorKind.
  const byKind: Record<string, PipelineLogCode> = {
    timeout: 'timeout',
    rateLimit: 'rate_limit',
    unavailable: 'provider_5xx',
    auth: 'auth',
    invalid: 'bad_request',
  };
  if (explicitKind && byKind[explicitKind]) {
    const code = byKind[explicitKind];
    return {
      code,
      category: codeInfo(code).category,
      detail,
      retriable: retriable ?? pipelineLogRetriableForCode(code),
      httpStatus: status,
      stack,
    };
  }

  const errno = readString(error, 'errno') ?? readString(error, 'code');
  if (errno && CONNECTION_ERRNOS.has(errno.toUpperCase())) {
    return { code: 'connection', category: 'connection', detail, retriable: retriable ?? true, httpStatus: status, stack };
  }

  const byMessage = classifyMessage(message, status);
  if (byMessage) {
    return {
      code: byMessage.code,
      category: byMessage.category,
      detail,
      retriable: retriable ?? byMessage.retriable ?? false,
      httpStatus: status,
      stack,
    };
  }

  return { code: 'unknown', category: fallbackCategory, detail, retriable, httpStatus: status, stack };
}

/** Pick the template that fits the severity and whether there is any cause to show. */
function defaultMessage(
  level: PipelineLogLevel,
  subject: PipelineLogSubjectId,
  detail: string | null,
  input: PipelineLogInput,
): PipelineLogText {
  const params: Record<string, ParamValue> = { ...input.params, subject: { id: subject } };
  if (input.reason) params.reason = { id: input.reason };
  if (level === 'success') return { id: 'logDone', params };
  if (level === 'warning') {
    if (input.reason) return { id: 'logWarning', params };
    if (detail) return { id: 'logWarningDetail', params: { ...params, detail } };
    return { id: 'logWarningPlain', params };
  }
  if (level === 'error') {
    if (detail) return { id: 'logFailed', params: { ...params, detail } };
    return { id: 'logFailedPlain', params };
  }
  if (detail) return { id: 'logInfo', params: { ...params, detail } };
  return { id: 'logInfoPlain', params };
}

/**
 * Record one line. This is the single place that builds an entry, so the ambient context,
 * the code→category mapping, the severity and the entry id can never drift between the
 * dozens of call sites.
 */
export function logPipelineEvent(input: PipelineLogInput = {}): void {
  try {
    const context: PipelineLogContext = {
      ...currentPipelineLogContext(),
      ...stripUndefined(input.context ?? {}),
    };
    if (!context.scope) context.scope = 'app';
    const explicitCode = resolveLogCode(typeof input.code === 'string' ? input.code : null);
    const subject = input.subject ?? pipelineSubjectForScope(context.scope);
    const fallbackCategory = input.category
      ?? (explicitCode ? pipelineLogCategoryForCode(explicitCode) : pipelineCategoryForSubject(subject));
    const classified = input.error === undefined
      ? null
      : classifyPipelineError(input.error, fallbackCategory);
    const code = explicitCode ?? classified?.code ?? null;
    const level: PipelineLogLevel = input.level
      ?? (code ? codeInfo(code).level : undefined)
      ?? (input.error === undefined ? 'info' : 'error');
    // Most specific wins: an explicit category, then what the error actually was (a JSON
    // failure inside the indexing pipeline is a JSON failure), then the code, then the
    // subsystem so a success or a nameless failure still lands under a findable filter.
    const category: PipelineLogCategory = input.category
      ?? classified?.category
      ?? (code ? pipelineLogCategoryForCode(code) : pipelineCategoryForSubject(subject));

    const failureDetail = input.detail ?? classified?.detail ?? null;
    let message = input.message;
    // A template that asked for `{detail}` and was handed an error fills it in here, so a
    // caller can pass `message: { id: 'logFailed' }` and let the error supply the cause.
    if (message && 'detail' in (message.params ?? {}) && !String(message.params?.detail ?? '')) {
      message = { ...message, params: { ...message.params, detail: failureDetail ?? '' } };
    }
    if (!message) message = defaultMessage(level, subject, failureDetail, input);
    // Whether the sentence already shows the cause decides if it is repeated underneath: a
    // `{detail}` inside the line must not be printed a second time as `detail: …`.
    const embeddedDetail = 'detail' in (message.params ?? {});

    const entry: PipelineLogEntry = {
      id: nextId(Date.now()),
      at: new Date().toISOString(),
      level,
      category,
      scope: context.scope,
      message,
      code,
      detail: embeddedDetail ? null : failureDetail,
      retriable: input.retriable ?? classified?.retriable ?? null,
      attempts: input.attempts ?? null,
      httpStatus: input.httpStatus ?? classified?.httpStatus ?? null,
      provider: context.provider ?? null,
      model: context.model ?? null,
      durationMs: input.durationMs ?? null,
      phase: context.phase ?? null,
      vaultId: context.vaultId ?? null,
      vaultName: context.vaultName ?? null,
      nodusId: context.nodusId ?? null,
      documentTitle: context.documentTitle ?? null,
      jobId: context.jobId ?? null,
      repeat: 1,
      firstAt: null,
      stack: input.stack ?? classified?.stack ?? null,
    };
    sink?.record(entry);
  } catch {
    // A log line is never worth failing a corpus run for.
  }
}

/** A stage finished. Green in the UI. */
export function logPipelineSuccess(input: PipelineLogInput = {}): void {
  logPipelineEvent({ ...input, level: 'success' });
}

/** Something degraded but the work continued: a fallback, a retry, a skipped item. */
export function logPipelineWarning(input: PipelineLogInput = {}): void {
  logPipelineEvent({ ...input, level: 'warning' });
}

/** Something was noted, with no severity implied. */
export function logPipelineInfo(input: PipelineLogInput = {}): void {
  logPipelineEvent({ ...input, level: 'info' });
}

/**
 * Something failed. `error` is classified into a code and a category, and its message
 * becomes the line's verbatim `detail` — the field a maintainer needs on GitHub.
 */
export function logPipelineFailure(input: PipelineLogInput & { error?: unknown }): void {
  logPipelineEvent({ ...input, level: input.level ?? 'error' });
}
