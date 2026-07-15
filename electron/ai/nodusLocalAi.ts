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

const LLAMA_CPP_VERSION = 'b10002';
const activeDownloads = new Map<string, Promise<NodusLocalAiStatus>>();
const embeddingPipelines = new Map<string, Promise<any>>();

interface RuntimeAsset {
  name: string;
  url: string;
  sha256: string;
  archive: 'zip' | 'tar.gz';
  bytes: number;
}

interface ActiveServer {
  key: string;
  modelId: string;
  mode: 'chat' | 'embedding';
  baseUrl: string;
  child: ChildProcess;
}

let activeServer: ActiveServer | null = null;

function rootDirectory(): string {
  return path.join(app.getPath('userData'), 'local-ai');
}

function modelsDirectory(): string {
  return path.join(rootDirectory(), 'models');
}

function modelDirectory(modelId: string): string {
  return path.join(modelsDirectory(), modelId);
}

function runtimeDirectory(): string {
  return path.join(rootDirectory(), 'runtime', LLAMA_CPP_VERSION);
}

function runtimeAsset(): RuntimeAsset {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}`;
  const key = `${process.platform}-${process.arch}`;
  const assets: Record<string, Omit<RuntimeAsset, 'url'>> = {
    'darwin-arm64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-macos-arm64.tar.gz`,
      sha256: 'b7aca9d4f9c6267a5f389179bd7412c4e991ac7d1b69f52acf065ef99c99345c',
      archive: 'tar.gz',
      bytes: 10_749_656,
    },
    'darwin-x64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-macos-x64.tar.gz`,
      sha256: 'c90eaed104ad1c82628d34967def32eaae2516768e10121fbebc4c73a046ac7d',
      archive: 'tar.gz',
      bytes: 11_031_400,
    },
    'linux-arm64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-ubuntu-arm64.tar.gz`,
      sha256: '348e880ac43a5df038729f34ac3be6a1c57b5de491504b59b5273d8b1f4dae40',
      archive: 'tar.gz',
      bytes: 12_791_141,
    },
    'linux-x64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.tar.gz`,
      sha256: '760dcd8c52be7960bf7487adce4287c151000a41e44f836abdb1a282340c5949',
      archive: 'tar.gz',
      bytes: 15_855_822,
    },
    'win32-arm64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-win-cpu-arm64.zip`,
      sha256: '271470732568e8326c58e0a357e5f9085e956de97587358c690ff166edaafb77',
      archive: 'zip',
      bytes: 12_159_035,
    },
    'win32-x64': {
      name: `llama-${LLAMA_CPP_VERSION}-bin-win-cpu-x64.zip`,
      sha256: 'c4c3dd2e139e3f00f7bdf4993a2f893e8db4dc6ae51140cc25ddd63306c32734',
      archive: 'zip',
      bytes: 18_253_272,
    },
  };
  const asset = assets[key];
  if (!asset) throw new Error(`llama.cpp no ofrece un runtime integrado para ${key}.`);
  return { ...asset, url: `${base}/${asset.name}` };
}

async function findFile(directory: string, wanted: string): Promise<string | null> {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, wanted);
      if (nested) return nested;
    }
  }
  return null;
}

