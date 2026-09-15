// Opt-in network integration check. Downloads the actual checksum-pinned release
// archives through the production installer, not through a test downloader.
// Does not download a model or claim to measure GPU inference performance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-archive-check-'));
const stub = path.join(tmp, 'electron.mjs');
let manager;
try {
  await writeFile(stub, `export const app = { getPath: () => ${JSON.stringify(tmp)}, once: () => {} };`);
  const outfile = path.join(tmp, 'manager.mjs');
  await build({ entryPoints: [path.join(repo, 'electron/ai/nodusLocalAi.ts')], outfile,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    tsconfig: path.join(repo, 'electron/tsconfig.json'), external: ['@huggingface/transformers'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{ name: 'isolated-profile', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: stub }));
    } }],
  });
  manager = await import(pathToFileURL(outfile).href);
  const progress = [];
  const status = await manager.installNodusLocalRuntime(value => progress.push(value));
  assert.equal(status.runtime.ready, true);
  assert.equal(status.runtime.diagnostics.upgradeRequired, false);
  assert.equal(status.runtime.diagnostics.state, 'installed');
  assert.equal(status.runtime.diagnostics.offloadedLayers, null, 'a device probe is not a model inference');
  assert.ok(progress.length > 1 && progress.at(-1) === 1);
  assert.ok(status.models.every(model => !model.downloaded), 'installation must not download GGUF models');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('status must not use the network'); };
    assert.equal((await manager.getNodusLocalAiStatus()).runtime.ready, true);
  } finally { globalThis.fetch = originalFetch; }
  console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, version: status.runtime.version,
    backend: status.runtime.diagnostics.backend, devices: status.runtime.diagnostics.devices,
    fallbackReason: status.runtime.diagnostics.fallbackReason,
    scope: 'Real archives, SHA-256, extraction, executable startup and device probe. No model inference benchmark.' }, null, 2));
} finally {
  manager?.killNodusLocalServerSync();
  await rm(tmp, { recursive: true, force: true });
}
