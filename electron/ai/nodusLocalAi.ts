import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  NODUS_LOCAL_MODELS,
  getNodusLocalModel,
  nodusLocalModelBytes,
  type NodusLocalAiStatus,
  type NodusLocalModelDefinition,
} from '@shared/localAiModels';
import type { ModelInfo } from '@shared/types';
import { LocalRuntimeManager, runRuntimeProbe } from './localAiRuntime';
import { LLAMA_CPP_VERSION, runtimeEnvironment, gpuStartupFailure, offloadedLayerCount } from './localAiRuntimePolicy';
import { LocalCalibrationQueue } from './localAiCalibration';

interface ActiveLocalAiDownload {
  progress: number;
  promise: Promise<NodusLocalAiStatus>;
  listeners: Set<(fraction: number) => void>;
  controller: AbortController;
}

const activeDownloads = new Map<string, ActiveLocalAiDownload>();
let activeRuntimeDownload: ActiveLocalAiDownload | null = null;
const embeddingPipelines = new Map<string, Promise<any>>();
const verifiedAssetCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

interface ActiveServer {
  key: string;
  modelId: string;
  mode: 'chat' | 'embedding';
  // llama-server answers /health at the root but serves the OpenAI-compatible
  // surface under /v1, and the two disagree: /embeddings returns a bare array of
  // per-token vectors while /v1/embeddings returns the OpenAI envelope callers
  // parse. Deriving the API URL once, here, is what keeps a caller that reaches a
  // running server from silently talking to the wrong one.
  baseUrl: string;
  apiUrl: string;
  child: ChildProcess;
  slots: number;
  leases: number;
  stopWhenIdle: boolean;
  idleWaiters: Set<() => void>;
  ready: boolean;
  offloadedLayers: number | null;
}

let activeServer: ActiveServer | null = null;
let lifecycleTail: Promise<void> = Promise.resolve();
const safeSlotsByModel = new Map<string, 1 | 2 | 4>();
const calibrationQueue = new LocalCalibrationQueue();
const runtimeManager = new LocalRuntimeManager(rootDirectory);
let lastStartupError = '';

async function serializeLifecycle<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = lifecycleTail;
  lifecycleTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); } finally { release(); }
}

function rootDirectory(): string {
  return path.join(app.getPath('userData'), 'local-ai');
}

function modelsDirectory(): string {
  return path.join(rootDirectory(), 'models');
}

function modelDirectory(modelId: string): string {
  return path.join(modelsDirectory(), modelId);
}

async function llamaServerPath(): Promise<string | null> {
  return (await runtimeManager.resolve())?.executablePath ?? null;
}

async function modelStatus(model: NodusLocalModelDefinition) {
  const directory = modelDirectory(model.id);
  let downloadedBytes = 0;
  let downloaded = true;
  for (const asset of model.assets) {
    const stat = await fsp.stat(path.join(directory, asset.file)).catch(() => null);
    const partial = stat?.isFile() ? null : await fsp.stat(`${path.join(directory, asset.file)}.download`).catch(() => null);
    downloadedBytes += stat?.isFile()
      ? Math.min(stat.size, asset.bytes)
      : partial?.isFile() ? Math.min(partial.size, asset.bytes) : 0;
    if (!stat?.isFile() || stat.size !== asset.bytes) downloaded = false;
  }
  const active = activeDownloads.get(model.id);
  return {
    id: model.id,
    downloaded,
    downloadedBytes,
    totalBytes: nodusLocalModelBytes(model),
    path: directory,
    downloading: Boolean(active),
    progress: active?.progress ?? (downloaded ? 1 : 0),
  };
}

async function sha256Path(target: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const stat = await fsp.stat(target);
  const cached = verifiedAssetCache.get(target);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(target)) {
    signal?.throwIfAborted();
    hash.update(chunk as Buffer);
  }
  const sha256 = hash.digest('hex');
  verifiedAssetCache.set(target, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

export async function verifyNodusLocalModel(modelId: string, signal?: AbortSignal): Promise<boolean> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  for (const asset of model.assets) {
    signal?.throwIfAborted();
    const target = path.join(modelDirectory(model.id), asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat?.isFile() || stat.size !== asset.bytes || !asset.sha256) return false;
    if (await sha256Path(target, signal) !== asset.sha256) return false;
  }
  return true;
}

