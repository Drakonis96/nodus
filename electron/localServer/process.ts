// Nodus Server, running on this computer.
//
// The advanced mode publishes to a Docker deployment somebody else operates. Basic mode runs
// that same server — the identical server/server.mjs, not a reduced copy — as a child of the
// desktop application, so a person who only wants to open their vault from their own phone does
// not need Docker, a domain, a DNS record or a reverse proxy.
//
// The listener is loopback-only unless the user explicitly picks an access path, and the two
// paths on offer are both encrypted. There is deliberately no "just serve it over HTTP on the
// network" option: that would put the password protecting somebody's research on the wifi in
// cleartext, and it is precisely the shortcut this module exists to make unnecessary.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { app } from 'electron';
import type { LocalServerAccess, LocalServerStatus } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getLocalServerAdminPassword, setLocalServerAdminPassword } from '../secrets/secretStore';
import { ensureLanCert, lanAddresses, readLanCert } from './lanCert';
import { DISCONNECTED, tailscaleStatus } from './tailscale';
import { holdAwake, releaseAwake } from './power';

type ServerChild = ChildProcessByStdio<null, Readable, Readable>;

const READY_TIMEOUT_MS = 20_000;
const HEALTH_INTERVAL_MS = 400;
/** Restart backoff after an unexpected exit, so a permanently broken start cannot spin. */
const RESTART_DELAYS_MS = [1_000, 5_000, 15_000, 60_000];
/** How often a running local-network server checks it still holds the addresses it bound. */
const ADDRESS_WATCH_MS = 20_000;

let child: ServerChild | null = null;
let generation = 0;
let phase: LocalServerStatus['phase'] = 'stopped';
let lastError: string | null = null;
let logs = '';
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let addressTimer: ReturnType<typeof setInterval> | null = null;
/** The addresses the running process was actually told to bind. Empty unless serving the LAN. */
let boundAddresses: string[] = [];
let lifecycle = Promise.resolve();

function queue<T>(job: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(job, job);
  lifecycle = next.then(() => undefined, () => undefined);
  return next;
}

function stateDir(): string {
  return path.join(app.getPath('userData'), 'local-server');
}

function provisionFile(): string {
  return path.join(stateDir(), 'provision.key');
}

/** The bundled server/server.mjs, packaged as an extra resource and run from disk. */
export function serverScriptPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'nodus-server', 'server.mjs'),
    path.join(app.getAppPath(), 'server', 'server.mjs'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

/** Strip control characters and anything secret before a message can reach the interface. */
function sanitize(value: string, secrets: string[] = []): string {
  let clean = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) ? ' ' : character;
  }).join('');
  for (const secret of secrets) {
    if (secret) clean = clean.split(secret).join('<oculto>');
  }
  return clean.trim().slice(-1_500);
}

// ── Administrator credentials ──────────────────────────────────────────────

/**
 * The account that signs in to the local server's own web administration.
 *
 * Nodus invents it rather than asking. Somebody turning on "serve from this computer" did not
 * set out to create an account, and a password they invent under that much context-free
 * pressure is a weak one; a generated 32-character secret in the keychain is strictly better,
 * and the interface can always show it to them again.
 */
export function ensureAdminCredentials(): { email: string; password: string } {
  const settings = getSettings();
  let email = settings.localServerAdminEmail;
  if (!email) {
    email = 'admin@nodus.local';
    updateSettings({ localServerAdminEmail: email });
  }
  let password = getLocalServerAdminPassword();
  if (!password) {
    password = randomBytes(24).toString('base64url');
    setLocalServerAdminPassword(password);
  }
  return { email, password };
}

