// A documented context window must be found under every name the provider accepts for the
// model. DeepSeek's /models reports no windows, and `deepseek-v4-flash` (a legacy name for
// `deepseek-flash`) used to fall back to 32k, so a synthesis prompt was refused as too large.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Keep the Server catalogue contract in the root CI test discovery as well.
import '../server/test/providerModelCatalog.test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-context-windows-'));
test.after(() => rm(dir, { recursive: true, force: true }));
const outfile = path.join(dir, 'windows.mjs');
await build({ entryPoints: [path.join(root, 'shared/providerContextWindows.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { documentedContextWindow } = await import(pathToFileURL(outfile).href);

test('every DeepSeek name for a documented model gets its 1M window', () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro']) {
    assert.equal(documentedContextWindow('deepseek', model), 1_000_000, model);
  }
});

test('an undocumented model or provider gets no guess', () => {
  assert.equal(documentedContextWindow('deepseek', 'deepseek-chat'), null);
  assert.equal(documentedContextWindow('openai', 'deepseek-flash'), null, 'the table is per provider');
  assert.equal(documentedContextWindow('nope', 'x'), null);
  assert.equal(documentedContextWindow('anthropic', 'claude-unknown'), null, 'a prefix alone cannot establish a window');
  assert.equal(documentedContextWindow('anthropic', 'claude-2.0'), null, 'older Claude windows must not inherit current limits');
});

test('verified Claude models keep their documented window without catalogue discovery', () => {
  for (const model of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-6']) {
    assert.equal(documentedContextWindow('anthropic', model), 1_000_000, model);
  }
  assert.equal(documentedContextWindow('anthropic', 'claude-haiku-4-5'), 200_000);
  assert.equal(documentedContextWindow('anthropic', 'claude-haiku-4-5-20251001'), 200_000);
  assert.equal(documentedContextWindow('openrouter', 'anthropic/claude-opus-5-5'), null);
});

test('OpenAI exact IDs, snapshots and aliases use verified limits, with no prefix guesses', () => {
  for (const id of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6', 'gpt-5.6-terra', 'gpt-5.5-2026-04-23']) {
    assert.equal(documentedContextWindow('openai', id), 1_050_000, id);
  }
  assert.equal(documentedContextWindow('openai', 'gpt-5.4-mini-2026-03-17'), 400_000);
  assert.equal(documentedContextWindow('openai', 'gpt-4.1'), 1_047_576);
  assert.equal(documentedContextWindow('openai', 'gpt-4o-2024-08-06'), 128_000);
  for (const id of ['gpt-6-future', 'gpt-5.4-2099-01-01', 'ft:gpt-4o:custom']) {
    assert.equal(documentedContextWindow('openai', id), null, id);
  }
  assert.equal(documentedContextWindow('codex', 'gpt-6-sol'), null, 'subscription runtime limits are independent');
});

test('MiMo and OpenCode Go limits stay provider-specific, including separate input ceilings', () => {
  assert.equal(documentedContextWindow('xiaomi', 'mimo-v2.6-pro'), 1_000_000);
  assert.equal(documentedContextWindow('opencode-go', 'mimo-v2.6-pro'), 1_048_576);
  assert.equal(documentedContextWindow('opencode-go', 'gpt-6-luna'), 922_000);
  assert.equal(documentedContextWindow('opencode-go', 'space-bunny-free'), 524_288);
  assert.equal(documentedContextWindow('opencode-go', 'deepseek-v4-pro'), 1_000_000);
  assert.equal(documentedContextWindow('custom', 'mimo-v2.6-pro'), null);
  assert.equal(documentedContextWindow('xiaomi', 'mimo-future'), null);
  for (const provider of ['constructor', '__proto__', 'toString']) {
    assert.equal(documentedContextWindow(provider, 'x'), null);
  }
  assert.equal(documentedContextWindow('deepseek', 'constructor'), null);
});
