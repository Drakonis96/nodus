// Regression tests for the llama.cpp runtime selection fixed in issue #851.
//
// The bug: `runtimeAsset()` returned one archive per OS/arch and the Windows and
// Linux entries were the CPU-only builds, so a machine with an NVIDIA (or AMD)
// GPU ran inference on the CPU while the launcher still asked for
// `--n-gpu-layers 999` — an option a CPU build silently ignores. These tests pin
// the decision logic (catalogue, host signals, device probe, upgrade rules) and
// the source contracts that keep the fix honest:
//   - no platform installs an asset by hand any more;
//   - a GPU build is only trusted after it reports a device itself;
//   - the CPU archive stays available as the verified fallback;
//   - macOS keeps its Metal path untouched;
//   - the context size stays the caller's, so auto-fitting never shrinks it.
//
// The fixtures are real: the device line, the layer report and the fitted log
// lines were captured from llama.cpp b10002 on a Windows machine with an
// RTX 3060 Ti (Vulkan) and from the CPU archive on the same machine.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-runtime-'));

try {
  const outfile = path.join(tmp, 'runtime-catalog.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/localAiRuntime.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const catalog = await import(pathToFileURL(outfile).href);
  const {
    LLAMA_CPP_VERSION,
    runtimeAssetCandidates,
    runtimeAssetCatalog,
    parseDeviceList,
    parseOffloadDecision,
    detectInstalledBackend,
    shouldReplaceInstalledRuntime,
    classifyStartupFailure,
    contextSizeWasPreserved,
  } = catalog;

  // ── The catalogue itself ─────────────────────────────────────────────────
  const assets = runtimeAssetCatalog();
  assert.deepEqual(Object.keys(assets).sort(), [
    'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
  ], 'every supported platform has a runtime entry, and no unsupported one appears');
  for (const [key, list] of Object.entries(assets)) {
    assert.ok(list.length > 0, `${key} has at least one candidate`);
    // macOS archives include Metal already, so only Windows/Linux carry a separate
    // CPU fallback; there the last candidate must always be the verified CPU build.
    if (!key.startsWith('darwin')) {
      assert.equal(list.at(-1).backend, 'cpu', `${key} ends with the verified CPU fallback`);
    }
    for (const asset of list) {
      assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.name} is pinned by SHA-256`);
      assert.ok(asset.bytes > 0, `${asset.name} has an expected size`);
      assert.ok(asset.name.includes(LLAMA_CPP_VERSION), `${asset.name} belongs to the pinned tag`);
      assert.match(asset.url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\//, `${asset.name} comes from the pinned upstream release`);
      assert.ok(['zip', 'tar.gz'].includes(asset.archive), `${asset.name} declares a supported archive`);
    }
  }
  // The exact regression: Windows x64 and Linux x64 must not offer the CPU build first.
  for (const key of ['win32-x64', 'linux-x64']) {
    assert.equal(assets[key][0].backend, 'vulkan', `${key} prefers the GPU build when the host can use one`);
    assert.doesNotMatch(assets[key][0].name, /cpu/, `${key}'s first choice is not the CPU-only archive`);
  }
  assert.equal(assets['darwin-arm64'][0].backend, 'metal', 'macOS keeps the Metal-enabled archive');

  // ── Host signals pick the download, the probe decides ────────────────────
  const winGpu = runtimeAssetCandidates({ platform: 'win32', arch: 'x64', vulkanLoader: true });
  assert.deepEqual(winGpu.map((entry) => entry.backend), ['vulkan', 'cpu'], 'a Windows host with a Vulkan loader is offered Vulkan first');
  const winNoGpu = runtimeAssetCandidates({ platform: 'win32', arch: 'x64', vulkanLoader: false });
  assert.deepEqual(winNoGpu.map((entry) => entry.backend), ['cpu', 'vulkan'], 'a Windows host with no graphics stack starts from the CPU build');
  assert.deepEqual(
    runtimeAssetCandidates({ platform: 'linux', arch: 'x64', renderNode: true }).map((entry) => entry.backend),
    ['vulkan', 'cpu'],
    'a Linux host with a DRM render node is offered Vulkan first');
  assert.deepEqual(
    runtimeAssetCandidates({ platform: 'linux', arch: 'arm64', renderNode: true }).map((entry) => entry.backend),
    ['vulkan', 'cpu'],
    'Linux on ARM also gets the Vulkan build when a GPU is present, with the CPU fallback behind it');
  assert.deepEqual(
    runtimeAssetCandidates({ platform: 'darwin', arch: 'arm64' }).map((entry) => entry.backend),
    ['metal'],
    'macOS has a single Metal archive and never falls back to a CPU one');
  assert.deepEqual(
    runtimeAssetCandidates({ platform: 'win32', arch: 'arm64', vulkanLoader: true }).map((entry) => entry.backend),
    ['cpu'],
    'Windows on ARM has no published Vulkan build, so CPU is the only candidate');
  assert.deepEqual(runtimeAssetCandidates({ platform: 'freebsd', arch: 'x64' }), [], 'an unsupported platform yields no candidates instead of a wrong archive');

  // ── The device probe is the runtime's own answer ──────────────────────────
  const vulkanProbe = parseDeviceList([
    'Available devices:',
    '  Vulkan0: NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7469 MiB free)',
  ].join('\n'));
  assert.deepEqual(vulkanProbe, [{ backend: 'Vulkan', index: 0, name: 'NVIDIA GeForce RTX 3060 Ti', totalMiB: 8238, freeMiB: 7469 }],
    'the probe reads the device line llama.cpp prints for a Vulkan build');
  assert.deepEqual(parseDeviceList('Available devices:\n'), [], 'the CPU archive answers the probe with no devices, which is what triggers the fallback');
  assert.deepEqual(parseDeviceList(''), [], 'silence is not a device');
  assert.deepEqual(
    parseDeviceList(['Available devices:', '  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 24000 MiB free)', '  CUDA1: NVIDIA GeForce RTX 4090 (24564 MiB, 23000 MiB free)'].join('\n')).length,
    2,
    'multiple devices are all reported');
  assert.deepEqual(parseDeviceList('  Vulkan0: Some GPU (not a memory report)'), [], 'a malformed line is ignored rather than half-parsed');

  // ── Offload decisions are read from llama.cpp's own log ──────────────────
  // Captured from a fitted run on the RTX 3060 Ti where 131072 cells of context
  // did not fit: the runtime kept the caller's context and dropped to 20 layers.
  const fittedLog = [
    '0.00.189.119 I srv          init: using 11 threads for HTTP server',
    '0.00.197.152 I cmn  common_init_: fitting params to device memory ...',
    '0.00.261.525 I llama_prepare_model_devices: using device Vulkan0 (NVIDIA GeForce RTX 3060 Ti) (0000:01:00.0) - 7289 MiB free',
    '0.00.435.463 I common_params_fit_impl: projected to use 12328 MiB of device memory vs. 7286 MiB of free device memory',
    '0.00.435.468 I common_params_fit_impl: cannot meet free memory target of 1024 MiB, need to reduce device memory by 6066 MiB',
    '0.00.435.468 I common_params_fit_impl: context size set by user to 131072 -> no change',
    '0.01.129.072 I common_params_fit_impl:   - Vulkan0 (NVIDIA GeForce RTX 3060 Ti): 20 layers,   6233 MiB used,   1053 MiB free',
    '0.01.129.076 I common_fit_params: successfully fit params to free device memory',
    '0.01.452.224 I load_tensors: offloaded 20/41 layers to GPU',
  ].join('\n');
  const decision = parseOffloadDecision(fittedLog);
  assert.equal(decision.layers, 20, 'the final layer placement is the one reported, not an earlier measuring pass');
  assert.equal(decision.totalLayers, 41, 'the model layer count is preserved');
  assert.equal(decision.deviceName, 'Vulkan0', 'the device that received the layers is named');
  assert.equal(decision.projectedMiB, 12328, 'the projection used for the decision is captured');
  assert.equal(decision.fitted, true, 'a fitted configuration is reported as fitted');
  assert.equal(contextSizeWasPreserved(fittedLog), true,
    'the runtime confirms it did not shrink the context the caller asked for');
  // Captured from the same machine when everything did fit: every layer on the GPU.
  const fullLog = [
    '0.00.199.527 I cmn  common_init_: fitting params to device memory ...',
    '0.00.261.525 I llama_prepare_model_devices: using device Vulkan0 (NVIDIA GeForce RTX 3060 Ti) (0000:01:00.0) - 7289 MiB free',
    '0.00.414.702 I load_tensors: offloaded 41/41 layers to GPU',
    '0.00.442.542 I common_params_fit_impl: projected to use 2704 MiB of device memory vs. 7286 MiB of free device memory',
    '0.00.442.547 I common_params_fit_impl: will leave 4581 >= 1024 MiB of free device memory, no changes needed',
    '0.00.442.548 I common_fit_params: successfully fit params to free device memory',
  ].join('\n');
  const full = parseOffloadDecision(fullLog);
  assert.equal(full.layers, 41, 'a full offload is reported as every layer');
  assert.equal(full.deviceName, 'Vulkan0', 'the device is taken from the runtime line when no placement table was printed');
  assert.equal(full.projectedMiB, 2704, 'the projection of a fitting configuration is captured');
  assert.equal(parseOffloadDecision('load_tensors: offloaded 0/41 layers to GPU').layers, 0,
    'a CPU-only placement is reported as zero layers, never as acceleration');
  const cpuOnly = parseOffloadDecision([
    'llama_model_loader: loaded meta data',
    'llama_prepare_model_devices: using device CPU',
  ].join('\n'));
  assert.equal(cpuOnly, null, 'a run with no GPU placement reports nothing to claim');

  // ── Upgrades: a legacy CPU install is replaced, a matching one is kept ───
  assert.equal(detectInstalledBackend(['llama-server.exe', 'ggml.dll', 'ggml-cpu-x64.dll']), 'cpu', 'the CPU archive is recognised by the absence of a GPU backend library');
  assert.equal(detectInstalledBackend(['llama-server.exe', 'ggml-vulkan.dll']), 'vulkan', 'a Vulkan install is recognised by its backend library');
  assert.equal(detectInstalledBackend(['libggml-cuda.so', 'llama-server']), 'cuda', 'a CUDA install is recognised too');
  assert.equal(detectInstalledBackend(['libggml-metal.dylib', 'llama-server']), 'metal', 'the macOS archive is recognised as Metal');
  const vulkanAsset = assets['win32-x64'][0];
  const cpuAsset = assets['win32-x64'][1];
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: 'cpu', installedAsset: null, desired: vulkanAsset }), true,
    'a legacy CPU-only install on a GPU-capable machine is upgraded');
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: 'vulkan', installedAsset: null, desired: vulkanAsset }), false,
    'a legacy GPU install that this machine can use is left alone (no pointless re-download)');
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: 'metal', installedAsset: null, desired: assets['darwin-arm64'][0] }), false,
    'an existing macOS install is never re-downloaded by the upgrade path');
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: 'cpu', installedAsset: vulkanAsset.name, desired: vulkanAsset }), false,
    'a GPU install whose descriptor matches the chosen asset is kept');
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: 'vulkan', installedAsset: 'llama-b9999-bin-win-vulkan-x64.zip', desired: vulkanAsset }), true,
    'a runtime installed from a different asset name is replaced');
  assert.equal(shouldReplaceInstalledRuntime({ installedBackend: null, installedAsset: null, desired: cpuAsset }), true,
    'a half-extracted runtime directory with no executable is reinstalled');

  // ── Startup failures are classified for the user ─────────────────────────
  assert.equal(classifyStartupFailure({ spawnErrorCode: 'EPERM', log: '' }).kind, 'blocked-by-security-software',
    'a permission error names the antivirus/policy case instead of a generic crash');
  assert.equal(classifyStartupFailure({ spawnErrorCode: 'EACCES', log: '' }).kind, 'blocked-by-security-software',
    'an access error is the same case on Linux');
  assert.equal(classifyStartupFailure({ exitCode: 1, log: '', elapsedMs: 120 }).kind, 'exited-without-output',
    'a process that dies immediately without a single log line points at a blocked binary');
  assert.equal(classifyStartupFailure({ exitCode: 1, log: 'ggml_vulkan: failed to allocate buffer', elapsedMs: 900 }).kind, 'out-of-memory',
    'an allocation failure is reported as memory, not as a crash');
  assert.equal(classifyStartupFailure({ exitCode: 127, log: 'error while loading shared libraries: libgomp.so.1', elapsedMs: 300 }).kind, 'missing-system-library',
    'a missing shared library is reported as such');
  assert.equal(classifyStartupFailure({ exitCode: 1, log: 'some other failure', elapsedMs: 5000 }).kind, 'unknown',
    'anything else stays generic rather than being mislabelled');

  // ── Source contracts in the manager ──────────────────────────────────────
  const manager = readSource('electron/ai/nodusLocalAi.ts');
  assert.match(manager, /runtimeAssetCandidates\(hostRuntimeSignals\(\)\)/, 'the manager asks the catalogue for this host instead of hard-coding an archive');
  assert.doesNotMatch(manager, /bin-ubuntu-x64\.tar\.gz'/, 'the CPU-only Linux archive is no longer the installed asset');
  assert.doesNotMatch(manager, /bin-win-cpu-x64\.zip'/, 'the CPU-only Windows archive is no longer the installed asset');
  assert.match(manager, /probeLlamaRuntime/, 'the extracted runtime is probed before it is trusted');
  assert.match(manager, /'--list-devices'/, 'the probe asks llama.cpp which devices it can actually use');
  assert.match(manager, /if \(!probe\.devices\.length\)/, 'a GPU build that sees no device is discarded instead of installed');
  assert.match(manager, /no usable device; falling back/, 'the candidate loop records and continues past a GPU build with no device');
  assert.match(manager, /if \(!installed\) \{\s*throw new Error\(`No se pudo instalar un runtime de llama\.cpp utilizable/,
    'a machine where even the CPU archive fails gets an actionable error instead of a half-installed runtime');
  assert.match(manager, /writeRuntimeDescriptor/, 'the chosen backend, device and fallback reason are persisted for the UI');
  assert.match(manager, /runtimeLog\(/, 'backend decisions are written to the diagnostics log');
  assert.match(manager, /appendFile\(runtimeLogPath\(\)/, 'the diagnostics log reaches disk, not only the console');
  // GPU layer placement: macOS keeps the explicit full-offload request; Windows and
  // Linux delegate to the pinned runtime's own fitter so a small-VRAM machine gets
  // as many layers as fit instead of a build that quietly runs everything on the CPU.
  const darwinBranch = manager.match(/if \(process\.platform === 'darwin'\) \{([\s\S]*?)\n {2}\} else \{([\s\S]*?)\n {2}\}/);
  assert.ok(darwinBranch, 'the launch arguments branch by platform');
  assert.match(darwinBranch[1], /'--n-gpu-layers', '999'/, 'Apple Silicon still requests every layer on Metal, exactly as before');
  assert.doesNotMatch(darwinBranch[2], /--n-gpu-layers/, 'Windows and Linux never force a layer count a build may ignore');
  assert.match(darwinBranch[2], /'--fit', 'on'/, 'Windows and Linux let llama.cpp fit the layers to the device memory it measures');
  assert.match(manager, /'--ctx-size', String\(contextPerSlot \* slots\)/, 'the context contract stays explicit so fitting cannot shrink it');
  assert.match(manager, /AbortSignal\.timeout\(5_000\)/, 'each health request is bounded, so a silent process cannot hang the caller');
  // llama-server's default verbosity never states where the layers went, which is
  // why "it runs on the CPU" was unanswerable from the outside.
  assert.match(manager, /'-lv', '4'/, 'the runtime is asked for the verbosity that reports the layer placement');
  assert.match(manager, /recordServerStartupDetails\(output\)/, 'the raw placement lines are kept in the diagnostics log, not only the parsed summary');
  assert.match(manager, /function recordOffloadFromLog\(log: string, options: \{ announce\?: boolean \} = \{\}\)/, 'the placement report is announced once per server start');
  assert.match(manager, /classifyStartupFailure/, 'startup failures are classified for the error the user reads');
  assert.match(manager, /readNodusLocalRuntimeLog\(\)/, 'the status exposes the diagnostics ring buffer');
  assert.match(manager, /offload:/, 'the parsed layer placement is reported in the status');
  assert.match(manager, /processedOnCpu/, 'a CPU answer is explicit in the status, never implied');
  assert.match(manager, /calibrationTail/, 'the runtime lease still serializes a manual calibration against live requests');
  assert.match(manager, /export async function recheckNodusLocalRuntime/, 'existing installs can be re-probed and upgraded on demand');
  assert.match(manager, /export async function calibrateNodusLocalRuntimeConcurrency/, 'concurrency measurement is available as an explicit action');

  const ipc = readSource('@main');
  assert.doesNotMatch(ipc, /calibrateDownloadedNodusLocalModels/, 'changing a model selection no longer enqueues a blocking benchmark');
  const platformIpc = readSource('electron/ipc/platform.ts');
  assert.doesNotMatch(platformIpc, /calibrateNodusLocalModelConcurrency\(model\)/,
    'downloading a model no longer starts a benchmark the next request must wait behind (issue #851)');
  assert.match(platformIpc, /ai:nodusLocal:calibrate/, 'the explicit calibration channel exists');
  assert.match(platformIpc, /ai:nodusLocal:recheckRuntime/, 'the explicit runtime recheck channel exists');

  const ui = readSource('src/components/LocalAiModelsSettings.tsx');
  assert.match(ui, /Aceleración por GPU activa/, 'Settings reports GPU acceleration when it is active');
  assert.match(ui, /Ejecutando en CPU/, 'Settings reports a CPU-only run explicitly');
  assert.match(ui, /runtime\.device/, 'Settings names the detected device');
  assert.match(ui, /runtime\.offload/, 'Settings reports how many layers reached the GPU');
  assert.match(ui, /runtime\.nvidia/, 'Settings reports whether an NVIDIA GPU was detected');
  assert.match(ui, /runtime\.fallbackReason/, 'Settings explains why the CPU engine was installed');
  assert.match(ui, /recheckNodusLocalRuntime/, 'Settings can re-probe the runtime');
  assert.match(ui, /calibrateNodusLocalModel/, 'Settings exposes the explicit measurement action');
  assert.match(ui, /runtime\.logPath/, 'Settings points at the diagnostics log');

  const shared = readSource('shared/localAiModels.ts');
  assert.match(shared, /NodusLocalOffloadStatus/, 'the status type carries the layer placement');
  assert.match(shared, /NodusLocalRuntimeDescriptor/, 'the runtime descriptor has a shared type');

  console.log('Local AI runtime selection tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
