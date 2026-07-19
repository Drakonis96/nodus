import { app } from 'electron';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ChatGptSubscriptionLogin,
  ChatGptSubscriptionRateLimits,
  ChatGptSubscriptionStatus,
  CodexReasoningEffort,
  ModelInfo,
  ReasoningEffort,
} from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';
import { CodexAppServerClient } from './codexAppServerClient';
import { resolveCodexReasoningEffort, runIsolatedCodexCompletion } from './codexCompletion';
import { ProviderRuntimeError } from './providerErrors';

interface CodexAccountResponse {
  account: null | { type: 'apiKey' } | { type: 'chatgpt'; email: string | null; planType: string } | { type: 'amazonBedrock' };
  requiresOpenaiAuth: boolean;
}

interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface CodexRateLimitSnapshot {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
}

interface CodexRateLimitsResponse {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
}

interface CodexModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  inputModalities?: string[];
  isDefault: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort?: CodexReasoningEffort;
}

interface CodexCompletionOptions {
  model: string;
  system: string;
  user: string;
  reasoning: ReasoningEffort | CodexReasoningEffort | null;
  timeoutMs?: number;
  images?: VisionImagePart[];
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

const STATUS_UNAVAILABLE: ChatGptSubscriptionStatus = {
  available: false,
  connected: false,
  loginPending: false,
  email: null,
  planType: null,
  rateLimits: null,
  error: null,
};

const statusListeners = new Set<(status: ChatGptSubscriptionStatus) => void>();
let client: CodexAppServerClient | null = null;
let clientUnsubscribe: (() => void) | null = null;
let pendingLoginId: string | null = null;
let lastStatus: ChatGptSubscriptionStatus = STATUS_UNAVAILABLE;
let modelCatalog = new Map<string, CodexModel>();

export function onChatGptSubscriptionStatusChanged(
  listener: (status: ChatGptSubscriptionStatus) => void
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function emitStatus(status: ChatGptSubscriptionStatus): void {
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
}

function codexHome(): string {
  const dir = path.join(app.getPath('userData'), 'codex-subscription');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows and restrictive filesystems */ }
  return dir;
}

function unpackedAsarPath(file: string): string {
  const marker = `${path.sep}app.asar${path.sep}`;
  return file.includes(marker) ? file.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`) : file;
}

export function resolveCodexBinaryPath(): string {
  const target = (() => {
    if (process.platform === 'darwin' && process.arch === 'arm64') return ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'];
    if (process.platform === 'darwin' && process.arch === 'x64') return ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'];
    if (process.platform === 'linux' && process.arch === 'arm64') return ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'];
    if (process.platform === 'linux' && process.arch === 'x64') return ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'];
    if (process.platform === 'win32' && process.arch === 'arm64') return ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'];
    if (process.platform === 'win32' && process.arch === 'x64') return ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'];
    return null;
  })();
  if (!target) throw new Error(`Codex no es compatible con ${process.platform}/${process.arch}.`);

  // The Electron bundle recreates __filename in its banner; using it also keeps
  // the repository's CommonJS-based TS test harness compatible with this module.
  const require = createRequire(__filename);
  let packageJson: string;
  try {
    packageJson = require.resolve(`${target[0]}/package.json`);
  } catch {
    // electron-builder may keep optional dependencies nested under their
    // parent package instead of hoisting them. Resolve the signed Codex loader
    // first and accept only its own pinned optional runtime.
    try {
      const codexPackageJson = require.resolve('@openai/codex/package.json');
      packageJson = path.join(
        path.dirname(codexPackageJson),
        'node_modules',
        ...target[0].split('/'),
        'package.json'
      );
      if (!fs.existsSync(packageJson)) throw new Error('nested runtime missing');
    } catch {
      throw new Error('No se encontró el runtime oficial de Codex incluido con Nodus.');
    }
  }
  const executable = unpackedAsarPath(path.join(
    path.dirname(packageJson),
    'vendor',
    target[1],
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex'
  ));
  if (!fs.existsSync(executable)) throw new Error('El ejecutable oficial de Codex no está disponible en esta instalación.');
  return executable;
}

function getClient(): CodexAppServerClient {
  if (client) return client;
  client = new CodexAppServerClient({
    binaryPath: resolveCodexBinaryPath(),
    codexHome: codexHome(),
    appVersion: app.getVersion(),
  });
  clientUnsubscribe = client.onNotification((method) => {
    if (method === 'account/login/completed') pendingLoginId = null;
    if (method === 'account/login/completed' || method === 'account/updated') modelCatalog = new Map();
    if (
      method === 'account/login/completed' ||
      method === 'account/updated' ||
      method === 'account/rateLimits/updated'
    ) {
      void refreshAndEmitStatus();
    }
  });
  return client;
}

function mapRateLimits(snapshot: CodexRateLimitSnapshot | null): ChatGptSubscriptionRateLimits | null {
  if (!snapshot) return null;
  return {
    primary: snapshot.primary,
    secondary: snapshot.secondary,
    credits: snapshot.credits,
  };
}

async function readStatus(refreshToken = false): Promise<ChatGptSubscriptionStatus> {
  try {
    const runtime = getClient();
    const response = await runtime.request<CodexAccountResponse>('account/read', { refreshToken });
    if (response.account?.type !== 'chatgpt') {
      return {
        available: true,
        connected: false,
        loginPending: pendingLoginId !== null,
        email: null,
        planType: null,
        rateLimits: null,
        error: response.account
          ? 'Codex está autenticado con un método no permitido. Nodus solo admite el acceso gestionado con ChatGPT.'
          : null,
      };
    }

    let rateLimits: ChatGptSubscriptionRateLimits | null = null;
    try {
      const limits = await runtime.request<CodexRateLimitsResponse>('account/rateLimits/read');
      const codexBucket = limits.rateLimitsByLimitId?.codex ?? limits.rateLimits;
      rateLimits = mapRateLimits(codexBucket);
    } catch {
      // Account status remains useful if a plan has no rate-limit snapshot.
    }
    return {
      available: true,
      connected: true,
      loginPending: pendingLoginId !== null,
      email: response.account.email,
      planType: response.account.planType,
      rateLimits,
      error: null,
    };
  } catch (error) {
    return {
      ...STATUS_UNAVAILABLE,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// A connected account stays connected between calls, so re-reading it before every
// single generation cost two extra round trips and a forced network token refresh
// per completion — which a scan pipeline pays hundreds of times. Confirm at most
// once per window instead, and drop the cache whenever the session may have changed.
let connectedAt = 0;
let connectedCached = false;
const CONNECTED_TTL_MS = 60_000;

function invalidateConnectedCache(): void {
  connectedAt = 0;
  connectedCached = false;
}

/** Gate a generation on a connected account, reusing a recent check. Keeps the
 *  forced token refresh, but pays for it once per window rather than per call. */
async function ensureConnectedForCompletion(): Promise<void> {
  if (connectedCached && Date.now() - connectedAt < CONNECTED_TTL_MS) return;
  const status = await readStatus(true);
  connectedCached = status.connected;
  connectedAt = Date.now();
  if (!status.connected) {
    throw new ProviderRuntimeError(
      'La suscripción de ChatGPT no está conectada. Ábrela en Proveedores y modelos.',
      'auth'
    );
  }
}

async function refreshAndEmitStatus(): Promise<ChatGptSubscriptionStatus> {
  const status = await readStatus(false);
  emitStatus(status);
  return status;
}

export async function getChatGptSubscriptionStatus(): Promise<ChatGptSubscriptionStatus> {
  return refreshAndEmitStatus();
}

export async function startChatGptSubscriptionLogin(): Promise<ChatGptSubscriptionLogin> {
  const response = await getClient().request<
    { type: 'chatgpt'; loginId: string; authUrl: string } | { type: string }
  >('account/login/start', {
    type: 'chatgpt',
    appBrand: 'chatgpt',
    useHostedLoginSuccessPage: true,
  });
  if (response.type !== 'chatgpt' || !('loginId' in response) || !('authUrl' in response)) {
    throw new Error('Codex no inició el acceso gestionado con ChatGPT.');
  }
  pendingLoginId = response.loginId;
  emitStatus({ ...lastStatus, available: true, loginPending: true, error: null });
  return { loginId: response.loginId, authUrl: response.authUrl };
}

export async function cancelChatGptSubscriptionLogin(loginId: string): Promise<ChatGptSubscriptionStatus> {
  if (pendingLoginId && pendingLoginId !== loginId) throw new Error('El identificador de acceso ya no está activo.');
  await getClient().request('account/login/cancel', { loginId });
  pendingLoginId = null;
  return refreshAndEmitStatus();
}

export async function logoutChatGptSubscription(): Promise<ChatGptSubscriptionStatus> {
  await getClient().request('account/logout');
  pendingLoginId = null;
  modelCatalog = new Map();
  invalidateConnectedCache();
  return refreshAndEmitStatus();
}

async function readModelCatalog(force = false): Promise<CodexModel[]> {
  if (!force && modelCatalog.size > 0) return [...modelCatalog.values()];
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await getClient().request('model/list', {
      cursor,
      limit: 100,
      // Keep the full capability catalog for validating an older saved model; the
      // renderer still filters hidden entries out of the visible picker below.
      includeHidden: true,
    });
    models.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  modelCatalog = new Map(models.map((model) => [model.id, model]));
  return models;
}

export async function listChatGptSubscriptionModels(): Promise<ModelInfo[]> {
  const status = await readStatus(false);
  if (!status.connected) {
    throw new ProviderRuntimeError('Conecta primero una suscripción de ChatGPT en Proveedores y modelos.', 'auth');
  }
  const models = await readModelCatalog(true);
  // Resolved once: finding it inside the comparator re-scanned the catalogue on
  // every comparison.
  const defaultId = models.find((model) => model.isDefault)?.id;
  return models
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: model.id,
      name: model.displayName || model.id,
      vision: (model.inputModalities ?? ['text', 'image']).includes('image'),
      reasoning: (model.supportedReasoningEfforts?.length ?? 0) > 0,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
    }))
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.id.localeCompare(b.id));
}

/** Text/vision completion backed by an ephemeral, isolated Codex thread. */
export async function completeWithChatGptSubscription(options: CodexCompletionOptions): Promise<string> {
  await ensureConnectedForCompletion();

  const runtime = getClient();
  const catalog = await readModelCatalog(false);
  const reasoning = resolveCodexReasoningEffort(
    catalog.find((model) => model.id === options.model) ?? null,
    options.reasoning
  );
  const tempRoot = path.join(app.getPath('temp') || os.tmpdir(), 'nodus-codex-');
  const workdir = await fs.promises.mkdtemp(tempRoot);
  try { await fs.promises.chmod(workdir, 0o700); } catch { /* Windows */ }

  try {
    return await runIsolatedCodexCompletion(runtime, { ...options, reasoning, workdir });
  } catch (error) {
    // The cached check can outlive the session it vouched for (revoked, expired,
    // signed out elsewhere). Any failure re-arms the full check for the next call
    // so a stale "connected" cannot pin the provider in a broken state.
    invalidateConnectedCache();
    throw error;
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  }
}

/**
 * Shut the runtime down from Electron's quit handlers.
 *
 * Synchronous on purpose: `before-quit` cannot await, so the graceful drain — which
 * only escalates to a signal after a 1.5s timer — was abandoned half-way and left
 * the runtime alive as an orphan holding a keyring session. Killing outright is the
 * only teardown that actually completes in a synchronous handler, and nothing is
 * lost by it: credentials are written at login, not at shutdown.
 */
export function killChatGptSubscriptionServer(): void {
  clientUnsubscribe?.();
  clientUnsubscribe = null;
  invalidateConnectedCache();
  const current = client;
  client = null;
  current?.killNow();
}
