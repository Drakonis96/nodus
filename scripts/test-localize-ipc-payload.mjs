// Verifies that localizing IPC payloads stopped deep-cloning everything.
//
// Every one of the ~732 IPC handlers passes its result through
// localizeIpcPayload, which used to rebuild every object and array
// unconditionally — a fresh copy of a 7,000-row result set on every call, to
// change nothing at all in the overwhelming majority of responses.
//
// The rewrite shares unchanged subtrees by identity. Because this sits on every
// IPC path, correctness is pinned by differential-testing against the original
// implementation over a spread of payload shapes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-localize-'));
const bundle = path.join(dir, 'uiLanguage.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/uiLanguage.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const mod = require(bundle);
const { localizeIpcPayload, localizeRuntimeError } = mod;

/**
 * The original implementation, kept as the correctness oracle. It needs the
 * same private helpers, so it reuses the module's own localizeRuntimeError and
 * detects renderer-translated messages by asking the real function whether it
 * would leave the string alone.
 */
function localizeTheOldWay(value, language) {
  if (Array.isArray(value)) return value.map((entry) => localizeTheOldWay(entry, language));
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if ((key === 'message' || key === 'error') && typeof entry === 'string') {
        // Mirror the real guard by round-tripping a single-field object.
        const probe = localizeIpcPayload({ [key]: entry }, language)[key];
        return [key, probe];
      }
      return [key, localizeTheOldWay(entry, language)];
    })
  );
}

const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR'];

/** Realistic payload shapes seen across the IPC surface. */
function samplePayloads() {
  return [
    null,
    undefined,
    42,
    'plain string',
    true,
    [],
    {},
    { ok: true },
    { ok: false, message: 'Algo salió mal en el proceso.' },
    { ok: false, error: 'Fallo inesperado del proveedor.' },
    // A renderer-translated message must be preserved verbatim.
    { ok: false, message: 'Bóveda no encontrada.' },
    { ok: true, message: 'Bóveda cargada. Claves API copiadas: 3.' },
    // Nested + arrays, the database-row shape.
    {
      rows: Array.from({ length: 20 }, (_, i) => ({
        id: `row-${i}`,
        cells: { title: `Fila ${i}`, count: i, tags: ['a', 'b'] },
      })),
      total: 20,
    },
    // A message buried deep inside an array of objects.
    {
      results: [
        { id: 1, detail: { ok: true } },
        { id: 2, detail: { ok: false, error: 'No se pudo abrir el archivo.' } },
      ],
    },
    // Mixed: message field that is NOT a string must pass through.
    { message: 42, error: null, nested: { message: ['not', 'a', 'string'] } },
    // Non-plain prototypes must be returned untouched.
    { when: new Date(0), buffer: Buffer.from('abc'), re: /x/g },
    // Keys before and after the changed one, to exercise the partial copy.
    { before: 1, message: 'Error de red.', after: 2, alsoAfter: { x: 1 } },
  ];
}

try {
  // --- 1. Differential: identical output to the original implementation ----
  for (const language of LANGUAGES) {
    for (const payload of samplePayloads()) {
      const fresh = JSON.parse(JSON.stringify(payload ?? null));
      assert.deepEqual(
        localizeIpcPayload(structuredCloneish(payload), language),
        localizeTheOldWay(structuredCloneish(payload), language),
        `outputs must match for language ${language} on ${JSON.stringify(fresh)?.slice(0, 60)}`
      );
    }
  }

  // --- 2. The input is never mutated --------------------------------------
  {
    const payload = { ok: false, message: 'Fallo de disco.', rows: [{ id: 1 }] };
    const snapshot = JSON.stringify(payload);
    localizeIpcPayload(payload, 'en');
    assert.equal(JSON.stringify(payload), snapshot, 'localizing must not mutate its input');
  }

  // --- 3. Unchanged payloads are returned BY IDENTITY (the actual fix) -----
  {
    const rows = {
      rows: Array.from({ length: 500 }, (_, i) => ({
        id: `row-${i}`,
        cells: { title: `Fila ${i}`, n: i, tags: ['x', 'y'] },
      })),
    };
    const out = localizeIpcPayload(rows, 'en');
    assert.equal(out, rows, 'a payload with nothing to localize must not be copied at all');
    assert.equal(out.rows, rows.rows, 'nested arrays must be shared, not rebuilt');
    assert.equal(out.rows[0], rows.rows[0], 'nested objects must be shared, not rebuilt');
    assert.equal(out.rows[0].cells, rows.rows[0].cells, 'leaf objects must be shared too');
  }

  // --- 4. Changed payloads copy only along the changed path ---------------
  {
    const untouched = { deep: { value: 1 } };
    const payload = {
      untouched,
      failing: { message: 'Se agotó el tiempo de espera.' },
    };
    const out = localizeIpcPayload(payload, 'en');
    assert.notEqual(out, payload, 'the root must be copied because a descendant changed');
    assert.equal(out.untouched, untouched, 'sibling subtrees with no change must be shared');
    assert.notEqual(out.failing, payload.failing, 'the changed subtree must be a new object');
    assert.notEqual(
      out.failing.message,
      payload.failing.message,
      'the message must actually be localized'
    );
  }

  // --- 5. Key order and completeness survive the partial copy -------------
  {
    // Must be prose that looksLikeSpanishUiText actually detects, otherwise
    // nothing is localized and the assertions below pass vacuously.
    const message = 'No se pudo abrir el archivo seleccionado.';
    assert.notEqual(
      localizeRuntimeError(message, 'en'),
      message,
      'test fixture must be a message that really gets localized'
    );

    const payload = { a: 1, b: 2, message, c: 3, d: { e: 4 } };
    const out = localizeIpcPayload(payload, 'en');
    assert.notEqual(out, payload, 'the object must be copied because the message changed');
    assert.deepEqual(Object.keys(out), ['a', 'b', 'message', 'c', 'd'], 'key order must be preserved');
    assert.equal(out.a, 1);
    assert.equal(out.c, 3);
    assert.notEqual(out.message, message, 'the message must actually be localized');
    assert.equal(out.d, payload.d, 'objects after the changed key must still be shared');
  }

  // --- 6. Arrays copy only from the first changed element -----------------
  {
    const first = { id: 1 };
    const second = { id: 2 };
    const payload = [first, second, { error: 'No se pudo abrir el archivo.' }, { id: 4 }];
    const out = localizeIpcPayload(payload, 'en');
    assert.notEqual(out, payload, 'the array must be copied because an element changed');
    assert.equal(out.length, payload.length, 'no element may be lost');
    assert.equal(out[0], first, 'elements before the change must be shared');
    assert.equal(out[1], second, 'elements before the change must be shared');
    assert.notEqual(out[2], payload[2], 'the changed element must be new');
    assert.equal(out[3], payload[3], 'elements after the change must be shared');
  }

  // --- 7. Spanish is a no-op, so nothing should ever be copied ------------
  {
    const payload = { ok: false, message: 'Algo salió mal en el proceso.' };
    const out = localizeIpcPayload(payload, 'es');
    assert.deepEqual(out, payload, 'Spanish output must be unchanged in value');
  }

  console.log('# localize IPC payload tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/** Deep copy that tolerates Date/Buffer/RegExp, unlike JSON round-tripping. */
function structuredCloneish(value) {
  if (Array.isArray(value)) return value.map(structuredCloneish);
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = structuredCloneish(value[key]);
  return out;
}
