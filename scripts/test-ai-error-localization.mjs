// AI provider failures, as the reader actually receives them.
//
// These sentences are authored in Spanish in electron/ai/aiClient.ts and travel further
// than any other error in the app: the scan queue shows them live, and works.deep_error /
// works.notes STORE them, so a failed analysis repeats its sentence until it is retried.
// `localizeRuntimeError` used to know none of them, so every one collapsed into the
// generic "the operation could not be completed" — which is how a reader in English was
// told a work had failed and never told that the local model had simply run out of time,
// the one fact that points at the fix.
//
// The same file also pins the extraction verdict for weights served by somebody else's
// local server: LM Studio and Ollama can serve exactly the models we benchmarked as
// unable to extract, and until now that told the guard nothing at all.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-ai-errors-'));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { localizeRuntimeError } = load('shared/uiLanguage.ts');
const { localModelRefLikelyWeakAtExtraction, modelRefSupportsExtraction } = load('shared/localAiModels.ts');

/** Every language the interface offers, minus Spanish (the source). */
const LANGUAGES = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

/** What an unrecognised Spanish message becomes — the exact outcome these tests exist
 *  to keep the AI errors out of. */
const GENERIC = {
  en: 'The operation could not be completed.',
  fr: 'L’opération n’a pas pu être effectuée.',
  de: 'Der Vorgang konnte nicht abgeschlossen werden.',
  pt: 'Não foi possível concluir a operação.',
  'pt-BR': 'Não foi possível concluir a operação.',
  it: 'Non è stato possibile completare l’operazione.',
  tr: 'İşlem tamamlanamadı.',
};

/** Assert a message is translated in every language, and never erased into the generic. */
function assertLocalizedEverywhere(message, label) {
  for (const language of LANGUAGES) {
    const out = localizeRuntimeError(message, language);
    assert.notEqual(out, GENERIC[language], `${label} must not collapse into the generic error in ${language}`);
    assert.notEqual(out, message, `${label} must actually be translated in ${language}`);
    assert.ok(out.trim().length > 0, `${label} must not be emptied in ${language}`);
  }
  assert.equal(localizeRuntimeError(message, 'es'), message, `${label} is unchanged in Spanish`);
}

const TIMEOUT = 'Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.';

test('the timeout that broke idea extraction on local models is translated, not erased', () => {
  assertLocalizedEverywhere(TIMEOUT, 'the AI timeout');
  // The English wording is what the reporter would have seen instead of the generic line.
  assert.match(localizeRuntimeError(TIMEOUT, 'en'), /Timed out waiting for the AI provider/);
  assert.match(localizeRuntimeError(TIMEOUT, 'en'), /faster model|smaller fragment/);
});

test('every static AI provider failure is translated in all seven languages', () => {
  const messages = [
    TIMEOUT,
    'Límite de tasa del proveedor de IA',
    'El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.',
    'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.',
    'El JSON no cumple el esquema esperado',
    'Fallo de parseo JSON',
    'La respuesta normalizada no cumple el esquema profundo.',
    'El análisis profundo ha fallado.',
    'Error de IA',
    // Already covered before this change; kept so a refactor cannot lose it.
    'Clave de IA inválida. Revísala en Ajustes.',
  ];
  for (const message of messages) assertLocalizedEverywhere(message, JSON.stringify(message.slice(0, 40)));
});

