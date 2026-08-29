import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { publish } from './lib/nodusServerFixtures.mjs';
import { repoRoot, withServer } from './lib/nodusServerHarness.mjs';

// This is intentionally an isolated Server Web audit. It never connects to the
// developer's Nodus instance (including :7443) and uses withServer's temporary
// data directory, which is removed after the run.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = path.join(repoRoot, 'reports', 'server-web-qa', 'worldbuilding-genealogy');
await mkdir(output, { recursive: true });

const stamp = '2026-08-27T12:00:00.000Z';

function snapshot(type, name, tables) {
  const payload = {
    format: 'nodus.server-snapshot',
    formatVersion: 2,
    generatedAt: stamp,
    schemaVersion: 121,
    vault: { id: `${type}-fixture`, name, type },
    capabilities: { hasAssets: false },
    assets: [],
    tables,
  };
  const revision = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  return { revision, gzipped: gzipSync(Buffer.from(JSON.stringify(payload))) };
}

const genealogyTables = {
  persons: [
    { person_id: 'g-person-1', display_name: 'Amalia Serrano', birth_date: '1890-02-03', sex: 'female', notes: 'Investigadora del puerto.', updated_at: stamp },
    { person_id: 'g-person-2', display_name: 'Tomás Vidal', birth_date: '1914-04-12', sex: 'male', notes: 'Hijo documentado.', updated_at: stamp },
    { person_id: 'g-person-3', display_name: 'Elena Vidal', birth_date: '1939-06-22', sex: 'female', notes: 'Persona sin vínculo directo en esta muestra.', updated_at: stamp },
  ],
  relationships: [
    { rel_id: 'g-rel-1', from_person: 'g-person-1', to_person: 'g-person-2', type: 'parent', label: 'Madre', provenance: 'Libro parroquial' },
  ],
  events: [
    { event_id: 'g-event-1', label: 'Nacimiento de Amalia', notes: 'Registro de nacimiento.', date: '1890-02-03', date_end_sort: '1890-02-03', description: 'Acta de nacimiento conservada.', updated_at: stamp },
  ],
  places: [
    { place_id: 'g-place-1', name: 'Valencia', notes: 'Lugar de origen.', kind: 'municipality', latitude: 39.4699, longitude: -0.3763, description: 'Ciudad documentada.', updated_at: stamp },
  ],
  archive_folders: [{ folder_id: 'g-folder-1', name: 'Familia Serrano' }],
  archive_items: [{ item_id: 'g-archive-1', folder_id: 'g-folder-1', title: 'Libro parroquial', kind: 'document', description: 'Fuente primaria publicada.', created_at: stamp, updated_at: stamp }],
  archive_item_tags: [{ item_id: 'g-archive-1', tag: 'nacimiento' }],
  archive_item_folders: [{ item_id: 'g-archive-1', folder_id: 'g-folder-1' }],
  archive_excerpts: [{ excerpt_id: 'g-excerpt-1', item_id: 'g-archive-1', locator_display: 'f. 2', quoted_text: 'Amalia Serrano', updated_at: stamp }],
  archive_source_analyses: [{ analysis_id: 'g-analysis-1', item_id: 'g-archive-1', origin_notes: 'Procedencia parroquial', content_form: 'acta', updated_at: stamp }],
  archive_description_units: [],
  archive_item_units: [],
  event_participants: [{ event_id: 'g-event-1', person_id: 'g-person-1' }],
  person_places: [{ person_id: 'g-person-1', place_id: 'g-place-1' }],
  person_names: [],
};

