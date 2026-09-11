import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPublicHost } from '../../skill-capabilities/publicHost';
import type { TrustedNetworkPermission, TrustedPermissionSetV2 } from '../../packages/capability-api/src/permissions';
import type { CapabilityHostServices, TrustedWorkerRuntime } from './workerHost';

/** The host side of every channel a trusted worker can call.
 *
 *  Nothing here is implicitly allowed: each method starts by finding the permission the
 *  capability declared, and refuses when there is none. The worker is first-party code,
 *  so this is not a containment boundary — it is the place where a package's declared
 *  reach and its actual reach are kept the same, and where the user's secrets stay out
 *  of the process that would otherwise have to hold them. */

export interface CapabilityServiceAdapters {
  /** One completion against the conversation's own model. */
  model?: (runtime: TrustedWorkerRuntime, request: { system?: string; prompt: string; maxTokens?: number }, signal: AbortSignal) => Promise<string>;
  svg?: {
    validate: (svg: string) => Promise<{ ok: boolean; errors: string[] }>;
    inspect: (svg: string) => Promise<{ width?: number; height?: number; elements: number }>;
    refine: (request: { svg: string; instruction: string }, signal: AbortSignal) => Promise<string>;
  };
  python?: {
    ensureRuntime: (runtime: TrustedWorkerRuntime, runtimeId: string, signal: AbortSignal) => Promise<{ ready: boolean; detail?: string }>;
    run: (runtime: TrustedWorkerRuntime, request: { runtimeId: string; args: string[]; stdin?: string; secret?: string; timeoutMs: number }, signal: AbortSignal) => Promise<{ code: number; stdout: string; stderr: string }>;
  };
  subworker?: (runtime: TrustedWorkerRuntime, request: { entry: string; input: unknown; timeoutMs: number }, signal: AbortSignal) => Promise<unknown>;
  /** Bound by the caller to the conversation the invocation belongs to. */
  attachments?: (runtime: TrustedWorkerRuntime, request: { bytes: Buffer; name: string; mimeType: string }) => Promise<{ attachmentId: string; bytes: number }>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const pluginsRoot = () => path.join(app.getPath('userData'), 'plugins');
const namespaced = (root: string, runtime: TrustedWorkerRuntime) => {
  const capability = runtime.manifest.id;
  if (!SLUG.test(runtime.plugin.id) || !SLUG.test(capability)) throw new Error('Invalid capability storage namespace.');
  return path.join(root, runtime.plugin.id, capability);
};

/** Code, durable data, rebuildable caches, runtimes and secrets are separate trees, so a
 *  reinstall, a cache wipe and an uninstall can each touch exactly what they mean to. */
export const capabilityDataDir = (runtime: TrustedWorkerRuntime) => namespaced(path.join(pluginsRoot(), 'data'), runtime);
export const capabilityCacheDir = (runtime: TrustedWorkerRuntime) => namespaced(path.join(pluginsRoot(), 'cache'), runtime);
export const capabilityTempDir = (runtime: TrustedWorkerRuntime) => path.join(capabilityCacheDir(runtime), 'temp');
const secretsFile = (pluginId: string) => {
  if (!SLUG.test(pluginId)) throw new Error('Invalid plugin id.');
  return path.join(pluginsRoot(), 'secrets', `${pluginId}.bin`);
};

function readJsonFile(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function writeJsonFile(file: string, value: Record<string, unknown>, quota: number): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > quota) throw new Error('Capability storage quota exceeded.');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, encoded, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function storageLane(runtime: TrustedWorkerRuntime, lane: 'state' | 'cache'): { file: string; quota: number } {
  const permission = runtime.permissions.storage;
  if (!permission) throw new Error('Capability storage is not permitted.');
  const quota = lane === 'state' ? permission.stateBytes : permission.cacheBytes;
  if (quota <= 0) throw new Error(`Capability ${lane} storage is not permitted.`);
  const dir = lane === 'state' ? capabilityDataDir(runtime) : capabilityCacheDir(runtime);
  return { file: path.join(dir, `${lane}.json`), quota };
}

export function readCapabilitySecret(pluginId: string, capabilityId: string, secretId: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try { return (JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile(pluginId)))) as Record<string, string>)[`${capabilityId}:${secretId}`]; }
  catch { return undefined; }
}

export function writeCapabilitySecret(pluginId: string, capabilityId: string, secretId: string, value: string | null): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The secure credential store is unavailable.');
  const file = secretsFile(pluginId);
  let secrets: Record<string, string> = {};
  try { secrets = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as Record<string, string>; } catch { secrets = {}; }
  const key = `${capabilityId}:${secretId}`;
  if (value && value.trim()) secrets[key] = value.trim(); else delete secrets[key];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function declaredEndpoint(permissions: TrustedPermissionSetV2, endpointId: unknown): TrustedNetworkPermission {
  const endpoint = permissions.network?.find(candidate => candidate.id === endpointId);
  if (!endpoint) throw new Error('Capability endpoint is not permitted.');
  return endpoint;
}