async function llamaServerPath(): Promise<string | null> {
  return findFile(runtimeDirectory(), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
}

async function modelStatus(model: NodusLocalModelDefinition) {
  const directory = modelDirectory(model.id);
  let downloadedBytes = 0;
  let downloaded = true;
  for (const asset of model.assets) {
    const stat = await fsp.stat(path.join(directory, asset.file)).catch(() => null);
    downloadedBytes += stat?.isFile() ? Math.min(stat.size, asset.bytes) : 0;
    if (!stat?.isFile() || stat.size !== asset.bytes) downloaded = false;
  }
  return {
    id: model.id,
    downloaded,
    downloadedBytes,
    totalBytes: nodusLocalModelBytes(model),
    path: directory,
  };
}

export async function getNodusLocalAiStatus(): Promise<NodusLocalAiStatus> {
  const executablePath = await llamaServerPath();
  return {
    runtime: { version: LLAMA_CPP_VERSION, ready: Boolean(executablePath), executablePath },
    models: await Promise.all(NODUS_LOCAL_MODELS.map(modelStatus)),
    activeModelId: activeServer?.modelId ?? null,
  };
}

async function downloadFile(
  url: string,
  target: string,
  expectedBytes: number | undefined,
  expectedSha256: string | undefined,
  onBytes: (bytes: number) => void
): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.download`;
  await fsp.rm(partial, { force: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Descarga HTTP ${response.status}: ${url}`);
  const file = fs.createWriteStream(partial, { flags: 'wx' });
  const hash = createHash('sha256');
  let received = 0;
  try {
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
    await fsp.rm(partial, { force: true });
    throw error;
  }
  if (expectedBytes && received !== expectedBytes) {
    await fsp.rm(partial, { force: true });
    throw new Error(`Descarga incompleta: se esperaban ${expectedBytes} bytes y se recibieron ${received}.`);
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo descargado ha fallado.');
  }
  await fsp.rename(partial, target);
}

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} terminó con código ${code}.`)));
  });
}

export async function installNodusLocalRuntime(onProgress?: (fraction: number) => void): Promise<NodusLocalAiStatus> {
  const existing = await llamaServerPath();
  if (existing) return getNodusLocalAiStatus();
  const asset = runtimeAsset();
  const root = runtimeDirectory();
  const archive = path.join(rootDirectory(), `${asset.name}.download`);
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(rootDirectory(), { recursive: true });
  let downloaded = 0;
  await downloadFile(asset.url, archive, asset.bytes, asset.sha256, (bytes) => {
    downloaded += bytes;
    onProgress?.(Math.min(0.9, (downloaded / asset.bytes) * 0.9));
  });
  await fsp.mkdir(root, { recursive: true });
  if (asset.archive === 'zip') {
    new AdmZip(archive).extractAllTo(root, true);
  } else {
    await run('tar', ['-xzf', archive, '-C', root]);
  }
  await fsp.rm(archive, { force: true });
  const executable = await llamaServerPath();
  if (!executable) throw new Error('El runtime se descargó, pero no contiene llama-server.');
  if (process.platform !== 'win32') await fsp.chmod(executable, 0o755);
  onProgress?.(1);
  return getNodusLocalAiStatus();
}

async function downloadModelAssets(
  model: NodusLocalModelDefinition,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalAiStatus> {
  const directory = modelDirectory(model.id);
  const total = nodusLocalModelBytes(model);
  let completed = 0;
  await fsp.mkdir(directory, { recursive: true });
  for (const asset of model.assets) {
    const target = path.join(directory, asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat?.isFile() && stat.size === asset.bytes) {
      completed += asset.bytes;
      onProgress?.(completed / total);
      continue;
    }
    let current = 0;
    await downloadFile(asset.url, target, asset.bytes, asset.sha256, (bytes) => {
      current += bytes;
      onProgress?.(Math.min(0.999, (completed + current) / total));
    });
    completed += asset.bytes;
  }
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
  if (running) return running;
  const promise = (async () => {
    if (model.runtime === 'llama_cpp' && !(await llamaServerPath())) {
      await installNodusLocalRuntime((fraction) => onProgress?.(fraction * 0.2));
      return downloadModelAssets(model, (fraction) => onProgress?.(0.2 + fraction * 0.8));
    }
    return downloadModelAssets(model, onProgress);
  })().finally(() => activeDownloads.delete(modelId));
  activeDownloads.set(modelId, promise);
  return promise;
}

export async function deleteNodusLocalModel(modelId: string): Promise<NodusLocalAiStatus> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  if (activeDownloads.has(modelId)) throw new Error('Espera a que termine la descarga antes de eliminar el modelo.');
  if (activeServer?.modelId === modelId) stopNodusLocalServer();
  embeddingPipelines.delete(modelId);
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
    kind: 'vlm',
    vision: true,
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

async function waitForServer(baseUrl: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(logs() || `llama-server terminó con código ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Model loading can take several seconds; keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`llama-server no estuvo listo a tiempo. ${logs()}`.trim());
}

export function stopNodusLocalServer(): void {
  const current = activeServer;
  activeServer = null;
  if (current && current.child.exitCode == null) current.child.kill('SIGTERM');
}

export async function ensureNodusLocalServer(modelId: string, mode: 'chat' | 'embedding'): Promise<string> {
  const model = getNodusLocalModel(modelId);
  if (!model || model.runtime !== 'llama_cpp' || model.kind !== mode) {
    throw new Error(`El modelo «${modelId}» no puede ejecutarse como ${mode}.`);
  }
  const key = `${mode}:${modelId}`;
  if (activeServer?.key === key && activeServer.child.exitCode == null) return activeServer.baseUrl;
  stopNodusLocalServer();
  const executable = await llamaServerPath();
  if (!executable) throw new Error('Instala primero el motor local de Nodus desde Ajustes → Modelos IA.');
  const status = await modelStatus(model);
  if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    '--model', path.join(modelDirectory(model.id), model.modelFile),
    '--alias', model.id,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--ctx-size', String(Math.min(model.contextLength ?? 8192, 32_768)),
    '--threads', String(Math.max(1, Math.min(8, os.cpus().length - 1))),
    '--n-gpu-layers', '999',
    '--jinja',
    '--no-webui',
  ];
  if (model.projectorFile) args.push('--mmproj', path.join(modelDirectory(model.id), model.projectorFile));
  if (mode === 'embedding') args.push('--embedding', '--pooling', 'mean');
  const child = spawn(executable, args, { cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = (chunk: unknown) => { output = `${output}${String(chunk)}`.slice(-12_000); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const server: ActiveServer = { key, modelId, mode, baseUrl, child };
  activeServer = server;
  child.once('exit', () => { if (activeServer === server) activeServer = null; });
  try {
    await waitForServer(baseUrl, child, () => output);
    return `${baseUrl}/v1`;
  } catch (error) {
    if (activeServer === server) stopNodusLocalServer();
    throw error;
  }
}

async function transformersPipeline(model: NodusLocalModelDefinition): Promise<any> {
  let pending = embeddingPipelines.get(model.id);
  if (!pending) {
    pending = (async () => {
      const status = await modelStatus(model);
      if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
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

export async function embedWithNodusLocal(modelId: string, input: string | string[]): Promise<number[][]> {
  const model = getNodusLocalModel(modelId);
  if (!model || model.kind !== 'embedding') throw new Error(`Modelo de embeddings local no soportado: ${modelId}`);
  const texts = Array.isArray(input) ? input : [input];
  if (model.runtime === 'llama_cpp') {
    const baseUrl = await ensureNodusLocalServer(modelId, 'embedding');
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({ model: modelId, input: texts }),
    });
    if (!response.ok) throw new Error(`Embeddings locales HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
    return (body.data ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((entry) => entry.embedding ?? []);
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
