import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, chromium } from 'playwright-core';
import { withServer } from './lib/nodusServerHarness.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';

const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const output = path.join(root, 'output/qa/scriptor-block-controls');
await mkdir(output, { recursive: true });
const text = value => ({ type: 'text', text: value, styles: {} });
const block = (id, type, value = '', props = {}, children = []) => ({ id, type, props, content: [text(value)], children });
const source = { id: 'vault:alignment-source', refId: 'alignment-source', scope: 'vault', metadata: { title: 'Research and evidence', itemType: 'book', creators: [{ creatorType: 'author', lastName: 'Smith' }], year: 2021, publisher: 'University Press' } };
const citation = { citationId: 'alignment-citation', citationItems: [{ id: source.id, locator: '12', label: 'page' }], sources: [source], noteIndex: 0, placement: 'in-text' };
const native = [
  block('short', 'paragraph', 'Un párrafo breve para comprobar la alineación.'),
  { ...block('long', 'paragraph'), content: [text('La investigación exige conservar la relación entre una afirmación y las fuentes que permiten sostenerla. '), { type: 'nodusCitation', props: { payload: JSON.stringify(citation), label: '' } }, { type: 'nodusFootnote', props: { noteId: 'alignment-note', label: '1' } }] },
  ...[1, 2, 3, 4, 5, 6].map(level => block('heading-' + level, 'heading', 'Encabezado ' + level, { level })),
  block('list', 'bulletListItem', 'Una entrada de lista', {}, [block('nested', 'bulletListItem', 'Una entrada anidada')]),
  block('numbered', 'numberedListItem', 'Lista numerada'),
  block('quote', 'quote', 'El contexto de la fuente acompaña al argumento.'),
  block('code', 'codeBlock', 'const evidence = true;', { language: 'javascript' }),
  { ...block('table', 'table'), content: { type: 'tableContent', rows: [{ cells: [[text('Fuente')], [text('Evidencia')]] }, { cells: [[text('Archivo')], [text('Memoria')]] }] } },
  { id: 'media', type: 'image', props: { url: '' }, children: [] },
  { ...block('empty', 'paragraph'), content: [] },
];
const metadata = { formatVersion: 1, style: 'apa', locale: 'es-ES', placement: 'in-text', notes: { 'alignment-note': { placement: 'footnote', document: [block('note-text', 'paragraph', 'Nota explicativa.')] } }, evidence: [] };
const checkedIds = ['short', 'long', ...[1, 2, 3, 4, 5, 6].map(level => 'heading-' + level), 'list', 'nested', 'numbered', 'quote', 'code', 'table', 'media', 'empty'];
const checks = [], screenshots = [], errors = [];

async function measure(page, id) {
  const target = page.locator(`.bn-editor [data-id="${id}"] .bn-block-content`).first();
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 100);
  await target.hover();
  await page.locator('.bn-side-menu').waitFor();
  await page.waitForFunction(id => {
    const content = document.querySelector(`.bn-editor [data-id="${id}"] .bn-block-content`);
    const line = content?.querySelector('.bn-inline-content,.bn-add-file-button,td p,th p'), menu = document.querySelector('.bn-side-menu');
    if (!line || !menu) return false;
    const box = line.getBoundingClientRect(), style = getComputedStyle(line), control = menu.getBoundingClientRect();
    const height = line.matches('.bn-add-file-button') ? box.height : (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2);
    return Math.abs(control.y + control.height / 2 - box.y - height / 2) <= 1;
  }, id);
  const geometry = await target.evaluate(content => {
    const line = content.querySelector('.bn-inline-content,.bn-add-file-button,td p,th p'), box = line.getBoundingClientRect(), style = getComputedStyle(line);
    const height = line.matches('.bn-add-file-button') ? box.height : (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2);
    const buttons = [...document.querySelectorAll('.bn-side-menu button')].map(button => { const rect = button.getBoundingClientRect(); return { center: rect.y + rect.height / 2, left: rect.left, right: rect.right }; });
    return { lineCenter: box.y + height / 2, buttons };
  });
  assert.equal(geometry.buttons.length, 2);
  for (const button of geometry.buttons) assert.ok(Math.abs(button.center - geometry.lineCenter) <= 1, `both controls align with ${id}`);
  return geometry;
}

async function round(page, name) {
  for (const id of checkedIds) {
    let geometry;try {geometry=await measure(page,id);}catch(error){await page.screenshot({path:path.join(output,name+'-'+id+'-failure.png')});console.error('Alignment failure:',name,id,await page.locator('.bn-side-menu').boundingBox(),await page.locator(`.bn-editor [data-id="${id}"] .bn-block-content`).first().evaluate(el=>({html:el.outerHTML,lines:[...el.querySelectorAll('.bn-inline-content,.bn-add-file-button,td p,th p')].map(line=>({tag:line.tagName,rect:line.getBoundingClientRect().toJSON(),lineHeight:getComputedStyle(line).lineHeight}))})));throw error;} checks.push({ name, id, ...geometry });
    if (['long', 'heading-1', 'nested'].includes(id)) {
      const file = name + '-' + id + '.png'; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
    }
  }
}

async function buttonsWork(page) {
  await measure(page, 'short');
  await page.locator('.bn-side-menu button[draggable=true]').click();
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await measure(page, 'short');
  const count = await page.locator('.bn-editor .bn-block[data-node-type=blockContainer]').count();
  await page.locator('.bn-side-menu button').first().click();
  await page.getByRole('listbox').waitFor();
  assert.equal(await page.locator('.bn-editor .bn-block[data-node-type=blockContainer]').count(), count + 1);
  await page.keyboard.press('Escape'); await page.locator('.bn-editor').focus(); await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(count => document.querySelectorAll('.bn-editor .bn-block[data-node-type=blockContainer]').length === count, count);
}

