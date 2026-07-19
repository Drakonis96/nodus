import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Nodus Toolkit — the Herramientas section (hub + per-tool pages). These checks
// cover the wiring that no e2e step can see cheaply: that the view is registered
// in the canonical nav tables, that it stays universal across vault types, and
// that the hub's three cards keep the structure the design requires (identical
// shape, centred icons, honest state badges). The real rendering is asserted by
// the toolkit steps in scripts/e2e-smoke.mjs.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-toolkit-ui-'));
test.after(() => rm(outDir, { recursive: true, force: true }));

/** Bundle a TS module so its real exported values can be asserted on. */
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const navigation = loadModule('src/navigation.ts');
const vaultTypes = loadModule('shared/vaultTypes.ts');

test('the toolkit is a real sidebar section in its own group', () => {
  const item = navigation.NAV_ITEMS.find((n) => n.id === 'toolkit');
  assert.ok(item, 'toolkit is registered in NAV_ITEMS');
  assert.equal(item.group, 'tools', 'toolkit belongs to the tools group');
  assert.equal(item.icon, 'tools');

  const group = navigation.NAV_GROUPS.find((g) => g.id === 'tools');
  assert.ok(group, 'the tools group is declared');
  assert.equal(group.label, 'Herramientas');
  assert.equal(
    navigation.NAV_GROUPS.at(-1).id,
    'tools',
    'Herramientas renders after Explorar · Analizar · Escribir'
  );
});

test('every sidebar icon stays unique so a collapsed sidebar keeps sections apart', () => {
  const icons = navigation.NAV_ITEMS.map((n) => n.icon);
  // Views scoped to different vault types never coexist, so only the toolkit's
  // own icon has to be globally unique — it shows in every vault.
  assert.equal(icons.filter((icon) => icon === 'tools').length, 1, 'the tools icon belongs to the toolkit alone');
});

test('the toolkit icons exist in the shared catalogue', async () => {
  const ui = await read('src/components/ui.tsx');
  for (const icon of ['tools', 'swap', 'scanText', 'presentation', 'chevronLeft']) {
    assert.match(ui, new RegExp(`\\n\\s{2}${icon}: '`), `${icon} is defined in ICON_PATHS`);
  }
});

test('the toolkit shows in every vault type, including databases and study', () => {
  for (const type of ['academic', 'genealogy', 'estudio', 'databases', 'primary_sources']) {
    assert.equal(
      vaultTypes.isViewAllowedForVaultType('toolkit', type),
      true,
      `the toolkit is universal (${type})`
    );
    assert.equal(
      vaultTypes.defaultHiddenViewsForType(type).includes('toolkit'),
      false,
      `the toolkit is not hidden by default (${type})`
    );
  }
  // groupedNav must surface the tools group for a default (uncustomised) sidebar.
  const groups = navigation.groupedNav([], vaultTypes.defaultHiddenViewsForType('databases'));
  const tools = groups.find((g) => g.id === 'tools');
  assert.ok(tools, 'the tools group survives the databases preset');
  assert.deepEqual(tools.items.map((n) => n.id), ['toolkit']);
});

test('the hub renders three tools and only Nodus Convert can be opened', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  assert.ok(view.includes('data-testid="toolkit-home"'), 'the hub is addressable');
  // The cards receive their testid as a prop; ToolCard is what stamps it onto the DOM.
  assert.match(view, /data-testid=\{testid\}/, 'ToolCard exposes its testid to the DOM');
  for (const testid of ['toolkit-card-convert', 'toolkit-card-presenter', 'toolkit-card-aiocr']) {
    assert.ok(view.includes(`testid="${testid}"`), `${testid} is rendered`);
  }
  for (const name of ['Nodus Convert', 'PDF Presenter', 'OCR Workspace']) {
    assert.ok(view.includes(`name="${name}"`), `${name} keeps its brand name untranslated`);
  }
  // Honesty: the two unbuilt tools are inert, and the convert page never claims
  // to convert anything yet.
  assert.equal((view.match(/state="soon"/g) ?? []).length, 2, 'presenter and OCR workspace are marked coming soon');
  assert.equal((view.match(/state="wip"/g) ?? []).length, 1, 'only Nodus Convert is openable');
  assert.match(view, /const disabled = state === 'soon'/);
  assert.match(view, /onClick=\{disabled \? undefined : onOpen\}/, 'a coming-soon card has no click handler');
  // The convert card now opens the real converter, not a placeholder.
  assert.match(view, /<ToolkitConvertView onBack=/, 'Nodus Convert renders the functional converter');
});

