/**
 * llama.cpp runtime catalogue and the pure decision logic that picks the build
 * Nodus installs on a given machine.
 *
 * Why this file exists: `nodusLocalAi.ts` used to hard-code one asset per
 * OS/arch, and on Windows and Linux that asset was the CPU-only archive. A user
 * with an NVIDIA GPU therefore got a CPU engine while the launcher still asked
 * for `--n-gpu-layers 999`, which a CPU build silently ignores (issue #851).
 * Upstream publishes GPU builds for the same pinned tag, so the selection is a
 * catalogue lookup plus a host capability probe — never a guess from a GPU brand
 * or an installed toolkit.
 *
 * The functions here are deliberately free of Electron, `process.platform` and
 * filesystem access: callers pass the platform, the arch and the observed host
 * signals, and the module answers. That keeps every branch unit-testable from a
 * plain Node process (see scripts/test-local-ai-runtime-selection.mjs).
 */

export const LLAMA_CPP_VERSION = 'b10002';

export type NodusLocalRuntimeBackend = 'metal' | 'vulkan' | 'cuda' | 'cpu';
export type NodusLocalRuntimeArchive = 'zip' | 'tar.gz';

export interface NodusLocalRuntimeAsset {
  /** Upstream file name; also the identity we persist next to the install. */
  name: string;
  url: string;
  sha256: string;
  archive: NodusLocalRuntimeArchive;
  bytes: number;
  backend: NodusLocalRuntimeBackend;
}

export interface NodusLocalRuntimeDevice {
  /** Backend that reported the device: Vulkan, CUDA, Metal, ROCm… */
  backend: string;
  /** Device ordinal inside that backend, as written by llama.cpp (Vulkan0 → 0). */
  index: number;
  name: string;
  totalMiB: number;
  freeMiB: number;
}

export interface NodusLocalOffloadDecision {
  /** Layers actually placed in device memory. */
  layers: number;
  /** Layers the model has in total. */
  totalLayers: number;
  /** Device that received the layers, when llama.cpp named one. */
  deviceName: string | null;
  /** Device memory the runtime projected for this configuration, when reported. */
  projectedMiB: number | null;
  /** True when llama.cpp auto-fitted the configuration instead of taking ours. */
  fitted: boolean;
}

const releaseBase = (version: string) => `https://github.com/ggml-org/llama.cpp/releases/download/${version}`;

function asset(
  version: string,
  name: string,
  sha256: string,
  bytes: number,
  archive: NodusLocalRuntimeArchive,
  backend: NodusLocalRuntimeBackend,
): NodusLocalRuntimeAsset {
  return { name, url: `${releaseBase(version)}/${name}`, sha256, archive, bytes, backend };
}

/**
 * Every runtime Nodus knows about for the pinned llama.cpp tag, in preference
 * order per platform. The first entry is the build a capable machine should get;
 * the CPU build is always present as the verified fallback.
 *
 * Digest and size come from the upstream release metadata for the tag, so a
 * swapped or truncated archive fails the existing SHA-256 gate instead of being
 * extracted.
 */
export function runtimeAssetCatalog(version: string = LLAMA_CPP_VERSION): Record<string, NodusLocalRuntimeAsset[]> {
  return {
    // macOS builds enable Metal in-tree; there is no separate GPU archive.
    'darwin-arm64': [
      asset(version, `llama-${version}-bin-macos-arm64.tar.gz`, 'b7aca9d4f9c6267a5f389179bd7412c4e991ac7d1b69f52acf065ef99c99345c', 10_749_656, 'tar.gz', 'metal'),
    ],
    'darwin-x64': [
      asset(version, `llama-${version}-bin-macos-x64.tar.gz`, 'c90eaed104ad1c82628d34967def32eaae2516768e10121fbebc4c73a046ac7d', 11_031_400, 'tar.gz', 'metal'),
    ],
    // Upstream ships no prebuilt CUDA binary for Linux (a CUDA build would also
    // need a matching toolkit on the host), so Vulkan is the GPU backend here.
    'linux-x64': [
      asset(version, `llama-${version}-bin-ubuntu-vulkan-x64.tar.gz`, 'd5da4d5ffc0e7d2ed24d39d3ee482a0e76f5794a5b0b11d972d2e9888a3dca2a', 31_195_148, 'tar.gz', 'vulkan'),
      asset(version, `llama-${version}-bin-ubuntu-x64.tar.gz`, '760dcd8c52be7960bf7487adce4287c151000a41e44f836abdb1a282340c5949', 15_855_822, 'tar.gz', 'cpu'),
    ],
    'linux-arm64': [
      asset(version, `llama-${version}-bin-ubuntu-vulkan-arm64.tar.gz`, '17e347f3b9eabf2efab30c4bfb009b2a9c4b3c7a380164d189a6e826b1d18ca1', 25_427_413, 'tar.gz', 'vulkan'),
      asset(version, `llama-${version}-bin-ubuntu-arm64.tar.gz`, '348e880ac43a5df038729f34ac3be6a1c57b5de491504b59b5273d8b1f4dae40', 12_791_141, 'tar.gz', 'cpu'),
    ],
    'win32-x64': [
      asset(version, `llama-${version}-bin-win-vulkan-x64.zip`, 'c2b66ab6912e9fad75c7c6d2000f660bb40bc1f063aa62ec671d471e27dd92ea', 32_950_223, 'zip', 'vulkan'),
      asset(version, `llama-${version}-bin-win-cpu-x64.zip`, 'c4c3dd2e139e3f00f7bdf4993a2f893e8db4dc6ae51140cc25ddd63306c32734', 18_253_272, 'zip', 'cpu'),
    ],
    // No Vulkan archive exists for Windows on ARM in this tag.
    'win32-arm64': [
      asset(version, `llama-${version}-bin-win-cpu-arm64.zip`, '271470732568e8326c58e0a357e5f9085e956de97587358c690ff166edaafb77', 12_159_035, 'zip', 'cpu'),
    ],
  };
}

