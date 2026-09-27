import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-runtime-provisioning-'));
const runtimes = path.join(scratch, 'runtimes');
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'runtime.cjs');
await build({
  entryPoints: [path.join(root, 'electron/capabilities/pythonRuntime.ts')], outfile,
  bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'profile', setup(api) {
    api.onResolve({ filter: /^\.\/pluginStoreV2$/ }, () => ({ path: 'store', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const pluginsRuntimesRoot=()=>${JSON.stringify(runtimes)};` }));
  } }],
});
const lib = createRequire(import.meta.url)(outfile);
const python = await lib.findSystemPython('3.10');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(id) {
  // A real, offline, dependency-free wheel: exercise venv + pip and the published interpreter.
  const zip = new AdmZip();
  const metadata = 'nodus_runtime_probe-1.0.dist-info';
  zip.addFile('nodus_runtime_probe/__init__.py', Buffer.from(`VALUE = ${JSON.stringify(id)}\n`));
  zip.addFile(`${metadata}/METADATA`, Buffer.from('Metadata-Version: 2.1\nName: nodus-runtime-probe\nVersion: 1.0\n'));
  zip.addFile(`${metadata}/WHEEL`, Buffer.from('Wheel-Version: 1.0\nGenerator: nodus-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n'));
  zip.addFile(`${metadata}/RECORD`, Buffer.from(''));
  const bytes = zip.toBuffer();
  const lock = { schemaVersion: 1, python: python.version.split('.').slice(0, 2).join('.'), platform: `${process.platform}-${process.arch}`, packages: [{
    name: 'nodus_runtime_probe-1.0-py3-none-any.whl', requirement: 'nodus-runtime-probe==1.0',
    url: 'https://example.test/probe.whl', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }] };
  const digest = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const runtime = name => ({ plugin: { id: `${id}-${name}` } });
  const context = { minVersion: '3.10', selectLock: () => lock, signal: new AbortController().signal, download: async () => bytes };
  return { bytes, lock, digest, runtime, context, directory: path.join(runtimes, 'shared', digest) };
}

for (const mode of ['success', 'failed-owner', 'cancelled-waiter']) {
  test(`concurrent provisioning: ${mode}`, { timeout: 90_000 }, async t => {
    if (!python) { t.skip('Python 3.10+ is unavailable'); return; }
    const f = fixture(mode);
    const entered = deferred(), release = deferred(), selected = deferred();
    let downloads = 0;
    const first = lib.ensurePythonRuntime(f.runtime('a'), 'probe', { ...f.context, download: async () => {
      downloads++; entered.resolve(); await release.promise;
      if (mode === 'failed-owner') throw new Error('temporary download failure');
      return f.bytes;
    } });
    await entered.promise;
    const controller = new AbortController();
    const second = lib.ensurePythonRuntime(f.runtime('b'), 'probe', { ...f.context, signal: controller.signal,
      selectLock: () => { selected.resolve(); return f.lock; },
      download: async () => { downloads++; return f.bytes; },
    });
    // Attach the rejection handler before cancelling; it must not affect the first caller.
    const secondResult = second.then(value => ({ value }), error => ({ error }));
    await selected.promise;
    await setImmediate();
    try {
      assert.equal(downloads, 1, 'the waiter must not build or download concurrently');
      if (mode === 'cancelled-waiter') controller.abort();
    } finally { release.resolve(); }
    const a = await first;
    const b = await secondResult;
    if (mode === 'failed-owner') {
      assert.equal(a.ready, false);
      assert.match(a.detail, /temporary download failure/);
      assert.equal(b.value.ready, true, b.value.detail);
      assert.equal(downloads, 2, 'a failed owner releases the queue so a waiter retries');
    } else {
      assert.equal(a.ready, true, a.detail);
      if (mode === 'cancelled-waiter') {
        assert.equal(b.error.name, 'AbortError');
        assert.ok(!fs.existsSync(path.join(runtimes, f.runtime('b').plugin.id, 'probe.json')));
      } else {
        assert.equal(b.value.ready, true, b.value.detail);
        for (const name of ['a', 'b']) assert.equal(JSON.parse(fs.readFileSync(path.join(runtimes, f.runtime(name).plugin.id, 'probe.json'))).lockDigest, f.digest);
      }
      assert.equal(downloads, 1);
    }
    const marker = path.join(f.directory, 'consumer-marker');
    fs.writeFileSync(marker, 'in use');
    const reused = await lib.ensurePythonRuntime(f.runtime('c'), 'probe', { ...f.context, download: async () => { throw new Error('must reuse'); } });
    assert.equal(reused.ready, true, reused.detail);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'in use', 'reuse preserves the ready directory');
    const result = await lib.runInPythonRuntime(f.runtime('c'), { runtimeId: 'probe', args: ['-I', '-c', 'import nodus_runtime_probe; print(nodus_runtime_probe.VALUE)'], timeoutMs: 10_000 }, f.context.signal);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), mode);
  });
}
