// End-to-end validation of the custom (OpenAI-compatible) provider against the real engine
// and the small model Nodus itself ships.
//
// The custom provider is the one surface Nodus does not own: the user points it at their own
// server, so its request contract, its latency and its locality are all theirs. Issue #802
// reported two failures from exactly there, and both are protocol-level, which is why they
// can be reproduced with a small model behind the same shape of gateway:
//
//  1. the completion was cut at the cloud ceiling (180 s) because `custom` was not read as
//     an on-device provider, so a local server died on every long extraction chunk;
//  2. a gateway that refuses the optional request body with a bare 400 (no field named) got
//     no replay at all when the request carried `response_format` — the field every JSON
//     call carries — so the whole library ended on "the provider rejected the request (400)".
//
// This harness starts the llama.cpp the app installs, serving Gemma 4 E2B, puts an optional
// gateway in front of it that answers the way the reporter's did, and then runs the real
// application (through scripts/e2e-local-ai-extraction.mjs) over one or two arXiv papers —
// one at a time, never in parallel — with embeddings on BGE-M3 through the integrated runtime.
//
// Usage:
//   node scripts/e2e-custom-provider-local-model.mjs [--gateway=pass|json|reasoning|delay]
//     [--paper-ids=1512.03385,1412.6980] [--papers=<dir>] [--models=gemma]
//     [--delay-ms=190000] [--delay-calls=1] [--ctx=32768]
//     [--engine=<llama-server>] [--model=<gguf>] [--mmproj=<gguf>] [--model-id=<slug>]
//     [--userdata=<dir>] [--report=<file>] [--retry-rounds=2]
//
// `--gateway=json`      refuses any body carrying `response_format`, with an empty 400 body.
// `--gateway=reasoning` refuses any body carrying `reasoning_effort`, the same way.
// `--gateway=delay`     holds the body of the first `--delay-calls` non-streaming calls for
//                       `--delay-ms`, so a call that outlives the old 180 s ceiling is
//                       proven to have survived rather than inferred from a constant.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => {
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const gatewayMode = arg('--gateway', 'pass');
assert.ok(['pass', 'json', 'reasoning', 'delay'].includes(gatewayMode), `--gateway desconocido: ${gatewayMode}`);
const delayMs = Number(arg('--delay-ms', '190000'));
const delayCalls = Number(arg('--delay-calls', '1'));
const contextSize = Number(arg('--ctx', '32768'));
const modelId = arg('--model-id', 'gemma-4-e2b-q4');
const paperIds = arg('--paper-ids', '1512.03385,1412.6980');
const papersDirectory = arg('--papers', path.join(root, 'audit', 'local-ai-gpu', 'papers'));
const retryRounds = arg('--retry-rounds', '2');
// The section-and-audit passes of the document index are minutes per work on a GPU and the
// better part of an hour through a serial gateway on a laptop, so the run gets room for them.
const documentIndexTimeoutMs = arg('--docindex-timeout-ms', String(3 * 60 * 60 * 1000));
// Everything the app installs lives under its own userData. Pointing the run at that profile
// is what lets a throwaway profile reuse the engine and the models without a 4.6 GB download.
const installedProfile = arg(
  '--from-profile',
  path.join(os.homedir(), 'Library', 'Application Support', 'Nodus', 'local-ai'),
);

const log = (message) => console.log(`[e2e-custom] ${message}`);

