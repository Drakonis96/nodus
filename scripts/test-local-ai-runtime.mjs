// Production installer and manager; only Electron, model weights and executable
// fixtures are substituted. The subprocesses, archives, sockets and leases are real.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-regression-'));
const profile = path.join(tmp, 'profile');
const root = path.join(profile, 'local-ai');
const modeFile = path.join(tmp, 'mode');
const callsFile = path.join(tmp, 'calls');
const program = path.join(tmp, 'fixture.mjs');
let manager;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modelBytes = Buffer.from('small verified GGUF fixture, not a real model');
const models = ['chat', 'embedding'].map((kind) => ({
  id: `fixture-${kind}`, label: `Fixture ${kind}`, kind, runtime: 'llama_cpp',
  modelFile: 'fixture.gguf', contextLength: kind === 'chat' ? 32768 : 8192,
  assets: [{ file: 'fixture.gguf', bytes: modelBytes.length, sha256: digest(modelBytes) }],
}));

async function bundle(entry, filename, plugins = []) {
  const outfile = path.join(tmp, filename);
  await build({ entryPoints: [path.join(repo, entry)], outfile, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'silent',
    external: ['@huggingface/transformers'], plugins,
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
  return import(pathToFileURL(outfile).href);
}
const runtime = await bundle('electron/ai/localAiRuntime.ts', 'runtime.mjs');
const locales = await bundle('src/i18n.localAiRuntime.ts', 'locales.mjs');
after(async () => {
  manager?.killNodusLocalServerSync();
  await rm(tmp, { recursive: true, force: true });
});

async function prepareFixtures() {
  await mkdir(root, { recursive: true });
  await writeFile(modeFile, 'gpu');
  await writeFile(callsFile, '');
  await writeFile(program, `
    import fs from 'node:fs';
    import http from 'node:http';
    const args = process.argv.slice(2);
    const backend = args.shift();
    const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
    const record = (data) => fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(data) + '\\n');
    record({ backend, args });
    if (args.includes('--version')) { console.log('version: b10002'); process.exit(0); }
    if (args.includes('--list-devices')) {
      console.log(mode === 'software' ? 'Vulkan0: llvmpipe (software)' : 'Vulkan0: NVIDIA fixture (12288 MiB)');
      process.exit(0);
    }
    if (mode === 'invalid-model') { console.error('unknown model architecture'); process.exit(2); }
    if (mode === 'oom' && backend === 'vulkan') { console.error('VK_ERROR_OUT_OF_DEVICE_MEMORY'); process.exit(2); }
    console.error('offloaded ' + (backend === 'vulkan' ? '12' : '0') + '/12 layers to GPU');
    const port = Number(args[args.indexOf('--port') + 1]);
    http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        record({ endpoint: req.url, backend });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
        if (req.url === '/v1/chat/completions') {
          console.error('PRIVATE_PROMPT_MUST_NOT_BE_RETAINED');
          return res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        }
        if (req.url === '/v1/embeddings') {
          const value = JSON.parse(body).input;
          const input = Array.isArray(value) ? value : [value];
          return res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [0.1, 0.2] })) }));
        }
        res.statusCode = 404; res.end('{}');
      });
    }).listen(port, '127.0.0.1');
  `);
  for (const model of models) {
    const dir = path.join(root, 'models', model.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, model.modelFile), modelBytes);
  }
  const electron = path.join(tmp, 'electron.mjs');
  const catalog = path.join(tmp, 'catalog.mjs');
  await writeFile(electron, `export const app = { getPath: () => ${JSON.stringify(profile)}, once: () => {} };`);
  await writeFile(catalog, `export const NODUS_LOCAL_MODELS = ${JSON.stringify(models)};
    export const getNodusLocalModel = id => NODUS_LOCAL_MODELS.find(m => m.id === id);
    export const nodusLocalModelBytes = m => m.assets.reduce((n, a) => n + a.bytes, 0);`);
  manager = await bundle('electron/ai/nodusLocalAi.ts', 'manager.mjs', [{
    name: 'fixture-boundaries', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: electron }));
      b.onResolve({ filter: /^@shared\/localAiModels$/ }, () => ({ path: catalog }));
    },
  }]);
}

