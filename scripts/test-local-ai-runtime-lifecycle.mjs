import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimeModule, stubFile, until } from './local-ai-runtime-test-utils.mjs';

// Actual child processes and loopback HTTP, with only Electron and the tiny GGUF
// catalogue stubbed. These fixtures test orchestration, not physical GPU support.
async function fixture(t, scenario = 'normal') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-lifecycle-'));
  const policy = await loadRuntimeModule(t, 'electron/ai/localAiRuntimePolicy.ts');
  const variants = policy.runtimeVariants(process.platform, process.arch);
  const gpu = variants.find((v) => v.backend !== 'cpu');
  assert.ok(gpu);
  const rootAi = path.join(root, 'local-ai');
  const configuration = path.join(root, 'scenario.txt');
  const auditFile = path.join(root, 'audit.jsonl');
  await writeFile(configuration, scenario);
  const audit = async () => (await readFile(auditFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((s) => JSON.parse(s));
  const serverScript = await stubFile(root, 'server.mjs', `
    import http from 'node:http';
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    const value = (key) => args[args.indexOf(key) + 1];
    const scenario = fs.readFileSync(${JSON.stringify(configuration)}, 'utf8');
    const audit = (value) => fs.appendFileSync(${JSON.stringify(auditFile)}, JSON.stringify(value) + '\\n');
    if (args.includes('--list-devices')) {
      if (scenario !== 'cpu-only' && !process.argv[1].includes('cpu-')) console.log(${JSON.stringify(gpu.backend === 'metal' ? 'Metal' : 'Vulkan0')} + ': Fixture GPU (16384 MiB, 15000 MiB free)');
      process.exit(0);
    }
    if (args.includes('--version')) process.exit(0);
    const useGpu = value('--n-gpu-layers') !== '0';
    audit({ event: 'start', args, pid: process.pid });
    if (scenario === 'gpu-failure' && useGpu) { console.error('VK_ERROR_OUT_OF_DEVICE_MEMORY'); process.exit(1); }
    if (scenario === 'bad-model') { console.error('ggml_cuda: CUDA0 NVIDIA GPU\\nerror loading model: invalid GGUF header'); process.exit(1); }
    if (scenario === 'signal-exit') process.kill(process.pid, 'SIGTERM');
    console.error('load_tensors: offloaded ' + (useGpu ? '18' : '0') + '/18 layers to GPU');
    http.createServer((req, res) => {
      if (req.url === '/health') {
        if (scenario === 'hang-health') return;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return;
      }
      let body = '';
      req.on('data', (part) => body += part);
      req.on('end', () => {
        const input = JSON.parse(body || '{}');
        const synthetic = input.messages?.[0]?.content?.includes('runtime health calibration');
        audit({ event: 'request', synthetic: Boolean(synthetic), model: value('--alias') });
        if (synthetic && scenario === 'calibration-hang') return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      });
    }).listen(Number(value('--port')), '127.0.0.1');
  `);
  const engineRoot = path.join(rootAi, 'runtime-backends', policy.runtimeVersion(process.platform, process.arch), `${process.platform}-${process.arch}`);
  for (const variant of variants) {
    const destination = path.join(engineRoot, policy.variantId(variant));
    await mkdir(destination, { recursive: true });
    const executable = path.join(destination, 'llama-server');
    await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverScript)} "$@"\n`);
    await chmod(executable, 0o755);
    await writeFile(path.join(destination, 'complete.json'), JSON.stringify(variant.archives.map((a) => a.sha256)));
  }
  await writeFile(path.join(engineRoot, 'selection.json'), JSON.stringify(policy.variantId(gpu)));
  const bytes = Buffer.from('tiny-verified-model');
  const models = ['first', 'second'].map((id) => ({ id, label: id, kind: 'chat', runtime: 'llama_cpp', contextLength: 32768,
    modelFile: 'fixture.gguf', assets: [{ file: 'fixture.gguf', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] }));
  for (const model of models) {
    const destination = path.join(rootAi, 'models', model.id);
    await mkdir(destination, { recursive: true }); await writeFile(path.join(destination, model.modelFile), bytes);
  }
  const electron = await stubFile(root, 'electron.mjs', `export const app = { getPath: () => ${JSON.stringify(root)}, once() {} };`);
  const catalogue = await stubFile(root, 'catalogue.mjs', `
    export const NODUS_LOCAL_MODELS = ${JSON.stringify(models)};
    export const getNodusLocalModel = id => NODUS_LOCAL_MODELS.find(m => m.id === id);
    export const nodusLocalModelBytes = m => m.assets.reduce((sum,a)=>sum+a.bytes,0);
  `);
  const manager = await loadRuntimeModule(t, 'electron/ai/nodusLocalAi.ts', {
    plugins: [{ name: 'fixture-electron-and-models', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: electron }));
      b.onResolve({ filter: /^@shared\/localAiModels$/ }, () => ({ path: catalogue }));
    } }],
  });
  t.after(async () => { manager.killNodusLocalServerSync(); await rm(root, { recursive: true, force: true }); });
  return { root, rootAi, manager, audit, scenario: (next) => writeFile(configuration, next), engineRoot };
}
const posix = { skip: process.platform === 'win32' ? 'POSIX executable fixture; Windows loader/install behavior has a separate suite' : false, timeout: 20_000 };

test('real lifecycle: first inference preempts eight synthetic requests without poisoning calibration', posix, async (t) => {
  const f = await fixture(t, 'calibration-hang');
  const calibration = f.manager.calibrateDownloadedNodusLocalModels(['first', 'second']);
  await until(async () => (await f.audit()).filter((event) => event.synthetic).length === 8);
  const response = await f.manager.withNodusLocalServerLease('first', 'chat', async (apiUrl) => {
    const result = await fetch(`${apiUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
    return result.json();
  });
  await calibration;
  assert.equal(response.choices[0].message.content, 'ok');
  assert.ok(!(await f.audit()).some((event) => event.synthetic && event.model === 'second'), 'queued models were also cancelled');
  await assert.rejects(readFile(path.join(f.rootAi, 'calibration.json')), { code: 'ENOENT' });
  const status = await f.manager.getNodusLocalAiStatus();
  assert.equal(status.runtime.diagnostics.phase, 'running');
  assert.equal(status.runtime.diagnostics.offloadedLayers, 18);
  assert.equal(status.activeLeases, 0);
});

