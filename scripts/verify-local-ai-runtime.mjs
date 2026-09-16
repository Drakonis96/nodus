// Networked smoke, deliberately separate from the offline unit suite. This uses
// the production download, SHA-256 verification, extraction and selection path.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-native-runtime-'));
const root = path.join(profile, 'local-ai');
let manager;
const originalFetch = globalThis.fetch;
try {
  const legacy = path.join(root, 'runtime', 'b10002', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, 'legacy-marker-not-executed');
  const sentinel = path.join(root, 'models', 'preserved.gguf');
  await mkdir(path.dirname(sentinel), { recursive: true });
  await writeFile(sentinel, 'this model must never be replaced by an engine update');
  const stub = path.join(profile, 'electron.mjs');
  await writeFile(stub, `export const app = { getPath: () => ${JSON.stringify(profile)}, once() {} };`);
  const outfile = path.join(profile, 'runtime.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/nodusLocalAi.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', external: ['@huggingface/transformers'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{ name: 'disposable-electron-profile', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: stub })); } }],
  });
  manager = await import(pathToFileURL(outfile).href);
  assert.equal((await manager.getNodusLocalAiStatus()).runtime.diagnostics.legacy, true);
  let requests = 0;
  globalThis.fetch = (...args) => { requests += 1; return originalFetch(...args); };
  const progress = [];
  const installed = await manager.installNodusLocalRuntime((n) => progress.push(n));
  assert.equal(installed.runtime.ready, true);
  assert.equal(installed.runtime.diagnostics.legacy, false);
  assert.equal(progress.at(-1), 1);
  assert.ok(requests > 0, 'the real pinned archives were downloaded');
  assert.equal(installed.runtime.diagnostics.offloadedLayers, null, 'probing is not model offload');
  if (installed.runtime.diagnostics.backend !== 'cpu') assert.ok(installed.runtime.diagnostics.devices.length > 0);
  assert.equal(await readFile(sentinel, 'utf8'), 'this model must never be replaced by an engine update');
  assert.equal(await readFile(legacy, 'utf8'), 'legacy-marker-not-executed');
  requests = 0;
  const warm = await manager.installNodusLocalRuntime();
  assert.equal(warm.runtime.ready, true);
  assert.equal(requests, 0, 'checking an installed engine reuses verified archives/binaries');
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, version: installed.runtime.version,
    backend: installed.runtime.diagnostics.backend, devices: installed.runtime.diagnostics.devices,
    fallbackReason: installed.runtime.diagnostics.fallbackReason ?? null,
    detail: installed.runtime.diagnostics.detail ?? null,
    verified: ['actual archive checksums and extraction', 'native device probe', 'legacy upgrade', 'model preservation', 'offline warm recheck'] }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  manager?.killNodusLocalServerSync();
  await rm(profile, { recursive: true, force: true });
}
