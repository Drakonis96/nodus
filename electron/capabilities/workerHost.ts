import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { LIMITS, TRUSTED_PROTOCOL } from '../../packages/capability-api/src/limits';
import { validateWorkerToHost, type HostChannel, type HostToWorkerMessage, type WorkerMethod } from '../../packages/capability-api/src/protocol';
import type { CapabilityManifestV2 } from '../../packages/capability-api/src/manifest';
import type { TrustedPermissionSetV2 } from '../../packages/capability-api/src/permissions';

/** Runs one trusted capability in its own utility process.
 *
 *  This buys fault isolation, a deadline and a kill switch — not a security boundary.
 *  The signature is what makes running this code acceptable; the process only makes a
 *  hang or a crash survivable. */

export interface TrustedWorkerRuntime {
  capabilityId: string;
  plugin: { id: string; version: string; digest: string };
  manifest: CapabilityManifestV2;
  /** Absolute path to the package's worker bundle, inside the installed version. */
  entryPath: string;
  permissions: TrustedPermissionSetV2;
}

/** Everything the worker may ask the host to do, already permission-gated. */
export type CapabilityHostServices = (call: {
  runtime: TrustedWorkerRuntime;
  channel: HostChannel;
  method: string;
  payload: unknown;
  signal: AbortSignal;
}) => Promise<unknown>;

export interface CapabilityWorkerLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  detail?: Record<string, string | number | boolean>;
}

export interface CapabilityWorkerHandleOptions {
  /** A turn's services carry its owner and budget; never reuse them across turns. */
  scopeKey?: string;
  services: CapabilityHostServices;
  onLog?: (runtime: TrustedWorkerRuntime, entry: CapabilityWorkerLog) => void;
  /** Overridable so tests can run the bootstrap without a packaged build. */
  bootstrapPath?: string;
}

