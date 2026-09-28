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
  await view().getByRole('button', { name: 'Iniciar bloque', exact: true }).click();
  const running = await page.evaluate(() => window.nodus.getStudyFocus());
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
  // Check cross-vault pause and isolation through the real IPC lifecycle.
  const other = await page.evaluate(async () => {
    const { vault } = await window.nodus.createVault({ name: 'Otra bóveda', type: 'estudio' });
    await window.nodus.switchVault(vault.id); return vault;
  });
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocusStats())).recent.length, 0);
  await page.evaluate(id => window.nodus.switchVault(id), ids.vault.id);
  assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'paused');
  await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'finish', s.state.revision); });
  // Deterministic illustrative data, isolated from the user's vaults.
  const seedExample = (_electron, { dbPath, modulePath, subjectId }) => {
    const Database = require(modulePath); const db = new Database(dbPath);
    db.prepare('DELETE FROM study_focus_intervals').run(); db.prepare('DELETE FROM study_focus_sessions').run();
    const today = new Date();
    const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const insert = (id, date, minutes, status) => {
      db.prepare('INSERT INTO study_focus_sessions(id, started_at, ended_at, milliseconds, status, subject_id, subject_name, completed_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, +date, +date + minutes*60000, minutes*60000, status, subjectId, 'Historia contemporánea', status === 'completed' ? dayKey(date) : null);
      db.prepare('INSERT INTO study_focus_intervals(session_id, started_at, milliseconds, day) VALUES (?, ?, ?, ?)').run(id, +date, minutes*60000, dayKey(date));
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
  execFileSync(require('electron'), ['-e', `(${seedExample.toString()})(null, ${JSON.stringify({ dbPath: ids.vault.path, modulePath: require.resolve('better-sqlite3'), subjectId: ids.subject.id })})`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await page.evaluate(async ({ otherId, originalId }) => { await window.nodus.switchVault(otherId); await window.nodus.switchVault(originalId); }, { otherId: other.id, originalId: ids.vault.id });
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
  await page.getByTestId('focus-header').click();
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByText('Configurar temporizador').click();
  await page.screenshot({ path: path.join(shots, '04-header-panel.png') });
  await page.keyboard.press('Escape'); assert.equal(await page.getByTestId('focus-header').evaluate(el => el === document.activeElement), true);
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
  for (const section of ['studyCourses', 'studyLibrary', 'studyQuestions', 'studyReview', 'studyChat', 'library', 'notes', 'browser', 'studyFocus']) {
    assert.equal(await rail.getByTestId(`focus-rail-nav-${section}`).count(), 1, `focus rail reaches ${section}`);
  }
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
  await page.getByRole('button', { name: 'Ocultar paneles', exact: true }).click();
  await page.getByTestId('focus-exit').click();
  assert.equal(await page.getByRole('button', { name: 'Ocultar paneles', exact: true }).getAttribute('aria-pressed'), 'true');
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
  await page.getByTestId('focus-header').click();
  await page.getByRole('dialog', { name: 'Temporizador de concentración' }).getByLabel('Modo concentración', { exact: false }).check();
  await page.keyboard.press('Escape');
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
  await page.getByTestId('resizable-sidebar').waitFor();
  assert.ok((await page.evaluate(() => window.nodus.getBrowserMedia())).some(media => media.playing));
  await page.evaluate(id => window.nodus.closeBrowserTab(id), audioTab);
  // Another interface language: the focus surfaces follow it.
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en' }));
  await page.reload(); await page.locator('[data-tour="nav-studyFocus"]').click();
  await view().getByRole('heading', { name: 'Focus', exact: true }).waitFor();
  await view().getByLabel('Focus mode', { exact: false }).check();
  const englishRail = await page.getByTestId('focus-rail').innerText();
  assert.match(englishRail, /Exit focus mode/); assert.match(englishRail, /Question bank/);
  assert.doesNotMatch(englishRail, /Salir|Concentración|Estudiar|De esta asignatura/);
  await page.getByTestId('focus-exit').click();
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es' }));
  // Dark and narrow windows.
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.reload(); await page.locator('[data-tour="nav-studyFocus"]').click();
  await view().getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.screenshot({ path: path.join(shots, '06-dashboard-dark.png') });
  await page.setViewportSize({ width: 780, height: 980 });
  await page.screenshot({ path: path.join(shots, '07-narrow-dark.png') });
  await view().getByLabel('Modo concentración', { exact: false }).check();
  assert.ok((await page.getByTestId('focus-rail').evaluate(el => el.getBoundingClientRect().width)) < 70, 'a narrow window folds the rail to icons');
  await page.screenshot({ path: path.join(shots, '10-narrow-rail-dark.png') });
  await page.getByTestId('focus-exit').click();
  assert.equal(await view().evaluate(el => el.scrollWidth > el.clientWidth), false);
  // Axe checks the new feature's semantic surface, including chart alternatives.
  await page.evaluate(require('axe-core').source);
  const accessibility = await page.evaluate(async () => (await window.axe.run('[data-testid="study-focus-view"]')).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
  await writeFile(path.join(shots, 'accessibility.json'), JSON.stringify({ light: lightA11y, dark: accessibility }, null, 2));
  assert.deepEqual(accessibility.filter(v => ['critical', 'serious'].includes(v.impact)), []);
  if (process.platform === 'darwin') {
    await page.evaluate(async () => { const s = await window.nodus.getStudyFocus(); await window.nodus.actStudyFocus(s.vaultId, 'resume', s.state.revision); });
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).close());
    await closed;
    const readState = `const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});const db=new Database(${JSON.stringify(ids.vault.path)});console.log(db.prepare('SELECT state_json FROM study_focus_state WHERE id=1').get().state_json);db.close();`;
    const stored = JSON.parse(execFileSync(require('electron'), ['-e', readState], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }));
    assert.equal(stored.status, 'paused');
    await app.close().catch(() => {});
    await launch();
    assert.equal((await page.evaluate(() => window.nodus.getStudyFocus())).state.status, 'paused');
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
