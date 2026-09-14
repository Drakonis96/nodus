// A custom gateway that refuses the reasoning field must not make the scan fail.
//
// Nodus adds `reasoning_effort` to background scans of a thinking model on a custom
// endpoint, where it cannot know whether the gateway accepts it. Two recoveries keep
// that safe:
//   · a rejection that NAMES an optional field is replayed without the optional body
//     (the pre-existing behaviour, for any provider);
//   · a 400/422 from a custom endpoint after Nodus sent the reasoning field is replayed
//     too, even when the gateway does not name it — a proxy in front of the real API
//     often answers a bare "Bad Request", and without this the field we added would
//     turn a scan that used to run into one that fails.
//
// A 400/422 is a refusal, not a generation, so a single replay cannot double-charge.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-optional-fields-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { rejectsOptionalTransportField, shouldRetryWithoutOptionalFields } = load('electron/ai/providerErrors.ts');

/** A provider HTTP failure with the shape the OpenAI SDK throws. */
const failure = (status, message) => Object.assign(new Error(message), { status, error: { message } });

test('a rejection that names an optional field is always replayable', () => {
  assert.equal(rejectsOptionalTransportField(failure(400, 'Unsupported parameter: reasoning_effort')), true);
  assert.equal(rejectsOptionalTransportField(failure(400, 'Unknown field response_format')), true);
  assert.equal(rejectsOptionalTransportField(failure(400, 'Invalid parameter: provider.only')), true);
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Unsupported parameter: reasoning_effort')), true, 'no options needed');
});

test('a named rejection is only a 400; other statuses keep their meaning', () => {
  assert.equal(rejectsOptionalTransportField(failure(422, 'Unknown field response_format')), false);
  assert.equal(rejectsOptionalTransportField(failure(500, 'Unsupported parameter: reasoning_effort')), false);
  assert.equal(rejectsOptionalTransportField(failure(429, 'Invalid parameter: reasoning_effort')), false);
  assert.equal(rejectsOptionalTransportField(new Error('socket hang up')), false);
});

test('an unnamed custom rejection is replayable once Nodus sent the reasoning field', () => {
  // The exact shape a proxy returns for a field it does not know: no field named.
  assert.equal(
    shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'custom', sentReasoning: true }),
    true,
  );
  assert.equal(
    shouldRetryWithoutOptionalFields(failure(422, 'Unprocessable Entity'), { provider: 'custom', sentReasoning: true }),
    true,
  );
});

test('the unnamed fallback stays narrow: custom only, reasoning only, 400/422 only', () => {
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'custom', sentReasoning: false }), false, 'we added nothing, so we own nothing');
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'custom' }), false);
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'openai', sentReasoning: true }), false, 'only a custom gateway is unknown');
  assert.equal(shouldRetryWithoutOptionalFields(failure(422, 'Bad Request'), { provider: 'openrouter', sentReasoning: true }), false);
  assert.equal(shouldRetryWithoutOptionalFields(failure(500, 'Bad Request'), { provider: 'custom', sentReasoning: true }), false, 'a 5xx did not refuse the request');
  assert.equal(shouldRetryWithoutOptionalFields(failure(429, 'Too Many Requests'), { provider: 'custom', sentReasoning: true }), false);
  assert.equal(shouldRetryWithoutOptionalFields(new Error('Connection error.'), { provider: 'custom', sentReasoning: true }), false, 'transport failures belong to the retry layer');
});

test('the transport recovers by dropping only the reasoning field, keeping JSON mode', () => {
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  // The predicate is imported, not reimplemented locally.
  assert.match(source, /import \{ classifyProviderError, isTransientNetworkFailure, rejectsOptionalTransportField, shouldRetryWithoutOptionalFields \} from '\.\/providerErrors';/);
  assert.doesNotMatch(source, /^function rejectsOptionalTransportField/m);
  // Both the non-streaming and the streaming transport mark whether the field was sent…
  assert.equal((source.match(/const sentReasoning = \(extras as any\)\.reasoning_effort !== undefined;/g) ?? []).length, 2);
  // …and both replay through the helper that keeps everything except the field we added.
  assert.equal((source.match(/retryOptionalBody\(model, extras, e, sentReasoning\)/g) ?? []).length, 2);
  assert.match(source, /if \(sentReasoning && !rejectsOptionalTransportField\(error\)\) \{/);
  assert.match(source, /delete rest\.reasoning_effort;/);
});