test('real lifecycle: foreground work cancels a hung health check during calibration', posix, async (t) => {
  const f = await fixture(t, 'hang-health');
  const calibration = f.manager.calibrateNodusLocalModelConcurrency('first');
  await until(async () => (await f.audit()).some((event) => event.event === 'start'));
  await f.scenario('normal');
  const api = await f.manager.ensureNodusLocalServer('first', 'chat');
  await calibration;
  assert.match(api, /\/v1$/);
  assert.equal((await f.manager.getNodusLocalAiStatus()).runtime.diagnostics.phase, 'running');
});

test('real lifecycle: CPU skips benchmarks; GPU startup retries CPU once, preserving context and offline mode', posix, async (t) => {
  const f = await fixture(t, 'cpu-only');
  await f.manager.calibrateNodusLocalModelConcurrency('first');
  assert.equal((await f.audit()).length, 0, 'CPU calibration sends no synthetic inference');
  assert.equal(JSON.parse(await readFile(path.join(f.rootAi, 'calibration.json'), 'utf8')).models.first.reason, 'cpu-single-slot');
  const g = await fixture(t, 'gpu-failure');
  const api = await g.manager.ensureNodusLocalServer('first', 'chat');
  assert.match(api, /\/v1$/);
  const starts = (await g.audit()).filter((event) => event.event === 'start');
  assert.equal(starts.length, 2);
  const value = (args, key) => args[args.indexOf(key) + 1];
  assert.equal(value(starts[0].args, '--n-gpu-layers'), 'auto');
  assert.equal(value(starts[1].args, '--n-gpu-layers'), '0');
  assert.equal(value(starts[1].args, '--device'), 'none');
  assert.ok(starts[1].args.includes('--no-mmproj-offload'));
  for (const start of starts) {
    assert.equal(value(start.args, '--ctx-size'), '32768');
    assert.ok(start.args.includes('--offline'));
    assert.equal(value(start.args, '--host'), '127.0.0.1');
  }
  const status = await g.manager.getNodusLocalAiStatus();
  assert.equal(status.runtime.diagnostics.backend, 'cpu');
  assert.equal(status.runtime.diagnostics.offloadedLayers, 0);
  assert.equal(status.runtime.diagnostics.fallbackReason, 'gpu-start-failed');
});

test('real lifecycle: model errors and signalled exits fail promptly rather than masquerading as missing CUDA', posix, async (t) => {
  const f = await fixture(t, 'bad-model');
  await assert.rejects(f.manager.ensureNodusLocalServer('first', 'chat'), /invalid GGUF/);
  assert.equal((await f.audit()).filter((event) => event.event === 'start').length, 1, 'no blind CPU retry for bad weights');
  assert.equal((await f.manager.getNodusLocalAiStatus()).runtime.diagnostics.phase, 'error');
  await f.scenario('signal-exit');
  await assert.rejects(f.manager.ensureNodusLocalServer('first', 'chat'), /SIGTERM/);
});

test('real lifecycle: missing executables are caught and model switches respect real leases', posix, async (t) => {
  const f = await fixture(t);
  const status = await f.manager.getNodusLocalAiStatus();
  await rm(status.runtime.executablePath);
  await assert.rejects(f.manager.ensureNodusLocalServer('first', 'chat'), /ENOENT/);
  const g = await fixture(t);
  let release;
  let entered = false;
  const lease = g.manager.withNodusLocalServerLease('first', 'chat', async () => {
    entered = true;
    await new Promise((resolve) => { release = resolve; });
  });
  await until(() => entered);
  let switched = false;
  const switching = g.manager.ensureNodusLocalServer('second', 'chat').then(() => { switched = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(switched, false);
  assert.equal((await g.manager.getNodusLocalAiStatus()).activeModelId, 'first');
  release(); await lease; await switching;
  assert.equal((await g.manager.getNodusLocalAiStatus()).activeModelId, 'second');
});
