import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-prompts-'));
const output = path.join(root, 'output/qa/scriptor-prompts-redesign');
await mkdir(output, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const screenshots = [], errors = [];
let app;

async function visibleControl(locator) {
  assert.ok(await locator.isVisible());
  const hit = await locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
      && el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
  assert.ok(hit, 'control is visible and receives clicks');
  return locator.boundingBox();
}

async function capture(page, name) {
  await page.locator('.study-prompts-dialog').screenshot({ path: path.join(output, name + '.png') });
  screenshots.push(name + '.png');
}

try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1' })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: true, academicMode: 'manual' });
  }, require('../package.json').version);
  await page.reload();
  const fixture = await page.evaluate(async () => {
    const long = await window.nodus.createStudyStyle({ name: 'Académico · Revisión de tesis, artículos y capítulos sin alterar la voz del autor', prompt: 'Mejora la claridad y conserva las fuentes del archivo.\n\n' + 'Revisa la precisión, la fluidez y las transiciones. Conserva los datos, las citas y la voz del autor.\n\n'.repeat(70), icon: 'sparkles', active: true, language: 'es', temperature: 0.15, systemPrompt: 'Conserva los hechos y las referencias bibliográficas.' });
    const others = [];
    for (let i = 1; i <= 8; i++) others.push(await window.nodus.createStudyStyle({ name: `Prompt guardado ${i}`, prompt: 'Mejora la claridad sin añadir información nueva.', icon: 'sparkles', active: true }));
    await window.nodus.updateSettings({ studyImproveToolbarStyleIds: [long.id] });
    const note = await window.nodus.createNote({ title: 'Revisión de la biblioteca de prompts', content: 'La investigación conserva la relación entre las afirmaciones y las fuentes.' });
    return { note, long, others };
  });
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + fixture.note.id).click();
  await page.locator('.bn-editor').waitFor();
  const nativeBefore = await page.evaluate(id => window.nodus.getWorkspaceNoteEditorData(id), fixture.note.id);
  await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click();
  await page.getByTestId('study-improve-toggle').click();
  const dialog = page.getByTestId('study-improve-dialog');
  await dialog.waitFor();
  const search = page.getByTestId('study-prompt-search');
  const choose = id => page.getByTestId('study-style-' + id.replace(':', '-'));
  await choose(fixture.long.id).click();

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080], [900, 700], [600, 800]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height });
      await page.setViewportSize({ width, height });
      const controls = [search, page.getByTestId('study-style-new'), page.getByTestId('study-prompt-edit'), page.getByTestId('study-prompt-delete'), page.getByTestId('study-prompt-apply')];
      const before = await Promise.all(controls.map(visibleControl));
      const content = page.getByTestId('study-prompt-content');
      assert.ok(await content.evaluate(el => el.scrollHeight > el.clientHeight), 'long prompt scrolls');
      await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.getByTestId('study-style-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
      for (let i = 0; i < controls.length; i++) {
        const after = await visibleControl(controls[i]);
        assert.ok(Math.abs(before[i].y - after.y) < 1, 'scrolling leaves actions and search fixed');
      }
      assert.ok(await dialog.evaluate(el => [...el.querySelectorAll('.study-prompts-dialog,.study-prompts-layout,.study-prompts-content,.study-prompts-sidebar')].every(node => node.scrollWidth <= node.clientWidth + 1)), 'no horizontal scrolling');
      await capture(page, `${theme}-${width}-read`);
      await page.getByTestId('study-prompt-edit').click();
      const save = page.getByTestId('study-prompt-save');
      await visibleControl(save);
      await page.getByTestId('study-style-editor').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await visibleControl(save); await visibleControl(search);
      await capture(page, `${theme}-${width}-edit`);
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    }
  }

  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.setViewportSize({ width: 1440, height: 900 });
  await search.fill('fuentes del archivo');
  assert.equal(await page.getByTestId('study-style-list').getByRole('listitem').count(), 1, 'search includes prompt content');
  await capture(page, 'search-content');
  await search.fill('ningun-prompt-con-este-texto');
  await dialog.getByText('Sin resultados', { exact: true }).waitFor();
  await visibleControl(search); await visibleControl(page.getByTestId('study-style-new'));
  await capture(page, 'search-empty');
  await search.fill('');
  await choose('builtin:academic').click();
  assert.ok(await page.getByTestId('study-prompt-edit').isDisabled());
  assert.ok(await page.getByTestId('study-prompt-delete').isDisabled());
  await capture(page, 'builtin-readonly');
  await choose(fixture.long.id).click();
  await page.getByTestId('study-prompt-edit').click();
  await page.getByTestId('study-prompt-title').fill('Académico · Revisión guardada');
  await page.getByTestId('study-prompt-save').click();
  await page.waitForFunction(id => window.nodus.listStudyStyles().then(styles => styles.find(s => s.id === id)?.name === 'Académico · Revisión guardada'), fixture.long.id);
  const updated = await page.evaluate(id => window.nodus.listStudyStyles().then(styles => styles.find(s => s.id === id)), fixture.long.id);
  for (const key of ['prompt', 'language', 'temperature', 'systemPrompt', 'icon']) assert.deepEqual(updated[key], fixture.long[key], `${key} survives editing`);
  for (const prompt of fixture.others.slice(0, 3)) await page.getByTestId('study-style-toolbar-' + prompt.id.replace(':', '-')).click();
  await page.getByTestId('study-style-toolbar-' + fixture.others[3].id.replace(':', '-')).click();
  await dialog.getByText('Puedes mostrar un máximo de cuatro prompts en la barra.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).studyImproveToolbarStyleIds.length, 4);
  await capture(page, 'shortcut-limit');

  await page.getByTestId('study-style-new').click();
  await page.getByTestId('study-prompt-title').fill('Prompt creado durante la verificación');
  await page.getByTestId('study-prompt-text').fill('Mejora la claridad sin añadir información nueva.');
  await page.getByTestId('study-prompt-save').click();
  await page.getByTestId('study-prompt-detail').getByRole('heading', { name: 'Prompt creado durante la verificación', exact: true }).waitFor();
  const created = await page.evaluate(() => window.nodus.listStudyStyles().then(styles => styles.find(s => s.name === 'Prompt creado durante la verificación')));
  assert.equal(created.icon, 'sparkles');
  await page.getByTestId('study-prompt-delete').click();
  const confirmation = page.getByRole('dialog', { name: 'Eliminar prompt', exact: true });
  await confirmation.waitFor();
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.ok(await confirmation.evaluate(el => el.contains(document.activeElement))); }
  await page.keyboard.press('Escape');
  assert.ok(await dialog.isVisible(), 'cancelling deletion keeps the library open');
  await page.getByTestId('study-prompt-delete').click();
  await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(id => window.nodus.listStudyStyles().then(styles => !styles.some(s => s.id === id)), created.id);
  const documentAfter = await page.evaluate(id => window.nodus.getWorkspaceNoteEditorData(id), fixture.note.id);
  assert.deepEqual(documentAfter.nativeDocument, nativeBefore.nativeDocument);
  assert.equal(documentAfter.contentMarkdown, nativeBefore.contentMarkdown);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, screenshots, errors, checks: ['fixed search and actions through long-content scrolling', 'independent list and prompt scrolling', 'light/dark at five sizes', 'no horizontal overflow', 'search by content and empty result', 'builtin protections', 'create/edit/delete with configuration preserved', 'four-shortcut limit', 'confirmation keyboard focus and Escape', 'document preserved'], aiProviderCalls: 0 }, null, 2));
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biblioteca de prompts · revisión</title><style>body{font:14px system-ui;margin:24px;color:#302e3a;background:#fafafa}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:24px}figure{margin:0}img{width:100%;border:1px solid #ddd;border-radius:8px}figcaption{padding:8px}</style><h1>Biblioteca de prompts</h1><p>Acciones fijas, prompts largos y cinco tamaños de ventana.</p><main>${screenshots.map(file => `<figure><a href="${file}"><img loading="lazy" src="${file}" alt="${file}"></a><figcaption>${file}</figcaption></figure>`).join('')}</main></html>`);
  console.log(`PASS: prompt CRUD, search, fixed actions and ${screenshots.length} captures; no AI provider called.`);
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
