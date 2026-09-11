import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-pipeline-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'pipeline.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/chatPipeline';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { runTrustedChatPipeline } = createRequire(import.meta.url)(bundle);

// ---------------------------------------------------------------- fake providers

const tool = (id, overrides = {}) => ({
  id, description: id, inputSchema: { type: 'object', additionalProperties: true },
  artifactTypes: [`${id}-result`], timeoutMs: 30_000, concurrency: 1, maxPerReply: 1,
  answerMode: 'replace-block', metered: false, ...overrides,
});

function provider({ id, priority, requests = [], legacy = [], hooks = {}, tools = [], artifacts = [] }) {
  return {
    id, version: '2.0.0', description: id, source: 'plugin',
    plugin: { id: id.replace(':', '-'), version: '2.0.0', digest: 'a'.repeat(64) },
    capabilityKey: id.split(':')[1],
    tools, artifacts,
    chat: { priority, requestProtocols: requests, legacyResults: legacy, hooks, pendingLabel: { en: 'Working…' } },
    hasSettings: false,
  };
}

function registryOf(...providers) {
  const map = new Map(providers.map(entry => [entry.id, entry]));
  const fences = new Map();
  for (const entry of providers) {
    for (const protocol of entry.chat.requestProtocols) fences.set(protocol.fence, { provider: entry, kind: 'request' });
    for (const legacy of entry.chat.legacyResults) fences.set(legacy.fence, { provider: entry, kind: 'legacy' });
  }
  return { providers: map, fences, chatOrder: [...providers].sort((a, b) => a.chat.priority - b.chat.priority), problems: [], revision: 1 };
}

/** Records everything the pipeline asked for, so ordering is observable. */
function runnerOf(overrides = {}) {
  const calls = [];
  return {
    calls,
    async invoke({ provider, toolId, input }) {
      calls.push(`invoke:${provider.id}:${toolId}`);
      if (overrides.invoke) return overrides.invoke({ provider, toolId, input });
      return { artifacts: [{ artifactType: `${toolId}-result`, artifactVersion: 1, summary: `${toolId} done`, data: input }] };
    },
    async hook({ provider, hook, nodes }) {
      calls.push(`hook:${provider.id}:${hook}`);
      return overrides.hook ? overrides.hook({ provider, hook, nodes }) : [];
    },
    async persistArtifact({ provider, artifact }) {
      calls.push(`persist:${provider.id}:${artifact.artifactType}`);
      return `\n\n[artifact ${artifact.artifactType} "${artifact.summary}"]\n\n`;
    },
    renderView({ provider, view }) {
      calls.push(`view:${provider.id}`);
      return `\n\n[view ${view.summary}]\n\n`;
    },
    async refineCoreSvg(answer) { calls.push('core:svg'); return overrides.refineCoreSvg ? overrides.refineCoreSvg(answer) : answer; },
    async runLegacyStages(answer) { calls.push('core:legacy'); return overrides.runLegacyStages ? overrides.runLegacyStages(answer) : answer; },
  };
}

const noticeView = summary => ({ schemaVersion: 1, summary, nodes: [{ kind: 'notice', tone: 'info', spans: [{ text: summary }] }] });

// ---------------------------------------------------------------- tests

test('a clean install runs the core stages and nothing else', async () => {
  const runner = runnerOf();
  const answer = 'Plain prose with no fences.';
  const output = await runTrustedChatPipeline(answer, { providers: new Map(), fences: new Map(), chatOrder: [], problems: [], revision: 0 }, runner);
  assert.equal(output, answer);
  assert.deepEqual(runner.calls, ['core:svg', 'core:legacy']);
});

test('a claimed fence becomes an artifact, and the request block does not survive', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf();
  const output = await runTrustedChatPipeline('Before.\n\n```chemistry-plan\n{"draw":"ethanol"}\n```\n\nAfter.', registryOf(chemistry), runner);
  assert.match(output, /Before\./);
  assert.match(output, /\[artifact compile-result "compile done"\]/);
  assert.match(output, /After\./);
  assert.doesNotMatch(output, /chemistry-plan/, 'the request block is consumed, not left for the next turn to read');
  assert.deepEqual(runner.calls, ['core:svg', 'core:legacy', 'invoke:nodus:chemistry:compile', 'persist:nodus:chemistry:compile-result']);
});

test('a stored result fence is not a request and is never executed', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    legacy: [{ fence: 'chemistry-document', artifactType: 'compile-result', artifactVersion: 1 }],
  });
  const runner = runnerOf();
  const answer = 'Look:\n\n```chemistry-document\n{"cid":702}\n```\n';
  const output = await runTrustedChatPipeline(answer, registryOf(chemistry), runner);
  assert.equal(output, answer, 'a result the model echoed back is left exactly as it is');
  assert.ok(!runner.calls.some(call => call.startsWith('invoke:')), 'and nothing about it is executed');
});

