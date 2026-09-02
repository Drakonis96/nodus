/**
 * Opt-in live smoke for the native Ollama transport. It uses an already-installed
 * small model, never pulls one, runs sequentially, and unloads it on exit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = function loadTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { completeLocalNative, streamLocalNative } = require(path.join(root, 'electron/ai/localNativeCompletion.ts'));
const { buildLocalRequestPlan, localTaskOutputTokens } = require(path.join(root, 'electron/ai/localRequestPlanner.ts'));
const baseUrl = process.env.NODUS_OLLAMA_URL || 'http://127.0.0.1:11434';
const model = process.env.NODUS_OLLAMA_SMOKE_MODEL || 'qwen2.5:1.5b';

function estimatedTokens(...text) {
  return Math.ceil(text.join('\n').length / 3.2) + 16;
}

async function request(task, system, user, outputTokens) {
  const plan = buildLocalRequestPlan({
    provider: 'ollama', model, task, promptTokens: estimatedTokens(system, user),
    requestedOutputTokens: outputTokens, contextMode: 'auto', trainedContextTokens: 32768,
    nativeTransport: true,
  });
  const result = await completeLocalNative({
    provider: 'ollama', baseUrl, key: null, model, system, user, temperature: 0,
    contextTokens: plan.contextTokens, outputTokens: plan.outputTokens, jsonMode: true,
    deterministic: true, timeoutMs: 180_000,
  });
  const parsed = JSON.parse(result.text);
  return { plan, result, parsed };
}

try {
  const version = await fetch(`${baseUrl}/api/version`).then((response) => response.json());
  const installed = await fetch(`${baseUrl}/api/tags`).then((response) => response.json());
  assert.ok(installed.models?.some((entry) => entry.model === model || entry.name === model), `${model} is not installed; this smoke never downloads models`);

  const summary = await request(
    'summary',
    'Return only JSON matching {"summary":"one concise sentence"}.',
    'Summarize: Semantic retrieval finds related ideas using vector similarity.',
    localTaskOutputTokens('summary'),
  );
  assert.equal(typeof summary.parsed.summary, 'string');
  assert.ok(summary.parsed.summary.trim());

  const relations = await request(
    'relation-validation',
    'Return only JSON matching {"relations":[{"from":"a","to":"b","valid":true}]}.',
    JSON.stringify({ pairs: [{ from: 'a', statement: 'Plants need light.' }, { to: 'b', statement: 'Light supports photosynthesis.' }] }),
    localTaskOutputTokens('relation-validation', 1),
  );
  assert.ok(Array.isArray(relations.parsed.relations));

  const chapterIdeas = await request(
    'chapter-idea-extraction',
    'Return only JSON matching {"ideas":[{"type":"claim","label":"Light","statement":"Plants need light."}]}.',
    JSON.stringify({ fragmentos: [{ heading: 'Test', text: 'Plants need light to grow.' }] }),
    localTaskOutputTokens('chapter-idea-extraction', 1),
  );
  assert.ok(Array.isArray(chapterIdeas.parsed.ideas));
  assert.ok(chapterIdeas.parsed.ideas.length >= 1);

  const chapterRelations = await request(
    'chapter-relation-typing',
    'Return exactly one item and only JSON matching {"relations":[{"chapterIdeaId":"ci","targetKind":"idea","targetId":"g","relation":"supports","confidence":0.8,"rationale":"brief"}]}.',
    JSON.stringify({ ideas_manuscrito: [{ chapterIdeaId: 'ci', label: 'Light', statement: 'Plants need light.', candidatos: [{ targetKind: 'idea', targetId: 'g', texto: 'Light supports photosynthesis.' }] }] }),
    localTaskOutputTokens('chapter-relation-typing', 1),
  );
  assert.equal(chapterRelations.parsed.relations?.length, 1);

  const chatPlan = buildLocalRequestPlan({
    provider: 'ollama', model, task: 'chat', promptTokens: 64,
    requestedOutputTokens: 64, contextMode: 'auto', trainedContextTokens: 32768,
    nativeTransport: true,
  });
  let streamed = '';
  const chat = await streamLocalNative({
    provider: 'ollama', baseUrl, key: null, model, system: 'Answer briefly.', user: 'Say OK.',
    temperature: 0, contextTokens: chatPlan.contextTokens, outputTokens: chatPlan.outputTokens,
    jsonMode: false, timeoutMs: 180_000,
  }, (delta, kind) => { if (kind !== 'reasoning') streamed += delta; });
  assert.equal(streamed, chat.text);
  assert.ok(streamed.trim());

  const running = await fetch(`${baseUrl}/api/ps`).then((response) => response.json());
  const loaded = running.models?.find((entry) => entry.model === model || entry.name === model) ?? null;
  console.log(JSON.stringify({
    ok: true,
    ollama: version.version,
    model,
    summary: { context: summary.plan.contextTokens, outputLimit: summary.plan.outputTokens, actualOutput: summary.result.outputTokens },
    relations: { context: relations.plan.contextTokens, outputLimit: relations.plan.outputTokens, actualOutput: relations.result.outputTokens },
    chapterIdeas: { context: chapterIdeas.plan.contextTokens, outputLimit: chapterIdeas.plan.outputTokens, actualOutput: chapterIdeas.result.outputTokens },
    chapterRelations: { context: chapterRelations.plan.contextTokens, outputLimit: chapterRelations.plan.outputTokens, actualOutput: chapterRelations.result.outputTokens },
    stream: { context: chatPlan.contextTokens, outputLimit: chatPlan.outputTokens, actualOutput: chat.outputTokens },
    loaded: loaded && { context: loaded.context_length, sizeVram: loaded.size_vram, size: loaded.size },
  }, null, 2));
} finally {
  // Free RAM/VRAM even if an assertion fails.
  await fetch(`${baseUrl}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => undefined);
}
