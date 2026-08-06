// Every section of the app has exactly one renderer, and the metadata still lives
// where the sidebar reads it.
//
// `Record<View, ViewRenderer>` already makes a MISSING view a compile error. What
// the compiler cannot see is the other direction — a renderer keyed by a name that
// is not a view, which spreads in silently and is simply never reached.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The members of the `View` union in src/navigation.ts. */
function viewUnion() {
  const source = readSource('src/navigation.ts');
  const declaration = source.slice(source.indexOf('export type View ='));
  return [...declaration.slice(0, declaration.indexOf(';')).matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
}

/** The view ids each domain renderer file keys on. */
function registeredViews() {
  const dir = path.join(repoRoot, 'src/app/views');
  const ids = new Map();
  for (const entry of readdirSync(dir)) {
    const code = readFileSync(path.join(dir, entry), 'utf8');
    for (const match of code.matchAll(/^ {2}([A-Za-z]+): \(/gm)) {
      assert.ok(!ids.has(match[1]), `${match[1]} is rendered by two files: ${ids.get(match[1])} and ${entry}`);
      ids.set(match[1], entry);
    }
  }
  // home is a whole file of its own: one section, nine screens, chosen by vault type.
  ids.set('home', 'home.tsx');
  return ids;
}

test('every view has a renderer and every renderer is a view', () => {
  const views = viewUnion();
  const registered = registeredViews();
  assert.ok(views.length >= 60, `the View union looks truncated: ${views.length} members`);
  const missing = views.filter((view) => !registered.has(view));
  assert.deepEqual(missing, [], 'views with no renderer');
  const stray = [...registered.keys()].filter((id) => !views.includes(id));
  assert.deepEqual(stray, [], 'renderers keyed by something that is not a view');
});

test('App.tsx renders through the registry and holds no view chain of its own', () => {
  const app = readSource('src/App.tsx');
  assert.match(app, /\{VIEW_REGISTRY\[view\]\(viewContext\)\}/);
  // The four that remain are sidebar active-state checks, not dispatch.
  const branches = [...app.matchAll(/view === /g)].length;
  assert.ok(branches <= 6, `App.tsx still dispatches on view ${branches} times`);
  // The crash boundary and the lazy fallback stay around the registry, not inside it.
  assert.match(app, /<AppErrorBoundary key=\{view\}>/);
  assert.match(app, /<Suspense fallback=/);
});

test('the registry adds the render and nothing else: labels and gating stay put', () => {
  const registry = readSource('src/app/viewRegistry.tsx');
  for (const field of ['label:', 'icon:', 'group:']) {
    assert.ok(!registry.includes(field), `${field} belongs to src/navigation.ts, not the registry`);
  }
  // Still the single source for the sidebar and for the per-vault gating.
  assert.match(readSource('src/navigation.ts'), /export const NAV_ITEMS: NavItem\[\]/);
  assert.match(readSource('shared/vaultTypes.ts'), /VAULT_TYPE_SCOPED_VIEWS/);
});

// Gaps is the one view deliberately reachable without a sidebar entry of its own:
// it is a tab inside Coverage. What makes that safe is that it stays a routable
// view — Home, Search and the advanced tour all navigate to it — so the guard has
// to hold BOTH halves at once. Losing the renderer would 404 those callers; growing
// a NAV_ITEM back would put a second, full-screen Huecos beside the tab.
test('gaps is routable without a sidebar section, and lands on the Coverage tab', () => {
  const navigation = readSource('src/navigation.ts');
  assert.ok(viewUnion().includes('gaps'), 'gaps must stay in the View union');
  assert.ok(
    !/\{ id: 'gaps',/.test(navigation),
    'gaps must NOT have a NAV_ITEM: it is a tab inside Coverage, not a section'
  );

  // Both ids render the same workspace, each entering by its own tab.
  const corpus = readSource('src/app/views/corpus.tsx');
  assert.match(corpus, /gaps: \([^)]*\) => \(\s*<CoverageWorkspace\s+vaultId=\{[^}]*\}\s+initialTab="gaps"/);
  assert.match(corpus, /research: \([^)]*\) => \(\s*<CoverageWorkspace\s+vaultId=\{[^}]*\}\s+initialTab="map"/);
  assert.equal(registeredViews().get('gaps'), 'corpus.tsx');

  // The callers that still navigate to it must keep working.
  assert.match(readSource('src/app/views/corpus.tsx'), /onOpenGaps=\{\(\) => setView\('gaps'\)\}/);
  assert.match(readSource('src/views/AdvancedTour.tsx'), /view: 'gaps'/);
});

// The two labs that need a deeply analysed corpus are hidden by default, but hiding
// is a SIDEBAR preset — it must never make them unroutable, or the advanced tour
// walks into a section that cannot render.
test('the views academic hides by default are still routable', () => {
  const registered = registeredViews();
  for (const view of ['hypothesis', 'reading']) {
    assert.ok(registered.has(view), `${view} is hidden from the sidebar, not removed`);
    assert.ok(/\{ id: '(hypothesis|reading)',/.test(readSource('src/navigation.ts')));
  }
  // The tour still walks through both, so a preset that blocked navigation would break it.
  const tour = readSource('src/views/AdvancedTour.tsx');
  assert.match(tour, /view: 'hypothesis'/);
  assert.match(tour, /view: 'reading'/);
});