/** Files that identify which backend an already-extracted runtime was built for. */
export const BACKEND_MARKER_FILES: Record<Exclude<NodusLocalRuntimeBackend, 'cpu'>, string[]> = {
  metal: ['libggml-metal.dylib', 'ggml-metal.dll', 'libggml-metal.so', 'ggml-metal.metal'],
  vulkan: ['ggml-vulkan.dll', 'libggml-vulkan.so', 'ggml-vulkan.lib'],
  cuda: ['ggml-cuda.dll', 'libggml-cuda.so', 'ggml-cuda.lib'],
};

/**
 * Read the backend of an installed runtime from the shared libraries that sit
 * next to the executable. Upstream never ships more than one GPU backend in an
 * archive, so the first marker hit is the answer; no marker means the CPU build.
 */
export function detectInstalledBackend(fileNames: readonly string[]): NodusLocalRuntimeBackend {
  const lower = fileNames.map((name) => name.toLowerCase());
  for (const [backend, markers] of Object.entries(BACKEND_MARKER_FILES)) {
    if (markers.some((marker) => lower.includes(marker.toLowerCase()))) {
      return backend as Exclude<NodusLocalRuntimeBackend, 'cpu'>;
    }
  }
  return 'cpu';
}

export interface RuntimeHostSignals {
  platform: string;
  arch: string;
  /** A Vulkan loader is present (Windows: `vulkan-1.dll`; Linux: `libvulkan.so.1`). */
  vulkanLoader?: boolean;
  /** Linux only: at least one DRM render node exists (`/dev/dri/renderD*`). */
  renderNode?: boolean;
}

/**
 * Candidate builds for this host, most capable first.
 *
 * A GPU archive is only proposed when the host actually shows a signal that a
 * graphics stack exists — the loader on Windows, the loader or a DRM render node
 * on Linux. That signal is a *hint used to avoid pointless downloads*, never the
 * final word: the extracted runtime is probed afterwards and a build that cannot
 * see a device is replaced by the CPU one.
 */
export function runtimeAssetCandidates(signals: RuntimeHostSignals, version: string = LLAMA_CPP_VERSION): NodusLocalRuntimeAsset[] {
  const all = runtimeAssetCatalog(version)[`${signals.platform}-${signals.arch}`] ?? [];
  if (!all.length) return [];
  const gpuPossible = signals.platform === 'linux'
    ? Boolean(signals.vulkanLoader || signals.renderNode)
    : signals.platform === 'win32'
      ? Boolean(signals.vulkanLoader)
      // macOS archives are Metal-enabled, so there is nothing to gate.
      : true;
  const gpu = all.filter((candidate) => candidate.backend !== 'cpu');
  const cpu = all.filter((candidate) => candidate.backend === 'cpu');
  return gpuPossible ? [...gpu, ...cpu] : [...cpu, ...gpu];
}

/**
 * Parse `llama-server --list-devices`. Upstream prints
 * `  Vulkan0: NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7469 MiB free)` per device,
 * and a bare `Available devices:` header when the build has no usable device —
 * which is exactly how the CPU archive answers and therefore the probe that
 * decides whether a GPU build is worth keeping.
 */
export function parseDeviceList(output: string): NodusLocalRuntimeDevice[] {
  const devices: NodusLocalRuntimeDevice[] = [];
  const pattern = /^\s*([A-Za-z]+)(\d+)\s*:\s*(.+?)\s*\((\d+)\s*MiB\s*,\s*(\d+)\s*MiB free\)\s*$/;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;
    devices.push({
      backend: match[1],
      index: Number(match[2]),
      name: match[3].trim(),
      totalMiB: Number(match[4]),
      freeMiB: Number(match[5]),
    });
  }
  return devices;
}