const worldbuildingTables = {
  persons: [
    { person_id: 'w-person-1', display_name: 'Iria de Asteria', life_status: 'alive', narrative_role: 'protagonist', birth_date: '18-03-02', biography: 'Cartógrafa de las mareas.', notes: 'La protagonista.', updated_at: stamp },
    { person_id: 'w-person-2', display_name: 'Nilo Var', life_status: 'missing', narrative_role: 'supporting', birth_date: '17-11-09', biography: 'Guardián desaparecido.', updated_at: stamp },
  ],
  character_profiles: [{ person_id: 'w-person-1', species: 'Humana', appearance: 'Abrigo azul y brújula.', personality: 'Persistente.', backstory: 'Creció junto al faro.' }],
  places: [
    { place_id: 'w-place-1', name: 'Puerto de Ceniza', kind: 'city', description: 'Ciudad suspendida sobre el mar.', parent_id: null, updated_at: stamp },
    { place_id: 'w-place-2', name: 'Faro Norte', kind: 'building', description: 'Torre de señales.', parent_id: 'w-place-1', updated_at: stamp },
  ],
  place_profiles: [{ place_id: 'w-place-1', appearance: 'Terrazas de basalto.', atmosphere: 'Bruma salada.', history: 'Fundada tras la marea negra.' }],
  world_groups: [
    { group_id: 'w-group-1', name: 'Cofradía del Norte', kind: 'faction', status: 'active', description: 'Navegantes y cronistas.', seat_place_id: 'w-place-1', updated_at: stamp },
    { group_id: 'w-group-2', name: 'Casa Var', kind: 'house', status: 'dormant', description: 'Dinastía en silencio.', updated_at: stamp },
    { group_id: 'w-group-3', name: 'Lengua de Bruma', kind: 'language', status: 'active', description: 'Cultura de las islas.', updated_at: stamp },
  ],
  character_affiliations: [{ affiliation_id: 'w-aff-1', person_id: 'w-person-1', group_id: 'w-group-1', rank: 'Cartógrafa' }],
  events: [{ event_id: 'w-event-1', label: 'La noche de los faros', description: 'Siete luces se apagaron.', date: '18-10-01', start_date: '18-10-01', updated_at: stamp }],
  event_participants: [{ event_id: 'w-event-1', person_id: 'w-person-1' }],
  person_places: [{ person_id: 'w-person-1', place_id: 'w-place-1' }],
  world_articles: [{ article_id: 'w-article-1', title: 'Las rutas de sal', summary: 'Historia de las rutas antiguas.', body: 'Los mapas recuerdan a quienes los trazan.', category: 'Historia', updated_at: stamp }],
  world_scenes: [{ scene_id: 'w-scene-1', title: 'Llegada al puerto', summary: 'Iria descubre el mapa imposible.', status: 'draft', narrative_order: 1, place_id: 'w-place-1', updated_at: stamp }],
  world_scene_text: [{ scene_id: 'w-scene-1', content_markdown: 'La marea dibujó una puerta.' }],
  world_beats: [{ beat_id: 'w-beat-1', scene_id: 'w-scene-1', mark: 'Incidente', description: 'El mapa cambia.' }],
  world_rules: [{ rule_id: 'w-rule-1', title: 'La tinta recuerda', statement: 'Todo mapa conserva la intención de quien lo dibuja.', hardness: 'hard', status: 'active', updated_at: stamp }],
  world_questions: [{ question_id: 'w-question-1', title: '¿Quién apagó los faros?', description: 'Pregunta abierta de la trama.', status: 'open', priority: 'high', updated_at: stamp }],
  world_question_options: [],
  world_threads: [
    { thread_id: 'w-thread-1', title: 'Arco de la marea', description: 'Iria busca el origen de la marea.', kind: 'arc', status: 'active', updated_at: stamp },
    { thread_id: 'w-thread-2', title: 'El conflicto de los faros', pitch: 'Dos cofradías disputan la luz.', stakes: 'El puerto queda a oscuras.', kind: 'conflict', status: 'open', updated_at: stamp },
  ],
  world_maps: [{ map_id: 'w-map-1', name: 'Archipiélago de Asteria', kind: 'world', notes: 'Mapa publicado sin imagen en esta fixture.', width_px: 1600, height_px: 900, sort_order: 0, updated_at: stamp }],
  map_layers: [{ layer_id: 'w-layer-1', map_id: 'w-map-1', name: 'Rutas', sort_order: 0 }],
  map_markers: [{ marker_id: 'w-marker-1', map_id: 'w-map-1', layer_id: 'w-layer-1', x: 0.42, y: 0.55, label: 'Puerto de Ceniza', place_id: 'w-place-1', sort_order: 0 }],
  map_travel_modes: [],
  world_scene_days: [],
  world_calendar: [],
  world_calendar_eras: [],
  world_calendar_months: [],
  world_secrets: [],
  secret_knowers: [],
  scene_characters: [{ id: 'w-cast-1', scene_id: 'w-scene-1', person_id: 'w-person-1', role: 'POV' }],
  world_links: [],
};

