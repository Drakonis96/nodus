// Opt-in network integration check. Downloads the actual checksum-pinned release
// archives through the production installer, not through a test downloader.
// --inference-smoke additionally loads a shipped small GGUF and completes a real
// request. This is a correctness check, not a GPU throughput benchmark.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-archive-check-'));
const stub = path.join(tmp, 'electron.mjs');
const expectIncompatible = process.argv.includes('--expect-incompatible-macos');
const inferenceSmoke = process.argv.includes('--inference-smoke');
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
  if (expectIncompatible) {
    // A separate negative compatibility test for the pre-existing upstream
    // macOS 14 dyld failure (#856), not a successful-installation exception.
    assert.equal(process.platform, 'darwin');
    assert.equal(process.arch, 'arm64');
    assert.match(os.release(), /^23\./, 'this expectation is specific to macOS 14');
    const legacy = path.join(tmp, 'local-ai', 'runtime', 'b10002', 'llama-server');
    const preserved = path.join(tmp, 'local-ai', 'models', 'preservation-sentinel.gguf');
    await mkdir(path.dirname(legacy), { recursive: true });
    await mkdir(path.dirname(preserved), { recursive: true });
    await writeFile(legacy, 'previous-runtime-sentinel');
    await writeFile(preserved, 'previous-model-sentinel');
    await assert.rejects(manager.installNodusLocalRuntime(), error => {
      assert.match(error.message, /NODUS_LOCAL_RUNTIME_MACOS_INCOMPATIBLE/);
      assert.match(error.message, /MTLResidencySetDescriptor/);
      return true;
    });
    assert.equal(await readFile(legacy, 'utf8'), 'previous-runtime-sentinel');
    assert.equal(await readFile(preserved, 'utf8'), 'previous-model-sentinel');
    assert.equal((await manager.getNodusLocalAiStatus()).runtime.diagnostics.upgradeRequired, true);
    console.log('Verified known macOS 14 incompatibility is reported and failed installation preserves existing files. This is NOT a successful runtime/inference test; see #856.');
  } else {
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
    if (inferenceSmoke) {
      const model = 'qwen3.5-0.8b-q4';
      await manager.downloadNodusLocalModel(model);
      // The same public entry called by automatic onboarding must not benchmark.
      await manager.calibrateNodusLocalModelConcurrency(model);
      await manager.withNodusLocalServerLease(model, 'chat', async base => {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 16, temperature: 0,
            chat_template_kwargs: { enable_thinking: false },
            messages: [{ role: 'user', content: 'Reply with OK.' }] }),
          signal: AbortSignal.timeout(180_000),
        });
        const payload = await response.text();
        assert.equal(response.ok, true, payload.slice(0, 1_000));
        const result = JSON.parse(payload);
        assert.equal(result.choices?.length, 1);
        assert.ok(result.usage?.completion_tokens > 0, 'the real model must generate tokens');
        assert.equal(await manager.ensureNodusLocalServer(model, 'chat'), base, 'warm requests retain /v1');
      });
      const active = await manager.getNodusLocalAiStatus();
      assert.equal(active.runtime.diagnostics.state, 'ready');
      assert.equal(active.activeSlots, 1);
      assert.equal(active.activeLeases, 0);
      console.log(JSON.stringify({ model, inference: 'passed', slots: active.activeSlots,
        backend: active.runtime.diagnostics.backend, offloadedLayers: active.runtime.diagnostics.offloadedLayers }));
    }
    console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, version: status.runtime.version,
      backend: status.runtime.diagnostics.backend, devices: status.runtime.diagnostics.devices,
      fallbackReason: status.runtime.diagnostics.fallbackReason,
      scope: inferenceSmoke ? 'Real pinned archives plus shipped GGUF/model-projector loading and one real inference request. Not a throughput benchmark.'
        : 'Real archives, SHA-256, extraction, executable startup and device probe. No model inference benchmark.' }, null, 2));
  }
} finally {
  manager?.killNodusLocalServerSync();
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
