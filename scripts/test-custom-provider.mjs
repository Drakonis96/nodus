// The "Custom (OpenAI-compatible)" provider: the user's own gateway (LiteLLM, vLLM,
// llama.cpp server, a proxy) instead of a vendor API.
//
// Drives the REAL electron/ai/providers.ts against a fake OpenAI-compatible server,
// with only the settings repository stubbed. Three properties matter and none of
// them is obvious:
//
//  1. The base URL is used verbatim. Every other provider in Nodus appends "/v1";
//     these gateways mount the API wherever they like, so appending anything would
//     break as many installs as it fixed.
//  2. The model list is the UNION of what the user typed and what the endpoint
//     reports — the manual half exists precisely for endpoints that report nothing.
//  3. An endpoint without GET /models must not break model selection. That is the
//     normal shape of several proxies, not an error state, so a throw there would
//     empty every model picker in the app for a setup that works fine.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-provider-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

// The settings stub reads a mutable global so each test can reconfigure the
// provider the way Settings would, without rebuilding the bundle.
const settingsStub = path.join(tmp, 'settings-stub.mjs');
await writeFile(settingsStub, 'export function getSettings() { return globalThis.__NODUS_SETTINGS__ ?? {}; }\n');
const localAiStub = path.join(tmp, 'nodusLocalAi-stub.mjs');
await writeFile(localAiStub, 'export async function listNodusLocalChatModels() { return []; }\nexport async function listNodusLocalEmbeddingModels() { return []; }\n');

const outfile = path.join(tmp, 'providers.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/providers.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  plugins: [{
    name: 'stub-deps',
    setup(b) {
      b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: settingsStub }));
      b.onResolve({ filter: /nodusLocalAi$/ }, () => ({ path: localAiStub }));
    },
  }],
});
const {
  customBaseUrl,
  customManualModels,
  listModels,
  normalizeCustomBaseUrl,
  normalizeCustomModels,
  normalizeCustomProviderConfig,
  openAiCompatBase,
  supportsJsonMode,
  testCustomProvider,
} = await import(pathToFileURL(outfile).href);

/** Configure the provider the way Settings → Providers would. */
function configure(baseUrl, models = []) {
  globalThis.__NODUS_SETTINGS__ = { customProvider: { baseUrl, models } };
}

/** A gateway. `catalogue: null` models the very common proxy with no GET /models. */
async function fakeGateway({ catalogue }) {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url, auth: request.headers.authorization ?? null });
    if (!request.url.endsWith('/models') || catalogue === null) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: catalogue.map((id) => ({ id })) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('the base URL is taken verbatim: only the trailing slash is normalised', () => {
  assert.equal(normalizeCustomBaseUrl('  http://localhost:8317/v1  '), 'http://localhost:8317/v1');
  assert.equal(normalizeCustomBaseUrl('http://localhost:8317/v1///'), 'http://localhost:8317/v1');
  // The path is the user's business: a gateway mounted at the root stays at the root,
  // and one under /openai/v1 keeps that prefix. Nodus must never append "/v1".
  assert.equal(normalizeCustomBaseUrl('http://gateway.lan:4000/'), 'http://gateway.lan:4000');
  assert.equal(normalizeCustomBaseUrl('https://proxy.example.com/openai/v1'), 'https://proxy.example.com/openai/v1');
  assert.equal(normalizeCustomBaseUrl(''), '');
  assert.equal(normalizeCustomBaseUrl(undefined), '');

  configure('http://localhost:8317/v1/');
  assert.equal(customBaseUrl(), 'http://localhost:8317/v1');
  assert.equal(openAiCompatBase('custom'), 'http://localhost:8317/v1', 'inference uses the configured base as-is');

  // Unconfigured must be null, NOT undefined: `new OpenAI({ baseURL: undefined })`
  // silently talks to api.openai.com, which is a provider the user never chose.
  configure('');
  assert.equal(openAiCompatBase('custom'), null);
  assert.equal(supportsJsonMode('custom'), true, 'JSON mode is part of the contract it claims to implement');
});

test('manual model slugs are trimmed, de-duplicated and keep their order', () => {
  assert.deepEqual(normalizeCustomModels(['  gemini-3.1-flash ', 'qwen3', 'gemini-3.1-flash', '', '   ']),
    ['gemini-3.1-flash', 'qwen3']);
  assert.deepEqual(normalizeCustomModels(undefined), []);
  assert.deepEqual(
    normalizeCustomProviderConfig({ baseUrl: 'http://x:1/v1/', models: ['a', 'a', ' b '] }),
    { baseUrl: 'http://x:1/v1', models: ['a', 'b'] },
  );
  assert.deepEqual(normalizeCustomProviderConfig(undefined), { baseUrl: '', models: [] });
});