const routes = {
  genealogy: [
    ['persons', 'vault-surface-persons'], ['timeline', 'vault-surface-genealogy-timeline'], ['map', 'vault-surface-genealogy-map'],
    ['relations', 'vault-surface-social-relations'], ['tree', 'vault-surface-genealogy-tree'], ['archive', 'vault-surface-archive-items'],
    ['notes', 'private-notes-view'],
  ],
  worldbuilding: [
    ['encyclopedia', 'vault-surface-world-articles'], ['characters', 'vault-surface-persons'], ['places', 'vault-surface-places'],
    ['factions', 'vault-surface-world-groups'], ['cultures', 'vault-surface-world-groups'], ['dynasties', 'vault-surface-world-groups'],
    ['timeline', 'vault-surface-genealogy-timeline'], ['map', 'vault-surface-world-map'], ['relations', 'vault-surface-social-relations'],
    ['tree', 'vault-surface-genealogy-tree'], ['worldChat', 'world-view'], ['rules', 'vault-surface-world-rules'],
    ['conflicts', 'vault-surface-world-analysis'], ['arcs', 'vault-surface-world-threads'], ['continuity', 'vault-surface-world-continuity'],
    ['questions', 'vault-surface-world-questions'], ['scenes', 'vault-surface-world-scenes'], ['manuscript', 'vault-surface-world-manuscript'],
    ['notes', 'private-notes-view'],
  ],
};

const homeMetrics = {
  genealogy: ['Personas', 'Vínculos de parentesco', 'Eventos', 'Lugares'],
  worldbuilding: ['Personajes', 'Protagonistas', 'Con vida', 'En la enciclopedia'],
};

// Sidebar vocabulary is part of the Desktop presentation contract. We record
// mismatches as audit findings (rather than failing the functional route smoke)
// so the output distinguishes a working route from a visual naming gap.
const expectedHeadings = {
  'genealogy:persons': 'Personas', 'genealogy:timeline': 'Línea temporal', 'genealogy:map': 'Mapa',
  'genealogy:relations': 'Relaciones sociales', 'genealogy:tree': 'Árbol genealógico', 'genealogy:archive': 'Archivo',
  'worldbuilding:encyclopedia': 'Enciclopedia', 'worldbuilding:characters': 'Personajes', 'worldbuilding:places': 'Lugares',
  'worldbuilding:factions': 'Facciones', 'worldbuilding:cultures': 'Culturas', 'worldbuilding:dynasties': 'Dinastías',
  'worldbuilding:timeline': 'Cronología', 'worldbuilding:map': 'Mapa', 'worldbuilding:relations': 'Relaciones',
  'worldbuilding:tree': 'Familias', 'worldbuilding:rules': 'Reglas del mundo', 'worldbuilding:conflicts': 'Conflictos',
  'worldbuilding:arcs': 'Arcos narrativos', 'worldbuilding:continuity': 'Continuidad', 'worldbuilding:questions': 'Preguntas abiertas',
  'worldbuilding:scenes': 'Escenas', 'worldbuilding:manuscript': 'Manuscrito',
};

function privateSurface(body) {
  assert.match(body, /Datos privados; no se muestran en el servidor/);
}

function assertNoFallback(body) {
  assert.doesNotMatch(body, /No se ha podido cargar|No se ha podido cargar esta vista|Something went wrong/i);
}

