import { BrowserWindow, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerUntrustedSession } from '../../electron/ipc/untrustedSessions';
import { pluginSecret, pluginStorageFile, type InstalledCapabilityRuntime } from '../../electron/skillPlugins';
import { jsonSchemaMatches, type CapabilityInvocation, type CapabilityResult } from '../contracts';
import { assertPublicHost } from '../publicHost';

/** Capability runtimes are served from, and may only talk to, this session-scoped origin. */
export const NODUS_CAPABILITY_SCHEME = 'nodus-capability';
const CAPABILITY_ORIGIN = `${NODUS_CAPABILITY_SCHEME}://host`;

export function registerCapabilitySchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: NODUS_CAPABILITY_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  }]);
}

const SHELL = '<!doctype html><meta charset="utf-8"><title>Capability sandbox</title>';

const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const TEXT_LIMIT = 256_000;
const BINARY_LIMIT = 10_000_000;
const EXECUTION_TIMEOUT = process.env.NODUS_CAPABILITY_TEST_TIMEOUT_MS ? Number(process.env.NODUS_CAPABILITY_TEST_TIMEOUT_MS) : 30_000;

function readStorage(runtime: InstalledCapabilityRuntime): unknown {
  const file = pluginStorageFile(runtime.pluginId, runtime.manifest.id);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeStorage(runtime: InstalledCapabilityRuntime, value: unknown): null {
  const encoded = JSON.stringify(value);
  const max = runtime.manifest.permissions.storage?.maxBytes;
  if (!max) throw new Error('Capability storage is not permitted.');
  if (Buffer.byteLength(encoded) > max) throw new Error('Capability storage quota exceeded.');
  const file = pluginStorageFile(runtime.pluginId, runtime.manifest.id); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temporary, encoded, { mode: 0o600 }); fs.renameSync(temporary, file); return null;
}

