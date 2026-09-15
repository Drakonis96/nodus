import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { LocalAiBackend } from '@shared/localAiRuntime';

export const LLAMA_CPP_VERSION = 'b10002';
export const LOCAL_RUNTIME_POLICY = 2;

export interface RuntimeAsset {
  name: string;
  url: string;
  sha256: string;
  archive: 'zip' | 'tar.gz';
  bytes: number;
  backend: LocalAiBackend;
}

// The upstream "ubuntu-x64" archive is CPU-only. Vulkan is a separate build,
// including on NVIDIA machines; the pinned release has no Linux CUDA archive.
// CPU is installed alongside it so a driver failure can fall back while offline.
export function runtimeAssets(platform: string = process.platform, arch: string = process.arch): RuntimeAsset[] {
  const specs: Record<string, Array<[LocalAiBackend, string, string, number]>> = {
    'linux-x64': [
      ['cpu', 'ubuntu-x64.tar.gz', '760dcd8c52be7960bf7487adce4287c151000a41e44f836abdb1a282340c5949', 15_855_822],
      ['vulkan', 'ubuntu-vulkan-x64.tar.gz', 'd5da4d5ffc0e7d2ed24d39d3ee482a0e76f5794a5b0b11d972d2e9888a3dca2a', 31_195_148],
    ],
    'linux-arm64': [
      ['cpu', 'ubuntu-arm64.tar.gz', '348e880ac43a5df038729f34ac3be6a1c57b5de491504b59b5273d8b1f4dae40', 12_791_141],
      ['vulkan', 'ubuntu-vulkan-arm64.tar.gz', '17e347f3b9eabf2efab30c4bfb009b2a9c4b3c7a380164d189a6e826b1d18ca1', 25_427_413],
    ],
    'win32-x64': [
      ['cpu', 'win-cpu-x64.zip', 'c4c3dd2e139e3f00f7bdf4993a2f893e8db4dc6ae51140cc25ddd63306c32734', 18_253_272],
      ['vulkan', 'win-vulkan-x64.zip', 'c2b66ab6912e9fad75c7c6d2000f660bb40bc1f063aa62ec671d471e27dd92ea', 32_950_223],
    ],
    'win32-arm64': [
      ['cpu', 'win-cpu-arm64.zip', '271470732568e8326c58e0a357e5f9085e956de97587358c690ff166edaafb77', 12_159_035],
    ],
    'darwin-arm64': [
      ['metal', 'macos-arm64.tar.gz', 'b7aca9d4f9c6267a5f389179bd7412c4e991ac7d1b69f52acf065ef99c99345c', 10_749_656],
    ],
    'darwin-x64': [
      ['metal', 'macos-x64.tar.gz', 'c90eaed104ad1c82628d34967def32eaae2516768e10121fbebc4c73a046ac7d', 11_031_400],
    ],
  };
  const entries = specs[`${platform}-${arch}`];
  if (!entries) throw new Error(`llama.cpp no ofrece un runtime integrado para ${platform}-${arch}.`);
  return entries.map(([backend, suffix, sha256, bytes]) => {
    const name = `llama-${LLAMA_CPP_VERSION}-bin-${suffix}`;
    return { backend, name, sha256, bytes, archive: name.endsWith('.zip') ? 'zip' : 'tar.gz',
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${name}` };
  });
}

export interface InstalledRuntime {
  executablePath: string;
  cpuPath: string;
  backend: LocalAiBackend;
  devices: string[];
  deviceIds: string[];
  upgradeRequired: boolean;
  fallbackReason: 'legacy-runtime' | 'gpu-unavailable' | null;
  probeLog: string;
}

interface RuntimeManifest {
  policy: number;
  platform: string;
  version: string;
  executable: string;
  cpu: string;
  backend: LocalAiBackend;
  devices: string[];
  deviceIds: string[];
  fallbackReason: 'gpu-unavailable' | null;
  probeLog: string;
}

function runtimeRoot(root: string): string {
  return path.join(root, 'runtime', LLAMA_CPP_VERSION);
}
function managedRoot(root: string): string {
  return path.join(runtimeRoot(root), 'managed-v2');
}

export async function findRuntimeExecutable(directory: string, legacy = false): Promise<string | null> {
  const wanted = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return target;
    // Never discover an uncommitted generation through the legacy recursive search.
    if (entry.isDirectory() && !(legacy && entry.name === 'managed-v2')) {
      const found = await findRuntimeExecutable(target, legacy);
      if (found) return found;
    }
  }
  return null;
}

function containedFile(directory: string, relative: unknown): string | null {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(directory, relative);
  const rel = path.relative(directory, resolved);
  return rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) ? resolved : null;
}

export async function readInstalledRuntime(root: string): Promise<InstalledRuntime | null> {
  const managed = managedRoot(root);
  try {
    const data = JSON.parse(await fs.readFile(path.join(managed, 'current.json'), 'utf8')) as RuntimeManifest;
    const executablePath = containedFile(managed, data.executable);
    const cpuPath = containedFile(managed, data.cpu);
    if (data.policy === LOCAL_RUNTIME_POLICY && data.version === LLAMA_CPP_VERSION
      && data.platform === `${process.platform}-${process.arch}`
      && ['cpu', 'vulkan', 'metal'].includes(data.backend)
      && executablePath && cpuPath
      && (await fs.stat(executablePath)).isFile() && (await fs.stat(cpuPath)).isFile()) {
      return { executablePath, cpuPath, backend: data.backend,
        devices: Array.isArray(data.devices) ? data.devices.filter((v) => typeof v === 'string').slice(0, 16) : [],
        deviceIds: Array.isArray(data.deviceIds) ? data.deviceIds.filter((v) => /^(?:Vulkan\d+|Metal\d*)$/.test(v)).slice(0, 16) : [],
        upgradeRequired: false, fallbackReason: data.fallbackReason === 'gpu-unavailable' ? 'gpu-unavailable' : null,
        probeLog: redactRuntimeLog(data.probeLog ?? '', root) };
    }
  } catch { /* Old or interrupted installations remain usable via the legacy path. */ }
  const executablePath = await findRuntimeExecutable(runtimeRoot(root), true);
  if (!executablePath) return null;
  return { executablePath, cpuPath: executablePath, backend: process.platform === 'darwin' ? 'metal' : 'cpu',
    devices: [], deviceIds: [], upgradeRequired: true, fallbackReason: 'legacy-runtime', probeLog: '' };
}

export function redactRuntimeLog(value: string, root = ''): string {
  let text = String(value).replace(/\u001b\[[0-9;]*m/g, '');
  for (const prefix of [root, os.homedir()].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(prefix).join('[local]');
  }
  return text.slice(-4_000);
}

/** Preserve system/driver paths; discard only libraries inherited from the AppImage. */
export function localRuntimeEnvironment(executable: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...inherited };
  // Nodus owns the launch arguments; inherited llama server flags must not enable
  // prompt logging, expose its loopback server, or silently change context/model.
  for (const key of Object.keys(env)) if (key.startsWith('LLAMA_ARG_')) delete env[key];
  const appDir = env.APPDIR;
  const bundled = (value: string) => Boolean(appDir && (value === appDir || value.startsWith(`${appDir}/`)))
    || /(?:^|\/)\.mount_[^/]+(?:\/|$)/.test(value);
  if (process.platform === 'linux') {
    const libraryPaths = (env.LD_LIBRARY_PATH ?? '').split(':').filter((v) => v && !bundled(v));
    env.LD_LIBRARY_PATH = [...(path.isAbsolute(executable) ? [path.dirname(executable)] : []), ...libraryPaths].join(':');
    if (!env.LD_LIBRARY_PATH) delete env.LD_LIBRARY_PATH;
    if (env.LD_PRELOAD) {
      const preload = env.LD_PRELOAD.split(/[:\s]+/).filter((v) => v && !bundled(v)).join(':');
      if (preload) env.LD_PRELOAD = preload;
      else delete env.LD_PRELOAD;
    }
  }
  return env;
}

export function parseRuntimeDevices(output: string): Array<{ id: string; name: string }> {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(Vulkan\d+|Metal\d*):\s*(.+)$/);
    if (!match || /llvmpipe|lavapipe|software|\bCPU\b/i.test(match[2])) return [];
    return [{ id: match[1], name: match[2].trim().slice(0, 300) }];
  });
}

export function parseOffloadedLayers(output: string): number | null {
  const matches = [...output.matchAll(/offloaded\s+(\d+)\/\d+\s+layers?\s+to\s+GPU/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

export function gpuStartupFailure(message: string): boolean {
  return /out of (?:device |gpu |host )?memory|failed to allocate|allocation failed|vk::|vkAllocate|VK_ERROR_|libvulkan|vulkan.*(?:failed|error)|failed to (?:load|initialize).*backend|no usable GPU|device (?:lost|unavailable)/i.test(message);
}

/** A real process probe: bounded output, spawn errors, signal exits and timeout. */
export function runRuntimeCommand(command: string, args: string[], options: {
  signal?: AbortSignal; timeoutMs?: number; cwd?: string;
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason ?? new Error('Descarga cancelada.')); return; }
    const child = spawn(command, args, { cwd: options.cwd ?? path.dirname(command),
      env: localRuntimeEnvironment(command), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let done = false;
    let terminationError: Error | undefined;
    let killDeadline: ReturnType<typeof setTimeout> | undefined;
    const capture = (chunk: unknown) => { output = `${output}${String(chunk)}`.slice(-12_000); };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killDeadline);
      options.signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(output);
    };
    const terminate = (error: Error) => {
      if (done || terminationError) return;
      terminationError = error;
      child.kill('SIGKILL');
      // Wait for the loader to release executable/DLL handles before cleanup.
      killDeadline = setTimeout(() => finish(error), 2_000);
    };
    const abort = () => terminate(options.signal?.reason instanceof Error
      ? options.signal.reason : new Error('Descarga cancelada.'));
    const timer = setTimeout(() => terminate(
      new Error(`llama.cpp runtime probe timed out. ${output}`.trim())
    ), options.timeoutMs ?? 15_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => finish(terminationError ?? (code === 0 ? undefined
      : new Error(output || `Runtime exited (${signal ?? code}).`))));
  });
}

export type RuntimeDownloader = (asset: RuntimeAsset, archive: string, onBytes: (bytes: number) => void, signal?: AbortSignal) => Promise<void>;

/** No network until this user-initiated installer calls the verified downloader. */
export async function installManagedRuntime(root: string, download: RuntimeDownloader,
  onProgress: (fraction: number) => void, signal: AbortSignal,
  activate: (publish: () => Promise<void>) => Promise<void>,
  assets: RuntimeAsset[] = runtimeAssets(),
): Promise<void> {
  const previous = await readInstalledRuntime(root);
  const managed = managedRoot(root);
  await fs.mkdir(managed, { recursive: true });
  const generation = await fs.mkdtemp(path.join(managed, 'generation-'));
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  let received = 0;
  let published = false;
  let selected: { executable: string; backend: LocalAiBackend; devices: Array<{ id: string; name: string }> } | null = null;
  let cpu = '';
  let probeLog = '';
  let fallbackReason: 'gpu-unavailable' | null = null;
  try {
    for (const asset of assets) {
      signal.throwIfAborted();
      const archive = path.join(root, asset.name);
      // Integrity errors are fatal, never a reason to execute an unverified archive.
      await download(asset, archive, (bytes) => { received += bytes; onProgress(Math.min(0.9, received / totalBytes * 0.9)); }, signal);
      const directory = path.join(generation, asset.backend);
      await fs.mkdir(directory, { recursive: true });
      if (asset.archive === 'zip') new AdmZip(archive).extractAllTo(directory, true);
      else await runRuntimeCommand('tar', ['-xzf', archive, '-C', directory], { signal, cwd: root, timeoutMs: 60_000 });
      signal.throwIfAborted();
      const executable = await findRuntimeExecutable(directory);
      if (!executable) throw new Error('El runtime se descargó, pero no contiene llama-server.');
      if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
      if (asset.backend === 'cpu' || asset.backend === 'metal') {
        await runRuntimeCommand(executable, ['--version'], { signal });
        cpu = executable;
        selected = { executable, backend: 'cpu', devices: [] };
      }
      if (asset.backend !== 'cpu') {
        try {
          const output = await runRuntimeCommand(executable, ['--list-devices'], { signal });
          const devices = parseRuntimeDevices(output);
          if (!devices.length) throw new Error('No compatible GPU reported by this runtime.');
          selected = { executable, backend: asset.backend, devices };
          fallbackReason = null;
        } catch (error) {
          signal.throwIfAborted();
          fallbackReason = 'gpu-unavailable';
          probeLog = redactRuntimeLog(error instanceof Error ? error.message : String(error), root);
        }
      }
      await fs.rm(archive, { force: true });
    }
    if (!selected || !cpu) throw new Error('El runtime se descargó, pero no contiene llama-server.');
    const manifest: RuntimeManifest = { policy: LOCAL_RUNTIME_POLICY, platform: `${process.platform}-${process.arch}`,
      version: LLAMA_CPP_VERSION, executable: path.relative(managed, selected.executable), cpu: path.relative(managed, cpu),
      backend: selected.backend, devices: selected.devices.map((d) => `${d.id}: ${d.name}`),
      deviceIds: selected.devices.map((d) => d.id), fallbackReason, probeLog };
    const temporary = path.join(managed, `${randomUUID()}.json.tmp`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await activate(async () => {
        signal.throwIfAborted();
        await fs.rename(temporary, path.join(managed, 'current.json'));
        published = true;
      });
    } finally { await fs.rm(temporary, { force: true }); }
    onProgress(1);
    // Keep current and previous generations. Only delete directories created by
    // this installer, after the lifecycle owner has stopped the old server.
    const previousRelative = previous ? path.relative(managed, previous.executablePath) : '';
    const keep = new Set([path.basename(generation), previousRelative.split(path.sep)[0]]);
    const entries = await fs.readdir(managed, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('generation-') && !keep.has(entry.name)) {
        await fs.rm(path.join(managed, entry.name), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } finally {
    if (!published) await fs.rm(generation, { recursive: true, force: true });
  }
}

/** A hung health response cannot turn a bounded startup into an infinite wait. */
export async function waitForRuntimeHealth(baseUrl: string, child: ChildProcess,
  logs: () => string, spawnError: () => Error | null, timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const error = spawnError();
    if (error) throw new Error(`${error.message} ${logs()}`.trim());
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(logs() || `llama-server terminó con código ${child.signalCode ?? child.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(Math.min(1_500, Math.max(1, deadline - Date.now()))),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* The server may still be loading its model. */ }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  throw new Error(`llama-server no estuvo listo a tiempo. ${logs()}`.trim());
}