export async function getNodusLocalAiStatus(): Promise<NodusLocalAiStatus> {
  const executablePath = await llamaServerPath();
  const runtime = runtimeManager.snapshot();
  return {
    runtime: {
      version: LLAMA_CPP_VERSION,
      ready: Boolean(executablePath),
      executablePath,
      downloading: Boolean(activeRuntimeDownload),
      progress: activeRuntimeDownload?.progress ?? (executablePath ? 1 : 0),
      diagnostics: {
        backend: runtime?.backend ?? null,
        devices: runtime?.devices ?? [],
        legacy: runtime?.legacy ?? false,
        fallbackReason: runtime?.fallbackReason,
        detail: lastStartupError || runtime?.detail,
        phase: calibrationQueue.activeKey ? 'calibrating' : activeServer
          ? activeServer.ready ? 'running' : 'starting'
          : lastStartupError ? 'error' : executablePath ? 'installed' : 'not-installed',
        offloadedLayers: activeServer?.offloadedLayers ?? null,
      },
    },
    models: await Promise.all(NODUS_LOCAL_MODELS.map(modelStatus)),
    activeModelId: activeServer?.modelId ?? null,
    activeSlots: activeServer?.slots ?? 0,
    activeLeases: activeServer?.leases ?? 0,
  };
}

function reportDownloadProgress(job: ActiveLocalAiDownload, fraction: number): void {
  job.progress = Math.max(0, Math.min(1, fraction));
  for (const listener of job.listeners) {
    try { listener(job.progress); } catch { /* Progress observers never own the transfer. */ }
  }
}

function followDownload(
  job: ActiveLocalAiDownload,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalAiStatus> {
  if (!onProgress) return job.promise;
  job.listeners.add(onProgress);
  onProgress(job.progress);
  return job.promise.finally(() => job.listeners.delete(onProgress));
}

function downloadCancelledError(): Error {
  const error = new Error('Descarga cancelada.');
  error.name = 'AbortError';
  return error;
}

function throwIfDownloadCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw downloadCancelledError();
}

async function downloadFile(
  url: string,
  target: string,
  expectedBytes: number | undefined,
  expectedSha256: string | undefined,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  throwIfDownloadCancelled(signal);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const completed = await fsp.stat(target).catch(() => null);
  if (completed?.isFile() && (!expectedBytes || completed.size === expectedBytes)) {
    if (!expectedSha256 || await sha256Path(target, signal) === expectedSha256) {
      onBytes(completed.size);
      return;
    }
    await fsp.rm(target, { force: true });
  }
  const partial = `${target}.download`;
  let resumedBytes = (await fsp.stat(partial).catch(() => null))?.size ?? 0;
  if (expectedBytes && resumedBytes > expectedBytes) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: resumedBytes > 0 ? { Range: `bytes=${resumedBytes}-` } : undefined,
    });
  } catch (error) {
    if (signal?.aborted) throw downloadCancelledError();
    throw error;
  }
  if (response.status === 416 && expectedBytes && resumedBytes === expectedBytes) {
    const digest = await sha256Path(partial, signal);
    if (!expectedSha256 || digest === expectedSha256) {
      await fsp.rename(partial, target);
      return;
    }
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo reanudado ha fallado.');
  }
  if (!response.ok || !response.body) throw new Error(`Descarga HTTP ${response.status}: ${url}`);
  const resumed = resumedBytes > 0 && response.status === 206;
  if (!resumed && resumedBytes > 0) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }
  const file = fs.createWriteStream(partial, { flags: resumed ? 'a' : 'wx' });
  const hash = createHash('sha256');
  let received = resumedBytes;
  try {
    if (resumedBytes > 0) {
      for await (const chunk of fs.createReadStream(partial)) hash.update(chunk as Buffer);
      onBytes(resumedBytes);
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve));
      onBytes(chunk.length);
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) {
    file.destroy();
    // Preserve a bounded partial file. A later request resumes it with HTTP Range;
    // checksum verification still guards against a corrupt server response.
    if (signal?.aborted) throw downloadCancelledError();
    throw error;
  }
  throwIfDownloadCancelled(signal);
  if (expectedBytes && received !== expectedBytes) {
    if (received > expectedBytes) await fsp.rm(partial, { force: true });
    throw new Error(`Descarga incompleta: se esperaban ${expectedBytes} bytes y se recibieron ${received}.`);
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo descargado ha fallado.');
  }
  await fsp.rename(partial, target);
}

