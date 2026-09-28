// Real Electron/IPC/SQLite verification of Workspace notes linked to study places, in
// disposable estudio and docencia vaults with synthetic data.
// Run `npx vite build && node scripts/verify-study-note-links-ui.mjs`.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-note-links-ui-'));
const shots = path.join(root, '.tmp-shots', 'study-note-links');
await mkdir(shots, { recursive: true });
const file = path.join(userData, 'Tema 1 - Apuntes de clase.txt');
await writeFile(file, 'La fotosíntesis transforma la energía luminosa en energía química.');
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const waitFor = async (probe, message, timeout = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(message);
};
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addLocatorHandler(page.getByText('Todos los tutoriales, en Ajustes', { exact: true }), async () => {
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  for (const type of ['estudio', 'docencia']) {
    const ids = await page.evaluate(async ({ type, file, version }) => {
      const api = window.nodus;
      const created = await api.createVault({ name: `Notas vinculadas ${type}`, type });
      const switched = await api.switchVault(created.vault.id);
      if (!switched.ok) throw new Error(switched.message);
      await api.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, docenciaTourComplete: true, theme: type === 'estudio' ? 'light' : 'dark', uiLanguage: 'es', mascotStyleChosen: true, mascotEnabled: false });
      localStorage.setItem('nodus.lastSeenVersion', version);
      localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      localStorage.setItem('nodus-study-browser-layout', 'list');
      const course = await api.createStudyCourse({ name: '1.º de Bachillerato' });
      const other = await api.createStudyCourse({ name: '2.º de Bachillerato' });
      const biology = await api.createStudySubject({ name: 'Biología', courseId: course.id });
      const chemistry = await api.createStudySubject({ name: 'Química', courseId: other.id });
      const block = await api.createStudyFolder({ name: 'Bloque 1', subjectId: biology.id, courseId: course.id });
      const unit = await api.createStudyTopic({ name: 'Unidad 1: La célula', subjectId: biology.id, folderId: block.id });
      const [imported] = await api.importStudyMaterialPaths([file], { courseId: course.id, subjectId: biology.id });
      const note = await api.createNote({ title: 'Resumen de la unidad', content: '# Resumen\n\nLa célula es la **unidad básica** de la vida.', kind: 'markdown' });
      const outline = await api.createNote({ title: 'Esquema de repaso', content: 'Puntos clave para el examen.', kind: 'markdown' });
      return { course: course.id, other: other.id, biology: biology.id, chemistry: chemistry.id, block: block.id, unit: unit.id, material: imported.material.id, materialTitle: imported.material.title, note: note.id, outline: outline.id };
    }, { type, file, version: require('../package.json').version });
    console.log(`[ui] ${type}: seeded`);
    // Study vaults hide the Workspace from the sidebar by default, so it is entered the way
    // Research Chat's "Open note" enters it; the catalogue is its first tab.
    const openWorkspace = async ({ note = false } = {}) => {
      await page.evaluate((id) => window.dispatchEvent(new CustomEvent('nodus:open-research-note', { detail: id })), ids.note);
      if (!note) await page.getByTestId('workspace-tab-home').click();
    };
    await page.reload();
    await page.waitForFunction(() => !!window.nodus);

    // ── From the Workspace: link one note to a unit, another subject and a material ──
    await openWorkspace();
    const row = page.getByTestId(`workspace-item-${ids.note}`);
    await row.click({ button: 'right' });
    await page.getByTestId('workspace-context-study-link').click();
    let dialog = page.getByTestId('study-note-link-dialog');
    await dialog.getByTestId('study-note-link-course').selectOption(ids.course);
    await dialog.getByTestId('study-note-link-subject').selectOption(ids.biology);
    await dialog.getByTestId('study-note-link-folder').selectOption(ids.block);
    await dialog.getByTestId('study-note-link-topic').selectOption(ids.unit);
    await dialog.getByTestId('study-note-link-add').click();
    await dialog.getByTestId('study-note-link-current').locator('li').first().waitFor();
    await dialog.getByTestId('study-note-link-course').selectOption(ids.other);
    await dialog.getByTestId('study-note-link-subject').selectOption(ids.chemistry);
    await dialog.getByTestId('study-note-link-add').click();
    await waitFor(async () => (await dialog.getByTestId('study-note-link-current').locator('li').count()) === 2, 'second link not shown');
    await dialog.getByTestId('study-note-link-mode-material').click();
    await dialog.getByTestId(`study-note-link-material-${ids.material}`).click();
    await waitFor(async () => (await dialog.getByTestId('study-note-link-current').locator('li').count()) === 3, 'material link not shown');
    assert.match(await dialog.getByTestId('study-note-link-current').innerText(), /1\.º de Bachillerato \/ Biología \/ Bloque 1 \/ Unidad 1: La célula/);
    await page.screenshot({ path: path.join(shots, `${type}-link-dialog.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await waitFor(async () => (await page.getByTestId(`workspace-item-study-links-${ids.note}`).innerText().catch(() => '')).trim() === '3', 'row badge does not count 3 links');
    await row.click();
    const panel = page.getByTestId('workspace-study-links');
    await waitFor(async () => (await panel.locator('li').count()) === 3, 'details panel does not list 3 links');
    await page.screenshot({ path: path.join(shots, `${type}-workspace-panel.png`) });

    // ── The note shows in the unit and in its containers, and opens in place ────────
    await panel.locator('button[title$="Unidad 1: La célula"]').click();
    const linkedRow = page.getByTestId(`study-linked-note-${ids.note}`);
    await linkedRow.waitFor();
    await page.screenshot({ path: path.join(shots, `${type}-unit-linked-note.png`) });
    await page.getByTestId(`study-linked-note-open-${ids.note}`).click();
    const editable = page.locator('.study-milkdown [contenteditable="true"]').first();
    await editable.waitFor();
    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Editada desde la unidad.');
    await waitFor(async () => (await page.evaluate((id) => window.nodus.getNote(id), ids.note))?.content.includes('Editada desde la unidad'), 'in-place edit was not saved to the Workspace note', 15000);
    await page.screenshot({ path: path.join(shots, `${type}-edit-in-place.png`) });
    await page.getByRole('button', { name: 'Cerrar apunte' }).first().click();
    await page.getByRole('button', { name: 'Cerrar pestaña' }).click();
    await linkedRow.waitFor();

    // ── Unlink from one subject: only that place loses the note ─────────────────────
    await openWorkspace({ note: true });
    await page.getByTestId('workspace-study-links').locator('button[title$="Química"]').click();
    const chemistryRow = page.getByTestId(`study-linked-note-${ids.note}`);
    await chemistryRow.waitFor();
    await page.getByTestId(`study-linked-note-unlink-${ids.note}`).click();
    await chemistryRow.waitFor({ state: 'detached' });
    const remaining = await page.evaluate((id) => window.nodus.listStudyNoteLinks({ noteId: id }), ids.note);
    assert.equal(remaining.length, 2, 'unlinking removes only this place');

    // ── The reverse direction: link an existing note from the subject ───────────────
    await page.getByTestId('study-link-workspace-note').click();
    const picker = page.getByTestId('study-note-picker-dialog');
    await picker.getByTestId(`study-note-picker-${ids.outline}`).check();
    await page.screenshot({ path: path.join(shots, `${type}-note-picker.png`) });
    await picker.getByTestId('study-note-picker-submit').click();
    await picker.waitFor({ state: 'detached' });
    await page.getByTestId(`study-linked-note-${ids.outline}`).waitFor();

    // ── Beside the material ──────────────────────────────────────────────────────────
    await openWorkspace({ note: true });
    await page.getByTestId('workspace-study-links').locator(`button[title="${ids.materialTitle}"]`).click();
    await page.getByTestId('study-material-viewer').waitFor();
    await page.getByTestId('study-material-linked-notes-toggle').click();
    const materialNote = page.getByTestId(`study-material-linked-note-${ids.note}`);
    await materialNote.getByRole('button').first().click();
    await materialNote.locator('p', { hasText: 'Editada desde la unidad' }).first().waitFor();
    await page.screenshot({ path: path.join(shots, `${type}-material-panel.png`) });

    // ── Trash with confirmation, from the material; restoring brings the links back ──
    await page.getByTestId(`study-material-linked-note-trash-${ids.note}`).click();
    const confirm = page.getByRole('dialog', { name: 'Mover la nota a la papelera' });
    await confirm.waitFor();
    await page.screenshot({ path: path.join(shots, `${type}-trash-confirm.png`) });
    await confirm.getByRole('button', { name: 'Mover a la papelera' }).click();
    await materialNote.waitFor({ state: 'detached' });
    assert.ok((await page.evaluate((id) => window.nodus.getNote(id), ids.note)).trashedAt, 'the note went to the Workspace trash');
    assert.equal((await page.evaluate(() => window.nodus.listStudyNoteLinks())).some((link) => link.noteId === ids.note), false);
    await page.evaluate(async (id) => { await window.nodus.restoreNotes([id]); window.dispatchEvent(new CustomEvent('nodus:study-workspace-changed')); }, ids.note);
    await materialNote.waitFor();
    assert.equal((await page.evaluate((id) => window.nodus.listStudyNoteLinks({ noteId: id }), ids.note)).length, 2, 'restoring the note restores its links');
    // Leave the material before the next vault is created, so nothing reads it across the switch.
    await page.locator('[data-tour="nav-home"]').click();
    console.log(`[ui] ${type}: link from Workspace, badge, details, unit list, edit in place, unlink, reverse link, material panel, trash and restore passed`);
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
