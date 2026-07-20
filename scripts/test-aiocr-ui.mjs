// AI OCR (OCR Workspace) — UI wiring, asserted on the source (the app's convention for
// UI tests; the Electron e2e runs in CI). Checks that the card is activated, the view is
// routed and receives settings, the library view calls the real IPC surface and follows
// Toolkit design conventions, and that the preload / ipc / NodusApi / i18n wiring is
// present and consistent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.promises.readFile(path.join(repoRoot, rel), 'utf8');

const outDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-ui-'));
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--alias:@shared=${path.join(repoRoot, 'shared')}`, `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}
test.after(async () => { await rm(outDir, { recursive: true, force: true }); });

test('the OCR Workspace card is activated and routed to its own view', async () => {
  const navigation = loadModule('src/navigation.ts');
  const ocr = navigation.TOOLKIT_TOOLS.find((tool) => tool.page === 'ocr');
  assert.ok(ocr, 'the ocr tool exists in the catalogue');
  assert.equal(ocr.state, 'wip', 'OCR Workspace is now in development, not coming soon');
  assert.equal(ocr.icon, 'scanText');

  const view = await read('src/views/ToolkitView.tsx');
  assert.match(view, /page === 'ocr'/, 'the hub routes the ocr page');
  assert.match(view, /<ToolkitAiOcrView onBack=\{\(\) => onNavigate\('home'\)\} settings=\{settings\} \/>/, 'the view gets a back handler and settings');
  assert.match(view, /settings: AppSettings \| null/, 'the hub accepts settings to pass down');

  const app = await read('src/App.tsx');
  assert.match(app, /<ToolkitView page=\{toolkitPage\} onNavigate=\{setToolkitPage\} settings=\{settings\} \/>/, 'App threads settings into the toolkit');
});

test('the library view is addressable and follows Toolkit design conventions', async () => {
  const view = await read('src/views/ToolkitAiOcrView.tsx');
  assert.match(view, /data-testid="aiocr-home"/, 'the workspace is addressable');
  assert.match(view, /data-testid=\{testid\}/, 'the shared BackButton stamps its testid onto the DOM');
  assert.match(view, /testid="toolkit-aiocr-back"/, 'it owns a back-to-hub control');
  assert.match(view, /data-testid="aiocr-dropzone"/, 'the dropzone is addressable');
  // Amber accent (the Toolkit workshop tone), not a bespoke palette.
  assert.match(view, /bg-amber-100 text-amber-700/, 'uses the Toolkit amber loseta');
  assert.match(view, /border-dashed/, 'the dropzone uses the shared dashed style');
  // Status labels are literal t() calls so the i18n coverage test can see them.
  for (const label of ['En cola', 'Procesando', 'Hecho', 'Con errores', 'Cancelado']) {
    assert.match(view, new RegExp(`t\\('${label}'\\)`), `status "${label}" is a literal t() key`);
  }
});

test('the view drives OCR only through the typed preload surface', async () => {
  const view = await read('src/views/ToolkitAiOcrView.tsx');
  for (const method of [
    'listOcrDocs', 'createOcrDocs', 'onOcrEvent', 'pickOcrFiles',
    'cancelOcrDoc', 'reprocessOcrDocument', 'reprocessOcrPage', 'deleteOcrDoc', 'getOcrTranscript',
    'getOcrPageImage', 'getOcrPageText', 'saveOcrPageEdit', 'getPathForDroppedFile',
    'exportOcrDoc', 'exportOcrDocsZip', 'saveOcrToVault',
  ]) {
    assert.match(view, new RegExp(`window\\.nodus\\.${method}\\b`), `calls window.nodus.${method}`);
  }
  // Model choice defaults to the configured vision model and warns for cloud/subscription.
  assert.match(view, /settings\.visionModel \?\? settings\.extractionModel \?\? settings\.synthesisModel/, 'defaults to the vision model with the app fallback chain');
  assert.match(view, /<ModelPicker /, 'reuses the shared model picker');
  assert.match(view, /<SubscriptionQuotaNotice /, 'shows the subscription quota notice');
  assert.match(view, /isLocalProvider\(model\.provider\)/, 'detects cloud models to warn about off-device images');
});

test('preload, ipc and NodusApi expose the aiOcr surface consistently', async () => {
  const [preload, ipc, types] = await Promise.all([
    read('electron/preload.ts'),
    read('electron/ipc.ts'),
    read('shared/types.ts'),
  ]);
  // Every preload method has a matching ipc handler and a NodusApi type.
  const methods = {
    createOcrDocs: 'aiOcr:create',
    listOcrDocs: 'aiOcr:list',
    getOcrDoc: 'aiOcr:get',
    deleteOcrDoc: 'aiOcr:delete',
    cancelOcrDoc: 'aiOcr:cancel',
    reprocessOcrPage: 'aiOcr:reprocessPage',
    reprocessOcrDocument: 'aiOcr:reprocessDocument',
    getOcrPageImage: 'aiOcr:pageImage',
    getOcrPageText: 'aiOcr:pageText',
    saveOcrPageEdit: 'aiOcr:updatePage',
    getOcrTranscript: 'aiOcr:transcript',
    exportOcrDoc: 'aiOcr:export',
    exportOcrDocsZip: 'aiOcr:exportZip',
    saveOcrToVault: 'aiOcr:saveToVault',
    pickOcrFiles: 'aiOcr:pickFiles',
  };
  for (const [method, channel] of Object.entries(methods)) {
    assert.match(preload, new RegExp(`${method}:`), `preload defines ${method}`);
    assert.match(ipc, new RegExp(`h\\('${channel.replace(':', '\\:')}'`), `ipc handles ${channel}`);
    assert.match(types, new RegExp(`${method}\\(`), `NodusApi types ${method}`);
  }
  assert.match(preload, /onOcrEvent:/, 'preload exposes the progress subscription');
  assert.match(ipc, /initAiOcr\(getWindow\)/, 'the manager is initialised with the window');
  assert.match(ipc, /resumeAiOcr\(\)/, 'unfinished documents resume on startup');
});

test('the page-by-page review is present and wired to the page IPC', async () => {
  const view = await read('src/views/ToolkitAiOcrView.tsx');
  assert.match(view, /data-testid="aiocr-doc"/, 'the review is addressable');
  assert.match(view, /testid="aiocr-doc-back"/, 'the review returns to the library');
  assert.match(view, /data-testid="aiocr-page-editor"/, 'the page editor exists');
  for (const call of ['getOcrPageImage', 'getOcrPageText', 'saveOcrPageEdit', 'reprocessOcrPage']) {
    assert.match(view, new RegExp(`window\\.nodus\\.${call}\\b`), `the review calls window.nodus.${call}`);
  }
  assert.match(view, /Página \{n\} de \{total\}/, 'the review shows the page position');
});

test('the aiOcr i18n table is spread into every language', async () => {
  for (const [file, spread] of [
    ['src/i18n.en.ts', 'AI_OCR_TRANSLATIONS.en'],
    ['src/i18n.fr.ts', 'AI_OCR_TRANSLATIONS.fr'],
    ['src/i18n.de.ts', 'AI_OCR_TRANSLATIONS.de'],
    ['src/i18n.pt.ts', 'AI_OCR_TRANSLATIONS.pt'],
    ['src/i18n.pt-BR.ts', "AI_OCR_TRANSLATIONS['pt-BR']"],
    ['src/i18n.it.ts', 'AI_OCR_TRANSLATIONS.it'],
  ]) {
    const table = await read(file);
    assert.ok(table.includes(`...${spread},`), `${file} spreads ${spread}`);
  }
});
