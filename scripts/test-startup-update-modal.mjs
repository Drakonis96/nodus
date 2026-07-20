import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [modal, app, main, styles, translations] = await Promise.all([
  readFile(path.join(root, 'src/components/StartupUpdateModal.tsx'), 'utf8'),
  readFile(path.join(root, 'src/App.tsx'), 'utf8'),
  readFile(path.join(root, 'electron/main.ts'), 'utf8'),
  readFile(path.join(root, 'src/index.css'), 'utf8'),
  readFile(path.join(root, 'src/i18n.en.ts'), 'utf8'),
]);

test('the app performs one visible update check per launch after the update guides settle', () => {
  assert.match(app, /whatsNewSettled && toolkitBetaTourSettled && !manualWhatsNewOpen && <StartupUpdateModal[\s\S]*?\/>/);
  assert.match(app, /<WhatsNewModal[\s\S]*onSettled=\{\(\) => setWhatsNewSettled\(true\)\}/);
  // The one-time Nodi choice queues behind this modal, so a launch that never shows it
  // must still settle or that modal would wait forever.
  assert.match(modal, /if \(!shouldShow\) onSettled\?\.\(\);/);
  assert.match(modal, /sessionStorage\.getItem\(SESSION_KEY\)/);
  assert.match(modal, /sessionStorage\.setItem\(SESSION_KEY, '1'\)/);
  assert.match(modal, /window\.nodus\.checkForUpdates\(\)/);
  assert.match(modal, /window\.nodus\.onUpdateProgress/);
  assert.match(main, /renderer's cinematic startup modal performs the immediate check/);
  assert.doesNotMatch(main, /checkForUpdates\('startup'\)/);
});

test('the cinematic modal distinguishes current, available, progress and failure states', () => {
  for (const status of ['not-available', 'available', 'downloading', 'downloaded', 'installing', 'error', 'disabled', 'checking']) {
    assert.match(modal, new RegExp(`case '${status}'`));
  }
  assert.match(modal, /Ya tienes la última versión/);
  assert.match(modal, /Nueva actualización disponible/);
  assert.match(modal, /data-update-status=\{update\.status\}/);
  assert.match(modal, /data-testid="startup-update-progress"/);
  assert.match(modal, /window\.nodus\.installUpdate\(\)/);
  assert.match(styles, /\.startup-update-backdrop/);
  assert.match(styles, /\.light \.startup-update-cinema/);
  assert.match(styles, /\.startup-update-status-success/);
  assert.match(styles, /\.startup-update-status-available/);
  assert.match(translations, /'Ya tienes la última versión': 'You already have the latest version'/);
  assert.match(translations, /'Nueva actualización disponible': 'New update available'/);
});
