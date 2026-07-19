import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('feedback offers a structured new-vault collaboration request', async () => {
  const feedback = await read('src/views/FeedbackModal.tsx');
  assert.match(feedback, /type FeedbackKind = 'feature' \| 'bug' \| 'vault'/);
  assert.match(feedback, /data-testid="feedback-new-vault-type"/);
  for (const area of ['Periodismo', 'Ciencias de la salud', 'Ciencias experimentales', 'Psicología y psiquiatría', 'Jurídico', 'Política', 'Economía y finanzas', 'Ingeniería']) {
    assert.ok(feedback.includes(`'${area}'`), `${area} is suggested`);
  }
  assert.match(feedback, /Puedo probar activamente este vault/);
  assert.match(feedback, /Soy especialista o profesional del área/);
  assert.match(feedback, /Organización y estructura del vault/);
  assert.match(feedback, /Beneficios y casos de uso/);
  assert.match(feedback, /modelos locales del usuario/);
  assert.match(feedback, /placeholders que la IA no verá/);
  assert.match(feedback, /\[Vault type\]/);
});

test('roadmap follows the requested sequence and is opened from the header', async () => {
  const [roadmap, roadmapSource, app, english] = await Promise.all([
    read('src/views/RoadmapModal.tsx'),
    read('shared/nodiDocumentation.ts'),
    read('src/App.tsx'),
    read('src/i18n.en.ts'),
  ]);
  const steps = [
    'Pulido y estabilidad',
    'Vault de docencia',
    'Vault de fuentes primarias',
    'Vault de testimonios (historia oral)',
    'Vault de worldbuilding',
    'Servidor',
    'Compartir vaults y trabajo colaborativo',
    'Nodus PDF Presenter',
    'Nodus OCR Workspace',
    'Otros vaults sugeridos por usuarios',
  ];
  let previous = -1;
  for (const step of steps) {
    const current = roadmapSource.indexOf(`title: '${step}'`);
    assert.ok(current > previous, `${step} follows the requested order`);
    previous = current;
  }
  assert.doesNotMatch(roadmapSource, /title: 'Nodus Toolkit'/, 'the shipped Toolkit is no longer presented as future work');
  assert.match(roadmapSource, /Nodus Convert y Nodus Protect ya están disponibles/, 'current Toolkit availability is documented');
  for (const description of [
    'Handy local-first tools for file conversion and document processing, built into Nodus.',
    'Present PDFs with presenter view, mobile remote control, speaker notes, and live annotation tools.',
    'AI-powered OCR for scanned PDFs and images, with page-by-page review, text cleanup, reprocessing, and direct integration with your Nodus vaults.',
  ]) {
    assert.ok(english.includes(description), `English roadmap copy is preserved: ${description}`);
  }
  assert.match(roadmap, /NODUS_ROADMAP\.map/);
  assert.match(app, /import \{ RoadmapModal \}/);
  assert.match(app, /roadmapOpen && <RoadmapModal/);
  const roadmapAction = app.lastIndexOf(`label={t('Roadmap')}`);
  const settingsAction = app.lastIndexOf(`label={t('Ajustes')}`);
  assert.ok(roadmapAction > 0 && settingsAction > roadmapAction, 'Settings is the rightmost action after Roadmap');
  assert.match(app.slice(settingsAction, settingsAction + 220), /setView\('settings'\)/);
});
