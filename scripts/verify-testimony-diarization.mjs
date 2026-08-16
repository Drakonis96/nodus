// La detección de hablantes CONTRA LA APLICACIÓN REAL, con el modelo de verdad.
//
// Las pruebas unitarias miden el algoritmo sobre una salida capturada. Esto mide lo otro:
// que el modelo se descarga en el renderer, que el audio de la demo se decodifica, que la
// propuesta llega a la pantalla y que aplicarla escribe las etiquetas en la base.
//
// Necesita red la primera vez (descarga ~6 MB de pyannote) y por eso vive fuera de
// `npm test`:  npm run verify:testimony-diarization

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-diarization-verify')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [
    path.join(repoRoot, 'scripts/verify-testimony-diarization.mjs'), '--electron-diarization-verify',
  ], { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const { _electron: electron } = require(path.join(repoRoot, 'node_modules/playwright-core/index.js'));
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-diarization-verify-'));
const appVersion = require(path.join(repoRoot, 'package.json')).version;
let app = null;

try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(180_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);

  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Diarización', type: 'testimonios' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 99,
      mascotStyleChosen: true, mascotEnabled: false, testimonyTourComplete: true,
    });
    await window.nodus.seedTestimonyDemoData();
  });

  // ── La detección POR LA PANTALLA, que es como la usa una persona ──────────
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);
  await page.getByTestId('testimony-sidebar').getByRole('button', { name: 'Entrevistas', exact: true }).click();
  await page.getByTestId('testimony-row-INT-0001').click();
  await page.getByTestId('testimony-tab-sessions').click();
  await page.getByTestId('testimony-version-reviewed').click();
  await page.getByTestId('testimony-speaker-detection').waitFor();

  const before = await page.evaluate(async () => {
    const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
    const carmen = rows.find((row) => /Carmen/.test(row.title));
    const sessions = await window.nodus.listTestimonySessions(carmen.id);
    const media = sessions[0].media[0];
    const reviewed = media.transcripts.find((transcript) => transcript.kind === 'reviewed');
    const segments = await window.nodus.listTestimonySegments(reviewed.id);
    return { transcriptId: reviewed.id, duration: media.durationSeconds, segments: segments.length };
  });

  await page.getByTestId('testimony-detect-speakers').click();
  // La primera vez baja el modelo: se le da tiempo de verdad.
  await page.getByTestId('testimony-detection-result').waitFor({ timeout: 300_000 });
  const panel = await page.getByTestId('testimony-detection-result').innerText();
  const voices = await page.locator('[data-testid^="testimony-voice-"]').count();
  const impact = await page.getByTestId('testimony-detection-impact').innerText();
  await page.getByTestId('testimony-apply-speakers').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="testimony-detection-result"]'), { timeout: 60_000 });

  const detected = await page.evaluate(async (transcriptId) => {
    const segments = await window.nodus.listTestimonySegments(transcriptId);
    const labels = await window.nodus.testimonySpeakerLabels(transcriptId);
    return {
      labels: labels.map((entry) => ({ label: entry.label, segments: entry.segments })),
      perSegment: segments.map((segment) => ({ start: segment.tStart, label: segment.speakerLabel })),
    };
  }, before.transcriptId);
  detected.voices = voices;
  detected.duration = before.duration;
  detected.turns = detected.perSegment.length;
  detected.speechSeconds = 0;
  detected.progressSeen = 1;
  detected.applied = { changed: detected.perSegment.filter((segment) => segment.label).length, skipped: 0 };
  console.log(`[diarización] panel: ${panel.split('\n')[0]}`);
  console.log(`[diarización] impacto: ${impact}`);

  console.log(`[diarización] ${detected.duration}s de audio · ${detected.voices} voces · ${detected.turns} turnos · ${detected.speechSeconds}s de habla`);
  console.log(`[diarización] aplicadas ${detected.applied.changed} etiquetas (${detected.applied.skipped} sin proponer)`);
  for (const entry of detected.labels) console.log(`[diarización]   ${entry.label ?? 'sin etiqueta'}: ${entry.segments} tramos`);

  assert.equal(detected.voices, 2, 'la entrevista de Carmen tiene dos voces');
  assert.ok(detected.turns >= 4, 'y al menos cuatro tramos etiquetados');
  assert.equal(detected.applied.changed, detected.perSegment.length, 'todos los tramos reciben etiqueta');
  assert.match(panel, /voces distintas/, 'el panel dice cuántas voces encontró');

  // La prueba de fuego: el turno del entrevistador tiene que salir con OTRA voz que los de
  // la narradora. Si saliera igual, la detección estaría diciendo que habla una sola persona.
  const interviewerTurn = detected.perSegment.find((segment) => segment.start > 27 && segment.start < 29);
  const narratorTurn = detected.perSegment.find((segment) => segment.start > 3 && segment.start < 5);
  assert.ok(interviewerTurn && narratorTurn, 'los dos tramos de referencia existen');
  assert.notEqual(interviewerTurn.label, narratorTurn.label,
    `el entrevistador y la narradora salieron con la misma voz (${interviewerTurn.label})`);

  console.log('Testimony diarization verification passed!');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