const READY_TIMEOUT_MS = 20_000;

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class CapabilityWorkerHandle {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private abort = new AbortController();
  private killTimer: NodeJS.Timeout | null = null;
  private nextCallId = 0;

  constructor(private readonly runtime: TrustedWorkerRuntime, private readonly options: CapabilityWorkerHandleOptions) {}

  get alive(): boolean { return this.child !== null; }

  async call<T>(method: WorkerMethod, payload: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    options.signal?.throwIfAborted();
    await this.start();
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? LIMITS.toolTimeoutMsMax, LIMITS.toolTimeoutMsMin), LIMITS.toolTimeoutMsMax);
    const callId = `c${this.nextCallId++}`;
    return new Promise<T>((resolve, reject) => {
      const settle = (error?: Error, value?: unknown) => {
        const entry = this.pending.get(callId);
        if (!entry) return;
        this.pending.delete(callId);
        clearTimeout(entry.timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value as T);
      };
      const onAbort = () => { this.cancel(); settle(new DOMException('The capability call was cancelled.', 'AbortError')); };
      const timer = setTimeout(() => {
        // A worker past its deadline is not asked politely twice: cancel, then kill.
        this.cancel();
        settle(new Error(`${this.runtime.capabilityId} exceeded ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(callId, { resolve: value => settle(undefined, value), reject: error => settle(error), timer });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try { this.post({ type: 'call', callId, method, payload }); }
      catch (error) { settle(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /** Asks the worker to stop, then kills it if it does not. Pending calls are rejected
   *  either way: whatever the process is still doing, its answer is no longer wanted. */
  cancel(): void {
    this.abort.abort();
    if (!this.child) return;
    try { this.post({ type: 'cancel' }); } catch { /* the process is already gone */ }
    if (this.killTimer) return;
    this.killTimer = setTimeout(() => { this.killTimer = null; this.teardown(new Error(`${this.runtime.capabilityId} did not stop and was terminated.`)); }, LIMITS.cancelGraceMs);
    this.killTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (!this.child) return;
    try { this.post({ type: 'shutdown' }); } catch { /* already gone */ }
    const child = this.child;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => resolve(), LIMITS.cancelGraceMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.teardown(new Error(`${this.runtime.capabilityId} was stopped.`));
  }

  private post(message: HostToWorkerMessage): void {
    if (!this.child) throw new Error(`${this.runtime.capabilityId} is not running.`);
    this.child.postMessage(message);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    if (this.abort.signal.aborted) this.abort = new AbortController();
    const bootstrap = this.options.bootstrapPath ?? path.join(__dirname, 'capabilityWorkerBootstrap.js');
    const child = utilityProcess.fork(bootstrap, [], { serviceName: `Nodus capability ${this.runtime.capabilityId}`, stdio: 'ignore' });
    this.child = child;

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.runtime.capabilityId} did not start.`)), READY_TIMEOUT_MS);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.on('message', raw => {
        let message;
        // A frame the host cannot parse is dropped, not acted on: the worker is
        // first-party but the port is still a boundary worth validating.
        try { message = validateWorkerToHost(raw); } catch { return; }
        if (message.type === 'ready') {
          if (message.protocol !== TRUSTED_PROTOCOL || message.capabilityId !== this.runtime.capabilityId) {
            fail(new Error(`${this.runtime.capabilityId} answered for a different capability.`));
            this.teardown(new Error('Handshake mismatch.'));
            return;
          }
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'result') {
          if (message.callId === 'init') { fail(new Error(message.ok ? 'The capability failed to load.' : message.error)); return; }
          const pending = this.pending.get(message.callId);
          if (!pending) return;
          if (message.ok) pending.resolve(message.value);
          else pending.reject(message.code === 'cancelled' ? new DOMException(message.error, 'AbortError') : new Error(message.error));
          return;
        }
        if (message.type === 'log') { this.options.onLog?.(this.runtime, message); return; }
        if (message.type === 'host-call') void this.serveHostCall(message.callId, message.channel, message.method, message.payload);
      });
      child.once('error', error => { fail(new Error(String(error))); this.teardown(new Error(String(error))); });
      child.once('exit', code => {
        fail(new Error(`${this.runtime.capabilityId} exited before it was ready.`));
        this.teardown(new Error(`${this.runtime.capabilityId} exited (code ${code}).`));
      });
      try { child.postMessage({ type: 'init', capabilityId: this.runtime.capabilityId, entryPath: this.runtime.entryPath }); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });

    // A failed start must not be remembered as the permanent state of this capability:
    // clearing the promise lets the next invocation spawn a fresh process.
    return this.ready.catch(error => { this.ready = null; throw error; });
  }

  private async serveHostCall(callId: string, channel: HostChannel, method: string, payload: unknown): Promise<void> {
    const child = this.child, signal = this.abort.signal;
    try {
      const value = await this.options.services({ runtime: this.runtime, channel, method, payload, signal });
      if (signal.aborted || child !== this.child) return;
      this.post({ type: 'host-result', callId, ok: true, value });
    } catch (error) {
      if (signal.aborted || child !== this.child) return;
      try { this.post({ type: 'host-result', callId, ok: false, error: error instanceof Error ? error.message : String(error) }); }
      catch { /* the worker is gone; nothing is waiting for this answer */ }
    }
  }

  private teardown(reason: Error): void {
    this.abort.abort();
    if (this.killTimer) { clearTimeout(this.killTimer); this.killTimer = null; }
    const child = this.child;
    this.child = null;
    this.ready = null;
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(reason); }
    this.pending.clear();
    try { child?.kill(); } catch { /* already gone */ }
  }
}

const handles = new Map<string, CapabilityWorkerHandle>();

/** One live worker per capability and digest. A package that updates gets a new key, so
 *  a turn already running against the old digest keeps the process it started with. */
export function acquireCapabilityWorker(runtime: TrustedWorkerRuntime, options: CapabilityWorkerHandleOptions): CapabilityWorkerHandle {
  const key = `${runtime.capabilityId}@${runtime.plugin.version}+${runtime.plugin.digest}${options.scopeKey ? `#${options.scopeKey}` : ''}`;
  const existing = handles.get(key);
  if (existing) return existing;
  const handle = new CapabilityWorkerHandle(runtime, options);
  handles.set(key, handle);
  return handle;
}

export async function stopCapabilityWorkers(predicate?: (key: string) => boolean): Promise<void> {
  for (const [key, handle] of [...handles]) {
    if (predicate && !predicate(key)) continue;
    handles.delete(key);
    await handle.stop();
  }
}