export async function installNodusLocalRuntime(onProgress?: (fraction: number) => void): Promise<NodusLocalAiStatus> {
  if (activeRuntimeDownload) return followDownload(activeRuntimeDownload, onProgress);
  const job: ActiveLocalAiDownload = {
    progress: 0,
    promise: null as unknown as Promise<NodusLocalAiStatus>,
    listeners: new Set(),
    controller: new AbortController(),
  };
  activeRuntimeDownload = job;
  // This action also upgrades legacy CPU installs. Never replace an engine that
  // owns a real request, and never download anything merely to answer status.
  job.promise = calibrationQueue.runForeground(() => serializeLifecycle(async () => {
    if (activeServer?.leases) throw new Error('El modelo tiene solicitudes en curso. Espera a que terminen antes de actualizar el motor.');
    await stopNodusLocalServerAndWait();
    await runtimeManager.install({
      download: (asset, destination, onBytes, signal) => downloadFile(asset.url, destination, asset.bytes, asset.sha256, onBytes, signal),
      extract: async (asset, archive, destination, signal) => {
        signal.throwIfAborted();
        if (asset.archive === 'zip') {
          await new Promise<void>((resolve, reject) => {
            new AdmZip(archive).extractAllToAsync(destination, true, false, (error?: Error) => error ? reject(error) : resolve());
          });
        } else {
          await runRuntimeProbe('tar', ['-xzf', archive, '-C', destination], signal, 120_000);
        }
        signal.throwIfAborted();
      },
    }, (fraction) => reportDownloadProgress(job, fraction), job.controller.signal);
    safeSlotsByModel.clear();
    lastStartupError = '';
  })).finally(() => {
    if (activeRuntimeDownload === job) activeRuntimeDownload = null;
  }).then(() => getNodusLocalAiStatus());
  return followDownload(job, onProgress);
}

async function downloadModelAssets(
  model: NodusLocalModelDefinition,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<NodusLocalAiStatus> {
  const directory = modelDirectory(model.id);
  const total = nodusLocalModelBytes(model);
  let completed = 0;
  await fsp.mkdir(directory, { recursive: true });
  for (const asset of model.assets) {
    throwIfDownloadCancelled(signal);
    const target = path.join(directory, asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat?.isFile() && stat.size === asset.bytes && asset.sha256 && await sha256Path(target, signal) === asset.sha256) {
      completed += asset.bytes;
      onProgress?.(completed / total);
      continue;
    }
    let current = 0;
    await downloadFile(asset.url, target, asset.bytes, asset.sha256, (bytes) => {
      current += bytes;
      onProgress?.(Math.min(0.999, (completed + current) / total));
    }, signal);
    completed += asset.bytes;
  }
  throwIfDownloadCancelled(signal);
  onProgress?.(1);
  return getNodusLocalAiStatus();
}

export async function downloadNodusLocalModel(
  modelId: string,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalAiStatus> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  const running = activeDownloads.get(modelId);
  if (running) return followDownload(running, onProgress);
  const job: ActiveLocalAiDownload = {
    progress: 0,
    promise: null as unknown as Promise<NodusLocalAiStatus>,
    listeners: new Set(),
    controller: new AbortController(),
  };
  activeDownloads.set(modelId, job);
  job.promise = (async () => {
    if (model.runtime === 'llama_cpp' && (!(await llamaServerPath()) || runtimeManager.snapshot()?.legacy)) {
      throwIfDownloadCancelled(job.controller.signal);
      await installNodusLocalRuntime((fraction) => reportDownloadProgress(job, fraction * 0.2));
      throwIfDownloadCancelled(job.controller.signal);
      return downloadModelAssets(model, (fraction) => reportDownloadProgress(job, 0.2 + fraction * 0.8), job.controller.signal);
    }
    return downloadModelAssets(model, (fraction) => reportDownloadProgress(job, fraction), job.controller.signal);
  })().finally(() => {
    if (activeDownloads.get(modelId) === job) activeDownloads.delete(modelId);
  }).then(() => getNodusLocalAiStatus());
  return followDownload(job, onProgress);
}

export async function cancelNodusLocalDownloads(): Promise<NodusLocalAiStatus> {
  const modelJobs = [...activeDownloads.entries()];
  const runtimeJob = activeRuntimeDownload;
  for (const [, job] of modelJobs) job.controller.abort();
  runtimeJob?.controller.abort();
  await Promise.allSettled([
    ...modelJobs.map(([, job]) => job.promise),
    ...(runtimeJob ? [runtimeJob.promise] : []),
  ]);
  // The installer owns staging cleanup. Cancellation must not delete the
  // previous runnable engine, already verified archives, or downloaded models.
  return getNodusLocalAiStatus();
}

export async function deleteNodusLocalModel(modelId: string): Promise<NodusLocalAiStatus> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  if (activeDownloads.has(modelId)) throw new Error('Espera a que termine la descarga antes de eliminar el modelo.');
  if (activeServer?.modelId === modelId && activeServer.leases > 0) {
    throw new Error('El modelo tiene solicitudes en curso. Espera a que terminen antes de eliminarlo.');
  }
  if (activeServer?.modelId === modelId) stopNodusLocalServer();
  embeddingPipelines.delete(modelId);
  for (const asset of model.assets) verifiedAssetCache.delete(path.join(modelDirectory(modelId), asset.file));
  await fsp.rm(modelDirectory(modelId), { recursive: true, force: true });
  return getNodusLocalAiStatus();
}

