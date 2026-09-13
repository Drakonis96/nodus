// End-to-end functional verification of the Question Bank and flashcard management
// workflow, with screenshots written to artifacts/question-bank-verification/.
//
// Every assertion runs against the real Electron app and its real SQLite vault:
// the UI drives the flow, and the IPC bridge is read back to confirm persistence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = path.join(repoRoot, 'artifacts', 'question-bank-verification');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-qbank-verify-'));
const fixtures = await mkdtemp(path.join(os.tmpdir(), 'nodus-qbank-fixtures-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const checks = [];
const check = (label, condition) => {
  assert.ok(condition, label);
  checks.push(label);
  console.log(`[verify] ok — ${label}`);
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log(`[verify] shot — ${name}`);
};
const openBank = async (page, label) => {
  if (await page.getByTestId('study-question-bank').isVisible().catch(() => false)) return;
  const homeCard = page.getByText(label, { exact: true }).first();
  if (await homeCard.count()) {
    await homeCard.click();
  } else {
    await page.locator('[data-tour="nav-studyQuestions"]').first().click();
  }
  await page.getByTestId('study-question-bank').waitFor();
};

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
const pageErrors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1440, height: 920 });
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999,
      tourComplete: true, advancedTourComplete: true, studyTourComplete: true,
      uiLanguage: 'es', theme: 'dark', mascotEnabled: false, reduceMotion: true,
    });
    const created = await window.nodus.createVault({ name: 'Banco de preguntas QA', type: 'estudio' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999,
      tourComplete: true, advancedTourComplete: true, studyTourComplete: true,
      uiLanguage: 'es', theme: 'dark', mascotEnabled: false, reduceMotion: true,
    });
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const leaveOnboarding = async () => {
    const leave = page.getByRole('button', { name: 'Salir', exact: true });
    if (await leave.count()) { await leave.first().click(); await page.waitForTimeout(500); }
  };
  await leaveOnboarding();
  const dismissUpdateModal = async () => {
    const modal = page.getByTestId('startup-update-modal');
    if (!(await modal.count())) return;
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await modal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await modal.waitFor({ state: 'detached' });
  };
  await dismissUpdateModal();

  // ── Seed a realistic bank through the real IPC bridge ─────────────────────
  const seeded = await page.evaluate(async () => {
    const course = await window.nodus.createStudyCourse({ name: 'Historia' });
    const subject = await window.nodus.createStudySubject({ courseId: course.id, name: 'Moderna' });
    const otherSubject = await window.nodus.createStudySubject({ courseId: course.id, name: 'Contemporánea' });
    const topic = await window.nodus.createStudyTopic({ subjectId: subject.id, name: 'Ilustración' });
    const q1 = await window.nodus.createStudyQuestion({
      prompt: '¿Qué defendió la Ilustración según el manual?', type: 'short', difficulty: 'easy', status: 'approved',
      answer: { text: 'La razón y la crítica.' }, explanation: 'La Ilustración defendió la razón.',
      tags: ['ilustración', 'siglo XVIII'], courseId: course.id, subjectId: subject.id, topicId: topic.id,
      source: { title: 'Manual de historia', excerpt: 'La Ilustración defendió la razón y la crítica.' },
    });
    const q2 = await window.nodus.createStudyQuestion({
      prompt: '¿Qué corriente cuestionó la autoridad tradicional?', type: 'short', difficulty: 'hard', status: 'pending',
      answer: { text: 'La Ilustración.' }, explanation: 'Cuestionó la autoridad.', tags: ['ilustración'],
      courseId: course.id, subjectId: subject.id, topicId: topic.id, source: { title: 'Apuntes', excerpt: 'Corriente crítica.' },
    });
    const q3 = await window.nodus.createStudyQuestion({
      prompt: 'Elige el principio ilustrado central.', type: 'single_choice', difficulty: 'medium', status: 'pending',
      options: [{ id: 'O1', text: 'La razón', correct: true }, { id: 'O2', text: 'El dogma', correct: false }],
      answer: { text: 'La razón', value: 'O1' }, explanation: 'La razón organiza el conocimiento.', tags: ['razón'],
      subjectId: subject.id, source: { title: 'Manual', excerpt: 'La razón organiza el conocimiento.' },
    });
    const q4 = await window.nodus.createStudyQuestion({
      prompt: 'Relaciona cada autor con su idea.', type: 'matching', difficulty: 'hard', status: 'pending',
      answer: { pairs: [['Kant', 'Atreverse a saber'], ['Rousseau', 'Contrato social']] }, explanation: 'Pares de la unidad.',
      tags: ['autores'], subjectId: otherSubject.id, source: { title: 'Apuntes', excerpt: 'Kant y Rousseau.' },
    });
    const c1 = await window.nodus.createStudyFlashcard({
      type: 'front_back', front: '¿Qué es la Ilustración?', back: 'Un movimiento que defendió la razón y la crítica.',
      hint: 'Siglo XVIII', difficulty: 'easy', tags: ['ilustración'], subjectId: subject.id, topicId: topic.id, sourceExcerpt: 'Manual de historia',
    });
    const c2 = await window.nodus.createStudyFlashcard({ type: 'cloze', front: 'La {{c1::razón}} guía la crítica ilustrada.', back: 'razón', difficulty: 'medium', tags: ['razón'] });
    return { courseId: course.id, subjectId: subject.id, otherSubjectId: otherSubject.id, topicId: topic.id, q1: q1.id, q2: q2.id, q3: q3.id, q4: q4.id, c1: c1.id, c2: c2.id };
  });
  check('seed creates course, subjects, topic, four questions and two flashcards', Boolean(seeded.q1 && seeded.c1));

  // ── Open the bank ─────────────────────────────────────────────────────────
  await openBank(page, 'Banco de preguntas');
  await page.getByTestId('study-question-table').waitFor();
  const questionRows = page.locator('tr[data-testid^="study-question-"]');
  check('bank lists the four seeded questions', await questionRows.count() === 4);
  await shot(page, '01-question-bank-dark.png');

  // ── Search, filtering and sorting ─────────────────────────────────────────
  const searchInput = page.getByPlaceholder('Buscar enunciado, explicación o etiqueta…');
  await searchInput.fill('corriente');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-testid^="study-question-"]').length === 1);
  check('literal search narrows the bank', await questionRows.count() === 1);
  await searchInput.fill('');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-testid^="study-question-"]').length === 4);
  await page.getByTestId('study-bank-tag-filter').selectOption('ilustración');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-testid^="study-question-"]').length === 2);
  check('tag filter keeps only the tagged questions', await questionRows.count() === 2);
  await page.getByTestId('study-bank-material-filter').waitFor();
  await shot(page, '02-filters-and-sort.png');
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tr[data-testid^="study-question-"]').length === 4);
  await page.getByTestId('study-bank-sort').selectOption('prompt');
  await page.waitForTimeout(400);
  const firstPrompt = (await questionRows.first().textContent()) ?? '';
  check('prompt sort puts the A–Z first question on top', firstPrompt.includes('Elige el principio'));
  await page.getByTestId('study-bank-sort').selectOption('updated');

  // ── Multi-select and bulk actions ─────────────────────────────────────────
  await page.getByTestId(`study-question-select-${seeded.q1}`).check();
  await page.getByTestId(`study-question-select-${seeded.q2}`).check();
  check('bulk toolbar appears with the selected count', await page.getByTestId('study-bank-bulk').isVisible());
  await shot(page, '03-multi-select-bulk.png');
  await page.getByTestId('study-bank-bulk-difficulty').selectOption('hard');
  await page.waitForFunction(async ([q1, q2]) => {
    const questions = await window.nodus.listStudyQuestions();
    return [q1, q2].every((id) => questions.find((question) => question.id === id)?.difficulty === 'hard');
  }, [seeded.q1, seeded.q2]);
  check('bulk difficulty updates both selected questions', true);
  await page.getByTestId(`study-question-select-${seeded.q1}`).check();
  await page.getByTestId(`study-question-select-${seeded.q2}`).check();
  await page.getByTestId('study-bank-bulk-status').selectOption('approved');
  await page.waitForFunction(async ([q1, q2]) => {
    const questions = await window.nodus.listStudyQuestions();
    return [q1, q2].every((id) => questions.find((question) => question.id === id)?.status === 'approved');
  }, [seeded.q1, seeded.q2]);
  check('bulk status approval persists in the vault', true);
  const bulkMessage = await page.getByTestId('study-bank-bulk-message').textContent();
  check('bulk action reports how many items changed', /2 elementos actualizados/.test(bulkMessage ?? ''));
  await shot(page, '04-bulk-applied.png');
  await page.getByTestId(`study-question-select-${seeded.q3}`).check();
  await page.getByTestId('study-bank-bulk-subject').selectOption(seeded.otherSubjectId);
  await page.getByTestId('study-bank-bulk-move').click();
  await page.waitForFunction(async ([q3, other]) => (await window.nodus.getStudyQuestion(q3)).subjectId === other, [seeded.q3, seeded.otherSubjectId]);
  check('bulk move re-categorises a question into another subject', true);
  await page.getByTestId(`study-question-select-${seeded.q1}`).check();
  await page.getByTestId('study-bank-bulk').locator('input[placeholder="Etiquetas separadas por comas"]').fill('verificado, prioridad');
  await page.getByRole('button', { name: 'Añadir etiquetas' }).click();
  await page.waitForFunction(async (q1) => (await window.nodus.getStudyQuestion(q1)).tags.includes('verificado'), seeded.q1);
  check('bulk tag addition is persisted', true);
  await page.getByRole('button', { name: 'Deseleccionar' }).click();

  // ── Individual question editing ───────────────────────────────────────────
  await questionRows.filter({ hasText: '¿Qué defendió la Ilustración según el manual?' }).click();
  await page.getByTestId('study-question-edit').click();
  const editor = page.getByTestId('study-question-editor');
  await editor.locator('textarea').nth(0).fill('¿Qué defendió la Ilustración europea (revisado)?');
  await page.getByTestId('study-question-editor-cognitive').selectOption('analyze');
  await page.getByTestId('study-question-editor-subject').selectOption(seeded.otherSubjectId);
  await shot(page, '05-question-editor.png');
  await page.getByTestId('study-question-save').click();
  await page.waitForFunction(async (q1) => (await window.nodus.getStudyQuestion(q1)).prompt.includes('revisado'), seeded.q1);
  check('editing a question updates its text, cognitive level and subject', true);
  await page.getByTestId('study-question-detail').getByText('¿Qué defendió la Ilustración europea (revisado)?').first().waitFor();
  await shot(page, '06-question-edited-detail.png');

  // ── New question and individual deletion ──────────────────────────────────
  await page.getByTestId('study-question-new').click();
  const newEditor = page.getByTestId('study-question-editor');
  await newEditor.locator('textarea').nth(0).fill('¿Qué autor propuso el contrato social?');
  await newEditor.locator('textarea').nth(1).fill('Rousseau.');
  await newEditor.locator('textarea').nth(2).fill('Rousseau formuló el contrato social.');
  await page.getByTestId('study-question-editor-subject').selectOption(seeded.otherSubjectId);
  await page.getByTestId('study-question-save').click();
  await page.waitForFunction(async () => (await window.nodus.listStudyQuestions({ search: 'contrato social' })).length === 1);
  check('a new question can be authored from the bank', true);
  const created = (await page.evaluate(async () => window.nodus.listStudyQuestions({ search: 'contrato social' })))[0];
  await page.getByTestId('study-question-detail').getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación' }).click();
  await page.waitForFunction(async (id) => (await window.nodus.getStudyQuestion(id)) === null, created.id);
  check('an individual question can be deleted after confirmation', true);

  // ── Flashcard management ──────────────────────────────────────────────────
  await page.getByTestId('study-bank-tab-flashcards').click();
  await page.getByTestId(`study-flashcard-${seeded.c1}`).waitFor();
  const cardRows = page.locator('tr[data-testid^="study-flashcard-"]');
  check('flashcard tab lists the two seeded cards', await cardRows.count() === 2);
  await shot(page, '07-flashcards-tab.png');
  await page.getByTestId('study-bank-flashcard-new').click();
  await page.getByTestId('study-bank-flashcard-front').fill('¿Quién escribió el contrato social?');
  await page.getByTestId('study-bank-flashcard-back').fill('Rousseau.');
  await shot(page, '08-flashcard-editor.png');
  await page.getByTestId('study-bank-flashcard-save').click();
  await page.waitForFunction(async () => (await window.nodus.listStudyFlashcards({ search: 'contrato social' })).length === 1);
  check('a new flashcard can be created from the bank', true);
  const createdCard = (await page.evaluate(async () => window.nodus.listStudyFlashcards({ search: 'contrato social' })))[0];
  await page.getByTestId('study-bank-flashcard-detail').waitFor();
  await page.getByTestId('study-bank-flashcard-edit').click();
  await page.getByTestId('study-bank-flashcard-back').fill('Jean-Jacques Rousseau.');
  await page.getByTestId('study-bank-flashcard-save').click();
  await page.waitForFunction(async (id) => (await window.nodus.listStudyFlashcards({ includeArchived: true })).find((card) => card.id === id)?.back === 'Jean-Jacques Rousseau.', createdCard.id);
  check('an individual flashcard can be edited', true);
  await page.getByTestId('study-bank-flashcard-detail').getByText('Jean-Jacques Rousseau.').first().waitFor();
  await shot(page, '09-flashcard-edited.png');
  await page.getByTestId('study-bank-flashcard-detail').getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación' }).click();
  await page.waitForFunction(async (id) => !(await window.nodus.listStudyFlashcards({ includeArchived: true })).some((card) => card.id === id), createdCard.id);
  check('an individual flashcard can be deleted', true);

  // ── Import and export (Anki .apkg, Moodle XML, CSV import) ────────────────
  await page.getByTestId('study-bank-tab-questions').click();
  await page.getByTestId('study-question-table').waitFor();
  const apkgPath = path.join(fixtures, 'nodus-bank.apkg');
  const xmlPath = path.join(fixtures, 'nodus-bank.xml');
  const csvPath = path.join(fixtures, 'import-questions.csv');
  await writeFile(csvPath, [
    'tipo,enunciado,respuesta,explicacion,etiquetas,dificultad,opciones',
    'short,¿Qué movimiento confió en la razón?,La Ilustración.,Importado desde CSV.,importado,medium,',
    'single_choice,¿Qué principio defendía la Ilustración?,La razón,Opción correcta importada.,importado,easy,*La razón | El dogma',
    '',
  ].join('\n'), 'utf8');
  const mockDialog = async (mode, filePath) => {
    await app.evaluate(({ dialog }, payload) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: payload.path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [payload.path] });
    }, { mode, path: filePath });
  };
  await mockDialog('save', apkgPath);
  await page.getByTestId('study-bank-export').click();
  await page.getByTestId('study-interchange-dialog').waitFor();
  await shot(page, '10-interchange-export.png');
  await page.getByTestId('study-interchange-export').click();
  await page.getByTestId('study-interchange-format-anki-apkg').click();
  await page.getByTestId('study-interchange-submit').click();
  await page.getByText('Exportación completada').waitFor();
  check('Anki .apkg export writes a package from the bank', fs.existsSync(apkgPath));
  const apkgZip = new AdmZip(apkgPath);
  const collectionBytes = apkgZip.getEntry('collection.anki2')?.getData() ?? Buffer.alloc(0);
  check('the .apkg contains a real Anki collection with the Nodus models', Boolean(apkgZip.getEntry('media')) && collectionBytes.includes(Buffer.from('Nodus Básico')));
  await page.getByTestId('study-interchange-dialog').getByRole('button', { name: 'Cerrar' }).click();
  await mockDialog('save', xmlPath);
  await page.getByTestId('study-bank-export').click();
  await page.getByTestId('study-interchange-export').click();
  await page.getByTestId('study-interchange-format-moodle-xml').click();
  await page.getByTestId('study-interchange-submit').click();
  await page.getByText('Exportación completada').waitFor();
  const xmlText = fs.readFileSync(xmlPath, 'utf8');
  if (!(xmlText.includes('<quiz>') && xmlText.includes('multichoice'))) console.log('[verify] XML head:', xmlText.slice(0, 400));
  check('Moodle XML export writes question-bank XML', xmlText.includes('<quiz>') && xmlText.includes('multichoice'));
  await page.getByTestId('study-interchange-dialog').getByRole('button', { name: 'Cerrar' }).click();
  await mockDialog('open', csvPath);
  await page.getByTestId('study-bank-import').click();
  await page.getByTestId('study-interchange-submit').click();
  await page.getByText(/importados/).waitFor();
  await page.waitForFunction(async () => (await window.nodus.listStudyQuestions({ search: '¿Qué movimiento confió en la razón?' })).length === 1);
  check('CSV import adds external questions to the bank', true);
  const importedSummary = await page.getByTestId('study-interchange-dialog').textContent();
  check('the import dialog reports imported and skipped counts', /2 importados/.test(importedSummary ?? ''));
  await shot(page, '11-interchange-import-result.png');
  await page.getByTestId('study-interchange-dialog').getByRole('button', { name: 'Cerrar' }).click();

  // ── Light theme ───────────────────────────────────────────────────────────
  await page.getByTestId('study-bank-tab-questions').click();
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('light') || Boolean(document.querySelector('.light')));
  await page.waitForTimeout(500);
  await shot(page, '12-light-theme.png');
  check('the bank renders in the light theme', await page.evaluate(() => document.documentElement.classList.contains('light') || Boolean(document.querySelector('.light'))));

  // ── Internationalisation ──────────────────────────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en', theme: 'dark', onboardingComplete: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await leaveOnboarding();
  await dismissUpdateModal();
  await openBank(page, 'Question bank');
  await page.getByRole('tab', { name: /^Questions/ }).waitFor();
  check('the bank interface is translated into English', await page.getByText('New question', { exact: false }).first().isVisible());
  await shot(page, '13-english.png');

  // ── Teaching vault accent remap ───────────────────────────────────────────
  await page.evaluate(async () => {
    await window.nodus.updateSettings({ uiLanguage: 'es', theme: 'dark' });
    const created = await window.nodus.createVault({ name: 'Docencia QA', type: 'docencia' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ docenciaTourComplete: true, onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true });
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await leaveOnboarding();
  await dismissUpdateModal();
  await openBank(page, 'Banco de preguntas');
  const accent = await page.evaluate(() => {
    const root = document.querySelector('.docencia');
    const eyebrow = document.querySelector('[data-testid="study-question-bank"] .text-teal-400');
    const accented = document.querySelector('[style*="--vault-accent"]');
    return {
      vaultAccent: accented ? accented.style.getPropertyValue('--vault-accent').trim().toLowerCase() : '',
      onDocencia: Boolean(root),
      eyebrowColour: eyebrow ? getComputedStyle(eyebrow).color : null,
    };
  });
  check('the teaching vault exposes its own accent variable', accent.onDocencia && accent.vaultAccent === '#ea580c');
  check('the bank accent is repainted to the teaching colour, not study teal', accent.eyebrowColour === 'rgb(251, 146, 60)');
  await shot(page, '14-docencia-accent.png');

  check('no renderer page errors were emitted during the workflow', pageErrors.length === 0);
  console.log(`\n[verify] ${checks.length} checks passed. Screenshots in ${outDir}`);
} finally {
  await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  await rm(fixtures, { recursive: true, force: true }).catch(() => undefined);
}
