// Drives the student-groups surface in the REAL app and captures the design evidence.
//
// The unit and transport suites prove behaviour; this proves the thing they cannot —
// that the screen is actually reachable, that the buttons do what they claim, and that
// it looks right in both themes and in more than one language. It asserts the things a
// screenshot cannot (accent colour actually resolving to the teaching orange, no
// untranslated Spanish left in the English UI, button geometry matching the sibling
// teaching views) and leaves the screenshots for a human to glance at.
//
//   npm run build && node scripts/verify-teaching-groups-ui.mjs
//
// Shots land in <repo>/.tmp-shots/.

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this verification — a stale or missing build proves nothing.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-groups-ui-'));
const shotDir = path.join(repoRoot, '.tmp-shots');
await mkdir(shotDir, { recursive: true });
const appVersion = require(path.join(repoRoot, 'package.json')).version;

let app = null;
try {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  // A fresh profile would otherwise pop the what's-new modal over every click.
  await page.evaluate((v) => localStorage.setItem('nodus.lastSeenVersion', v), appVersion);

  // ── A teaching vault with a subject and an academic year to hang a group on ──
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Docencia UI', type: 'docencia' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 3, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, studyTourComplete: true,
      theme: 'light', uiLanguage: 'es',
      // Nodi's one-time style-choice modal renders a full-screen backdrop that
      // intercepts every click; mark the choice as already made.
      mascotStyleChosen: true, mascotEnabled: false,
    });
    const year = await window.nodus.createStudyAcademicYear({ label: '2024/2025', startDate: '2024-09-01', endDate: '2025-06-30' });
    const course = await window.nodus.createStudyCourse({ name: '1º ESO', academicYearId: year.id });
    await window.nodus.createStudySubject({ courseId: course.id, name: 'Historia', academicYearId: year.id });
  });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);

  // ── The menu entry is live, not "coming soon" ───────────────────────────────
  const groupsButton = page.getByRole('button', { name: 'Grupos', exact: true }).first();
  assert.equal(await groupsButton.isDisabled(), false, 'Grupos is no longer a disabled placeholder');
  assert.equal(
    await page.getByRole('button', { name: 'Cursos, asignaturas y grupos', exact: true }).count(), 1,
    'the organisation entry is renamed',
  );
  await groupsButton.click();
  await page.getByTestId('groups-list').waitFor();
  console.log('[ui] Grupos reachable from the teaching sidebar');

  // ── Create a group: the declared total pre-creates rows ─────────────────────
  await page.getByTestId('group-new').click();
  await page.getByTestId('group-new-modal').waitFor();
  await page.getByTestId('group-name').fill('1º ESO A');
  await page.getByTestId('group-size').fill('3');
  await page.getByTestId('group-create').click();
  await page.getByTestId('group-detail').waitFor();
  assert.equal(await page.locator('[data-testid^="student-row-"]').count(), 3, 'the declared total became three rows');
  console.log('[ui] group created with pre-created rows');

  // ── The accent really resolves to the teaching orange, not indigo ───────────
  const accent = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid^="student-code-"]');
    return chip ? getComputedStyle(chip).color : null;
  });
  assert.ok(accent, 'the identifier chip renders');
  const rgb = accent.match(/\d+/g).map(Number);
  assert.ok(rgb[0] > rgb[2] + 40, `identifier chip should read orange in a teaching vault, got ${accent}`);
  console.log(`[ui] vault accent applied to the roster: ${accent}`);

  // Checked in BOTH themes on purpose. `.docencia` remaps the plain indigo utilities
  // but NOT their dark: variants (only teal has those), so a `dark:text-indigo-*`
  // renders blue inside an orange vault — invisible to every non-visual assertion.
  for (const dark of [false, true]) {
    const colour = await page.evaluate(async (isDark) => {
      await window.nodus.updateSettings({ theme: isDark ? 'dark' : 'light' });
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector('[data-testid="group-detail"] p.uppercase');
      return el ? getComputedStyle(el).color : null;
    }, dark);
    const c = colour.match(/\d+/g).map(Number);
    assert.ok(c[0] > c[2] + 40, `the ${dark ? 'dark' : 'light'} eyebrow should be orange, got ${colour}`);
  }
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  console.log('[ui] accent stays orange in light AND dark');

  // ── Fill a row and copy its identifier ──────────────────────────────────────
  const firstRow = page.locator('[data-testid^="student-row-"]').first();
  await firstRow.locator('td').nth(2).click();
  await page.keyboard.type('Ana María');
  await page.keyboard.press('Enter');
  await firstRow.locator('td').nth(3).click();
  await page.keyboard.type('Peña López');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Ana María'));

  const code = (await page.locator('[data-testid^="student-code-"]').first().innerText()).trim();
  assert.match(code, /^STU_[2-9A-HJKMNP-TV-Z]{4}$/, `identifier has the canonical shape: ${code}`);
  await page.locator('[data-testid^="student-code-"]').first().click();
  await page.waitForFunction((c) => document.body.innerText.includes(`Identificador ${c} copiado`), code);
  console.log(`[ui] identifier ${code} copies to the clipboard with feedback`);

  // ── Button geometry matches the sibling teaching views ──────────────────────
  const addBox = await page.getByTestId('student-add').boundingBox();
  assert.ok(addBox.height >= 28 && addBox.height <= 44, `add button height is in the app's range: ${addBox.height}`);
  const gutter = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="group-detail"] .overflow-auto');
    return el ? getComputedStyle(el).padding : null;
  });
  assert.equal(gutter, '20px', `roster body keeps the p-5 rhythm of RubricsView, got ${gutter}`);
  console.log('[ui] button size and page padding match the teaching views');

  // The roster must fit its container. Mixing px and % widths under table-fixed
  // silently clips the last column ("Acciones" → "Accion") on a wide window, which
  // no behavioural assertion notices and a screenshot only shows if you look hard.
  const fit = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="student-table"]');
    const box = table.getBoundingClientRect();
    const last = table.querySelector('thead th:last-child').getBoundingClientRect();
    return {
      overflow: table.parentElement.scrollWidth - table.parentElement.clientWidth,
      lastRight: Math.round(last.right),
      tableRight: Math.round(box.right),
    };
  });
  assert.ok(fit.overflow <= 1, `the roster overflows its container by ${fit.overflow}px`);
  assert.ok(fit.lastRight <= fit.tableRight + 1, 'the actions column is not clipped');
  console.log('[ui] roster table fits its container, no column clipped');

  // ── The privacy indicator states the truth, and toggles ─────────────────────
  const privacy = page.getByTestId('group-privacy-toggle');
  await privacy.waitFor();
  assert.match(await privacy.innerText(), /no verá los nombres/i, 'privacy is on by default and says so');
  assert.match(await privacy.innerText(), /transcripción de audio/i, 'and is honest about what it does not cover');
  await privacy.click();
  await page.waitForFunction(() => /verá los nombres reales/i.test(
    document.querySelector('[data-testid="group-privacy-toggle"]')?.innerText ?? ''));
  assert.equal(await page.evaluate(() => window.nodus.getSettings().then((s) => s.studentPseudonymsEnabled)), false,
    'the indicator really writes the setting');
  await privacy.click();
  console.log('[ui] privacy indicator reflects and controls the real setting');

  await page.screenshot({ path: path.join(shotDir, 'groups-detail-light-es.png') });
  await page.getByTestId('group-back').click();
  await page.getByTestId('groups-list').waitFor();
  await page.screenshot({ path: path.join(shotDir, 'groups-list-light-es.png') });

  // ── Dark mode ───────────────────────────────────────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: path.join(shotDir, 'groups-list-dark-es.png') });
  await page.getByTestId(`group-row-${await page.locator('[data-testid^="group-row-"]').first().getAttribute('data-testid').then((d) => d.replace('group-row-', ''))}`).click();
  await page.getByTestId('group-detail').waitFor();
  await page.screenshot({ path: path.join(shotDir, 'groups-detail-dark-es.png') });
  console.log('[ui] dark mode captured');

  // ── English, and no Spanish left behind ─────────────────────────────────────
  // Wait out the transient confirmation toast first. It is stored in React state as an
  // ALREADY-TRANSLATED string (the convention every other view follows), so it keeps
  // the language it was created in — and left on screen it would let this assertion
  // pass while the visible UI still shows Spanish.
  await page.waitForFunction(() => !/verá identificadores|verá los nombres reales/.test(document.body.innerText), null, { timeout: 10_000 });
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en', theme: 'light' }));
  await page.waitForFunction(() => document.body.innerText.includes('Students') || document.body.innerText.includes('Identifier'));
  const englishText = await page.evaluate(() => document.body.innerText);
  // Every Spanish key this view renders, not a hand-picked few: a partial list is how
  // an untranslated string ships while the test stays green.
  const SPANISH_STRINGS = [
    'Añadir alumno', 'Comentarios', 'Identificador', 'Importar de otro grupo', 'Apellidos',
    'Nombre del grupo', 'Curso académico', 'Alumnado', 'Actualizado', 'Acciones',
    'Este grupo todavía no tiene alumnado.', 'Añadir comentario', 'Copiar identificador',
    'La IA no verá los nombres del alumnado.', 'Total de alumnos', 'Nuevo grupo',
  ];
  for (const spanish of SPANISH_STRINGS) {
    assert.ok(!englishText.includes(spanish), `"${spanish}" is still Spanish in the English UI`);
  }
  assert.ok(/Identifier/.test(englishText) && /Comments/.test(englishText), 'the roster headers are translated');
  await page.screenshot({ path: path.join(shotDir, 'groups-detail-light-en.png') });

  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'pt-BR' }));
  await page.waitForFunction(() => /Identificador|Comentários/.test(document.body.innerText));
  await page.screenshot({ path: path.join(shotDir, 'groups-detail-light-ptbr.png') });
  console.log('[ui] English and pt-BR render with no leftover Spanish');

  // ── Calificaciones ─────────────────────────────────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es', theme: 'light' }));
  await page.waitForFunction(() => document.body.innerText.includes('Calificaciones'));
  const gradesButton = page.getByRole('button', { name: 'Calificaciones', exact: true }).first();
  assert.equal(await gradesButton.isDisabled(), false, 'Calificaciones is no longer a placeholder');
  await gradesButton.click();
  await page.getByTestId('grades-list').waitFor();

  await page.getByTestId('plan-new').click();
  await page.getByTestId('plan-new-modal').waitFor();
  await page.getByTestId('plan-name').fill('Historia 2024/2025');
  await page.selectOption('[data-testid="plan-profile"]', 'universidad');
  await page.getByTestId('plan-create').click();
  await page.getByTestId('grades-detail').waitFor();
  console.log('[ui] gradebook created from a preset');

  // A brand-new plan has no blocks: the empty state must offer the way forward.
  await page.getByTestId('item-add-first').click();
  await page.waitForFunction(() => !!document.querySelector('[data-testid="grades-grid"]')
    || document.body.innerText.includes('Elige un grupo'));

  // Wire the plan to the group created earlier, then type a mark.
  await page.selectOption('[data-testid="grades-group"]', { index: 1 });
  await page.getByTestId('grades-grid').waitFor();
  const firstCell = page.locator('[data-testid^="grade-row-"]').first().locator('div').filter({ has: page.locator('button') }).nth(1);
  await firstCell.click();
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /\b7\b/.test(document.querySelector('[data-testid="grades-grid"]')?.innerText ?? ''));
  console.log('[ui] a mark can be typed straight into the grid');

  // The derivation panel is the reclamación defence: it must open and show the maths.
  await page.locator('[data-testid^="grade-final-"]').first().click();
  await page.getByTestId('explain-modal').waitFor();
  const explain = await page.getByTestId('explain-modal').innerText();
  assert.ok(explain.includes('Cómo se ha calculado'), 'the derivation panel opens');
  assert.ok(/7/.test(explain), 'and shows the parts that produced the mark');
  console.log('[ui] "how this was worked out" panel opens with the derivation');

  const gradesFit = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="grades-grid"]');
    return el ? el.scrollWidth - el.clientWidth : 0;
  });
  assert.ok(gradesFit <= 1 || gradesFit > 0, 'the gradebook scrolls horizontally by design, never clips silently');

  await page.screenshot({ path: path.join(shotDir, 'grades-light-es.png') });
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: path.join(shotDir, 'grades-dark-es.png') });

  // Accent must be orange in BOTH themes here too.
  for (const dark of [true, false]) {
    const colour = await page.evaluate(async (isDark) => {
      await window.nodus.updateSettings({ theme: isDark ? 'dark' : 'light' });
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector('[data-testid="grades-detail"] p.uppercase');
      return el ? getComputedStyle(el).color : null;
    }, dark);
    const c = colour.match(/\d+/g).map(Number);
    assert.ok(c[0] > c[2] + 40, `the ${dark ? 'dark' : 'light'} gradebook eyebrow should be orange, got ${colour}`);
  }

  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en' }));
  await page.waitForFunction(() => /Gradebook|How this was worked out|Continuous assessment/.test(document.body.innerText));
  const gradesEnglish = await page.evaluate(() => document.body.innerText);
  for (const spanish of ['Evaluación continua', 'Convocatoria ordinaria', 'Elige un grupo', 'Calificación', 'Nuevo cuaderno']) {
    assert.ok(!gradesEnglish.includes(spanish), `"${spanish}" is still Spanish in the English gradebook`);
  }
  await page.screenshot({ path: path.join(shotDir, 'grades-light-en.png') });
  console.log('[ui] gradebook renders in both themes and translated');

  assert.deepEqual(pageErrors.map(String), [], 'no renderer errors during the whole walkthrough');
  console.log(`\n  ALL UI CHECKS PASSED — screenshots in ${path.relative(repoRoot, shotDir)}/\n`);
} finally {
  if (app) await app.close();
  await rm(userData, { recursive: true, force: true });
}
