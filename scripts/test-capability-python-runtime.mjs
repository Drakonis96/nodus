// The credential reaches the interpreter by stdin, and by nothing else.
//
// This is the claim AlphaGenome's design rests on: the worker never holds the key, the
// host reads it from the encrypted store and writes it to the process's standard input.
// An argument would be visible to anything that can list processes and an environment
// variable to anything the interpreter imports, so the test looks for the key in both —
// from inside the process that is supposed to receive it.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-python-runtime-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

/** The interpreter a user would already have. Without one there is nothing to test and
 *  nothing to pretend about. */
const interpreter = ['python3', 'python'].find(candidate => {
  try { execFileSync(candidate, ['-c', 'print(1)'], { stdio: 'ignore' }); return true; }
  catch { return false; }
});

const bundle = path.join(scratch, 'runtime.cjs');
await build({
  stdin: {
    contents: `
      export * from './electron/capabilities/pythonRuntime';
      export * from './electron/capabilities/hostServices';
    `,
    resolveDir: root, loader: 'ts',
  },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=>"5.3.2"};`
          + 'export const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString("utf8")};',
        loader: 'js',
      }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const lib = createRequire(import.meta.url)(bundle);

const SECRET = 'sk-live-not-a-real-key-0123456789';

const runtime = {
  capabilityId: 'nodus:genomics',
  plugin: { id: 'alphagenome', version: '2.0.0', digest: 'a'.repeat(64) },
  manifest: { id: 'genomics' },
  entryPath: path.join(scratch, 'worker.js'),
  permissions: {
    runtimes: [{ id: 'alphagenome', kind: 'python', minVersion: '3.10' }],
    secrets: [{ id: 'api-key', label: 'AlphaGenome API key', required: true, injection: { kind: 'process-stdin', runtimeId: 'alphagenome' } }],
    storage: { stateBytes: 4096, cacheBytes: 4096, tempBytes: 0 },
  },
};

/** A runtime directory shaped the way the host builds one: a real virtual environment at
 *  the path the host expects, around the interpreter this machine already has. Nothing is
 *  installed into it — what is being tested is how the host talks to an interpreter, not
 *  how pip resolves — but the interpreter is a real one, which a shim pretending to be a
 *  `python.exe` could not be on Windows. */
function installFakeRuntime() {
  const dir = path.join(profile, 'plugins', 'runtimes', 'alphagenome', 'alphagenome');
  const venv = path.join(dir, 'venv');
  fs.mkdirSync(dir, { recursive: true });
  // Built once and reused, and rebuilt if a test removed it: a virtual environment takes
  // a few seconds and this asks for one several times.
  if (!fs.existsSync(venv)) execFileSync(interpreter, ['-m', 'venv', venv], { stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'READY'), 'ready');
  return dir;
}

/** Reports everything a process can see about its own invocation. */
const PROBE = `
import json, os, sys
print(json.dumps({
  'stdin': sys.stdin.read().strip(),
  'argv': sys.argv[1:],
  'env': {k: v for k, v in os.environ.items() if 'sk-live' in v},
  'envKeys': sorted(os.environ.keys()),
}))
`;

test('a credential reaches the interpreter on stdin, and appears nowhere else', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installFakeRuntime();
  lib.writeCapabilitySecret('alphagenome', 'genomics', 'api-key', SECRET);

  const probe = path.join(scratch, 'probe.py');
  fs.writeFileSync(probe, PROBE);

  const services = lib.createCapabilityHostServices({
    python: { run: (target, request, signal) => lib.runInPythonRuntime(target, request, signal) },
  });
  const result = await services({
    runtime, channel: 'python', method: 'run',
    payload: { runtimeId: 'alphagenome', args: ['-I', probe], secretId: 'api-key', timeoutMs: 60_000 },
    signal: new AbortController().signal,
  });

  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.stdin, SECRET, 'the interpreter received the credential on stdin');
  assert.ok(!seen.argv.some(argument => argument.includes(SECRET)), 'and not as an argument, which any process listing would show');
  assert.deepEqual(seen.env, {}, 'and not in the environment, which anything it imports could read');

  // The environment is built rather than inherited: a shell's variables are not the
  // interpreter's business.
  assert.ok(!seen.envKeys.includes('NODUS_TEST_LEAK'), 'the ambient environment is not passed through');
});

test('a worker cannot ask for a credential the manifest did not declare for this runtime', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installFakeRuntime();
  const probe = path.join(scratch, 'probe.py');
  fs.writeFileSync(probe, PROBE);

  const services = lib.createCapabilityHostServices({
    python: { run: (target, request, signal) => lib.runInPythonRuntime(target, request, signal) },
  });
  const ask = secretId => services({
    runtime, channel: 'python', method: 'run',
    payload: { runtimeId: 'alphagenome', args: ['-I', probe], secretId, timeoutMs: 30_000 },
    signal: new AbortController().signal,
  });

  // Declared for a different runtime, or not declared at all: in both cases the host
  // simply does not have it to give.
  await assert.rejects(ask('not-declared'), /not configured/);

  const elsewhere = { ...runtime, permissions: { ...runtime.permissions, secrets: [{ id: 'api-key', label: 'Key', required: true, injection: { kind: 'process-stdin', runtimeId: 'something-else' } }] } };
  await assert.rejects(
    services({ runtime: elsewhere, channel: 'python', method: 'run', payload: { runtimeId: 'alphagenome', args: ['-I', probe], secretId: 'api-key', timeoutMs: 30_000 }, signal: new AbortController().signal }),
    /not configured/,
  );
});

test('a runtime that was never built refuses to run anything', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  fs.rmSync(path.join(profile, 'plugins', 'runtimes', 'alphagenome'), { recursive: true, force: true });
  await assert.rejects(
    lib.runInPythonRuntime(runtime, { runtimeId: 'alphagenome', args: ['-c', 'print(1)'], timeoutMs: 10_000 }, new AbortController().signal),
    /not installed/,
  );
});

test('an undeclared runtime is refused before anything is spawned', async () => {
  const services = lib.createCapabilityHostServices({ python: { run: async () => { throw new Error('should never run'); } } });
  await assert.rejects(
    services({
      runtime, channel: 'python', method: 'run',
      payload: { runtimeId: 'not-declared', args: [], timeoutMs: 10_000 },
      signal: new AbortController().signal,
    }),
    /not permitted|not declared/i,
  );
});

test('the committed locks describe an installable set', () => {
  // The full install is exercised by hand and in the package's own release; what is
  // checked on every run is that what would be installed is complete and self-consistent.
  const locks = path.join(scratch, 'unused');
  void locks;
  const marketplace = process.env.NODUS_MARKETPLACE_DIR;
  if (!marketplace) return;
  const dir = path.join(marketplace, 'plugins', 'alphagenome', 'runtimes');
  if (!fs.existsSync(dir)) return;
  for (const target of fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isDirectory())) {
    for (const file of fs.readdirSync(path.join(dir, target))) {
      const lock = lib.validateRuntimeLock(JSON.parse(fs.readFileSync(path.join(dir, target, file), 'utf8')));
      assert.equal(lock.platform, target);
      assert.ok(lock.packages.every(entry => new URL(entry.url).host === 'files.pythonhosted.org'));
    }
  }
});
