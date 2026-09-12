import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-synonyms-'));
const output = path.join(directory, 'synonyms.mjs');
await build({
  entryPoints: [path.join(root, 'electron/ai/studySynonyms.ts')],
  outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'controlled-provider',
    setup(builder) {
      builder.onResolve({ filter: /^(\.\/aiClient|\.\/studyAiPolicy|\.\.\/db\/settingsRepo)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: name }) => ({ contents: name === './aiClient'
        ? 'export const completeTextNeutral = (...args) => globalThis.__synonymComplete(...args);'
        : name === './studyAiPolicy'
          ? 'export const runStudyAiTask = async (options, task) => ({ value: await task(options.explicitModel), model: options.explicitModel });'
          : 'export const getSettings = () => ({ promptLanguage: "en" });' }));
    },
  }],
});
const { suggestCopilotAlternatives, suggestStudySynonyms } = await import(pathToFileURL(output));
test.after(async () => { delete globalThis.__synonymComplete; await rm(directory, { recursive: true, force: true }); });

const words = ['robusto', 'consistente', 'firme', 'fundado', 'convincente'];
function request(selectedText = 'sólido', sentence = `El argumento es ${selectedText}${/\s$/u.test(selectedText) ? '' : ' '}y válido.`) {
  const selectionFrom = sentence.indexOf(selectedText);
  return { documentId: 'office-addin', sentence, selectedText, selectionFrom, selectionTo: selectionFrom + selectedText.length, model: { provider: 'ollama', model: 'test' } };
}
function provider(responses) {
  const calls = [];
  globalThis.__synonymComplete = async (options, model) => {
    calls.push({ options, model });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    return typeof response === 'string' ? response : JSON.stringify(response);
  };
  return calls;
}

test('Word selections with boundary whitespace keep five options and preserve the exact replacement range', async () => {
  for (const whitespace of [' ', '\u00a0', '\t', '\r']) {
    for (const selectedText of [`sólido${whitespace}`, `${whitespace}sólido`, `${whitespace}sólido${whitespace}`]) {
      const source = request(selectedText);
      const calls = provider([{ alternatives: words.map((replacement) => ({ target: 'sólido', replacement })) }]);
      const result = await suggestCopilotAlternatives(source);
      assert.equal(result.alternatives.length, 5);
      assert.equal(calls.length, 1);
      for (const [index, alternative] of result.alternatives.entries()) {
        assert.equal(alternative.target, selectedText);
        assert.equal(alternative.from, source.selectionFrom);
        assert.equal(alternative.to, source.selectionTo);
        assert.equal(alternative.replacement, selectedText.replace('sólido', words[index]));
      }
    }
  }
});

test('bare replacements and marked targets also preserve Word selection spaces', async () => {
  const source = request('sólido ');
  provider([{ alternatives: words.map((replacement, index) => index % 2 ? replacement : { target: '<<<SELECCIÓN>>>sólido <<<FIN_SELECCIÓN>>>', replacement }) }]);
  const result = await suggestCopilotAlternatives(source);
  assert.ok(result.alternatives.every((option) => option.target === 'sólido ' && option.replacement.endsWith(' ')));
});

test('expanded targets remain exact and use the occurrence containing the selection', async () => {
  const sentence = 'Es sólido; el argumento es sólido y válido.';
  const source = { ...request('sólido ', sentence), selectionFrom: sentence.lastIndexOf('sólido '), selectionTo: sentence.lastIndexOf('sólido ') + 7 };
  provider([{ alternatives: words.map((replacement) => ({ target: 'es sólido', replacement: `es ${replacement}` })) }]);
  const result = await suggestCopilotAlternatives(source);
  assert.equal(result.alternatives[0].target, 'es sólido ');
  assert.equal(result.alternatives[0].from, sentence.lastIndexOf('es sólido'));
  assert.equal(result.alternatives[0].replacement, 'es robusto ');
});

test('an incomplete batch is topped up without repeating earlier or accepted alternatives', async () => {
  const calls = provider([
    { alternatives: ['robusto', 'robusto', 'sólido', 'anterior', 'firme'] },
    { alternatives: ['firme', 'consistente', 'fundado', 'convincente'] },
  ]);
  const result = await suggestCopilotAlternatives({ ...request(), previousAlternatives: ['anterior'] });
  assert.deepEqual(result.alternatives.map((option) => option.replacement), ['robusto', 'firme', 'consistente', 'fundado', 'convincente']);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.user).excludedAlternatives, ['anterior', 'robusto', 'firme']);
});

test('malformed output gets one fresh structured attempt', async () => {
  const calls = provider(['No JSON', { alternatives: words }]);
  assert.equal((await suggestCopilotAlternatives(request())).alternatives.length, 5);
  assert.equal(calls.length, 2);
});

test('targets missing selected non-whitespace text are never accepted; retries are bounded', async () => {
  const calls = provider([{ alternatives: words.map((replacement) => ({ target: 'sólido', replacement })) }]);
  await assert.rejects(suggestCopilotAlternatives(request('es sólido ')), /cinco alternativas/);
  assert.equal(calls.length, 2);
});

test('provider errors propagate without a content retry', async () => {
  const failure = new Error('Provider unavailable');
  const calls = provider([failure]);
  await assert.rejects(suggestCopilotAlternatives(request()), (error) => error === failure);
  assert.equal(calls.length, 1);
});

test('Study shares the whitespace fix and valid batches need only one call', async () => {
  const calls = provider([{ alternatives: words }]);
  const result = await suggestStudySynonyms(request('sólido '));
  assert.equal(result.alternatives.length, 5);
  assert.equal(calls.length, 1);
});

test('whole-sentence rewrites have enough output room for all five alternatives', async () => {
  const sentence = 'El argumento presenta una explicación detallada de los resultados. '.repeat(20).trim();
  const variants = words.map((word) => sentence.replace('detallada', word));
  const encoded = JSON.stringify({ alternatives: variants.map((replacement) => ({ target: sentence, replacement })) });
  let calls = 0;
  globalThis.__synonymComplete = async (options) => {
    calls += 1;
    // Approximate a provider truncating its response at four characters/token.
    return encoded.slice(0, options.maxTokens * 4);
  };
  const result = await suggestCopilotAlternatives(request(sentence, sentence));
  assert.deepEqual(result.alternatives.map((option) => option.replacement), variants);
  assert.equal(calls, 1);
});