/**
 * Parse what llama.cpp decided at startup: the layer placement and, when the
 * pinned runtime auto-fits the configuration to device memory, the projection it
 * used. These lines are the only trustworthy statement of "is this run using the
 * GPU", so they are what Nodus reports instead of inferring from a GPU name.
 */
export function parseOffloadDecision(log: string): NodusLocalOffloadDecision | null {
  // The LAST layer-placement line wins: a fitted run loads the model once to
  // measure it and once for real, so only the final statement describes the
  // configuration that actually serves requests.
  const layered = [...log.matchAll(/load_tensors:\s*offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers to GPU/gi)].pop();
  if (!layered) return null;
  const placement = [...log.matchAll(/^\s*[-*]\s*([^:()]+?)\s*\(([^)]+)\):\s*(\d+)\s+layers,\s*(\d+)\s+MiB used/gi)].pop();
  const chosen = [...log.matchAll(/using device\s+(\w+)/gi)].pop();
  const projection = [...log.matchAll(/projected to use\s+(\d+)\s+MiB of device memory/gi)].pop();
  return {
    layers: Number(layered[1]),
    totalLayers: Number(layered[2]),
    deviceName: placement?.[1]?.trim() ?? chosen?.[1] ?? null,
    projectedMiB: projection ? Number(projection[1]) : null,
    fitted: /fitting params to device memory|common_fit_params/.test(log),
  };
}

/** True when the log shows llama.cpp kept the context size the caller asked for. */
export function contextSizeWasPreserved(log: string): boolean {
  return /context size set by user to \d+ -> no change/i.test(log);
}

export type NodusLocalStartupFailureKind =
  | 'blocked-by-security-software'
  | 'out-of-memory'
  | 'missing-system-library'
  | 'no-usable-device'
  | 'exited-without-output'
  | 'unknown';

export interface NodusLocalStartupFailure {
  kind: NodusLocalStartupFailureKind;
  /** Extra sentence appended to the user-facing error, already localized upstream. */
  detail: string;
}

/**
 * Classify why a runtime process failed to start.
 *
 * `blocked-by-security-software` and `exited-without-output` are the two shapes
 * an antivirus block takes in the field: the executable is deleted or denied
 * (`EPERM`/`EACCES`) or it is killed before it can print its banner. Both need a
 * different user action than a genuine crash, so they get their own kind.
 */
export function classifyStartupFailure(input: {
  spawnErrorCode?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  log?: string;
  elapsedMs?: number;
}): NodusLocalStartupFailure {
  const code = (input.spawnErrorCode ?? '').toUpperCase();
  const log = input.log ?? '';
  if (['EPERM', 'EACCES', 'ENOENT'].includes(code)) {
    return { kind: 'blocked-by-security-software', detail: code };
  }
  if (/out of memory|failed to allocate|alloc.*failed|cuMalloc|cudaMalloc|VK_ERROR_OUT_OF/i.test(log)) {
    return { kind: 'out-of-memory', detail: 'allocation' };
  }
  if (/error while loading shared libraries|cannot open shared object|The specified module could not be found|0xc000007b/i.test(log)) {
    return { kind: 'missing-system-library', detail: 'shared-library' };
  }
  if (/no usable device|no device found|failed to initialize backend/i.test(log)) {
    return { kind: 'no-usable-device', detail: 'backend-init' };
  }
  if ((input.elapsedMs ?? Number.POSITIVE_INFINITY) < 3_000 && !log.trim()) {
    return { kind: 'exited-without-output', detail: 'silent-exit' };
  }
  return { kind: 'unknown', detail: input.signal ?? String(input.exitCode ?? '') };
}

/**
 * Should an installed runtime be replaced by `desired`?
 *
 * A runtime installed by an older Nodus has no descriptor; its backend is read
 * from the backend library next to the executable, which is enough to tell a
 * legacy CPU install (needs the GPU build) from a legacy macOS install whose
 * archive we still ship unchanged (needs nothing). Reinstalling must never be
 * triggered merely because a descriptor is missing.
 */
export function shouldReplaceInstalledRuntime(input: {
  installedBackend: NodusLocalRuntimeBackend | null;
  installedAsset: string | null;
  desired: NodusLocalRuntimeAsset;
  /** True when the installed backend matched what this host can use. */
  installedBackendUsable?: boolean;
}): boolean {
  if (!input.installedBackend) return true;
  if (input.installedAsset) return input.installedAsset !== input.desired.name;
  if (input.installedBackend === input.desired.backend) return false;
  // A legacy GPU install on a host that can use it stays; only a legacy CPU
  // install on a GPU-capable host (or vice versa) is replaced.
  return !(input.installedBackendUsable && input.installedBackend !== 'cpu');
}