async function networkRequest(runtime: InstalledCapabilityRuntime, endpointId: string, request: unknown, signal?: AbortSignal, beforePaidCall?: () => void): Promise<unknown> {
  const endpoint = runtime.manifest.permissions.network?.find(item => item.id === endpointId);
  if (!endpoint) throw new Error('Capability endpoint is not permitted.');
  const value = request as { path?: unknown; method?: unknown; body?: unknown };
  const relative = typeof value?.path === 'string' ? value.path : '/';
  const method = String(value?.method ?? 'GET').toUpperCase() as typeof endpoint.methods[number];
  const permittedPath = endpoint.pathPrefixes.some(prefix => relative === prefix || relative.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  if (!relative.startsWith('/') || relative.includes('..') || !permittedPath || !endpoint.methods.includes(method)) throw new Error('Capability network request exceeds its permission.');
  const url = new URL(relative, endpoint.origin); if (url.origin !== new URL(endpoint.origin).origin) throw new Error('Capability network origin changed.');
  await assertPublicHost(url.hostname);
  const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.9' };
  let body: string | undefined;
  if (value.body !== undefined) { body = typeof value.body === 'string' ? value.body : JSON.stringify(value.body); if (body.length > 64_000) throw new Error('Capability request body is too large.'); headers['Content-Type'] = 'application/json'; }
  for (const secret of runtime.manifest.permissions.secrets ?? []) if (secret.endpointId === endpoint.id) {
    const stored = pluginSecret(runtime.pluginId, runtime.manifest.id, secret.id);
    if (!stored && secret.required) throw new Error(`Configure ${secret.label} before using this capability.`);
    if (stored) headers[secret.header] = `${secret.prefix ?? ''}${stored}`;
  }
  signal?.throwIfAborted(); beforePaidCall?.();
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(url, { method, body, headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`Capability endpoint returned ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? 0) > 2_000_000) { await response.body?.cancel(); throw new Error('Capability response is too large.'); }
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 2_000_000) throw new Error('Capability response is too large.'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => undefined); }
  const text = Buffer.concat(chunks).toString('utf8');
  if ((response.headers.get('content-type') ?? '').includes('json')) { try { return JSON.parse(text); } catch { throw new Error('Capability endpoint returned invalid JSON.'); } }
  return text;
}

function validateResult(result: unknown, allowed: string[]): CapabilityResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Capability result must be an object.');
  const value = result as CapabilityResult;
  if (!allowed.includes(value.kind)) throw new Error('Capability returned an undeclared result kind.');
  if (value.kind === 'text') { if (typeof value.text !== 'string' || value.text.length > TEXT_LIMIT || /<\/?[A-Za-z][^>]*>/.test(value.text)) throw new Error('Invalid capability text result; HTML is not accepted.'); }
  else if (value.kind === 'json') { if (JSON.stringify(value.value).length > TEXT_LIMIT) throw new Error('Capability JSON result is too large.'); }
  else if (value.kind === 'table') {
    if (!Array.isArray(value.columns) || !value.columns.length || value.columns.length > 64 || value.columns.some(item => typeof item !== 'string')
      || !Array.isArray(value.rows) || value.rows.length > 10_000 || value.rows.some(row => !Array.isArray(row) || row.length !== value.columns.length)
      || value.rows.some(row => row.some(cell => cell !== null && !['string','number','boolean'].includes(typeof cell)))
      || JSON.stringify(value).length > TEXT_LIMIT) throw new Error('Invalid capability table result.');
  } else if (value.kind === 'svg') {
    if (typeof value.svg !== 'string' || value.svg.length > 300_000 || !/^\s*<svg\b/i.test(value.svg) || /<!DOCTYPE|<!ENTITY/i.test(value.svg)) throw new Error('Invalid capability SVG result.');
  } else {
    if (typeof value.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data) || Buffer.byteLength(value.data, 'base64') > BINARY_LIMIT) throw new Error('Invalid capability binary result.');
    if (value.kind === 'image' && !['image/png','image/jpeg','image/webp'].includes(value.mimeType)) throw new Error('Invalid capability image type.');
    if (value.kind === 'file' && (typeof value.name !== 'string' || !value.name || /[\\/\0]/.test(value.name) || typeof value.mimeType !== 'string')) throw new Error('Invalid capability file result.');
  }
  return structuredClone(value);
}

/** External capability code runs in a fresh renderer sandbox. Only this narrow RPC crosses into main. */
export async function runCapabilitySandbox(runtime: InstalledCapabilityRuntime, invocation: CapabilityInvocation, signal?: AbortSignal, beforePaidCall?: () => void): Promise<CapabilityResult> {
  signal?.throwIfAborted();
  const tool = runtime.manifest.tools.find(item => item.id === invocation.toolId);
  if (!tool || !jsonSchemaMatches(tool.inputSchema, invocation.input)) throw new Error('Capability tool input does not match its schema.');
  const isolated = session.fromPartition(`capability-${randomUUID()}`, { cache: false }); registerUntrustedSession(isolated);
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${CAPABILITY_ORIGIN}/`) }));
  // The host RPC is bound to this one ephemeral session, so it can only ever answer
  // for the capability being executed. There is no preload and no app bridge.
  isolated.protocol.handle(NODUS_CAPABILITY_SCHEME, async request => {
    const url = new URL(request.url);
    // A non-special scheme has an opaque URL origin, so the host is checked explicitly.
    if (url.protocol !== `${NODUS_CAPABILITY_SCHEME}:` || url.hostname !== 'host') return new Response(null, { status: 404 });
    if (url.pathname === '/') {
      return new Response(SHELL, { status: 200, headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-eval'; connect-src ${CAPABILITY_ORIGIN}; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`,
      } });
    }
    if (url.pathname !== '/rpc' || request.method !== 'POST') return new Response(null, { status: 404 });
    try {
      const body = await request.text();
      if (body.length > 128_000) throw new Error('Capability host request is too large.');
      const message = JSON.parse(body) as { method?: unknown; args?: Record<string, unknown> };
      const args = message.args ?? {};
      const value = await (async () => {
        if (message.method === 'network.request') return networkRequest(runtime, String(args.endpointId), args.request, signal, beforePaidCall);
        if (message.method === 'storage.get') { if (!runtime.manifest.permissions.storage) throw new Error('Capability storage is not permitted.'); return readStorage(runtime); }
        if (message.method === 'storage.set') return writeStorage(runtime, args.value);
        throw new Error('Unknown capability host operation.');
      })();
      return jsonResponse({ ok: true, value });
    } catch (error) {
      return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, disableDialogs: true, backgroundThrottling: false } });
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault()); win.webContents.on('will-attach-webview', event => event.preventDefault());
  let timeout: ReturnType<typeof setTimeout> | undefined; let rejectAbort: (() => void) | undefined;
  const encoded = JSON.stringify({ toolId: invocation.toolId, input: invocation.input });
  try {
    // Setup stays inside the race so a stalled load or evaluation can never hang a chat turn.
    const raw = await Promise.race([
      (async () => {
        await isolated.setProxy({ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9', proxyBypassRules: '<-loopback>' });
        await win.loadURL(`${CAPABILITY_ORIGIN}/`);
        return win.webContents.executeJavaScript(`(async()=>{
          for(const key of ['RTCPeerConnection','webkitRTCPeerConnection','RTCIceTransport','RTCDtlsTransport'])Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false});
          const call=async(method,args)=>{const response=await fetch(${JSON.stringify(`${CAPABILITY_ORIGIN}/rpc`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});const payload=await response.json();if(!payload.ok)throw new Error(payload.error);return payload.value};
          const host=Object.freeze({network:Object.freeze({request:(endpointId,request)=>call('network.request',{endpointId,request})}),storage:Object.freeze({get:()=>call('storage.get',{}),set:value=>call('storage.set',{value})})});
          const runtime=(${runtime.source}\n);
          if(typeof runtime!=='function')throw new Error('Capability runtime must be a function expression.');
          return await runtime(JSON.parse(${JSON.stringify(encoded)}),host);
        })()`);
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Capability exceeded the time limit.')), EXECUTION_TIMEOUT);
        rejectAbort = () => reject(new DOMException('Capability execution cancelled.', 'AbortError')); signal?.addEventListener('abort', rejectAbort, { once: true });
      }),
    ]);
    signal?.throwIfAborted(); return validateResult(raw, tool.resultKinds);
  } finally {
    clearTimeout(timeout); if (rejectAbort) signal?.removeEventListener('abort', rejectAbort);
    if (!win.isDestroyed()) win.destroy(); void isolated.clearStorageData();
  }
}
