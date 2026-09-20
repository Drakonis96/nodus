import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-update-ready-'));
test.after(() => rm(dir, { recursive: true, force: true }));
const languages = ['es', 'en', 'fr', 'de', 'it', 'pt', 'pt-BR', 'tr'];
const dictionaries = {};
for (const lang of languages.filter((v) => v !== 'es')) {
  const bundle = path.join(dir, `i18n-${lang}.mjs`);
  await build({ entryPoints: [path.join(root, `src/i18n.${lang}.ts`)], outfile: bundle, bundle: true, format: 'esm', logLevel: 'silent' });
  dictionaries[lang] = Object.values(await import(pathToFileURL(bundle)))[0];
}
const tr = (lang, key) => lang === 'es' ? key : dictionaries[lang][key];

test('every static update-flow message has an explicit translation and intact placeholders in all languages', async () => {
  const keys = new Set();
  for (const file of ['src/updateStatus.ts', 'src/components/UpdateReadyNotice.tsx']) {
    const source = await readFile(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ['t', 'tx'].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  for (const key of keys) for (const lang of languages) {
    const translated = tr(lang, key);
    assert.ok(typeof translated === 'string' && translated.trim(), `${lang} missing: ${key}`);
    assert.deepEqual([...translated.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), [...key.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), `${lang} placeholders: ${key}`);
  }
});

test('Settings and the app shell consume the persistent snapshot; every installer uses the protected action', async () => {
  const settings = await readFile(path.join(root, 'src/views/Settings.tsx'), 'utf8');
  const app = await readFile(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(settings, /\[updateProgress, setUpdateProgress\] = useUpdateProgress\(\)/);
  assert.match(settings, /canInstallUpdate\(updateProgress\)/);
  assert.match(settings, /installUpdateManually\(updateProgress\)/);
  assert.match(app, /<UpdateReadyNotice/); assert.match(app, /checkOnStartup: true/);
});

const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const ready = { status: 'downloaded', message: '', version: '5.2.0', downloadedVersion: '5.2.0', progress: 100, at: '2026-09-06T00:00:00Z' };
test('real update UI: work, postpone, revisit, retry and install in all languages', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const buildFixture = (mode) => build({ outfile: path.join(dir, 'fixture.js'), entryPoints: [path.join(root, 'scripts/fixtures/manual-update/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify(mode), __APP_VERSION__: '"5.1.7"' } });
  const [bundle, strictBundle] = await Promise.all([buildFixture('production'), buildFixture('development')]);
  execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', path.join(dir, 'style.css'), '--minify'], { cwd: root, stdio: 'pipe' });
  const css = await readFile(path.join(dir, 'style.css'), 'utf8');
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const errors = [];
  let page;
  async function fresh(config = {}) {
    if (page) await page.close();
    page = await browser.newPage({ viewport: { width: 1120, height: 800 } }); page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://updates.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
    await page.goto('http://updates.test/'); await page.addStyleTag({ content: css + (bundle.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '') });
    await page.evaluate((config) => { window.config = { initial: null, lang: 'es', ...config }; }, config);
    const script = config.strict ? strictBundle : bundle;
    await page.addScriptTag({ content: script.outputFiles.find((f) => f.path.endsWith('.js')).text });
    await page.getByTestId('working-document').waitFor();
  }
  const emit = (event) => page.evaluate((event) => window.emit(event), event);
  try {
    await t.test('startup download progress and completion never interrupt work', async () => {
      await fresh({ startup: true, initial: { ...ready, status: 'downloading', downloadedVersion: null, progress: 20 } });
      await page.getByRole('progressbar').waitFor();
      assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '20');
      assert.match(await page.getByTestId('update-ready-notice').innerText(), /5.2.0/);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByTestId('working-document').fill('Trabajo sin perder');
      await emit(ready); await page.getByTestId('update-ready-notice').waitFor();
      assert.equal(await page.getByTestId('working-document').inputValue(), 'Trabajo sin perder');
      assert.equal(await page.getByTestId('working-document').evaluate((e) => document.activeElement === e), true, 'arrival must not steal focus');
      await page.getByRole('button', { name: 'Más tarde', exact: true }).click();
      await page.getByTestId('update-ready-notice').waitFor({ state: 'detached' });
      await page.getByTestId('update-indicator').waitFor(); assert.equal(await page.evaluate(() => window.installs), 0);
      await page.getByTestId('settings-toggle').click();
      await page.getByTestId('settings-status').getByRole('button', { name: 'Instalar y reiniciar' }).waitFor();
      await page.getByTestId('settings-toggle').click(); await page.getByTestId('settings-toggle').click();
      await page.getByTestId('settings-status').getByRole('button', { name: 'Instalar y reiniciar' }).waitFor();
      await page.getByTestId('update-indicator').click(); await page.getByTestId('update-ready-notice').waitFor();
      await page.getByTestId('update-ready-notice').getByRole('button', { name: 'Instalar y reiniciar' }).click();
      assert.equal(await page.evaluate(() => window.installs), 1);
      await page.getByText('Creando y verificando una copia de seguridad antes de actualizar…', { exact: true }).first().waitFor();
      assert.equal(await page.getByTestId('update-ready-notice').getByRole('button', { name: 'Instalar y reiniciar' }).count(), 0);
      await page.evaluate((event) => window.finishInstall(event), { ...ready, status: 'installing' });
      await page.getByTestId('update-ready-notice').getByText('Instalando Nodus 5.2.0 y reiniciando…', { exact: true }).waitFor();
    });
    await t.test('startup checking disappears when current, and later checks/downloads remain silent', async () => {
      await fresh({ startup: true, holdCheck: true, strict: true });
      await page.getByText('Buscando actualizaciones…', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.checks), 1, 'StrictMode must not duplicate the startup request');
      const current = { status: 'not-available', message: '', version: '5.1.7', downloadedVersion: null };
      await emit({ status: 'checking', message: '' });
      await page.evaluate((event) => window.resolveCheck(event), current);
      await page.getByTestId('update-ready-notice').waitFor({ state: 'detached' });
      for (const status of ['checking', 'available', 'downloading', 'error', 'not-available']) {
        await emit({ ...current, status, progress: 45 });
        assert.equal(await page.getByTestId('update-ready-notice').count(), 0, status);
      }
      await emit(ready);
      await page.getByTestId('update-ready-notice').waitFor();
    });
    await t.test('startup errors disappear automatically and disabled updates leave no banner', async () => {
      await fresh({ startup: true, rejectCheck: true });
      await page.getByText('No se pudo comprobar si hay actualizaciones.', { exact: true }).waitFor();
      await page.getByTestId('update-ready-notice').waitFor({ state: 'detached' });
      await emit({ status: 'checking', message: '' });
      assert.equal(await page.getByTestId('update-ready-notice').count(), 0);
      await fresh({ startup: true, initial: { status: 'disabled', message: '' } });
      await page.getByTestId('update-ready-notice').waitFor({ state: 'detached' });
    });
    await t.test('session reload skips the startup check but restores a pending installer', async () => {
      await fresh({ startup: true, checked: true, initial: ready });
      await page.getByTestId('update-ready-notice').waitFor();
      assert.equal(await page.evaluate(() => window.checks), 0);
    });
    await t.test('a late startup response cannot replace live download progress or completion', async () => {
      await fresh({ startup: true, holdCheck: true });
      await emit({ ...ready, status: 'downloading', downloadedVersion: null, progress: 68 });
      await page.getByRole('progressbar').waitFor();
      await page.evaluate(() => window.resolveCheck({ status: 'available', version: '5.2.0', message: '' }));
      assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '68');
      if (process.env.UPDATE_QA_DIR) {
        for (const theme of ['light', 'dark']) {
          await page.evaluate((theme) => { document.documentElement.className = theme; }, theme);
          await page.screenshot({ path: path.join(process.env.UPDATE_QA_DIR, `downloading-${theme}.png`) });
        }
        await page.setViewportSize({ width: 420, height: 700 });
        await page.screenshot({ path: path.join(process.env.UPDATE_QA_DIR, 'downloading-narrow.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await emit(ready);
      await page.getByRole('button', { name: 'Instalar y reiniciar' }).waitFor();
    });
    await t.test('a stale initial snapshot cannot overwrite a downloaded event', async () => {
      await fresh({ holdSnapshot: true }); await emit(ready);
      await page.evaluate(() => window.resolveSnapshot({ status: 'not-available', message: '', version: '5.1.7', downloadedVersion: null }));
      await page.getByTestId('update-indicator').waitFor();
      assert.match(await page.getByTestId('update-ready-notice').innerText(), /5.2.0/);
    });
    await t.test('install failure stays retryable and never displays the untranslated native exception', async () => {
      await fresh({ initial: ready, lang: 'fr' }); await page.getByTestId('update-ready-notice').waitFor();
      await page.evaluate(() => { window.throwInstall = true; });
      await page.getByRole('button', { name: tr('fr', 'Instalar y reiniciar') }).click();
      await page.getByText(tr('fr', 'No se pudo instalar la actualización. Puedes volver a intentarlo.')).waitFor();
      assert.doesNotMatch(await page.locator('body').innerText(), /Untranslated native error/);
      await page.getByRole('button', { name: tr('fr', 'Más tarde'), exact: true }).click();
      await page.getByTestId('update-indicator').click();
      await page.getByRole('button', { name: tr('fr', 'Instalar y reiniciar') }).waitFor();
    });
    await t.test('startup ready state offers install or later in every supported language and theme', async () => {
      for (const lang of languages) for (const theme of ['light', 'dark']) {
        await fresh({ initial: ready, startup: true, lang });
        await page.evaluate((theme) => { document.documentElement.className = theme; }, theme);
        const modal = page.getByTestId('update-ready-notice');
        await modal.waitFor();
        await modal.getByRole('button', { name: tr(lang, 'Instalar y reiniciar') }).waitFor();
        await modal.getByRole('button', { name: tr(lang, 'Más tarde'), exact: true }).click();
        assert.equal(await page.getByTestId('update-ready-notice').count(), 0, `${lang}: later must not immediately reopen the banner`);
        assert.equal(await page.evaluate(() => window.installs), 0);
        await page.getByTestId('update-indicator').click(); await page.getByTestId('update-ready-notice').waitFor();
        if (process.env.UPDATE_QA_DIR && lang === 'es') await page.screenshot({ path: path.join(process.env.UPDATE_QA_DIR, `${theme}.png`) });
      }
    });
    await t.test('recovery failures stay localized and provide the recovery action', async () => {
      for (const lang of languages) {
        await fresh({ lang, initial: { ...ready, status: 'error', errorCode: 'pre-update-backup-required' } });
        await page.getByRole('button', { name: tr(lang, 'Configurar Recuperación') }).waitFor();
        assert.match(await page.getByTestId('update-ready-notice').innerText(), new RegExp(tr(lang, 'Configura Recuperación antes de instalar una beta. La actualización permanece descargada y tus datos no se han modificado.').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
