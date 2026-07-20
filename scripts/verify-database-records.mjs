// Focused Electron regression for database fit-to-content rows, editable AI text,
// and the full-record modal palette. Uses a throwaway profile and never touches the
// user's vaults.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-db-records-'));
const screenshotDir = process.env.SHOT_OUT || os.tmpdir();
const longNote = 'Observación extensa del hábitat: la muestra crecía bajo un dosel muy cerrado, junto a un arroyo de corriente lenta y sobre un sustrato permanentemente húmedo.';
const generatedSummary = 'Resumen generado por IA que el usuario debe poder revisar, corregir y guardar manualmente como cualquier otra celda de texto.';
const editedSummary = 'Resumen de IA revisado manualmente y guardado por el usuario.';

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this focused verification.');
}

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

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

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  console.log('[database-records] Electron launched');
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(async () => {
    await window.nodus.seedDatabasesDemoData();
    // Seeding deliberately re-enables the guided Databases tour for real demo
    // users, so test preferences must be applied afterwards.
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 4,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      databasesTourComplete: true,
      mascotEnabled: false,
      theme: 'light',
      uiLanguage: 'es',
    });
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  console.log('[database-records] Demo profile ready');

  const ids = await page.evaluate(async ({ note, summary }) => {
    const database = (await window.nodus.listDatabases()).find((item) => item.name === 'Muestras de campo');
    if (!database) throw new Error('demo database does not exist');
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const rows = await window.nodus.listDatabaseRows(database.id, { sort: 'position' });
    const notes = detail.columns.find((column) => column.name === 'Notas');
    const ai = detail.columns.find((column) => column.name === 'Resumen IA');
    if (!notes || !ai || !rows[0]) throw new Error('demo row or target columns do not exist');
    await window.nodus.setDatabaseCell(rows[0].id, notes.id, note);
    await window.nodus.setDatabaseCell(rows[0].id, ai.id, summary);
    return { databaseId: database.id, rowId: rows[0].id, notesId: notes.id, aiId: ai.id };
  }, { note: longNote, summary: generatedSummary });

  await page.getByText('Muestras de campo', { exact: true }).first().click();
  await page.getByTitle(longNote).waitFor();
  console.log('[database-records] Database table open');

  // Fit via the real column menu, then verify the persisted flag and unclipped row.
  await page.getByRole('main').getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByText('Ajustar al contenido', { exact: true }).click();
  await page.waitForFunction(async (columnId) => {
    const databases = await window.nodus.listDatabases();
    for (const database of databases) {
      const detail = await window.nodus.getDatabaseDetail(database.id);
      const column = detail?.columns.find((candidate) => candidate.id === columnId);
      if (column) return column.config.fitContent === true;
    }
    return false;
  }, ids.notesId);
  const fittedCell = page.getByTitle(longNote);
  const fittedLayout = await fittedCell.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    whiteSpace: getComputedStyle(element).whiteSpace,
  }));
  assert.ok(fittedLayout.height > 40, `fitted row grows beyond one line (${fittedLayout.height}px)`);
  assert.ok(fittedLayout.scrollHeight <= fittedLayout.clientHeight + 1, 'fitted text is not vertically clipped');
  assert.notEqual(fittedLayout.whiteSpace, 'nowrap', 'fitted text wraps');
  console.log('[database-records] Fit-to-content verified');

  // An AI value opens the same full-text editor and persists a manual revision.
  await page.getByTitle(generatedSummary).click();
  const aiEditor = page.locator('textarea');
  await aiEditor.fill(editedSummary);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async ({ rowId, columnId, expected }) => {
    const row = await window.nodus.getDatabaseRow(rowId);
    return row?.cells[columnId] === expected;
  }, { rowId: ids.rowId, columnId: ids.aiId, expected: editedSummary });
  console.log('[database-records] AI text editing verified');

  // Open the full record and inspect the explicit light Databases palette.
  await page.getByRole('button', { name: 'Galería', exact: true }).click();
  await page.getByText('Musgo alpino', { exact: true }).click();
  const modal = page.getByTestId('database-record-modal');
  await modal.waitFor();
  const lightPalette = await modal.evaluate((element) => ({
    modal: getComputedStyle(element).backgroundColor,
    header: getComputedStyle(element.querySelector('.database-record-header')).backgroundColor,
    field: getComputedStyle(element.querySelector('.database-record-field')).backgroundColor,
  }));
  assert.equal(lightPalette.modal, 'rgb(255, 250, 251)');
  assert.equal(lightPalette.header, 'rgb(255, 241, 244)');
  assert.equal(lightPalette.field, 'rgb(255, 245, 247)');
  await page.screenshot({ path: path.join(screenshotDir, 'database-record-light.png') });
  console.log('[database-records] Light record palette verified');

  // The same semantic surfaces must remain crimson in dark mode.
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.getByText('Muestras de campo', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Galería', exact: true }).click();
  await page.getByText('Musgo alpino', { exact: true }).click();
  const darkModal = page.getByTestId('database-record-modal');
  await darkModal.waitFor();
  const darkPalette = await darkModal.evaluate((element) => ({
    modal: getComputedStyle(element).backgroundColor,
    header: getComputedStyle(element.querySelector('.database-record-header')).backgroundColor,
  }));
  assert.equal(darkPalette.modal, 'rgb(25, 7, 13)');
  assert.notEqual(darkPalette.header, 'rgb(23, 23, 23)', 'header does not fall back to neutral grey');
  await page.screenshot({ path: path.join(screenshotDir, 'database-record-dark.png') });

  console.log(`Database record verification passed. Screenshots: ${screenshotDir}`);
} finally {
  await closeElectronApp(app);
  await rm(userData, { recursive: true, force: true });
}

// Playwright can retain a closed transport handle on macOS after a forced Electron
// shutdown; the focused verifier has no further asynchronous work at this point.
process.exit(0);