export function listNodusLocalChatModels(): ModelInfo[] {
  return NODUS_LOCAL_MODELS.filter((model) => model.kind === 'chat').map((model) => ({
    id: model.id,
    name: model.label,
    sizeBytes: nodusLocalModelBytes(model),
    quantization: model.quantization,
    contextLength: model.contextLength,
    kind: model.vision ? 'vlm' : 'llm',
    vision: model.vision === true,
  }));
}

export function listNodusLocalEmbeddingModels(): ModelInfo[] {
  return NODUS_LOCAL_MODELS.filter((model) => model.kind === 'embedding').map((model) => ({
    id: model.id,
    name: model.label,
    sizeBytes: nodusLocalModelBytes(model),
    quantization: model.quantization,
    contextLength: model.contextLength,
    kind: 'embeddings',
    vision: false,
  }));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(
  baseUrl: string, child: ChildProcess, logs: () => string,
  spawnFailure: () => Error | null, signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const failure = spawnFailure();
    if (failure) throw failure;
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(logs() || `llama-server terminó: ${child.signalCode ?? child.exitCode}.`);
    }
    try {
      const timeout = AbortSignal.timeout(Math.min(1_500, Math.max(1, deadline - Date.now())));
      const response = await fetch(`${baseUrl}/health`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal?.throwIfAborted();
      // Each probe has its own deadline: an accepted but hung socket cannot
      // turn the outer 120-second startup budget into an unbounded wait.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`llama-server no estuvo listo a tiempo. ${logs()}`.trim());
}

export function stopNodusLocalServer(): void {
  const current = activeServer;
  if (current?.leases) {
    current.stopWhenIdle = true;
    return;
  }
  activeServer = null;
  if (current && current.child.exitCode == null) current.child.kill('SIGTERM');
}

/** Process-shutdown backstop. Normal model switches must use leases above. */
export function killNodusLocalServerSync(): void {
  calibrationQueue.cancel();
  const current = activeServer;
  activeServer = null;
  if (!current) return;
  current.stopWhenIdle = false;
  for (const resolve of current.idleWaiters) resolve();
  current.idleWaiters.clear();
  if (current.child.exitCode == null) current.child.kill('SIGKILL');
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!child.pid || child.exitCode != null || child.signalCode != null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

async function stopNodusLocalServerAndWait(server = activeServer): Promise<void> {
  if (!server) return;
  if (activeServer === server) activeServer = null;
  server.stopWhenIdle = false;
  for (const resolve of server.idleWaiters) resolve();
  server.idleWaiters.clear();
  if (!server.child.pid || server.child.exitCode != null || server.child.signalCode != null) return;
  server.child.kill('SIGTERM');
  if (await waitForChildExit(server.child, 2_000)) return;
  server.child.kill('SIGKILL');
  await waitForChildExit(server.child, 2_000);
}

interface LocalCalibrationFile {
  version: 1;
  hardware: string;
  runtime: string;
  models: Record<string, { slots: 1 | 2 | 4; measuredAt: string; throughputGain: number; p95Change: number; safe: boolean; reason?: string }>;
}

function hardwareFingerprint(): string {
  return createHash('sha256')
    .update([process.platform, process.arch, os.cpus()[0]?.model ?? 'cpu', os.totalmem(), LLAMA_CPP_VERSION,
      runtimeManager.fingerprint()].join('|'))
    .digest('hex').slice(0, 20);
}

async function calibratedSlots(modelId: string): Promise<1 | 2 | 4> {
  try {
    const file = JSON.parse(await fsp.readFile(path.join(rootDirectory(), 'calibration.json'), 'utf8')) as LocalCalibrationFile;
    const calibration = file.version === 1 && file.hardware === hardwareFingerprint() && file.runtime === LLAMA_CPP_VERSION
      ? file.models?.[modelId]
      : null;
    if (calibration?.safe && calibration.throughputGain >= 0.15 && calibration.p95Change <= 0.1
      && (calibration.slots === 2 || calibration.slots === 4)) {
      safeSlotsByModel.set(modelId, calibration.slots);
      return calibration.slots;
    }
  } catch { /* Missing/stale calibration intentionally falls back to one full-context slot. */ }
  safeSlotsByModel.set(modelId, 1);
  return 1;
}

export function getNodusLocalSafeSlots(modelId: string): 1 | 2 | 4 {
  return safeSlotsByModel.get(modelId) ?? 1;
}

export async function recordNodusLocalCalibration(input: {
  modelId: string;
  slots: 1 | 2 | 4;
  throughputGain: number;
  p95Change: number;
  memorySafe: boolean;
  reason?: string;
}): Promise<void> {
  const model = getNodusLocalModel(input.modelId);
  if (!model || model.runtime !== 'llama_cpp') throw new Error('Modelo local no calibrable.');
  const safe = input.memorySafe
    && (input.slots === 1 || (input.throughputGain >= 0.15 && input.p95Change <= 0.1));
  const selected: 1 | 2 | 4 = safe ? input.slots : 1;
  const target = path.join(rootDirectory(), 'calibration.json');
  let existing: LocalCalibrationFile = {
    version: 1, hardware: hardwareFingerprint(), runtime: LLAMA_CPP_VERSION, models: {},
  };
  try {
    const parsed = JSON.parse(await fsp.readFile(target, 'utf8')) as LocalCalibrationFile;
    if (parsed.version === 1 && parsed.hardware === existing.hardware && parsed.runtime === existing.runtime) existing = parsed;
  } catch { /* Start a hardware-scoped calibration file. */ }
  existing.models[input.modelId] = {
    slots: selected,
    measuredAt: new Date().toISOString(),
    throughputGain: input.throughputGain,
    p95Change: input.p95Change,
    safe,
    reason: input.reason,
  };
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, target);
  safeSlotsByModel.set(input.modelId, selected);
}

async function hasCurrentCalibration(modelId: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(rootDirectory(), 'calibration.json'), 'utf8')) as LocalCalibrationFile;
    return parsed.version === 1 && parsed.hardware === hardwareFingerprint()
      && parsed.runtime === LLAMA_CPP_VERSION && Boolean(parsed.models?.[modelId]);
  } catch { return false; }
}