test('the templated failures keep their identifiers and translate their prose', () => {
  const status = localizeRuntimeError('Error del proveedor (503)', 'en');
  assert.equal(status, 'Provider error (503)');

  const rejected = localizeRuntimeError('El proveedor rechazó la solicitud (400). Detalle: model not found', 'en');
  assert.match(rejected, /^The provider rejected the request \(400\)\. Detail: model not found$/);

  const empty = localizeRuntimeError('Respuesta vacía del proveedor de IA (sin finish_reason).', 'en');
  assert.equal(empty, 'Empty response from the AI provider (no finish_reason).');
  // A finish_reason the provider did send is a wire value: it stays verbatim.
  assert.match(localizeRuntimeError('Respuesta vacía del proveedor de IA (content_filter).', 'en'), /\(content_filter\)/);

  // Truncation, local tail: the model id, the provider label, the token count and the
  // knob name are all identifiers and must survive translation untouched.
  const localTruncation = 'La respuesta de «qwen3.5-8b» (LM Studio) se cortó al alcanzar el límite de 8.000 tokens de salida y el JSON quedó incompleto. El espacio de salida es lo que queda de la ventana de contexto tras el prompt: amplíala en LM Studio (Context Length), elige un modelo local con más contexto o usa un proveedor en la nube para esta tarea.';
  const localOut = localizeRuntimeError(localTruncation, 'en');
  assert.match(localOut, /qwen3\.5-8b/);
  assert.match(localOut, /8\.000/, 'the token count is not reformatted');
  assert.match(localOut, /Context Length/, 'the knob the reader has to turn keeps its real name');
  assert.doesNotMatch(localOut, /se cortó|ventana de contexto/, 'no Spanish survives in the English output');

  const cloudTruncation = 'La respuesta de «gpt-4o» (OpenAI) se cortó al alcanzar el límite de 8.000 tokens de salida y el JSON quedó incompleto. Usa un modelo con mayor límite de salida o reduce el tamaño de la tarea.';
  const cloudOut = localizeRuntimeError(cloudTruncation, 'en');
  assert.match(cloudOut, /higher output limit/);
  assert.doesNotMatch(cloudOut, /Context Length/, 'a cloud truncation must not point at a local knob');

  // Context overflow, with and without a detected window.
  const overflow = 'El modelo local «qwen3.5-8b» no tiene suficiente contexto para esta tarea: necesita ~9.000 tokens (ventana actual: 4.096 tokens). Aumenta el contexto del modelo en Ollama (num_ctx), elige un modelo con más contexto, reduce el tamaño de la tarea (menos texto por lote) o usa un proveedor en la nube para tareas grandes.';
  const overflowOut = localizeRuntimeError(overflow, 'en');
  assert.match(overflowOut, /num_ctx/);
  assert.match(overflowOut, /9\.000/);
  assert.match(overflowOut, /4\.096/, 'the current window is reported, not dropped');
  assert.doesNotMatch(overflowOut, /ventana actual/);

  for (const language of LANGUAGES) {
    for (const message of [localTruncation, cloudTruncation, overflow, 'Error del proveedor (503)']) {
      assert.notEqual(localizeRuntimeError(message, language), GENERIC[language],
        `templated failures must not collapse into the generic error in ${language}`);
    }
  }
});

test('messages that are not ours are passed through untouched', () => {
  // Provider SDKs answer in English; translating those would be inventing content.
  const upstream = 'Connection error while reading from the upstream server';
  assert.equal(localizeRuntimeError(upstream, 'en'), upstream);
  assert.equal(localizeRuntimeError(upstream, 'fr'), upstream);
  // And an unrecognised Spanish sentence still falls back, which is the behaviour the
  // AI table narrows rather than replaces.
  assert.equal(localizeRuntimeError('No se pudo abrir la bóveda seleccionada.', 'en'), GENERIC.en);
});

test('weights we benchmarked as unable to extract are recognised behind any local server', () => {
  const weak = [
    ['lmstudio', 'qwen/qwen3.5-0.8b-instruct-gguf'],
    ['lmstudio', 'Qwen3.5-0.8B-Q4_K_M'],
    ['ollama', 'qwen3.5:0.8b'],
    ['lmstudio', 'lfm2.5-vl-1.6b'],
  ];
  for (const [provider, model] of weak) {
    assert.equal(localModelRefLikelyWeakAtExtraction({ provider, model }), true, `${provider}/${model} is the model we blocked`);
  }

  // Bigger siblings, other families and cloud models must never be caught: this warning
  // is the only thing standing between a user and a picker that looks broken.
  const fine = [
    ['lmstudio', 'qwen3.5-32b'],
    ['lmstudio', 'qwen2.5-7b-instruct'],
    ['ollama', 'gemma-4-e2b-it'],
    ['ollama', 'llama3.3:70b'],
    ['openai', 'gpt-4o'],
    ['gemini', 'gemini-3.1-flash-lite'],
  ];
  for (const [provider, model] of fine) {
    assert.equal(localModelRefLikelyWeakAtExtraction({ provider, model }), false, `${provider}/${model} must not be flagged`);
  }
  assert.equal(localModelRefLikelyWeakAtExtraction(null), false);

  // Our own provider is blocked outright elsewhere, so it must not also be "warned"
  // about — one model, one message.
  assert.equal(localModelRefLikelyWeakAtExtraction({ provider: 'nodus', model: 'qwen3.5-0.8b-q4' }), false);
});

test('the soft warning never becomes a hard block', () => {
  // modelRefSupportsExtraction gates the picker (disabled option) and the scan pipeline
  // (refused job). On a third-party server the model id is a label the user chose, not a
  // build we ship, so a name match must not lock anyone out of their own model.
  assert.equal(modelRefSupportsExtraction({ provider: 'lmstudio', model: 'qwen3.5-0.8b' }), true);
  assert.equal(modelRefSupportsExtraction({ provider: 'ollama', model: 'qwen3.5:0.8b' }), true);
  // And the built-in verdict is unchanged.
  assert.equal(modelRefSupportsExtraction({ provider: 'nodus', model: 'qwen3.5-0.8b-q4' }), false);
  assert.equal(modelRefSupportsExtraction({ provider: 'nodus', model: 'gemma-4-e2b-q4' }), true);
  assert.equal(modelRefSupportsExtraction({ provider: 'openai', model: 'gpt-4o' }), true);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
