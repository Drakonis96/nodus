import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimeModule } from './local-ai-runtime-test-utils.mjs';

test('local runtime policy: pinned platform candidates, real inventory and isolated loader environment', async (t) => {
  const p = await loadRuntimeModule(t, 'electron/ai/localAiRuntimePolicy.ts');
  for (const arch of ['x64', 'arm64']) {
    assert.deepEqual(p.runtimeVariants('linux', arch, true).map((v) => v.backend), ['vulkan', 'cpu']);
    assert.deepEqual(p.runtimeVariants('darwin', arch).map((v) => v.backend), ['metal']);
  }
  assert.deepEqual(p.runtimeVariants('win32', 'x64', true).map((v) => v.backend), ['cuda', 'vulkan', 'cpu']);
  assert.deepEqual(p.runtimeVariants('win32', 'x64').map((v) => v.backend), ['vulkan', 'cpu']);
  assert.deepEqual(p.runtimeVariants('win32', 'arm64').map((v) => v.backend), ['cpu']);
  assert.throws(() => p.runtimeVariants('linux', 'ia32'), /unsupported/);
  const cuda = p.runtimeVariants('win32', 'x64', true)[0];
  assert.equal(cuda.archives.length, 2, 'CUDA includes the companion runtime DLL archive');
  assert.match(cuda.archives[1].name, /^cudart-/);
  for (const platform of ['linux', 'win32', 'darwin']) for (const arch of ['x64', 'arm64']) {
    for (const variant of p.runtimeVariants(platform, arch, true)) for (const asset of variant.archives) {
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
      assert.equal(asset.url, `https://github.com/ggml-org/llama.cpp/releases/download/b10002/${asset.name}`);
    }
  }
  assert.deepEqual(p.parseRuntimeDevices('ggml_vulkan: Found 1 GPU\nAvailable devices:\nVulkan0: NVIDIA GeForce RTX 3060 (12288 MiB, 11000 MiB free)', 'vulkan'),
    [{ id: 'Vulkan0', name: 'NVIDIA GeForce RTX 3060' }]);
  assert.deepEqual(p.parseRuntimeDevices('CUDA0: GPU A (4096 MiB, 2048 MiB free)\nCUDA0: GPU A\nVulkan0: GPU B', 'cuda'), [{ id: 'CUDA0', name: 'GPU A' }]);
  assert.deepEqual(p.parseRuntimeDevices('Metal: Apple M2 (16384 MiB, 12000 MiB free)', 'metal'), [{ id: 'Metal', name: 'Apple M2' }]);
  assert.deepEqual(p.parseRuntimeDevices('ggml_cuda: CUDA is enabled\nVulkan0: llvmpipe (LLVM 18, 256 bits)', 'vulkan'), []);
  assert.equal(p.offloadedLayerCount('CUDA0: RTX 3060'), null, 'GPU detection is not offload evidence');
  assert.equal(p.offloadedLayerCount('load_tensors: offloaded 0/33 layers to GPU'), 0);
  assert.equal(p.offloadedLayerCount('load_tensors: offloaded 33/33 layers to GPU'), 33);
  assert.equal(p.gpuStartupFailure('ggml_cuda: CUDA0: NVIDIA GPU\nerror loading model: invalid GGUF header'), false);
  assert.equal(p.gpuStartupFailure('VK_ERROR_OUT_OF_DEVICE_MEMORY'), true);
  assert.equal(p.gpuStartupFailure('CUDA error: out of memory'), true);
  assert.equal(p.gpuStartupFailure('error: failed to bind port'), false);
  const inherited = { APPDIR: '/tmp/.mount_Nodus', LD_LIBRARY_PATH: '/tmp/.mount_Nodus/usr/lib:/usr/local/cuda/lib64:/tmp/.mount_Nodus-other/lib',
    LD_PRELOAD: '/tmp/.mount_Nodus/libx.so /opt/driver/libfix.so', VK_ICD_FILENAMES: '/etc/vulkan/nvidia.json', LLAMA_ARG_MODEL_URL: 'https://example.invalid/private', PATH: '/usr/bin' };
  const env = p.runtimeEnvironment('/home/test/local-ai/bin/llama-server', 'linux', inherited);
  assert.equal(env.LD_LIBRARY_PATH, '/home/test/local-ai/bin:/home/test/local-ai/lib:/usr/local/cuda/lib64:/tmp/.mount_Nodus-other/lib');
  assert.equal(env.LD_PRELOAD, '/opt/driver/libfix.so');
  assert.equal(env.VK_ICD_FILENAMES, inherited.VK_ICD_FILENAMES);
  assert.equal(env.LLAMA_ARG_MODEL_URL, undefined);
  assert.ok(inherited.LLAMA_ARG_MODEL_URL, 'the application environment is not mutated');
  assert.equal(p.runtimeEnvironment('tar', 'linux', { PATH: '/usr/bin' }).LD_LIBRARY_PATH, '', 'relative helper names cannot inject the working directory');
  assert.equal(p.runtimeEnvironment('C:\\runtime\\llama-server.exe', 'win32', { Path: 'C:\\Windows', CUDA_PATH: 'C:\\CUDA' }).Path, 'C:\\runtime;C:\\Windows');
});

