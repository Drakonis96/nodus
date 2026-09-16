import path from 'node:path';
import type { LocalRuntimeBackend, LocalRuntimeDevice } from '@shared/localAiRuntime';

export const LLAMA_CPP_VERSION = 'b10002';
export interface RuntimeArchive {
  name: string;
  url: string;
  sha256: string;
  archive: 'zip' | 'tar.gz';
  bytes: number;
}
export interface RuntimeVariant {
  backend: LocalRuntimeBackend;
  archives: RuntimeArchive[];
}

function archive(name: string, sha256: string, bytes: number): RuntimeArchive {
  return { name, sha256, bytes, archive: name.endsWith('.zip') ? 'zip' : 'tar.gz',
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${name}` };
}
const a = (suffix: string, sha256: string, bytes: number) => archive(`llama-${LLAMA_CPP_VERSION}-bin-${suffix}`, sha256, bytes);
// Digests/sizes are the release's immutable asset identities, not guessed URLs.
// b10002 publishes no Linux CUDA archive: Linux GPU acceleration uses Vulkan.
const CPU: Record<string, RuntimeArchive> = {
  'linux-x64': a('ubuntu-x64.tar.gz', '760dcd8c52be7960bf7487adce4287c151000a41e44f836abdb1a282340c5949', 15_855_822),
  'linux-arm64': a('ubuntu-arm64.tar.gz', '348e880ac43a5df038729f34ac3be6a1c57b5de491504b59b5273d8b1f4dae40', 12_791_141),
  'win32-x64': a('win-cpu-x64.zip', 'c4c3dd2e139e3f00f7bdf4993a2f893e8db4dc6ae51140cc25ddd63306c32734', 18_253_272),
  'win32-arm64': a('win-cpu-arm64.zip', '271470732568e8326c58e0a357e5f9085e956de97587358c690ff166edaafb77', 12_159_035),
};
const METAL: Record<string, RuntimeArchive> = {
  'darwin-arm64': a('macos-arm64.tar.gz', 'b7aca9d4f9c6267a5f389179bd7412c4e991ac7d1b69f52acf065ef99c99345c', 10_749_656),
  'darwin-x64': a('macos-x64.tar.gz', 'c90eaed104ad1c82628d34967def32eaae2516768e10121fbebc4c73a046ac7d', 11_031_400),
};
const VULKAN: Record<string, RuntimeArchive> = {
  'linux-x64': a('ubuntu-vulkan-x64.tar.gz', 'd5da4d5ffc0e7d2ed24d39d3ee482a0e76f5794a5b0b11d972d2e9888a3dca2a', 31_195_148),
  'linux-arm64': a('ubuntu-vulkan-arm64.tar.gz', '17e347f3b9eabf2efab30c4bfb009b2a9c4b3c7a380164d189a6e826b1d18ca1', 25_427_413),
  'win32-x64': a('win-vulkan-x64.zip', 'c2b66ab6912e9fad75c7c6d2000f660bb40bc1f063aa62ec671d471e27dd92ea', 32_950_223),
};
const CUDA: RuntimeArchive[] = [
  a('win-cuda-12.4-x64.zip', 'd8fa3634b6a6a2eb64b56d3f4d68b8e71ee6e1ccb980059476dd51787f1d2f3f', 248_820_066),
  archive('cudart-llama-bin-win-cuda-12.4-x64.zip', '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6', 391_443_627),
];

/** CPU is provisioned as an offline fallback; accelerators are tried in order. */
export function runtimeVariants(platform: string, arch: string, nvidia = false): RuntimeVariant[] {
  const key = `${platform}-${arch}`;
  if (METAL[key]) return [{ backend: 'metal', archives: [METAL[key]] }];
  if (!CPU[key]) throw new Error(`llama.cpp: unsupported platform ${key}`);
  return [
    ...(key === 'win32-x64' && nvidia ? [{ backend: 'cuda' as const, archives: CUDA }] : []),
    ...(VULKAN[key] ? [{ backend: 'vulkan' as const, archives: [VULKAN[key]] }] : []),
    { backend: 'cpu', archives: [CPU[key]] },
  ];
}
export function variantId(variant: RuntimeVariant): string {
  return `${variant.backend}-${variant.archives.map((asset) => asset.sha256.slice(0, 12)).join('-')}`;
}

/** Only the actual --list-devices inventory counts; build banners do not. */
export function parseRuntimeDevices(output: string, backend: LocalRuntimeBackend): LocalRuntimeDevice[] {
  const devices: LocalRuntimeDevice[] = [];
  for (const line of output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = line.match(/^\s*((?:CUDA|Vulkan|Metal)\d*):\s+(.+?)\s*$/i);
    if (!match || !match[1].toLowerCase().startsWith(backend)) continue;
    const name = match[2].replace(/\s*\(\d+\s*MiB.*$/i, '').trim().slice(0, 240);
    if (/llvmpipe|lavapipe|software rasterizer|swiftshader/i.test(name)) continue;
    if (!devices.some((device) => device.id === match[1])) devices.push({ id: match[1], name });
  }
  return devices;
}

/** Prefer engine-local libraries, not libraries injected by the AppImage launcher. */
export function runtimeEnvironment(executable: string, platform = process.platform as string, original = process.env): NodeJS.ProcessEnv {
  const env = { ...original };
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const localDirectories = paths.isAbsolute(executable) ? [paths.dirname(executable), paths.join(paths.dirname(executable), '..', 'lib')] : [];
  if (platform === 'linux') {
    const appDir = env.APPDIR ? paths.resolve(env.APPDIR) : null;
    const keep = (value: string) => value && (!appDir || !(paths.resolve(value) === appDir || paths.resolve(value).startsWith(`${appDir}/`)));
    const existing = (env.LD_LIBRARY_PATH ?? '').split(':').filter(keep);
    env.LD_LIBRARY_PATH = [...new Set([...localDirectories, ...existing])].join(':');
    // Preserve user driver overrides; remove only AppImage-owned preload entries.
    if (env.LD_PRELOAD) {
      const preload = env.LD_PRELOAD.split(/[ :]+/).filter(keep).join(' ');
      if (preload) env.LD_PRELOAD = preload;
      else delete env.LD_PRELOAD;
    }
  } else if (platform === 'win32') {
    const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
    if (localDirectories.length) env[key] = `${localDirectories[0]};${env[key] ?? ''}`;
  }
  // The managed server must not inherit an unrelated llama-server configuration
  // (including network model sources, tools, API keys, or context overrides).
  for (const key of Object.keys(env)) if (key.startsWith('LLAMA_ARG_') || key === 'LLAMA_API_KEY') delete env[key];
  return env;
}

export function gpuStartupFailure(detail: string): boolean {
  return /(?:VK_ERROR|CUDA error|cudaError|cublas.*(?:error|failed)|(?:vulkan|ggml_metal|metal|cuda).*(?:out of memory|allocation failed|failed to allocate|device lost|initialization (?:error|failed))|(?:libggml|libcudart|libcublas).*?(?:not found|cannot open))/i.test(detail);
}
export function offloadedLayerCount(output: string): number | null {
  const matches = [...output.matchAll(/offloaded\s+(\d+)\/\d+\s+layers\s+to\s+GPU/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}
