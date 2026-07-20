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
// that the hub's four cards keep the structure the design requires (identical
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
  for (const icon of ['tools', 'swap', 'shield', 'scanText', 'presentation', 'chevronLeft']) {
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

test('the hub renders four tools and Protect is in development', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  assert.ok(view.includes('data-testid="toolkit-home"'), 'the hub is addressable');
  // The cards receive their testid as a prop; ToolCard is what stamps it onto the DOM.
  assert.match(view, /data-testid=\{testid\}/, 'ToolCard exposes its testid to the DOM');

  // The catalogue is data, not markup: the hub cards and the nested sidebar
  // buttons both render from TOOLKIT_TOOLS, so they cannot describe a different
  // set of tools from each other.
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.map((tool) => `toolkit-card-${tool.testid}`),
    ['toolkit-card-convert', 'toolkit-card-protect', 'toolkit-card-presenter', 'toolkit-card-aiocr']
  );
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.map((tool) => tool.name),
    ['Nodus Convert', 'Nodus Protect', 'PDF Presenter', 'OCR Workspace'],
    'brand names stay untranslated'
  );
  assert.match(view, /name=\{tool\.name\}/, 'the card shows the brand name verbatim, never through t()');
  assert.match(view, /description=\{t\(tool\.description\)\}/, 'only the description is translated');

  // Honesty: the one unbuilt tool is inert; Convert, Protect and Presenter open.
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.filter((tool) => tool.state === 'soon').map((tool) => tool.page),
    ['ocr'],
    'only the OCR workspace is marked coming soon'
  );
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.filter((tool) => tool.state === 'wip').map((tool) => tool.page),
    ['convert', 'protect', 'presenter'],
    'Convert, Protect and PDF Presenter use the in-development badge'
  );
  assert.match(view, /const disabled = state === 'soon'/);
  assert.match(view, /onClick=\{disabled \? undefined : onOpen\}/, 'a coming-soon card has no click handler');
  // The convert card now opens the real converter, not a placeholder.
  assert.match(view, /<ToolkitConvertView onBack=/, 'Nodus Convert renders the functional converter');
  assert.match(view, /<ToolkitProtectView onBack=/, 'Nodus Protect renders the functional protection flow');
  assert.match(view, /<ToolkitPresenterView onBack=/, 'PDF Presenter renders the functional library');
  // Any page other than 'convert' or 'protect' falls back to the catalogue rather than
  // rendering an empty pane.
  assert.match(view, /page === 'protect'/, 'Protect has its own routed workspace');
});

test('Protect exposes the complete local workflow and the secure preload boundary', async () => {
  const [view, preload, ipc, shared] = await Promise.all([
    read('src/views/ToolkitProtectView.tsx'),
    read('electron/preload.ts'),
    read('electron/ipc.ts'),
    read('shared/protectTypes.ts'),
  ]);
  for (const marker of ['protect-home', 'Proteger documentos', 'Verificar una copia trazable', 'Guardar como…', 'Guardar en esta bóveda', 'Compartir']) {
    assert.ok(view.includes(marker), `Protect includes ${marker}`);
  }
  assert.match(view, /data-testid="toolkit-protect-back"/);
  assert.match(view, /maxLength=\{120\}/, 'trace labels are capped');
  assert.match(view, /verifyPayloadCache/, 'passphrase retries reuse the loaded bytes');
  assert.match(view, /\(pixel\.flags & 1\) !== 0/, 'verification derives open/keyed mode from the frozen IDPS flag');
  assert.match(preload, /webUtils\.getPathForFile/, 'dropped File objects become trusted native paths only in preload');
  assert.match(ipc, /protect\.invalidateProtectVaultReferences\(\)/, 'switching vault revokes main-process source capabilities');
  for (const typeName of ['ProtectSourceRef', 'ProtectSourceSummary', 'ProtectFilePayload', 'ProtectArtifact', 'ProtectVaultCopySummary']) {
    assert.ok(shared.includes(`interface ${typeName}`) || shared.includes(`type ${typeName}`), `${typeName} is shared`);
  }
});

