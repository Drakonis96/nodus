import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pluginsRuntimesRoot } from './pluginStoreV2';
import type { TrustedWorkerRuntime } from './workerHost';

/** Python environments a capability declares and the host builds.
 *
 *  The interpreter is the user's — Nodus does not ship one — but everything installed into
 *  the environment is pinned: the package carries a lock naming every wheel with its URL,
 *  size and SHA-256, the host downloads each one through the capability's own declared
 *  network permission, verifies it, and installs with `--no-index --require-hashes` from
 *  the verified directory. Nothing is ever resolved from a mutable index at install time. */

const run = promisify(execFile);

export interface RuntimeLockEntry {
  /** The artifact's own file name, as published. */
  name: string;
  /** What pip is asked to install, e.g. `numpy==2.2.6`. */
  requirement: string;
  url: string;
  bytes: number;
  sha256: string;
}
export interface RuntimeLock { schemaVersion: 1; python: string; platform: string; packages: RuntimeLockEntry[] }

const READY = 'READY';
const MAX_WHEEL_BYTES = 256 * 1024 * 1024;

const runtimeDir = (runtime: TrustedWorkerRuntime, runtimeId: string) => path.join(pluginsRuntimesRoot(), runtime.plugin.id, runtimeId);
const readyFile = (runtime: TrustedWorkerRuntime, runtimeId: string) => path.join(runtimeDir(runtime, runtimeId), READY);
const interpreter = (root: string) => process.platform === 'win32' ? path.join(root, 'venv', 'Scripts', 'python.exe') : path.join(root, 'venv', 'bin', 'python');

export function validateRuntimeLock(input: unknown): RuntimeLock {
  const value = input as RuntimeLock;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || typeof value.python !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value.python)
    || typeof value.platform !== 'string' || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > 500) {
    throw new Error('Invalid runtime lock.');
  }
  for (const entry of value.packages) {
    let url: URL;
    try { url = new URL(entry.url); } catch { throw new Error('Invalid runtime lock URL.'); }
    if (url.protocol !== 'https:' || typeof entry.name !== 'string' || !/^[A-Za-z0-9._+-]{1,160}$/.test(entry.name)
      || entry.name.includes('..') || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_WHEEL_BYTES
      || typeof entry.requirement !== 'string' || !/^[A-Za-z0-9._-]{1,120}==[A-Za-z0-9._+!-]{1,60}$/.test(entry.requirement)
      || !/^[a-f0-9]{64}$/.test(String(entry.sha256))) throw new Error('Invalid runtime lock entry.');
  }
  return structuredClone(value);
}

/** The interpreter the user already has, or nothing. Nodus never installs one. */
export async function findSystemPython(minVersion: string): Promise<{ path: string; version: string } | null> {
  const candidates = process.platform === 'win32' ? ['py', 'python3', 'python'] : ['python3', 'python'];
  const [minMajor, minMinor] = minVersion.split('.').map(Number);
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { timeout: 10_000 });
      const version = stdout.trim();
      const [major, minor] = version.split('.').map(Number);
      if (major > minMajor || major === minMajor && minor >= minMinor) {
        const { stdout: resolved } = await run(candidate, ['-c', 'import sys; print(sys.executable)'], { timeout: 10_000 });
        return { path: resolved.trim(), version };
      }
    } catch { /* try the next candidate */ }
  }
  return null;
}

export interface EnsureRuntimeContext {
  /** Downloads one pinned artifact through the capability's own network permission. */
  download: (url: string) => Promise<Buffer>;
  minVersion: string;
  /** The lock for one interpreter, from the locks shipped inside the installed package.
   *
   *  A wheel is built for a specific Python, so there is no single pinned set that fits
   *  every interpreter a user might have. The package ships one lock per version it
   *  supports and this picks the one that matches; returning null is what turns "we
   *  resolved something for you" into "this package does not support your Python", which
   *  is the honest answer and the one a user can act on. */
  selectLock: (pythonVersion: string) => RuntimeLock | null;
  signal: AbortSignal;
}

