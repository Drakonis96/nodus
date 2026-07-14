// End-to-end smoke test: launches the REAL Electron app (dist-electron build)
// against a throwaway user-data profile and verifies the vital signs no unit
// test can see — the window opens, the renderer mounts, the preload bridge is
// live, graph:get answers over real IPC (compute worker included), the DB
// migrates to the current schema, and the renderer logs no uncaught errors.
//
// Requires a build (dist/ + dist-electron/); run via `npm run test:e2e`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Re-exec under Electron-as-Node so the final better-sqlite3 check matches the
// app ABI (same pattern as every other script in this suite). Playwright then
// spawns the real Electron GUI as a child of this process.
if (!process.argv.includes('--electron-e2e-smoke')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-smoke.mjs'), '--electron-e2e-smoke'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-'));
let app = null;
try {
  // The child must run as a real GUI app: strip the runner's as-Node flag.
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', repoRoot],
    env: childEnv,
  });

  // ── Window + renderer mount ─────────────────────────────────────────────────
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  console.log('[e2e] renderer mounted');

  // Suppress the "what's new" modal: a fresh profile has no last-seen version, so it
  // would otherwise overlay the app and intercept later clicks. localStorage persists
  // across the reloads below (same origin).
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));

  // ── Preload bridge ──────────────────────────────────────────────────────────
  const bridge = await page.evaluate(() => ({
    hasNodus: typeof window.nodus === 'object' && window.nodus !== null,
    hasGetGraph: typeof window.nodus?.getGraph === 'function',
    hasEdgeFeedback: typeof window.nodus?.setEdgeFeedback === 'function',
    hasImageModels: typeof window.nodus?.listImageModels === 'function',
    hasImageQueue: typeof window.nodus?.queueDecorativeImage === 'function',
    hasSearchDetail: typeof window.nodus?.getSearchResultDetail === 'function',
    hasStudyStt: typeof window.nodus?.transcribeStudyAudio === 'function',
  }));
  assert.equal(bridge.hasNodus, true, 'window.nodus bridge exposed');
  assert.equal(bridge.hasGetGraph, true, 'getGraph available');
  assert.equal(bridge.hasEdgeFeedback, true, 'setEdgeFeedback available');
  assert.equal(bridge.hasImageModels, true, 'image model catalog available');
  assert.equal(bridge.hasImageQueue, true, 'decorative image queue available');
  assert.equal(bridge.hasSearchDetail, true, 'search detail modal bridge available');
  assert.equal(bridge.hasStudyStt, true, 'study speech-to-text bridge available');
  console.log('[e2e] preload bridge ok');

  // ── Main header: model selection belongs to Settings/features, never global ─
  const smokeModel = { provider: 'openai', model: 'smoke-model' };
  const chatModel = { provider: 'openrouter', model: 'smoke-chat-model' };
  const migrated = await page.evaluate((model) =>
    window.nodus.updateSettings({
      defaultModel: model,
      extractionModel: null,
      synthesisModel: null,
      summaryModel: null,
      fusionModel: null,
    }), smokeModel);
  assert.equal(migrated.defaultModel, null, 'legacy global choice retired after migration');
  for (const key of ['extractionModel', 'synthesisModel', 'summaryModel', 'fusionModel']) {
    assert.deepEqual(migrated[key], smokeModel, `legacy model migrated into ${key}`);
  }
  const independent = await page.evaluate(({ model, chat }) =>
    window.nodus.updateSettings({
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
      favorites: [model, chat],
      extractionModel: model,
      synthesisModel: model,
      summaryModel: chat,
      fusionModel: chat,
      chatModel: chat,
      deepResearchModel: model,
      immersionModel: chat,
      imageProvider: 'google',
      imageModel: 'gemini-3.1-flash-lite-image',
      imageStyle: 'antique_book',
    }), { model: smokeModel, chat: chatModel });
  assert.deepEqual(independent.chatModel, chatModel, 'chat model persists independently');
  assert.deepEqual(independent.deepResearchModel, smokeModel, 'Deep Research model persists independently');
  assert.deepEqual(independent.immersionModel, chatModel, 'immersion model persists independently');
  assert.equal(independent.imageModel, 'gemini-3.1-flash-lite-image', 'image model persists independently');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('header'));
  assert.equal(await page.locator('header select[data-tour="model"]').count(), 0, 'global header model selector removed');
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByText('Generación de imágenes', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('gemini-3.1-flash-lite-image', { exact: false }).count() > 0, true, 'image settings render selected verified model');
  console.log('[e2e] image provider settings rendered');
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  assert.equal(await page.locator('select[title="Modelo del chat"]').inputValue(), 'openrouter::smoke-chat-model');
  await page.locator('button[title="Cerrar"]').click();
  console.log('[e2e] header has no global model selector');

  // ── Search result: an idea reuses the Ideas section's detail modal ─────────
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true, 'demo corpus seeded for search smoke');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-tour="nav-search"]'));
  await page.locator('[data-tour="nav-search"]').click();
  const searchInput = page.getByPlaceholder('Busca en notas, ideas, obras, huecos, temas y autores…');
  await searchInput.fill('recuperación');
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).click();
  const detailDialog = page.locator('[role="dialog"]');
  await detailDialog.waitFor();
  // The idea opens the shared IdeaDetailModal, whose graph jump is the secondary
  // "Ver en el grafo" action — not an immediate navigation away from Search.
  const graphAction = detailDialog.getByRole('button', { name: 'Ver en el grafo', exact: true });
  await graphAction.waitFor({ timeout: 10_000 });
  assert.equal(await graphAction.count(), 1, 'idea detail modal opened with its secondary graph action');
  assert.equal(await searchInput.isVisible(), true, 'search remains the active primary surface');
  await detailDialog.locator('button[title="Cerrar"]').first().click();
  console.log('[e2e] search idea result opens the shared idea detail modal');

  // ── Optional-image controls exist and can be toggled without generation ───
  // The immersion image option now lives in the "New immersion" composer modal.
  await page.locator('[data-tour="nav-immersion"]').click();
  await page.getByRole('button', { name: 'Nueva inmersión', exact: true }).first().click();
  const immersionImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await immersionImageToggle.waitFor();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion style hidden while disabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'immersion style shown when enabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.locator('[data-tour="nav-deepResearch"]').click();
  // The Deep Research image option now lives in the "New report" composer modal.
  await page.getByRole('button', { name: 'Nuevo informe', exact: true }).first().click();
  const reportImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await reportImageToggle.waitFor();
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'Deep Research style shown when enabled');
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'Deep Research image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  console.log('[e2e] optional image controls toggle in both owner flows');

  // ── Real IPC round-trip: the async graph build (compute worker path) ────────
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  assert.ok(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'graph:get returns {nodes, edges}');
  console.log(`[e2e] graph:get ok (${graph.nodes.length} nodes, ${graph.edges.length} edges on a fresh profile)`);

  const authorsGraph = await page.evaluate(() => window.nodus.getGraph('authors'));
  assert.ok(Array.isArray(authorsGraph.nodes), 'authors lens answers too');

  // ── Records ontology + evidence archive over real IPC ───────────────────────
  const records = await page.evaluate(async () => {
    const juan = await window.nodus.createPerson({ displayName: 'Juan Pérez', sex: 'male', birthDate: 'c. 1850' });
    const hijo = await window.nodus.createPerson({ displayName: 'Pedro Pérez', sex: 'male' });
    await window.nodus.addRelationship(juan.personId, hijo.personId, 'parent', 'user_asserted', 'adoptive');
    await window.nodus.setPersonFrame(juan.personId, 'walnut');
    const kin = await window.nodus.kinOf(juan.personId);
    const juanReloaded = await window.nodus.getPerson(juan.personId);
    const place = await window.nodus.findOrCreatePlace('Sevilla', 'municipality');
    const event = await window.nodus.createEvent({
      type: 'marriage',
      date: '1875',
      placeId: place.placeId,
      participants: [{ personId: juan.personId, role: 'principal' }],
    });
    await window.nodus.addRecordEvidence({
      targetKind: 'person',
      targetId: juan.personId,
      quote: 'Juan Pérez, jornalero',
      location: 'p. 1',
    });
    const folder = await window.nodus.createArchiveFolder('Censos', null);
    const item = await window.nodus.createArchiveItem({
      folderId: folder.folderId,
      title: 'Hoja censal',
      kind: 'image',
      extractedText: 'Juan Pérez jornalero',
      tags: ['censo'],
    });
    const entry = await window.nodus.createArchiveTextEntry({
      title: 'Partida',
      content: 'texto',
      docType: 'birth_record',
      metadata: { persona: 'Juan Pérez', inventado: 'x' },
    });
    await window.nodus.linkArchivePerson(entry.itemId, juan.personId);
    const linkedDocs = await window.nodus.listArchiveItemsForPerson(juan.personId);

    // Map: offline gazetteer search → resolve to a place → per-person place record →
    // located map point (the whole map pipeline over IPC, fully offline).
    const gaz = await window.nodus.searchGazetteer('Carmona', 6);
    const carmonaEs = gaz.find((g) => g.countryCode === 'ES');
    let mapPointCount = 0;
    if (carmonaEs) {
      const gplace = await window.nodus.resolveGazetteerPlace(carmonaEs);
      await window.nodus.addPersonPlace({ personId: juan.personId, placeId: gplace.placeId, label: 'birth', date: 'c. 1850' });
      mapPointCount = (await window.nodus.mapPoints([juan.personId])).length;
    }

    // Kinship suggestion IPC is wired and answers cleanly with no proposals yet
    // (proposals are seeded by an AI scan, which needs a provider key we don't set here;
    // the accumulate/confirm/dismiss logic is covered by the unit repo test).
    const kinSuggestionCount = await window.nodus.kinSuggestionCount();
    const kinSuggestions = await window.nodus.listKinSuggestions();

    // Archive discovery is AI-free (lexical): the censal sheet names Juan, so he is
    // proposed for the document and the document is proposed for him — both directions.
    const personSuggestions = await window.nodus.suggestPersonsForItem(item.itemId);
    const docSuggestions = await window.nodus.suggestDocumentsForPerson(juan.personId);

    return {
      linkedDocs: linkedDocs.length,
      linkedName: (await window.nodus.getArchiveItem(entry.itemId)).linkedPersons[0]?.displayName,
      entryDocType: entry.docType,
      entryMeta: entry.metadata,
      frameStyle: juanReloaded.frameStyle,
      biographyField: juanReloaded.biography, // null until generated; confirms the v41 column
      persons: (await window.nodus.listPersons()).length,
      children: kin.children.length,
      events: (await window.nodus.listEvents({ personId: juan.personId })).length,
      evidence: (await window.nodus.listRecordEvidence('person', juan.personId)).length,
      placeName: (await window.nodus.getEvent(event.eventId)).placeName,
      archiveItems: (await window.nodus.listArchiveItems({ tags: ['censo'] })).length,
      archiveFilteredOut: (await window.nodus.listArchiveItems({ tags: ['inexistente'] })).length,
      hasBlobFlag: item.hasBlob,
      kinSuggestionCount,
      kinSuggestionsIsArray: Array.isArray(kinSuggestions),
      personSuggested: personSuggestions.some((p) => p.displayName === 'Juan Pérez'),
      docSuggested: docSuggestions.some((d) => d.itemId === item.itemId && d.reason === 'name'),
      gazetteerHits: gaz.length,
      gazetteerCarmona: !!carmonaEs,
      mapPointCount,
    };
  });
  assert.equal(records.persons, 2, 'persons created over IPC');
  assert.equal(records.children, 1, 'kinship edge resolved over IPC');
  assert.equal(records.frameStyle, 'walnut', 'per-person tree frame stored over IPC');
  assert.equal(records.linkedDocs, 1, 'document linked to the person over IPC');
  assert.equal(records.linkedName, 'Juan Pérez', 'linked person surfaces on the item over IPC');
  assert.equal(records.biographyField, null, 'biography column present (null until generated)');
  assert.equal(records.events, 1, 'event linked to the person');
  assert.equal(records.evidence, 1, 'record evidence attached');
  assert.equal(records.placeName, 'Sevilla', 'event resolves its place');
  assert.equal(records.archiveItems, 1, 'archive item created + tag-filtered');
  assert.equal(records.archiveFilteredOut, 0, 'tag filter excludes non-matching items over IPC');
  assert.equal(records.entryDocType, 'birth_record', 'text entry keeps its document type');
  assert.deepEqual(records.entryMeta, { persona: 'Juan Pérez' }, 'metadata sanitised to the type (unknown key dropped)');
  assert.equal(records.kinSuggestionCount, 0, 'kinship suggestions IPC answers (none seeded without AI)');
  assert.ok(records.kinSuggestionsIsArray, 'listKinSuggestions returns an array over IPC');
  assert.ok(records.personSuggested, 'archive → person discovery proposes the named person over IPC');
  assert.ok(records.docSuggested, 'person → document discovery proposes the naming document over IPC');
  console.log('[e2e] records ontology + archive ok over IPC');

  assert.ok(records.gazetteerHits > 0, 'offline gazetteer search returns candidates over IPC');
  assert.ok(records.gazetteerCarmona, 'the Spanish Carmona is found in the offline gazetteer');
  assert.equal(records.mapPointCount, 1, 'a resolved gazetteer place becomes a located map point over IPC');
  console.log('[e2e] map: gazetteer + per-person places ok over IPC');

  // ── Databases mode over real IPC ────────────────────────────────────────────
  // The db_* tables exist in every vault DB (the vault-type gate is UI-only), so the
  // engine round-trips here even though the e2e profile is an academic vault.
  const dbmode = await page.evaluate(async () => {
    const database = await window.nodus.createDatabase('Fotos', null);
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const sel = await window.nodus.createDatabaseColumn(database.id, 'Estado', 'select');
    const opt = await window.nodus.addDatabaseOption(sel.id, 'Nuevo', '#ef4444');
    const row = await window.nodus.createDatabaseRow(database.id);
    await window.nodus.setDatabaseCell(row.id, title.id, 'Gato');
    await window.nodus.setDatabaseCell(row.id, sel.id, opt.id);
    const rows = await window.nodus.listDatabaseRows(database.id, { sort: 'position' });
    const stats = await window.nodus.databaseStats(database.id);
    const detail = await window.nodus.getDatabaseDetail(database.id);

    // CSV import over IPC (no dialog: createDatabaseFromCsv takes the rows directly).
    const imported = await window.nodus.createDatabaseFromCsv(
      'CSV',
      ['Nombre', 'Peso', 'Estado'],
      [['Gato', '3.5', 'vivo'], ['Perro', '8', 'muerto']],
      ['title', 'number', 'select']
    );
    const importedDetail = await window.nodus.getDatabaseDetail(imported.id);
    const importedRows = await window.nodus.listDatabaseRows(imported.id, { sort: 'position' });

    // Relation column → link the first table's row to an imported row.
    const relCol = await window.nodus.createDatabaseColumn(database.id, 'Vínculo', 'relation', {
      relationTargetKind: 'db_row',
      relationTargetDatabaseId: imported.id,
    });
    const relation = await window.nodus.addDatabaseRelation(row.id, relCol.id, 'db_row', importedRows[0].id);
    const relations = await window.nodus.listDatabaseRelations(row.id, relCol.id);

    // Saved view over IPC.
    const view = await window.nodus.createDatabaseView(imported.id, {
      name: 'Vivos',
      layout: 'gallery',
      filter: { conjunction: 'and', conditions: [{ id: 'c', columnId: importedDetail.columns[2].id, op: 'isNoneOf', value: [] }] },
      sorts: [],
    });
    const viewList = await window.nodus.listDatabaseViews(imported.id);

    // Analysis profile (deterministic stats) over IPC.
    const prof = await window.nodus.getDatabaseProfile(imported.id);
    const numProfile = prof.profile.columns.find((c) => c.type === 'number');

    return {
      list: (await window.nodus.listDatabases()).length,
      shortId: database.shortId,
      columns: detail.columns.length,
      titleCell: rows[0]?.cells[title.id],
      selCell: rows[0]?.cells[sel.id],
      optId: opt.id,
      rowCount: stats.rowCount,
      percent: stats.percent,
      importedCols: importedDetail.columns.length,
      importedSelectOptions: importedDetail.columns[2].options.length,
      importedRows: importedRows.length,
      relationLabel: relation.label,
      relationCount: relations.length,
      viewLayout: view.layout,
      viewCount: viewList.length,
      profileRows: prof.profile.rowCount,
      profileNumberMean: numProfile ? numProfile.number.mean : null,
    };
  });
  assert.ok(dbmode.list >= 1, 'database created over IPC');
  assert.match(dbmode.shortId, /^DB-[A-Z0-9]{4}$/, 'database gets a unique short id over IPC');
  assert.equal(dbmode.columns, 2, 'typed columns created over IPC');
  assert.equal(dbmode.titleCell, 'Gato', 'title cell round-trips over IPC');
  assert.equal(dbmode.selCell, dbmode.optId, 'select cell stores the option id over IPC');
  assert.equal(dbmode.rowCount, 1, 'row counted in database stats over IPC');
  assert.equal(dbmode.importedCols, 3, 'CSV import created typed columns over IPC');
  assert.equal(dbmode.importedSelectOptions, 2, 'CSV import built select options from distinct values');
  assert.equal(dbmode.importedRows, 2, 'CSV import created rows over IPC');
  assert.equal(dbmode.relationLabel, 'Gato', 'relation resolves the target row title over IPC');
  assert.equal(dbmode.relationCount, 1, 'relation stored over IPC');
  assert.equal(dbmode.viewLayout, 'gallery', 'saved view stored its layout over IPC');
  assert.equal(dbmode.viewCount, 1, 'saved view listed over IPC');
  assert.equal(dbmode.profileRows, 2, 'analysis profile counts rows over IPC');
  assert.equal(dbmode.profileNumberMean, 5.75, 'analysis profile computes numeric mean over IPC');
  console.log('[e2e] databases mode (CSV import + relations + views + analysis) ok over IPC');

  // ── Study vault: real UI creation flow + visual/structural regressions ─────
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Study smoke', type: 'estudio' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).first().click();
  await page.getByTestId('study-create-course').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('Crea tu primer curso para empezar.', { exact: true }).count(), 0, 'empty-state guidance stays out of the sidebar');
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'estudio', 'study vault uses the teal Nodus logo');

  const searchPadding = await page.getByPlaceholder('Buscar materiales…').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(searchPadding >= 30, `study search reserves space for its leading icon (${searchPadding}px)`);
  const organizationBox = await page.getByTestId('study-sidebar-organization').boundingBox();
  const analyzeBox = await page.getByRole('button', { name: 'Analizar', exact: true }).boundingBox();
  assert.ok(organizationBox && analyzeBox && analyzeBox.y - (organizationBox.y + organizationBox.height) < 40, 'Analyze follows Organization without a flex spacer');

  const createStudyItem = async (buttonTestId, name) => {
    await page.getByTestId(buttonTestId).click();
    await page.getByTestId('study-create-dialog').waitFor();
    await page.getByTestId('study-create-name').fill(name);
    await page.getByTestId('study-create-submit').click();
    await page.getByTestId('study-create-dialog').waitFor({ state: 'detached' });
  };
  await createStudyItem('study-create-course', 'Curso smoke');
  await createStudyItem('study-create-subject', 'Asignatura smoke');
  await createStudyItem('study-create-folder', 'Carpeta smoke');
  await page.getByText('Asignatura smoke', { exact: true }).first().click();
  await createStudyItem('study-create-topic', 'Tema smoke');
  await createStudyItem('study-create-document', 'Apunte smoke');

  const study = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    return {
      counts: [workspace.courses.length, workspace.subjects.length, workspace.topics.length, workspace.folders.length, workspace.documents.length],
      placement: workspace.placements.find((item) => item.documentId === document?.id),
    };
  });
  assert.deepEqual(study.counts, [1, 1, 1, 1, 1], 'all organization buttons create through the real renderer and IPC bridge');
  assert.ok(study.placement?.courseId && study.placement?.subjectId && study.placement?.topicId, 'UI-created material keeps the selected hierarchy placement');
  assert.match(await page.locator('body').innerText(), /Cursos y asignaturas/, 'study-specific sidebar is rendered');
  console.log('[e2e] study logo, search padding, sidebar flow and creation dialogs ok');

  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-toggle').click();
  await page.getByTestId('study-dictation').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-dictation').innerText(), /Local|offline/i, 'dictation panel defaults to the offline backend');
  await page.getByTestId('study-dictation-start').click();
  await page.getByTestId('study-dictation-discard').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-discard').click();
  await page.getByTestId('study-dictation-start').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-toggle').click();
  console.log('[e2e] study dictation panel + fake microphone capture ok');
  await page.getByTestId('study-doc-favorite').click();
  await page.getByTestId('study-doc-style').click();
  await page.getByTestId('study-doc-kind').selectOption('manual');
  await page.getByTestId('study-doc-color').fill('#22c55e');
  await page.waitForFunction(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    return document?.favorite === true && document.kind === 'manual' && document.color === '#22c55e';
  }, { timeout: 30_000 });
  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  const editorMarkdown = '# Tema smoke\n\nTexto **importante** con $x^2$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  await page.locator('.study-editor-shell textarea').fill(editorMarkdown);
  await page.getByRole('button', { name: /^Guardar$/ }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Guardado'), { timeout: 30_000 });
  const editorRoundTrip = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    if (!document) return null;
    const data = await window.nodus.getStudyDocEditorData(document.id);
    return { content: document.contentMarkdown, versions: data.versions.length };
  });
  assert.equal(editorRoundTrip?.content, editorMarkdown, 'raw Markdown round-trips exactly through the editor');
  assert.ok((editorRoundTrip?.versions ?? 0) >= 1, 'editor save creates a recoverable version');
  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown .katex').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown table.children').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Dividir$/ }).click();
  await page.locator('.study-editor-shell .md .katex').waitFor({ timeout: 30_000 });
  assert.match(await page.locator('body').innerText(), /Tema smoke/, 'document outline and WYSIWYG content render');
  console.log('[e2e] study Milkdown editor + metadata + raw Markdown + versioning ok');

  // ── No uncaught renderer errors during startup ──────────────────────────────
  assert.deepEqual(
    pageErrors.map((e) => String(e?.message ?? e)),
    [],
    'renderer produced uncaught errors'
  );
  console.log('[e2e] no renderer page errors');

  await app.close();
  app = null;

  // ── DB migrated to the current schema ───────────────────────────────────────
  const dbFile = await findSqlite(userData);
  assert.ok(dbFile, 'app created a SQLite database');
  const Database = require('better-sqlite3');
  const db = new Database(dbFile, { readonly: true });
  const version = db.pragma('user_version', { simple: true });
  const imageTable = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'decorative_images'").get();
  db.close();
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const expected = Number(source.match(/export const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.equal(version, expected, `DB migrated to schema v${expected}`);
  assert.equal(imageTable?.ok, 1, 'decorative_images table exists');
  console.log(`[e2e] database at schema v${version}`);

  console.log('e2e smoke test passed');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}

/** First .sqlite file under the profile dir (vault registry decides the layout). */
async function findSqlite(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.sqlite')) return path.join(e.parentPath ?? e.path, e.name);
  }
  return null;
}
