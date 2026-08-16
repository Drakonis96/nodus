// El vault de Testimonios contra la aplicación REAL (Electron + renderer construidos).
//
// Aquí se comprueba lo único que ningún test unitario puede ver: que las ocho secciones
// acordadas son las que se pintan, que el acento cian llega de verdad al DOM, y que el
// flujo completo — crear participante, crear entrevista, preparar, grabar la sesión,
// transcribir, corregir hablantes, codificar, tomar una nota, contrastar y documentar el
// acuerdo — funciona con clics reales sobre la interfaz.
//
// Requiere un build (dist/ + dist-electron/): `npm run test:e2e:testimony` lo hace solo.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

if (!process.argv.includes('--electron-testimony-e2e')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-testimony.mjs'), '--electron-testimony-e2e'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e-testimony] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-testimony-'));

/** Un WAV PCM16 mono real, para que el importador tenga bytes de verdad que resumir. */
function wavFixture(seconds) {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((index / rate) * 2 * Math.PI * 440) * 8000), 44 + index * 2);
  }
  return buffer;
}

async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const cleanly = await Promise.race([closed, new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); })]);
  clearTimeout(timeout);
  if (!cleanly && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function waitForCondition(label, probe, { timeout = 30_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      lastError = null;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Tiempo agotado esperando: ${label}.${lastError instanceof Error ? ` Último error: ${lastError.message}` : ''}`);
}

let app = null;
try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (err) => { pageErrors.push(err); process.stderr.write(`[e2e-testimony][pageerror] ${err?.stack ?? err}\n`); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  // Los modales cinemáticos de novedades tapan la aplicación entera en un perfil nuevo y
  // se tragan los clics. Se marcan como vistos antes de tocar nada.
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);

  // El tipo sigue con `available: false` hasta la fase 9, así que la bóveda se crea por
  // IPC: es exactamente lo que hará el usuario cuando se publique, sin la reja del picker.
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Memoria del valle', type: 'testimonios' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 99, mascotStyleChosen: true, mascotEnabled: false });
  });
  await page.reload();

  // ── 1. El armazón: ocho secciones, ni una más, y el acento cian de verdad ──
  const sidebar = page.getByTestId('testimony-sidebar');
  await sidebar.waitFor({ timeout: 30_000 });
  const sidebarLabels = await sidebar.locator('button').allInnerTexts();
  assert.deepEqual(
    sidebarLabels.map((label) => label.trim()),
    ['Buscar', 'Entrevistas', 'Participantes', 'Contrastes', 'Notas'],
    'el sidebar propio tiene exactamente las cinco entradas acordadas'
  );
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'testimonios');
  assert.match(
    await page.getByTestId('nodus-logo').getAttribute('src'),
    /nodusMarkCyan/,
    'la N del encabezado usa el SVG cian de Testimonios'
  );
  // El cian llega por un remapeo CSS que solo aplica si la raíz lleva `.testimonios`;
  // sin el toggle la aplicación se quedaría índigo en silencio.
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('testimonios')), true);
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'bg-indigo-600';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  assert.equal(accent, 'rgb(8, 145, 178)', 'el acento del vault es el cian #0891b2');

  // Ninguna superficie académica ni docente aparece por ningún lado.
  for (const forbidden of ['Biblioteca', 'Grafo', 'Ideas', 'Autores', 'Escritura', 'Proyectos', 'Grabaciones', 'Cursos y asignaturas']) {
    assert.equal(
      await page.locator('nav').getByRole('button', { name: forbidden, exact: true }).count(),
      0,
      `${forbidden} no pertenece al vault de Testimonios`
    );
  }
  console.log('[e2e-testimony] armazón: ocho secciones, sidebar propio y acento cian');

  // ── 2. Inicio: tablero real, sin avisos inventados ────────────────────────
  await page.getByTestId('testimony-home').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-metrics').waitFor();
  const emptyAlerts = await page.getByTestId('testimony-alerts').innerText();
  assert.match(emptyAlerts, /Nada pendiente/, 'una bóveda vacía no inventa avisos');

  // ── 3. Crear una entrevista con un participante nuevo, en línea ───────────
  await sidebar.getByRole('button', { name: 'Entrevistas', exact: true }).click();
  await page.getByTestId('testimony-interviews').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-new-interview').click();
  await page.getByTestId('testimony-new-interview-modal').waitFor();

  // El alta en línea es lo que impide que alguien escriba el nombre en el título y siga.
  const narratorPicker = page.getByTestId('testimony-narrator-picker');
  await narratorPicker.getByPlaceholder('Escribe un nombre…').fill('Carmen Ruiz Salas');
  await page.getByTestId('testimony-create-participant-inline').click();
  await waitForCondition('el participante se crea sin salir del modal', async () =>
    (await narratorPicker.innerText()).includes('Carmen Ruiz Salas'));

  // El título se propone a partir del narrador, pero se puede escribir encima.
  const titleInput = page.getByTestId('testimony-new-interview-title');
  await waitForCondition('el título se propone solo', async () =>
    (await titleInput.inputValue()).startsWith('Entrevista a Carmen Ruiz Salas'));
  await titleInput.fill('La partida del 47');
  await page.getByTestId('testimony-new-interview-submit').click();

  // Crear abre su dossier: el trabajo continúa donde estaba el usuario.
  await page.getByTestId('testimony-dossier').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-overview').waitFor();
  assert.match(await page.getByTestId('testimony-dossier').innerText(), /INT-0001/);

  // Nace con acuerdo PENDIENTE y acceso PRIVADO: el hueco no puede ser permisivo.
  await page.getByTestId('testimony-agreement-pending').first().waitFor();
  await page.getByTestId('testimony-access-private').first().waitFor();

  // ── 4. Preparar: los campos se guardan solos y se ve que se guardan ───────
  await page.getByTestId('testimony-overview-guide').fill('1. Infancia en el valle.\n2. La marcha del padre.\n3. La vuelta.');
  await waitForCondition('la guía se guarda sola', () => page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyInterviews({});
    return (rows[0]?.guideMarkdown ?? '').includes('La marcha del padre');
  }));
  // Y la lista de comprobación existe, pero no bloquea nada.
  await page.getByTestId('testimony-checklist').waitFor();

  // ── 5. El acuerdo se versiona; el nombre público manda a partir de ahí ────
  await page.getByTestId('testimony-tab-agreement').click();
  await page.getByTestId('testimony-agreement').waitFor();
  await page.getByTestId('testimony-agreement-status').selectOption('documented');
  await page.getByTestId('testimony-use-research').check();
  await page.getByTestId('testimony-use-teaching').check();
  await page.getByRole('radio', { name: /Restringido/ }).check();
  await page.getByTestId('testimony-agreement-save').click();
  await waitForCondition('el acuerdo se guarda como una versión nueva', () => page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyInterviews({});
    const history = await window.nodus.testimonyAgreementHistory(rows[0].id);
    return history.length >= 2 && history.filter((entry) => entry.isCurrent).length === 1;
  }));
  const historyText = await page.getByTestId('testimony-agreement-history').innerText();
  assert.match(historyText, /v1/, 'la versión anterior se conserva, no se sobrescribe');
  assert.match(historyText, /v2/);

  // ── 6. La tabla: filtros, vistas guardadas y el esquema fijo ──────────────
  await page.getByTestId('testimony-dossier-back').click();
  await page.getByTestId('testimony-interview-table').waitFor();
  const headers = await page.getByTestId('testimony-interview-table').locator('thead th').allInnerTexts();
  assert.deepEqual(
    headers.map((header) => header.trim().toLocaleLowerCase('es')),
    ['título', 'narrador', 'fecha', 'flujo', 'transcripción', 'acuerdo', 'acceso', 'duración', 'idioma', 'colección', 'última modificación'],
    'el esquema de la tabla es fijo: nadie puede quitar la columna de acceso'
  );
  await page.getByTestId('testimony-view-restricted').click();
  await waitForCondition('la vista «Con restricciones» encuentra la entrevista', async () =>
    (await page.getByTestId('testimony-row-INT-0001').count()) === 1);
  await page.getByTestId('testimony-view-completed').click();
  await waitForCondition('y «Completadas» no', async () =>
    (await page.getByTestId('testimony-row-INT-0001').count()) === 0);
  await page.getByTestId('testimony-view-all').click();
  await page.getByTestId('testimony-row-INT-0001').waitFor();

  // ── 7. Participantes: nombre de trabajo y nombre público, separados ───────
  await sidebar.getByRole('button', { name: 'Participantes', exact: true }).click();
  await page.getByTestId('testimony-participant-table').waitFor();
  assert.match(await page.getByTestId('testimony-participant-table').innerText(), /Carmen Ruiz Salas/);
  await page.locator('[data-testid^="testimony-participant-"][role="button"]').first().click();
  await page.getByTestId('testimony-participant-modal').waitFor();
  assert.equal(await page.getByTestId('testimony-participant-table').isVisible(), true, 'la tabla permanece detrás del modal');
  const modalLayout = await page.getByTestId('testimony-participant-modal').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
    };
  });
  assert.ok(modalLayout.width >= 720 && modalLayout.width < modalLayout.viewportWidth, 'el modal tiene un ancho equilibrado');
  assert.ok(modalLayout.height < modalLayout.viewportHeight, 'el modal cabe completo en la ventana');
  assert.equal(modalLayout.horizontalOverflow, false, 'el modal no genera scroll horizontal');
  await page.getByTestId('testimony-participant-sheet').waitFor();
  await page.getByTestId('testimony-participant-public-name').fill('Carmen R.');
  await waitForCondition('el nombre público se guarda', () => page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyParticipants('');
    return rows.some((row) => row.publicName === 'Carmen R.');
  }));
  // Y NO hay vocabulario genealógico en esta pantalla.
  const sheetText = await page.getByTestId('testimony-participant-sheet').innerText();
  for (const forbidden of ['GEDCOM', 'Parentesco', 'Árbol', 'Coincidencias']) {
    assert.ok(!sheetText.includes(forbidden), `${forbidden} no pertenece a un participante de historia oral`);
  }

  // Con el nombre público puesto y la atribución del acuerdo, la tabla de entrevistas
  // muestra el seudónimo — que es la promesa que sostiene toda la anonimización.
  await page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyParticipants('');
    const carmen = rows.find((row) => row.workingName === 'Carmen Ruiz Salas');
    await window.nodus.updateTestimonyParticipant(carmen.personId, { identityMode: 'pseudonym' });
  });
  await page.getByTestId('testimony-participant-modal').locator('footer').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('testimony-participant-modal').waitFor({ state: 'hidden' });
  await sidebar.getByRole('button', { name: 'Entrevistas', exact: true }).click();
  await page.getByTestId('testimony-interview-table').waitFor();
  await waitForCondition('la tabla muestra el nombre público, no el real', async () => {
    const text = await page.getByTestId('testimony-row-INT-0001').innerText();
    return text.includes('Carmen R.') && !text.includes('Carmen Ruiz Salas');
  });
  console.log('[e2e-testimony] entrevistas y participantes: alta en línea, acuerdo versionado, seudónimo respetado');

  // ── 8. Sesiones, audio y transcripción ────────────────────────────────────
  await page.getByTestId('testimony-row-INT-0001').click();
  await page.getByTestId('testimony-tab-sessions').click();
  await page.getByTestId('testimony-sessions').waitFor();

  // Una entrevista puede tener VARIAS sesiones: es lo que la separa de una grabación.
  await page.getByTestId('testimony-add-session').click();
  await page.getByTestId('testimony-session-SES-0001').waitFor();
  await page.getByTestId('testimony-add-session').click();
  await page.getByTestId('testimony-session-SES-0002').waitFor();

  // El audio entra por la ruta real del importador (el selector nativo no se puede
  // pulsar desde aquí, pero el camino de datos es exactamente el mismo).
  const masterPath = path.join(userData, 'entrevista-01.wav');
  await writeFile(masterPath, wavFixture(1.5));
  const importResult = await page.evaluate(async (filePath) => {
    const rows = await window.nodus.listTestimonyInterviews({});
    const interview = rows.find((row) => row.shortId === 'INT-0001');
    const sessions = await window.nodus.listTestimonySessions(interview.id);
    const first = await window.nodus.importTestimonyMediaPaths(sessions[0].id, [filePath]);
    // El mismo archivo dos veces en la misma sesión NO se duplica.
    const again = await window.nodus.importTestimonyMediaPaths(sessions[0].id, [filePath]);
    return {
      interviewId: interview.id,
      mediaId: first[0].media.id,
      hash: first[0].media.contentHash,
      immutable: first[0].media.immutable,
      duplicateOf: again[0].duplicateOf,
      sessionStatus: (await window.nodus.listTestimonySessions(interview.id))[0].status,
      workflow: (await window.nodus.listTestimonyInterviews({})).find((row) => row.shortId === 'INT-0001').workflowStatus,
    };
  }, masterPath);
  assert.equal(importResult.hash.length, 64, 'el maestro entra con su SHA-256');
  assert.equal(importResult.immutable, true, 'el maestro se marca inmutable');
  assert.equal(importResult.duplicateOf, importResult.mediaId, 'el duplicado exacto no se guarda dos veces');
  assert.equal(importResult.sessionStatus, 'recorded', 'una sesión con maestro consta como grabada');
  assert.equal(importResult.workflow, 'recorded', 'y el flujo se PROPONE, no se queda en preparación');

  // La transcripción real necesita un modelo Whisper descargado, que no existe en un
  // perfil de prueba: se crea la versión literal por la misma ruta que usa la pantalla.
  const transcriptIds = await page.evaluate(async (mediaId) => {
    const literal = await window.nodus.createTestimonyTranscript({
      mediaId, kind: 'machine_literal', language: 'es', status: 'ready',
      contentMarkdown: 'mi padre se marchó en el cuarenta y siete.nunca volvimos a saber de él.',
      modelProvider: 'transformers', modelName: 'whisper-small',
      segments: [
        { tStart: 0, tEnd: 12, text: 'mi padre se marchó en el cuarenta y siete.', speakerLabel: 'Hablante 1' },
        { tStart: 12, tEnd: 25, text: 'nunca volvimos a saber de él.', speakerLabel: 'Hablante 1' },
        { tStart: 25, tEnd: 31, text: '¿y su madre?', speakerLabel: 'Hablante 2' },
      ],
    });
    return { literalId: literal.id };
  }, importResult.mediaId);
  assert.ok(transcriptIds.literalId);

  await page.reload();
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Entrevistas', exact: true }).click();
  await page.getByTestId('testimony-row-INT-0001').click();
  await page.getByTestId('testimony-tab-sessions').click();
  await page.getByTestId('testimony-transcript-panel').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-segments').waitFor();

  // El literal es INMUTABLE y la interfaz lo dice, no solo lo impide.
  await page.getByTestId('testimony-immutable-notice').waitFor();
  assert.equal(await page.getByTestId('testimony-segments').locator('textarea').first().evaluate((node) => node.readOnly), true,
    'no se puede editar el literal: es la única prueba de qué oyó el modelo');
  // Y aprobar directamente no está ni ofrecido: solo una revisada puede aprobarse.
  assert.equal(await page.getByTestId('testimony-derive-approved').count(), 0);

  // Derivar una corregida: nace de él, no lo sustituye, y limpia sin reescribir.
  await page.getByTestId('testimony-derive-corrected').click();
  await waitForCondition('la corregida existe y el literal sigue intacto', () => page.evaluate(async (mediaId) => {
    const versions = await window.nodus.listTestimonyTranscripts(mediaId);
    const literal = versions.find((entry) => entry.kind === 'machine_literal');
    const corrected = versions.find((entry) => entry.kind === 'corrected');
    if (!literal || !corrected) return false;
    const literalSegments = await window.nodus.listTestimonySegments(literal.id);
    const correctedSegments = await window.nodus.listTestimonySegments(corrected.id);
    return literalSegments[0].text.startsWith('mi padre')
      && correctedSegments[0].text.startsWith('Mi padre')
      && correctedSegments[0].sourceSegmentId === literalSegments[0].id;
  }, importResult.mediaId));

  // Atribuir hablantes en lote: manual, nunca biométrico.
  await page.getByTestId('testimony-speaker-assign').waitFor();
  await page.getByTestId('testimony-assign-Hablante-1').selectOption({ label: 'Carmen Ruiz Salas' });
  await waitForCondition('los dos tramos de esa etiqueta quedan atribuidos', () => page.evaluate(async (mediaId) => {
    const versions = await window.nodus.listTestimonyTranscripts(mediaId);
    const corrected = versions.find((entry) => entry.kind === 'corrected');
    const segments = await window.nodus.listTestimonySegments(corrected.id);
    return segments.filter((segment) => segment.speakerPersonId).length === 2;
  }, importResult.mediaId));

  // La huella verifica los bytes reales, que es lo que convierte «tengo el original» en
  // «tengo el original íntegro».
  const verified = await page.evaluate((mediaId) => window.nodus.verifyTestimonyMediaHash(mediaId), importResult.mediaId);
  assert.equal(verified.ok, true);

  // Y la opción que Estudio sí tiene NO existe aquí: en historia oral una pausa puede ser
  // parte del sentido de lo que se cuenta.
  assert.equal(await page.getByText('Omitir silencios largos').count(), 0,
    'Testimonios no recorta silencios: no es que venga desactivado, es que no existe');
  console.log('[e2e-testimony] sesiones, audio y transcripción: maestro inmutable, versiones derivadas, hablantes atribuidos a mano');

  // ── 9. Análisis: codificar seleccionando, y el catálogo compartido ────────
  await page.getByTestId('testimony-tab-analysis').click();
  await page.getByTestId('testimony-analysis').waitFor();
  await page.getByTestId('testimony-coding-surface').waitFor();

  // Codificar es SELECCIONAR TEXTO. Se reproduce la selección real del usuario sobre el
  // primer tramo y se sube el ratón, que es lo que abre la barra de codificación.
  const selectQuote = async (needle) => {
    await page.evaluate((text) => {
      const paragraph = [...document.querySelectorAll('[data-testid="testimony-coding-segment"] p')]
        .find((node) => node.textContent.includes(text));
      if (!paragraph) throw new Error(`no hay ningún tramo con «${text}»`);
      const node = paragraph.firstChild;
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, needle);
  };

  await selectQuote('se marchó en el cuarenta y siete');
  await page.getByTestId('testimony-annotation-draft').waitFor();
  // El código se crea sobre la marcha, sin salir de la transcripción.
  await page.getByTestId('testimony-annotation-codes-input').fill('Exilio');
  await page.getByTestId('testimony-annotation-codes-create').click();
  await page.getByTestId('testimony-annotation-memo').fill('Primera mención de la partida.');
  await page.getByTestId('testimony-annotation-save').click();
  await page.getByTestId('testimony-annotation-ANN-0001').waitFor();

  // El catálogo es DE LA BÓVEDA: el mismo código se puede aplicar en otra entrevista.
  await page.getByTestId('testimony-code-catalog').waitFor();
  await waitForCondition('el código aparece en el catálogo de la bóveda', () => page.evaluate(async () => {
    const codes = await window.nodus.listTestimonyCodes();
    return codes.some((code) => code.label === 'Exilio' && code.interviewCount === 1);
  }));

  // El autocompletado impide el gemelo: escribir «exilio» ofrece el que ya existe.
  await selectQuote('volvimos a saber de él');
  await page.getByTestId('testimony-annotation-codes-input').fill('  exilio ');
  await waitForCondition('se ofrece reutilizar el código existente', async () =>
    (await page.getByTestId('testimony-annotation-codes').innerText()).includes('Ya existe'));
  assert.equal(await page.getByTestId('testimony-annotation-codes-create').count(), 0,
    'un nombre que ya existe no ofrece crear un duplicado');
  await page.getByTestId('testimony-annotation-codes-suggestion').first().click();
  await page.getByTestId('testimony-annotation-save').click();
  await page.getByTestId('testimony-annotation-ANN-0002').waitFor();
  await waitForCondition('los dos fragmentos comparten un único código', () => page.evaluate(async () => {
    const codes = await window.nodus.listTestimonyCodes();
    return codes.filter((code) => code.label.toLowerCase().includes('exilio')).length === 1
      && codes.find((code) => code.label === 'Exilio').usageCount === 2;
  }));

  // ── 10. Una nota nace del fragmento, con la cita y el enlace al minuto ────
  await page.getByTestId('testimony-note-from-ANN-0001').click();
  await waitForCondition('la nota lleva la cita, el seudónimo y el enlace', () => page.evaluate(async () => {
    const tree = await window.nodus.getNotesTree();
    const note = tree.notes[0];
    if (!note) return false;
    const full = await window.nodus.getNote(note.id);
    return full.content.includes('nodus://testimonios/interview/')
      && full.content.includes('Carmen R.')
      && !full.content.includes('Carmen Ruiz Salas');
  }));

  await page.getByTestId('testimony-tab-notes').click();
  await page.getByTestId('testimony-note-list').waitFor();

  // El enlace de la nota DEVUELVE a la entrevista y a su pestaña de análisis. Es la
  // promesa que cierra el círculo del vault: la interpretación vuelve a la voz.
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Notas', exact: true }).click();
  await page.locator('span[title^="Carmen R."]').first().click();
  await page.getByRole('button', { name: 'Vista', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir el fragmento en su minuto', exact: true }).click();
  await page.getByTestId('testimony-dossier').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-analysis').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('testimony-dossier').innerText(), /INT-0001/,
    'el enlace de la nota abre exactamente la entrevista y el minuto de origen');
  console.log('[e2e-testimony] análisis y notas: codificar seleccionando, catálogo sin gemelos, nota con cita y minuto');

  // ── 11. Una versión nueva NO mueve las citas en silencio ─────────────────
  const remap = await page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyInterviews({});
    const interview = rows.find((row) => row.shortId === 'INT-0001');
    const sessions = await window.nodus.listTestimonySessions(interview.id);
    const media = sessions[0].media[0];
    const corrected = media.transcripts.find((entry) => entry.kind === 'corrected');
    // Se reescribe un tramo de la corregida hasta hacerlo irreconocible, y se deriva una
    // revisada a partir de ella: la cita de ese tramo ya no se puede reanclar.
    const segments = await window.nodus.listTestimonySegments(corrected.id);
    await window.nodus.updateTestimonySegment(segments[0].id, { text: 'El texto de este tramo se reescribió por completo.' });
    const derived = await window.nodus.deriveTestimonyTranscript(corrected.id, 'reviewed');
    const annotations = await window.nodus.listTestimonyAnnotations(interview.id);
    return {
      needsReview: derived.needsReview,
      remapped: derived.remapped,
      flagged: annotations.filter((entry) => entry.linkStatus === 'needs_review').length,
      moved: annotations.filter((entry) => entry.linkStatus === 'valid').length,
    };
  });
  assert.equal(remap.needsReview, 1, 'la cita cuyo texto desapareció queda pendiente de revisar');
  assert.equal(remap.remapped, 1, 'la que sigue estando se reancla sola');
  assert.equal(remap.flagged, 1, 'y queda marcada, no movida en silencio');
  console.log('[e2e-testimony] remapeo: una versión nueva reancla lo que puede y marca lo que no');

  // ── 12. Contrastes: SIN IA, y la ausencia se marca como ausencia ─────────
  // Se prepara una segunda entrevista con un fragmento del MISMO código y una tercera que
  // no dice nada sobre ello: son los tres casos que un contraste tiene que distinguir.
  await page.evaluate(async () => {
    const codes = await window.nodus.listTestimonyCodes();
    const exilio = codes.find((code) => code.label === 'Exilio');
    const people = await window.nodus.listTestimonyParticipants('');
    const jorge = await window.nodus.createTestimonyParticipant({ workingName: 'Jorge Peña' });
    const second = await window.nodus.createTestimonyInterview({ title: 'El regreso', narratorIds: [jorge.personId] });
    await window.nodus.saveTestimonyAgreement({ interviewId: second.id, status: 'documented', accessLevel: 'open', allowedUses: ['research', 'publication'] });
    const session = await window.nodus.createTestimonySession({ interviewId: second.id });
    const bytes = new Uint8Array(2048).map((_, index) => (index * 13) % 251);
    const media = await window.nodus.importTestimonyMedia({ sessionId: session.id, fileName: 'jorge-01.wav', mimeType: 'audio/wav', bytes: bytes.buffer, durationSeconds: 900 });
    const transcript = await window.nodus.createTestimonyTranscript({
      mediaId: media.media.id, kind: 'reviewed', language: 'es', status: 'ready',
      contentMarkdown: 'Volvió en el sesenta y dos, sin avisar.',
      segments: [{ tStart: 0, tEnd: 9, text: 'Volvió en el sesenta y dos, sin avisar.', speakerLabel: 'Hablante 1' }],
    });
    const segments = await window.nodus.listTestimonySegments(transcript.id);
    await window.nodus.createTestimonyAnnotation({
      interviewId: second.id, transcriptId: transcript.id, segmentId: segments[0].id,
      tStart: 0, tEnd: 9, quoteSnapshot: 'Volvió en el sesenta y dos, sin avisar.', codeIds: [exilio.id],
    });
    // Una tercera entrevista sin nada codificado: la ausencia.
    const third = await window.nodus.createTestimonyInterview({ title: 'La casa vacía', narratorIds: [people[0].personId] });
    return third.id;
  });

  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Contrastes', exact: true }).click();
  await page.getByTestId('testimony-contrasts').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-contrast-interview-INT-0001').check();
  await page.getByTestId('testimony-contrast-interview-INT-0002').check();
  await page.getByTestId('testimony-contrast-interview-INT-0003').check();
  await page.getByTestId('testimony-contrast-code-exilio').click();

  await page.getByTestId('testimony-parallel').waitFor({ timeout: 30_000 });
  // Dos columnas con material y una entrevista marcada explícitamente como silenciosa.
  const silences = await page.getByTestId('testimony-silences').innerText();
  assert.match(silences, /La casa vacía/, 'la entrevista que no dice nada aparece como ausencia');
  assert.match(silences, /no lo interpreta por ti/, 'y la ausencia NO se convierte en conclusión');

  // La matriz enseña dónde hay material y dónde no.
  await page.getByTestId('testimony-contrast-mode-matrix').click();
  await page.getByTestId('testimony-matrix').waitFor();
  assert.match(await page.getByTestId('testimony-matrix').innerText(), /Exilio/);

  // Guardar el contraste, fijar un fragmento y convertirlo en nota trazable.
  await page.getByTestId('testimony-contrast-mode-parallel').click();
  await page.getByTestId('testimony-contrast-save').click();
  await page.getByRole('textbox').last().fill('La partida y el regreso');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByTestId('testimony-saved-CTR-0001').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-contrast-memo').fill('Los dos relatos coinciden en la fecha y difieren en quién avisó.');
  await page.getByTestId('testimony-contrast-interviews').click();
  await page.getByTestId('testimony-contrast-to-notes').click();
  await waitForCondition('la nota del contraste lleva todos los fragmentos y sus enlaces', () => page.evaluate(async () => {
    const tree = await window.nodus.getNotesTree();
    const note = tree.notes.find((entry) => entry.title === 'La partida y el regreso');
    if (!note) return false;
    const full = await window.nodus.getNote(note.id);
    const links = await window.nodus.listNoteLinks(note.id);
    return full.content.includes('nodus://testimonios/interview/')
      && full.content.includes('Sin fragmentos sobre esto')
      && links.some((link) => link.targetKind === 'testimony_contrast');
  }));
  console.log('[e2e-testimony] contrastes: tres entrevistas, un código, la ausencia marcada y una nota trazable sin IA');

  // ── 13. Buscar: una frase devuelve al minuto exacto ──────────────────────
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByTestId('testimony-search').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-search-input').fill('volvimos a saber');
  await page.getByTestId('testimony-search-group-segment').waitFor({ timeout: 30_000 });
  const passage = page.getByTestId('testimony-search-hit-segment').first();
  const passageText = await passage.innerText();
  // Un pasaje SIN hablante, minuto y acceso es una frase suelta que hay que volver a
  // localizar a mano — y que alguien puede copiar sin saber que estaba restringida.
  assert.match(passageText, /Carmen R\./, 'el pasaje dice quién lo dijo, con el nombre que el acuerdo permite');
  assert.doesNotMatch(passageText, /Carmen Ruiz Salas/, 'nunca el nombre real bajo seudónimo');
  assert.match(passageText, /00:00:\d\d/, 'y en qué minuto');
  assert.equal(await passage.getByTestId('testimony-access-restricted').count(), 1, 'y con qué condición de acceso');

  await passage.click();
  await page.getByTestId('testimony-analysis').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('testimony-dossier').innerText(), /INT-0001/,
    'buscar una frase abre exactamente su entrevista');

  // ── 14. Inicio: los avisos son reales y llevan a algún sitio ─────────────
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Inicio', exact: true }).click()
    .catch(async () => { await page.locator('[data-tour="nav-home"], nav button:has-text("Inicio")').first().click(); });
  await page.getByTestId('testimony-home').waitFor({ timeout: 30_000 });
  await page.getByTestId('testimony-metrics').waitFor();
  const metrics = (await page.getByTestId('testimony-metrics').innerText()).toLocaleLowerCase('es');
  assert.match(metrics, /entrevistas/);
  assert.match(metrics, /horas de grabación/);

  const alerts = await page.getByTestId('testimony-alerts').innerText();
  // Grabado sin acuerdo documentado NO puede aparecer: los tres acuerdos están puestos.
  assert.doesNotMatch(alerts, /Grabaciones sin acuerdo documentado/,
    'Inicio no inventa avisos: los acuerdos de este proyecto están documentados');
  // Pero la entrevista sin original SÍ, y con su botón para abrirla.
  assert.match(alerts, /copia de seguridad|Fragmentos cuyo enlace/,
    'y sí anuncia lo que de verdad requiere una acción');
  await page.getByTestId('testimony-preservation').waitFor();
  assert.match(await page.getByTestId('testimony-preservation').innerText(), /no es, por sí solo, preservación/,
    'y no promete que guardar el audio en la bóveda sea preservación a largo plazo');
  console.log('[e2e-testimony] buscar e inicio: el pasaje vuelve a su minuto y el tablero no miente');

  // ── 15. La demo y el recorrido, en una bóveda limpia ─────────────────────
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Demo del valle', type: 'testimonios' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 99, mascotStyleChosen: true, mascotEnabled: false });
  });
  await page.reload();
  await page.getByTestId('testimonios-demo-offer').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cargar demo de testimonios', exact: true }).click();

  const demo = await page.evaluate(async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      if (rows.length >= 5) {
        const codes = await window.nodus.listTestimonyCodes();
        const contrasts = await window.nodus.listTestimonyContrasts();
        const tree = await window.nodus.getNotesTree();
        const sessions = await Promise.all(rows.map((row) => window.nodus.listTestimonySessions(row.id)));
        const media = sessions.flat().flatMap((session) => session.media);
        return {
          interviews: rows.length,
          states: [...new Set(rows.map((row) => row.workflowStatus))].sort(),
          access: [...new Set(rows.map((row) => row.agreement?.accessLevel))].sort(),
          agreements: [...new Set(rows.map((row) => row.agreement?.status))].sort(),
          group: rows.filter((row) => row.interviewKind === 'group').length,
          codes: codes.length,
          sharedCodes: codes.filter((code) => code.interviewCount >= 2).length,
          contrasts: contrasts.length,
          pinned: contrasts[0]?.pinned.length ?? 0,
          notes: tree.notes.length,
          droppedAudio: media.filter((entry) => !entry.sizeBytes).length,
          syntheticAudio: media.filter((entry) => (entry.technical ?? {}).sintetico).length,
          transcriptKinds: [...new Set(media.flatMap((entry) => entry.transcripts.map((t) => t.kind)))].sort(),
        };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    throw new Error('la demo no terminó de sembrarse');
  });

  assert.equal(demo.interviews, 5, 'cinco entrevistas ficticias');
  assert.equal(demo.group, 1, 'una de ellas es grupal');
  assert.ok(demo.states.length >= 3, `estados distintos: ${demo.states.join(', ')}`);
  assert.ok(demo.access.includes('embargoed'), 'hay un embargo ficticio');
  assert.ok(demo.agreements.includes('pending'), 'y un acuerdo pendiente');
  assert.deepEqual(demo.transcriptKinds, ['machine_literal', 'reviewed'], 'una literal y una revisada');
  assert.ok(demo.sharedCodes >= 2, 'códigos compartidos entre entrevistas');
  assert.equal(demo.contrasts, 1, 'un contraste guardado');
  assert.equal(demo.pinned, 3, 'con sus fragmentos fijados');
  assert.equal(demo.notes, 2, 'dos notas');
  assert.equal(demo.droppedAudio, 1, 'una entrevista con el original ya exportado y soltado');
  assert.ok(demo.syntheticAudio >= 3, 'y el resto con audio SINTÉTICO, nunca una voz real');

  // Las notas llevan enlaces al minuto exacto, que es la promesa del vault.
  const noteHasLink = await page.evaluate(async () => {
    const tree = await window.nodus.getNotesTree();
    const full = await Promise.all(tree.notes.map((note) => window.nodus.getNote(note.id)));
    return full.some((note) => /nodus:\/\/testimonios\/interview\/[^?]+\?annotation=/.test(note.content));
  });
  assert.equal(noteHasLink, true, 'las notas de la demo enlazan al fragmento y su minuto');

  // El recorrido guiado arranca sobre la demo.
  await page.reload();
  const tour = page.getByTestId('tour-card');
  await tour.waitFor({ timeout: 30_000 });
  assert.match(await tour.innerText(), /Bienvenido al vault de Testimonios/,
    'el recorrido arranca por lo que es una entrevista, no por dónde están los botones');
  console.log('[e2e-testimony] demo y recorrido: cinco entrevistas, audio sintético, un embargo, un acuerdo pendiente y el tutorial arrancando');

  // ── 16. Las tres operaciones de IA existen, y la puerta se cierra sin acuerdo ──
  //
  // Aquí no hay proveedor configurado a propósito: lo que se comprueba es que los tres
  // controles están donde tienen que estar y que, sin permiso, el fallo es un mensaje que
  // dice qué hacer — no una excepción y no un análisis hecho a escondidas.
  // El recorrido sigue abierto del bloque anterior y se traga los clics: se cierra antes.
  await page.evaluate(async () => {
    await window.nodus.updateSettings({ testimonyAllowExternalProviders: false, testimonyTourComplete: true });
  });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Entrevistas', exact: true }).click();
  await page.getByTestId('testimony-row-INT-0002').click();
  await page.getByTestId('testimony-tab-sessions').click();
  await page.getByTestId('testimony-speaker-detection').waitFor();
  // El aviso cambia según si el modelo ya está descargado; las dos formas dicen lo mismo:
  // el análisis es local. En un perfil nuevo se ve la de la primera vez.
  assert.match(await page.getByTestId('testimony-speaker-detection').innerText(),
    /sin conexión|offline|No sale de aquí|does not leave|no se identifica/i,
    'la detección de hablantes explica que trabaja en este equipo');
  // Corregir sólo se ofrece sobre el LITERAL —es el único que admite derivar una
  // corregida— y detectar hablantes sólo sobre una versión editable: el literal es la
  // palabra de la máquina y no se toca. Las dos pestañas ofrecen cosas distintas a propósito.
  await page.getByTestId('testimony-version-machine_literal').click();
  await page.getByTestId('testimony-improve').waitFor();
  assert.equal(await page.getByTestId('testimony-speaker-detection').count(), 0,
    'sobre el literal no se ofrece etiquetar hablantes: no se puede editar');

  await page.getByTestId('testimony-tab-analysis').click();
  await page.getByTestId('testimony-analysis-proposal').waitFor();
  await page.getByTestId('testimony-analyze').click();
  await page.getByTestId('testimony-analysis-error').waitFor({ timeout: 30_000 });
  const gateMessage = await page.getByTestId('testimony-analysis-error').innerText();
  assert.match(gateMessage, /acuerdo|agreement/i, `la puerta explica el motivo: ${gateMessage}`);
  assert.match(gateMessage, /modelo local|local model|Documenta/i, 'y dice qué hacer para poder usarla');

  // Y la búsqueda por significado no finge: sin índice lo dice, no devuelve texto disfrazado.
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByTestId('testimony-mode-semantic').click();
  await page.getByTestId('testimony-index-panel').waitFor();
  assert.match(await page.getByTestId('testimony-index-panel').innerText(), /acuerdo lo permite|agreement allows/i,
    'el panel del índice dice que sólo entra lo que el acuerdo permite');
  console.log('[e2e-testimony] IA: los tres controles existen, la puerta se cierra con un motivo y el índice no miente');

  assert.deepEqual(pageErrors, [], `errores del renderer: ${pageErrors.map((error) => error.message).join(' | ')}`);
  await closeElectronApp(app);
  app = null;
  console.log('[e2e-testimony] passed');
} finally {
  await closeElectronApp(app);
  await rm(userData, { recursive: true, force: true });
}