test('native probes reject missing executables, signals and hung processes and propagate cancellation', async (t) => {
  const { runRuntimeProbe } = await loadRuntimeModule(t, 'electron/ai/localAiRuntime.ts');
  await assert.rejects(runRuntimeProbe(path.join(os.tmpdir(), 'nodus-runtime-nonexistent-executable'), []), /ENOENT/);
  assert.match(await runRuntimeProbe(process.execPath, ['-e', 'console.log("probe-ok")']), /probe-ok/);
  await assert.rejects(runRuntimeProbe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], undefined, 100), /timed out/);
  const controller = new AbortController();
  const running = runRuntimeProbe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], controller.signal);
  controller.abort(new Error('explicit cancellation'));
  await assert.rejects(running, /explicit cancellation/);
  if (process.platform !== 'win32') await assert.rejects(runRuntimeProbe(process.execPath, ['-e', 'process.kill(process.pid,"SIGTERM")']), /SIGTERM/);
});

async function fixture(t, platform = 'linux', arch = 'x64', options = {}) {
  const { LocalRuntimeManager } = await loadRuntimeModule(t, 'electron/ai/localAiRuntime.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-engine-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloads = [];
  const probes = [];
  const state = { gpu: true, cuda: true, nvidia: true, failure: null, ...options };
  const probe = async (executable, args, signal) => {
    signal?.throwIfAborted();
    probes.push([executable, args]);
    if (executable === 'nvidia-smi') { if (!state.nvidia) throw new Error('NVIDIA not installed'); return 'NVIDIA RTX 3060'; }
    if (executable.includes('cuda-')) {
      if (!state.cuda) throw new Error('CUDA driver is too old');
      return 'CUDA0: NVIDIA RTX 3060 (12288 MiB, 11000 MiB free)';
    }
    if (executable.includes('vulkan-')) return state.gpu ? 'Vulkan0: NVIDIA RTX 3060 (12288 MiB, 11000 MiB free)' : 'Vulkan0: llvmpipe (LLVM 18)';
    if (executable.includes('metal-') && args[0] !== '--version') return state.gpu ? 'Metal: Apple GPU (16384 MiB, 12000 MiB free)' : 'Available devices:';
    return 'Available devices:';
  };
  const installer = {
    async download(asset, target, onBytes, signal) {
      signal.throwIfAborted();
      downloads.push(asset.name);
      if (state.failure && asset.name.includes(state.failure)) throw new Error('SHA-256 verification failed');
      await writeFile(target, 'verified-fixture');
      onBytes(asset.bytes);
    },
    async extract(asset, archive, destination, signal) {
      signal.throwIfAborted();
      assert.equal(await readFile(archive, 'utf8'), 'verified-fixture');
      const dir = path.join(destination, asset.name.startsWith('cudart-') ? 'companion' : 'bin');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, asset.name.startsWith('cudart-') ? 'cudart64_12.dll' : platform === 'win32' ? 'llama-server.exe' : 'llama-server'), 'fixture');
    },
  };
  const manager = new LocalRuntimeManager(() => root, platform, arch, probe);
  return { root, manager, downloads, probes, state, installer, restart: () => new LocalRuntimeManager(() => root, platform, arch, probe) };
}

