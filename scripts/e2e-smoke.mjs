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
import { chmod, mkdir, mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
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
const fakeWhisperPath = path.join(userData, 'fake-whisper-cli.mjs');
if (process.platform !== 'win32') {
  await writeFile(fakeWhisperPath, `#!/usr/bin/env node
process.stderr.write('whisper_print_progress_callback: progress = 25%\\n');
process.stdout.write('[00:00:00.000 --> 00:00:01.000] Hola\\n');
setTimeout(() => {
  process.stderr.write('whisper_print_progress_callback: progress = 100%\\n');
  process.stdout.write('[00:00:01.000 --> 00:00:02.000] mundo\\n');
}, 30);
`, 'utf8');
  await chmod(fakeWhisperPath, 0o755);
  const modelDir = path.join(userData, 'whisper.cpp', 'models');
  await mkdir(modelDir, { recursive: true });
  await writeFile(path.join(modelDir, 'ggml-base.bin'), 'e2e-placeholder');
}
async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const closedCleanly = await Promise.race([
    closed,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timeout);
  if (!closedCleanly && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

let app = null;
try {
  // The child must run as a real GUI app: strip the runner's as-Node flag.
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
    NODUS_E2E_FORCE_STUDY_AI_FAILURE: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', repoRoot],
    env: childEnv,
  });

  // ── Window + renderer mount ─────────────────────────────────────────────────
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
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
    hasStudyKnowledge: typeof window.nodus?.listStudyIdeas === 'function' && typeof window.nodus?.getStudyKnowledgeGraph === 'function' && typeof window.nodus?.reanalyzeStudyKnowledgeSource === 'function',
    hasStudyGrading: typeof window.nodus?.gradeStudyAnswer === 'function' && typeof window.nodus?.listStudyRubrics === 'function',
    hasStudyLearning: typeof window.nodus?.createStudyFlashcard === 'function' && typeof window.nodus?.getStudyPlanner === 'function' && typeof window.nodus?.getStudyProgressDashboard === 'function',
    hasStudyAiPolicy: typeof window.nodus?.getStudyAiUsageSummary === 'function' && typeof window.nodus?.clearStudyAiUsage === 'function',
    hasStudyDemo: typeof window.nodus?.seedStudyDemoData === 'function',
    hasNodusLocalAi: typeof window.nodus?.getNodusLocalAiStatus === 'function' && typeof window.nodus?.downloadNodusLocalModel === 'function' && typeof window.nodus?.deleteNodusLocalModel === 'function',
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
  assert.equal(bridge.hasStudyKnowledge, true, 'study ideas and knowledge-graph bridge available');
  assert.equal(bridge.hasStudyGrading, true, 'study grading and rubric bridge available');
  assert.equal(bridge.hasStudyLearning, true, 'study review, progress and planner bridge available');
  assert.equal(bridge.hasStudyAiPolicy, true, 'study AI policy and usage bridge available');
  assert.equal(bridge.hasStudyDemo, true, 'study sample-data bridge available');
  assert.equal(bridge.hasNodusLocalAi, true, 'integrated local AI model manager bridge available');
  console.log('[e2e] preload bridge ok');

  // ── Essential tutorial: first screen, language preferences, seen-once gate ──
  await page.getByTestId('basics-tutorial-language').waitFor({ timeout: 30_000 });
  const languageButtonSizes = await page.locator('.tutorial-language-option').evaluateAll((buttons) =>
    buttons.map((button) => { const box = button.getBoundingClientRect(); return `${Math.round(box.width)}x${Math.round(box.height)}`; }));
  assert.equal(new Set(languageButtonSizes).size, 1, `every cinematic tutorial language button has the same dimensions: ${languageButtonSizes.join(', ')}`);
  await page.getByTestId('tutorial-language-fr').click();
  await page.getByTestId('basics-tutorial').waitFor({ timeout: 30_000 });
  await page.waitForFunction(async () => {
    const settings = await window.nodus.getSettings();
    return settings.uiLanguage === 'en' && settings.promptLanguage === 'fr';
  });
  assert.equal(await page.locator('.tutorial-progress button').count(), 13, 'essential guide exposes thirteen novice-friendly chapters');
  await page.locator('.tutorial-topbar button').click();
  await page.getByText('Skip the essential guide?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Skip anyway', exact: true }).click();
  await page.getByTestId('basics-tutorial').waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).basicsTutorialVersion, 3, 'confirmed skip records the current tutorial version globally');
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', promptLanguage: 'es' }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  assert.equal(await page.getByTestId('basics-tutorial-language').count(), 0, 'a seen cinematic tutorial does not return after restart/update');
  console.log('[e2e] essential tutorial language preferences + persistent seen-once gate ok');

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
      basicsTutorialVersion: 3,
      recoverySetupVersion: 1,
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
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  await page.getByText('Generación de imágenes', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('gemini-3.1-flash-lite-image', { exact: false }).count() > 0, true, 'image settings render selected verified model');
  console.log('[e2e] image provider settings rendered');
  await page.getByTestId('nodus-local-ai-models').waitFor({ timeout: 30_000 });
  const localAiStatus = await page.evaluate(() => window.nodus.getNodusLocalAiStatus());
  assert.equal(localAiStatus.models.length, 6, 'integrated local AI catalog is available over the real preload bridge');
  assert.equal(await page.getByText('BGE-M3 Q8_0', { exact: true }).count(), 1, 'local embedding catalog renders');
  assert.equal(await page.getByText('Qwen3.5-0.8B Q4', { exact: true }).count(), 1, 'local multimodal chat catalog renders');
  assert.equal(await page.getByText('Importante sobre los embeddings:', { exact: false }).count(), 1, 'embedding compatibility warning remains visible');
  if (process.env.NODUS_E2E_LOCAL_RUNTIME === '1') {
    const installedRuntime = await page.evaluate(async () => {
      const progress = [];
      const status = await window.nodus.installNodusLocalRuntime((fraction) => progress.push(fraction));
      return { status, progress };
    });
    assert.equal(installedRuntime.status.runtime.ready, true, 'Nodus downloads and extracts a working llama.cpp runtime');
    assert.ok(installedRuntime.progress.some((fraction) => fraction >= 1), 'local runtime installation reports completion progress');
  }
  await page.getByTestId('stt-settings').waitFor({ timeout: 30_000 });
  assert.deepEqual(await page.getByTestId('stt-provider').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['transformers', 'whisper_cpp', 'openai'], 'Settings owns all STT engines');
  const whisperCppStatus = await page.evaluate(() => window.nodus.getWhisperCppStatus());
  assert.ok(whisperCppStatus.models.length >= 5, 'whisper.cpp model manager is available over the real preload bridge');
  await page.getByTestId('stt-provider').selectOption('whisper_cpp');
  await page.getByTestId('stt-settings').getByRole('button', { name: /Instalar|Desinstalar/, exact: true }).waitFor();
  if (process.platform !== 'win32') {
    await page.evaluate(({ executable }) => window.nodus.updateSettings({ sttWhisperCppExecutable: executable, sttWhisperCppModel: 'base' }), { executable: fakeWhisperPath });
    const streamedCpp = await page.evaluate(async () => {
      const partials = []; const progress = [];
      const result = await window.nodus.transcribeStudyAudio({
        audioBytes: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav', provider: 'whisper_cpp', model: 'base', language: 'auto',
      }, { onPartial: (text) => partials.push(text), onProgress: (fraction) => progress.push(fraction) });
      return { result, partials, progress };
    });
    assert.equal(streamedCpp.result.text, 'Hola mundo', 'whisper.cpp IPC returns accumulated text');
    assert.deepEqual(streamedCpp.partials, ['Hola', 'Hola mundo'], 'whisper.cpp IPC streams segments before completion');
    assert.ok(streamedCpp.progress.some((value) => value >= 1), 'whisper.cpp IPC streams progress');
  }
  await page.getByTestId('stt-provider').selectOption('transformers');
  console.log('[e2e] STT engine/model management rendered in Settings');
  if (process.env.NODUS_E2E_STT_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused STT Settings + whisper.cpp streaming smoke passed');
    process.exit(0);
  }
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

  const graphOverview = await page.evaluate(() => window.nodus.getGraphOverview());
  assert.ok(
    Array.isArray(graphOverview.nodes) && graphOverview.nodes.every((node) => node.type === 'theme'),
    'graph:overview returns only compact theme hubs'
  );
  if (graphOverview.nodes.length > 0) {
    const graphTheme = await page.evaluate(
      ({ label }) => window.nodus.getGraphTheme(label, 90),
      { label: graphOverview.nodes[0].themes[0] ?? graphOverview.nodes[0].label }
    );
    const graphThemeIdeas = graphTheme.nodes.filter((node) => node.type !== 'theme');
    assert.ok(graphThemeIdeas.length <= 150, 'graph:theme keeps the default scene bounded');
    const graphThemeNodeIds = new Set(graphTheme.nodes.map((node) => node.id));
    assert.ok(
      graphTheme.edges.every((edge) => graphThemeNodeIds.has(edge.source) && graphThemeNodeIds.has(edge.target)),
      'graph:theme only returns edges whose endpoints are present'
    );
  }
  console.log(`[e2e] progressive graph IPC ok (${graphOverview.nodes.length} overview themes)`);

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
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 3, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, theme: 'light' });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).first().click();
  await page.getByTestId('study-create-course').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('Crea tu primer curso para empezar.', { exact: true }).count(), 0, 'empty-state guidance stays out of the sidebar');
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'estudio', 'study vault uses the teal Nodus logo');

  const organizationBox = await page.getByTestId('study-sidebar-organization').boundingBox();
  const analyzeBox = await page.getByRole('button', { name: 'Analizar', exact: true }).boundingBox();
  assert.ok(organizationBox && analyzeBox && analyzeBox.y - (organizationBox.y + organizationBox.height) < 40, 'Analyze follows Organization without a flex spacer');
  assert.equal(await page.getByRole('button', { name: 'Banco de preguntas', exact: true }).isDisabled(), false, 'question bank is enabled');
  for (const removed of ['Tests', 'Exámenes', 'Repaso', 'Planificador', 'Progreso']) {
    assert.equal(await page.getByRole('button', { name: removed, exact: true }).count(), 0, `${removed} is not rendered`);
  }
  await page.getByTestId('study-sidebar-organization-toggle').click();
  assert.equal(await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).count(), 0, 'Organization can be collapsed');
  assert.equal(await page.getByTestId('study-sidebar-organization-toggle').getAttribute('aria-expanded'), 'false');
  await page.getByTestId('study-sidebar-organization-toggle').click();
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).waitFor();

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
  await createStudyItem('study-create-topic', 'Tema smoke');
  const searchPadding = await page.getByTestId('study-organization-search').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(searchPadding >= 30, `study search reserves space for its leading icon (${searchPadding}px)`);
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
  assert.ok(study.placement?.courseId && study.placement?.subjectId && study.placement?.folderId && study.placement?.topicId, 'UI-created material keeps the selected hierarchy placement');
  assert.match(await page.locator('body').innerText(), /Cursos y asignaturas/, 'study-specific sidebar is rendered');
  console.log('[e2e] study logo, search padding, sidebar flow and creation dialogs ok');

  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY !== '1') {
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-toggle').click();
  await page.getByTestId('study-dictation').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-dictation').innerText(), /ONNX|Local|offline/i, 'dictation panel defaults to the offline ONNX backend');
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Dictado', exact: true }).click();
  const dictationLanguage = page.getByTestId('study-dictation-language');
  await dictationLanguage.waitFor();
  assert.equal(await dictationLanguage.locator('option').first().getAttribute('value'), 'auto', 'dictation supports automatic language detection');
  assert.ok(await dictationLanguage.locator('option').count() >= 100, 'dictation exposes every language supported by multilingual Whisper');
  await dictationLanguage.selectOption('es');
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Dictado', exact: true }).click();
  await page.getByTestId('study-dictation-start').click();
  await page.getByTestId('study-dictation-discard').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-discard').click();
  await page.getByTestId('study-dictation-start').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-toggle').click();
  console.log('[e2e] study dictation panel + fake microphone capture ok');
  if (process.env.NODUS_E2E_STT_UI_ONLY === '1') {
    const recordingId = await page.evaluate(async () => (await window.nodus.createStudyRecording({
      fileName: 'idioma-smoke.wav', mimeType: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]), language: 'auto',
    })).recording.id);
    await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
    await page.getByTestId('study-recordings-view').waitFor();
    await page.locator(`[data-testid="study-recording-${recordingId}"]`).click();
    const recordingLanguage = page.getByTestId('study-recording-language');
    await recordingLanguage.waitFor();
    assert.equal(await recordingLanguage.inputValue(), 'auto', 'recordings preserve per-audio automatic detection');
    assert.ok(await recordingLanguage.locator('option').count() >= 100, 'recordings expose every language supported by multilingual Whisper');
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused dictation + recording language UI smoke passed');
    process.exit(0);
  }
  await page.getByTestId('study-doc-favorite').click();
  await page.getByTestId('study-doc-style').click();
  await page.getByTestId('study-doc-kind').selectOption('manual');
  await page.getByTestId('study-doc-color').fill('#22c55e');
  await page.waitForFunction(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    return document?.favorite === true && document.kind === 'manual' && document.color === '#22c55e';
  }, { timeout: 30_000 });
  console.log('[e2e] study editor metadata controls ok');
  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  const editorMarkdown = '# Tema smoke\n\nTexto **importante** con $x^2$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  await page.locator('.study-editor-shell textarea').fill(editorMarkdown);
  // Exercise the editor's real autosave and poll the persisted state directly;
  // dispatching a second manual save would make this smoke assertion depend on
  // runner timing instead of the durability contract it is meant to verify.
  await page.evaluate(async (expected) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const workspace = await window.nodus.getStudyWorkspace();
      const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
      if (document?.contentMarkdown === expected) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('El autoguardado del editor no persistió el Markdown a tiempo.');
  }, editorMarkdown);
  const editorRoundTrip = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    if (!document) return null;
    const data = await window.nodus.getStudyDocEditorData(document.id);
    return { content: document.contentMarkdown, versions: data.versions.length };
  });
  assert.equal(editorRoundTrip?.content, editorMarkdown, 'raw Markdown round-trips exactly through the editor');
  assert.ok((editorRoundTrip?.versions ?? 0) >= 1, 'editor save creates a recoverable version');
  console.log('[e2e] study editor raw Markdown autosave + version ok');

  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY !== '1') {
  // Compact prompt manager + contextual streaming actions. The smoke profile
  // intentionally has no usable provider, so the direct action must restore
  // the original selection after the streamed request fails.
  await page.getByTestId('study-improve-toggle').click();
  await page.getByTestId('study-improve-dialog').waitFor();
  const improveDialogBox = await page.getByTestId('study-improve-dialog').locator('section').first().boundingBox();
  assert.ok(improveDialogBox && improveDialogBox.width <= 680, `prompt manager stays compact (${improveDialogBox?.width}px)`);
  assert.equal(await page.locator('[data-testid^="study-style-builtin-"]').count(), 13, 'all predefined improvement styles are visible');
  await page.getByTestId('study-style-builtin-academic').click();
  await page.getByText('Registro académico preciso y argumentación ordenada.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Conservar significado', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Transformación libre', { exact: true }).count(), 0);
  await page.getByTestId('study-style-toolbar-builtin-proofread').click();
  await page.getByText('Puedes mostrar un máximo de cuatro prompts en la barra.', { exact: true }).waitFor();
  await page.getByTestId('study-style-new').click();
  await page.getByTestId('study-prompt-title').fill('Pulir smoke');
  await page.getByTestId('study-prompt-text').fill('Reescribe el texto seleccionado con mayor fluidez sin añadir información nueva.');
  await page.getByTestId('study-create-icon-emoji').click();
  await page.getByRole('button', { name: 'Emoji 🧪', exact: true }).click();
  await page.getByTestId('study-prompt-save').click();
  await page.getByText('Prompt guardado.', { exact: true }).waitFor();
  await page.getByTestId('study-improve-dialog').locator('header button').last().click();

  await page.getByRole('button', { name: /Markdown crudo/ }).click();
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown .ProseMirror').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('Texto') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 5);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 420, clientY: 420 })); return;
    }
    throw new Error('Improvement selection fixture not found');
  });
  await page.getByTestId('study-selection-text-color').waitFor();
  assert.equal(await page.locator('[data-testid^="study-quick-improve-"]').count(), 4, 'the selection exposes exactly the four configured prompt shortcuts');
  const failedImprovement = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    const style = (await window.nodus.listStudyStyles()).find((item) => item.id === 'builtin:academic');
    if (!document || !style) throw new Error('Improvement failure fixture not found');
    try {
      await window.nodus.improveStudyText({
        documentId: document.id,
        subjectId: workspace.placements.find((item) => item.documentId === document.id)?.subjectId,
        text: 'Texto',
        styleId: style.id,
        scope: 'selection',
        level: style.level,
        length: style.length,
        mode: 'preserve',
        variables: { language: style.language, documentType: document.kind, selectedText: 'Texto' },
        protectedTerms: [document.title],
        model: null,
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(failedImprovement, true, 'the deterministic provider failure reaches the renderer bridge');
  const unchangedAfterImprovement = await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.find((item) => item.title === 'Apunte smoke')?.contentMarkdown);
  // Milkdown may canonicalize equivalent table separators when leaving raw
  // mode; the selected source phrase itself must remain byte-for-byte intact.
  assert.match(unchangedAfterImprovement ?? '', /Texto \*\*importante\*\* con \$x\^2\$\./, 'failed improvement leaves the selected Markdown untouched');
  console.log('[e2e] compact prompt manager + four contextual streaming shortcuts + failure preservation ok');

  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown .katex').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown table.children').waitFor({ timeout: 30_000 });
  await page.locator('.study-milkdown .ProseMirror').evaluate((root) => {
    const range = document.createRange();
    range.selectNodeContents(root); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await page.getByTestId('study-heading-level').selectOption('2');
  await page.locator('.study-milkdown .ProseMirror h2').waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.study-milkdown .ProseMirror').getByText('## Título', { exact: true }).count(), 0, 'visual heading insertion creates a heading node rather than literal Markdown');
  await page.locator('.study-milkdown .ProseMirror').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('Texto') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 5);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return;
    }
    throw new Error('Text selection fixture not found');
  });
  await page.getByTestId('study-inline-code').click();
  assert.ok(await page.locator('.study-milkdown .ProseMirror code').count() > 0, 'inline-code button formats the visual selection');
  await page.locator('.study-milkdown .ProseMirror').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('importante') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 10);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return;
    }
    throw new Error('Formula selection fixture not found');
  });
  await page.getByTestId('study-inline-formula').click();
  assert.ok(await page.locator('.study-milkdown .ProseMirror [data-type="math_inline"]').count() > 0, 'formula button converts selected visual text into inline math');
  const splitButton = page.getByRole('button', { name: 'Dividir vista', exact: true });
  await splitButton.click();
  assert.match(await splitButton.getAttribute('class'), /bg-indigo-100/, 'active split-view control uses its light-theme state');
  await page.locator('.study-editor-shell .md .katex').waitFor({ timeout: 30_000 });
  assert.match(await page.locator('body').innerText(), /Tema smoke/, 'document outline and WYSIWYG content render');
  console.log('[e2e] study Milkdown editor + metadata + raw Markdown + versioning ok');
  }
  }

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
      if (actual?.title === 'Seleccionar materiales de estudio') return { canceled: false, filePaths: [filePath] };
      return { canceled: true, filePaths: [] };
    };
  }, pdfPath);
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  const userNoteId = await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.find((document) => document.title === 'Apunte smoke')?.id);
  assert.equal(typeof userNoteId, 'string');
  await page.getByTestId(`study-material-note-${userNoteId}`).waitFor();
  await page.getByTestId(`study-material-note-${userNoteId}`).click();
  await page.locator('.study-editor-shell').waitFor({ timeout: 30_000 });
  assert.match(await page.getByRole('tab', { selected: true }).innerText(), /Apunte smoke/, 'a user-created note opens from Materials');
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  const materialSearchPadding = await page.getByTestId('study-material-search').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(materialSearchPadding >= 30, 'material search keeps its icon and text separated');
  await page.getByTestId('study-material-import').click();
  await page.getByTestId('study-material-import-dialog').waitFor();
  await page.getByRole('button', { name: 'Seleccionar archivos o ZIP', exact: true }).click();
  await page.getByTestId('study-material-import-dialog').getByText('fuente-smoke.pdf', { exact: true }).waitFor();
  await page.getByTestId('study-material-import-confirm').click();
  await page.getByTestId('study-material-import-dialog').waitFor({ state: 'detached' });
  await page.getByText('fuente-smoke', { exact: true }).waitFor({ timeout: 30_000 });
  const importedMaterial = await page.evaluate(async () => (await window.nodus.listStudyMaterials()).find((item) => item.title === 'fuente-smoke'));
  assert.equal(importedMaterial?.previewKind, 'pdf', 'PDF import stores an embedded material');
  assert.ok((importedMaterial?.extractedChars ?? 0) > 20, 'PDF text is extracted for search and citations');
  await page.getByText('fuente-smoke', { exact: true }).click();
  await page.getByTestId('study-pdf-viewer').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-pdf-page] .select-text span')?.textContent?.length, { timeout: 30_000 });
  assert.ok(await page.locator('[data-testid="study-pdf-viewer"] canvas').evaluateAll((canvases) => canvases.some((canvas) => canvas.width > 0 && canvas.height > 0)), 'embedded PDF page rendered to canvas');
  await page.locator('[data-pdf-page] .select-text').first().evaluate((layer) => {
    const span = [...layer.querySelectorAll('span')].find((item) => item.textContent?.includes('Fragmento')) ?? layer.querySelector('span');
    if (!span) throw new Error('PDF text layer has no selectable text');
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForFunction(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'highlight' && annotation.selectedText.length > 0), importedMaterial.id, { timeout: 30_000 });
  await page.getByTestId('study-material-annotations-sidebar').waitFor();
  for (const tool of ['highlight', 'underline', 'brush', 'sticky', 'comment']) await page.getByTestId(`study-pdf-tool-${tool}`).waitFor();
  await page.getByTestId('study-pdf-tool-brush').click();
  await page.getByTestId('study-pdf-brush-thickness').fill('7');
  const annotationCanvas = page.locator('[data-pdf-page] > svg[class*="z-20"]').first();
  const annotationCanvasBox = await annotationCanvas.boundingBox();
  assert.ok(annotationCanvasBox);
  await page.mouse.move(annotationCanvasBox.x + 80, annotationCanvasBox.y + 100);
  await page.mouse.down(); await page.mouse.move(annotationCanvasBox.x + 150, annotationCanvasBox.y + 130, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'brush' && annotation.thickness === 7), importedMaterial.id, { timeout: 30_000 });
  await page.getByTestId('study-pdf-tool-sticky').click();
  await annotationCanvas.click({ position: { x: 180, y: 160 } });
  await page.getByTestId('study-pdf-sticky-dialog').locator('textarea').fill('Sticker smoke');
  await page.getByRole('button', { name: 'Guardar sticker', exact: true }).click();
  await page.getByText('Sticker smoke', { exact: true }).waitFor();
  await page.getByTestId('study-pdf-tool-comment').click();
  await annotationCanvas.click({ position: { x: 220, y: 210 } });
  await page.getByTestId('study-pdf-inline-comment').locator('textarea').fill('Comentario smoke');
  await page.getByTestId('study-pdf-inline-comment').getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Comentario smoke', { exact: true }).waitFor();
  await page.getByText('Crear apunte', { exact: true }).last().click();
  await page.waitForFunction(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.title.includes('fuente-smoke')), { timeout: 30_000 });
  assert.ok(await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.contentMarkdown.includes('nodus://study/material/'))), 'highlight creates a note with a durable source link');
  console.log('[e2e] study material import + embedded PDF + highlight-to-note provenance ok');
  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY === '1') {
    const AdmZip = require('adm-zip');
    const epubPath = path.join(userData, 'libro-smoke.epub');
    const epub = new AdmZip();
    epub.addFile('mimetype', Buffer.from('application/epub+zip'));
    epub.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'));
    epub.addFile('OEBPS/content.opf', Buffer.from('<?xml version="1.0"?><package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'));
    epub.addFile('OEBPS/chapter.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Libro smoke</h1><p>Fragmento EPUB seleccionable y verificable.</p></body></html>'));
    await writeFile(epubPath, epub.toBuffer());
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, epubPath);
    await page.getByRole('button', { name: 'Materiales', exact: true }).click();
    await page.getByTestId('study-material-import').click();
    await page.getByRole('button', { name: 'Seleccionar archivos o ZIP', exact: true }).click();
    await page.getByTestId('study-material-import-confirm').click();
    await page.getByText('libro-smoke', { exact: true }).waitFor({ timeout: 30_000 });
    const importedEpub = await page.evaluate(async () => (await window.nodus.listStudyMaterials()).find((item) => item.title === 'libro-smoke'));
    assert.equal(importedEpub?.extension, 'epub');
    await page.getByText('libro-smoke', { exact: true }).click();
    await page.getByTestId('study-epub-viewer').waitFor();
    for (const tool of ['highlight', 'underline', 'brush', 'sticky', 'comment']) await page.getByTestId(`study-epub-tool-${tool}`).waitFor();
    await page.locator('[data-testid="study-epub-viewer"] .font-serif').evaluate((root) => {
      const node = [...root.childNodes].flatMap((child) => child.nodeType === Node.TEXT_NODE ? [child] : [...child.childNodes]).find((child) => child.textContent?.includes('Fragmento'));
      if (!node) throw new Error('EPUB text fixture not found');
      const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForFunction(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'highlight'), importedEpub.id, { timeout: 30_000 });
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused PDF + EPUB annotation toolbar smoke passed');
    process.exit(0);
  }

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
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
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
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
  console.log('[e2e] direct class capture + recording modal + timestamped transcript ok');

  // ── Study hybrid search: local index, saved search and direct seek ─────────
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByTestId('study-search-view').waitFor({ timeout: 30_000 });
  const hybridInput = page.getByTestId('study-search-input');
  assert.ok(await hybridInput.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)) >= 30, 'hybrid search keeps its icon and text separated');
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByTestId('study-search-view').locator('select').first().selectOption('transcript');
  await hybridInput.fill('memoria de trabajo');
  await page.getByTestId('study-search-result').first().waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-search-result').first().innerText(), /Definición literal de memoria de trabajo/, 'literal transcript is found through the unified local index');
  await page.getByTestId('study-search-view').getByRole('button', { name: 'Guardar', exact: true }).click();
  const savedSearchDialog = page.getByRole('dialog', { name: 'Guardar búsqueda' });
  await savedSearchDialog.locator('input').fill('Memoria smoke');
  await savedSearchDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.listStudySavedSearches()).some((item) => item.name === 'Memoria smoke'), { timeout: 30_000 });
  await page.getByTestId('study-search-result').first().locator('button').first().click();
  await page.getByTestId('study-recording-detail').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-recording-player').locator('audio').waitFor();
  await page.waitForFunction(() => (document.querySelector('[data-testid="study-recording-player"] audio')?.currentTime ?? 0) >= 0.19, { timeout: 30_000 });
  console.log('[e2e] hybrid study search + saved query + timestamp navigation ok');

  // Analysis destinations are intentionally inaccessible in v2.3. Return from
  // the search evidence modal to the note through the supported Organization UI.
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
  const capturedRecordingRow = page.getByTestId(`study-recording-${recordingFixture.id}`);
  await capturedRecordingRow.waitFor();
  await page.getByTestId(`study-recording-trash-${recordingFixture.id}`).click();
  const recordingDeleteDialog = page.getByRole('dialog').filter({ hasText: 'Mover grabación a la papelera' });
  await recordingDeleteDialog.waitFor();
  await recordingDeleteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await capturedRecordingRow.waitFor();
  await page.getByTestId(`study-recording-trash-${recordingFixture.id}`).click();
  await recordingDeleteDialog.getByRole('button', { name: 'Mover a la papelera', exact: true }).click();
  await capturedRecordingRow.waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(async () => window.nodus.listStudyRecordings())).some((recording) => recording.id === recordingFixture.id), false, 'recording is deleted only after confirmation');
  console.log('[e2e] study recording deletion requires explicit confirmation');
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).click();
  for (const label of ['Curso smoke', 'Asignatura smoke', 'Carpeta smoke', 'Tema smoke']) {
    await page.getByText(label, { exact: true }).last().click();
  }
  await page.getByText('Apunte smoke', { exact: true }).last().click();
  await page.locator('.study-milkdown .ProseMirror').waitFor({ timeout: 30_000 });

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

  // These flows remain ready for reactivation, but the corresponding renderer
  // routes are intentionally locked for users in v2.3.
  const studyAnalysisUiEnabled = false;
  if (studyAnalysisUiEnabled) {
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
  }

  await page.locator('[data-tour="nav-studyIdeas"]').click();
  await page.getByTestId('study-ideas-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-ideas-subject').waitFor();
  const knowledgeThemeColors = await page.getByTestId('study-ideas-view').evaluate(async (element) => {
    const light = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const dark = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.remove('dark');
    return { light, dark };
  });
  assert.notEqual(knowledgeThemeColors.light, knowledgeThemeColors.dark, 'study ideas surface adapts between light and dark themes');
  await page.getByRole('button', { name: 'Abrir grafo', exact: true }).click();
  await page.getByTestId('study-graph-view').waitFor();
  await page.getByTestId('study-graph-subject').waitFor();
  console.log('[e2e] subject-scoped Ideas and Graph views render in light and dark themes');

  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  assert.equal(await page.getByTestId('study-ai-settings').count(), 0, 'redundant study AI settings section is not rendered');
  const aiPolicyFixture = await page.evaluate(async () => ({ settings: await window.nodus.getSettings(), usage: await window.nodus.getStudyAiUsageSummary() }));
  assert.ok(aiPolicyFixture.usage.failedCalls >= 1, 'failed improvement request is auditable in task usage');
  assert.equal(aiPolicyFixture.usage.knownCostUsd, 0, 'unknown provider price is never guessed');
  console.log('[e2e] study AI policy remains active without redundant settings UI');

  assert.equal(aiPolicyFixture.settings.studyAiPrivacyMode, 'hybrid');
  assert.equal(aiPolicyFixture.settings.studyAiConfirmExternal, true);
  await page.getByRole('button', { name: 'Backup / copia de seguridad', exact: true }).click();
  await page.getByTestId('study-data-admin').waitFor({ timeout: 30_000 });
  const dataFixture = await page.evaluate(async () => await window.nodus.getStudyDataOverview());
  assert.equal(dataFixture.integrityOk, true, 'study data panel runs SQLite integrity checks');
  assert.deepEqual(dataFixture.foreignKeyErrors, [], 'study data panel detects no orphaned references');
  assert.ok(dataFixture.studyRows > 0, 'study data panel counts the E2E rows');
  console.log('[e2e] study privacy controls and real data administration checks ok');

  // Accessibility preferences are changed through the rendered controls and
  // applied at the document root, including the study-only reading mode.
  await page.getByRole('button', { name: 'Interfaz', exact: true }).click();
  const accessibility = page.getByTestId('accessibility-settings');
  await accessibility.waitFor({ timeout: 30_000 });
  await page.getByLabel('Tamaño de la interfaz', { exact: true }).fill('1.15');
  const checkAccessibility = async (label) => accessibility.locator('label').filter({ hasText: label }).locator('input[type="checkbox"]').check();
  await checkAccessibility('Fuente de alta legibilidad');
  await checkAccessibility('Contraste reforzado');
  await checkAccessibility('Reducir animaciones');
  await checkAccessibility('Modo de lectura');
  await page.waitForFunction(() => document.documentElement.classList.contains('accessible-font')
    && document.documentElement.classList.contains('high-contrast')
    && document.documentElement.classList.contains('reduce-motion')
    && document.documentElement.classList.contains('reading-focus'));
  assert.equal(await page.getByTestId('app-shell').getAttribute('data-interface-scale'), '1.15');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByText('Salir del modo lectura', { exact: true }).waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  console.log('[e2e] accessibility controls + keyboard command palette apply globally');

  // A second, empty study vault exercises the real sample-data offer and the
  // reversible cleanup path without touching the study records created above.
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Study demo smoke', type: 'estudio' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
      studyTourComplete: true,
    });
  });
  await page.reload();
  await page.getByTestId('study-demo-offer').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cargar datos de ejemplo', exact: true }).click();
  await page.waitForFunction(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    return workspace.courses.length === 1 && workspace.subjects.length === 2 && workspace.documents.length === 2;
  }, { timeout: 30_000 });
  await page.getByText('Membrana plasmática · resumen', { exact: true }).waitFor({ timeout: 30_000 });
  const demoFixture = await page.evaluate(async () => ({
    settings: await window.nodus.getSettings(),
    questions: await window.nodus.listStudyQuestions(),
    cards: await window.nodus.listStudyFlashcards(),
    planner: await window.nodus.getStudyPlanner(),
    cellIdeas: await window.nodus.listStudyIdeas('demo-study-subject-cell'),
    cellGraph: await window.nodus.getStudyKnowledgeGraph('demo-study-subject-cell'),
    ecologyIdeas: await window.nodus.listStudyIdeas('demo-study-subject-ecology'),
  }));
  assert.equal(demoFixture.settings.demoMode, true);
  assert.equal(demoFixture.questions.length, 1);
  assert.equal(demoFixture.cards.length, 1);
  assert.equal(demoFixture.planner.plans.length, 1);
  assert.equal(demoFixture.cellIdeas.length, 4);
  assert.equal(demoFixture.cellGraph.edges.length, 3);
  assert.equal(demoFixture.ecologyIdeas.length, 3);
  const studyTourLabel = page.getByText(/^Tutorial de estudio/);
  await studyTourLabel.waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Saltar/ }).click();
  await studyTourLabel.waitFor({ state: 'detached', timeout: 30_000 });
  await page.getByRole('button', { name: 'Salir del modo demo', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.getStudyWorkspace()).courses.length === 0, { timeout: 30_000 });
  await page.getByTestId('study-demo-offer').waitFor({ timeout: 30_000 });
  console.log('[e2e] reversible study sample workspace works through the real UI and IPC bridge');

  // ── No uncaught renderer errors during startup ──────────────────────────────
  assert.deepEqual(
    pageErrors.map((e) => String(e?.message ?? e)),
    [],
    'renderer produced uncaught errors'
  );
  console.log('[e2e] no renderer page errors');

  await closeElectronApp(app);
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
  if (app) await closeElectronApp(app);
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
