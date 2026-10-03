import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const dir = await mkdtemp(path.join(os.tmpdir(), 'thinking-compatibility-'));
const output = path.join(dir, 'compatibility.mjs');
await build({ stdin: { contents: `export * from './electron/ai/thinkingCompatibility'; export * from './electron/ai/providerErrors'; export * from './shared/researchReasoning';`, resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', alias: { '@shared': path.resolve('shared') } });
const { withThinkingCompatibility: run, compatibleThinkingBody: shape, rememberThinkingCatalog, researchReasoningBody: research, researchReasoningProfile: profile, rejectsThinkingOff, thinkingOffReplacement } = await import(pathToFileURL(output));
test.after(() => rm(dir, { recursive: true, force: true }));
const ref = (provider, model) => ({ provider, model });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sonnetMessage = 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.';
const envelope = { type: 'error', error: { type: 'invalid_request_error', message: sonnetMessage } };
const base = { model: 'fixture', messages: [{ role: 'user', content: 'Keep this prompt' }], max_tokens: 4096, response_format: { type: 'json_object' } };

test('extracts the replacement from real SDK errors, structured payloads, and serialized errors', () => {
  const actual = Anthropic.APIError.generate(400, envelope, undefined, {});
  for (const error of [actual, fail(actual.message), { status: 400, error: { message: sonnetMessage } }]) {
    assert.equal(rejectsThinkingOff(error), true);
    assert.equal(thinkingOffReplacement(error), 'between_tools');
  }
  assert.equal(thinkingOffReplacement(fail('Use "thinking.type.adaptive" to control thinking.')), 'adaptive');
  assert.equal(thinkingOffReplacement(fail(sonnetMessage.replaceAll('between_tools', 'invented_mode'))), null);
  for (const [status, message] of [[500, sonnetMessage], [429, 'Reasoning is mandatory'], [400, 'reasoning_content is required in history'], [400, 'thinking block signature is required'], [400, 'Invalid model'], [400, 'Invalid temperature']]) {
    assert.equal(rejectsThinkingOff(fail(message, status)), false, message);
  }
});

test('known Claude models use valid off settings before the first attempt, preserving enabled efforts', () => {
  for (const [model, type] of [['claude-sonnet-5-5', 'between_tools'], ['claude-sonnet-5.5-20260928', 'between_tools'], ['claude-opus-5-5', 'adaptive'], ['claude-fable-5-1', 'adaptive'], ['claude-mythos-preview', 'adaptive'], ['claude-opus-4-6', 'disabled'], ['claude-sonnet-4-5', 'disabled']]) {
    assert.deepEqual(research(ref('anthropic', model), 'standard', 4096).thinking, { type }, model);
  }
  for (const effort of ['low', 'high', 'xhigh', 'max']) {
    const body = research(ref('anthropic', 'claude-sonnet-5-5'), effort, 4096);
    assert.deepEqual(body.thinking, { type: 'adaptive' });
    assert.equal(body.output_config.effort, effort);
  }
});

test('provider metadata removes impossible opt-outs and chooses the lowest published effort', () => {
  const model = ref('openrouter', 'vendor/mandatory-catalogue');
  const info = { id: model.model, reasoningMandatory: true, researchReasoningLevels: ['high', 'medium'] };
  rememberThinkingCatalog(model.provider, [info]);
  assert.deepEqual(shape(model, { reasoning: { enabled: false, exclude: true } }), { reasoning: { effort: 'medium', exclude: true } });
  assert.deepEqual(research(model, 'standard', 4096, info), { reasoning: { effort: 'medium' } });
  assert.deepEqual(profile(model, info).levels, ['high', 'medium']);
  assert.deepEqual(shape(model, { reasoning: { effort: 'high' } }), { reasoning: { effort: 'high' } });
  for (const id of ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-fable-5.1']) {
    assert.deepEqual(research(ref('openrouter', id), 'standard', 4096), { reasoning: { effort: 'low' } });
  }
});

test('an accepted disabled setting survives unchanged on every compatible provider', async () => {
  for (const provider of ['anthropic', 'deepseek', 'xiaomi', 'openrouter', 'custom', 'opencode-go']) {
    const model = ref(provider, 'accepts-disabled');
    const body = { ...base, ...(provider === 'openrouter' ? { reasoning: { enabled: false } } : { thinking: { type: 'disabled' } }) };
    let calls = 0;
    assert.equal(await run(model, body, async sent => { calls++; assert.deepEqual(sent, body); return 'ok'; }), 'ok');
    assert.equal(calls, 1);
  }
});

test('native rejection replays the named type, retains JSON/prompt/budget, and learns only the off contract', async () => {
  const model = ref('anthropic', 'future-claude');
  const body = { ...base, thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
  const seen = [];
  await run(model, body, async sent => { seen.push(sent); if (sent.thinking.type === 'disabled') throw Anthropic.APIError.generate(400, envelope, undefined, {}); return 'ok'; });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], { ...body, thinking: { type: 'between_tools' } });
  assert.deepEqual(shape(model, body), seen[1]);
  const enabled = { ...body, thinking: { type: 'adaptive' }, output_config: { effort: 'max' } };
  assert.deepEqual(shape(model, enabled), enabled);
  assert.equal(shape(ref('anthropic', 'other-model'), body).thinking.type, 'disabled');
  assert.equal(shape(ref('custom', model.model), body).thinking.type, 'disabled');
});

test('mandatory reasoning recovers typed toggles, unified controls, and effort opt-outs', async () => {
  const cases = [
    ['deepseek', { thinking: { type: 'disabled' } }, { thinking: { type: 'enabled' }, reasoning_effort: 'low' }],
    ['xiaomi', { thinking: { type: 'disabled' } }, { thinking: { type: 'enabled' } }],
    ['custom', { reasoning_effort: 'none' }, { reasoning_effort: 'low' }],
    ['openrouter', { reasoning: { enabled: false, exclude: true } }, { reasoning: { effort: 'low', exclude: true } }],
    ['opencode-go', { reasoning: { effort: 'none' } }, { reasoning: { effort: 'low' } }],
  ];
  for (const [provider, control, expected] of cases) {
    const model = ref(provider, 'future-mandatory'); let calls = 0;
    await run(model, { ...base, ...control }, async sent => { calls++; if (calls === 1) throw fail('Reasoning is mandatory on this model', 422); assert.deepEqual(sent, { ...base, ...expected }); return 'ok'; });
    assert.equal(calls, 2);
    assert.deepEqual(shape(model, { ...base, ...control }), { ...base, ...expected });
  }
});

test('compatible effort refusals use the published replacement, including Groq toggle defaults', async () => {
  for (const [provider, model, wording, effort] of [
    ['openai', 'gpt-5.4', "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'high', 'medium'.", 'medium'],
    ['groq', 'qwen3-32b', 'reasoning_effort none is not supported', 'default'],
    ['cerebras', 'qwen3.8', 'Cannot disable reasoning on this model', 'low'],
  ]) {
    const seen = [];
    await run(ref(provider, model), { ...base, reasoning_effort: 'none' }, async sent => {
      seen.push(sent); if (seen.length === 1) throw fail(wording); return 'ok';
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1].reasoning_effort, effort);
  }
  const seen = [];
  await run(ref('anthropic', 'future-adaptive'), { ...base, thinking: { type: 'disabled' } }, async sent => {
    seen.push(sent); if (seen.length === 1) throw fail('Thinking is mandatory. Use "thinking.type.adaptive" to control thinking.'); return 'ok';
  });
  assert.deepEqual(seen[1].output_config, { effort: 'low' });
});

test('endpoint changes isolate catalogues and successful learning; failed HTTP results are not learned', async () => {
  const model = ref('custom', 'shared-model-id');
  const body = { ...base, reasoning_effort: 'none' };
  const first = 'http://first.test/v1'; const second = 'http://second.test/v1';
  let calls = 0;
  await run(model, body, async () => { if (++calls === 1) throw fail('Reasoning is mandatory'); return 'ok'; }, { endpoint: first });
  assert.equal(shape(model, body, undefined, first).reasoning_effort, 'low');
  assert.deepEqual(shape(model, body, undefined, second), body);
  rememberThinkingCatalog('custom', [{ id: model.model, reasoningMandatory: true, researchReasoningLevels: ['high'] }], second);
  assert.equal(shape(model, body, undefined, second).reasoning_effort, 'high');
  assert.deepEqual(shape(model, body, undefined, 'http://third.test/v1'), body);
  const failedModel = ref('opencode-go', 'failed-http-replay');
  calls = 0;
  await run(failedModel, body, async () => { if (++calls === 1) throw fail('Reasoning is mandatory'); return { ok: false }; }, { isSuccess: response => response.ok });
  assert.deepEqual(shape(failedModel, body), body);
});

test('temperature and disabled can be rejected in either order, with a bounded three-attempt recovery', async () => {
  for (const order of ['temperature-first', 'thinking-first']) {
    const model = ref('anthropic', order);
    const body = { ...base, temperature: .15, thinking: { type: 'disabled' } };
    const seen = [];
    await run(model, body, async sent => {
      seen.push(sent);
      const temperature = () => { if ('temperature' in sent) throw fail('temperature is not supported'); };
      const thinking = () => { if (sent.thinking.type === 'disabled') throw fail(sonnetMessage); };
      if (order === 'temperature-first') { temperature(); thinking(); } else { thinking(); temperature(); }
      return 'ok';
    });
    assert.equal(seen.length, 3);
    assert.deepEqual(seen[2], { ...base, thinking: { type: 'between_tools' } });
    assert.deepEqual(shape(model, body), seen[2]);
  }
});

test('failed replays do not poison the session, and refusals are never retried indefinitely', async () => {
  const model = ref('custom', 'stubborn'); const body = { ...base, reasoning_effort: 'none' };
  let calls = 0;
  await assert.rejects(run(model, body, async () => { calls++; throw fail('Cannot disable reasoning for this model'); }));
  assert.equal(calls, 2);
  assert.deepEqual(shape(model, body), body);
});

test('noRetry, cancellation, partial streams, and unrelated failures stop recovery', async () => {
  const body = { ...base, thinking: { type: 'disabled' } };
  const controller = new AbortController(); controller.abort();
  for (const [name, options, error] of [
    ['single-attempt', { noRetry: true }, fail(sonnetMessage)],
    ['aborted', { signal: controller.signal }, fail(sonnetMessage)],
    ['partial-stream', { canReplay: () => false }, fail(sonnetMessage)],
    ['unrelated-400', {}, fail('Bad model')],
    ['unavailable', {}, fail(sonnetMessage, 503)],
  ]) {
    const model = ref('anthropic', name); let calls = 0;
    await assert.rejects(run(model, body, async () => { calls++; throw error; }, options));
    assert.equal(calls, 1, name);
    assert.deepEqual(shape(model, body), body, name);
  }
});