function percentile95(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function childRssBytes(child: ChildProcess): Promise<number> {
  const pid = child.pid;
  if (!pid) return 0;
  if (process.platform === 'linux') {
    const status = await fsp.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
    const kib = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
    return Number.isFinite(kib) ? kib * 1024 : 0;
  }
  if (process.platform === 'darwin') {
    const stdout = await runRuntimeProbe('ps', ['-o', 'rss=', '-p', String(pid)], undefined, 2_000).catch(() => '');
    const kib = Number(stdout.trim());
    return Number.isFinite(kib) ? kib * 1024 : 0;
  }
  return 0;
}

async function calibrationRequest(model: NodusLocalModelDefinition, apiUrl: string, index: number, signal: AbortSignal): Promise<void> {
  const endpoint = model.kind === 'embedding' ? 'embeddings' : 'chat/completions';
  const body = model.kind === 'embedding'
    ? { model: model.id, input: `Nodus concurrency calibration sentence ${index}: semantic indexing remains complete and ordered.` }
    : {
        model: model.id,
        temperature: 0,
        // Small reasoning-capable local models may spend the first ~100 tokens
        // internally. Keep the probe concise but leave enough output budget for
        // the requested health JSON, otherwise calibration measures truncation.
        max_tokens: 512,
        messages: [
          { role: 'system', content: 'This is an offline runtime health calibration. Return concise valid JSON only.' },
          { role: 'user', content: `${'Stable full-context calibration data. '.repeat(160)}\nReturn {"status":"ok","index":${index}}.` },
        ],
      };
  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  });
  if (!response.ok) throw new Error(`Calibración local HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as any;
  if (model.kind === 'embedding') {
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length || vector.some((value: unknown) => !Number.isFinite(value))) {
      throw new Error('El runtime devolvió un embedding inválido durante la calibración.');
    }
  } else if (!String(payload?.choices?.[0]?.message?.content ?? '').trim()) {
    throw new Error('El runtime devolvió una respuesta vacía durante la calibración.');
  }
}

async function benchmarkLocalSlots(
  model: NodusLocalModelDefinition,
  slots: 1 | 2 | 4,
  signal: AbortSignal,
): Promise<{ throughput: number; p95Ms: number; memorySafe: boolean }> {
  const mode = model.kind === 'embedding' ? 'embedding' : 'chat';
  signal.throwIfAborted();
  const acquired = await serializeLifecycle(async () => {
    signal.throwIfAborted();
    if (activeServer?.leases) throw new Error('Runtime is busy; calibration deferred');
    const apiUrl = await ensureNodusLocalServerUnlocked(model.id, mode, slots, signal);
    const server = activeServer!;
    server.leases += 1;
    return { apiUrl, server };
  });
  let minimumFree = os.freemem();
  let peakRss = 0;
  const sample = async () => {
    minimumFree = Math.min(minimumFree, os.freemem());
    peakRss = Math.max(peakRss, await childRssBytes(acquired.server.child));
  };
  const timer = setInterval(() => { void sample().catch(() => undefined); }, 100);
  timer.unref?.();
  try {
    const started = process.hrtime.bigint();
    const latencies: number[] = [];
    // Wait for every synthetic request to settle before releasing/killing its
    // server. Promise.all used to leave seven requests running after one failed.
    const results = await Promise.allSettled(Array.from({ length: 8 }, async (_, index) => {
      const requestStarted = process.hrtime.bigint();
      await calibrationRequest(model, acquired.apiUrl, index, signal);
      latencies.push(Number(process.hrtime.bigint() - requestStarted) / 1_000_000);
    }));
    signal.throwIfAborted();
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    await sample();
    const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
    const memorySafe = acquired.server.child.exitCode == null && acquired.server.child.signalCode == null
      && minimumFree >= os.totalmem() * 0.05
      && (peakRss === 0 || peakRss <= os.totalmem() * 0.7);
    return { throughput: 8 / elapsedSeconds, p95Ms: percentile95(latencies), memorySafe };
  } finally {
    clearInterval(timer);
    await serializeLifecycle(async () => {
      acquired.server.leases = Math.max(0, acquired.server.leases - 1);
      for (const resolve of acquired.server.idleWaiters) resolve();
      acquired.server.idleWaiters.clear();
      if (activeServer === acquired.server) await stopNodusLocalServerAndWait(acquired.server);
    });
  }
}

/**
 * Opportunistic, hardware/backend-scoped calibration. CPU keeps one full-context
 * slot without synthetic inference. Foreground requests cancel GPU benchmarks,
 * including queued models, and cancellation never poisons a saved calibration.
 */
export function calibrateNodusLocalModelConcurrency(modelId: string, force = false): Promise<void> {
  return calibrationQueue.schedule(modelId, async (signal) => {
    const model = getNodusLocalModel(modelId);
    if (!model || model.runtime !== 'llama_cpp') return;
    await runtimeManager.resolve();
    signal.throwIfAborted();
    if (!force && await hasCurrentCalibration(modelId)) {
      await calibratedSlots(modelId);
      return;
    }
    try {
      if (!await verifyNodusLocalModel(modelId, signal)) throw new Error('checksum-failed');
      signal.throwIfAborted();
      if (runtimeManager.snapshot()?.backend === 'cpu') {
        await recordNodusLocalCalibration({ modelId, slots: 1, throughputGain: 0, p95Change: 0, memorySafe: true, reason: 'cpu-single-slot' });
        return;
      }
      const baseline = await benchmarkLocalSlots(model, 1, signal);
      let selected: 1 | 2 | 4 = 1;
      let selectedGain = 0;
      let selectedP95Change = 0;
      let selectedMemorySafe = baseline.memorySafe;
      if (baseline.memorySafe) for (const slots of [2, 4] as const) {
        try {
          signal.throwIfAborted();
          const candidate = await benchmarkLocalSlots(model, slots, signal);
          const gain = candidate.throughput / baseline.throughput - 1;
          const p95Change = candidate.p95Ms / baseline.p95Ms - 1;
          if (!candidate.memorySafe || gain < 0.15 || p95Change > 0.1) break;
          selected = slots;
          selectedGain = gain;
          selectedP95Change = p95Change;
          selectedMemorySafe = true;
        } catch {
          signal.throwIfAborted();
          break;
        }
      }
      signal.throwIfAborted();
      await recordNodusLocalCalibration({
        modelId,
        slots: selected,
        throughputGain: selectedGain,
        p95Change: selectedP95Change,
        memorySafe: selectedMemorySafe,
        reason: !selectedMemorySafe ? 'memory-gate-failed'
          : selected === 1 ? 'safe-single-slot'
          : 'throughput-gate-passed',
      });
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const reason = /checksum-failed/i.test(message) ? 'checksum-failed'
        : /HTTP\s+(\d+)/i.test(message) ? `runtime-http-${message.match(/HTTP\s+(\d+)/i)?.[1]}`
        : /embedding inválido/i.test(message) ? 'invalid-embedding'
        : /respuesta vacía/i.test(message) ? 'empty-response'
        : /timeout|timed out|aborted/i.test(message) ? 'timeout'
        : 'runtime-start-or-transport';
      await recordNodusLocalCalibration({ modelId, slots: 1, throughputGain: 0, p95Change: 1, memorySafe: false, reason }).catch(() => undefined);
      console.warn(`[local-ai] concurrency calibration failed for ${modelId}: ${reason}`);
      throw new Error(`La calibración local de «${modelId}» falló (${reason}); se mantendrá un único slot seguro.`);
    }
  });
}

export async function calibrateDownloadedNodusLocalModels(modelIds: string[]): Promise<void> {
  // Register the complete batch before yielding so one foreground request can
  // cancel both the active benchmark and every queued model, not just the first.
  await Promise.all([...new Set(modelIds)].filter((modelId) => getNodusLocalModel(modelId)?.runtime === 'llama_cpp')
    .map((modelId) => calibrateNodusLocalModelConcurrency(modelId)));
}

export async function readNodusLocalMetrics(): Promise<string | null> {
  const server = activeServer;
  if (!server || server.child.exitCode != null || server.child.signalCode != null) return null;
  try {
    const response = await fetch(`${server.baseUrl}/metrics`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function ensureNodusLocalServerUnlocked(
  modelId: string,
  mode: 'chat' | 'embedding',
  slotsOverride?: 1 | 2 | 4,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const model = getNodusLocalModel(modelId);
  if (!model || model.runtime !== 'llama_cpp' || model.kind !== mode) {
    throw new Error(`El modelo «${modelId}» no puede ejecutarse como ${mode}.`);
  }
  const key = `${mode}:${modelId}`;
  if (activeServer?.key === key && activeServer.ready && activeServer.child.exitCode == null && activeServer.child.signalCode == null
    && (slotsOverride == null || activeServer.slots === slotsOverride)) return activeServer.apiUrl;
  await stopNodusLocalServerAndWait();
  const executable = await llamaServerPath();
  if (!executable) throw new Error('Instala primero el motor local de Nodus desde Ajustes → Modelos IA.');
  const runtime = runtimeManager.snapshot()!;
  const status = await modelStatus(model);
  if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
  if (!await verifyNodusLocalModel(model.id, signal)) {
    throw new Error(`La verificación SHA-256 de «${model.label}» ha fallado. Bórralo y vuelve a descargarlo.`);
  }
  signal?.throwIfAborted();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const slots = slotsOverride ?? await calibratedSlots(modelId);
  const contextPerSlot = Math.min(model.contextLength ?? 8192, 32_768);
  const args = [
    '--model', path.join(modelDirectory(model.id), model.modelFile),
    '--alias', model.id,
    '--host', '127.0.0.1',
    '--port', String(port),
    // llama.cpp shares n_ctx across slots. Reserve the complete supported window
    // for every calibrated slot instead of silently dividing 32k between them.
    '--ctx-size', String(contextPerSlot * slots),
    '--parallel', String(slots),
    '--threads', String(Math.max(1, Math.min(8, os.cpus().length - 1))),
    // Let b10002 fit GPU layers to available VRAM; never force 999 layers. The
    // explicit context stays unchanged, preserving the provider's token budget.
    '--n-gpu-layers', runtime.backend === 'cpu' ? '0' : 'auto',
    '--fit', 'on',
    '--offline',
    '--jinja',
    '--metrics',
    '--no-webui',
  ];
  if (runtime.backend === 'cpu') args.push('--device', 'none', '--no-mmproj-offload');
  if (model.projectorFile) args.push('--mmproj', path.join(modelDirectory(model.id), model.projectorFile));
  if (mode === 'embedding') {
    // llama.cpp's non-causal embedding path cannot split one input across
    // micro-batches. Its defaults (n_batch=2048, n_ubatch=512) are collapsed to
    // 512 by llama-server in embedding mode, which made BGE-M3 reject ordinary
    // 513-token passages despite its advertised 8k context.
    //
    // This is a per-input limit, so it is deliberately not multiplied by slots.
    // Keep logical and physical sizes equal, as encoder models require.
    args.push(
      '--batch-size', String(contextPerSlot),
      '--ubatch-size', String(contextPerSlot),
      '--embedding', '--pooling', 'mean',
    );
  }
  lastStartupError = '';
  const child = spawn(executable, args, {
    cwd: path.dirname(executable), env: runtimeEnvironment(executable),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError: Error | null = null;
  const server: ActiveServer = {
    key, modelId, mode, baseUrl, apiUrl: `${baseUrl}/v1`, child,
    slots, leases: 0, stopWhenIdle: false, idleWaiters: new Set(), ready: false, offloadedLayers: null,
  };
  const capture = (chunk: unknown) => {
    // Keep startup diagnostics only. Inference/prompt output is not a support log.
    if (server.ready) return;
    output = `${output}${String(chunk)}`.slice(-12_000);
    server.offloadedLayers = offloadedLayerCount(output) ?? server.offloadedLayers;
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.once('error', (error) => { spawnError = error; });
  activeServer = server;
  child.once('exit', () => {
    server.leases = 0;
    for (const resolve of server.idleWaiters) resolve();
    server.idleWaiters.clear();
    if (activeServer === server) activeServer = null;
  });
  try {
    await waitForServer(baseUrl, child, () => output, () => spawnError, signal);
    signal?.throwIfAborted();
    server.ready = true;
    return server.apiUrl;
  } catch (error) {
    if (activeServer === server) await stopNodusLocalServerAndWait(server);
    signal?.throwIfAborted();
    if (slotsOverride == null && slots > 1) {
      await recordNodusLocalCalibration({ modelId, slots: 1, throughputGain: 0, p95Change: 1, memorySafe: false });
      return ensureNodusLocalServerUnlocked(modelId, mode);
    }
    const detail = `${error instanceof Error ? error.message : String(error)}\n${output}`.slice(-12_000);
    // Only accelerator failures get a single, visible CPU retry. Invalid models,
    // checksums, ports and unsupported options keep their original error.
    if (slotsOverride == null && runtime.backend !== 'cpu' && gpuStartupFailure(detail)
      && await runtimeManager.useCpuFallback(detail)) {
      safeSlotsByModel.clear();
      return ensureNodusLocalServerUnlocked(modelId, mode);
    }
    lastStartupError = detail;
    throw error;
  }
}

export async function ensureNodusLocalServer(modelId: string, mode: 'chat' | 'embedding'): Promise<string> {
  return calibrationQueue.runForeground(async () => {
    const key = `${mode}:${modelId}`;
    for (;;) {
      const outcome = await serializeLifecycle(async () => {
        const current = activeServer;
        if (current && current.key !== key && current.leases > 0) {
          return { wait: new Promise<void>((resolve) => current.idleWaiters.add(resolve)) } as const;
        }
        return { apiUrl: await ensureNodusLocalServerUnlocked(modelId, mode) } as const;
      });
      if ('apiUrl' in outcome && typeof outcome.apiUrl === 'string') return outcome.apiUrl;
      await outcome.wait;
    }
  });
}

/** Hold the selected local runtime/model for the complete network request. */
export async function withNodusLocalServerLease<T>(
  modelId: string,
  mode: 'chat' | 'embedding',
  task: (apiUrl: string) => Promise<T>,
): Promise<T> {
  return calibrationQueue.runForeground(async () => {
    const key = `${mode}:${modelId}`;
    for (;;) {
      const acquired = await serializeLifecycle(async () => {
        const current = activeServer;
        if (current && current.key !== key && current.leases > 0) {
          return { wait: new Promise<void>((resolve) => current.idleWaiters.add(resolve)) } as const;
        }
        const apiUrl = await ensureNodusLocalServerUnlocked(modelId, mode);
        const server = activeServer!;
        server.leases += 1;
        return { server, apiUrl } as const;
      });
      if ('wait' in acquired) {
        await acquired.wait;
        continue;
      }
      try {
        return await task(acquired.apiUrl);
      } catch (error) {
        if (acquired.server.slots > 1 && (
          acquired.server.child.exitCode != null || acquired.server.child.signalCode != null || /out of memory|oom|memory pressure|allocation failed/i.test(error instanceof Error ? error.message : String(error))
        )) {
          await recordNodusLocalCalibration({
            modelId,
            slots: 1,
            throughputGain: 0,
            p95Change: 1,
            memorySafe: false,
          });
          acquired.server.stopWhenIdle = true;
        }
        throw error;
      } finally {
        await serializeLifecycle(async () => {
          acquired.server.leases = Math.max(0, acquired.server.leases - 1);
          if (acquired.server.leases === 0) {
            for (const resolve of acquired.server.idleWaiters) resolve();
            acquired.server.idleWaiters.clear();
            if (acquired.server.stopWhenIdle && activeServer === acquired.server) stopNodusLocalServer();
          }
        });
      }
    }
  });
}

async function transformersPipeline(model: NodusLocalModelDefinition): Promise<any> {
  let pending = embeddingPipelines.get(model.id);
  if (!pending) {
    pending = (async () => {
      const status = await modelStatus(model);
      if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
      if (!await verifyNodusLocalModel(model.id)) throw new Error(`La verificación SHA-256 de «${model.label}» ha fallado.`);
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      return pipeline('feature-extraction', modelDirectory(model.id), {
        dtype: 'int8',
        device: 'cpu',
        local_files_only: true,
      } as any);
    })();
    embeddingPipelines.set(model.id, pending);
  }
  return pending;
}

export async function embedWithNodusLocal(modelId: string, input: string | string[], signal?: AbortSignal): Promise<number[][]> {
  signal?.throwIfAborted();
  const model = getNodusLocalModel(modelId);
  if (!model || model.kind !== 'embedding') throw new Error(`Modelo de embeddings local no soportado: ${modelId}`);
  const texts = Array.isArray(input) ? input : [input];
  if (model.runtime === 'llama_cpp') {
    return withNodusLocalServerLease(modelId, 'embedding', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
        body: JSON.stringify({ model: modelId, input: texts }),
        signal,
      });
      if (!response.ok) throw new Error(`Embeddings locales HTTP ${response.status}: ${await response.text()}`);
      const body = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
      return (body.data ?? [])
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((entry) => entry.embedding ?? []);
    });
  }
  const extractor = await transformersPipeline(model);
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const values = output.tolist() as number[][];
  return values;
}

// Several repository tests load the provider layer under a deliberately tiny
// Electron mock. The real Electron app always exposes EventEmitter methods, but
// guarding registration keeps the local-model module import-safe in workers and
// test harnesses that do not own the application lifecycle.
if (typeof app.once === 'function') app.once('before-quit', stopNodusLocalServer);
