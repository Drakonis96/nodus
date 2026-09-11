import { SLUG, exactKeys, plainText } from './json';

/** What a trusted worker may reach. Everything absent is denied; there is no implicit
 *  allowance. The set is also what the user is shown and what an update is diffed against. */
export interface TrustedNetworkPermission {
  id: string;
  origin: string;
  pathPrefixes: string[];
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  /** Largest response the host will buffer or stream to disk for this endpoint. */
  maxResponseBytes: number;
  timeoutMs: number;
}

export interface TrustedSecretPermission {
  id: string;
  label: string;
  required: boolean;
  /** Where the host injects the value. The worker never receives the plaintext. */
  injection:
    | { kind: 'header'; endpointId: string; header: string; prefix?: string }
    | { kind: 'process-stdin'; runtimeId: string };
}

export interface TrustedStoragePermission {
  /** Survives updates and is backed up. */
  stateBytes: number;
  /** Rebuildable; excluded from backups. */
  cacheBytes: number;
  /** Cleared when the worker stops. */
  tempBytes: number;
}

export interface TrustedModelPermission {
  /** Calls to the conversation's own model, per invocation. Counts against the metered lane. */
  maxCalls: number;
  purpose: string;
}

export interface TrustedRuntimePermission {
  id: string;
  kind: 'python';
  /** Minimum interpreter the host must find before the runtime is considered installable. */
  minVersion: string;
}

export interface TrustedPermissionSetV2 {
  network?: TrustedNetworkPermission[];
  secrets?: TrustedSecretPermission[];
  storage?: TrustedStoragePermission;
  model?: TrustedModelPermission;
  /** Access to the core SVG services (validate / inspect / refine). No chemistry in them. */
  svg?: boolean;
  /** Auxiliary workers spawned from the plugin's own bundle, killable by the host. */
  subworkers?: { max: number };
  runtimes?: TrustedRuntimePermission[];
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const KEYS = ['network', 'secrets', 'storage', 'model', 'svg', 'subworkers', 'runtimes'];

export function validateTrustedPermissions(input: unknown): TrustedPermissionSetV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !exactKeys(input, KEYS)) throw new Error('Invalid capability permissions.');
  const value = input as TrustedPermissionSetV2;

  const endpointIds = new Set<string>();
  for (const endpoint of value.network ?? []) {
    let url: URL;
    try { url = new URL(endpoint.origin); } catch { throw new Error('Invalid capability network origin.'); }
    if (!exactKeys(endpoint, ['id', 'origin', 'pathPrefixes', 'methods', 'maxResponseBytes', 'timeoutMs'])
      || !SLUG.test(endpoint.id) || endpointIds.has(endpoint.id)
      || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password
      || !Array.isArray(endpoint.pathPrefixes) || !endpoint.pathPrefixes.length || endpoint.pathPrefixes.length > 24
      || endpoint.pathPrefixes.some(prefix => typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.includes('..'))
      || !Array.isArray(endpoint.methods) || !endpoint.methods.length || endpoint.methods.some(method => !METHODS.includes(method))
      || !Number.isInteger(endpoint.maxResponseBytes) || endpoint.maxResponseBytes < 1024 || endpoint.maxResponseBytes > 4 * 1024 * 1024 * 1024
      || !Number.isInteger(endpoint.timeoutMs) || endpoint.timeoutMs < 1_000 || endpoint.timeoutMs > 300_000) throw new Error('Invalid capability network permission.');
    endpointIds.add(endpoint.id);
  }

  const runtimeIds = new Set((value.runtimes ?? []).map(runtime => runtime?.id));
  const secretIds = new Set<string>();
  for (const secret of value.secrets ?? []) {
    if (!secret || !exactKeys(secret, ['id', 'label', 'required', 'injection']) || !SLUG.test(secret.id) || secretIds.has(secret.id)
      || !plainText(secret.label, 80) || typeof secret.required !== 'boolean' || !secret.injection) throw new Error('Invalid capability secret permission.');
    const injection = secret.injection;
    if (injection.kind === 'header') {
      if (!exactKeys(injection, ['kind', 'endpointId', 'header', 'prefix']) && !exactKeys(injection, ['kind', 'endpointId', 'header'])) throw new Error('Invalid secret injection.');
      if (!endpointIds.has(injection.endpointId) || !/^[A-Za-z0-9-]{1,80}$/.test(injection.header)
        || (injection.prefix !== undefined && (typeof injection.prefix !== 'string' || injection.prefix.length > 40))) throw new Error('Capability secret references an unknown endpoint.');
    } else if (injection.kind === 'process-stdin') {
      if (!exactKeys(injection, ['kind', 'runtimeId']) || !runtimeIds.has(injection.runtimeId)) throw new Error('Capability secret references an unknown runtime.');
    } else throw new Error('Invalid secret injection.');
    secretIds.add(secret.id);
  }

  if (value.storage !== undefined) {
    const storage = value.storage;
    if (!storage || !exactKeys(storage, ['stateBytes', 'cacheBytes', 'tempBytes'])
      || ([storage.stateBytes, storage.cacheBytes, storage.tempBytes] as unknown[]).some(bytes => !Number.isInteger(bytes) || (bytes as number) < 0 || (bytes as number) > 1024 * 1024 * 1024)) throw new Error('Invalid capability storage quota.');
  }

  if (value.model !== undefined) {
    if (!value.model || !exactKeys(value.model, ['maxCalls', 'purpose'])
      || !Number.isInteger(value.model.maxCalls) || value.model.maxCalls < 1 || value.model.maxCalls > 4
      || !plainText(value.model.purpose, 200)) throw new Error('Invalid capability model permission.');
  }

  if (value.svg !== undefined && typeof value.svg !== 'boolean') throw new Error('Invalid capability svg permission.');

  if (value.subworkers !== undefined) {
    if (!value.subworkers || !exactKeys(value.subworkers, ['max']) || !Number.isInteger(value.subworkers.max) || value.subworkers.max < 1 || value.subworkers.max > 8) throw new Error('Invalid capability subworker permission.');
  }

  for (const runtime of value.runtimes ?? []) {
    if (!runtime || !exactKeys(runtime, ['id', 'kind', 'minVersion']) || !SLUG.test(runtime.id) || runtime.kind !== 'python'
      || !/^\d+\.\d+(?:\.\d+)?$/.test(runtime.minVersion)) throw new Error('Invalid capability runtime permission.');
  }

  return structuredClone(value);
}