test('providers run in declared priority order, and replace-answer runs before everything', async () => {
  const legal = provider({
    id: 'nodus:legal', priority: 100, tools: [tool('retrieve', { answerMode: 'replace-answer' })],
    artifacts: [{ type: 'retrieve-result', version: 1, label: { en: 'Legal' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'legal-plan', toolId: 'retrieve', maxPerReply: 1, answerMode: 'replace-answer' }],
    hooks: { prepare: true },
  });
  const genomics = provider({
    id: 'nodus:genomics', priority: 200, tools: [tool('predict', { answerMode: 'replace-answer' })],
    artifacts: [{ type: 'predict-result', version: 1, label: { en: 'Genomics' }, modelVisibility: 'none' }],
    requests: [{ fence: 'genomics-plan', toolId: 'predict', maxPerReply: 1, answerMode: 'replace-answer' }],
    hooks: { prepare: true },
  });
  const runner = runnerOf();
  await runTrustedChatPipeline('```genomics-plan\n{}\n```\n\n```legal-plan\n{}\n```', registryOf(genomics, legal), runner);
  const invokes = runner.calls.filter(call => call.startsWith('invoke:'));
  assert.deepEqual(invokes, ['invoke:nodus:legal:retrieve', 'invoke:nodus:genomics:predict'], 'priority 100 before priority 200, regardless of order in the reply');
  const firstHook = runner.calls.findIndex(call => call.startsWith('hook:'));
  assert.ok(runner.calls.indexOf('invoke:nodus:genomics:predict') < firstHook, 'replace-answer requests run before any prepare hook');
});

test('a prepare hook can claim the drawing lane, and the core then leaves SVG alone', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  let refined = false;
  const runner = runnerOf({
    hook: () => [{ op: 'claim', suppressSvgRefinement: true }, { op: 'notice', position: 'before', view: noticeView('Drawing with the verified lane.') }],
    refineCoreSvg: answer => { refined = true; return answer; },
  });
  const output = await runTrustedChatPipeline('```chemistry-plan\n{"draw":"benzene"}\n```', registryOf(chemistry), runner);
  assert.equal(refined, false, 'the core does not second-guess a lane a provider has claimed');
  assert.match(output, /\[view Drawing with the verified lane\.\]/);
});

test('a hook may only address the blocks it claimed', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const problems = [];
  // The reply's prose node is n0; the hook was given it to read, not to delete.
  const runner = runnerOf({ hook: ({ nodes }) => [{ op: 'remove', nodeId: nodes.find(node => node.kind === 'prose').id }] });
  const output = await runTrustedChatPipeline('Keep this prose.\n\n```chemistry-plan\n{}\n```', registryOf(chemistry), runner, {
    onProblem: (provider, error) => problems.push(`${provider.id}: ${error.message}`),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /only address nodes it was given/);
  assert.match(output, /Keep this prose\./, 'the prose the hook tried to remove is still there');
});

test('finalize can add an artifact or a notice, and cannot create a request', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { finalize: true },
  });

  const added = runnerOf({ hook: () => [{ op: 'artifact', position: 'after', artifact: { artifactType: 'compile-result', artifactVersion: 1, summary: 'Appended.', data: {} } }] });
  assert.match(await runTrustedChatPipeline('Prose.', registryOf(chemistry), added), /\[artifact compile-result "Appended\."\]/);

  const problems = [];
  const sneaky = runnerOf({ hook: () => [{ op: 'promote-request', nodeId: 'n0', toolId: 'compile', input: {} }] });
  await runTrustedChatPipeline('Prose.', registryOf(chemistry), sneaky, { onProblem: (provider, error) => problems.push(error.message) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Unsupported final mutation/);
  assert.ok(!sneaky.calls.some(call => call.startsWith('invoke:')), 'a result never becomes the next instruction');
});

test('per-reply limits are enforced by the core, not by the provider', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile', { maxPerReply: 1 })],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf();
  const output = await runTrustedChatPipeline('```chemistry-plan\n{"n":1}\n```\n\n```chemistry-plan\n{"n":2}\n```', registryOf(chemistry), runner);
  assert.equal(runner.calls.filter(call => call.startsWith('invoke:')).length, 1);
  assert.match(output, /At most 1 compile requests are allowed per reply/);
});

test('a failing or truncated request becomes inert text, never a re-readable request', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });

  const failing = runnerOf({ invoke: () => { throw new Error('OPSIN could not resolve `that`\nname'); } });
  const output = await runTrustedChatPipeline('```chemistry-plan\n{}\n```', registryOf(chemistry), failing, { onProblem: () => {} });
  assert.match(output, /Capability error: OPSIN could not resolve  that  name/);
  assert.doesNotMatch(output, /```/, 'the error carries no fence for the next turn to act on');

  const truncated = runnerOf();
  const cut = await runTrustedChatPipeline('```chemistry-plan\n{"draw":', registryOf(chemistry), truncated, { onProblem: () => {} });
  assert.match(cut, /interrupted/);
  assert.ok(!truncated.calls.some(call => call.startsWith('invoke:')));
});

test('an exclusive claim stands down every other provider for that reply', async () => {
  const legal = provider({
    id: 'nodus:legal', priority: 100, tools: [tool('retrieve')],
    artifacts: [{ type: 'retrieve-result', version: 1, label: { en: 'Legal' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'legal-plan', toolId: 'retrieve', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const runner = runnerOf({ hook: ({ provider }) => provider.id === 'nodus:legal' ? [{ op: 'claim', exclusive: true }] : [] });
  await runTrustedChatPipeline('```legal-plan\n{}\n```\n\n```chemistry-plan\n{}\n```', registryOf(legal, chemistry), runner);
  assert.ok(runner.calls.includes('invoke:nodus:legal:retrieve'));
  assert.ok(!runner.calls.includes('invoke:nodus:chemistry:compile'), 'the reply belongs to the provider that claimed it');
  assert.ok(!runner.calls.includes('hook:nodus:chemistry:prepare'));
});

test('cancellation propagates instead of being swallowed as a provider problem', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf({ invoke: () => { throw new DOMException('Cancelled.', 'AbortError'); } });
  await assert.rejects(
    runTrustedChatPipeline('```chemistry-plan\n{}\n```', registryOf(chemistry), runner, { onProblem: () => {} }),
    error => error.name === 'AbortError',
  );
});
