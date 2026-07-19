// Failure paths of the subscription-backed providers.
//
// The happy paths are covered by test-codex-subscription.mjs and
// test-subscription-providers.mjs, which is precisely why every defect these tests
// pin down survived review: a crashed runtime, a timeout, an interrupted turn, an
// error arriving inside a 200 stream. Each test here corresponds to a fix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-subscription-failures-'));
const bundle = path.join(outDir, 'failure-paths.cjs');
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(entry, [
  `export { CodexAppServerClient } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/codexAppServerClient.ts'))};`,
  `export { runIsolatedCodexCompletion } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/codexCompletion.ts'))};`,
  `export { classifyProviderError, ProviderRuntimeError } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/providerErrors.ts'))};`,
  `export { completeWithOpenCodeGo } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'))};`,
  `export { supportsSamplingControls } from ${JSON.stringify(path.join(repoRoot, 'shared/providers.ts'))};`,
].join('\n'));
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=es2022',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const {
  CodexAppServerClient,
  runIsolatedCodexCompletion,
  classifyProviderError,
  ProviderRuntimeError,
  completeWithOpenCodeGo,
  supportsSamplingControls,
} = require(bundle);

// Several tests deliberately leave a runtime wedged or respawned. Any survivor keeps
// the event loop alive and the whole file would then die on the harness timeout
// rather than reporting its results, so every client is force-killed at the end.
const spawned = [];
test.after(() => {
  for (const runtime of spawned) {
    try { runtime.killNow(); } catch { /* already gone */ }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
});

/** Write an executable fake app server and return its path. */
function fakeServer(name, body) {
  const file = path.join(outDir, `${name}.mjs`);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}`);
  fs.chmodSync(file, 0o755);
  return file;
}

function client(binaryPath, requestTimeoutMs) {
  const runtime = new CodexAppServerClient({
    binaryPath,
    codexHome: path.join(outDir, 'home'),
    appVersion: '0.0.0-test',
    requestTimeoutMs,
    env: { ...process.env },
  });
  spawned.push(runtime);
  return runtime;
}

const INITIALIZE = `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\\n');
`;

test('an error message classifies the same in Spanish and in English', () => {
  // The original regex used the Spanish spelling `autentic`, which shares no
  // substring with the English `authentication` the vendor runtimes actually emit,
  // so real auth failures were never flagged as configuration problems.
  for (const message of [
    'authentication failed for this account',
    'Request was unauthorized',
    'Conecta primero tu cuenta de GitHub Copilot en Proveedores y modelos.',
    'La suscripción de ChatGPT no está conectada.',
  ]) {
    const verdict = classifyProviderError(new Error(message));
    assert.equal(verdict.config, true, `should be a config error: ${message}`);
    assert.equal(verdict.retriable, false, `auth is never worth an automatic retry: ${message}`);
  }

  for (const message of ['rate limit exceeded', 'Se alcanzó el límite del plan', 'connection reset by peer']) {
    const verdict = classifyProviderError(new Error(message));
    assert.equal(verdict.retriable, true, `should be retriable: ${message}`);
    assert.equal(verdict.config, false);
  }

  const unknown = classifyProviderError(new Error('something entirely unexpected'));
  assert.equal(unknown.retriable, false);
  assert.equal(unknown.config, false);
});

test('a typed provider error outranks whatever its message happens to say', () => {
  // The runtime's own timeout text mentions no keyword the heuristic would catch;
  // before the type existed it was reported as permanent and never retried.
  const timeout = classifyProviderError(
    new ProviderRuntimeError('Codex no respondió a «turn/start».', 'timeout')
  );
  assert.deepEqual(timeout, {
    message: 'Codex no respondió a «turn/start».',
    retriable: true,
    config: false,
  });

  const auth = classifyProviderError(new ProviderRuntimeError('nada reconocible', 'auth'));
  assert.equal(auth.config, true);
  assert.equal(auth.retriable, false);

  const invalid = classifyProviderError(new ProviderRuntimeError('modelo no soportado', 'invalid'));
  assert.equal(invalid.retriable, false);
  assert.equal(invalid.config, false);
});

test('a runtime that dies mid-request rejects as retriable instead of hanging', async () => {
  const server = fakeServer('crash-midway', `${INITIALIZE}
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { reply(msg.id, {}); continue; }
  if (msg.method === 'initialized') continue;
  process.exit(9); // die while a request is in flight
}`);
  const runtime = client(server, 5_000);
  await assert.rejects(
    () => runtime.request('turn/start', {}),
    (error) => {
      const verdict = classifyProviderError(error);
      assert.equal(verdict.retriable, true, 'a crashed runtime is a transient failure');
      assert.match(error.message, /se cerró inesperadamente/);
      return true;
    }
  );
  await runtime.stop();
});

test('a silent runtime times out as retriable rather than as a permanent error', async () => {
  const server = fakeServer('never-answers', `${INITIALIZE}
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { reply(msg.id, {}); continue; }
  // Everything else is swallowed on purpose.
}`);
  const runtime = client(server, 250);
  await assert.rejects(
    () => runtime.request('turn/start', {}),
    (error) => {
      assert.equal(classifyProviderError(error).retriable, true);
      assert.match(error.message, /tiempo esperado/);
      return true;
    }
  );
  await runtime.stop();
});

test('a JSON-RPC response split across writes is still parsed', async () => {
  // readline reassembles across chunk boundaries; a hand-rolled buffer would not.
  const server = fakeServer('split-writes', `${INITIALIZE}
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialized') continue;
  const payload = JSON.stringify({ id: msg.id, result: { ok: true, value: 'reassembled' } });
  const cut = Math.floor(payload.length / 2);
  process.stdout.write(payload.slice(0, cut));
  await new Promise((r) => setTimeout(r, 20));
  process.stdout.write(payload.slice(cut) + '\\n');
}`);
  const runtime = client(server, 5_000);
  const result = await runtime.request('probe', {});
  assert.deepEqual(result, { ok: true, value: 'reassembled' });
  await runtime.stop();
});

test('a server-initiated request is refused without crashing the process', async () => {
  // This reply is one of the writes that had no error handling on stdin.
  // The probe reply is deferred until the refusal has actually arrived: the client
  // sends its next request as soon as initialize resolves, so answering eagerly
  // would race the refusal and report a false negative.
  const server = fakeServer('asks-for-tools', `${INITIALIZE}