/** Builds the request the permission actually allows, or refuses. The secret, if any,
 *  is added here and never travels to the worker. */
async function authorizedRequest(runtime: TrustedWorkerRuntime, payload: unknown): Promise<{ url: URL; method: string; headers: Record<string, string>; body?: string; endpoint: TrustedNetworkPermission }> {
  const value = (payload ?? {}) as { endpointId?: unknown; path?: unknown; method?: unknown; headers?: unknown; body?: unknown };
  const endpoint = declaredEndpoint(runtime.permissions, value.endpointId);
  const relative = typeof value.path === 'string' ? value.path : '/';
  const method = String(value.method ?? 'GET').toUpperCase();
  const allowedPath = endpoint.pathPrefixes.some(prefix => relative === prefix || relative.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  if (!relative.startsWith('/') || relative.includes('..') || !allowedPath) throw new Error('Capability network request exceeds its permission.');
  if (!(endpoint.methods as readonly string[]).includes(method)) throw new Error('Capability network method is not permitted.');
  const url = new URL(relative, endpoint.origin);
  if (url.origin !== new URL(endpoint.origin).origin) throw new Error('Capability network origin changed.');
  await assertPublicHost(url.hostname);

  const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' };
  // A worker may set ordinary headers, but never one the host reserves for a secret:
  // otherwise a package could overwrite the credential the user actually configured.
  const reserved = new Set((runtime.permissions.secrets ?? [])
    .filter(secret => secret.injection.kind === 'header' && secret.injection.endpointId === endpoint.id)
    .map(secret => secret.injection.kind === 'header' ? secret.injection.header.toLowerCase() : ''));
  for (const [name, headerValue] of Object.entries((value.headers ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(name) || typeof headerValue !== 'string' || headerValue.length > 2_000) throw new Error('Invalid capability request header.');
    if (reserved.has(name.toLowerCase()) || ['authorization', 'cookie', 'host'].includes(name.toLowerCase())) throw new Error(`Capability may not set the ${name} header.`);
    headers[name] = headerValue;
  }
  for (const secret of runtime.permissions.secrets ?? []) {
    if (secret.injection.kind !== 'header' || secret.injection.endpointId !== endpoint.id) continue;
    const stored = readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, secret.id);
    if (!stored) { if (secret.required) throw new Error(`Configure ${secret.label} before using this capability.`); continue; }
    headers[secret.injection.header] = `${secret.injection.prefix ?? ''}${stored}`;
  }

  let body: string | undefined;
  if (value.body !== undefined) {
    body = typeof value.body === 'string' ? value.body : JSON.stringify(value.body);
    if (Buffer.byteLength(body) > 1_000_000) throw new Error('Capability request body is too large.');
    headers['Content-Type'] ??= 'application/json';
  }
  return { url, method, headers, body, endpoint };
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new Error('Capability response is too large.'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('Capability response is too large.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

export function createCapabilityHostServices(adapters: CapabilityServiceAdapters = {}): CapabilityHostServices {
  return async ({ runtime, channel, method, payload, signal }) => {
    signal.throwIfAborted();
    const value = (payload ?? {}) as Record<string, unknown>;
    const key = () => {
      const name = value.key;
      if (typeof name !== 'string' || !KEY.test(name)) throw new Error('Invalid capability storage key.');
      return name;
    };

    if (channel === 'storage') {
      if (method === 'temp.dir') {
        if (!(runtime.permissions.storage?.tempBytes ?? 0)) throw new Error('Capability temporary storage is not permitted.');
        const dir = capabilityTempDir(runtime);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        return dir;
      }
      if (method === 'temp.clear') { fs.rmSync(capabilityTempDir(runtime), { recursive: true, force: true }); return null; }
      const [lane, operation] = method.split('.');
      if (lane !== 'state' && lane !== 'cache') throw new Error('Unknown capability storage lane.');
      const { file, quota } = storageLane(runtime, lane);
      const contents = readJsonFile(file);
      if (operation === 'get') return contents[key()] ?? null;
      if (operation === 'keys') return Object.keys(contents);
      if (operation === 'set') { contents[key()] = value.value; writeJsonFile(file, contents, quota); return null; }
      if (operation === 'delete') { delete contents[key()]; writeJsonFile(file, contents, quota); return null; }
      throw new Error('Unknown capability storage operation.');
    }

    if (channel === 'secrets') {
      const id = String(value.id ?? '');
      const declared = runtime.permissions.secrets?.find(secret => secret.id === id);
      if (!declared) throw new Error('Capability secret is not declared.');
      if (method === 'has') return Boolean(readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id));
      if (method === 'store') {
        const secret = value.value;
        if (typeof secret !== 'string' || !secret.trim() || secret.length > 8_000) throw new Error('Invalid capability secret.');
        writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, secret);
        return null;
      }
      if (method === 'delete') { writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, null); return null; }
      throw new Error('Unknown capability secret operation.');
    }

    if (channel === 'network') {
      const { url, method: verb, headers, body, endpoint } = await authorizedRequest(runtime, payload);
      const timeout = AbortSignal.timeout(endpoint.timeoutMs);
      const response = await fetch(url, { method: verb, headers, body, redirect: 'error', signal: AbortSignal.any([signal, timeout]) });
      if (method === 'downloadToTemp') {
        if (!(runtime.permissions.storage?.tempBytes ?? 0)) throw new Error('Capability temporary storage is not permitted.');
        const bytes = await readBounded(response, Math.min(endpoint.maxResponseBytes, runtime.permissions.storage!.tempBytes));
        const dir = capabilityTempDir(runtime);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `${randomUUID()}.bin`);
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        return { status: response.status, path: file, bytes: bytes.length };
      }
      if (method !== 'fetch') throw new Error('Unknown capability network operation.');
      const bytes = await readBounded(response, endpoint.maxResponseBytes);
      return { status: response.status, headers: Object.fromEntries(response.headers), body: bytes };
    }

    if (channel === 'model') {
      if (!runtime.permissions.model) throw new Error('Capability model access is not permitted.');
      if (method !== 'complete') throw new Error('Unknown capability model operation.');
      if (!adapters.model) throw new Error('Model access is unavailable in this context.');
      const prompt = value.prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Invalid capability model request.');
      return adapters.model(runtime, { system: typeof value.system === 'string' ? value.system : undefined, prompt, maxTokens: typeof value.maxTokens === 'number' ? value.maxTokens : undefined }, signal);
    }

    if (channel === 'svg') {
      if (!runtime.permissions.svg) throw new Error('Capability SVG access is not permitted.');
      if (!adapters.svg) throw new Error('SVG services are unavailable in this context.');
      const svg = typeof value.svg === 'string' ? value.svg : '';
      if (method === 'validate') return adapters.svg.validate(svg);
      if (method === 'inspect') return adapters.svg.inspect(svg);
      if (method === 'refine') return adapters.svg.refine({ svg, instruction: String(value.instruction ?? '') }, signal);
      throw new Error('Unknown capability SVG operation.');
    }

    if (channel === 'subworker') {
      if (!runtime.permissions.subworkers) throw new Error('Capability subworkers are not permitted.');
      if (method !== 'run') throw new Error('Unknown capability subworker operation.');
      if (!adapters.subworker) throw new Error('Subworkers are unavailable in this context.');
      const entry = value.entry;
      if (typeof entry !== 'string' || entry.includes('..') || path.isAbsolute(entry)) throw new Error('Invalid capability subworker entry.');
      return adapters.subworker(runtime, { entry, input: value.input, timeoutMs: Number(value.timeoutMs ?? 30_000) }, signal);
    }

    if (channel === 'python') {
      const runtimeId = String(value.runtimeId ?? '');
      const declared = runtime.permissions.runtimes?.find(entry => entry.id === runtimeId && entry.kind === 'python');
      if (!declared) throw new Error('Capability Python runtime is not declared.');
      if (!adapters.python) throw new Error('Python runtimes are unavailable in this context.');
      if (method === 'ensureRuntime') return adapters.python.ensureRuntime(runtime, runtimeId, signal);
      if (method !== 'run') throw new Error('Unknown capability Python operation.');
      const args = Array.isArray(value.args) ? value.args.map(String) : [];
      // The key is read here and handed straight to the interpreter's stdin: it never
      // passes through the worker, the renderer, a log line or a command line.
      const secretId = typeof value.secretId === 'string' ? value.secretId : undefined;
      const secret = secretId && runtime.permissions.secrets?.some(entry => entry.id === secretId && entry.injection.kind === 'process-stdin' && entry.injection.runtimeId === runtimeId)
        ? readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, secretId)
        : undefined;
      if (secretId && !secret) throw new Error('That capability credential is not configured.');
      return adapters.python.run(runtime, { runtimeId, args, stdin: typeof value.stdin === 'string' ? value.stdin : undefined, secret, timeoutMs: Number(value.timeoutMs ?? 120_000) }, signal);
    }

    if (channel === 'attachments') {
      if (method !== 'store') throw new Error('Unknown capability attachment operation.');
      if (!adapters.attachments) throw new Error('Attachments are unavailable in this context.');
      const bytes = value.bytes;
      const buffer = bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(String(bytes ?? ''), 'base64');
      if (!buffer.length || buffer.length > 64 * 1024 * 1024) throw new Error('Invalid capability attachment.');
      return adapters.attachments(runtime, { bytes: buffer, name: String(value.name ?? ''), mimeType: String(value.mimeType ?? '') });
    }

    throw new Error('Unknown capability host channel.');
  };
}
