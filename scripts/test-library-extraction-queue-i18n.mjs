import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The global-library extraction readout travels in a `message` field that
// `broadcastExtraction` runs through `localizeIpcPayload`. Unlisted, a finished run
// announced the generic "The operation could not be completed." while its bar sat at
// 100%, and the interpolated messages leaked Spanish. `shared/uiLanguage.ts` must hand
// them over untouched and `src/i18n.*.ts` must translate them. This holds both halves.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-extraction-i18n-'));

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const ui = loadModule('shared/uiLanguage.ts');
const runtime = loadModule('src/i18n.ts');

const TRANSLATIONS = [
  { lang: 'en', file: 'src/i18n.en.ts', export: 'EN' },
  { lang: 'fr', file: 'src/i18n.fr.ts', export: 'FR' },
  { lang: 'de', file: 'src/i18n.de.ts', export: 'DE' },
  { lang: 'pt', file: 'src/i18n.pt.ts', export: 'PT' },
  { lang: 'pt-BR', file: 'src/i18n.pt-BR.ts', export: 'PT_BR' },
  { lang: 'it', file: 'src/i18n.it.ts', export: 'IT' },
  { lang: 'tr', file: 'src/i18n.tr.ts', export: 'TR' },
  { lang: 'zh-CN', file: 'src/i18n.zh-CN.ts', export: 'ZH_CN' },
].map((entry) => ({ ...entry, table: loadModule(entry.file)[entry.export] }));

const GENERIC = 'The operation could not be completed.';

const FIXED_MESSAGES = [
  'Documento añadido a la cola de extracción.',
  'Documento priorizado para abrirlo en cuanto esté listo.',
  'Iniciando extracción…',
  'Extracción completada.',
  'Extracción cancelada.',
  'Extrayendo imágenes y figuras…',
  'Guardando Markdown y trazabilidad…',
];

const TEMPLATE_KEYS = [
  'Extrayendo página {page} de {total}…',
  'OCR local {page} de {total}…',
  'OCR remoto {n} de {total}…',
  'Analizando {file}…',
];

const INTERPOLATED_MESSAGES = [
  'Extrayendo página 3 de 12…',
  'OCR local 1 de 5…',
  'OCR remoto 2 de 4…',
  'Analizando paper.pdf…',
];

test('extraction progress messages pass through localizeIpcPayload untouched', () => {
  for (const message of [...FIXED_MESSAGES, ...INTERPOLATED_MESSAGES]) {
    const localized = ui.localizeIpcPayload({ message }, 'en');
    assert.equal(localized.message, message, `localizeIpcPayload rewrote "${message}"`);
    assert.notEqual(localized.message, GENERIC, `"${message}" collapsed into the generic failure`);
  }
});

test('extraction progress messages are translated, never leaked or collapsed', () => {
  for (const { lang } of TRANSLATIONS) {
    runtime.setActiveLang(lang);
    for (const message of FIXED_MESSAGES) {
      const out = runtime.tr(message);
      assert.notEqual(out, message, `${lang} leaked Spanish for "${message}"`);
      assert.notEqual(out, GENERIC, `${lang} collapsed "${message}" into the generic failure`);
    }
    assert.equal(
      runtime.tr('Extrayendo página 3 de 12…'),
      runtime.tx('Extrayendo página {page} de {total}…', { page: 3, total: 12 }),
      `${lang} did not interpolate the page counter`
    );
    assert.match(runtime.tr('Analizando paper.pdf…'), /paper\.pdf/, `${lang} dropped the file name`);
    assert.match(runtime.tr('OCR local 1 de 5…'), /1/, `${lang} dropped the OCR batch counter`);
  }
});

test('every extraction message has an entry in all seven language tables', () => {
  for (const { lang, table } of TRANSLATIONS) {
    for (const key of [...FIXED_MESSAGES, ...TEMPLATE_KEYS]) {
      assert.ok(key in table, `${lang} is missing the extraction key "${key}"`);
    }
  }
});

test('the queue panel only paints an error for a failed extraction', () => {
  const tasks = fs.readFileSync(path.join(repoRoot, 'src/components/AdditionalQueueTasks.tsx'), 'utf8');
  assert.match(
    tasks,
    /error=\{job\.status === 'failed' \? job\.error : null\}/,
    'an extraction that did not fail must not render an error line'
  );
});
