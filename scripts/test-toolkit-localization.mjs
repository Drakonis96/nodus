import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mainSourceText } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-toolkit-localization-'));
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

function bundle(entry) {
  const outfile = path.join(outDir, `${path.basename(entry, path.extname(entry))}.cjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
    path.join(root, entry),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${outfile}`,
  ], { cwd: root, stdio: 'inherit' });
  return require(outfile);
}

const dialogs = bundle('electron/toolkit/dialogI18n.ts');
const translate = bundle('src/i18n.translate.ts');
const i18n = bundle('src/i18n.ts');
const uiLanguage = bundle('shared/uiLanguage.ts');
const includedAppMeta = bundle('shared/toolkitAppsI18n.ts');
test.after(() => rm(outDir, { recursive: true, force: true }));

test('every Toolkit native dialog is translated in every interface language', () => {
  const tables = dialogs.toolkitDialogTranslations();
  const keys = Object.keys(tables).sort();
  assert.ok(keys.length >= 20);
  for (const language of languages) {
    assert.ok(keys.every((key) => typeof tables[key][language] === 'string' && tables[key][language].trim()), `${language} dialog copy`);
  }
  assert.equal(dialogs.toolkitDialogText('addFiles', 'tr'), 'Dosya ekle');
  assert.notEqual(dialogs.toolkitDialogText('saveTranslation', 'fr'), tables.saveTranslation.es);
});

test('Nodus Translate covers static copy, progress and generated warnings', async () => {
  const expected = Object.keys(translate.TRANSLATE_TRANSLATIONS.en).sort();
  assert.ok(expected.length >= 70);
  for (const language of languages.slice(1)) {
    const table = translate.TRANSLATE_TRANSLATIONS[language];
    assert.deepEqual(Object.keys(table).sort(), expected, `${language} Translate keys`);
    assert.ok(Object.values(table).every((value) => value.trim()), `${language} Translate copy`);
    for (const key of translate.TRANSLATE_RUNTIME_KEYS) assert.ok(table[key], `${language}: ${key}`);
  }

  i18n.setActiveLang('tr');
  assert.equal(i18n.tr('Traduciendo 3 de 8 fragmentos…'), '8 parçadan 3 tanesi çevriliyor…');
  assert.equal(i18n.tr('paper.pdf: guardando…'), 'paper.pdf: kaydediliyor…');
  assert.match(
    i18n.tr('paper.pdf: El modo refluido conserva la jerarquía textual, pero puede cambiar los saltos de página del PDF original.'),
    /^paper\.pdf: Yeniden akıtma modu/
  );
  assert.doesNotMatch(i18n.tr('Revisa las páginas 2, 7: el texto necesitó un ajuste tipográfico intenso.'), /Revisa|páginas|texto necesitó/);

  const view = await readFile(path.join(root, 'src/views/ToolkitTranslateView.tsx'), 'utf8');
  for (const literal of ['Texto original', 'Documentos procesados', 'Opciones avanzadas', 'Selecciona un modelo para continuar.']) {
    assert.doesNotMatch(view, new RegExp(`>\\s*${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`), `${literal} must pass through i18n`);
  }
  assert.match(view, /\{tr\(warning\)\}/);
  assert.match(view, /progressLabel\(job\)/);
});

test('Presenter and shared browser surfaces initialise their own language', async () => {
  const [windows, presenter, audience, remote] = await Promise.all([
    readFile(path.join(root, 'electron/toolkit/presenter/windows.ts'), 'utf8'),
    readFile(path.join(root, 'src/presenter/presenterView.tsx'), 'utf8'),
    readFile(path.join(root, 'src/presenter/audience.tsx'), 'utf8'),
    readFile(path.join(root, 'src/presenter/remote/main.tsx'), 'utf8'),
  ]);
  assert.match(windows, /language:\s*getSettings\(\)\.uiLanguage/g);
  assert.match(presenter, /setActiveLang\(normalizeUiLanguage\(new URLSearchParams/);
  assert.match(audience, /setActiveLang\(normalizeUiLanguage\(new URLSearchParams/);
  assert.match(remote, /setActiveLang\(normalizeBrowserUiLanguage\(navigator\.language\)\)/);

  assert.equal(uiLanguage.normalizeBrowserUiLanguage('tr-TR'), 'tr');
  assert.equal(uiLanguage.normalizeBrowserUiLanguage('pt-BR'), 'pt-BR');
  assert.equal(uiLanguage.normalizeBrowserUiLanguage('pt-PT'), 'pt');
  assert.equal(uiLanguage.normalizeBrowserUiLanguage('nl-NL'), 'en');
});

test('included App metadata is complete in every interface language', () => {
  const apps = includedAppMeta.includedToolkitAppMetaTranslations();
  assert.equal(Object.keys(apps).length, 3);
  for (const translations of Object.values(apps)) {
    assert.deepEqual(Object.keys(translations).sort(), languages.slice().sort());
    for (const language of languages) {
      assert.ok(translations[language].title.trim());
      assert.ok(translations[language].summary.trim());
    }
  }
});

test('Toolkit IPC obtains file-dialog copy from the active UI language', async () => {
  const ipc = mainSourceText();
  assert.match(ipc, /const toolkitCopy = \(key: ToolkitDialogKey\).*getSettings\(\)\.uiLanguage/);
  for (const key of ['addFiles', 'saveTranslation', 'importPresentation', 'downloadAppPackage', 'selectProtectDocuments']) {
    assert.match(ipc, new RegExp(`toolkitCopy\\('${key}'\\)`));
  }
  assert.match(ipc, /buildToolkitAppPackage\(manifest, getSettings\(\)\.uiLanguage\)/);
});
