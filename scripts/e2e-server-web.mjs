import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright-core';
import { academicSnapshot, PDF_BYTES, PNG_BYTES } from './lib/nodusServerFixtures.mjs';
import { postForm, repoRoot, withServer } from './lib/nodusServerHarness.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = path.join(repoRoot, 'reports', 'server-web-qa', 'final', 'screenshots');
await mkdir(output, { recursive: true });

function builtSnapshot(payload) {
  const revision = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  return { payload, revision, gzipped: gzipSync(Buffer.from(JSON.stringify(payload))) };
}

async function enablePolicy(server, spaceId, fields) {
  const response = await postForm(`${server.origin}/admin/spaces/policy`, {
    csrf: await server.csrf(), spaceId, ...Object.fromEntries(fields.map((field) => [field, 'on'])),
  }, { headers: { cookie: server.adminCookie } });
  assert.equal(response.status, 303);
}

async function login(page, origin, email, password) {
  await page.goto(`${origin}/login?next=/app`, { waitUntil: 'networkidle' });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([page.waitForURL(/\/app/), page.locator('button[type="submit"]').click()]);
  await page.getByTestId('overview-view').waitFor();
}

async function waitForView(page, testId, consoleErrors, serverLogs = []) {
  try {
    await page.getByTestId(testId).waitFor();
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      `Server web did not render ${testId}.`,
      `URL: ${page.url()}`,
      `Body: ${body.slice(0, 2_000)}`,
      `Browser errors: ${consoleErrors.join(' | ') || '(none)'}`,
      `Server log tail: ${serverLogs.join('').slice(-2_000) || '(none)'}`,
    ].join('\n'), { cause: error });
  }
}

