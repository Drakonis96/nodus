// A documented context window must be found under every name the provider accepts for the
// model. DeepSeek's /models reports no windows, and `deepseek-v4-flash` (a legacy name for
// `deepseek-flash`) used to fall back to 32k, so a synthesis prompt was refused as too large.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
});

test('the research budget reads the documented window before its fallback', async () => {
  const source = await readFile(path.join(root, 'electron/ai/aiClient.ts'), 'utf8');
  const body = source.slice(source.indexOf('export async function researchModelContextWindow'));
  assert.ok(body.indexOf('documentedContextWindow(model.provider, model.model)') < body.indexOf('tokens: 32768'));
});

test('Claude models on Anthropic get at least a 200K window; other providers are untouched', () => {
  assert.equal(documentedContextWindow('anthropic', 'claude-opus-5-5'), 200_000);
  assert.equal(documentedContextWindow('anthropic', 'claude-haiku-4-5-20251001'), 200_000);
  assert.equal(documentedContextWindow('openrouter', 'anthropic/claude-opus-5-5'), null);
});