test('listModels returns the union of the manual list and the endpoint catalogue', async () => {
  const gateway = await fakeGateway({ catalogue: ['served-a', 'served-b', 'typed-first'] });
  try {
    configure(`${gateway.origin}/v1`, ['typed-first', 'typed-only']);
    const models = await listModels('custom', null);
    assert.deepEqual(models.map((m) => m.id), ['typed-first', 'typed-only', 'served-a', 'served-b'],
      'manual slugs come first and win on collision; the remote half follows');
    assert.equal(gateway.seen.at(-1).url, '/v1/models', 'the catalogue is read from {baseUrl}/models');
    assert.equal(gateway.seen.at(-1).auth, null, 'no key configured means no Authorization header');

    const result = await testCustomProvider(null);
    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 4, 'the reported count is the union, not just the catalogue');
  } finally {
    await gateway.close();
  }
});

test('an endpoint without GET /models still selects models and says why', async () => {
  const gateway = await fakeGateway({ catalogue: null });
  try {
    configure(`${gateway.origin}/v1`, ['gemini-3.1-flash', 'qwen3-max']);
    // The whole point: a 404 catalogue is a normal proxy, not a broken provider.
    const models = await listModels('custom', null);
    assert.deepEqual(models.map((m) => m.id), ['gemini-3.1-flash', 'qwen3-max'],
      'model selection survives an endpoint with no catalogue');

    const result = await testCustomProvider(null);
    assert.equal(result.ok, false, 'the test reports the catalogue failure honestly');
    assert.match(result.message, /404/);
    assert.match(result.message, /2 modelos escritos a mano/, 'and says the manual list still works');
  } finally {
    await gateway.close();
  }
});

test('an unreachable or unconfigured endpoint never throws out of listModels', async () => {
  // Nothing is listening here; the manual list must still reach the pickers.
  configure('http://127.0.0.1:1/v1', ['typed-anyway']);
  assert.deepEqual((await listModels('custom', null)).map((m) => m.id), ['typed-anyway']);

  configure('', ['typed-anyway']);
  assert.deepEqual(customManualModels(), ['typed-anyway']);
  assert.deepEqual((await listModels('custom', null)).map((m) => m.id), ['typed-anyway'],
    'with no URL at all the manual list is the whole catalogue');
  assert.deepEqual(await testCustomProvider(null), { ok: false, message: 'Falta la dirección del servidor.' });

  configure('', []);
  assert.deepEqual(await listModels('custom', null), []);
});

test('a configured key travels as a bearer token', async () => {
  const gateway = await fakeGateway({ catalogue: ['served'] });
  try {
    configure(`${gateway.origin}/v1`, []);
    await listModels('custom', 'secret-token');
    assert.equal(gateway.seen.at(-1).auth, 'Bearer secret-token');
  } finally {
    await gateway.close();
  }
});

test('the endpoint is stored app-level, normalised on write, and shared by every vault', async () => {
  // Requires the real settings repository (SQLite + app-prefs.json), so it runs in
  // an Electron child the way test-model-prefs-recovery does. Two things are being
  // pinned: that what gets STORED is already normalised — Settings renders the
  // stored value straight back, and a trailing slash the user pasted should not
  // survive to be shown to them — and that the gateway is app-level, so configuring
  // it once does not have to be repeated in every vault.
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-persist-'));
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-userdata-'));
  try {
    const entry = path.join(workspace, 'entry.ts');
    const bundle = path.join(workspace, 'entry.cjs');
    await writeFile(entry, [
      `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
      `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
    ].join('\n'));
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
      `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`, '--external:better-sqlite3',
    ], { cwd: repoRoot, stdio: 'inherit' });

    const child = path.join(workspace, 'child.cjs');
    const resultFile = path.join(workspace, 'result.json');
    await writeFile(child, `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const Module = require('node:module');
      process.env.NODE_PATH = ${JSON.stringify(path.join(repoRoot, 'node_modules'))};
      Module._initPaths();
      const { registry, settingsRepo } = require(${JSON.stringify(bundle)});
      settingsRepo.updateSettings({ customProvider: { baseUrl: '  http://gateway.lan:4000/openai/v1//  ', models: [' a ', 'a', '', 'b'] } });
      const stored = settingsRepo.getSettings().customProvider;
      const prefs = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(userData)}, 'app-prefs.json'), 'utf8'));
      registry.createVault('Second vault');
      const inSecondVault = settingsRepo.getSettings().customProvider;
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ stored, inPrefsFile: prefs.customProvider, inSecondVault }));
    `);
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [child], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
      stdio: 'inherit',
    });

    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    const expected = { baseUrl: 'http://gateway.lan:4000/openai/v1', models: ['a', 'b'] };
    assert.deepEqual(result.stored, expected, 'the stored value is already normalised');
    assert.deepEqual(result.inPrefsFile, expected, 'it lands in app-prefs.json, not only in the vault');
    assert.deepEqual(result.inSecondVault, expected, 'a newly created vault inherits the same gateway');
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