async function findFile(directory, wanted) {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, wanted);
      if (nested) return nested;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port nothing is listening on, taken by binding one and letting it go. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(label, probe, { timeout = 300_000, interval = 1_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando: ${label}${last ? ` (último: ${JSON.stringify(last)})` : ''}`);
}

// ── The engine and the model the app itself installs ────────────────────────
const engine = arg('--engine', await findFile(path.join(installedProfile, 'runtime'), 'llama-server'));
const modelFile = arg('--model', path.join(installedProfile, 'models', modelId, 'gemma-4-E2B_q4_0-it.gguf'));
const projectorFile = arg('--mmproj', path.join(installedProfile, 'models', modelId, 'gemma-4-E2B-it-mmproj.gguf'));
if (!engine || !existsSync(engine)) throw new Error(`Falta el motor llama-server: ${engine ?? '(no encontrado)'}`);
if (!existsSync(modelFile)) throw new Error(`Falta el modelo: ${modelFile}`);
log(`engine ${engine}`);
log(`model  ${modelFile}${existsSync(projectorFile) ? ` (+ ${path.basename(projectorFile)})` : ''}`);

for (const id of paperIds.split(',').map((entry) => entry.trim()).filter(Boolean)) {
  const file = path.join(papersDirectory, `${id}.pdf`);
  if (!existsSync(file)) throw new Error(`Falta el PDF del corpus: ${file}`);
}

// ── llama-server, with the same flags the app passes ========================
const enginePort = await freePort();
const engineArgs = [
  '--model', modelFile,
  '--alias', modelId,
  '--host', '127.0.0.1',
  '--port', String(enginePort),
  '--ctx-size', String(contextSize),
  '--parallel', '1',
  '--threads', String(Math.max(1, Math.min(8, os.cpus().length - 1))),
  '-lv', '4',
  '--jinja',
  '--metrics',
  '--no-webui',
];
if (process.platform === 'darwin') engineArgs.push('--n-gpu-layers', '999');
if (existsSync(projectorFile)) engineArgs.push('--mmproj', projectorFile);

log(`starting llama-server on 127.0.0.1:${enginePort} (ctx ${contextSize})`);
const engineLog = [];
const engineProcess = spawn(engine, engineArgs, { cwd: path.dirname(engine), stdio: ['ignore', 'pipe', 'pipe'] });
const capture = (chunk) => {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    engineLog.push(line);
    if (engineLog.length > 400) engineLog.shift();
  }
};
engineProcess.stdout.on('data', capture);
engineProcess.stderr.on('data', capture);
let engineExit = null;
engineProcess.on('exit', (code) => { engineExit = code; });

const engineBase = `http://127.0.0.1:${enginePort}`;
try {
  await waitFor('llama-server /health', async () => {
    if (engineExit !== null) throw new Error(`llama-server terminó con código ${engineExit}\n${engineLog.slice(-15).join('\n')}`);
    try {
      const response = await fetch(`${engineBase}/health`);
      return response.ok;
    } catch {
      return null;
    }
  }, { timeout: 180_000, interval: 500 });
} catch (error) {
  engineProcess.kill('SIGKILL');
  throw error;
}
log('llama-server is ready');

// ── The gateway in front of it ==============================================
//
// A pass-through unless the run asked for a refusal or a delay. Refusals are deliberately
// opaque — `res.end()` with no body at all — because that is the shape that used to defeat
// the recovery: the OpenAI SDK reports it as "400 status code (no body)" and nothing in the
// message names the field the gateway disliked.
const gatewayStats = { requests: 0, chat: 0, refused: 0, refusedFields: {}, delayed: 0 };
let delaysSpent = 0;
const gateway = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    gatewayStats.requests += 1;
    const isChat = (request.url ?? '').includes('/chat/completions');
    let parsed = null;
    if (isChat && body.length) {
      try { parsed = JSON.parse(body.toString('utf8')); } catch { parsed = null; }
    }
    if (parsed) gatewayStats.chat += 1;

    const refuses = (field) => {
      gatewayStats.refused += 1;
      gatewayStats.refusedFields[field] = (gatewayStats.refusedFields[field] ?? 0) + 1;
      log(`gateway refused a request carrying ${field} (opaque 400)`);
      response.writeHead(400);
      response.end();
    };
    if (parsed && gatewayMode === 'json' && 'response_format' in parsed) return refuses('response_format');
    if (parsed && gatewayMode === 'reasoning' && 'reasoning_effort' in parsed) return refuses('reasoning_effort');

    const shouldDelay = gatewayMode === 'delay' && parsed && parsed.stream !== true && delaysSpent < delayCalls;
    if (shouldDelay) {
      delaysSpent += 1;
      gatewayStats.delayed += 1;
      log(`gateway holding the response body for ${delayMs} ms (call ${delaysSpent}/${delayCalls})`);
    }
    const forward = () => {
      const upstream = httpRequest({
        hostname: '127.0.0.1',
        port: enginePort,
        path: request.url,
        method: request.method,
        headers: request.headers,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', (error) => {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: `gateway: ${String(error)}` } }));
      });
      upstream.end(body);
    };
    if (shouldDelay) setTimeout(forward, delayMs);
    else forward();
  });
});
const gatewayPort = await freePort();
await new Promise((resolve) => gateway.listen(gatewayPort, '127.0.0.1', resolve));
const gatewayBase = `http://127.0.0.1:${gatewayPort}/v1`;
log(`gateway (${gatewayMode}) on ${gatewayBase}`);

