/** Generic entry point for every trusted capability worker.
 *
 *  One bootstrap for all packages: a plugin ships a module, not a process. The bootstrap
 *  owns the wire protocol, the host proxy and cancellation, so a plugin author writes a
 *  `CapabilityWorkerV2` and nothing else. Everything crossing the port is validated on
 *  both ends: a malformed frame must fail one call, never take the process down. */

import { createRequire } from 'node:module';
import { validateHostToWorker, type HostChannel, type WorkerToHostMessage } from '../../packages/capability-api/src/protocol';
import { TRUSTED_PROTOCOL } from '../../packages/capability-api/src/limits';
import type { CapabilityHostV2, CapabilityWorkerFactory, CapabilityWorkerV2, KeyValueStore } from '../../packages/capability-api/src/worker';

interface InitMessage { type: 'init'; capabilityId: string; entryPath: string }

const port = process.parentPort;
if (!port) throw new Error('The capability bootstrap must run as a utility process.');

const post = (message: WorkerToHostMessage) => port.postMessage(message);

let nextCallId = 0;
const pendingHostCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
/** One controller for the whole process: cancelling a capability cancels its work,
 *  and the host kills the process if this is not enough within the grace period. */
let controller = new AbortController();

function hostCall(channel: HostChannel, method: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `h${nextCallId++}`;
    pendingHostCalls.set(callId, { resolve, reject });
    post({ type: 'host-call', callId, channel, method, payload });
  });
}

const store = (namespace: 'state' | 'cache'): KeyValueStore => ({
  get: key => hostCall('storage', `${namespace}.get`, { key }),
  set: (key, value) => hostCall('storage', `${namespace}.set`, { key, value }) as Promise<void>,
  delete: key => hostCall('storage', `${namespace}.delete`, { key }) as Promise<void>,
  keys: () => hostCall('storage', `${namespace}.keys`, {}) as Promise<string[]>,
});

const host: CapabilityHostV2 = {
  network: {
    fetch: (endpointId, request) => hostCall('network', 'fetch', { endpointId, ...request }) as ReturnType<CapabilityHostV2['network']['fetch']>,
    downloadToTemp: (endpointId, request) => hostCall('network', 'downloadToTemp', { endpointId, ...request }) as ReturnType<CapabilityHostV2['network']['downloadToTemp']>,
  },
  storage: {
    state: store('state'),
    cache: store('cache'),
    temp: { dir: () => hostCall('storage', 'temp.dir', {}) as Promise<string>, clear: () => hostCall('storage', 'temp.clear', {}) as Promise<void> },
  },
  secrets: {
    // `has` only: a worker learns whether a credential is configured, never its value.
    // The host injects the secret itself, into a header or a process's stdin.
    has: id => hostCall('secrets', 'has', { id }) as Promise<boolean>,
    store: (id, value) => hostCall('secrets', 'store', { id, value }) as Promise<void>,
    delete: id => hostCall('secrets', 'delete', { id }) as Promise<void>,
  },
  model: { complete: request => hostCall('model', 'complete', request) as Promise<string> },
  svg: {
    validate: svg => hostCall('svg', 'validate', { svg }) as ReturnType<CapabilityHostV2['svg']['validate']>,
    inspect: svg => hostCall('svg', 'inspect', { svg }) as ReturnType<CapabilityHostV2['svg']['inspect']>,
    refine: request => hostCall('svg', 'refine', request) as Promise<string>,
  },
  subworker: { run: request => hostCall('subworker', 'run', request) },
  python: {
    ensureRuntime: runtimeId => hostCall('python', 'ensureRuntime', { runtimeId }) as ReturnType<CapabilityHostV2['python']['ensureRuntime']>,
    run: request => hostCall('python', 'run', request) as ReturnType<CapabilityHostV2['python']['run']>,
  },
  attachments: { store: request => hostCall('attachments', 'store', request) as ReturnType<CapabilityHostV2['attachments']['store']> },
  log: (level, message, detail) => post({ type: 'log', level, message, ...(detail ? { detail } : {}) }),
  get signal() { return controller.signal; },
};

let worker: CapabilityWorkerV2 | null = null;
let capabilityId = '';

async function load(init: InitMessage): Promise<void> {
  capabilityId = init.capabilityId;
  const required = createRequire(init.entryPath)(init.entryPath) as { default?: CapabilityWorkerFactory } | CapabilityWorkerFactory;
  const factory = typeof required === 'function' ? required : required.default;
  if (typeof factory !== 'function') throw new Error('The capability entry must export a worker factory.');
  worker = await factory(host);
  if (!worker || typeof worker.invoke !== 'function' || typeof worker.health !== 'function' || typeof worker.renderArtifact !== 'function' || typeof worker.shutdown !== 'function') {
    throw new Error('The capability entry did not return a complete worker.');
  }
  post({ type: 'ready', protocol: TRUSTED_PROTOCOL, capabilityId });
}

port.on('message', event => {
  const raw = event.data as unknown;
  if (raw && typeof raw === 'object' && (raw as InitMessage).type === 'init') {
    const init = raw as InitMessage;
    void load(init).catch(error => {
      post({ type: 'result', callId: 'init', ok: false, error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
    return;
  }

  let message;
  try { message = validateHostToWorker(raw); }
  catch { return; }

  if (message.type === 'host-result') {
    const pending = pendingHostCalls.get(message.callId);
    if (!pending) return;
    pendingHostCalls.delete(message.callId);
    if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error));
    return;
  }

  if (message.type === 'cancel') {
    controller.abort(new DOMException('The capability call was cancelled.', 'AbortError'));
    // Every host call in flight is dead too: its answer can no longer be used.
    for (const [, pending] of pendingHostCalls) pending.reject(new DOMException('The capability call was cancelled.', 'AbortError'));
    pendingHostCalls.clear();
    controller = new AbortController();
    return;
  }

  if (message.type === 'shutdown') {
    void Promise.resolve(worker?.shutdown()).catch(() => {}).finally(() => process.exit(0));
    return;
  }

  const { callId, method, payload } = message;
  void (async () => {
    if (!worker) throw new Error('The capability worker is not loaded.');
    const implementation = worker[method] as ((input: unknown) => Promise<unknown>) | undefined;
    // A method the manifest advertised but the module never implemented is an error the
    // caller can act on, not a silent undefined that looks like an empty result.
    if (typeof implementation !== 'function') throw new Error(`This capability does not implement ${method}.`);
    return implementation.call(worker, payload);
  })().then(
    value => post({ type: 'result', callId, ok: true, value }),
    error => post({
      type: 'result', callId, ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.name === 'AbortError' ? { code: 'cancelled' } : {}),
    }),
  );
});