export async function ensurePythonRuntime(runtime: TrustedWorkerRuntime, runtimeId: string, context: EnsureRuntimeContext): Promise<{ ready: boolean; detail?: string }> {
  const root = runtimeDir(runtime, runtimeId);
  const marker = readyFile(runtime, runtimeId);

  const python = await findSystemPython(context.minVersion);
  if (!python) return { ready: false, detail: `Python ${context.minVersion} or newer was not found on this machine.` };

  const minor = python.version.split('.').slice(0, 2).join('.');
  const lock = context.selectLock(minor);
  if (!lock) return { ready: false, detail: `This package publishes no pinned dependency set for Python ${minor} on ${process.platform}-${process.arch}.` };
  const lockDigest = createHash('sha256').update(JSON.stringify(lock)).digest('hex');

  // The marker records which lock produced the environment: a package that changes its
  // dependencies, or a user who changed interpreter, gets a rebuild instead of an
  // environment that no longer matches what it claims to be.
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === lockDigest) {
      await run(interpreter(root), ['--version'], { timeout: 10_000 });
      return { ready: true };
    }
  } catch { /* not built, or built from a different lock */ }

  const staging = `${root}.${randomUUID()}.building`;
  const wheels = path.join(staging, 'wheels');
  try {
    fs.mkdirSync(wheels, { recursive: true, mode: 0o700 });
    for (const entry of lock.packages) {
      context.signal.throwIfAborted();
      const bytes = await context.download(entry.url);
      if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.name} does not match the size the lock pinned.`);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${entry.name} does not match the digest the lock pinned.`);
      fs.writeFileSync(path.join(wheels, entry.name), bytes, { mode: 0o600 });
    }
    const requirements = path.join(staging, 'requirements.txt');
    // `requirement` rather than the file name: pip resolves a requirement against
    // `--find-links`, and a bare filename would be read as a path relative to whatever the
    // working directory happens to be.
    fs.writeFileSync(requirements, lock.packages.map(entry => `${entry.requirement} --hash=sha256:${entry.sha256}`).join('\n'), { mode: 0o600 });

    await run(python.path, ['-m', 'venv', path.join(staging, 'venv')], { timeout: 300_000 });
    await run(interpreter(staging), ['-m', 'pip', 'install', '--no-index', '--require-hashes', '--find-links', wheels, '-r', requirements], { timeout: 900_000, maxBuffer: 16 * 1024 * 1024 });

    fs.rmSync(wheels, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
    fs.renameSync(staging, root);
    fs.writeFileSync(marker, lockDigest, { mode: 0o600 });
    return { ready: true };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ready: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface PythonRunRequest {
  runtimeId: string;
  args: string[];
  stdin?: string;
  /** Read by the host and written to the interpreter's stdin. Never an argument, because
   *  arguments are visible to anything that can list processes. */
  secret?: string;
  timeoutMs: number;
}

export async function runInPythonRuntime(runtime: TrustedWorkerRuntime, request: PythonRunRequest, signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  signal.throwIfAborted();
  const root = runtimeDir(runtime, request.runtimeId);
  if (!fs.existsSync(readyFile(runtime, request.runtimeId))) throw new Error('That capability runtime is not installed.');
  if (request.args.some(argument => typeof argument !== 'string' || argument.length > 4_000)) throw new Error('Invalid runtime argument.');

  return new Promise((resolve, reject) => {
    const child = spawn(interpreter(root), request.args, {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      // A clean environment: the interpreter gets what it needs and nothing the user's
      // shell happens to be carrying.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    });
    let stdout = '', stderr = '', settled = false;
    const finish = (error?: Error, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      if (error) reject(error); else resolve({ code, stdout, stderr });
    };
    const abort = () => finish(new DOMException('The capability runtime call was cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`The capability runtime exceeded ${Math.round(request.timeoutMs / 1000)} seconds.`)), Math.min(Math.max(request.timeoutMs, 1_000), 900_000));
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 32 * 1024 * 1024) finish(new Error('The capability runtime produced too much output.')); });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 64_000); });
    child.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    child.once('close', code => finish(undefined, code ?? 0));
    try {
      if (request.secret) child.stdin.write(`${request.secret}\n`);
      if (request.stdin) child.stdin.write(request.stdin);
      child.stdin.end();
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