test('the hub cards share one shape: equal size, centred icons, pinned badges', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  // One ToolCard component renders all three, so they cannot drift apart.
  assert.equal((view.match(/<ToolCard\b/g) ?? []).length, 3);
  assert.match(view, /grid gap-4 sm:grid-cols-2 lg:grid-cols-3/, 'cards share a grid track');
  assert.match(view, /className=\{`flex h-full flex-col/, 'each card fills its grid cell');
  assert.match(view, /h-12 w-12 shrink-0 items-center justify-center/, 'the card icon sits in a fixed centred tile');
  assert.match(view, /mt-auto inline-flex items-center/, 'the state badge pins to the bottom');
  // The spin/transform clash that made a previous spinner bob instead of rotate.
  assert.ok(!/animate-spin[^"'`]*-translate-y/.test(view), 'no spinner shares an element with a transform');
});

test('a tool page returns to the hub and keeps the header action row uniform', async () => {
  const [view, convert, app] = await Promise.all([
    read('src/views/ToolkitView.tsx'),
    read('src/views/ToolkitConvertView.tsx'),
    read('src/App.tsx'),
  ]);
  // The convert workspace owns its own back-to-hub control.
  assert.ok(convert.includes('data-testid="toolkit-back"'), 'the back control exists');
  assert.match(convert, /<Icon name="chevronLeft"/, 'back uses the shared chevron icon');
  assert.match(convert, /aria-label=\{t\('Volver a Herramientas'\)\}/, 'the back control is labelled for screen readers');
  assert.match(view, /onBack=\{\(\) => setPage\('home'\)\}/, 'the hub passes a back handler to the tool');
  // Header actions are icon-only buttons of one height; the toolkit must not be
  // the odd one out.
  assert.match(app, /icon="tools"\n\s+label=\{t\('Herramientas'\)\}/, 'the header exposes the toolkit');
  assert.match(app, /title=\{t\('Abrir Nodus Toolkit'\)\}/);
  assert.match(app, /\{view === 'toolkit' && <ToolkitView \/>\}/, 'the view is rendered by the shell');
  assert.match(app, /const ToolkitView = lazy\(/, 'the view is code-split like its siblings');
});

test('Convert leads with the formats it accepts, then offers a grouped searchable menu', async () => {
  const convert = await read('src/views/ToolkitConvertView.tsx');
  const toolkit = loadModule('shared/toolkitTypes.ts');

  // The empty state advertises what can be dropped — a dropzone with no catalogue
  // is the blind guess this redesign removes.
  assert.ok(convert.includes('data-testid="toolkit-formats"'), 'the supported-formats panel is addressable');
  assert.match(convert, /\{\(!hasFiles \|\| availableOps\.length === 0\) && <SupportedFormats \/>\}/,
    'the catalogue shows on the empty state and again when nothing matches');
  // Every category contributes to the panel, and the checksum operation's
  // "any file" case is stated rather than silently dropped.
  assert.equal(toolkit.TOOLKIT_CATEGORIES.length, 5, 'all five families are catalogued');
  assert.ok(toolkit.TOOLKIT_OPS.some((op) => op.inputExts.length === 0), 'an any-file operation exists');
  assert.match(convert, /anyFile: ops\.some\(\(op\) => op\.inputExts\.length === 0\)/, 'the panel marks the any-file family');

  // The operation menu replaced the category rail: categories are group headers
  // inside one searchable popover, not a pre-filter the user has to guess first.
  assert.ok(!convert.includes('toolkit-cat-'), 'the category rail is gone');
  assert.ok(convert.includes('data-testid="toolkit-op-picker"'), 'the conversion menu has a trigger');
  assert.ok(convert.includes('data-testid="toolkit-op-search"'), 'the menu has a search box');
  assert.match(convert, /opsForInputs\(files\)/, 'the menu offers operations from every category, not one');
  assert.match(convert, /createPortal\(/, 'the menu is portaled out of the overflow-hidden shell');
  // Accent-insensitive search, or "imagenes" finds nothing under "Imágenes".
  assert.match(convert, /normalize\('NFD'\)/, 'search folds accents');

  // Only compatible operations are listed, so the menu can never offer a failure.
  const forPdf = toolkit.opsForInputs(['/tmp/a.pdf']).map((op) => op.id);
  assert.ok(forPdf.includes('pdf-to-txt') && forPdf.includes('ocr-pdf-searchable'), 'a PDF spans several categories');
  assert.ok(!forPdf.includes('heic-convert'), 'an incompatible operation is never offered');
  assert.ok(!forPdf.includes('pdf-merge'), 'a merge needing two inputs is withheld from a single file');
  assert.deepEqual(toolkit.opsForInputs([]), [], 'nothing is offered before a file is added');
});

test('a batch reports its progress on a bar, and says why a file failed', async () => {
  const convert = await read('src/views/ToolkitConvertView.tsx');
  const { jobOverallProgress, jobCurrentFile } = loadModule('shared/toolkitTypes.ts');

  const file = (inputPath, status, pct = null, error = null) => ({ inputPath, status, pct, outputPaths: [], error });
  const snapshot = (files, activeIndex, done, extra = {}) => ({
    jobId: 'j', files, activeIndex, done, total: files.length, cancelled: false, finished: false, ...extra,
  });

  // A batch advances by completed files…
  const batch = [file('/a.pdf', 'done'), file('/b.pdf', 'processing', 0.5), file('/c.pdf', 'pending'), file('/d.pdf', 'pending')];
  assert.equal(jobOverallProgress(snapshot(batch, 1, 1)), 0.375, '1 done + half of the second, out of 4');

  // …and a single long file still moves, instead of sitting at 0 until it flips
  // to 100 — the whole point of the bar for a slow OCR run.
  const solo = [file('/scan.pdf', 'processing', 0.4)];
  assert.equal(jobOverallProgress(snapshot(solo, 0, 0)), 0.4, 'intra-file progress drives the bar');
  assert.equal(jobOverallProgress(snapshot(solo, 0, 0, { finished: true })), 1, 'a finished job reads full');
  assert.equal(
    jobOverallProgress(snapshot(batch, 1, 1, { finished: true, cancelled: true })),
    0.25,
    'a cancelled job reports what it actually got through, not 100 %'
  );
  assert.equal(jobOverallProgress(snapshot([], -1, 0)), 0, 'an empty batch never divides by zero');

  // The ordinal and the file name must come from the same file. Between two files
  // activeIndex still points at the one that just finished, which used to render
  // as "Procesando 2 de 5" beside the name of file 1.
  const between = [file('/a.pdf', 'done'), file('/b.pdf', 'pending'), file('/c.pdf', 'pending')];
  const current = jobCurrentFile(snapshot(between, 0, 1));
  assert.equal(current.file.inputPath, '/b.pdf', 'the next pending file is the one being announced');
  assert.equal(current.ordinal, 2, 'its ordinal matches its own position');
  assert.equal(jobCurrentFile(snapshot(between, 0, 1, { finished: true })), null, 'a finished job announces no file');

  // The view renders that as an accessible bar, and no longer swallows the reason
  // a file failed.
  assert.ok(convert.includes('data-testid="toolkit-progress"'), 'the progress card is addressable');
  assert.match(convert, /role="progressbar"/, 'the bar is exposed to assistive tech');
  assert.match(convert, /aria-valuenow=\{Math\.round\(overallPct \* 100\)\}/, 'the bar reports its real value');
  assert.match(convert, /\{tr\(fp\.error\)\}/, 'a failed file shows its (localised) reason, not just a red pill');
});

test('leaving the page never stops the batch, and coming back restores it', async () => {
  // The promise driving a conversion lives in the module-level background store,
  // not in the component, so unmounting the view (navigating to another section)
  // must not touch the work in flight.
  const store = loadModule('src/backgroundJobs.ts');
  const { TOOLKIT_JOB_KEY, startToolkitJob, getBackgroundJob, subscribeBackgroundJob, clearBackgroundJob } = store;

  const seen = [];
  let emit;
  let settle;
  globalThis.window = {
    nodus: {
      runToolkitJob: (_request, handlers) => {
        emit = handlers.onProgress;
        return new Promise((resolve) => { settle = resolve; });
      },
    },
  };

  const request = { opId: 'pdf-to-txt', inputPaths: ['/a.pdf', '/b.pdf'], outputFormat: 'txt', options: {}, outputDir: null, mergedName: null, zipOutput: false, zipName: null, openFolderOnDone: false };
  const unsubscribe = subscribeBackgroundJob(TOOLKIT_JOB_KEY, (job) => seen.push(job?.progress?.done ?? null));
  startToolkitJob(request);
  await new Promise((r) => setImmediate(r));

  emit({ jobId: 'j', files: [], activeIndex: 0, done: 1, total: 2, cancelled: false, finished: false });
  assert.equal(getBackgroundJob(TOOLKIT_JOB_KEY).progress.done, 1);

  // "Leaving the page": every subscriber goes away.
  unsubscribe();
  assert.equal(
    clearBackgroundJob(TOOLKIT_JOB_KEY),
    false,
    'a running job is never dropped from the store — that would orphan the work'
  );

  // Work continues while nothing is listening, and the store keeps recording it.
  emit({ jobId: 'j', files: [], activeIndex: 1, done: 2, total: 2, cancelled: false, finished: true });
  settle({ jobId: 'j', files: [], cancelled: false, zipPath: null });
  await new Promise((r) => setImmediate(r));

  const after = getBackgroundJob(TOOLKIT_JOB_KEY);
  assert.equal(after.progress.done, 2, 'progress advanced with no subscriber attached');
  assert.equal(after.status, 'completed', 'the job ran to completion after the view unmounted');
  // "Coming back": a fresh subscriber is handed the finished job immediately.
  let onReturn = null;
  subscribeBackgroundJob(TOOLKIT_JOB_KEY, (job) => { onReturn = job; })();
  assert.equal(onReturn.status, 'completed');
  assert.deepEqual(onReturn.request.inputPaths, ['/a.pdf', '/b.pdf'], 'the batch is recoverable from the job itself');
  delete globalThis.window;

  // …which is exactly what the view seeds itself from. Without this the user
  // returns to the empty "drop files here" state with a stray progress card, and
  // loses the "Mostrar" links to the outputs that were just produced.
  const convert = await read('src/views/ToolkitConvertView.tsx');
  assert.match(convert, /function restoredRequest\(\)/, 'the view can read the in-flight job request');
  for (const [state, field] of [
    ['files', 'inputPaths'], ['opId', 'opId'], ['outputFormat', 'outputFormat'], ['options', 'options'],
    ['outputDir', 'outputDir'], ['zipOverride', 'zipOutput'], ['openOnDone', 'openFolderOnDone'],
  ]) {
    assert.match(
      convert,
      new RegExp(`\\[${state}, set\\w+\\] = useState[^\\n]*restoredRequest\\(\\)\\?\\.${field}`),
      `${state} is restored from the running job`
    );
  }
});

test('Nodi documents the toolkit with its real, honest state', async () => {
  const docs = await read('shared/nodiDocumentation.ts');
  assert.match(docs, /## Herramientas \(Nodus Toolkit\)/);
  // Nodus Convert is functional now; the guide says so and stays honest about the
  // two tools still to come.
  assert.match(docs, /Nodus Convert ya funciona/, 'the guide states Convert works');
  assert.match(docs, /PDF Presenter y OCR Workspace .*«Próximamente»/, 'the guide keeps the other two as coming soon');
  assert.match(docs, /determinista y 100 % offline/, 'the guide states the privacy/offline principle');
  // The roadmap line must no longer list the Toolkit as merely planned.
  assert.ok(
    !/El roadmap también contempla Nodus Toolkit/.test(docs),
    'the toolkit is no longer described as only a roadmap item'
  );
});