// ── Setup check: the engine answers through the gateway =====================
// Cheap enough to run before a validation pass that costs the better part of an hour, so a
// mistyped path or a port that never came up is found in seconds instead of at minute forty.
if (process.argv.includes('--smoke')) {
  const ask = async (extra) => {
    const response = await fetch(`${gatewayBase}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 24,
        messages: [{ role: 'user', content: 'Answer with the single word: ok' }],
        ...extra,
      }),
    });
    return { status: response.status, body: (await response.text()).slice(0, 160) };
  };
  log(`smoke plain           -> ${JSON.stringify(await ask({}))}`);
  log(`smoke response_format -> ${JSON.stringify(await ask({ response_format: { type: 'json_object' } }))}`);
  log(`smoke reasoning_effort-> ${JSON.stringify(await ask({ reasoning_effort: 'none' }))}`);
  log(`gateway: ${gatewayStats.chat} chat requests, ${gatewayStats.refused} refused (${JSON.stringify(gatewayStats.refusedFields)})`);
  await new Promise((resolve) => gateway.close(resolve));
  engineProcess.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => engineProcess.on('exit', resolve)), sleep(3_000)]);
  if (engineProcess.exitCode === null && engineProcess.signalCode === null) engineProcess.kill('SIGKILL');
  process.exit(0);
}

// ── A throwaway profile that reuses the installed engine ====================
const userData = arg('--userdata', await fsp.mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-custom-')));
await fsp.mkdir(userData, { recursive: true });
const linkedLocalAi = path.join(userData, 'local-ai');
if (!existsSync(linkedLocalAi)) {
  // The engine and the models are 4.6 GB; the run needs them (embeddings are BGE-M3 through
  // the integrated runtime) but must not inherit the profile's settings, so they are linked
  // into a throwaway profile instead of downloaded again.
  await fsp.symlink(installedProfile, linkedLocalAi, 'dir');
  log(`linked ${installedProfile} -> ${linkedLocalAi}`);
}
const reportPath = arg('--report', path.join(os.tmpdir(), `nodus-e2e-custom-${Date.now()}`, 'report.json'));

// ── The real pipeline, driven by the extraction harness =====================
const harnessArgs = [
  path.join(root, 'scripts', 'e2e-local-ai-extraction.mjs'),
  '--provider=custom',
  `--base-url=${gatewayBase}`,
  `--model-id=${modelId}`,
  `--paper-ids=${paperIds}`,
  `--papers=${papersDirectory}`,
  `--models=${arg('--models', 'gemma')}`,
  `--retry-rounds=${retryRounds}`,
  `--docindex-timeout-ms=${documentIndexTimeoutMs}`,
  `--userdata=${userData}`,
  `--report=${reportPath}`,
  '--skip-download',
  '--serial',
];
log(`running the extraction pipeline: node ${harnessArgs.slice(1).join(' ')}`);
const harness = spawn(process.execPath, harnessArgs, { cwd: root, stdio: 'inherit' });
const exitCode = await new Promise((resolve) => harness.on('exit', (code, signal) => resolve(signal ? `signal ${signal}` : code ?? 1)));

// ── What the run proved =====================================================
const report = await fsp.readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null);
const consolePath = path.join(path.dirname(reportPath), 'app-console.log');
const consoleLog = await fsp.readFile(consolePath, 'utf8').catch(() => '');
// Two shapes reach the console: a scan call prints the work it belongs to between the label
// and the duration, a plain one does not.
const inferenceTimes = [...consoleLog.matchAll(/AI inference[^\n]*?(\d+)ms provider=/g)].map((match) => Number(match[1]));
const slowestInference = inferenceTimes.length ? Math.max(...inferenceTimes) : 0;

console.log('');
log(`exit=${exitCode}`);
log(`gateway: ${gatewayStats.chat} chat requests, ${gatewayStats.refused} refused (${JSON.stringify(gatewayStats.refusedFields)}), ${gatewayStats.delayed} delayed`);
log(`slowest single completion observed by the app: ${slowestInference} ms`);
if (report) {
  for (const [name, profile] of Object.entries(report.profiles)) {
    const works = profile.works ?? [];
    log(`profile ${name} (${profile.provider}:${profile.modelId}) ok=${profile.ok}`
      + ` works=${works.filter((work) => work.deep === 'done').length}/${works.length}`
      + ` ideas=${works.reduce((sum, work) => sum + (work.ideas ?? 0), 0)}`
      + ` embeddings=${profile.embeddings?.ideasEmbedded ?? 0}/${profile.embeddings?.totalIdeas ?? 0}`
      + ` passages=${profile.passageEmbeddings?.passagesEmbedded ?? 0}/${profile.passageEmbeddings?.totalPassages ?? 0}`
      + ` relations=${profile.relationEdges ?? 0}${profile.error ? ` ERROR=${profile.error}` : ''}`);
  }
}

const failures = [];
if (exitCode !== 0) failures.push(`el pipeline terminó con ${exitCode}`);
for (const [name, profile] of Object.entries(report?.profiles ?? {})) {
  if (profile.ok !== true) failures.push(`${name}: la ejecución no se completó`);
  const works = profile.works ?? [];
  if (!works.length || !works.every((work) => work.deep === 'done')) failures.push(`${name}: no todas las obras terminaron el análisis profundo`);
  if (!works.some((work) => (work.ideas ?? 0) > 0)) failures.push(`${name}: no se persistió ninguna idea`);
  if (profile.embeddings?.error) failures.push(`${name}: embeddings de ideas: ${profile.embeddings.error}`);
  if (profile.passageEmbeddings?.error) failures.push(`${name}: embeddings de pasajes: ${profile.passageEmbeddings.error}`);
}
if (gatewayMode === 'json' || gatewayMode === 'reasoning') {
  const field = gatewayMode === 'json' ? 'response_format' : 'reasoning_effort';
  if (!gatewayStats.refusedFields[field]) failures.push(`el gateway no llegó a rechazar ${field}: la recuperación no se ejercitó`);
  // The ladder is walked once per model and then remembered, so a run that completes should
  // have paid a handful of refusals, not one per chunk.
  if (gatewayStats.refused > 3) failures.push(`el gateway rechazó ${gatewayStats.refused} veces: la memoria de sesión no evitó la escalera`);
}
if (gatewayMode === 'delay' && slowestInference < delayMs) {
  failures.push(`ninguna llamada superó el retardo de ${delayMs} ms (la más lenta: ${slowestInference} ms)`);
}

// ── Teardown ================================================================
harness.kill?.('SIGTERM');
await new Promise((resolve) => gateway.close(resolve));
engineProcess.kill('SIGTERM');
await Promise.race([new Promise((resolve) => engineProcess.on('exit', resolve)), sleep(5_000)]);
if (engineProcess.exitCode === null && engineProcess.signalCode === null) engineProcess.kill('SIGKILL');

if (failures.length) {
  console.error(`\n[e2e-custom] FALLÓ:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
log('Custom provider validated end to end.');
