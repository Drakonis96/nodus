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
// Since the Research corpus work (PR #932) "indexing" means the searchable text and
// vectors of a document, so the feature is now "Ficha documental" (the name its result
// already carried) and "Índice documental" is retired from these surfaces.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const UNIFIED = /t\('Ficha documental'\)/;
const RETIRED = /t\('(Comprensión documental|Índice documental)'\)/;

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
    assert.match(source, UNIFIED, `${file} must label the feature "Ficha documental"`);
    assert.doesNotMatch(source, RETIRED, `${file} still uses a retired label`);
  }
});

test('the per-work profile modal titles itself with the unified label', () => {
  const modal = read('src/views/DocumentProfileModal.tsx');
  assert.match(modal, /aria-label=\{t\('Ficha documental'\)\}/);
  assert.match(modal, /<h2[^>]*>\{t\('Ficha documental'\)\}<\/h2>/);
});

test('the isolated documentary-index verification opens the modal by the unified name', () => {
  const verify = read('scripts/verify-documentary-index-button-isolated.mjs');
  assert.match(verify, /getByRole\('dialog', \{ name: 'Ficha documental' \}\)/);
  assert.doesNotMatch(verify, /name: 'Comprensión documental'/);
});

test('the work status explains the document record in a balloon that any outside click closes', () => {
  const status = read('src/views/WorkStatusModal.tsx');
  assert.match(status, /\{t\('Ficha documental'\)\}<\/span>\s*<DocumentProfileHelp \/>/, 'a "?" sits beside the name');
  assert.match(status, /useDismissableLayer<HTMLSpanElement>\(\{ open, onDismiss: \(\) => setOpen\(false\)/, 'an outside click or Escape closes it');
  assert.match(status, /aria-label=\{t\('¿Qué es la ficha documental\?'\)\}/);
  assert.match(status, /\{t\('La ficha documental es una lectura completa de la obra:/);
  // The row is the last one in the modal's scrolling body: opening the balloon
  // downward leaves a third of the paragraph behind its container's edge.
  assert.match(status, /className="absolute bottom-full left-0 z-20 mb-1\.5 w-72/, 'the balloon opens upward, clear of the scrolling body');
});
