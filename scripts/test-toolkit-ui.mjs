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
  assert.equal((view.match(/state="wip"/g) ?? []).length, 1, 'only Nodus Convert is in development');
  assert.match(view, /const disabled = state === 'soon'/);
  assert.match(view, /onClick=\{disabled \? undefined : onOpen\}/, 'a coming-soon card has no click handler');
  assert.match(view, /El conversor está en construcción\./);
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
  const [view, app] = await Promise.all([read('src/views/ToolkitView.tsx'), read('src/App.tsx')]);
  assert.ok(view.includes('data-testid="toolkit-back"'), 'the back control exists');
  assert.match(view, /<Icon name="chevronLeft"/, 'back uses the shared chevron icon');
  assert.match(view, /aria-label=\{t\('Volver a Herramientas'\)\}/, 'the back control is labelled for screen readers');
  // Header actions are icon-only buttons of one height; the toolkit must not be
  // the odd one out.
  assert.match(app, /icon="tools"\n\s+label=\{t\('Herramientas'\)\}/, 'the header exposes the toolkit');
  assert.match(app, /title=\{t\('Abrir Nodus Toolkit'\)\}/);
  assert.match(app, /\{view === 'toolkit' && <ToolkitView \/>\}/, 'the view is rendered by the shell');
  assert.match(app, /const ToolkitView = lazy\(/, 'the view is code-split like its siblings');
});

test('Nodi documents the toolkit without promising unbuilt features', async () => {
  const docs = await read('shared/nodiDocumentation.ts');
  assert.match(docs, /## Herramientas \(Nodus Toolkit\)/);
  assert.match(docs, /ninguna procesa archivos todavía/, 'the guide states the real state');
  assert.match(docs, /No lo describas como disponible/, 'the guide forbids claiming availability');
  // The roadmap line must no longer list the Toolkit as merely planned.
  assert.ok(
    !/El roadmap también contempla Nodus Toolkit/.test(docs),
    'the toolkit is no longer described as only a roadmap item'
  );
});
