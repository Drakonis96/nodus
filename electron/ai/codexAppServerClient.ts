import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ProviderRuntimeError } from './providerErrors';

type JsonRpcId = number;
type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexAppServerClientOptions {
  binaryPath: string;
  codexHome: string;
  appVersion: string;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type CodexNotificationHandler = (method: string, params: unknown) => void;

/**
 * Minimal JSONL client for the official Codex App Server. Authentication is
 * deliberately forced to managed ChatGPT OAuth; API-key environment variables
 * are stripped before the child process starts.
 */
export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private stopping = false;
  private nextId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private notificationHandlers = new Set<CodexNotificationHandler>();
  private stderrTail = '';

  constructor(private readonly options: CodexAppServerClientOptions) {}

  onNotification(handler: CodexNotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    await this.ensureStarted();
    return this.sendRequest<T>(method, params, timeoutMs);
  }

  /** Live child, without starting one. Lets callers skip best-effort teardown
   *  instead of having `request()` respawn the runtime they are cleaning up after. */
  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    if (!child) return;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ProviderRuntimeError('El runtime de ChatGPT se ha cerrado.', 'unavailable'));
    }
    this.pending.clear();

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try { child.stdin.end(); } catch { /* process already gone */ }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* process already gone */ }
    }, 1_500);
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_500))]);
    clearTimeout(timer);
    // Escalate on liveness alone. `child.killed` only means "a signal was delivered
    // to the OS", so the SIGTERM above sets it and testing it here would make this
    // branch unreachable in exactly the case it exists for: a child that ignored
    // SIGTERM and is still running.
    if (child.exitCode === null) {
      try { child.kill('SIGKILL'); } catch { /* process already gone */ }
    }
    this.stopping = false;
  }

  /**
   * Synchronous teardown for app shutdown. Electron's `before-quit` cannot await, so
   * {@link stop}'s graceful drain — which only sends SIGTERM after a 1.5s timer —
   * never gets to run there and the runtime survives as an orphan holding a keyring
   * session. Killing outright is the only teardown that actually completes in a
   * synchronous handler.
   */
  killNow(): void {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ProviderRuntimeError('El runtime de ChatGPT se ha cerrado.', 'unavailable'));
    }
    this.pending.clear();
    if (!child || child.exitCode !== null) return;
    try { child.kill('SIGKILL'); } catch { /* process already gone */ }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => { this.startPromise = null; });
    }
    return this.startPromise;
  }

  private async start(): Promise<void> {
    this.stopping = false;
    this.stderrTail = '';
    const child = spawn(
      this.options.binaryPath,
      [
        '--config', 'forced_login_method="chatgpt"',
        '--config', 'cli_auth_credentials_store="keyring"',
        '--config', 'model_provider="openai"',
        '--config', 'web_search="disabled"',
        '--config', 'mcp_servers={}',
        '--config', 'features.apps=false',
        '--config', 'features.browser_use=false',
        '--config', 'features.code_mode_host=false',
        '--config', 'features.computer_use=false',
        '--config', 'features.goals=false',
        '--config', 'features.hooks=false',
        '--config', 'features.image_generation=false',
        '--config', 'features.in_app_browser=false',
        '--config', 'features.multi_agent=false',
        '--config', 'features.plugins=false',
        '--config', 'features.shell_tool=false',
        '--config', 'features.tool_suggest=false',
        '--config', 'features.unified_exec=false',
        '--config', 'features.workspace_dependencies=false',
        'app-server', '--listen', 'stdio://',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: this.sanitizedEnv(),
      }
    );
    this.child = child;

    // A dying child races every write: the `exitCode === null` guards below can pass
    // and the pipe still be gone by the time the data lands, and an unhandled stream
    // 'error' is an uncaught exception that takes down the whole main process. These
    // listeners swallow it deliberately — the real failure is reported by the 'exit'
    // handler, which rejects every pending request with a description of the exit.
    child.stdin.on('error', () => { /* reported via 'exit' */ });
    child.stdout.on('error', () => { /* reported via 'exit' */ });
    child.stderr.on('error', () => { /* reported via 'exit' */ });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Retain only a small, redacted diagnostic tail. Never log auth output.
      this.stderrTail = redactSecrets(`${this.stderrTail}${chunk}`).slice(-4_000);
    });
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.stopping) {
        const detail = this.stderrTail.trim();
        this.handleExit(new ProviderRuntimeError(
          `El runtime oficial de Codex se cerró inesperadamente (${signal ?? code ?? 'sin código'}).${detail ? ` ${detail}` : ''}`,
          'unavailable'
        ));
      }
    });

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'nodus_desktop',
        title: 'Nodus',
        version: this.options.appVersion,
      },
      capabilities: { experimentalApi: false },
    }, 60_000);
    this.sendNotification('initialized');
  }

  private sanitizedEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...(this.options.env ?? process.env), CODEX_HOME: this.options.codexHome };
    // Managed ChatGPT auth only. Prevent an ambient developer credential or custom
    // endpoint from silently changing which account/billing surface Nodus uses.
    for (const name of [
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'CODEX_ACCESS_TOKEN',
      'AZURE_OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
    ]) delete env[name];
    // The model has no execution tools, but do not pass unrelated credentials to
    // the child process in the first place. Keep ordinary runtime variables such
    // as PATH, HOME, locale and proxy configuration untouched.
    // `SESSION` is deliberately absent: it matched DBUS_SESSION_BUS_ADDRESS,
    // XDG_SESSION_* and macOS SECURITYSESSIONID, which are desktop-integration
    // handles rather than credentials, and dropping them can stop the runtime from
    // opening a browser or reaching the keyring during login. Genuine session
    // credentials (AWS_SESSION_TOKEN, SESSION_SECRET, …) still match TOKEN/SECRET.
    for (const name of Object.keys(env)) {
      if (/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH_SOCK)/i.test(name)) delete env[name];
    }
    delete env.NODE_OPTIONS;
    env.CODEX_HOME = this.options.codexHome;
    return env;
  }

  private sendRequest<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const id = this.nextId++;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return Promise.reject(new ProviderRuntimeError('El runtime oficial de Codex no está disponible.', 'unavailable'));
    }
    const payload: JsonObject = { id, method };
    if (params !== undefined) payload.params = params;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderRuntimeError(`Codex no respondió a «${method}» dentro del tiempo esperado.`, 'timeout'));
      }, timeoutMs ?? this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const payload: JsonObject = { method };
    if (params !== undefined) payload.params = params;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }

    if (typeof message?.id === 'number' && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex devolvió un error de protocolo.'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message?.method === 'string' && message.id !== undefined) {
      // Nodus never grants tool or approval requests to the runtime. In normal text
      // generation this path is unreachable because approvals are set to `never`.
      this.child?.stdin.write(`${JSON.stringify({
        id: message.id,
        error: { code: -32601, message: 'Nodus no expone herramientas interactivas a este runtime.' },
      })}\n`);
      return;
    }

    if (typeof message?.method === 'string') {
      for (const handler of this.notificationHandlers) handler(message.method, message.params);
    }
  }

  private handleExit(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/(?:Bearer\s+|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9._-]*/gi, '[credencial ocultada]')
    .replace(/([?&](?:code|token|state)=)[^\s&]+/gi, '$1[oculto]');
}
