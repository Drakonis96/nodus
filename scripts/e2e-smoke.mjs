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
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
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
    hasStudyImprove: typeof window.nodus?.improveStudyText === 'function' && typeof window.nodus?.listStudyStyles === 'function',
    hasStudyRecordings: typeof window.nodus?.createStudyRecording === 'function' && typeof window.nodus?.saveStudyTranscript === 'function',
    hasStudySearch: typeof window.nodus?.searchStudyCorpus === 'function' && typeof window.nodus?.rebuildStudySearchIndex === 'function',
    hasStudyGrading: typeof window.nodus?.gradeStudyAnswer === 'function' && typeof window.nodus?.listStudyRubrics === 'function',
    hasStudyLearning: typeof window.nodus?.createStudyFlashcard === 'function' && typeof window.nodus?.getStudyPlanner === 'function' && typeof window.nodus?.getStudyProgressDashboard === 'function',
    hasStudyAiPolicy: typeof window.nodus?.getStudyAiUsageSummary === 'function' && typeof window.nodus?.clearStudyAiUsage === 'function',
  }));
  assert.equal(bridge.hasNodus, true, 'window.nodus bridge exposed');
  assert.equal(bridge.hasGetGraph, true, 'getGraph available');
  assert.equal(bridge.hasEdgeFeedback, true, 'setEdgeFeedback available');
  assert.equal(bridge.hasImageModels, true, 'image model catalog available');
  assert.equal(bridge.hasImageQueue, true, 'decorative image queue available');
  assert.equal(bridge.hasSearchDetail, true, 'search detail modal bridge available');
  assert.equal(bridge.hasStudyStt, true, 'study speech-to-text bridge available');
  assert.equal(bridge.hasStudyImprove, true, 'study improvement and style bridge available');
  assert.equal(bridge.hasStudyRecordings, true, 'study recording and transcript bridge available');
  assert.equal(bridge.hasStudySearch, true, 'study hybrid-search bridge available');
  assert.equal(bridge.hasStudyGrading, true, 'study grading and rubric bridge available');
  assert.equal(bridge.hasStudyLearning, true, 'study review, progress and planner bridge available');
  assert.equal(bridge.hasStudyAiPolicy, true, 'study AI policy and usage bridge available');
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

  // Selection-only improvement UI, style CRUD and failure preservation. The smoke
  // profile intentionally has no API key, so generation must fail without touching
  // the original — provider success is covered by the shared AI client tests.
  await page.locator('.study-editor-shell textarea').evaluate((element) => {
    element.focus();
    element.setSelectionRange(15, 32);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.getByTestId('study-improve-toggle').click();
  await page.getByTestId('study-improve-dialog').waitFor();
  assert.equal(await page.locator('[data-testid^="study-style-builtin-"]').count(), 13, 'all predefined improvement styles are visible');
  await page.getByRole('button', { name: 'Estilos', exact: true }).click();
  await page.getByTestId('study-style-new').click();
  await page.getByTestId('study-style-name').fill('Estilo smoke');
  await page.getByTestId('study-style-prompt').fill('Aclara el texto seleccionado sin añadir ninguna información nueva.');
  await page.getByTestId('study-style-save').click();
  await page.waitForFunction(async () => (await window.nodus.listStudyStyles()).some((style) => style.name === 'Estilo smoke'), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Mejora', exact: true }).click();
  await page.getByText('Estilo smoke', { exact: true }).click();
  await page.getByTestId('study-improve-run').click();
  await page.getByText('El original permanece intacto.', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('study-improve-dialog').locator('header button').last().click();
  assert.equal(await page.locator('.study-editor-shell textarea').inputValue(), editorMarkdown, 'failed improvement leaves original Markdown untouched');
  console.log('[e2e] study improvement dialog + custom styles + failure preservation ok');

  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown .katex').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown table.children').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Dividir$/ }).click();
  await page.locator('.study-editor-shell .md .katex').waitFor({ timeout: 30_000 });
  assert.match(await page.locator('body').innerText(), /Tema smoke/, 'document outline and WYSIWYG content render');
  console.log('[e2e] study Milkdown editor + metadata + raw Markdown + versioning ok');

  // ── Study materials: native import dialog + embedded PDF + source note ─────
  const pdfPath = path.join(userData, 'fuente-smoke.pdf');
  const pdfBytes = await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><style>body{font:22px sans-serif;padding:60px}</style><h1>Fuente smoke</h1><p>Fragmento verificable para anotación 2026.</p>')}`);
    const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    win.destroy();
    return [...data];
  });
  await writeFile(pdfPath, Buffer.from(pdfBytes));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async (_window, options) => {
      const actual = options ?? _window;
      if (actual?.title === 'Añadir materiales de estudio') return { canceled: false, filePaths: [filePath] };
      return { canceled: true, filePaths: [] };
    };
  }, pdfPath);
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  const materialSearchPadding = await page.getByTestId('study-material-search').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(materialSearchPadding >= 30, 'material search keeps its icon and text separated');
  await page.getByTestId('study-material-import').click();
  await page.getByText('fuente-smoke', { exact: true }).waitFor({ timeout: 30_000 });
  const importedMaterial = await page.evaluate(async () => (await window.nodus.listStudyMaterials()).find((item) => item.title === 'fuente-smoke'));
  assert.equal(importedMaterial?.previewKind, 'pdf', 'PDF import stores an embedded material');
  assert.ok((importedMaterial?.extractedChars ?? 0) > 20, 'PDF text is extracted for search and citations');
  await page.getByText('fuente-smoke', { exact: true }).click();
  await page.getByTestId('study-pdf-viewer').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="study-pdf-text-layer"] span')?.textContent?.length, { timeout: 30_000 });
  assert.ok(await page.locator('[data-testid="study-pdf-viewer"] canvas').evaluate((canvas) => canvas.width > 0 && canvas.height > 0), 'embedded PDF page rendered to canvas');
  await page.getByTestId('study-pdf-text-layer').evaluate((layer) => {
    const span = [...layer.querySelectorAll('span')].find((item) => item.textContent?.includes('Fragmento')) ?? layer.querySelector('span');
    if (!span) throw new Error('PDF text layer has no selectable text');
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByTestId('study-pdf-annotation-dialog').waitFor();
  await page.getByTestId('study-pdf-annotation-dialog').locator('textarea').fill('Evidencia importante');
  await page.getByRole('button', { name: 'Guardar subrayado', exact: true }).click();
  await page.getByText('Evidencia importante', { exact: true }).waitFor();
  await page.getByText('Crear apunte', { exact: true }).last().click();
  await page.waitForFunction(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.title.includes('fuente-smoke')), { timeout: 30_000 });
  assert.ok(await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.contentMarkdown.includes('nodus://study/material/'))), 'highlight creates a note with a durable source link');
  console.log('[e2e] study material import + embedded PDF + highlight-to-note provenance ok');

  // ── Study recordings: direct microphone capture + timed transcript UI ─────
  await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
  await page.getByTestId('study-recordings-view').waitFor({ timeout: 30_000 });
  const recordingSearchPadding = await page.getByPlaceholder('Buscar grabaciones o transcripciones…').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(recordingSearchPadding >= 30, 'recording search keeps its icon and text separated');
  await page.getByRole('button', { name: 'Grabar clase', exact: true }).click();
  const classRecorder = page.getByTestId('study-class-recorder');
  await classRecorder.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_300);
  await classRecorder.getByRole('button', { name: 'Guardar', exact: true }).click();
  const capturedRecordingId = await page.evaluate(async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const recordingId = (await window.nodus.listStudyRecordings())[0]?.id;
      if (typeof recordingId === 'string' && recordingId.length > 0) return recordingId;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the captured study recording');
  });
  assert.equal(typeof capturedRecordingId, 'string');
  const recordingFixture = await page.evaluate(async (recordingId) => {
    const literal = await window.nodus.saveStudyTranscript(recordingId, {
      kind: 'literal', contentMarkdown: 'Definición literal de memoria de trabajo.', status: 'ready', progress: 1,
      modelProvider: 'local', modelName: 'Whisper smoke',
      segments: [{ tStart: 0.2, tEnd: 1, text: 'Definición literal de memoria de trabajo.', speaker: 'Docente' }],
    });
    await window.nodus.saveStudyTranscript(recordingId, {
      kind: 'corrected', contentMarkdown: 'Definición literal de memoria de trabajo.', sourceTranscriptId: literal.id,
      segments: [{ tStart: 0.2, tEnd: 1, text: 'Definición literal de memoria de trabajo.', speaker: 'Docente' }],
    });
    await window.nodus.createStudyAudioMarker(recordingId, { tSeconds: 0, label: 'Concepto clave' });
    return { id: recordingId, literalId: literal.id };
  }, capturedRecordingId);
  await page.locator(`[data-testid="study-recording-${recordingFixture.id}"]`).click();
  await page.getByTestId('study-recording-player').waitFor({ timeout: 30_000 });
  await page.getByText('Concepto clave', { exact: false }).waitFor();
  await page.getByTestId('study-transcript-segments').waitFor();
  assert.equal(await page.getByTestId('study-transcript-segments').locator('input').first().inputValue(), 'Docente', 'speaker label persists');
  assert.match(await page.getByTestId('study-transcript-segments').locator('textarea').first().inputValue(), /Definición literal/, 'timestamped transcript block renders and remains linked to audio');
  await page.getByRole('button', { name: 'Crear apunte', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.contentMarkdown.includes('nodus://study/recording/')), { timeout: 30_000 });
  console.log('[e2e] direct class capture + recording player + timestamped transcript provenance ok');

  // ── Study hybrid search: local index, saved search and direct seek ─────────
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByTestId('study-search-view').waitFor({ timeout: 30_000 });
  const hybridInput = page.getByTestId('study-search-input');
  assert.ok(await hybridInput.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)) >= 30, 'hybrid search keeps its icon and text separated');
  await page.getByTestId('study-search-view').locator('select').first().selectOption('transcript');
  await hybridInput.fill('memoria de trabajo');
  await page.getByTestId('study-search-result').first().waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-search-result').first().innerText(), /Definición literal de memoria de trabajo/, 'literal transcript is found through the unified local index');
  await page.getByRole('button', { name: 'Guardar búsqueda', exact: true }).click();
  const savedSearchDialog = page.getByRole('dialog', { name: 'Guardar búsqueda' });
  await savedSearchDialog.locator('input').fill('Memoria smoke');
  await savedSearchDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.listStudySavedSearches()).some((item) => item.name === 'Memoria smoke'), { timeout: 30_000 });
  await page.getByTestId('study-search-result').first().locator('button').first().click();
  await page.getByTestId('study-recording-detail').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-recording-player').locator('audio').waitFor();
  await page.waitForFunction(() => (document.querySelector('[data-testid="study-recording-player"] audio')?.currentTime ?? 0) >= 0.19, { timeout: 30_000 });
  console.log('[e2e] hybrid study search + saved query + timestamp navigation ok');

  // ── Study assistant: strict manual scope, durable history and evidence links ─
  await page.getByRole('button', { name: 'Chat de estudio', exact: true }).click();
  await page.getByTestId('study-chat-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-chat-new').click();
  await page.getByTestId('study-chat-scope').selectOption('manual');
  const sourceSearch = page.getByTestId('study-chat-source-search');
  assert.ok(await sourceSearch.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)) >= 30, 'assistant source search keeps icon and text separated');
  await page.getByTestId('study-chat-input').fill('¿Qué dicen mis fuentes sobre la memoria?');
  await page.getByTestId('study-chat-send').click();
  await page.getByText('No hay información suficiente en las fuentes seleccionadas para responder con seguridad.', { exact: false }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('study-chat-message-user').count(), 1, 'an insufficient-context response preserves the user question');
  const seededStudyChat = await page.evaluate(async () => {
    const source = (await window.nodus.listStudyAssistantSources()).find((item) => item.kind === 'document' && item.title === 'Apunte smoke');
    const conversation = (await window.nodus.listStudyAssistantConversations())[0];
    if (!source || !conversation) throw new Error('Study assistant fixture source/conversation unavailable');
    const citation = {
      id: 'S1', sourceKey: source.sourceKey, indexId: `${source.sourceKey}:0`, kind: source.kind, sourceId: source.sourceId,
      title: source.title, subtitle: source.subtitle, quote: 'Texto importante con una fórmula y una tabla.',
      location: { documentId: source.sourceId, from: 0, to: 48 }, scope: source.scope,
    };
    await window.nodus.updateStudyAssistantConversation(conversation.id, {
      title: 'Cita smoke', selection: { scope: 'manual', sourceKeys: [source.sourceKey] },
      messages: [
        { id: crypto.randomUUID(), role: 'user', content: 'Abre la evidencia.', createdAt: new Date().toISOString() },
        { id: crypto.randomUUID(), role: 'assistant', content: 'La evidencia está en el apunte [S1](nodus://study/evidence/S1).', citations: [citation], createdAt: new Date().toISOString() },
      ],
    });
    return conversation.id;
  });
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: 'Chat de estudio', exact: true }).click();
  await page.getByText('Cita smoke', { exact: true }).click();
  await page.getByTestId('study-chat-message-assistant').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-chat-message-assistant').innerText(), /S1/, 'persisted assistant response keeps a verified evidence citation');
  await page.getByRole('button', { name: /S1 · Apunte smoke/ }).click();
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  assert.ok(seededStudyChat, 'study conversation persists in the local vault history');
  console.log('[e2e] grounded study chat + insufficient-context guard + direct evidence navigation ok');

  // ── Study narration: selection/cursor modes, formula speech and dictionary ─
  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  const narrationTextarea = page.locator('.study-editor-shell textarea').first();
  await narrationTextarea.evaluate((element) => {
    const text = element.value;
    const from = Math.max(0, text.indexOf('Texto'));
    element.focus(); element.setSelectionRange(from, Math.min(text.length, from + 18));
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.getByTestId('study-audio-toggle').click();
  await page.getByTestId('study-audio-panel').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-audio-mode').selectOption('selection');
  const narrationSegments = await page.evaluate(async () => window.nodus.getAudioSegments('study_document', (await window.nodus.getStudyWorkspace()).documents.find((document) => document.title === 'Apunte smoke').id, {
    markdown: '# Fórmula\n\nEl valor $x^2$ se conserva.\n\n```js\nconst noLeer = true\n```\n\n## Referencias\n\nNo narrar.',
    title: 'Fórmula',
  }));
  assert.ok(narrationSegments.some((segment) => segment.text.includes('al cuadrado')), 'study narration verbalizes common formulas');
  assert.ok(!narrationSegments.some((segment) => segment.text.includes('noLeer') || segment.text.includes('No narrar')), 'study narration excludes code and references');
  await page.getByTestId('study-audio-tools').click();
  const audioTools = page.getByTestId('study-audio-study-tools');
  await audioTools.getByPlaceholder('Texto escrito').fill('TCC');
  await audioTools.getByPlaceholder('Cómo debe sonar').fill('te ce ce');
  await audioTools.getByRole('button', { name: '+' }).click();
  await page.waitForFunction(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    const subjectId = workspace.placements.find((placement) => placement.documentId === document?.id)?.subjectId;
    return subjectId ? (await window.nodus.getStudyPronunciations(subjectId)).some((entry) => entry.written === 'TCC' && entry.spoken === 'te ce ce') : false;
  }, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Generar audio', exact: true }).click();
  await page.getByText('La lectura de estudio requiere una voz local de Piper o Kokoro.', { exact: true }).waitFor({ timeout: 30_000 });
  console.log('[e2e] local study narration modes + formula speech + pronunciation dictionary ok');

  // ── Study question bank: manual authoring, validation and source metadata ─
  await page.getByRole('button', { name: 'Banco de preguntas', exact: true }).click();
  await page.getByTestId('study-question-bank').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-question-new').click();
  const questionEditor = page.getByTestId('study-question-editor');
  const questionTextareas = questionEditor.locator('textarea');
  await questionTextareas.nth(0).fill('¿Qué demuestra el fragmento verificable de la fuente smoke?');
  await questionTextareas.nth(1).fill('Demuestra que el fragmento está conectado con su evidencia local.');
  await questionTextareas.nth(2).fill('La respuesta procede del fragmento verificable guardado en el vault.');
  await page.getByTestId('study-question-save').click();
  await page.getByRole('heading', { name: '¿Qué demuestra el fragmento verificable de la fuente smoke?', exact: true }).waitFor({ timeout: 30_000 });
  const bankFixture = await page.evaluate(async () => {
    const question = (await window.nodus.listStudyQuestions({ search: 'fragmento verificable' }))[0];
    if (!question) throw new Error('Question bank fixture was not persisted');
    await window.nodus.updateStudyQuestion(question.id, { status: 'approved', locked: true });
    return (await window.nodus.getStudyQuestion(question.id));
  });
  assert.equal(bankFixture.status, 'approved');
  assert.equal(bankFixture.locked, true);
  assert.match(bankFixture.source.excerpt, /respuesta procede del fragmento verificable/i);
  console.log('[e2e] study question bank manual authoring + approval provenance ok');

  // ── Study tests: approved-bank build, durable answer and correction ───────
  await page.getByRole('button', { name: 'Tests', exact: true }).click();
  await page.getByTestId('study-tests-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-new').click();
  await page.getByTestId('study-test-title').fill('Test smoke verificable');
  await page.getByTestId('study-test-create').click();
  await page.getByText('Test smoke verificable', { exact: true }).last().waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-start').click();
  await page.getByTestId('study-test-runner').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-response').fill('Demuestra que el fragmento está conectado con su evidencia local.');
  await page.getByTestId('study-test-submit').click();
  await page.getByTestId('study-test-results').waitFor({ timeout: 30_000 });
  const testFixture = await page.evaluate(async () => {
    const assessment = (await window.nodus.listStudyAssessments('test')).find((item) => item.title === 'Test smoke verificable');
    if (!assessment) throw new Error('Study test fixture was not persisted');
    const attempt = (await window.nodus.listStudyAttempts(assessment.id))[0];
    return { assessment, attempt };
  });
  assert.equal(testFixture.assessment.items.length, 1, 'adaptive test uses the approved bank question');
  assert.equal(testFixture.attempt.status, 'submitted', 'test attempt is durably submitted');
  assert.equal(testFixture.attempt.correctCount, 1, 'objective short answer is corrected deterministically');
  console.log('[e2e] study test construction + durable attempt + objective correction ok');

  // ── Study exams: long-form autosave, delivery and pending grading ─────────
  await page.evaluate(async () => {
    await window.nodus.createStudyQuestion({
      prompt: 'Explica con argumentos cómo se conserva la procedencia en el vault de estudio.', type: 'essay', difficulty: 'medium', cognitiveLevel: 'analyze',
      status: 'approved', answer: { text: 'Debe explicar enlaces, fragmentos exactos y evidencia local.' }, explanation: 'Criterios smoke de respuesta desarrollada.',
      source: { title: 'Fuente smoke', excerpt: 'Los fragmentos exactos mantienen enlaces locales verificables.' }, locked: true,
    });
  });
  await page.getByRole('button', { name: 'Exámenes', exact: true }).click();
  await page.getByTestId('study-exams-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-new').click();
  await page.getByTestId('study-exam-title').fill('Simulacro smoke');
  const examQuestion = page.getByTestId('study-exam-builder').locator('label').filter({ hasText: 'Explica con argumentos cómo se conserva la procedencia' });
  await examQuestion.locator('input[type="checkbox"]').check();
  await page.getByTestId('study-exam-create').click();
  await page.getByText('Simulacro smoke', { exact: true }).last().waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-start').click();
  await page.getByTestId('study-exam-runner').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-response').fill('La procedencia se conserva mediante fragmentos exactos, enlaces locales y evidencia verificable.');
  await page.waitForFunction(async () => {
    const exam = (await window.nodus.listStudyAssessments('exam')).find((item) => item.title === 'Simulacro smoke');
    return exam ? (await window.nodus.listStudyAttempts(exam.id))[0]?.answers.some((answer) => String(answer.response.text ?? '').includes('fragmentos exactos')) : false;
  }, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Entregar examen', exact: true }).click();
  await page.getByTestId('study-exam-results').waitFor({ timeout: 30_000 });
  const examFixture = await page.evaluate(async () => {
    const exam = (await window.nodus.listStudyAssessments('exam')).find((item) => item.title === 'Simulacro smoke');
    if (!exam) throw new Error('Study exam fixture was not persisted');
    return { exam, attempt: (await window.nodus.listStudyAttempts(exam.id))[0] };
  });
  assert.equal(examFixture.attempt.status, 'submitted');
  assert.equal(examFixture.attempt.answers[0].isCorrect, null, 'long-form answer remains pending auditable grading');
  assert.match(examFixture.attempt.answers[0].response.text, /evidencia verificable/);
  console.log('[e2e] written exam + autosave + pending-grading delivery ok');

  // ── Study grading: rubric UI and safe no-provider failure ─────────────────
  await page.getByTestId('study-grade-open').click();
  await page.getByTestId('study-grading-panel').waitFor({ timeout: 30_000 });
  assert.ok(await page.getByTestId('study-grading-panel').locator('select').first().locator('option').count() >= 2, 'built-in weighted rubrics are available');
  await page.getByTestId('study-grade-run').click();
  await page.getByText(/Falta la clave de IA/, { exact: false }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('study-grading-result').count(), 0, 'provider failure never fabricates a grading result');
  console.log('[e2e] rubric grading UI + safe provider-failure preservation ok');

  // ── Study learning: flashcard review, SM-2 evidence, planner and progress ──
  await page.getByRole('button', { name: 'Repaso', exact: true }).click();
  await page.getByTestId('study-review-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-flashcard-new').click();
  const flashcardEditor = page.getByTestId('study-flashcard-editor');
  await page.getByTestId('study-flashcard-front').fill('¿Qué conserva la procedencia local?');
  await flashcardEditor.locator('textarea').nth(1).fill('Fragmentos exactos y enlaces verificables.');
  await page.getByTestId('study-flashcard-save').click();
  await page.getByText('¿Qué conserva la procedencia local?', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('study-review-start').click();
  await page.getByTestId('study-review-session').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-review-session').locator('button').first().click();
  await page.getByTestId('study-review-rate-4').click();
  await page.waitForFunction(async () => (await window.nodus.listStudyFlashcards()).some((card) => card.front.includes('procedencia local') && card.srs.repetitions === 1), { timeout: 30_000 });
  console.log('[e2e] flashcard authoring + real SM-2 review persistence ok');

  await page.getByRole('button', { name: 'Planificador', exact: true }).click();
  await page.getByTestId('study-planner-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-planner-title').fill('Repaso smoke de procedencia');
  await page.getByTestId('study-planner-save').click();
  await page.getByText('Repaso smoke de procedencia', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await page.getByTestId('study-pomodoro-active').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Finalizar y registrar', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.getStudyPlanner()).sessions.some((session) => session.endedAt), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Progreso', exact: true }).click();
  await page.getByTestId('study-progress-view').waitFor({ timeout: 30_000 });
  const learningFixture = await page.evaluate(async () => ({ planner: await window.nodus.getStudyPlanner(), progress: await window.nodus.getStudyProgressDashboard() }));
  assert.ok(learningFixture.planner.blocks.some((block) => block.title === 'Repaso smoke de procedencia'));
  assert.ok(learningFixture.progress.overall.reviews >= 1, 'progress dashboard is backed by review evidence');
  console.log('[e2e] planner, Pomodoro registration and evidence-backed progress ok');

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  await page.getByTestId('study-ai-settings').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-ai-budget').fill('12');
  await page.waitForFunction(async () => (await window.nodus.getSettings()).studyAiMonthlyBudgetUsd === 12, { timeout: 30_000 });
  const aiPolicyFixture = await page.evaluate(async () => ({ settings: await window.nodus.getSettings(), usage: await window.nodus.getStudyAiUsageSummary() }));
  assert.equal(aiPolicyFixture.settings.studyAiMonthlyBudgetUsd, 12);
  assert.ok(aiPolicyFixture.usage.failedCalls >= 1, 'failed grading request is auditable in task usage');
  assert.equal(aiPolicyFixture.usage.knownCostUsd, 0, 'unknown provider price is never guessed');
  console.log('[e2e] independent study AI policy, budget and truthful usage accounting ok');

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