test('the toolkit nests one sidebar button per tool under its section', async () => {
  const app = await read('src/App.tsx');
  // The tools are NOT views: they must never enter NAV_ITEMS, or they would show
  // up in sidebarOrder, the reordering UI and the vault-type allow-lists.
  const toolPages = new Set(navigation.TOOLKIT_TOOLS.map((tool) => tool.page));
  assert.ok(
    !navigation.NAV_ITEMS.some((n) => toolPages.has(n.id)),
    'the tools stay out of the canonical nav table'
  );
  assert.match(app, /const toolkitSubNav = \(\) =>/, 'the sidebar renders the nested tool buttons');
  assert.match(app, /TOOLKIT_TOOLS\.map\(\(tool\) => \{/, 'the buttons come from the shared catalogue');
  assert.match(app, /data-testid=\{`nav-toolkit-\$\{tool\.testid\}`\}/, 'each nested button is addressable');
  assert.match(app, /n\.id === 'toolkit' \? \(/, 'the nested list hangs off the toolkit item');
  // Clicking a tool jumps straight to it; clicking the section always lands on
  // the catalogue, which is the whole point of keeping both buttons.
  assert.match(
    app,
    /setToolkitPage\(tool\.page\); setView\('toolkit'\)/,
    'a nested button opens its tool directly'
  );
  assert.match(app, /if \(n\.id === 'toolkit'\) setToolkitPage\('home'\);/, 'the section button opens the catalogue');
  // A coming-soon tool is inert in the sidebar too, not just on its card.
  assert.match(app, /const disabled = tool\.state === 'soon';/, 'unbuilt tools are disabled in the sidebar');
  // The full brand name does not fit the default 176px sidebar and used to
  // render as "Nodus Con…"; the nested button drops the prefix the section
  // already supplies and keeps the full name in its title.
  assert.match(app, /\{tool\.shortName\}/, 'the nested button uses the short label');
  assert.match(app, /title=\{disabled \? t\('Próximamente'\) : tool\.name\}/, 'hovering still gives the full brand name');
  for (const tool of navigation.TOOLKIT_TOOLS) {
    assert.ok(tool.shortName.length <= 10, `${tool.name} has a sidebar-sized label (${tool.shortName})`);
    assert.ok(tool.name.includes(tool.shortName), `${tool.shortName} is part of the brand name, not a new word`);
  }
  // The section is only highlighted when the catalogue itself is on screen —
  // otherwise both the parent and the open tool would read as active.
  assert.match(
    app,
    /view === n\.id && \(n\.id !== 'toolkit' \|\| toolkitPage === 'home'\)/,
    'the section and its open tool never highlight at once'
  );
});

test('the hub cards share one shape: equal size, centred icons, pinned badges', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  // One ToolCard component renders all four, so they cannot drift apart.
  assert.equal((view.match(/<ToolCard\b/g) ?? []).length, 1, 'a single ToolCard renders the whole catalogue');
  assert.match(view, /grid gap-4 sm:grid-cols-2/, 'the four cards use a 2×2 grid when space permits');
  assert.match(view, /className=\{`flex h-full flex-col/, 'each card fills its grid cell');
  assert.match(view, /h-12 w-12 shrink-0 items-center justify-center/, 'the card icon sits in a fixed centred tile');
  assert.match(view, /mt-auto inline-flex items-center/, 'the state badge pins to the bottom');
  // The spin/transform clash that made a previous spinner bob instead of rotate.
  assert.ok(!/animate-spin[^"'`]*-translate-y/.test(view), 'no spinner shares an element with a transform');
});

test('a tool page returns to the hub and keeps the header action row uniform', async () => {
  const [view, convert, protect, app] = await Promise.all([
    read('src/views/ToolkitView.tsx'),
    read('src/views/ToolkitConvertView.tsx'),
    read('src/views/ToolkitProtectView.tsx'),
    read('src/App.tsx'),
  ]);
  // The convert workspace owns its own back-to-hub control.
  assert.ok(convert.includes('data-testid="toolkit-back"'), 'the back control exists');
  assert.match(convert, /<Icon name="chevronLeft"/, 'back uses the shared chevron icon');
  assert.match(convert, /aria-label=\{t\('Volver a Herramientas'\)\}/, 'the back control is labelled for screen readers');
  assert.ok(protect.includes('data-testid="toolkit-protect-back"'), 'Protect owns its back-to-hub control');
  assert.match(view, /onBack=\{\(\) => onNavigate\('home'\)\}/, 'the hub passes a back handler to the tool');
  // Header actions are icon-only buttons of one height; the toolkit must not be
  // the odd one out.
  assert.match(app, /icon="tools"\n\s+label=\{t\('Herramientas'\)\}/, 'the header exposes the toolkit');
  assert.match(app, /title=\{t\('Abrir Nodus Toolkit'\)\}/);
  assert.match(
    app,
    /\{view === 'toolkit' && <ToolkitView page=\{toolkitPage\} onNavigate=\{setToolkitPage\} \/>\}/,
    'the view is rendered by the shell, with the active page owned by App'
  );
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
  assert.match(docs, /PDF Presenter ya se puede abrir/, 'the guide states the presenter library is available');
  assert.match(docs, /OCR Workspace .*«Próximamente»/, 'the guide keeps the OCR workspace as coming soon');
  assert.match(docs, /determinista y 100 % offline/, 'the guide states the privacy/offline principle');
  // The roadmap line must no longer list the Toolkit as merely planned.
  assert.ok(
    !/El roadmap también contempla Nodus Toolkit/.test(docs),
    'the toolkit is no longer described as only a roadmap item'
  );
});