/** Stable, order-independent identity of a permission set. The store remembers the
 *  fingerprint the user approved; an update whose fingerprint differs by anything the
 *  user did not already allow waits in `pending-permissions`. */
export function permissionFingerprint(permissions: TrustedPermissionSetV2): string {
  return JSON.stringify(permissionAtoms(permissions).sort());
}

function permissionAtoms(permissions: TrustedPermissionSetV2): string[] {
  const atoms: string[] = [];
  for (const endpoint of permissions.network ?? []) {
    for (const method of endpoint.methods) for (const prefix of endpoint.pathPrefixes) {
      atoms.push(`net|${endpoint.origin}|${method}|${prefix}|${endpoint.maxResponseBytes}|${endpoint.timeoutMs}`);
    }
  }
  for (const secret of permissions.secrets ?? []) {
    atoms.push(secret.injection.kind === 'header'
      ? `secret|${secret.id}|header|${secret.injection.endpointId}|${secret.injection.header}|${secret.injection.prefix ?? ''}`
      : `secret|${secret.id}|stdin|${secret.injection.runtimeId}`);
  }
  if (permissions.storage) atoms.push(`storage|${permissions.storage.stateBytes}|${permissions.storage.cacheBytes}|${permissions.storage.tempBytes}`);
  if (permissions.model) atoms.push(`model|${permissions.model.maxCalls}`);
  if (permissions.svg) atoms.push('svg');
  if (permissions.subworkers) atoms.push(`subworkers|${permissions.subworkers.max}`);
  for (const runtime of permissions.runtimes ?? []) atoms.push(`runtime|${runtime.id}|${runtime.kind}|${runtime.minVersion}`);
  return atoms;
}

/** True when `next` asks for anything `previous` did not already grant. Widening a
 *  quota counts; narrowing one does not, so a plugin can always give privilege back. */
export function permissionsExpandV2(previous: TrustedPermissionSetV2, next: TrustedPermissionSetV2): boolean {
  const granted = new Set(permissionAtoms(previous));
  if (permissionAtoms(next).some(atom => !granted.has(atom) && !atom.startsWith('storage|') && !atom.startsWith('model|') && !atom.startsWith('subworkers|'))) return true;
  const storage = next.storage, priorStorage = previous.storage ?? { stateBytes: 0, cacheBytes: 0, tempBytes: 0 };
  if (storage && (storage.stateBytes > priorStorage.stateBytes || storage.cacheBytes > priorStorage.cacheBytes || storage.tempBytes > priorStorage.tempBytes)) return true;
  if ((next.model?.maxCalls ?? 0) > (previous.model?.maxCalls ?? 0)) return true;
  return (next.subworkers?.max ?? 0) > (previous.subworkers?.max ?? 0);
}

/** A capability that can leave the machine, spend quota or persist is charged to the
 *  strict lane. A purely computational one costs no more than a JavaScript tool. */
export const trustedCapabilityIsMetered = (permissions: TrustedPermissionSetV2): boolean =>
  Boolean(permissions.network?.length || permissions.secrets?.length || permissions.model || permissions.storage || permissions.runtimes?.length);
