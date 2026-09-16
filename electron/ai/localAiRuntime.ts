import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LocalRuntimeBackend, LocalRuntimeDevice, LocalRuntimeDiagnostics } from '@shared/localAiRuntime';
import { LLAMA_CPP_VERSION, parseRuntimeDevices, runtimeEnvironment, runtimeVariants, runtimeVersion, variantId,
  type RuntimeArchive, type RuntimeVariant } from './localAiRuntimePolicy';

export interface InstalledRuntime {
  version: string;
  executablePath: string;
  backend: LocalRuntimeBackend;
  devices: LocalRuntimeDevice[];
  legacy: boolean;
  identity: string;
  fallbackReason?: LocalRuntimeDiagnostics['fallbackReason'];
  detail?: string;
}
export type RuntimeProbe = (command: string, args: string[], signal?: AbortSignal) => Promise<string>;
export interface RuntimeInstaller {
  download: (asset: RuntimeArchive, destination: string, onBytes: (bytes: number) => void, signal: AbortSignal) => Promise<void>;
  extract: (asset: RuntimeArchive, archive: string, destination: string, signal: AbortSignal) => Promise<void>;
}

/** A failed spawn, signal termination, or hung loader is always a bounded error. */
export function runRuntimeProbe(command: string, args: string[], signal?: AbortSignal, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const child = spawn(command, args, {
      cwd: path.isAbsolute(command) ? path.dirname(command) : undefined,
      env: runtimeEnvironment(command), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    let stopped: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(output);
    };
    const stop = (reason: unknown) => {
      if (settled) return;
      stopped = reason;
      child.kill('SIGKILL');
      killTimer = setTimeout(() => finish(reason), 1_000);
    };
    const abort = () => stop(signal?.reason ?? new Error('Runtime probe cancelled'));
    const timer = setTimeout(() => stop(new Error(
      `Runtime probe timed out after ${timeoutMs} ms (${path.basename(command)} ${args.join(' ')}).\n${output}`.trim(),
    )), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const capture = (chunk: unknown) => { output = `${output}${String(chunk)}`.slice(-16_000); };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', (error) => finish(stopped ?? error));
    child.once('close', (code, terminationSignal) => finish(stopped ?? (code === 0 ? undefined
      : new Error(`${output.trim()}\nRuntime exited: ${terminationSignal ?? code}`.trim()))));
  });
}

async function findExecutable(directory: string, wanted: string): Promise<string | null> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return target;
    if (entry.isDirectory()) {
      const nested = await findExecutable(target, wanted);
      if (nested) return nested;
    }
  }
  return null;
}
function detailOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(-2_000);
}