async function desktop() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-block-controls-'));
  const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], env }); const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
    await page.evaluate(async version => {
      for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1', 'nodus.sidebarWidth': '246' })) localStorage.setItem(key, value);
      sessionStorage.setItem('nodus.startupUpdateChecked', '1'); await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 }); await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: true, academicMode: 'manual' });
    }, require('../package.json').version); await page.reload();
    const id = await page.evaluate(async ({ native, metadata }) => { const note = await window.nodus.createNote({ title: 'Alineación de controles', content: '' }); await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '', nativeDocument: native, academicMetadata: metadata }); return note.id; }, { native, metadata });
    await page.locator('[data-tour="nav-workspace"]').click(); await page.getByTestId('workspace-item-' + id).click(); await page.locator('.bn-editor').waitFor();
    const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' }); if (await warning.isVisible().catch(() => false)) await warning.click();
    const before = await page.evaluate(id => window.nodus.getWorkspaceNoteEditorData(id), id);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
      for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080]]) { await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height }); await page.setViewportSize({ width, height }); await round(page, 'desktop-' + theme + '-' + width); }
    }
    for (const [fontFamily, fontSize, lineHeight, paragraphSpacing] of [['sans', 26, 2.1, 1.6], ['mono', 16, 1.2, 0]]) {
      await page.evaluate(async ({ id, style }) => { const data=await window.nodus.getWorkspaceNoteEditorData(id); await window.nodus.updateWorkspaceNote(id, { title:data.documentTitle, contentMarkdown:data.contentMarkdown, nativeDocument:data.nativeDocument, style, expectedRevision:data.revision }); }, { id, style: { ...before.style, fontFamily, fontSize, lineHeight, paragraphSpacing } });
      await page.reload(); await page.locator('[data-tour="nav-workspace"]').click(); if (!await page.locator('.bn-editor').count()) await page.getByTestId('workspace-item-' + id).click(); await page.locator('.bn-editor').waitFor(); await round(page, 'desktop-custom-' + fontFamily);
    }
    assert.deepEqual((await page.evaluate(id => window.nodus.getWorkspaceNoteEditorData(id), id)).nativeDocument, before.nativeDocument, 'hovering does not change native content');
    await buttonsWork(page); console.log('Desktop: first-line alignment and native add/drag-menu controls passed.');
  } finally { await app?.close(); await rm(profile, { recursive: true, force: true }); }
}

async function web() {
  await withServer({ label: 'block-controls', ai: true }, async server => {
    const vaultId = await server.createSpace('Controles editoriales'); await server.setPublicationPolicy(vaultId, ['allowUserContent']);
    const publisher = await server.deviceToken(server.adminEmail, server.adminPassword, vaultId, 'Block controls fixture');
    await publish(server.origin, publisher.deviceToken, vaultId, academicSnapshot());
    const user = await server.createUser('controls@example.test', 'controls-password-long', [{ spaceId: vaultId, role: 'reader' }]);
    const cookie = await server.signIn(user.email, user.password), csrf = await server.csrf(cookie);
    const response = await fetch(server.origin + '/api/v2/me/artifacts', { method: 'POST', headers: { cookie, origin: server.origin, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ vaultId, kind: 'workspace-note', title: 'Alineación de controles', content: '', metadata: { surface: 'workspace', nativeDocument: native, academicMetadata: metadata } }) }); assert.equal(response.status, 201); const { artifact } = await response.json();
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.origin + '/login'); await page.locator('#login-email').fill(user.email); await page.locator('#login-password').fill(user.password); await page.locator('button[type=submit]').click(); await page.waitForURL(server.origin + '/');
      await page.getByTestId('header-vault-badge').click(); await page.getByTestId('vault-option-' + vaultId).click(); await page.goto(server.origin + '/view/workspace'); await page.getByTestId('workspace-server-item-' + artifact.id).getByRole('button').first().click(); await page.locator('.bn-editor').waitFor();
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark')) await page.getByTestId('theme-toggle').click();
        for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080]]) { await page.setViewportSize({ width, height }); await round(page, 'web-' + theme + '-' + width); }
      }
      await buttonsWork(page); console.log('Web: first-line alignment and native add/drag-menu controls passed.');
    } finally { await browser.close(); }
  });
}

const results = await Promise.allSettled([desktop(), web()]);
for (const result of results) if (result.status === 'rejected') console.error(result.reason);
for (const result of results) if (result.status === 'rejected') throw result.reason;
assert.deepEqual(errors, []);
await writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, screenshots, errors }, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nodus Scriptor · alineación de controles</title>
<style>body{margin:32px;background:#fafafa;color:#27272a;font:15px system-ui}h1{font-size:25px}main{display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(440px,1fr))}figure{margin:0}img{display:block;width:100%;border:1px solid #ddd;border-radius:8px}figcaption{padding:8px 0;font-size:13px}@media(max-width:520px){body{margin:16px}main{grid-template-columns:1fr}}</style>
<h1>Alineación de controles de bloque</h1><p>${checks.length} comprobaciones · ${screenshots.length} capturas · escritorio y web.</p>
<main>${screenshots.map(file => `<figure><a href="${file}"><img loading="lazy" src="${file}" alt="${file.replace(/\.png$/, '')}"></a><figcaption>${file.replace(/\.png$/, '')}</figcaption></figure>`).join('\n')}</main></html>`);
console.log(`PASS: ${checks.length} block alignment checks and ${screenshots.length} screenshots.`);