await withServer({ label: 'server-web-e2e', ai: true }, async (server) => {
  const academicId = await server.createSpace('Atlas de memoria');
  const worldId = await server.createSpace('Crónicas de Asteria');
  await enablePolicy(server, academicId, ['allowUserContent', 'allowLibraryDocuments', 'allowPassages']);
  const academicOwner = await server.deviceToken(server.adminEmail, server.adminPassword, academicId, 'Academic publisher');
  const worldOwner = await server.deviceToken(server.adminEmail, server.adminPassword, worldId, 'World publisher');

  const zip = new AdmZip();
  zip.addFile('document.md', Buffer.from('# Archivo, memoria y ciudad\n\nLa memoria colectiva transforma el archivo en un espacio vivo.\n\n## Una lectura conectada\n\nSelecciona este párrafo para guardar un subrayado privado.\n\n![Mapa conceptual](assets/figure.png)'));
  zip.addFile('assets/figure.png', PNG_BYTES);
  zip.addFile('original/document.pdf', PDF_BYTES);
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'nodus.library-document-package', formatVersion: 2, documentId: 'library-doc-1',
    title: 'Archivo, memoria y ciudad', figures: 1, cleanMarkdown: true,
    original: { path: 'original/document.pdf', fileName: 'archivo-memoria.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES.length },
  })));
  const packageBytes = zip.toBuffer();
  const packageHash = createHash('sha256').update(packageBytes).digest('hex');
  const upload = await server.api(academicOwner.deviceToken, 'PUT', `/api/v1/spaces/${academicId}/library/packages/${packageHash}`, { body: packageBytes, headers: { 'content-type': 'application/zip' } });
  assert.equal(upload.status, 200, await upload.text());

  const academic = academicSnapshot();
  academic.payload.tables.dictionary_entries = [{
    id: 'dictionary-1', name: 'Memoria colectiva', aliases_json: '[]', focus_prompt: '',
    scope_kind: 'vault', scope_json: '{"kind":"vault"}', output_language: 'es', detail_level: 'standard',
    tags_json: '["memoria"]', content_markdown: 'Concepto que articula archivo, comunidad y transmisión.',
    status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }];
  academic.payload.library = {
    format: 'nodus.server-library', formatVersion: 1, generatedAt: new Date().toISOString(),
    collections: [{ id: 'collection-1', name: 'Teoría del archivo', icon: null, color: '#8b5cf6', parentId: null, position: 0, directItemCount: 1, updatedAt: new Date().toISOString() }],
    documents: [{ id: 'library-doc-1', title: 'Archivo, memoria y ciudad', itemType: 'book', creators: ['Ada Lovelace'], abstract: 'Una lectura sobre archivos vivos.', date: '1843', year: 1843, language: 'es', publisher: 'Nodus Press', publicationTitle: null, volume: null, issue: null, pages: null, edition: null, place: null, rights: null, doi: null, pmid: null, pmcid: null, arxiv: null, isbn: [], issn: [], url: null, citationKey: 'lovelace1843', reference: 'Lovelace, A. (1843). Archivo, memoria y ciudad.', tags: ['memoria', 'archivo'], collectionIds: ['collection-1'], updatedAt: new Date().toISOString(), cleanAvailable: true, wordCount: 31, figureCount: 1, packageHash, packageBytes: packageBytes.length, originalAvailable: true, originalFileName: 'archivo-memoria.pdf', originalMimeType: 'application/pdf', originalBytes: PDF_BYTES.length }],
  };
  const publishedAcademic = builtSnapshot(academic.payload);
  const publishAcademic = await server.api(academicOwner.deviceToken, 'PUT', `/api/v1/spaces/${academicId}/snapshot`, { body: publishedAcademic.gzipped, headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': publishedAcademic.revision } });
  assert.equal(publishAcademic.status, 200, await publishAcademic.text());

  const world = builtSnapshot({
    format: 'nodus.server-snapshot', formatVersion: 2, generatedAt: new Date().toISOString(), schemaVersion: 121,
    vault: { id: 'world-vault', name: 'Crónicas de Asteria', type: 'worldbuilding' }, capabilities: { hasAssets: false }, assets: [],
    tables: {
      persons: [{ person_id: 'char-1', display_name: 'Iria de Asteria', summary: 'Cartógrafa de las mareas.' }],
      places: [{ place_id: 'place-1', name: 'Puerto de Ceniza', description: 'Ciudad suspendida sobre el mar.' }],
      events: [{ event_id: 'event-1', title: 'La noche de los faros', description: 'Los siete faros se apagaron.' }],
      world_groups: [{ group_id: 'group-1', name: 'La Cofradía del Norte', description: 'Navegantes y cronistas.' }],
      world_scenes: [{ scene_id: 'scene-1', title: 'Llegada al puerto', summary: 'Iria descubre el mapa imposible.' }],
      world_articles: [{ article_id: 'article-1', title: 'Las rutas de sal', content: 'Historia de las rutas antiguas.' }],
      world_rules: [{ rule_id: 'rule-1', title: 'La tinta recuerda', description: 'Todo mapa conserva la intención de quien lo dibuja.' }],
      world_questions: [], world_secrets: [], world_maps: [], world_threads: [], relationships: [],
    },
  });
  const publishWorld = await server.api(worldOwner.deviceToken, 'PUT', `/api/v1/spaces/${worldId}/snapshot`, { body: world.gzipped, headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': world.revision } });
  assert.equal(publishWorld.status, 200, await publishWorld.text());

  const reader = await server.createUser('reader@example.test', 'reader-password-strong', [{ spaceId: academicId, role: 'reader' }, { spaceId: worldId, role: 'reader' }]);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${message.text()} @ ${message.location().url || 'unknown'}`); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`); });

    await page.goto(`${server.origin}/login?next=/app`, { waitUntil: 'networkidle' });
    await page.locator('#organism').waitFor();
    await page.screenshot({ path: path.join(output, '01-login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile login must not overflow horizontally');
    await page.screenshot({ path: path.join(output, '01b-login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(250);
    await page.locator('#login-email').fill(reader.email);
    await page.locator('#login-password').fill(reader.password);
    await Promise.all([page.waitForURL(/\/app/), page.locator('button[type="submit"]').click()]);
    await waitForView(page, 'overview-view', consoleErrors, server.logs);
    await page.screenshot({ path: path.join(output, '02-academic-overview-desktop.png'), fullPage: true });
    await page.getByTestId('header-vault-badge').click();
    await page.getByTestId('vault-switcher').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, '02b-vault-switcher-desktop.png') });
    await page.getByTestId('header-vault-badge').click();

    // The Server uses the canonical Desktop navigation ids, not a parallel
    // collection menu invented for the web surface.
    await page.getByTestId('nav-ideas').click();
    await page.getByTestId('advanced-ideas-view').waitFor();
    await page.getByTestId('advanced-idea-card').first().waitFor();
    assert.equal(await page.getByTestId('advanced-idea-card').count(), 3);
    await page.screenshot({ path: path.join(output, '03-ideas-catalog-desktop.png'), fullPage: true });
    await page.getByTestId('advanced-idea-card').first().click();
    await page.getByTestId('advanced-idea-detail').waitFor();
    assert.equal(await page.getByTestId('advanced-ideas-tabs').locator('button').count() >= 3, true);
    await page.screenshot({ path: path.join(output, '04-idea-tabs-detail-desktop.png'), fullPage: true });

    await page.getByTestId('nav-authors').click();
    await page.getByTestId('advanced-authors-view').waitFor();
    await page.getByTestId('advanced-author-card').first().waitFor();
    assert.equal(await page.getByTestId('advanced-author-card').count() > 0, true);
    await page.getByTestId('advanced-author-card').first().click();
    await page.getByTestId('advanced-author-dossier').waitFor();
    await page.getByTestId('author-synthesis-panel').waitFor();
    await page.screenshot({ path: path.join(output, '05-author-dossier-synthesis-desktop.png'), fullPage: true });

    await page.getByTestId('nav-graph').click();
    await page.getByTestId('advanced-graph-view').waitFor();
    await page.getByTestId('advanced-graph-seed').waitFor();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(output, '06-graph-desktop.png') });

    await page.goto(`${server.origin}/app/view/workspace`, { waitUntil: 'networkidle' });
    await page.getByTestId('private-notes-view').waitFor();
    await page.getByRole('button', { name: 'Nueva nota' }).click();
    await page.locator('.server-note-title').fill('Nota privada E2E');
    await page.locator('.server-note-editor').fill('# Apunte\n\nEste contenido pertenece únicamente al lector.');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.screenshot({ path: path.join(output, '07-private-workspace-desktop.png'), fullPage: true });

    await page.getByTestId('header-assistant').click();
    await page.getByTestId('assistant-view').waitFor();
    await page.screenshot({ path: path.join(output, '08-assistant-private-desktop.png'), fullPage: true });

    await page.goto(`${server.origin}/app/view/dictionary`, { waitUntil: 'networkidle' });
    await page.getByTestId('dictionary-view').waitFor();
    await page.screenshot({ path: path.join(output, '09-dictionary-desktop.png'), fullPage: true });

    await page.getByTestId('nav-library').click();
    await page.getByTestId('library-list').waitFor();
    await page.locator('[data-testid="library-list"] button').first().click();
    await page.getByTestId('markdown-reader').waitFor();
    await page.screenshot({ path: path.join(output, '10-library-reader-desktop.png'), fullPage: true });
    await page.getByTestId('markdown-reader').locator('p').first().evaluate((paragraph) => {
      const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(paragraph); selection?.removeAllRanges(); selection?.addRange(range); paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByTestId('annotation-toggle').click();
    await page.getByTestId('personal-annotations').locator('input').fill('Lectura clave');
    await page.getByTestId('personal-annotations').locator('textarea').fill('Conservar esta idea para la próxima sesión.');
    await page.getByTestId('personal-annotations').locator('button[type="submit"]').click();
    await page.getByTestId('personal-annotations').locator('textarea').waitFor({ state: 'detached' });
    await page.getByTestId('personal-annotations').getByText('Subrayado', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, '11-private-highlight-desktop.png'), fullPage: true });

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('user-ai-settings').waitFor();
    await page.locator('[data-testid="user-ai-settings"] input[type="password"]').first().waitFor();
    assert.equal(await page.locator('[data-testid="user-ai-settings"] input[type="password"]').count(), 6);
    assert.equal(await page.locator('[data-testid="user-ai-settings"] input[type="password"]').first().inputValue(), '', 'saved secrets are never prefilled');
    await page.screenshot({ path: path.join(output, '12-ai-settings-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'AI profile must not overflow on mobile');
    await page.screenshot({ path: path.join(output, '13-ai-settings-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(`${server.origin}/app`, { waitUntil: 'networkidle' });
    await page.getByTestId('header-vault-badge').click();
    await page.getByTestId(`vault-option-${worldId}`).click();
    await page.getByTestId('overview-view').getByRole('heading', { name: 'Crónicas de Asteria' }).waitFor();
    await page.locator('[data-tour="nav-factions"]').click();
    await page.getByTestId('record-list').waitFor();
    await page.screenshot({ path: path.join(output, '14-worldbuilding-desktop.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/app`, { waitUntil: 'networkidle' });
    await page.getByTestId('overview-view').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile app must not overflow horizontally');
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile drawer must stay within the viewport');
    await page.screenshot({ path: path.join(output, '15-mobile-portrait-navigation.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'landscape app must not create global horizontal overflow');
    await page.screenshot({ path: path.join(output, '16-mobile-landscape.png') });
    await context.close();

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${server.origin}/login`, { waitUntil: 'networkidle' });
    await adminPage.locator('#login-email').fill(server.adminEmail);
    await adminPage.locator('#login-password').fill(server.adminPassword);
    await Promise.all([adminPage.waitForURL(/\/$/), adminPage.locator('button[type="submit"]').click()]);
    await adminPage.locator('details.publication-policy').first().evaluate((details) => { details.open = true; });
    await adminPage.screenshot({ path: path.join(output, '17-admin-publication-policy.png'), fullPage: true });
    await adminContext.close();
  } finally {
    await browser.close();
  }
  assert.deepEqual(consoleErrors, [], `browser console errors:\n${consoleErrors.join('\n')}`);
  await writeFile(path.join(output, '..', 'manifest.json'), JSON.stringify({ origin: server.origin, screenshots: 19, consoleErrors }, null, 2));
  if (process.env.NODUS_E2E_INTERACTIVE === '1') {
    console.log(`[server-web-e2e] interactive origin=${server.origin} email=${reader.email} password=${reader.password}`);
    await new Promise((resolve) => process.once('SIGINT', resolve));
  }
});

console.log(`[server-web-e2e] screenshots: ${output}`);