async function fixtureDownload(asset, target, onBytes, signal) {
  signal?.throwIfAborted();
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.match(asset.url, /^https:\/\/github.com\/ggml-org\/llama.cpp\/releases\/download\/b10002\//);
  const fixture = await mkdtemp(path.join(tmp, 'archive-'));
  const exe = path.join(fixture, 'llama-server');
  // A native-looking executable; the production installer invokes it normally.
  await writeFile(exe, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(program)} ${asset.backend} "$@"\n`);
  await chmod(exe, 0o755);
  const tar = spawnSync('tar', ['-czf', target, '-C', fixture, 'llama-server'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  onBytes(asset.bytes);
  await rm(fixture, { recursive: true, force: true });
}
const installFixture = (download = fixtureDownload, signal = new AbortController().signal, activate = publish => publish()) =>
  runtime.installManagedRuntime(root, download, () => {}, signal, activate, runtime.runtimeAssets('linux', 'x64'));
const calls = async () => (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const launches = async () => (await calls()).filter(c => c.args?.includes('--model'));
const flag = (entry, name) => entry.args[entry.args.indexOf(name) + 1];
const posix = { skip: process.platform === 'win32' ? 'POSIX executable fixtures; real Windows archives are tested separately' : false, timeout: 30_000 };

test('platform catalogue pins separate GPU builds and a CPU fallback', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64']]) {
    const assets = runtime.runtimeAssets(platform, arch);
    assert.deepEqual(assets.map(a => a.backend), ['cpu', 'vulkan']);
    for (const asset of assets) { assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert.ok(asset.bytes > 0); }
    assert.match(assets[1].name, /vulkan/);
  }
  assert.equal(runtime.runtimeAssets('darwin', 'arm64')[0].backend, 'metal');
  assert.equal(runtime.runtimeAssets('darwin', 'x64')[0].backend, 'cpu');
  assert.equal(runtime.runtimeAssets('win32', 'arm64')[0].backend, 'cpu');
  assert.throws(() => runtime.runtimeAssets('unknown', 'x64'));
});

test('device and offload evidence is not inferred from an installed GPU toolkit', () => {
  assert.deepEqual(runtime.parseRuntimeDevices('Vulkan0: NVIDIA RTX 3060\nVulkan1: llvmpipe\nCUDA0: unrelated\nMetal: Apple M2'),
    [{ id: 'Vulkan0', name: 'NVIDIA RTX 3060' }, { id: 'Metal', name: 'Apple M2' }]);
  assert.equal(runtime.parseOffloadedLayers('no offload report'), null);
  assert.equal(runtime.parseOffloadedLayers('offloaded 0/28 layers to GPU'), 0);
  assert.equal(runtime.parseOffloadedLayers('offloaded 28/28 layers to GPU'), 28);
  assert.ok(runtime.gpuStartupFailure('VK_ERROR_OUT_OF_DEVICE_MEMORY'));
  assert.ok(!runtime.gpuStartupFailure('unknown model architecture'));
});

test('AppImage library isolation preserves system driver paths and visibility restrictions', () => {
  const source = { APPDIR: '/tmp/.mount_nodus123', LD_LIBRARY_PATH: '/tmp/.mount_nodus123/usr/lib:/usr/local/cuda/lib64',
    LD_PRELOAD: '/tmp/.mount_nodus123/libshim.so:/usr/lib/legitimate.so', CUDA_VISIBLE_DEVICES: '0', LLAMA_ARG_HOST: '0.0.0.0' };
  const env = runtime.localRuntimeEnvironment('/opt/local-ai/llama-server', source);
  assert.equal(env.CUDA_VISIBLE_DEVICES, '0'); assert.equal(env.LLAMA_ARG_HOST, undefined);
  assert.equal(source.LLAMA_ARG_HOST, '0.0.0.0');
  if (process.platform === 'linux') {
    assert.equal(env.LD_LIBRARY_PATH, '/opt/local-ai:/usr/local/cuda/lib64');
    assert.equal(env.LD_PRELOAD, '/usr/lib/legitimate.so');
  }
});

test('macOS loader incompatibility has a distinct actionable error, not a GPU fallback', () => {
  const error = new Error('dyld[123]: Symbol not found: _OBJC_CLASS_$_MTLResidencySetDescriptor');
  assert.match(runtime.runtimeProcessError(error, 'darwin').message, /NODUS_LOCAL_RUNTIME_MACOS_INCOMPATIBLE/);
  assert.match(runtime.runtimeProcessError(error, 'darwin').message, /Existing models are preserved/);
  assert.equal(runtime.runtimeProcessError(error, 'linux'), error);
  assert.equal(runtime.gpuStartupFailure(runtime.runtimeProcessError(error, 'darwin').message), false);
});

test('probes handle real process success, ENOENT, timeout and cancellation', async () => {
  assert.match(await runtime.runRuntimeCommand(process.execPath, ['-e', 'console.log("probe-ok")']), /probe-ok/);
  await assert.rejects(runtime.runRuntimeCommand(path.join(tmp, 'missing'), []), /ENOENT/);
  await assert.rejects(runtime.runRuntimeCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /timed out/);
  const controller = new AbortController();
  const result = runtime.runRuntimeCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort(new Error('cancel-fixture'));
  await assert.rejects(result, /cancel-fixture/);
});

test('hung health responses and signal/spawn exits cannot cause an infinite startup', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = Date.now();
    await assert.rejects(runtime.waitForRuntimeHealth(base, { exitCode: null, signalCode: null }, () => '', () => null, 150), /tiempo/);
    assert.ok(Date.now() - start < 3_000);
    await assert.rejects(runtime.waitForRuntimeHealth(base, { exitCode: null, signalCode: 'SIGKILL' }, () => '', () => null), /SIGKILL/);
    await assert.rejects(runtime.waitForRuntimeHealth(base, {}, () => '', () => new Error('ENOENT')), /ENOENT/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('atomic upgrade, CPU fallback and failed/cancelled installation preserve existing models and runtime', posix, async () => {
  await prepareFixtures();
  const legacy = path.join(root, 'runtime', 'b10002', 'llama-server');
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, 'legacy-sentinel');
  assert.equal((await runtime.readInstalledRuntime(root)).upgradeRequired, true);
  await installFixture();
  const installed = await runtime.readInstalledRuntime(root);
  assert.equal(installed.backend, 'vulkan'); assert.equal(installed.upgradeRequired, false);
  assert.notEqual(installed.cpuPath, installed.executablePath);
  assert.equal(await readFile(legacy, 'utf8'), 'legacy-sentinel');
  for (const model of models) assert.deepEqual(await readFile(path.join(root, 'models', model.id, model.modelFile)), modelBytes);
  const globalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('status must be offline'); };
    assert.equal((await manager.getNodusLocalAiStatus()).runtime.diagnostics.backend, 'vulkan');
  } finally { globalThis.fetch = globalFetch; }
  await assert.rejects(installFixture(async () => { throw new Error('SHA-256 mismatch'); }), /SHA-256/);
  assert.equal((await runtime.readInstalledRuntime(root)).executablePath, installed.executablePath);
  const abort = new AbortController(); abort.abort(new Error('cancelled'));
  await assert.rejects(installFixture(fixtureDownload, abort.signal), /cancelled/);
  assert.equal((await runtime.readInstalledRuntime(root)).executablePath, installed.executablePath);
  await assert.rejects(installFixture(fixtureDownload, new AbortController().signal, async () => { throw new Error('active lease'); }), /active lease/);
  assert.equal((await runtime.readInstalledRuntime(root)).executablePath, installed.executablePath);
  await writeFile(modeFile, 'software'); await installFixture();
  const fallback = await runtime.readInstalledRuntime(root);
  assert.equal(fallback.backend, 'cpu'); assert.equal(fallback.fallbackReason, 'gpu-unavailable');
  await writeFile(modeFile, 'gpu'); await installFixture();
});

test('first use, warm URLs, context, leases, actual offload and bounded CPU retry work through the real manager', posix, async () => {
  await writeFile(callsFile, '');
  await manager.calibrateNodusLocalModelConcurrency('fixture-chat');
  await manager.calibrateDownloadedNodusLocalModels(['fixture-chat', 'fixture-embedding']);
  assert.deepEqual(await calls(), [], 'automatic policy must not spawn a benchmark or issue synthetic requests');
  const url = await manager.ensureNodusLocalServer('fixture-chat', 'chat');
  assert.match(url, /\/v1$/); assert.equal(await manager.ensureNodusLocalServer('fixture-chat', 'chat'), url);
  assert.equal((await launches()).length, 1);
  const launch = (await launches())[0];
  assert.equal(flag(launch, '--ctx-size'), '32768'); assert.equal(flag(launch, '--parallel'), '1');
  assert.equal(flag(launch, '--n-gpu-layers'), 'auto'); assert.ok(launch.args.includes('--offline'));
  assert.equal((await manager.getNodusLocalAiStatus()).runtime.diagnostics.offloadedLayers, 12);
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const lease = manager.withNodusLocalServerLease('fixture-chat', 'chat', async base => {
    entered(); await held;
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', body: '{}' });
    return response.json();
  });
  await started;
  let switched = false;
  const next = manager.ensureNodusLocalServer('fixture-embedding', 'embedding').then(value => { switched = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(switched, false, 'a leased model cannot be stopped by another model');
  release(); await lease; await next;
  assert.deepEqual(await manager.embedWithNodusLocal('fixture-embedding', ['a', 'b']), [[0.1, 0.2], [0.1, 0.2]]);
  assert.doesNotMatch((await manager.getNodusLocalAiStatus()).runtime.diagnostics.startupLog, /PRIVATE_PROMPT/);
  await writeFile(modeFile, 'oom');
  const before = (await launches()).length;
  await manager.ensureNodusLocalServer('fixture-chat', 'chat');
  assert.deepEqual((await launches()).slice(before).map(c => c.backend), ['vulkan', 'cpu']);
  const cpu = (await launches()).at(-1);
  assert.equal(flag(cpu, '--n-gpu-layers'), '0'); assert.equal(flag(cpu, '--device'), 'none');
  const status = (await manager.getNodusLocalAiStatus()).runtime.diagnostics;
  assert.equal(status.backend, 'cpu'); assert.equal(status.fallbackReason, 'gpu-startup-failed');
  await writeFile(modeFile, 'invalid-model');
  const count = (await launches()).length;
  await assert.rejects(manager.ensureNodusLocalServer('fixture-embedding', 'embedding'), /unknown model architecture/);
  assert.equal((await launches()).length, count + 1, 'model corruption/architecture errors must not be hidden by CPU retries');
  await writeFile(modeFile, 'gpu');
  const installed = await runtime.readInstalledRuntime(root);
  await writeFile(installed.executablePath, '#!/missing/nodus-interpreter\n');
  const start = Date.now();
  await assert.rejects(manager.ensureNodusLocalServer('fixture-embedding', 'embedding'), /ENOENT/);
  assert.ok(Date.now() - start < 3_000, 'spawn errors must not wait for the 120 second health deadline');
});

test('runtime status copy is translated for all UI languages with matching placeholders', () => {
  const tables = locales.LOCAL_AI_RUNTIME_TEXT;
  assert.deepEqual(Object.keys(tables).sort(), ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN'].sort());
  for (const [language, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table).sort(), Object.keys(tables.es).sort(), language);
    for (const [key, value] of Object.entries(table)) {
      assert.ok(value.trim(), `${language}.${key}`);
      assert.deepEqual(value.match(/\{\w+\}/g) ?? [], tables.es[key].match(/\{\w+\}/g) ?? [], `${language}.${key}`);
    }
  }
});