let refusal = null;
let pendingProbe = null;
const flush = () => {
  if (pendingProbe !== null && refusal !== null) { reply(pendingProbe, { refusal }); pendingProbe = null; }
};
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    reply(msg.id, {});
    process.stdout.write(JSON.stringify({ id: 9001, method: 'tool/execute', params: {} }) + '\\n');
    continue;
  }
  if (msg.method === 'initialized') continue;
  if (msg.id === 9001) { refusal = msg; flush(); continue; }
  if (msg.method === 'probe') { pendingProbe = msg.id; flush(); }
}`);
  const runtime = client(server, 5_000);
  const seen = await runtime.request('probe', {});
  assert.equal(seen.refusal?.error?.code, -32601, 'the runtime is told tools are unavailable');
  await runtime.stop();
});

test('writing to a runtime that already exited does not raise an uncaught error', async () => {
  // Without a stdin 'error' listener this EPIPE is an uncaught exception, which in
  // the real app takes down the whole Electron main process.
  const server = fakeServer('exits-immediately', `${INITIALIZE}
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { reply(msg.id, {}); continue; }
}`);
  const runtime = client(server, 200);
  await runtime.request('initialize-probe', {}).catch(() => undefined);

  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    // Force the pipe shut underneath the client, then keep writing to it.
    runtime.child?.kill?.('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let i = 0; i < 5; i++) await runtime.request('probe', {}).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    process.off('uncaughtException', onUncaught);
  }
  assert.deepEqual(uncaught, [], 'a dead pipe must never surface as an uncaught exception');
  await runtime.stop();
});

test('stop() escalates to SIGKILL when the runtime ignores SIGTERM', async () => {
  // `child.killed` means "a signal was sent", so testing it here made the escalation
  // unreachable in exactly the case it exists for.
  const server = fakeServer('ignores-sigterm', `${INITIALIZE}
process.on('SIGTERM', () => { /* deliberately ignored */ });
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { reply(msg.id, {}); continue; }
}
await new Promise(() => {}); // never exit on its own`);
  const runtime = client(server, 2_000);
  await runtime.request('initialize-probe', {}).catch(() => undefined);
  const child = runtime.child;
  assert.ok(child?.pid, 'the runtime is live before stopping');

  await runtime.stop();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'the runtime was actually terminated');
});