/** Wait until a real published/private view has finished its initial request. */
async function waitForSettled(page, testId, timeout = 15_000) {
  const host = page.getByTestId(testId).first();
  await host.waitFor({ timeout });
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-testid="${id}"]`);
    if (!node || node.querySelector('[aria-busy="true"], [data-loading="true"]')) return false;
    return ![...node.querySelectorAll('[role="status"]')].some((status) => /cargando|loading|esperando|preparando/i.test(status.textContent || ''));
  }, testId, { timeout });
  await page.waitForTimeout(100);
  return host;
}

await withServer({ label: 'server-web-worldbuilding-genealogy', ai: true }, async (server) => {
  const spaces = {};
  spaces.genealogy = await server.createSpace('Genealogía · auditoría');
  spaces.worldbuilding = await server.createSpace('Worldbuilding · auditoría');
  await server.setPublicationPolicy(spaces.genealogy, ['allowPrimarySources']);
  const genealogyOwner = await server.deviceToken(server.adminEmail, server.adminPassword, spaces.genealogy, 'Genealogy audit publisher');
  const worldOwner = await server.deviceToken(server.adminEmail, server.adminPassword, spaces.worldbuilding, 'Worldbuilding audit publisher');
  await publish(server.origin, genealogyOwner.deviceToken, spaces.genealogy, snapshot('genealogy', 'Genealogía · auditoría', genealogyTables));
  await publish(server.origin, worldOwner.deviceToken, spaces.worldbuilding, snapshot('worldbuilding', 'Worldbuilding · auditoría', worldbuildingTables));
  const reader = await server.createUser('worldbuilding-genealogy-reader@example.test', 'reader-password-strong', Object.values(spaces).map((spaceId) => ({ spaceId, role: 'reader' })));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const consoleErrors = [];
  const notFoundResponses = [];
  const manifest = { format: 'nodus.server-web-e2e-manifest', generatedAt: new Date().toISOString(), viewport: { desktop: [1440, 1000], mobile: [390, 844] }, spaces, routes: {}, details: {}, screenshots: [], observedGaps: [], visualGaps: [], diagnostics: { consoleErrors: [], notFoundResponses: [] }, themes: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() === 404) notFoundResponses.push(response.url());
      if (response.status() >= 500) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(`${server.origin}/login?next=/`, { waitUntil: 'networkidle' });
    await page.locator('#login-email').fill(reader.email);
    await page.locator('#login-password').fill(reader.password);
    await Promise.all([page.waitForURL(new RegExp(`${server.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`)), page.locator('button[type="submit"]').click()]);
    await page.getByTestId('app-shell').waitFor();

    async function switchVault(type) {
      await page.getByTestId('header-vault-badge').click();
      await page.getByTestId(`vault-option-${spaces[type]}`).click();
      await waitForSettled(page, 'app-shell');
      assert.equal(await page.getByTestId('app-shell').getAttribute('data-surface'), 'server');
    }
    async function visitHome(type) {
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await waitForSettled(page, type === 'genealogy' ? 'genealogy-overview' : 'worldbuilding-overview');
      const body = await page.locator('body').innerText();
      assertNoFallback(body);
      for (const label of homeMetrics[type]) assert.match(body, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      manifest.routes[`${type}:home`] = { url: page.url(), renderer: type === 'genealogy' ? 'genealogy-overview' : 'worldbuilding-overview', metrics: homeMetrics[type] };
      const file = path.join(output, `${type}-home.png`); await page.screenshot({ path: file, fullPage: true }); manifest.screenshots.push(path.relative(repoRoot, file));
    }
    async function visit(type, [route, testId]) {
      await page.locator(`[data-tour="nav-${route}"]`).first().click();
      try {
        await waitForSettled(page, testId);
      } catch (error) {
        throw new Error(`${type}/${route} did not render ${testId} at ${page.url()}\n${(await page.locator('body').innerText()).slice(0, 1_500)}`, { cause: error });
      }
      // A surface mounts before its publication request resolves. Do not capture
      // a misleading all-zero/loading screenshot as if it were the final view.
      const body = await page.locator('body').innerText();
      assertNoFallback(body);
      const heading = (await page.getByTestId(testId).first().locator('h1').first().textContent())?.trim() || '';
      const expectedHeading = expectedHeadings[`${type}:${route}`];
      if (expectedHeading && heading !== expectedHeading) manifest.visualGaps.push({ type, route, expectedHeading, actualHeading: heading });
      // Notes are a real per-reader private workspace, while social relations are
      // intentionally unavailable because their source tables are not published.
      const isPrivate = testId === 'vault-surface-social-relations';
      if (isPrivate) privateSurface(body);
      const routeKey = `${type}:${route}`;
      const file = path.join(output, `${type}-${route}.png`); await page.screenshot({ path: file, fullPage: true });
      manifest.routes[routeKey] = { url: page.url(), renderer: testId, private: isPrivate, theme: await page.locator('html').getAttribute('data-theme'), viewport: [1440, 1000], screenshot: path.relative(repoRoot, file) }; manifest.screenshots.push(path.relative(repoRoot, file));
    }
    async function detail(type, route, testId, detailTestId, rowSelector = 'button') {
      await switchVault(type);
      await page.locator(`[data-tour="nav-${route}"]`).first().click();
      const host = await waitForSettled(page, testId);
      const rows = host.locator(rowSelector);
      await rows.first().waitFor({ timeout: 15_000 });
      const rowCount = await rows.count();
      assert.ok(rowCount > 0, `${type}/${route} must expose a clickable published record`);
      // The generic table includes its catalogue tab as the first button; the
      // domain-specific selectors target records directly.
      await rows.nth(rowSelector === 'button' ? 1 : 0).click();
      await waitForSettled(page, detailTestId);
      assertNoFallback(await page.locator('body').innerText());
      const detailUrl = page.url();
      manifest.details[`${type}:${route}`] = { url: detailUrl, renderer: detailTestId };
      await page.reload({ waitUntil: 'networkidle' });
      await waitForSettled(page, detailTestId);
      assert.ok(await host.locator('header button').count() >= 2, `${type}/${route} reload must restore the active record tab`);
      assertNoFallback(await page.locator('body').innerText());
      manifest.details[`${type}:${route}`].reloaded = true;
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    }

    // Related-record buttons keep the parent view in the URL and carry the
    // nested collection separately. This is the path that used to fall through
    // to the generic key/value renderer instead of opening the dedicated dossier.
    async function nestedDetail(type, parentRoute, parentTestId, parentDetailTestId, relatedText, nestedDetailTestId, parentRowSelector = 'button') {
      await switchVault(type);
      await page.locator(`[data-tour="nav-${parentRoute}"]`).first().click();
      const host = page.getByTestId(parentTestId).first();
      await host.waitFor({ timeout: 15_000 });
      const rows = host.locator(parentRowSelector);
      await rows.first().waitFor({ timeout: 15_000 });
      await rows.nth(parentRowSelector === 'button' ? 1 : 0).click();
      await page.getByTestId(parentDetailTestId).waitFor({ timeout: 15_000 });
      // Dossier action buttons include secondary metadata (for example the
      // affiliation rank), so their accessible name is intentionally richer
      // than the linked record title. Click the exact title node and let the
      // event bubble to its dedicated button.
      await page.getByText(relatedText, { exact: true }).first().click();
      await page.getByTestId(nestedDetailTestId).waitFor({ timeout: 15_000 });
      assertNoFallback(await page.locator('body').innerText());
      manifest.details[`${type}:${parentRoute}->${relatedText}`] = { url: page.url(), renderer: nestedDetailTestId };
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId(nestedDetailTestId).waitFor({ timeout: 15_000 });
      assert.ok(await page.getByTestId(parentTestId).locator('header button').count() >= 2, `${type}/${parentRoute}->${relatedText} reload must retain a nested detail tab`);
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    }

    for (const type of Object.keys(routes)) {
      await switchVault(type);
      await visitHome(type);
      for (const entry of routes[type]) await visit(type, entry);
      // Return to the actual home landmark before recording the themed home
      // capture. Otherwise the screenshot name says "home" while the browser
      // is still on the last sidebar route (usually private Notes).
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await waitForSettled(page, type === 'genealogy' ? 'genealogy-overview' : 'worldbuilding-overview');
      assert.equal(new URL(page.url()).pathname, '/', `${type} themed capture must be rooted at /`);
      assert.equal(await page.getByTestId(type === 'genealogy' ? 'genealogy-overview' : 'worldbuilding-overview').count(), 1, `${type} themed capture must contain the home landmark`);
      const beforeTheme = await page.locator('html').getAttribute('data-theme');
      await page.getByTestId('theme-toggle').click();
      await page.waitForFunction((previous) => document.documentElement.getAttribute('data-theme') !== previous, beforeTheme);
      const theme = await page.locator('html').getAttribute('data-theme');
      manifest.themes = [...new Set([...(manifest.themes || []), theme])];
      const themedShot = path.join(output, `${type}-home-${theme}.png`);
      await page.screenshot({ path: themedShot, fullPage: true });
      manifest.routes[`${type}:home:${theme}`] = { url: page.url(), renderer: type === 'genealogy' ? 'genealogy-overview' : 'worldbuilding-overview', theme, viewport: [1440, 1000], screenshot: path.relative(repoRoot, themedShot) };
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${type} desktop view must not overflow horizontally`);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${type} mobile view must not overflow horizontally`);
      const file = path.join(output, `${type}-mobile.png`); await page.screenshot({ path: file, fullPage: true }); manifest.screenshots.push(path.relative(repoRoot, file));
      await page.setViewportSize({ width: 1440, height: 1000 });
    }

    await detail('genealogy', 'persons', 'vault-surface-persons', 'person-dossier');
    await detail('genealogy', 'archive', 'vault-surface-archive-items', 'archive-item-dossier-rich');
    await detail('worldbuilding', 'characters', 'vault-surface-persons', 'character-dossier', '[data-testid="character-card"]');
    await detail('worldbuilding', 'places', 'vault-surface-places', 'place-sheet', '[data-testid="world-place-row"]');
    await detail('worldbuilding', 'factions', 'vault-surface-world-groups', 'world-group-sheet', '[data-testid="world-groups-grid"] button');
    await detail('worldbuilding', 'encyclopedia', 'vault-surface-world-articles', 'encyclopedia-reader', '[data-testid="encyclopedia-entry"]');
    await detail('worldbuilding', 'map', 'vault-surface-world-map', 'world-map-detail', '[data-testid="world-map-card"]');
    await nestedDetail('genealogy', 'persons', 'vault-surface-persons', 'person-dossier', 'Valencia', 'place-sheet');
    await nestedDetail('worldbuilding', 'characters', 'vault-surface-persons', 'character-dossier', 'Cofradía del Norte', 'world-group-sheet', '[data-testid="character-card"]');
    await nestedDetail('worldbuilding', 'characters', 'vault-surface-persons', 'character-dossier', 'Llegada al puerto', 'scene-dossier', '[data-testid="character-card"]');
    await nestedDetail('worldbuilding', 'places', 'vault-surface-places', 'place-sheet', 'Iria de Asteria', 'character-dossier', '[data-testid="world-place-row"]');
    manifest.diagnostics.consoleErrors = consoleErrors;
    manifest.diagnostics.notFoundResponses = notFoundResponses;
    // The map fixture deliberately has no image asset. The current renderer passes an
    // empty asset URL to WorldMapCanvas, so this is a documented, reproducible gap rather
    // than an ignored console/network failure. Once fixed, this expected list must become [].
    const emptyMapAsset = notFoundResponses.filter((url) => /\/assets\/$/.test(new URL(url).pathname));
    if (emptyMapAsset.length > 0) manifest.observedGaps.push({ id: 'world-map-empty-asset-request', evidence: emptyMapAsset });
    assert.deepEqual(notFoundResponses, emptyMapAsset, `unexpected 404 responses: ${notFoundResponses.join(' | ')}`);
    await context.close();
  } finally {
    await browser.close();
    manifest.diagnostics.consoleErrors = consoleErrors;
    manifest.diagnostics.notFoundResponses = notFoundResponses;
    await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of 404 \(Not Found\)/i.test(message));
  assert.deepEqual(unexpectedConsoleErrors, [], `worldbuilding/genealogy browser/server errors: ${unexpectedConsoleErrors.join(' | ')}`);
  assert.ok(manifest.routes['genealogy:home'] && manifest.routes['worldbuilding:home']);
  assert.deepEqual([...new Set(manifest.themes)].sort(), ['dark', 'light']);
  process.stdout.write(`worldbuilding/genealogy matrix passed: ${Object.keys(manifest.routes).length} routes, ${Object.keys(manifest.details).length} reloadable details\n`);
});