/** No network on status/startup. Only the existing user-triggered installer downloads. */
export class LocalRuntimeManager {
  private pending: Promise<InstalledRuntime | null> | null = null;
  private current: InstalledRuntime | null = null;
  constructor(
    private readonly root: () => string,
    private readonly platform: string = process.platform,
    private readonly arch: string = process.arch,
    private readonly probe: RuntimeProbe = runRuntimeProbe,
  ) {}
  private directory(): string {
    // Do not recursively mix legacy CPU installs with backend-specific libraries.
    return path.join(this.root(), 'runtime-backends', runtimeVersion(this.platform, this.arch), `${this.platform}-${this.arch}`);
  }
  private executableName(): string { return this.platform === 'win32' ? 'llama-server.exe' : 'llama-server'; }
  private async installed(variant: RuntimeVariant): Promise<string | null> {
    const directory = path.join(this.directory(), variantId(variant));
    const marker = await fs.readFile(path.join(directory, 'complete.json'), 'utf8').catch(() => '');
    if (marker !== JSON.stringify(variant.archives.map((asset) => asset.sha256))) return null;
    return findExecutable(directory, this.executableName());
  }
  private async legacy(): Promise<InstalledRuntime | null> {
    const executablePath = await findExecutable(path.join(this.root(), 'runtime', LLAMA_CPP_VERSION), this.executableName());
    if (!executablePath) return null;
    const backend = this.platform === 'darwin' && this.arch === 'arm64' ? 'metal' : 'cpu';
    return { version: LLAMA_CPP_VERSION, executablePath, backend, devices: [], legacy: true, identity: `legacy:${backend}`,
      ...(backend === 'cpu' && runtimeVariants(this.platform, this.arch).some((candidate) => candidate.backend !== 'cpu')
        ? { fallbackReason: 'legacy-cpu' as const } : {}) };
  }
  private async validate(variant: RuntimeVariant, executablePath: string, signal?: AbortSignal): Promise<InstalledRuntime> {
    const output = await this.probe(executablePath, ['--list-devices'], signal);
    const devices = parseRuntimeDevices(output, variant.backend);
    if (variant.backend !== 'cpu' && devices.length === 0) throw new Error(`No usable ${variant.backend} GPU reported by llama-server --list-devices`);
    return { version: variant.archives[0].version, executablePath, backend: variant.backend, devices, legacy: false,
      identity: `${variantId(variant)}:${devices.map((device) => `${device.id}:${device.name}`).join('|')}` };
  }
  private async load(): Promise<InstalledRuntime | null> {
    let selected: unknown;
    try { selected = JSON.parse(await fs.readFile(path.join(this.directory(), 'selection.json'), 'utf8')); } catch { return this.legacy(); }
    // Only allowlisted identities can choose an executable. No paths from JSON.
    const variants = runtimeVariants(this.platform, this.arch, true);
    const variant = variants.find((candidate) => variantId(candidate) === selected);
    if (!variant) return this.legacy();
    const executable = await this.installed(variant);
    try {
      if (!executable) throw new Error('Installed engine is incomplete');
      return await this.validate(variant, executable);
    } catch (error) {
      const cpu = await this.cpuRuntime();
      return cpu ? { ...cpu, fallbackReason: 'gpu-unavailable', detail: detailOf(error) } : null;
    }
  }
  async resolve(): Promise<InstalledRuntime | null> {
    if (!this.pending) this.pending = this.load().then((runtime) => { this.current = runtime; return runtime; });
    return this.pending;
  }
  snapshot(): InstalledRuntime | null { return this.current; }
  fingerprint(): string { return this.current?.identity ?? 'unresolved-runtime'; }
  private select(runtime: InstalledRuntime): void {
    this.current = runtime;
    this.pending = Promise.resolve(runtime);
  }
  private async cpuRuntime(): Promise<InstalledRuntime | null> {
    if (this.platform === 'darwin') {
      const variant = runtimeVariants(this.platform, this.arch)[0];
      const executablePath = await this.installed(variant);
      if (executablePath) return { version: variant.archives[0].version, executablePath, backend: 'cpu', devices: [], legacy: false, identity: `${variantId(variant)}:cpu` };
      const legacy = await this.legacy();
      return legacy ? { ...legacy, backend: 'cpu', devices: [], identity: `${legacy.identity}:cpu` } : null;
    }
    const variant = runtimeVariants(this.platform, this.arch).find((candidate) => candidate.backend === 'cpu')!;
    const executablePath = await this.installed(variant);
    return executablePath ? { version: variant.archives[0].version, executablePath, backend: 'cpu', devices: [], legacy: false, identity: variantId(variant) } : this.legacy();
  }
  /** Session-only fallback; a driver fix can be detected again on next launch. */
  async useCpuFallback(detail: string): Promise<boolean> {
    const cpu = await this.cpuRuntime();
    if (!cpu) return false;
    this.select({ ...cpu, fallbackReason: 'gpu-start-failed', detail: detail.slice(-2_000) });
    return true;
  }
  async install(installer: RuntimeInstaller, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let nvidia = false;
    if (this.platform === 'win32' && this.arch === 'x64') {
      try { nvidia = Boolean((await this.probe('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], signal)).trim()); }
      catch { signal.throwIfAborted(); }
    }
    const variants = runtimeVariants(this.platform, this.arch, nvidia);
    const cpu = variants.find((variant) => variant.backend === 'cpu');
    const order = cpu ? [cpu, ...variants.filter((variant) => variant !== cpu)] : variants;
    let completed = 0;
    const total = order.reduce((sum, variant) => sum + variant.archives.reduce((n, asset) => n + asset.bytes, 0), 0);
    let cpuInstalled: InstalledRuntime | null = null;
    let chosen: InstalledRuntime | null = null;
    let chosenVariant: RuntimeVariant | null = null;
    const failures: string[] = [];
    for (const variant of order) {
      signal.throwIfAborted();
      const bytes = variant.archives.reduce((sum, asset) => sum + asset.bytes, 0);
      const executable = await this.provision(variant, installer, (fraction) => onProgress((completed + fraction * bytes) / total), signal);
      completed += bytes;
      onProgress(completed / total);
      try {
        const runtime = await this.validate(variant, executable, signal);
        if (variant.backend === 'cpu') { cpuInstalled = runtime; chosen = runtime; chosenVariant = variant; }
        else { chosen = runtime; chosenVariant = variant; break; }
      } catch (error) {
        signal.throwIfAborted();
        failures.push(`${variant.backend}: ${detailOf(error)}`);
        // A Metal build can still serve CPU if Metal reports no usable device.
        if (variant.backend === 'metal') {
          try { await this.probe(executable, ['--version'], signal); }
          catch (versionError) {
            signal.throwIfAborted();
            throw new Error(`${failures.join('\n')}\n${detailOf(versionError)}`);
          }
          chosen = { version: variant.archives[0].version, executablePath: executable, backend: 'cpu', devices: [], legacy: false, identity: `${variantId(variant)}:cpu` };
          chosenVariant = variant;
        }
        // Do not fail a working GPU installation just because its independent CPU
        // fallback cannot execute; keep the failure visible in local diagnostics.
      }
    }
    signal.throwIfAborted();
    if (!chosen || !chosenVariant) throw new Error(`No usable local engine. ${failures.join('\n')}`);
    if (chosen.backend === 'cpu' && failures.length) chosen = { ...chosen, fallbackReason: 'gpu-unavailable', detail: failures.join('\n').slice(-2_000) };
    else if (cpu && !cpuInstalled) chosen = { ...chosen, detail: `CPU fallback unavailable. ${failures.join('\n')}`.slice(-2_000) };
    const marker = path.join(this.directory(), 'selection.json');
    await fs.writeFile(`${marker}.tmp`, JSON.stringify(variantId(chosenVariant)), { mode: 0o600 });
    signal.throwIfAborted();
    await fs.rename(`${marker}.tmp`, marker);
    this.select(chosen);
    onProgress(1);
  }
  private async provision(variant: RuntimeVariant, installer: RuntimeInstaller, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> {
    const existing = await this.installed(variant);
    if (existing) { onProgress(1); return existing; }
    const root = this.directory();
    const destination = path.join(root, variantId(variant));
    const staging = `${destination}.staging`;
    await fs.mkdir(root, { recursive: true });
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    let completed = 0;
    const total = variant.archives.reduce((sum, asset) => sum + asset.bytes, 0);
    const archives: string[] = [];
    try {
      for (const asset of variant.archives) {
        signal.throwIfAborted();
        const archive = path.join(root, asset.name);
        archives.push(archive);
        let received = 0;
        // Network/checksum errors deliberately propagate; they are not mistaken
        // for a missing GPU. The previous selected install stays untouched.
        await installer.download(asset, archive, (bytes) => {
          received += bytes;
          onProgress(Math.min(0.9, (completed + received) / total * 0.9));
        }, signal);
        await installer.extract(asset, archive, staging, signal);
        completed += asset.bytes;
      }
      signal.throwIfAborted();
      const executable = await findExecutable(staging, this.executableName());
      if (!executable) throw new Error('Downloaded runtime has no llama-server');
      if (this.platform !== 'win32') await fs.chmod(executable, 0o755);
      // CUDA companion DLLs must be beside llama-server, even if upstream puts
      // archives in different top-level folders. Only pinned archive data enters.
      if (variant.backend === 'cuda') {
        const copyDlls = async (directory: string): Promise<void> => {
          for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const source = path.join(directory, entry.name);
            if (entry.isDirectory()) await copyDlls(source);
            else if (entry.isFile() && /\.dll$/i.test(entry.name)) {
              const target = path.join(path.dirname(executable), entry.name);
              if (source !== target) await fs.copyFile(source, target);
            }
          }
        };
        await copyDlls(staging);
      }
      await fs.writeFile(path.join(staging, 'complete.json'), JSON.stringify(variant.archives.map((asset) => asset.sha256)), { mode: 0o600 });
      signal.throwIfAborted();
      // An incomplete directory is never active (installed() requires the marker).
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(staging, destination);
      for (const archive of archives) await fs.rm(archive, { force: true });
      onProgress(1);
      return (await findExecutable(destination, this.executableName()))!;
    } finally {
      // Leave verified/resumable archives, existing engines and GGUFs untouched.
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
