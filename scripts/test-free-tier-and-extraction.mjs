// Locks in the two behaviours added for the local-extraction / free-tier work:
//  1. Only extraction-capable models pass the gate that guards the extraction / basic-mode roles.
//  2. Groq free-tier max_tokens shaping caps to the per-minute budget and refuses (0) when the
//     prompt alone overflows it — the check the scan pipeline turns into an actionable error.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// providers.ts imports two electron-only modules at the top level; we only exercise its pure
// helpers, so replace those exact specifiers with an empty module. '@shared/*' resolves via alias.
const stubElectronDeps = {
  name: 'stub-electron-deps',
  setup(builder) {
    builder.onResolve({ filter: /(^\.\.\/db\/|nodusLocalAi$|^electron$)/ }, (args) =>
      args.kind === 'entry-point' ? null : { path: args.path, namespace: 'stub' });
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default {}; export const getSettings = () => ({}); export const listNodusLocalChatModels = () => []; export const listNodusLocalEmbeddingModels = () => [];',
      loader: 'js',
    }));
  },
};

async function load(entry) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-ft-'));
  const outfile = path.join(tmp, 'mod.mjs');
  await build({
    entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node',
    logLevel: 'silent', alias: { '@shared': path.join(root, 'shared') }, plugins: [stubElectronDeps],
  });
  return import(pathToFileURL(outfile).href);
}

test('extraction gate: Gemma passes, the small vision models are blocked, cloud passes', async () => {
  const m = await load('shared/localAiModels.ts');
  assert.equal(m.nodusLocalModelSupportsExtraction('gemma-4-e2b-q4'), true);
  assert.equal(m.nodusLocalModelSupportsExtraction('qwen3.5-0.8b-q4'), false);
  assert.equal(m.nodusLocalModelSupportsExtraction('lfm2.5-vl-1.6b-q4'), false);
  // embedding models can't chat → not extraction-capable
  assert.equal(m.nodusLocalModelSupportsExtraction('bge-m3-q8_0'), false);
  // unknown ids default permissive (don't lock out a future model)
  assert.equal(m.nodusLocalModelSupportsExtraction('some-future-model'), true);

  assert.equal(m.modelRefSupportsExtraction({ provider: 'nodus', model: 'qwen3.5-0.8b-q4' }), false);
  assert.equal(m.modelRefSupportsExtraction({ provider: 'nodus', model: 'gemma-4-e2b-q4' }), true);
  assert.equal(m.modelRefSupportsExtraction({ provider: 'openai', model: 'gpt-4o' }), true);
  assert.equal(m.modelRefSupportsExtraction(null), true);
  assert.equal(m.NODUS_DEFAULT_EXTRACTION_MODEL_ID, 'gemma-4-e2b-q4');
});

test('groq free-tier max_tokens: caps to budget, refuses when prompt overflows, non-groq untouched', async () => {
  const m = await load('electron/ai/providers.ts');
  // 70b (12000 TPM): a ~5500-token chunk leaves room → positive cap, below the ask.
  const cap70b = m.freeTierMaxTokens('groq', 'llama-3.3-70b-versatile', 5500, 8000);
  assert.ok(cap70b > 0 && cap70b < 8000, `expected a positive sub-8000 cap, got ${cap70b}`);
  // 8b (6000 TPM): the prompt alone eats the budget → 0 (caller refuses actionably).
  assert.equal(m.freeTierMaxTokens('groq', 'llama-3.1-8b-instant', 5500, 8000), 0);
  // A small prompt on 8b still fits.
  assert.ok(m.freeTierMaxTokens('groq', 'llama-3.1-8b-instant', 1000, 8000) > 0);
  // Non-groq free providers are token-uncapped (their limit is per-request) → keep the ask.
  assert.equal(m.freeTierMaxTokens('openrouter', 'anything', 5500, 8000), 8000);
  // Groq reasoning-model detection drives the reasoning_effort:'low' scan tweak.
  assert.equal(m.isGroqReasoningModel('openai/gpt-oss-20b'), true);
  assert.equal(m.isGroqReasoningModel('llama-3.1-8b-instant'), false);
});
