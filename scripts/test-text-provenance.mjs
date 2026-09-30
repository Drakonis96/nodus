import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = await mkdtemp(path.join(os.tmpdir(), 'text-provenance-'));
test.after(() => rm(dir, { recursive: true, force: true }));
const provenanceBundle = path.join(dir, 'provenance.cjs');
await build({ entryPoints: [path.join(root, 'shared/textProvenance.ts')], outfile: provenanceBundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const { parseTextNotes, isScannedWork } = require(provenanceBundle);
const provenance = (over = {}) => ({ ocrPages: 0, cappedPages: 0, cap: null, blankPages: 0, unresolvedPages: 0, ocrFailed: false, ...over });
const cappedNote = '1000 página(s) recuperadas por OCR. 342 página(s) no procesadas: superan el límite de OCR (1000 páginas por documento).';

test('only explicit extraction notes establish a cap', () => {
  assert.deepEqual(parseTextNotes(`${cappedNote} 2 página(s) sin texto omitidas.`),
    provenance({ ocrPages: 1000, cappedPages: 342, cap: 1000, blankPages: 2 }));
  for (const note of [null, undefined, '', 'Versión limpia de la Biblioteca global.']) {
    assert.deepEqual(parseTextNotes(note), provenance());
  }
});

test('old notes and new uncapped notes never infer a cap from round recovery counts', () => {
  for (const [recovered, missing] of [[1000, 342], [300, 2], [999, 343], [27, 5]]) {
    assert.deepEqual(parseTextNotes(`${recovered} página(s) recuperadas por OCR. ${missing} página(s) sin texto omitidas.`),
      provenance({ ocrPages: recovered, blankPages: missing }));
  }
});

test('aggregated attachments retain missing text without inventing a cap', () => {
  assert.deepEqual(parseTextNotes('150 página(s) recuperadas por OCR. 1 página(s) sin texto omitidas. 150 página(s) recuperadas por OCR. 1 página(s) sin texto omitidas.'),
    provenance({ ocrPages: 300, blankPages: 2 }));
  assert.deepEqual(parseTextNotes(`${cappedNote} 300 página(s) recuperadas por OCR. 2 página(s) sin texto omitidas.`),
    provenance({ ocrPages: 1300, cappedPages: 342, cap: 1000, blankPages: 2 }));
});

test('a common cap is reported only when all explicit capped notes agree', () => {
  assert.deepEqual(parseTextNotes(`${cappedNote} ${cappedNote}`), provenance({ ocrPages: 2000, cappedPages: 684, cap: 1000 }));
  const otherCap = '5 página(s) no procesadas: superan el límite de OCR (300 páginas por documento).';
  const unknownCap = '5 página(s) no procesadas: superan el límite de OCR.';
  for (const note of [otherCap, unknownCap]) {
    assert.deepEqual(parseTextNotes(`${cappedNote} ${note}`), provenance({ ocrPages: 1000, cappedPages: 347 }));
  }
  assert.deepEqual(parseTextNotes(unknownCap), provenance({ cappedPages: 5 }));
});

test('an incomplete OCR batch has unresolved pages, not completed blank results', () => {
  assert.deepEqual(parseTextNotes('1000 página(s) sin texto recuperado. OCR no completado.'),
    provenance({ unresolvedPages: 1000, ocrFailed: true }));
  assert.deepEqual(parseTextNotes('2 página(s) sin texto recuperado: OCR desactivado.'), provenance({ unresolvedPages: 2 }));
});

test('scanned classification needs an actual consistent total, including missing pages', () => {
  const recovered = parseTextNotes('27 página(s) recuperadas por OCR. 5 página(s) sin texto omitidas.');
  for (const pages of [null, 0, -1, NaN, Infinity, 27.5, 27]) assert.equal(isScannedWork(recovered, pages), false);
  assert.equal(isScannedWork(recovered, 32), true);
  assert.equal(isScannedWork(recovered, 54), true);
  assert.equal(isScannedWork(recovered, 55), false);
  assert.equal(isScannedWork(parseTextNotes(cappedNote), 1000), false, 'a last recovered page is not the total');
  assert.equal(isScannedWork(parseTextNotes(cappedNote), 1342), true);
  assert.equal(isScannedWork(provenance({ ocrPages: 300, cappedPages: 1042 }), 1342), false);
  assert.equal(isScannedWork(provenance({ ocrPages: 6 }), 1400), false);
  assert.equal(isScannedWork(provenance({ ocrPages: 27, unresolvedPages: 30 }), 54), false);
});

// Render the real component and real provenance parser. Only presentation helpers,
// IPC hooks and translations are isolated; React's hooks and rendering remain real.
const uiStubs = new Map([
  ['../components/ui', 'export const Icon = () => null;'],
  ['../hooks', 'export const notifyDataChanged = () => {}; export const useDismissableLayer = () => null;'],
  ['../i18n', 'export const t = s => s; export const tx = (s,v) => s.replace(/\\{([^}]+)\\}/g,(_,k)=>String(v[k])); export const getActiveLang = () => "es";'],
  ['@shared/uiLanguage', 'export const localizeRuntimeError = s => s;'],
]);
const modalBundle = path.join(dir, 'modal.cjs');
await build({
  absWorkingDir: root, entryPoints: ['src/views/WorkStatusModal.tsx'], outfile: modalBundle,
  bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'modal-dependencies', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/|$)/ }, (args) => ({ path: require.resolve(args.path), external: true }));
    builder.onResolve({ filter: /.*/ }, (args) => uiStubs.has(args.path) ? { path: args.path, namespace: 'ui-stubs' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'ui-stubs' }, (args) => ({ contents: uiStubs.get(args.path), loader: 'js' }));
  } }],
});
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { WorkStatusModal } = require(modalBundle);
function citableDetail(notes, state = 'done', reason, blockReason) {
  const work = { title: 'Fixture', nodus_id: 'fixture', themes: [], ideaCount: 0, resolved_text_notes: notes, text_block_reason: blockReason };
  const steps = Object.fromEntries(['themes', 'ideas', 'summary', 'semantic', 'citable'].map((id) => [id, {
    id, state: id === 'citable' ? state : 'done', total: 10, reason: id === 'citable' ? reason : undefined,
  }]));
  const html = renderToStaticMarkup(React.createElement(WorkStatusModal, {
    work, status: { steps, missing: [] }, documentStatus: 'missing', onClose() {}, onChanged() {}, onOpenDocument() {},
  }));
  const row = html.match(/<section[^>]*data-testid="work-status-step-citable"[\s\S]*?<\/section>/);
  assert.ok(row, 'the citable row is actually rendered');
  return row[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('a digital book with a few OCR pages displays recovery, without a scanned label', () => {
  const detail = citableDetail('6 página(s) recuperadas por OCR.');
  assert.match(detail, /6 páginas recuperadas por OCR/);
  assert.doesNotMatch(detail, /escaneado/i);
});

test('extraction coverage remains visible in every index state and every partial reason', () => {
  for (const state of ['done', 'missing', 'pending', 'running', 'failed', 'blocked']) {
    assert.match(citableDetail(cappedNote, state), /342 páginas sin procesar por el límite de OCR \(1000 páginas\)/);
  }
  for (const reason of [undefined, 'text_changed', 'model_changed', 'text_and_model_changed']) {
    const detail = citableDetail(cappedNote, 'partial', reason);
    assert.match(detail, /342 páginas sin procesar por el límite de OCR/);
    if (reason === 'model_changed') assert.match(detail, /otro modelo de embeddings/);
    if (reason === 'text_changed') assert.match(detail, /El texto cambió/);
  }
  assert.match(citableDetail(cappedNote, 'missing', undefined, 'file_missing'), /archivo ya no está/);
  assert.match(citableDetail(cappedNote, 'missing', undefined, 'file_missing'), /342 páginas sin procesar/);
});

test('legacy missing text is visible without claiming an unverified cause', () => {
  const detail = citableDetail('1000 página(s) recuperadas por OCR. 342 página(s) sin texto omitidas.');
  assert.match(detail, /342 páginas sin texto recuperado/);
  assert.doesNotMatch(detail, /límite de OCR|escaneado/i);
});

test('different attachment limits never display an invented common limit', () => {
  const detail = citableDetail(`${cappedNote} 5 página(s) no procesadas: superan el límite de OCR (300 páginas por documento).`);
  assert.match(detail, /347 páginas sin procesar por el límite de OCR: súbelo/);
  assert.doesNotMatch(detail, /límite de OCR \(/);
});

test('OCR failure and unresolved pages remain visible even without a usable full text', () => {
  const detail = citableDetail('1000 página(s) sin texto recuperado. OCR no completado.', 'blocked');
  assert.match(detail, /1000 páginas sin texto recuperado/);
  assert.match(detail, /La extracción por OCR no se completó/);
  assert.doesNotMatch(detail, /límite de OCR/);
});
