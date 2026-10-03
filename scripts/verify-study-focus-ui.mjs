// Disposable vaults only. Build first with `npx vite build`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-focus-ui-'));
const shots = path.join(root, 'docs/verification/study-focus');
const focusDb = path.join(userData, 'focus', 'focus.sqlite');
await mkdir(shots, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// A silent, real media element checks playback without emitting test noise.
const pcm = Buffer.alloc(8000 * 2, 128), wavHeader = Buffer.alloc(44);
wavHeader.write('RIFF'); wavHeader.writeUInt32LE(36 + pcm.length, 4); wavHeader.write('WAVEfmt ', 8);
wavHeader.writeUInt32LE(16, 16); wavHeader.writeUInt16LE(1, 20); wavHeader.writeUInt16LE(1, 22);
wavHeader.writeUInt32LE(8000, 24); wavHeader.writeUInt32LE(8000, 28); wavHeader.writeUInt16LE(1, 32); wavHeader.writeUInt16LE(8, 34);
wavHeader.write('data', 36); wavHeader.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([wavHeader, pcm]).toString('base64');
const audioServer = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><title>Audio de estudio</title><h1>Audio de estudio</h1><audio controls loop src="data:audio/wav;base64,${wav}"></audio>`); });
await new Promise(resolve => audioServer.listen(0, '127.0.0.1', resolve));
const audioOrigin = `http://127.0.0.1:${audioServer.address().port}/`;
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.addLocatorHandler(page.getByText('Todos los tutoriales, en Ajustes', { exact: true }), async () => { await page.getByRole('button', { name: 'Cerrar', exact: true }).click(); });
  await page.addLocatorHandler(page.getByText('All the tutorials, in Settings', { exact: true }), async () => { await page.getByRole('button', { name: 'Close', exact: true }).click(); });
  // By class, not by label: part of the run is in English.
  await page.addLocatorHandler(page.getByTestId('backup-health-banner'), async () => { await page.getByTestId('backup-health-banner').locator('.backup-health-dismiss').click(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  await page.setViewportSize({ width: 1440, height: 1180 });
};
try {
  await launch();
  const ids = await page.evaluate(async version => {
    const api = window.nodus;
    const { vault } = await api.createVault({ name: 'Mi espacio de estudio', type: 'estudio' });
    await api.switchVault(vault.id);
    await api.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, theme: 'light', uiLanguage: 'es', mascotStyleChosen: true, mascotEnabled: false });
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    const course = await api.createStudyCourse({ name: 'Humanidades · 2026–2027' });
    const subject = await api.createStudySubject({ courseId: course.id, name: 'Historia contemporánea' });
    const note = await api.createStudyDocument({ title: 'El siglo XIX: cambios y continuidades', contentMarkdown: '# El siglo XIX: cambios y continuidades\n\n## Una sociedad en transformación\n\nLa industrialización modificó la organización del trabajo y la vida cotidiana. Las ciudades crecieron y surgieron nuevas formas de participación política.\n\n## Preguntas para la próxima lectura\n\n- ¿Qué cambió en las relaciones entre el campo y la ciudad?\n- ¿Cómo se organizó el movimiento obrero?\n- ¿Qué continuidades persistieron?\n\n## Para recordar\n\nRelacionar los procesos económicos, sociales y políticos permite situar los acontecimientos en su contexto.\n', placement: { subjectId: subject.id } });
    return { vault, course, subject, note };
  }, require('../package.json').version);
  await page.reload();
  await page.locator('[data-tour="nav-studyFocus"]').click();
  const view = () => page.getByTestId('study-focus-view');
  await view().getByText('Tu primer bloque te espera').waitFor();
  await page.screenshot({ path: path.join(shots, '01-empty-light.png') });
  // Start using the UI, then navigate and minimize without losing the timer.
  await view().locator('select').first().selectOption(ids.subject.id);
  await view().getByLabel('Objetivo del bloque', { exact: true }).fill('Repasar el siglo XIX');
  assert.equal(await view().getByTestId('focus-mode-toggle').isChecked(), true, 'focus mode is ticked by default');
  await view().getByRole('button', { name: 'Iniciar bloque', exact: true }).click();
  // Starting a block enters the mode; leaving it pauses the block, lands on this page and asks.
  await page.getByTestId('focus-rail').waitFor();
  assert.equal(await page.getByTestId('resizable-sidebar').count(), 0);
  await page.getByTestId('focus-rail').getByTestId('focus-rail-nav-studyCalendar').click();
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('focus-exit-dialog').waitFor();
  assert.equal(await page.locator('main').getAttribute('data-nodi-view'), 'studyFocus');
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'paused');
  await page.getByTestId('focus-exit-keep').click();
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'paused');
  // Still ticked for the resume; unticking it is remembered and keeps the mode off.
  assert.equal(await view().getByTestId('focus-mode-toggle').isChecked(), true);
  await view().getByTestId('focus-mode-toggle').uncheck();
  await view().getByRole('button', { name: 'Reanudar', exact: true }).click();
  assert.equal(await page.getByTestId('focus-rail').count(), 0);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.enterOnStart, false);
  const running = await page.evaluate(() => window.nodus.getStudyFocus());
  // Outside the mode the counter sits in the left half of the header, never in the right rail.
  const counter = page.getByTestId('focus-header');
  await counter.waitFor();
  assert.equal(await page.getByTestId('header-actions').getByTestId('focus-header').count(), 0);
  const counterPlace = await counter.evaluate(el => { const h = el.closest('header').getBoundingClientRect(); const r = el.getBoundingClientRect(); return (r.left + r.width / 2 - h.left) / h.width; });
  assert.ok(counterPlace > 0.08 && counterPlace < 0.45, `counter centred in the left half (${counterPlace})`);
  assert.equal(running.state.status, 'running'); assert.equal(running.state.subjectId, ids.subject.id);
  assert.equal(running.state.task, 'Repasar el siglo XIX');
  await view().getByTestId('focus-current-block').getByText('Repasar el siglo XIX').waitFor();
  await page.locator('[data-tour="nav-studyCalendar"]').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).minimize());
  await page.waitForTimeout(1200);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')); win.restore(); win.show(); });
  const afterNav = await page.evaluate(() => window.nodus.getStudyFocus());
  assert.equal(afterNav.state.sessionId, running.state.sessionId); assert.ok(afterNav.state.elapsedMs > running.state.elapsedMs);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  const suspended = await page.evaluate(() => window.nodus.getStudyFocus());
  assert.equal(suspended.state.status, 'paused');
  await page.waitForTimeout(500);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.elapsedMs, suspended.state.elapsedMs);
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
  // One session continues through two vaults of the same type.
  const other = await page.evaluate(async () => {
    const { vault } = await window.nodus.createVault({ name: 'Otra bóveda', type: 'estudio' });
    await window.nodus.switchVault(vault.id); return vault;
  });
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocusStats())).recent.length, 1);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.sessionId, running.state.sessionId);
  await page.evaluate(id => window.nodus.switchVault(id), ids.vault.id);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'running');
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'finish', s.state.revision); });
  // Deterministic illustrative data, isolated from the user's vaults.
  await app.close();
  const seedExample = (_electron, { dbPath, modulePath, subjectId, vaultId }) => {
    const Database = require(modulePath); const db = new Database(dbPath);
    db.prepare('DELETE FROM study_focus_intervals').run(); db.prepare('DELETE FROM study_focus_sessions').run();
    const today = new Date();
    const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const insert = (id, date, minutes, status) => {
      db.prepare('INSERT INTO study_focus_sessions(id, started_at, ended_at, milliseconds, status, subject_id, subject_name, completed_day, origin_vault_id, completed_vault_id, subject_vault_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, +date, +date + minutes*60000, minutes*60000, status, subjectId, 'Historia contemporánea', status === 'completed' ? dayKey(date) : null, vaultId, status === 'completed' ? vaultId : null, vaultId);
      db.prepare('INSERT INTO study_focus_intervals(session_id, started_at, milliseconds, day, vault_id) VALUES (?, ?, ?, ?, ?)').run(id, +date, minutes*60000, dayKey(date), vaultId);
    };
    db.transaction(() => {
      for (let i = 83; i >= 1; i--) {
        if (i % 5 === 0 || i % 7 === 3) continue;
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate()-i, 10, 15);
        insert(`example-${i}`, date, [20, 25, 45, 60, 75][i % 5], i % 4 === 0 ? 'ended' : 'completed');
      }
      insert('example-today-a', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 10), 25, 'completed');
      insert('example-today-b', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 5), 20, 'ended');
      const state = JSON.parse(db.prepare('SELECT state_json FROM study_focus_state WHERE id = 1').get().state_json);
      state.cycleBlocks = db.prepare("SELECT COUNT(*) AS n FROM study_focus_sessions WHERE status = 'completed'").get().n;
      db.prepare('UPDATE study_focus_state SET state_json = ? WHERE id = 1').run(JSON.stringify(state));
    })(); db.close();
  };
  execFileSync(require('electron'), ['-e', `(${seedExample.toString()})(null, ${JSON.stringify({ dbPath: focusDb, vaultId: ids.vault.id, modulePath: require.resolve('better-sqlite3'), subjectId: ids.subject.id })})`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await launch();
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.configureStudyFocus(s.vaultId, { dailyGoalMinutes: 60 }); });
  await page.reload();
  await page.locator('[data-tour="nav-studyFocus"]').click();
  await view().getByText('Has dedicado 45 minutos hoy.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(shots, '02-dashboard-light.png') });
  await view().evaluate(el => el.scrollTop = el.scrollHeight);
  await page.screenshot({ path: path.join(shots, '03-history-light.png') });
  await view().evaluate(el => el.scrollTop = 0);
  await view().getByRole('button', { name: '30 días', exact: true }).click();
  const bars = view().getByRole('group', { name: 'Gráfico de minutos por día' }).getByRole('button');
  await bars.first().focus(); await page.keyboard.press('ArrowRight'); assert.equal(await bars.nth(1).evaluate(el => el === document.activeElement), true);
  // Header keyboard dismissal and settings, independent from reduced UI.
  // No session open: no counter anywhere in the header, only the focus icon on the right.
  assert.equal(await page.getByTestId('focus-header').count(), 0);
  const focusIcon = page.getByTestId('focus-quick-access').getByRole('button', { name: 'Modo concentración', exact: true });
  await focusIcon.click();
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByText('Configurar temporizador').click();
  await page.screenshot({ path: path.join(shots, '04-header-panel.png') });
  await page.keyboard.press('Escape'); assert.equal(await focusIcon.evaluate(el => el === document.activeElement), true);
  await page.evaluate(require('axe-core').source);
  const lightA11y = await page.evaluate(async () => (await window.axe.run('[data-testid="study-focus-view"]')).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
  assert.deepEqual(lightA11y.filter(v => ['critical', 'serious'].includes(v.impact)), []);
  // Focus mode: the rail replaces the sidebar and keeps every study tool one click away.
  await view().locator('select').first().selectOption(ids.subject.id);
  await view().getByRole('button', { name: 'Iniciar bloque', exact: true }).click();
  await view().getByLabel('Modo concentración', { exact: false }).check();
  await page.waitForFunction(() => document.querySelector('[data-focus-reduced="true"]'));
  assert.equal(await page.getByTestId('resizable-sidebar').count(), 0);
  const rail = page.getByTestId('focus-rail');
  await rail.getByTestId('focus-rail-subject').getByText('Historia contemporánea').waitFor();
  const railSections = () => rail.locator('[data-testid^="focus-rail-nav-"]').evaluateAll(els => els.map(el => el.dataset.testid.replace('focus-rail-nav-', '')));
  assert.deepEqual((await railSections()).sort(), ['browser', 'studyCalendar', 'studyChat', 'studyCourses', 'studyDeepResearch', 'studyLibrary', 'studyQuestions', 'studySearch']);
  // Every other section, and each block and header item, is the student's choice.
  await rail.getByTestId('focus-rail-settings').click();
  const layoutDialog = page.getByTestId('focus-layout-dialog');
  await layoutDialog.waitFor();
  await layoutDialog.getByTestId('focus-layout-nav:notes').check();
  await layoutDialog.getByTestId('focus-layout-nav:studyReview').check();
  await layoutDialog.getByTestId('focus-layout-block:timer').uncheck();
  await layoutDialog.getByTestId('focus-layout-header:theme').uncheck();
  await page.screenshot({ path: path.join(shots, '11-focus-layout-dialog.png') });
  await layoutDialog.getByTestId('focus-layout-done').click();
  await rail.getByTestId('focus-rail-nav-notes').waitFor();
  assert.equal(await rail.getByTestId('focus-rail-nav-studyReview').count(), 1);
  assert.equal(await rail.getByTestId('focus-rail-timer').count(), 0);
  assert.equal(await page.locator('[data-tour="theme-toggle"]').isVisible(), false, 'the theme toggle follows the choice');
  const storedLayout = (await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout;
  assert.deepEqual(storedLayout, { 'nav:notes': true, 'nav:studyReview': true, 'block:timer': false, 'header:theme': false });
  // The header quick access opens the same settings; restoring brings the timer back.
  // The header's focus button opens the timer panel (no separate arrow); its settings live inside.
  const quickAccess = page.getByTestId('focus-quick-access');
  assert.equal(await quickAccess.getByRole('button').count(), 1);
  assert.equal(await quickAccess.getByRole('button', { name: 'Modo concentración', exact: true }).getAttribute('aria-pressed'), 'true');
  await quickAccess.getByRole('button', { name: 'Modo concentración', exact: true }).click();
  const timerPanel = page.getByRole('dialog', { name: 'Temporizador de concentración' });
  await timerPanel.waitFor();
  await page.screenshot({ path: path.join(shots, '13-header-focus-panel.png') });
  await quickAccess.getByRole('button', { name: 'Modo concentración', exact: true }).click();
  await timerPanel.waitFor({ state: 'detached' });
  await quickAccess.getByRole('button', { name: 'Modo concentración', exact: true }).click();
  await timerPanel.getByTestId('focus-timer-settings').click();
  assert.equal(await timerPanel.count(), 0);
  await layoutDialog.getByTestId('focus-layout-block:timer').check();
  await layoutDialog.getByTestId('focus-layout-header:theme').check();
  await layoutDialog.getByTestId('focus-layout-done').click();
  await rail.getByTestId('focus-rail-timer').waitFor();
  // The palette still opens the timer and leaves the mode.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByPlaceholder('Ir a una sección o ejecutar una acción…').fill('Temporizador de concentración');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).waitFor();
  await page.keyboard.press('Escape');
  await rail.getByTestId(`focus-rail-document-${ids.note.id}`).click();
  await page.getByRole('button', { name: 'Ocultar paneles', exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, '05-editor-focus.png') });
  // A new note is filed under the block's subject and opened in the editor.
  await rail.getByTestId('focus-rail-new-note').click();
  await page.waitForFunction(async subjectId => {
    const workspace = await window.nodus.getStudyWorkspace();
    return workspace.documents.some(document => document.title.startsWith('Apuntes · ') && workspace.placements.some(placement => placement.documentId === document.id && placement.subjectId === subjectId));
  }, ids.subject.id);
  await rail.getByText(/^Apuntes · /).first().waitFor();
  await rail.getByTestId('focus-rail-nav-studyQuestions').click();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-nodi-view') === 'studyQuestions');
  await rail.getByTestId('focus-rail-nav-notes').click();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-nodi-view') === 'notes');
  await page.screenshot({ path: path.join(shots, '08-focus-rail-notes.png') });
  await rail.getByTestId('focus-rail-nav-studyCourses').click();
  await page.getByRole('button', { name: 'El siglo XIX: cambios y continuidades', exact: false }).first().click();
  await page.getByRole('button', { name: 'Ocultar paneles', exact: true }).waitFor();
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('focus-exit-dialog').waitFor();
  await page.screenshot({ path: path.join(shots, '12-focus-exit-question.png') });
  await page.getByTestId('focus-exit-keep').click();
  await page.getByTestId('resizable-sidebar').waitFor();
  assert.equal(await page.locator('main').getAttribute('data-nodi-view'), 'studyFocus');
  await view().getByRole('button', { name: 'Reanudar', exact: true }).click();
  await page.getByTestId('focus-rail').waitFor();
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('focus-exit-keep').click();
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
  await page.getByTestId('resizable-sidebar').waitFor();
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'running');
  // The native Browser remains playing, and both header popovers stay usable.
  await page.locator('[data-tour="nav-browser"]').click();
  const audioTab = await page.evaluate(url => window.nodus.openBrowserTab(url), audioOrigin);
  await page.waitForFunction(async url => (await window.nodus.getBrowserState()).tabs.some(tab => tab.url === url && !tab.loading), audioOrigin);
  await app.evaluate(async ({ webContents }, url) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const browser = webContents.getAllWebContents().find(wc => wc.getURL() === url);
      if (browser && !browser.isLoading()) { await browser.executeJavaScript('document.querySelector("audio").play()', true); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Audio fixture did not load');
  }, audioOrigin);
  await page.waitForFunction(async () => (await window.nodus.getBrowserMedia()).some(media => media.playing));
  // From the header's focus panel, with the block running, the box turns the mode on.
  await page.getByTestId('focus-quick-access').getByRole('button', { name: 'Modo concentración', exact: true }).click();
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByTestId('focus-mode-toggle').check();
  await page.keyboard.press('Escape');
  await page.getByTestId('focus-rail').waitFor();
  // The browser stays reachable from the rail, and its media controls stay in the header.
  await page.getByTestId('focus-rail').getByTestId('focus-rail-nav-browser').click();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-nodi-view') === 'browser');
  await page.getByTestId('browser-media-header-action').waitFor({ state: 'visible' });
  assert.ok((await page.evaluate(() => window.nodus.getBrowserMedia())).some(media => media.playing));
  await page.getByTestId('browser-media-header-action').getByRole('button', { name: 'Medios', exact: true }).click();
  await page.getByTestId('browser-media-popover').waitFor();
  await page.screenshot({ path: path.join(shots, '09-focus-browser-media.png') });
  await page.keyboard.press('Escape');
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('focus-exit-dialog').waitFor();
  await page.getByTestId('focus-exit-keep').click();
  await page.getByTestId('resizable-sidebar').waitFor();
  assert.ok((await page.evaluate(() => window.nodus.getBrowserMedia())).some(media => media.playing));
  await page.evaluate(id => window.nodus.closeBrowserTab(id), audioTab);
  // Another interface language: the focus surfaces follow it.
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en' }));
  await page.reload(); await page.locator('[data-tour="nav-studyFocus"]').click();
  await view().getByRole('heading', { name: 'Nodus Focus', exact: true }).waitFor();
  await view().getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByTestId('focus-rail').waitFor();
  const englishRail = await page.getByTestId('focus-rail').innerText();
  assert.match(englishRail, /Exit focus mode/); assert.match(englishRail, /Question bank/);
  assert.doesNotMatch(englishRail, /Salir|Concentración|Estudiar|De esta asignatura/);
  await page.getByTestId('focus-exit').click();
  await page.getByRole('alertdialog', { name: 'Do you want to end the session?' }).waitFor();
  await page.getByTestId('focus-exit-keep').click();
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es' }));
  // Finishing the session from inside the mode goes back to the normal view, and the
  // counter goes with the session.
  const headerFocusIcon = page.getByTestId('focus-quick-access').getByRole('button', { name: 'Modo concentración', exact: true });
  await headerFocusIcon.click();
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByTestId('focus-mode-toggle').check();
  await page.getByTestId('focus-rail').waitFor();
  assert.equal(await page.getByTestId('focus-header').count(), 0, 'inside the mode the clock is in the rail, not the header');
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByRole('button', { name: 'Finalizar sesión', exact: true }).click();
  await page.getByTestId('resizable-sidebar').waitFor();
  assert.equal(await page.getByTestId('focus-rail').count(), 0);
  assert.equal(await page.getByTestId('focus-header').count(), 0, 'no counter once the session is finished');
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'ready');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'start', s.state.revision); });
  // Dark and narrow windows.
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.reload(); await page.locator('[data-tour="nav-studyFocus"]').click();
  await view().getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.screenshot({ path: path.join(shots, '06-dashboard-dark.png') });
  await page.setViewportSize({ width: 780, height: 980 });
  await page.screenshot({ path: path.join(shots, '07-narrow-dark.png') });
  await view().getByRole('button', { name: 'Reanudar', exact: true }).click();
  assert.ok((await page.getByTestId('focus-rail').evaluate(el => el.getBoundingClientRect().width)) < 70, 'a narrow window folds the rail to icons');
  await page.screenshot({ path: path.join(shots, '10-narrow-rail-dark.png') });
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('focus-exit-keep').click();
  assert.equal(await view().evaluate(el => el.scrollWidth > el.clientWidth), false);
  // Axe checks the new feature's semantic surface, including chart alternatives.
  await page.evaluate(require('axe-core').source);
  const accessibility = await page.evaluate(async () => (await window.axe.run('[data-testid="study-focus-view"]')).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
  await writeFile(path.join(shots, 'accessibility.json'), JSON.stringify({ light: lightA11y, dark: accessibility }, null, 2));
  assert.deepEqual(accessibility.filter(v => ['critical', 'serious'].includes(v.impact)), []);
  // Transverse Focus: one UI-started block traverses every supported vault type.
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  await view().getByRole('button', { name: 'Reanudar', exact: true }).click();
  await page.getByTestId('focus-rail').waitFor();
  const continuous = await page.evaluate(() => window.nodus.getStudyFocus());
  const matrix = [{ type: 'estudio', id: ids.vault.id }];
  for (const type of ['academic', 'primary_sources', 'genealogy', 'prosopography', 'databases', 'testimonios', 'worldbuilding', 'docencia']) {
    const vault = await page.evaluate(async type => (await window.nodus.createVault({ name: `Focus · ${type}`, type })).vault, type);
    matrix.push({ type, id: vault.id });
  }
  let previousElapsed = continuous.state.elapsedMs;
  const observations = [];
  const relevant = {
    estudio: ['studyCourses', 'studyLibrary', 'studyQuestions'], academic: ['library', 'workspace', 'researchChat'],
    primary_sources: ['archive', 'timeline', 'relations'], genealogy: ['persons', 'tree', 'archive'],
    prosopography: ['prosopPopulation', 'prosopSources', 'prosopAnalysis'], databases: ['pages', 'dbSearch', 'dbAnalysis'],
    testimonios: ['testimonyInterviews', 'testimonyParticipants', 'testimonyContrasts'],
    worldbuilding: ['encyclopedia', 'characters', 'manuscript'], docencia: ['studyCourses', 'teachingExams', 'teachingUnits'],
  };
  const customLayout = { 'nav:browser': false, 'header:theme': false, 'nav:toolkit': true };
  const savedLayouts = new Map();
  for (const vault of matrix) {
    const result = await page.evaluate(id => window.nodus.switchVault(id), vault.id);
    assert.equal(result.ok, true);
    await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, primarySourcesTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true, testimonyTourComplete: true, docenciaTourComplete: true }));
    await page.waitForFunction(type => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-vault-type') === type, vault.type);
    await page.getByTestId('focus-rail').waitFor();
    if (vault.type !== 'estudio') assert.deepEqual((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout, {}, 'a fresh vault does not inherit the previous vault\'s layout');
    const normalSettings = await page.evaluate(async () => { const settings = await window.nodus.getSettings(); return [settings.sidebarOrder, settings.sidebarHidden, settings.sidebarCustomized, settings.toolkitPinnedPages]; });
    await page.getByTestId('focus-rail-settings').click();
    const options = page.getByTestId('focus-layout-dialog');
    await options.getByRole('button', { name: 'Restablecer', exact: true }).click();
    await page.waitForFunction(async () => Object.keys((await window.nodus.getStudyFocus()).state.preferences.layout).length === 0);
    if (vault.type === 'academic') {
      await options.getByRole('button', { name: 'Mostrar todo', exact: true }).click();
      await page.getByTestId('focus-rail-nav-radar').waitFor();
      await options.getByRole('button', { name: 'Restablecer', exact: true }).click();
      await page.getByTestId('focus-rail-nav-radar').waitFor({ state: 'detached' });
    }
    assert.equal(await options.getByTestId('focus-layout-block:shelf').count(), ['estudio', 'docencia'].includes(vault.type) ? 1 : 0);
    if (vault.type === 'worldbuilding') assert.equal(await options.getByTestId('focus-layout-nav:tree').locator('..').innerText(), 'Familias');
    for (const key of relevant[vault.type]) assert.equal(await options.getByTestId(`focus-layout-nav:${key}`).isChecked(), true, `${vault.type}: ${key} enabled by default`);
    for (const key of ['radar', 'compass', 'toolkit']) assert.equal(await options.getByTestId(`focus-layout-nav:${key}`).isChecked(), false, `${vault.type}: optional tools remain configurable`);
    await options.getByTestId('focus-layout-done').click();
    const current = await page.evaluate(() => window.nodus.getStudyFocus());
    assert.equal(current.state.status, 'running'); assert.equal(current.state.sessionId, continuous.state.sessionId);
    assert.equal(current.state.phase, continuous.state.phase); assert.equal(current.state.durationMs, continuous.state.durationMs);
    assert.equal(current.state.task, continuous.state.task); assert.equal(current.state.subjectId, continuous.state.subjectId);
    assert.equal(current.state.subjectVaultId, continuous.state.subjectVaultId); assert.equal(current.state.cycleBlocks, continuous.state.cycleBlocks);
    assert.equal(current.state.preferences.dailyGoalMinutes, continuous.state.preferences.dailyGoalMinutes);
    assert.ok(current.state.elapsedMs >= previousElapsed); previousElapsed = current.state.elapsedMs;
    assert.equal(await page.getByTestId('resizable-sidebar').count(), 0);
    if (!['estudio', 'docencia'].includes(vault.type)) assert.equal(await page.getByTestId('focus-rail-subject').count(), 0);
    if (vault.type === 'docencia') assert.equal(await page.getByTestId('focus-rail-nav-studyCourses').innerText(), 'Cursos, asignaturas y grupos');
    if (vault.type === 'databases') {
      await page.getByTestId('focus-rail-nav-database:new').click();
      await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-nodi-view') === 'databases');
      const databases = await page.evaluate(() => window.nodus.listDatabases());
      assert.equal(databases.length, 1, 'a database can be created without leaving Focus');
      await page.getByTestId(`focus-rail-nav-database:${databases[0].id}`).waitFor();
    }
    await page.getByTestId('focus-quick-access').getByRole('button').click();
    const popover = page.getByRole('dialog', { name: 'Temporizador de concentración' });
    await popover.waitFor();
    await popover.getByRole('button', { name: 'Ver progreso de concentración', exact: false }).click();
    await view().getByRole('heading', { name: 'Nodus Focus', exact: true }).waitFor();
    await page.screenshot({ path: path.join(shots, `transverse-${vault.type}-light.png`) });
    // Every section kept in Focus must be a valid destination of this vault.
    const keys = await page.getByTestId('focus-rail').locator('[data-testid^="focus-rail-nav-"]').evaluateAll(els => els.map(el => el.dataset.testid.replace('focus-rail-nav-', '')));
    for (const key of relevant[vault.type]) assert.ok(keys.includes(key));
    for (const key of ['home', 'settings', 'radar', 'compass', 'toolkit', 'toolkit:drift']) assert.ok(!keys.includes(key), `${vault.type}: defaults concentrate on this workspace`);
    await page.getByTestId('focus-rail-settings').click();
    const hiddenSection = relevant[vault.type][0];
    const savedLayout = { [`nav:${hiddenSection}`]: false, ...customLayout };
    await options.getByTestId(`focus-layout-nav:${hiddenSection}`).uncheck();
    await options.getByTestId('focus-layout-nav:browser').uncheck();
    await options.getByTestId('focus-layout-header:theme').uncheck();
    await options.getByTestId('focus-layout-nav:toolkit').check();
    await page.waitForFunction(async expected => {
      const layout = (await window.nodus.getStudyFocus()).state.preferences.layout;
      return Object.keys(layout).length === Object.keys(expected).length && Object.entries(expected).every(([id, value]) => layout[id] === value);
    }, savedLayout);
    if (vault.type === 'academic') await page.screenshot({ path: path.join(shots, 'transverse-layout-academic.png') });
    await options.getByTestId('focus-layout-done').click();
    await page.getByTestId('focus-rail-nav-toolkit').waitFor();
    assert.equal(await page.getByTestId('focus-rail-nav-browser').count(), 0);
    assert.equal(await page.locator('[data-tour="theme-toggle"]').isVisible(), false);
    assert.deepEqual(await page.evaluate(async () => { const settings = await window.nodus.getSettings(); return [settings.sidebarOrder, settings.sidebarHidden, settings.sidebarCustomized, settings.toolkitPinnedPages]; }), normalSettings, 'Focus customisation leaves normal navigation unchanged');
    savedLayouts.set(vault.id, savedLayout);
    observations.push({ vaultType: vault.type, vaultId: vault.id, sessionId: current.state.sessionId, elapsedMs: current.state.elapsedMs, sections: keys, savedLayout });
  }
  // Round-trip every saved layout; reopening the dialog must reflect the current vault.
  for (const vault of [...matrix].reverse()) {
    await page.evaluate(id => window.nodus.switchVault(id), vault.id);
    await page.getByTestId('focus-rail-nav-toolkit').waitFor();
    assert.deepEqual((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout, savedLayouts.get(vault.id));
    assert.equal(await page.getByTestId('focus-rail-nav-browser').count(), 0);
    await page.getByTestId('focus-rail-settings').click();
    const options = page.getByTestId('focus-layout-dialog');
    assert.equal(await options.getByTestId('focus-layout-nav:browser').isChecked(), false);
    assert.equal(await options.getByTestId('focus-layout-header:theme').isChecked(), false);
    assert.equal(await options.getByTestId('focus-layout-nav:toolkit').isChecked(), true);
    assert.equal(await options.getByTestId(`focus-layout-nav:${relevant[vault.type][0]}`).isChecked(), false);
    await options.getByTestId('focus-layout-done').click();
  }
  // An open customisation dialog adapts to a different vault's sections and saved choices.
  await page.getByTestId('focus-rail-settings').click();
  await page.evaluate(id => window.nodus.switchVault(id), matrix.find(vault => vault.type === 'databases').id);
  await page.getByTestId('focus-layout-nav:dbSearch').waitFor();
  assert.equal(await page.getByTestId('focus-layout-nav:studyCourses').count(), 0);
  assert.equal(await page.getByTestId('focus-layout-nav:pages').isChecked(), false);
  await page.getByTestId('focus-layout-done').click();
  // The timer popover stays open while its vault context changes.
  await page.getByTestId('focus-quick-access').getByRole('button').click();
  await page.evaluate(id => window.nodus.switchVault(id), ids.vault.id);
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).waitFor();
  await page.keyboard.press('Escape');
  const rejected = await page.evaluate(() => window.nodus.switchVault('missing-focus-vault'));
  assert.equal(rejected.ok, false);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.sessionId, continuous.state.sessionId);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'running');
  await page.getByTestId('focus-rail').waitFor();
  const transverseStats = await page.evaluate(() => window.nodus.getStudyFocusStats());
  const partial = transverseStats.recent.find(session => session.id === continuous.state.sessionId);
  assert.equal(partial.vaults.length, 9);
  assert.ok(Math.abs(partial.vaults.reduce((sum, vault) => sum + vault.milliseconds, 0) - partial.milliseconds) < 0.01);
  // Personalisation belongs to the vault ID, even when two vaults have the same type.
  await page.evaluate(async id => {
    await window.nodus.switchVault(id);
    await window.nodus.updateSettings({ onboardingComplete: true, studyTourComplete: true, tourComplete: true, advancedTourComplete: true });
  }, other.id);
  await page.getByTestId('focus-rail-nav-browser').waitFor();
  assert.deepEqual((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout, {});
  await page.getByTestId('focus-rail-settings').click();
  await page.getByTestId('focus-layout-block:timer').uncheck();
  await page.getByTestId('focus-layout-done').click();
  assert.equal(await page.getByTestId('focus-rail-timer').count(), 0);
  await page.evaluate(id => window.nodus.switchVault(id), ids.vault.id);
  await page.getByTestId('focus-rail-nav-toolkit').waitFor();
  assert.deepEqual((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout, savedLayouts.get(ids.vault.id));
  await page.getByTestId('focus-rail-timer').waitFor();
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'running');
  await writeFile(path.join(shots, 'transverse.json'), JSON.stringify(observations, null, 2));
  // The searchable catalog opens Focus and pinning never creates a duplicate entry.
  await page.getByTestId('focus-exit').click(); await page.getByTestId('focus-exit-keep').click();
  await page.locator('[data-tour="nav-toolkit"]').click();
  await page.getByTestId('toolkit-search').fill('focus');
  await page.getByTestId('toolkit-card-focus').waitFor();
  assert.equal(await page.getByTestId('toolkit-card-focus-pin').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(shots, 'transverse-catalog.png') });
  await page.getByTestId('toolkit-card-focus-pin').click();
  await page.locator('[data-tour="nav-studyFocus"]').waitFor({ state: 'detached' });
  await page.getByTestId('toolkit-card-focus').click();
  await view().waitFor();
  await page.locator('[data-tour="nav-toolkit"]').click();
  await page.getByTestId('toolkit-search').fill('focus');
  await page.getByTestId('toolkit-card-focus-pin').click();
  assert.equal(await page.locator('[data-tour="nav-studyFocus"]').count(), 1);
  await page.getByTestId('toolkit-card-focus').click();
  await view().getByTestId('focus-mode-toggle').uncheck();
  await page.evaluate(id => window.nodus.switchVault(id), matrix.find(vault => vault.type === 'academic').id);
  await view().getByRole('button', { name: 'Reanudar', exact: true }).click();
  assert.equal(await page.getByTestId('focus-rail').count(), 0, 'manual opt-out follows the user across vaults');
  await page.evaluate(async id => { const state = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(state.vaultId, 'pause', state.state.revision); await window.nodus.switchVault(id); }, ids.vault.id);
  await view().getByTestId('focus-mode-toggle').check();
  if (process.platform === 'darwin') {
    await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).close());
    await closed;
    const readState = `const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});const db=new Database(${JSON.stringify(focusDb)});console.log(db.prepare('SELECT state_json FROM study_focus_state WHERE id=1').get().state_json);db.close();`;
    const stored = JSON.parse(execFileSync(require('electron'), ['-e', readState], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }));
    assert.equal(stored.status, 'paused');
    await app.close().catch(() => {});
    await launch();
    assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'paused');
    assert.deepEqual((await page.evaluate(() => window.nodus.getStudyFocus())).state.preferences.layout, savedLayouts.get(ids.vault.id), 'vault layout survives closing and reopening the app');
  }
  // Crash after a real checkpoint; recovery never counts the intervening absence.
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
  await page.waitForTimeout(16000);
  const checkpoint = await page.evaluate(() => window.nodus.getStudyFocus());
  const stopped = new Promise(resolve => app.process().once('exit', resolve)); app.process().kill('SIGKILL'); await stopped;
  await launch();
  const recovered = await page.evaluate(() => window.nodus.getStudyFocus());
  assert.equal(recovered.state.status, 'paused'); assert.equal(recovered.state.recovered, true);
  assert.ok(recovered.state.elapsedMs <= checkpoint.state.elapsedMs); assert.ok(checkpoint.state.elapsedMs - recovered.state.elapsedMs < 15000);
  assert.deepEqual(errors, []);
  console.log('Focus UI verified: navigation, minimize, suspend, vault switch, controls, keyboard, themes, narrow layout and crash recovery.');
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'No page'));
  await page?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close().catch(() => {});
  audioServer.close();
  await rm(userData, { recursive: true, force: true });
}