test('existing CPU installations upgrade atomically, keep GGUFs, persist identity and reuse verified engines', async (t) => {
  const f = await fixture(t);
  const legacy = path.join(f.root, 'runtime', 'b10002', 'llama-server');
  const model = path.join(f.root, 'models', 'already-downloaded.gguf');
  await mkdir(path.dirname(legacy), { recursive: true });
  await mkdir(path.dirname(model), { recursive: true });
  await writeFile(legacy, 'old-engine');
  await writeFile(model, 'user-model');
  assert.equal((await f.manager.resolve()).fallbackReason, 'legacy-cpu');
  assert.equal(f.probes.length, 0, 'merely viewing a legacy install does not launch a benchmark');
  const progress = [];
  await f.manager.install(f.installer, (v) => progress.push(v), new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'vulkan');
  assert.equal(f.manager.snapshot().legacy, false);
  assert.equal(progress.at(-1), 1);
  assert.equal(await readFile(model, 'utf8'), 'user-model');
  assert.equal(await readFile(legacy, 'utf8'), 'old-engine');
  assert.match(f.downloads[0], /bin-ubuntu-x64/, 'an offline CPU fallback is provisioned first');
  const count = f.downloads.length;
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.downloads.length, count, 'recheck probes the actual binary, not a fresh download');
  assert.equal((await f.restart().resolve()).backend, 'vulkan');
  f.state.gpu = false;
  const noGpu = await f.restart().resolve();
  assert.equal(noGpu.backend, 'cpu');
  assert.equal(noGpu.fallbackReason, 'gpu-unavailable');
  assert.equal(f.downloads.length, count, 'startup fallback has no network effect');
});

test('failed verification and cancelled upgrades preserve the previous engine and models', async (t) => {
  const f = await fixture(t, 'linux', 'x64', { failure: 'vulkan' });
  const legacy = path.join(f.root, 'runtime', 'b10002', 'llama-server');
  await mkdir(path.dirname(legacy), { recursive: true }); await writeFile(legacy, 'old-engine');
  await f.manager.resolve();
  await assert.rejects(f.manager.install(f.installer, () => {}, new AbortController().signal), /SHA-256/);
  assert.equal((await f.restart().resolve()).legacy, true, 'no selected engine changes on a failed download');
  assert.equal(await readFile(legacy, 'utf8'), 'old-engine');
  f.state.failure = null;
  const controller = new AbortController();
  const cancelled = { ...f.installer, async extract(...args) { await f.installer.extract(...args); controller.abort(); } };
  await assert.rejects(f.manager.install(cancelled, () => {}, controller.signal), { name: 'AbortError' });
  assert.equal((await f.restart().resolve()).legacy, true);
  const files = await readdir(path.join(f.root, 'runtime-backends', 'b10002', 'linux-x64'));
  assert.ok(!files.some((name) => name.endsWith('.staging')), 'only staging is cleaned up');
});

test('Windows installs both CUDA archives; loader failure falls through to Vulkan, then CPU', async (t) => {
  const f = await fixture(t, 'win32');
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'cuda');
  assert.ok(f.downloads.some((name) => name.startsWith('cudart-')));
  assert.equal(await readFile(path.join(path.dirname(f.manager.snapshot().executablePath), 'cudart64_12.dll'), 'utf8'), 'fixture');
  f.state.cuda = false;
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'vulkan');
  f.state.gpu = false;
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'cpu');
  assert.equal(f.manager.snapshot().fallbackReason, 'gpu-unavailable');
});

test('Apple Metal is retained, supports CPU-only fallback, and ignores injected manifest paths', async (t) => {
  const f = await fixture(t, 'darwin', 'arm64');
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'metal');
  const gpuFingerprint = f.manager.fingerprint();
  assert.equal(await f.manager.useCpuFallback('Metal allocation failed'), true);
  assert.equal(f.manager.snapshot().backend, 'cpu');
  assert.notEqual(f.manager.fingerprint(), gpuFingerprint, 'calibration cannot cross backends');
  assert.equal((await f.restart().resolve()).backend, 'metal', 'temporary fallback does not permanently disable the GPU');
  f.state.gpu = false;
  await f.manager.install(f.installer, () => {}, new AbortController().signal);
  assert.equal(f.manager.snapshot().backend, 'cpu');
  await writeFile(path.join(f.root, 'runtime-backends', 'b10002', 'darwin-arm64', 'selection.json'), JSON.stringify('/tmp/arbitrary-executable'));
  assert.equal(await f.restart().resolve(), null);
});
