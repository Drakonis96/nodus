// The notebook dialog: a name and collections, as the Library shows them. Nodus and Zotero
// folders carry their N or Z; a folder brings its subfolders; nothing else is asked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('notebook dialog: collections only, hierarchical, N/Z marks, subfolders included', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-notebook-dialog-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/research-notebook-dialog/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.svg': 'dataurl' } });
    const css = componentStyles();
    const open = async (initial = {}) => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 820 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://notebook.test/', route => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
      await page.goto('http://notebook.test/');
      for (const file of [css, path.join(root, 'src/views/researchAssistant.css'), path.join(root, 'src/components/headerBalloon.css'), path.join(root, 'src/components/collectionSourceIcon.css')]) await page.addStyleTag({ content: await readFile(file, 'utf8') });
      await page.evaluate(initial => { window.initial = initial; }, initial);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const dialog = page.getByTestId('research-notebook-dialog');
      await dialog.getByRole('treeitem').first().waitFor();
      return { page, dialog, errors };
    };

    await t.test('only a name and collections; no depth, prompt, effort, threshold or Zotero settings', async () => {
      const { page, dialog, errors } = await open();
      assert.equal(await dialog.getAttribute('aria-label'), 'Nuevo cuaderno');
      const text = await dialog.innerText();
      for (const gone of ['Profundidad', 'Umbral', 'System prompt', 'Esfuerzo', 'Selección de fuentes', 'Zotero MCP', 'Preparar']) assert.doesNotMatch(text, new RegExp(gone), `${gone} is not asked`);
      assert.deepEqual(await dialog.locator('.research-notebook-tree > [role="treeitem"] .research-notebook-name').allInnerTexts(), ['Archivo', 'Tesis', 'Riegos'], 'Nodus first, then Zotero, alphabetical');
      assert.deepEqual(await dialog.locator('.research-notebook-tree > [role="treeitem"] .collection-source-icon').evaluateAll(icons => icons.map(icon => icon.dataset.origin)), ['nodus', 'nodus', 'zotero']);
      const footer = await dialog.locator('footer').boundingBox();
      const frame = await dialog.boundingBox();
      assert.ok(footer.y + footer.height <= frame.y + frame.height + 1, 'Cancel and Create stay in view');
      assert.equal(await dialog.getByRole('button', { name: 'Crear cuaderno' }).isDisabled(), true, 'a name and a collection are required');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await t.test('a folder brings its subfolders; only the folder is saved, with its descendants', async () => {
      const { page, dialog } = await open();
      const thesis = dialog.getByTestId('notebook-collection-thesis');
      await thesis.getByRole('button', { name: 'Desplegar' }).click();
      assert.deepEqual(await dialog.locator('[role="treeitem"] [role="treeitem"] .research-notebook-name').allInnerTexts(), ['Capítulo 1', 'Capítulo 2']);
      await dialog.getByTestId('notebook-collection-ch2').getByRole('checkbox').check();
      await thesis.getByRole('checkbox').check();
      for (const child of ['ch1', 'ch2']) {
        const box = dialog.getByTestId(`notebook-collection-${child}`).getByRole('checkbox');
        assert.equal(await box.isChecked(), true, `${child} is included`);
        assert.equal(await box.isDisabled(), true, `${child} follows its folder`);
      }
      assert.match(await dialog.getByTestId('notebook-collection-ch1').locator('label').getAttribute('title'), /Incluida en «Tesis»/);
      assert.match(await dialog.getByTestId('research-notebook-summary').innerText(), /3 documentos · 2 ya indexados/);
      await dialog.getByLabel('Nombre', { exact: true }).fill('Tesis completa');
      await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-notebook-dialog.png') });
      await dialog.getByRole('button', { name: 'Crear cuaderno' }).click();
      await page.waitForFunction(() => window.savedId);
      const saved = await page.evaluate(() => window.saved[0]);
      assert.equal(saved.mode, 'linked');
      assert.deepEqual(saved.sources, [{ kind: 'library-collection', id: 'thesis', includeDescendants: true }], 'the top folder alone, with its subfolders');
      assert.deepEqual(saved.exclusions, []);
      assert.equal(saved.conversationSettings, undefined, 'prompt and effort are chosen in the chat');
      await page.close();
    });

    await t.test('searching shows matches with their folders; editing an old notebook keeps its look and warns about loose documents', async () => {
      const { page, dialog } = await open({ existing: true });
      assert.equal(await dialog.getAttribute('aria-label'), 'Editar cuaderno');
      await dialog.getByText('Este cuaderno tenía documentos sueltos', { exact: false }).waitFor();
      await dialog.getByRole('searchbox', { name: 'Buscar colecciones' }).fill('noria');
      assert.deepEqual(await dialog.locator('.research-notebook-name').allInnerTexts(), ['Riegos', 'Norias'], 'a match shows under its folder');
      await dialog.getByRole('searchbox', { name: 'Buscar colecciones' }).fill('');
      await dialog.getByRole('button', { name: 'Guardar' }).click();
      await page.waitForFunction(() => window.savedId);
      const saved = await page.evaluate(() => window.saved[0]);
      assert.deepEqual(saved.sources, [{ kind: 'library-collection', id: 'ch2', includeDescendants: true }], 'only its collections survive');
      assert.deepEqual([saved.icon, saved.color], ['flask', '#ef4444']);
      await page.close();
    });
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
