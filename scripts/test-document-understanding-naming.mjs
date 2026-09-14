// One name for one feature.
//
// The document-profile pipeline used to be titled two ways depending on the surface:
// "Índice documental" (Documentary Index) on the library button, the work-status row,
// the campaign manager, the progress bar and the queue tasks, but "Comprensión
// documental" (Document understanding) on the per-work profile modal and the Settings
// section. A reader who hit both concluded they were two different features — the
// confusion that produced the bug report this change answers.
//
// This pins the single label so a future screen cannot quietly reintroduce the split.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const UNIFIED = /t\('Índice documental'\)/;
const RETIRED = /t\('Comprensión documental'\)/;

/** Every renderer surface that titles the document-profile feature. */
const SURFACES = [
  'src/views/Library.tsx',
  'src/views/WorkStatusModal.tsx',
  'src/views/DocumentIndexManager.tsx',
  'src/views/DocumentProfileModal.tsx',
  'src/views/Settings.tsx',
  'src/components/DocumentIndexProgressBar.tsx',
  'src/components/AdditionalQueueTasks.tsx',
];

test('every document-profile surface uses the same label', () => {
  for (const file of SURFACES) {
    const source = read(file);
    assert.match(source, UNIFIED, `${file} must label the feature "Índice documental"`);
    assert.doesNotMatch(source, RETIRED, `${file} still uses the retired "Comprensión documental" label`);
  }
});

test('the per-work profile modal titles itself with the unified label', () => {
  const modal = read('src/views/DocumentProfileModal.tsx');
  assert.match(modal, /aria-label=\{t\('Índice documental'\)\}/);
  assert.match(modal, /<h2[^>]*>\{t\('Índice documental'\)\}<\/h2>/);
});

test('the isolated documentary-index verification opens the modal by the unified name', () => {
  const verify = read('scripts/verify-documentary-index-button-isolated.mjs');
  assert.match(verify, /getByRole\('dialog', \{ name: 'Índice documental' \}\)/);
  assert.doesNotMatch(verify, /name: 'Comprensión documental'/);
});
