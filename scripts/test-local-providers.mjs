// Exercises the REAL local-provider plumbing in electron/ai/providers.ts against
// mock Ollama and LM Studio servers. Bundles the source with esbuild, stubbing
// only getSettings (so the module's single runtime dependency points the base
// URLs at our mock servers). Verifies model listing, embedding filtering, sort
// order, metadata mapping and the connection test — the wire contract that must
// match each provider's native API.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-providers-'));

// ── Mock servers ─────────────────────────────────────────────────────────────
function startServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const route = routes[req.url];
      if (!route) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(route));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const ollamaRoutes = {
  '/api/version': { version: '0.5.7' },
  '/api/tags': {
    models: [
      { name: 'zephyr:latest', model: 'zephyr:latest', size: 4_100_000_000, details: { parameter_size: '7B', quantization_level: 'Q4_0' } },
      { name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4_700_000_000, details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } },
      { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest', size: 274_000_000, details: { parameter_size: '137M', quantization_level: 'F16' } },
    ],
  },
};

const lmStudioRoutes = {
  '/api/v0/models': {
    data: [
      { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', arch: 'nomic-bert', state: 'not-loaded', max_context_length: 2048 },
      { id: 'qwen2.5-7b-instruct', type: 'llm', arch: 'qwen2', quantization: 'Q4_K_M', state: 'loaded', max_context_length: 32768, publisher: 'lmstudio-community' },
      { id: 'llava-v1.5-7b', type: 'vlm', arch: 'llama', state: 'not-loaded', max_context_length: 4096 },
    ],
  },
};

const ollama = await startServer(ollamaRoutes);
const lmstudio = await startServer(lmStudioRoutes);
const ollamaBase = `http://127.0.0.1:${ollama.address().port}`;
const lmstudioBase = `http://127.0.0.1:${lmstudio.address().port}`;

try {
  // ── Stub getSettings so localBaseUrl points at the mock servers ─────────────
  const stubPath = path.join(tmp, 'settingsRepo-stub.mjs');
  await writeFile(
    stubPath,
    `export function getSettings() {
       return { localProviders: {
         ollama: { baseUrl: ${JSON.stringify(ollamaBase)} },
         lmstudio: { baseUrl: ${JSON.stringify(lmstudioBase)} },
       } };
     }\n`
  );

  const outfile = path.join(tmp, 'providers.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/providers.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub-settings',
        setup(b) {
          b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: stubPath }));
        },
      },
    ],
  });
  const { listModels, listEmbeddingModels, testLocalProvider, isLocalProvider, openAiCompatBase } = await import(
    pathToFileURL(outfile).href
  );

  // ── Provider identity + base URL derivation ─────────────────────────────────
  assert.equal(isLocalProvider('ollama'), true, 'ollama is local');
  assert.equal(isLocalProvider('lmstudio'), true, 'lmstudio is local');
  assert.equal(isLocalProvider('openai'), false, 'openai is not local');
  assert.equal(openAiCompatBase('ollama'), `${ollamaBase}/v1`, 'ollama inference base is {url}/v1');
  assert.equal(openAiCompatBase('lmstudio'), `${lmstudioBase}/v1`, 'lmstudio inference base is {url}/v1');

  // ── Ollama: /api/tags → ModelInfo with metadata, alphabetical ───────────────
  const ollamaModels = await listModels('ollama', null);
  assert.deepEqual(
    ollamaModels.map((m) => m.id),
    ['llama3.1:8b', 'nomic-embed-text:latest', 'zephyr:latest'],
    'ollama models sorted by id'
  );
  const llama = ollamaModels.find((m) => m.id === 'llama3.1:8b');
  assert.equal(llama.paramSize, '8B', 'ollama param size mapped');
  assert.equal(llama.quantization, 'Q4_K_M', 'ollama quantization mapped');
  assert.equal(llama.sizeBytes, 4_700_000_000, 'ollama size mapped');

  // Embedding heuristic keeps only embed-looking models.
  const ollamaEmbeds = await listEmbeddingModels('ollama', null);
  assert.deepEqual(ollamaEmbeds.map((m) => m.id), ['nomic-embed-text:latest'], 'ollama embedding filter');

  // ── LM Studio: /api/v0/models → chat list excludes embeddings, loaded first ─
  const lmModels = await listModels('lmstudio', null);
  assert.deepEqual(
    lmModels.map((m) => m.id),
    ['qwen2.5-7b-instruct', 'llava-v1.5-7b'],
    'lmstudio chat list excludes embeddings and puts loaded first'
  );
  const qwen = lmModels.find((m) => m.id === 'qwen2.5-7b-instruct');
  assert.equal(qwen.loaded, true, 'lmstudio loaded state mapped');
  assert.equal(qwen.contextLength, 32768, 'lmstudio context length mapped');
  assert.equal(qwen.quantization, 'Q4_K_M', 'lmstudio quantization mapped');
  assert.equal(qwen.kind, 'llm', 'lmstudio kind mapped');

  const lmEmbeds = await listEmbeddingModels('lmstudio', null);
  assert.deepEqual(lmEmbeds.map((m) => m.id), ['text-embedding-nomic-embed-text-v1.5'], 'lmstudio embedding filter');
  assert.equal(lmEmbeds[0].kind, 'embeddings', 'lmstudio embedding kind');

  // ── Connection test ─────────────────────────────────────────────────────────
  const ollamaTest = await testLocalProvider('ollama', null);
  assert.equal(ollamaTest.ok, true, 'ollama test ok');
  assert.equal(ollamaTest.version, '0.5.7', 'ollama version reported');
  assert.equal(ollamaTest.modelCount, 3, 'ollama model count reported');

  const lmTest = await testLocalProvider('lmstudio', null);
  assert.equal(lmTest.ok, true, 'lmstudio test ok');
  assert.equal(lmTest.modelCount, 2, 'lmstudio chat-model count reported');

  // Unreachable host fails gracefully (not throw).
  const deadStub = path.join(tmp, 'settingsRepo-dead.mjs');
  await writeFile(
    deadStub,
    `export function getSettings() { return { localProviders: { ollama: { baseUrl: 'http://127.0.0.1:1' }, lmstudio: { baseUrl: 'http://127.0.0.1:1' } } }; }\n`
  );
  const deadOut = path.join(tmp, 'providers-dead.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/providers.ts')],
    outfile: deadOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: deadStub })); } }],
  });
  const dead = await import(pathToFileURL(deadOut).href);
  const deadTest = await dead.testLocalProvider('ollama', null);
  assert.equal(deadTest.ok, false, 'unreachable ollama returns ok:false');
  assert.ok(deadTest.message, 'unreachable ollama returns a message');

  console.log('local providers (ollama + lm studio) contract test passed');
} finally {
  ollama.close();
  lmstudio.close();
  await rm(tmp, { recursive: true, force: true });
}
