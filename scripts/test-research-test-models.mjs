// An isolated test profile cannot reach a provider's model catalogue (the OS sandbox
// denies the network), so "Cargar modelos" lists exactly what the paid gate forwards.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-test-models-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'proxy.cjs');
await build({ entryPoints: [path.join(repo, 'electron/qa/researchProviderProxy.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { researchTestProviderModels } = createRequire(import.meta.url)(outfile);
const ids = (provider, kind) => researchTestProviderModels(provider, kind)?.map(model => model.id) ?? null;

test('outside an isolated run every provider lists its real catalogue', () => {
  delete process.env.NODUS_RESEARCH_PROVIDER_PROXY;
  assert.equal(ids('deepseek', 'chat'), null);
  assert.equal(ids('openrouter', 'embedding'), null);
});

test('inside an isolated run the gated providers list exactly the models the gate forwards', () => {
  process.env.NODUS_RESEARCH_PROVIDER_PROXY = 'http://127.0.0.1:1/00000000-0000-0000-0000-000000000000';
  try {
    const gate = fs.readFileSync(path.join(repo, 'scripts/research-provider-proxy.mjs'), 'utf8');
    const forwarded = Object.fromEntries([...gate.matchAll(/(deepseek|openrouter): \{ model: '([^']+)', route: '([^']+)'/g)].map(([, provider, model, route]) => [provider, { model, route }]));
    assert.deepEqual(forwarded, { deepseek: { model: 'deepseek-flash', route: '/chat/completions' }, openrouter: { model: 'baai/bge-m3', route: '/embeddings' } });
    assert.deepEqual(ids('deepseek', 'chat'), [forwarded.deepseek.model]);
    assert.deepEqual(ids('openrouter', 'embedding'), [forwarded.openrouter.model]);
    assert.deepEqual(ids('openrouter', 'chat'), [], 'OpenRouter chat is not forwarded');
    assert.equal(ids('openai', 'chat'), null, 'other providers keep their own behaviour');
  } finally { delete process.env.NODUS_RESEARCH_PROVIDER_PROXY; }
});
