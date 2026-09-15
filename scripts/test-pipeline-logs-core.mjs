// The logger the whole pipeline calls: what a thrown value is classified as, and what a line
// ends up containing.
//
// `aiClient.ts` cannot be imported outside Electron (it pulls the database and the native
// SQLite driver), which is exactly why the classification lives in this Electron-free module:
// here the error taxonomy is asserted directly, and the wiring inside `aiClient.ts` is pinned
// separately with source assertions in scripts/test-pipeline-logs-wiring.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-pipeline-log-core-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const bundle = path.join(dir, 'core.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  ['electron/logging/pipelineLogCore.ts', '--bundle', '--platform=node', '--format=cjs', '--target=es2022', '--alias:@shared=./shared', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' },
);
const core = require(bundle);

/** Collect what the core records, the way the Electron host does through its sink. */
function collector() {
  const lines = [];
  core.setPipelineLogSink({ record: (entry) => lines.push(entry) });
  return lines;
}

test.after(() => core.setPipelineLogSink(null));

/** An AiError as aiClient builds it. */
function aiError(message, code = null, extra = {}) {
  return Object.assign(new Error(message), { name: 'AiError', code, ...extra });
}

test('every failure the user listed is classified into its own code and category', () => {
  const cases = [
    // [label, error, expected code, expected category]
    ['model returned broken JSON', aiError('JSON inválido: Unexpected token <', 'invalid_json'), 'invalid_json', 'json'],
    ['JSON misses the schema', aiError('El JSON no cumple el esquema esperado', 'schema_mismatch'), 'schema_mismatch', 'json'],
    ['output cut off at the ceiling', aiError('La respuesta JSON quedó truncada.', 'output_truncated', { retriable: true }), 'output_truncated', 'json'],
    ['provider timed out', aiError('Tiempo agotado esperando al proveedor de IA.', 'timeout'), 'timeout', 'connection'],
    ['rate limited', aiError('Límite de tasa del proveedor de IA', 'rate_limit', { retriable: true }), 'rate_limit', 'provider'],
    ['provider 5xx', aiError('Error del proveedor (503)', 'provider_5xx', { retriable: true }), 'provider_5xx', 'provider'],
    ['invalid AI key', aiError('Clave de IA inválida. Revísala en Ajustes.', 'auth', { config: true }), 'auth', 'provider'],
    ['provider rejected the request', aiError('El proveedor rechazó la solicitud (400)', 'bad_request'), 'bad_request', 'provider'],
    ['context overflow', aiError('El contexto se queda sin espacio', 'context_overflow', { config: true }), 'context_overflow', 'provider'],
    ['no model configured', aiError('No hay un modelo de IA configurado.', 'model_required', { config: true }), 'model_missing', 'model'],
    ['empty provider response', aiError('Respuesta vacía del proveedor', 'provider_empty_error', { retriable: true }), 'provider_empty', 'provider'],
    ['dropped socket', Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }), 'connection', 'connection'],
    ['socket errno', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'connection', 'connection'],
    ['HTTP 429 without a code', Object.assign(new Error('Too many requests'), { status: 429 }), 'rate_limit', 'provider'],
    ['HTTP 503 without a code', Object.assign(new Error('Bad gateway'), { status: 503 }), 'provider_5xx', 'provider'],
    ['HTTP 401 without a code', Object.assign(new Error('Unauthorized'), { status: 401 }), 'auth', 'provider'],
    ['subscription runtime unavailable', Object.assign(new Error('runtime died'), { kind: 'unavailable' }), 'provider_5xx', 'provider'],
    ['subscription runtime rate limit', Object.assign(new Error('quota'), { kind: 'rateLimit' }), 'rate_limit', 'provider'],
    ['a cancelled job', Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), 'cancelled', 'queue'],
  ];
  for (const [label, error, code, category] of cases) {
    const result = core.classifyPipelineError(error);
    assert.equal(result.code, code, `${label}: code`);
    assert.equal(result.category, category, `${label}: category`);
    assert.ok(result.detail.length > 0, `${label}: keeps the message as detail`);
  }
});

test('a failure keeps the provider’s own words, the HTTP status and whether it is retriable', () => {
  const result = core.classifyPipelineError(aiError('Límite de tasa del proveedor de IA', 'rate_limit', { retriable: true, status: 429 }));
  assert.equal(result.detail, 'Límite de tasa del proveedor de IA');
  assert.equal(result.httpStatus, 429);
  assert.equal(result.retriable, true);
  // An unmapped failure is not silently attributed to a pipeline: it is `unknown`/system.
  const unknown = core.classifyPipelineError(new Error('something odd happened'));
  assert.equal(unknown.code, 'unknown');
  assert.equal(unknown.category, 'system');
  assert.equal(core.classifyPipelineError(new Error('odd'), 'indexing').category, 'indexing',
    'the caller decides the fallback category, so an unattributable failure still lands under its subsystem');
});