test('cancelling a turn settles immediately instead of waiting for the timeout', async () => {
  // The runtime is not obliged to emit turn/completed after an interrupt. Waiting
  // for one meant a cancel could hold the caller for the full 180s cap.
  const calls = [];
  const controller = new AbortController();
  const transport = {
    isRunning: () => true,
    request: async (method, params) => {
      calls.push(method);
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') return { turn: { id: 'turn-1' } };
      return {};
    },
    onNotification: (handler) => {
      // Stream a little, then go silent forever.
      setTimeout(() => handler('item/agentMessage/delta', { threadId: 'thread-1', delta: 'parcial' }), 10);
      setTimeout(() => controller.abort(), 30);
      return () => undefined;
    },
  };

  const started = Date.now();
  const answer = await runIsolatedCodexCompletion(transport, {
    model: 'gpt-test',
    system: 'sys',
    user: 'usr',
    reasoning: null,
    workdir: outDir,
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  assert.equal(answer, 'parcial', 'the caller keeps whatever had already streamed');
  assert.ok(Date.now() - started < 3_000, 'cancelling does not wait out the turn timeout');
  assert.ok(calls.includes('turn/interrupt'), 'the runtime is told to stop working');
});

test('teardown of a dead runtime issues no requests that would respawn it', async () => {
  // Every transport request goes through ensureStarted(), so an unguarded cleanup
  // call after a crash restarts the entire Codex process to tidy up a dead thread.
  const calls = [];
  let alive = true;
  const transport = {
    isRunning: () => alive,
    request: async (method) => {
      calls.push(method);
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') { alive = false; throw new Error('el runtime murió'); }
      return {};
    },
    onNotification: () => () => undefined,
  };

  await assert.rejects(() => runIsolatedCodexCompletion(transport, {
    model: 'gpt-test',
    system: 'sys',
    user: 'usr',
    reasoning: null,
    workdir: outDir,
    timeoutMs: 5_000,
  }));
  assert.equal(calls.includes('thread/unsubscribe'), false, 'no cleanup call revives a dead runtime');
});

test('the JSON retry ladder does not repeat identical requests on subscription providers', () => {
  // The ladder escalates by lowering temperature and dropping JSON mode. Codex and
  // Copilot honour neither, so every rung would bill an identical subscription turn.
  assert.equal(supportsSamplingControls('openai'), true);
  assert.equal(supportsSamplingControls('opencode-go'), true);
  assert.equal(supportsSamplingControls('ollama'), true);
  assert.equal(supportsSamplingControls('codex'), false);
  assert.equal(supportsSamplingControls('github-copilot'), false);
});

/** Start a throwaway OpenCode Go stand-in on an ephemeral port. */
async function openCodeServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

test('an error inside a 200 stream is retriable, not permanent', async () => {
  // response.status is 200 by the time an inline error arrives, so passing it
  // through classified every mid-stream overload as a permanent failure.
  const server = await openCodeServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"hola"}}]}\n\n');
    res.write('data: {"error":{"type":"overloaded_error","message":"upstream saturado"}}\n\n');
    res.end();
  });
  try {
    await assert.rejects(
      () => completeWithOpenCodeGo({
        apiKey: 'k', model: 'gpt-test', system: 's', user: 'u',
        baseUrl: server.url, onDelta: () => {},
      }),
      (error) => {
        assert.equal(error.status, 529, 'an overload maps to a retriable status');
        return true;
      }
    );
  } finally {
    await server.close();
  }
});

test('a rate limit inside a 200 stream maps to 429', async () => {
  const server = await openCodeServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"error":{"type":"rate_limit_error","message":"slow down"}}\n\n');
    res.end();
  });
  try {
    await assert.rejects(
      () => completeWithOpenCodeGo({
        apiKey: 'k', model: 'gpt-test', system: 's', user: 'u',
        baseUrl: server.url, onDelta: () => {},
      }),
      (error) => { assert.equal(error.status, 429); return true; }
    );
  } finally {
    await server.close();
  }
});

test('the chosen reasoning effort actually reaches the request body', async () => {
  // It was declared, threaded through aiClient, and then never read.
  let seen = null;
  const server = await openCodeServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  try {
    await completeWithOpenCodeGo({
      apiKey: 'k', model: 'gpt-test', system: 's', user: 'u',
      reasoning: 'high', baseUrl: server.url,
    });
    assert.equal(seen.reasoning_effort, 'high');

    await completeWithOpenCodeGo({
      apiKey: 'k', model: 'gpt-test', system: 's', user: 'u',
      reasoning: 'off', baseUrl: server.url,
    });
    assert.equal('reasoning_effort' in seen, false, '`off` asks for no reasoning at all');
  } finally {
    await server.close();
  }
});

test('a model that rejects the optional params is retried without them', async () => {
  // Every other provider degrades this way; this branch returned before reaching
  // the shared fallback, so one picky model turned into a hard failure.
  const bodies = [];
  const server = await openCodeServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      if (body.response_format || body.reasoning_effort) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unsupported parameter' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  try {
    const result = await completeWithOpenCodeGo({
      apiKey: 'k', model: 'gpt-test', system: 's', user: 'u',
      jsonMode: true, reasoning: 'high', baseUrl: server.url,
    });
    assert.equal(result.text, '{"ok":true}');
    assert.equal(bodies.length, 2, 'exactly one retry');
    assert.ok(bodies[0].response_format, 'the first attempt is optimistic');
    assert.equal(bodies[1].response_format, undefined, 'the retry drops the optional params');
    assert.equal(bodies[1].reasoning_effort, undefined);
  } finally {
    await server.close();
  }
});

test('jsonMode is honoured on the Messages route instead of being ignored', async () => {
  // minimax/qwen go over /v1/messages, which has no response_format — the flag was
  // simply dropped there, so the same call behaved differently per model family.
  let seen = null;
  const server = await openCodeServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }));
    });
  });
  try {
    await completeWithOpenCodeGo({
      apiKey: 'k', model: 'qwen3.5-plus', system: 'instrucciones', user: 'u',
      jsonMode: true, baseUrl: server.url,
    });
    assert.match(seen.system, /valid JSON/, 'the JSON contract is stated in the prompt');
    assert.match(seen.system, /^instrucciones/, 'the original system prompt is preserved');
  } finally {
    await server.close();
  }
});