/** The provisioning secret this run's server wrote, or null before it has started. */
export function readProvisionSecret(): string | null {
  try {
    const value = fs.readFileSync(provisionFile(), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

// ── Environment ────────────────────────────────────────────────────────────

export interface LaunchPlan {
  env: NodeJS.ProcessEnv;
  /** Where the desktop itself publishes. Always loopback, always plain HTTP. */
  loopbackUrl: string;
  /** What other devices open, or null when nothing is shared. */
  shareUrl: string | null;
  /** Private addresses this plan binds beyond loopback. Empty for every path but `lan`. */
  addresses: string[];
}

/**
 * Translate the chosen access path into the server's environment.
 *
 * Three shapes, and only the last one binds anything beyond loopback:
 *
 * - `loopback` — nothing leaves this machine. The safe default.
 * - `tailscale` — still loopback; Tailscale terminates TLS with a real certificate and forwards
 *   in. Nothing here has to know about it beyond the public URL people will see.
 * - `lan` — HTTPS on this machine's private addresses with a Nodus-generated certificate, plus
 *   the plain loopback listener the desktop publishes through.
 */
export async function buildLaunchPlan(
  access: LocalServerAccess,
  port: number,
  tailscaleUrl: string | null,
): Promise<LaunchPlan> {
  const { email, password } = ensureAdminCredentials();
  const loopbackUrl = `http://127.0.0.1:${port}`;
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODUS_DATA_DIR: path.join(stateDir(), 'data'),
    NODUS_PORT: String(port),
    NODUS_HOST: '127.0.0.1',
    NODUS_ADMIN_EMAIL: email,
    NODUS_ADMIN_PASSWORD: password,
    NODUS_LOCAL_PROVISION_FILE: provisionFile(),
    NODUS_PUBLIC_URL: loopbackUrl,
  };
  // Inherited from the desktop's own environment, these would silently override everything
  // decided here — a developer with NODUS_PORT exported would get a server on the wrong port.
  delete base.NODUS_SETUP_TOKEN;
  delete base.NODUS_TLS_CERT_FILE;
  delete base.NODUS_TLS_KEY_FILE;
  delete base.NODUS_LOOPBACK_PORT;

  if (access === 'tailscale') {
    return {
      env: { ...base, NODUS_PUBLIC_URL: tailscaleUrl ?? loopbackUrl },
      loopbackUrl,
      shareUrl: tailscaleUrl,
      addresses: [],
    };
  }

  if (access === 'lan') {
    const addresses = lanAddresses();
    if (addresses.length === 0) {
      throw new Error('Este ordenador no tiene ninguna dirección en la red local ahora mismo.');
    }
    const cert = await ensureLanCert();
    const shareUrl = `https://${addresses[0]}:${port}`;
    return {
      env: {
        ...base,
        // Bind the private addresses themselves rather than 0.0.0.0, so the loopback listener
        // can hold the same port without either of them shadowing the other.
        NODUS_HOST: addresses.join(','),
        NODUS_TLS_CERT_FILE: cert.certPath,
        NODUS_TLS_KEY_FILE: cert.keyPath,
        NODUS_LOOPBACK_PORT: String(port),
        NODUS_PUBLIC_URL: shareUrl,
      },
      loopbackUrl,
      shareUrl,
      addresses,
    };
  }

  return { env: base, loopbackUrl, shareUrl: null, addresses: [] };
}

// ── Network changes ────────────────────────────────────────────────────────

/**
 * Whether the addresses this process bound have stopped existing.
 *
 * Only a disappearance breaks a listener. An address *appearing* — a virtual machine starting, a
 * Docker bridge coming up, an ethernet cable plugged in beside the wifi — leaves every existing
 * socket working exactly as it did, and relaunching for it would cut a phone off mid-request to
 * gain nothing. So this asks the narrow question rather than "did anything change".
 */
export function bindingBroken(bound: string[], current: string[]): boolean {
  return bound.some((address) => !current.includes(address));
}

function stopAddressWatch(): void {
  if (addressTimer) {
    clearInterval(addressTimer);
    addressTimer = null;
  }
}

/**
 * Notice that this machine has moved to a different network, and rebind.
 *
 * The local-network path binds the private addresses this machine held when it launched, and a
 * laptop carried from home to the office keeps none of them. Nothing reports that by itself: the
 * socket is not necessarily broken — on macOS it stays open on an address that no longer exists —
 * so the process lives on, the phase stays `running`, and the panel cheerfully offers the *new*
 * address to a phone because it reads the interfaces live. Relaunching fixes both halves at once,
 * because launch() rebinds and ensureLanCert() re-cuts the leaf for the addresses that now exist.
 *
 * Only while serving the LAN. The other two paths bind loopback, which no network change moves.
 */
function startAddressWatch(): void {
  stopAddressWatch();
  addressTimer = setInterval(() => {
    if (phase !== 'running' || getSettings().localServerAccess !== 'lan') return;
    const current = lanAddresses();
    // No addresses at all is a cable pulled out or wifi dropped, not a move. Rebinding would
    // fail outright and burn a restart attempt; the next tick picks the network back up.
    if (current.length === 0 || !bindingBroken(boundAddresses, current)) return;
    // Claimed before the relaunch is even queued, so a tick landing in the gap does not ask for
    // a second one on top of it.
    boundAddresses = current;
    void restartLocalServer().catch(() => undefined);
  }, ADDRESS_WATCH_MS);
  addressTimer.unref?.();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

async function waitForHealth(instance: ServerChild, loopbackUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (instance.exitCode !== null || instance.signalCode !== null) {
      throw new Error(sanitize(logs) || 'El servidor local se cerró durante el arranque.');
    }
    try {
      const response = await fetch(`${loopbackUrl}/healthz`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // Still binding. Keep trying until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
  throw new Error(sanitize(logs) || 'El servidor local no respondió a tiempo.');
}

async function stopChild(): Promise<void> {
  const instance = child;
  child = null;
  generation += 1;
  stopAddressWatch();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!instance || instance.exitCode !== null || instance.signalCode !== null) return;
  instance.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => instance.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (instance.exitCode === null && instance.signalCode === null) instance.kill('SIGKILL');
}

function scheduleRestart(): void {
  const delay = RESTART_DELAYS_MS[Math.min(restartAttempt, RESTART_DELAYS_MS.length - 1)];
  restartAttempt += 1;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startLocalServer().catch(() => undefined);
  }, delay);
}

async function launch(): Promise<void> {
  const settings = getSettings();
  const script = serverScriptPath();
  if (!script) throw new Error('No se encuentra el servidor integrado en esta instalación.');
  const port = settings.localServerPort;
  const access = settings.localServerAccess;
  const tailscale = access === 'tailscale' ? await tailscaleStatus(port) : DISCONNECTED;
  const plan = await buildLaunchPlan(access, port, tailscale.url);

  await stopChild();
  boundAddresses = plan.addresses;
  fs.mkdirSync(stateDir(), { recursive: true });
  logs = '';
  phase = 'starting';
  lastError = null;
  const mine = ++generation;

  const instance = spawn(process.execPath, [script], {
    cwd: path.dirname(script),
    env: plan.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ServerChild;
  child = instance;
  const secrets = [plan.env.NODUS_ADMIN_PASSWORD ?? ''];
  const append = (chunk: Buffer) => { logs = `${logs}${chunk.toString('utf8')}`.slice(-32_000); };
  instance.stdout.on('data', append);
  instance.stderr.on('data', append);
  instance.once('exit', (code, signal) => {
    if (child === instance) child = null;
    if (mine !== generation) return;
    phase = 'error';
    lastError = sanitize(logs || `El servidor local terminó con ${code ?? signal ?? 'un error desconocido'}.`, secrets);
    if (getSettings().localServerEnabled) scheduleRestart();
  });

  try {
    await waitForHealth(instance, plan.loopbackUrl);
  } catch (error) {
    await stopChild();
    throw new Error(sanitize(error instanceof Error ? error.message : String(error), secrets));
  }
  phase = 'running';
  restartAttempt = 0;
  if (access === 'lan') startAddressWatch();
  if (getSettings().localServerKeepAwake) holdAwake();
}

export function startLocalServer(): Promise<LocalServerStatus> {
  return queue(async () => {
    try {
      await launch();
    } catch (error) {
      phase = 'error';
      lastError = error instanceof Error ? error.message : String(error);
    }
    return localServerStatus();
  });
}

export function stopLocalServer(): Promise<LocalServerStatus> {
  return queue(async () => {
    await stopChild();
    phase = 'stopped';
    lastError = null;
    restartAttempt = 0;
    if (!getSettings().localServerKeepAwake) releaseAwake();
    return localServerStatus();
  });
}

export function restartLocalServer(): Promise<LocalServerStatus> {
  return queue(async () => {
    await stopChild();
    if (!getSettings().localServerEnabled) {
      phase = 'stopped';
      return localServerStatus();
    }
    try {
      await launch();
    } catch (error) {
      phase = 'error';
      lastError = error instanceof Error ? error.message : String(error);
    }
    return localServerStatus();
  });
}

/** Start at boot when the user left it on. Never throws: a failed server must not block startup. */
export function startLocalServerIfEnabled(): Promise<LocalServerStatus> {
  if (!getSettings().localServerEnabled) return Promise.resolve(localServerStatus());
  return startLocalServer();
}

export function isLocalServerRunning(): boolean {
  return phase === 'running' && child !== null;
}

/** Loopback origin the desktop publishes through, or null when the server is not up. */
export function localServerLoopbackUrl(): string | null {
  return isLocalServerRunning() ? `http://127.0.0.1:${getSettings().localServerPort}` : null;
}

export async function localServerStatusAsync(): Promise<LocalServerStatus> {
  const settings = getSettings();
  const tailscale = await tailscaleStatus(settings.localServerPort);
  return { ...localServerStatus(), tailscale };
}

export function localServerStatus(): LocalServerStatus {
  const settings = getSettings();
  const cert = readLanCert();
  const running = isLocalServerRunning();
  const addresses = lanAddresses();
  const shareUrl = !running
    ? null
    : settings.localServerAccess === 'lan' && addresses.length > 0
      ? `https://${addresses[0]}:${settings.localServerPort}`
      : null;
  return {
    phase,
    enabled: settings.localServerEnabled,
    port: settings.localServerPort,
    access: settings.localServerAccess,
    localUrl: running ? `http://127.0.0.1:${settings.localServerPort}` : null,
    shareUrl,
    adminEmail: settings.localServerAdminEmail || null,
    tailscale: DISCONNECTED,
    lan: {
      addresses,
      caFingerprint: cert?.caFingerprint ?? null,
      caCertPath: cert?.caCertPath ?? null,
    },
    error: lastError,
  };
}

/** Synchronous best-effort kill for Electron's non-awaitable before-quit. */
export function killLocalServerSync(): void {
  generation += 1;
  const instance = child;
  child = null;
  stopAddressWatch();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (instance && instance.exitCode === null && instance.signalCode === null) instance.kill('SIGTERM');
}
