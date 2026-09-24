// The research chat history in a browser, with synthetic data: Projects, Pinned chats and
// the other chats; search across chats, projects and notebooks; the pin limit; the chat
// menu and moving a chat into a project; renaming a project and its icon and colour.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('research chat history: sections, search, pins, menu and projects', { timeout: 180_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-chat-sidebar-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/research-chat-sidebar/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.svg': 'dataurl' } });
    const css = path.join(dir, 'style.css');
    execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', css, '--minify'], { cwd: root, stdio: 'pipe' });
    const page = await browser.newPage({ viewport: { width: 900, height: 760 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://sidebar.test/', route => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
    await page.goto('http://sidebar.test/');
    await page.addStyleTag({ content: await readFile(css, 'utf8') });
    await page.addStyleTag({ content: await readFile(path.join(root, 'src/views/researchAssistant.css'), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sidebar = page.getByTestId('research-history-sidebar');
    await sidebar.getByTestId('research-chat-search').waitFor();
    const action = async (...expected) => page.waitForFunction(expected => window.actions.some(actual => JSON.stringify(actual) === JSON.stringify(expected)), expected);
    const order = () => sidebar.locator('.research-history-heading, .research-history-row, .research-history-empty').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));

    await t.test('three sections: projects alphabetically, pinned chats, then the rest (project chats stay in their project)', async () => {
      assert.deepEqual(await order(), ['Proyectos', 'Alfa', 'Zeta', 'Chats destacados', 'Sevilla en guías de viaje', 'Chats', 'Réplica y cifras', 'Cartografía medieval']);
      await sidebar.getByTestId('research-project-p-a').click();
      assert.deepEqual((await order()).slice(0, 4), ['Proyectos', 'Alfa', 'Regadío del Tormeral', 'Zeta'], 'a project unfolds its chats');
      await sidebar.getByTestId('research-project-p-a').click();
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Abrir Alfa' }).click();
      await action('openProject', 'p-a');
    });

    await t.test('the search bar finds chats, projects and notebooks, accents aside', async () => {
      const search = sidebar.getByTestId('research-chat-search');
      const icon = await sidebar.locator('.research-chat-search > svg').boundingBox();
      const text = await search.evaluate(input => parseFloat(getComputedStyle(input).paddingLeft));
      const box = await search.boundingBox();
      assert.ok(icon.x + icon.width <= box.x + text, 'the magnifier does not overlap the text');
      await search.fill('replica');
      assert.deepEqual(await order(), ['Chats', 'Réplica y cifras']);
      await search.fill('riego');
      assert.deepEqual(await order(), ['Cuadernos', 'Cuaderno de riegos']);
      await sidebar.getByTestId('research-search-notebook-n1').click();
      await action('notebook', 'n1');
      await search.fill('alf');
      assert.deepEqual(await order(), ['Proyectos', 'Alfa', 'Chats', 'Regadío del Tormeral'], 'a chat is found by its project name too');
      await search.fill('zzz');
      assert.deepEqual(await order(), ['Sin resultados']);
      await search.fill('');
    });

    await t.test('pinning moves a chat to the pinned section; a sixth pin is refused with a message', async () => {
      const row = sidebar.getByTestId('research-conversation-c3');
      await row.hover();
      await row.getByRole('button', { name: 'Destacar chat' }).click();
      await action('pin', 'c3', true);
      assert.deepEqual((await order()).slice(3, 6), ['Chats destacados', 'Sevilla en guías de viaje', 'Réplica y cifras']);
      await page.evaluate(() => { window.pinLimitReached = true; });
      await sidebar.getByTestId('research-conversation-c4').getByRole('button', { name: 'Destacar chat' }).click();
      await sidebar.getByRole('alert').getByText('Solo puedes destacar 5 chats. Quita uno para destacar otro.').waitFor();
      await page.evaluate(() => { window.pinLimitReached = false; });
    });

    await t.test('the chat menu renames, archives, deletes and moves into a project', async () => {
      const row = sidebar.getByTestId('research-conversation-c4');
      await row.getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu', { name: 'Cartografía medieval' });
      assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Renombrar', 'Destacar chat', 'Archivar', 'Eliminar', 'Mover a proyecto']);
      await menu.getByRole('menuitem', { name: 'Mover a proyecto' }).click();
      assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Mover a proyecto', 'Alfa', 'Zeta', 'Nuevo proyecto']);
      await menu.getByRole('menuitem', { name: 'Zeta' }).click();
      await action('move', 'c4', 'p-z');
      await menu.waitFor({ state: 'detached' });
      assert.ok(!(await order()).includes('Cartografía medieval'), 'a chat in a project leaves the general list');
      // A pinned chat shows only its pin until the row is hovered or focused.
      await sidebar.getByTestId('research-conversation-c3').hover();
      await sidebar.getByTestId('research-conversation-c3').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Renombrar' }).click();
      const rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('Réplica revisada'); await rename.press('Enter');
      await action('rename', 'c3', 'Réplica revisada');
      await sidebar.getByTestId('research-conversation-c3').focus();
      await sidebar.getByTestId('research-conversation-c3').getByRole('button', { name: 'Más acciones' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
    });

    await t.test('a new project appears in order and is named in place; its menu sets icon and colour', async () => {
      await sidebar.getByTestId('research-new-project').click();
      await action('newProject');
      const rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('Archivo municipal'); await rename.press('Enter');
      await page.waitForFunction(() => window.actions.some(entry => entry[0] === 'updateProject' && entry[2]?.name === 'Archivo municipal'));
      assert.deepEqual((await order()).slice(0, 4), ['Proyectos', 'Alfa', 'Archivo municipal', 'Zeta']);
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Icono y color' }).click();
      const dialog = page.getByTestId('research-project-style');
      assert.ok(await dialog.locator('.research-project-icon').count() > 30, 'more icons than the basic set');
      await dialog.getByRole('button', { name: 'globe' }).click();
      await action('updateProject', 'p-a', { icon: 'globe' });
      await dialog.getByRole('button', { name: '#ef4444' }).click();
      await action('updateProject', 'p-a', { color: '#ef4444' });
      await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-project-style.png') });
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Eliminar proyecto' }).click();
      await page.getByRole('dialog').getByText('Sus chats no se borran', { exact: false }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
      await action('deleteProject', 'p-a');
    });
    await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-chat-sidebar.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