test('a line inherits the pipeline scope: vault, document, job, model', () => {
  const lines = collector();
  core.withPipelineLogScope({
    scope: 'indexing',
    vaultId: 'v1',
    vaultName: 'Tesis',
    nodusId: 'w1',
    documentTitle: 'Historia contemporánea',
    jobId: 'job-1',
    model: 'gpt-4o',
    provider: 'openai',
  }, () => {
    core.logPipelineFailure({ error: new Error('provider rejected this document') });
    // A nested scope merges: the OCR step adds its own phase without losing the document.
    core.withPipelineLogScope({ scope: 'ocr', phase: 'ocr' }, () => {
      core.logPipelineSuccess({ subject: 'subjectOcr' });
    });
  });
  assert.equal(lines.length, 2);
  const [failure, ocr] = lines;
  assert.equal(failure.vaultId, 'v1');
  assert.equal(failure.vaultName, 'Tesis');
  assert.equal(failure.documentTitle, 'Historia contemporánea');
  assert.equal(failure.jobId, 'job-1');
  assert.equal(failure.model, 'gpt-4o');
  assert.equal(failure.scope, 'indexing');
  assert.equal(failure.category, 'indexing');
  // The failure wraps the error and embeds it in the sentence, so `detail` is not printed twice.
  assert.equal(failure.message.id, 'logFailed');
  assert.equal(failure.message.params.detail, 'provider rejected this document');
  assert.equal(failure.detail, null);
  // The nested line keeps the document AND takes the inner scope and phase.
  assert.equal(ocr.scope, 'ocr');
  assert.equal(ocr.phase, 'ocr');
  assert.equal(ocr.documentTitle, 'Historia contemporánea');
  assert.equal(ocr.level, 'success');
  assert.equal(ocr.category, 'ocr');
  // Outside any scope nothing is invented: `app`, no ids.
  core.logPipelineEvent({ subject: 'subjectQueue' });
  const outside = lines[2];
  assert.equal(outside.scope, 'app');
  assert.equal(outside.vaultId, null);
});

test('the sentence matches the severity and never leaves an unresolved placeholder', () => {
  const lines = collector();
  core.logPipelineSuccess({ subject: 'subjectIndexing', params: { title: 'X' } });
  core.logPipelineFailure({ error: new Error('boom'), subject: 'subjectIndexing' });
  core.logPipelineWarning({ subject: 'subjectOcr', reason: 'reasonOcrLowQuality' });
  core.logPipelineWarning({ subject: 'subjectOcr', detail: 'pages 12-14' });
  core.logPipelineWarning({ subject: 'subjectOcr' });
  core.logPipelineInfo({ subject: 'subjectQueue', detail: 'started' });
  core.logPipelineEvent({ subject: 'subjectApp' });
  const ids = lines.map((line) => line.message.id);
  assert.deepEqual(ids, [
    'logDone', 'logFailed', 'logWarning', 'logWarningDetail', 'logWarningPlain', 'logInfo', 'logInfoPlain',
  ]);
  assert.deepEqual(lines.map((line) => line.level), ['success', 'error', 'warning', 'warning', 'warning', 'info', 'info']);
  // Every template's placeholders are filled by the entry itself.
  for (const line of lines) {
    const filled = JSON.stringify(line.message.params ?? {});
    assert.ok(!filled.includes('undefined'), `${line.message.id} left a hole: ${filled}`);
  }
});

test('a code alone carries its category, and a subject carries it when there is no code', () => {
  const lines = collector();
  core.logPipelineFailure({ code: 'embedding_count_mismatch', subject: 'subjectEmbeddings', detail: 'expected 16 vectors, received 15' });
  core.logPipelineSuccess({ subject: 'subjectLibraryExtraction' });
  core.logPipelineWarning({ subject: 'subjectFigureAnalysis' });
  core.logPipelineFailure({ code: 'db_error', subject: 'subjectPublish', detail: 'disk full' });
  assert.deepEqual(lines.map((line) => line.category), ['embedding', 'extraction', 'extraction', 'storage']);
  // A code that means "warning" overrides the level a caller passes.
  const before = lines.length;
  core.logPipelineEvent({ code: 'cancelled', subject: 'subjectQueue' });
  assert.equal(lines[before].level, 'warning');
  assert.equal(lines[before].code, 'cancelled');
});

test('logging never breaks the work it describes', () => {
  core.setPipelineLogSink({
    record: () => { throw new Error('the log destination exploded'); },
  });
  // Every entry point swallows its own failures — this must not throw.
  core.logPipelineEvent({ subject: 'subjectApp' });
  core.logPipelineFailure({ error: new Error('boom') });
  core.logPipelineSuccess({ subject: 'subjectIndexing' });
  // Hostile inputs are classified rather than propagagted.
  for (const hostile of [undefined, null, 'a string', 42, Symbol('x'), { toString() { throw new Error('nope'); } }]) {
    core.logPipelineFailure({ error: hostile });
    core.logPipelineEvent({ error: hostile, subject: 'subjectApp' });
  }
  core.setPipelineLogSink({ record: () => undefined });
  core.logPipelineEvent({ subject: 'subjectApp' });
  assert.ok(true);
});

test('a line with no sink is simply dropped, so importing the core has no effect', () => {
  core.setPipelineLogSink(null);
  const lines = [];
  core.logPipelineEvent({ subject: 'subjectApp' });
  core.setPipelineLogSink({ record: (entry) => lines.push(entry) });
  core.logPipelineEvent({ subject: 'subjectApp' });
  assert.equal(lines.length, 1);
});
