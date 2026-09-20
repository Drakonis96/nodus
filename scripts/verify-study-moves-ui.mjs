// Real Electron/IPC/SQLite verification in disposable estudio and docencia vaults.
// Run `npx vite build && node scripts/verify-study-moves-ui.mjs`.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-moves-ui-'));
const shots = path.join(root, '.tmp-shots', 'study-moves');
await mkdir(shots, { recursive: true });
const file = path.join(userData, 'Material.txt');
await writeFile(file, 'Contenido original del material.');
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.addLocatorHandler(page.getByText('Todos los tutoriales, en Ajustes', { exact: true }), async () => {
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  for (const type of ['estudio', 'docencia']) {
    const ids = await page.evaluate(async ({ type, file, version }) => {
      const api = window.nodus;
      const created = await api.createVault({ name: `Movimientos ${type}`, type });
      const switched = await api.switchVault(created.vault.id);
      if (!switched.ok) throw new Error(switched.message);
      await api.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, docenciaTourComplete: true, theme: type === 'estudio' ? 'light' : 'dark', uiLanguage: 'es', mascotStyleChosen: true, mascotEnabled: false });
      localStorage.setItem('nodus.lastSeenVersion', version);
      localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      localStorage.setItem('nodus-study-browser-layout', 'list');
      const a = await api.createStudyCourse({ name: 'Curso A' });
      const b = await api.createStudyCourse({ name: 'Curso B' });
      const sa = await api.createStudySubject({ name: 'Asignatura A', courseId: a.id });
      const sb = await api.createStudySubject({ name: 'Asignatura B', courseId: b.id });
      const folder = await api.createStudyFolder({ name: 'Carpeta A', subjectId: sa.id, courseId: a.id });
      const child = await api.createStudyFolder({ name: 'Carpeta hija', subjectId: sa.id, courseId: a.id, parentId: folder.id });
      const topic = await api.createStudyTopic({ name: 'Tema A', subjectId: sa.id, folderId: folder.id });
      const subtopic = await api.createStudyTopic({ name: 'Subtema A', subjectId: sa.id, parentId: topic.id });
      const note = await api.createStudyDocument({ title: 'Apunte de prueba', contentMarkdown: '**No perder**', placement: { subjectId: sb.id } });
      const origin = await api.addStudyPlacement(note.id, { folderId: folder.id });
      const [imported] = await api.importStudyMaterialPaths([file], { courseId: a.id, subjectId: sa.id, folderId: folder.id });
      return { a: a.id, b: b.id, sa: sa.id, sb: sb.id, folder: folder.id, child: child.id, topic: topic.id, subtopic: subtopic.id, note: note.id, origin: origin.id, material: imported.material.id };
    }, { type, file, version: require('../package.json').version });
    console.log(`[ui] ${type}: seeded`);
    await page.reload();
    await page.locator('[data-tour="nav-studyCourses"]').click();
    const open = async (kind, id) => page.getByTestId(`study-browser-${kind}-${id}`).getByRole('button').first().click();
    await open('course', ids.a);
    await open('subject', ids.sa);
    // Folder move excludes itself and descendants; cancellation is lossless.
    await page.getByTestId(`study-browser-folder-${ids.folder}`).getByRole('button', { name: 'Mover a otra ubicación' }).click();
    let dialog = page.getByTestId('study-entity-location-dialog');
    assert.equal(await dialog.locator(`option[value="${ids.child}"]`).count(), 0);
    assert.equal(await dialog.locator(`option[value="${ids.folder}"]`).count(), 0);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await open('folder', ids.folder);
    await page.getByTestId(`study-browser-folder-${ids.child}`).waitFor();
    // Current folder is chosen even when another placement was inserted first.
    const noteRow = () => page.getByTestId('study-documents-section').locator('tr, article').filter({ hasText: 'Apunte de prueba' });
    await page.getByTestId('study-browser-layout-grid').click();
    await noteRow().getByRole('button', { name: 'Mover a otra ubicación' }).click();
    await page.getByTestId('study-material-move-dialog').getByRole('button', { name: 'Cancelar' }).click();
    await page.getByTestId('study-browser-layout-list').click();
    await page.getByTestId(`study-organization-material-${ids.material}`).getByRole('button', { name: 'Mover a otra ubicación' }).click();
    await page.keyboard.press('Escape');
    await noteRow().getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-material-move-dialog');
    assert.equal(await dialog.getByLabel('Ubicación de origen').inputValue(), ids.origin);
    assert.equal(await dialog.getByLabel('Ubicación de origen').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name: 'Mover', exact: true }).evaluate((el) => el === document.activeElement), true);
    await dialog.getByLabel('Curso', { exact: true }).selectOption(ids.b);
    await dialog.getByLabel('Asignatura', { exact: true }).selectOption(ids.sb);
    await page.screenshot({ path: path.join(shots, `${type}-move-dialog.png`) });
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await noteRow().waitFor({ state: 'detached' });
    const state = await page.evaluate(() => window.nodus.getStudyWorkspace());
    assert.equal(state.placements.filter((p) => p.documentId === ids.note).length, 1);
    assert.equal(state.documents.find((d) => d.id === ids.note).contentMarkdown, '**No perder**');
    // Grid has the same action and imported materials can move to course root.
    await page.getByTestId('study-browser-layout-grid').click();
    await page.getByTestId(`study-organization-material-${ids.material}`).getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-material-move-dialog');
    await dialog.getByLabel('Curso', { exact: true }).selectOption(ids.b);
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByTestId(`study-organization-material-${ids.material}`).waitFor({ state: 'detached' });
    const material = await page.evaluate((id) => window.nodus.getStudyMaterial(id), ids.material);
    assert.equal(material.placements[0].courseId, ids.b);
    assert.equal(material.placements[0].subjectId, null);
    // Subtopics are navigable and can move independently.
    await open('topic', ids.topic);
    await page.getByTestId(`study-browser-topic-${ids.subtopic}`).getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-entity-location-dialog');
    await dialog.getByLabel('Curso', { exact: true }).selectOption(ids.b);
    await dialog.getByLabel('Asignatura', { exact: true }).selectOption(ids.sb);
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByTestId(`study-browser-topic-${ids.subtopic}`).waitFor({ state: 'detached' });
    // Materials view also exposes the document action, including unfiling.
    await page.locator('[data-tour="nav-studyLibrary"]').click();
    const libraryNote = page.getByTestId('study-material-notes-table').locator('tr').filter({ hasText: 'Apunte de prueba' });
    await libraryNote.getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-material-move-dialog');
    await dialog.getByLabel('Curso', { exact: true }).selectOption('');
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.nodus.getStudyWorkspace())).placements.filter((p) => p.documentId === ids.note).length, 0);
    await libraryNote.getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-material-move-dialog');
    await dialog.getByLabel('Curso', { exact: true }).selectOption(ids.a);
    await dialog.getByLabel('Asignatura', { exact: true }).selectOption(ids.sa);
    await dialog.getByLabel('Carpeta (opcional)').selectOption(ids.child);
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.nodus.getStudyWorkspace())).placements.find((p) => p.documentId === ids.note).folderId, ids.child);
    // A deleted destination reports an error without losing the current location.
    await libraryNote.getByRole('button', { name: 'Mover a otra ubicación' }).click();
    dialog = page.getByTestId('study-material-move-dialog');
    await dialog.getByLabel('Curso', { exact: true }).selectOption(ids.b);
    await page.evaluate((id) => window.nodus.setStudyLifecycle('course', id, 'trash'), ids.b);
    await dialog.getByRole('button', { name: 'Mover', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal((await page.evaluate(() => window.nodus.getStudyWorkspace())).placements.find((p) => p.documentId === ids.note).folderId, ids.child);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    console.log(`[ui] ${type}: list/grid, current origin, collision, material, subtopic, unfiled, nested destination, stale destination, keyboard passed`);
  }
  assert.deepEqual(errors, [], 'no renderer errors');
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'No page'));
  await page?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
}
