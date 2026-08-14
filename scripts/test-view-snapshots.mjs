// Leaving a section and coming back should land on the same cut of the corpus.
//
// Two halves are tested here. The store itself is exercised for real: it is a plain
// TypeScript module with no React in it, so esbuild can bundle it and the vault
// closure can be proved rather than described. The wiring — which sections opt in,
// what they restore and, above all, what they deliberately do NOT restore — is
// asserted against the sources, which is where those decisions are visible.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-view-snapshots-'));
const bundleOf = (source, name) => {
  const outfile = path.join(bundleDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, source),
      '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
      '--external:react',
      `--alias:@shared=${path.join(repoRoot, 'shared')}`,
      `--outfile=${outfile}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(outfile);
};
const store = bundleOf('src/app/viewSnapshots.ts', 'viewSnapshots.cjs');
const { topAnchorId } = bundleOf('src/listPlacement.ts', 'listPlacement.cjs');

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

const AUTHORS_CUT = { query: 'ricoeur', sortBy: 'ideas', synthFilter: 'with', savedOnly: true, filtersOpen: true };

test('a section that was left with a cut finds it again on the way back', () => {
  store.clearViewSnapshots();
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'nothing is remembered before anything is left');

  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  assert.deepEqual(store.readViewSnapshot('vault-a', 'authors'), AUTHORS_CUT);
});

test('the two halves of a section merge instead of overwriting each other', () => {
  store.clearViewSnapshots();
  // In Autores the tab strip lives in AuthorsView and the filters in its catalogue
  // child. Each reports only what it owns, and neither may erase the other's half.
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  store.patchViewSnapshot('vault-a', 'authors', { surface: 'author', openAuthor: { id: 'A1', label: 'Ricoeur' }, matrixOpen: false });

  assert.deepEqual(store.readViewSnapshot('vault-a', 'authors'), {
    ...AUTHORS_CUT,
    surface: 'author',
    openAuthor: { id: 'A1', label: 'Ricoeur' },
    matrixOpen: false,
  });
});

test('sections do not share a snapshot', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  store.patchViewSnapshot('vault-a', 'ideas', { search: 'mímesis', sortKey: 'connections' });

  assert.equal(store.readViewSnapshot('vault-a', 'authors').query, 'ricoeur');
  assert.equal(store.readViewSnapshot('vault-a', 'ideas').search, 'mímesis');
});

test('a snapshot is closed to the vault it was taken in', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);

  // The whole app assumes a single active vault. Another vault's cut is not merely
  // hidden, it is discarded: a second surviving set would be a second answer to
  // "where was I", and the check lives in the read so that a section mounting in the
  // same commit as a vault change cannot see the old one.
  assert.equal(store.readViewSnapshot('vault-b', 'authors'), undefined, 'another vault sees nothing');

  store.patchViewSnapshot('vault-b', 'ideas', { search: 'genealogía' });
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'switching vault discards the previous cut');
  assert.equal(store.readViewSnapshot('vault-b', 'ideas').search, 'genealogía');
});

test('with no vault there is nothing to read and nothing to write', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot(null, 'authors', AUTHORS_CUT);
  assert.equal(store.readViewSnapshot(null, 'authors'), undefined);
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'a vault-less write is a no-op, not a write to whoever comes next');
});

test('the shell binds the vault once so a section cannot reach another one', () => {
  store.clearViewSnapshots();
  const access = store.viewSnapshotAccess('vault-a');
  access.patch('authors', AUTHORS_CUT);
  assert.deepEqual(access.read('authors'), AUTHORS_CUT);

  // A section never holds a vault id for this purpose, so it cannot get it wrong.
  const other = store.viewSnapshotAccess('vault-b');
  assert.equal(other.read('authors'), undefined);
});

// ── Phase two: the place inside the list ──────────────────────────────────────

/**
 * A scroller whose rows are 100px tall, stacked from its own top edge. Only the four
 * calls `topAnchorId` makes are needed, which is what lets the binary search be
 * tested for real instead of described.
 */
function fakeScroller({ rowCount, rowHeight = 100, scrollTop = 0, viewportTop = 0 }) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    getAttribute: () => `row-${index}`,
    getBoundingClientRect: () => ({
      top: viewportTop + index * rowHeight - scrollTop,
      bottom: viewportTop + (index + 1) * rowHeight - scrollTop,
    }),
  }));
  return {
    getBoundingClientRect: () => ({ top: viewportTop, bottom: viewportTop + 500 }),
    querySelectorAll: () => rows,
  };
}

test('the row reported as the anchor is the one crossing the top edge', () => {
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500 })), 'row-0', 'at rest the first row is the anchor');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 300 })), 'row-3', 'an exact boundary belongs to the row below it');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 350 })), 'row-3', 'a row half off the top is still the one being read');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 49_900 })), 'row-499', 'the last row is reachable');
  // The scroller is not always at the top of the window.
  assert.equal(topAnchorId(fakeScroller({ rowCount: 20, scrollTop: 250, viewportTop: 180 })), 'row-2');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 0 })), null, 'an empty list has no anchor');
});

test('a placement is a row id, never a pixel offset', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  assert.match(types, /anchorId: string/);
  assert.match(types, /pageOffset\?: number/, 'the page is a hint, absent where the renderer pages');
  // Row heights change with the window and with the content, and a virtualised list
  // has not even measured the rows it has not reached.
  for (const measurement of ['scrollTop', 'scrollOffset', 'scrollY', 'offsetTop']) {
    assert.doesNotMatch(types, new RegExp(`^\\s*${measurement}[?]?:`, 'm'), `${measurement} is not a place`);
  }
});

test('every paged section restores its page and its row together, or neither', async () => {
  const sections = {
    'src/views/AuthorsView.tsx': 'authors',
    'src/views/IdeasView.tsx': 'ideas',
    'src/views/Library.tsx': 'the vault library',
    'src/views/GlobalLibraryView.tsx': 'the global catalogue',
  };
  for (const [file, label] of Object.entries(sections)) {
    const source = await readSource(file);
    assert.match(source, /useState\(\(\) => snapshot\?\.placement\?\.pageOffset \?\? 0\)/, `${label} reopens on the stored page`);
    assert.match(source, /snapshot\?\.placement\?\.anchorId \?\? null/, `${label} reopens on the stored row`);
    // A page whose anchor is gone is the half-restored state this exists to avoid.
    assert.match(source, /setPageOffset\(0\)|setOffset\(0\)/, `${label} falls back to the first page`);
  }
});

test('a list that pages in the renderer loads until the anchor appears', async () => {
  const [hooks, argument] = await Promise.all([readSource('src/hooks.ts'), readSource('src/views/ArgumentMapView.tsx')]);
  assert.match(hooks, /ensureIndex\?: number/, 'the incremental list can be asked to open wide enough for a row');
  assert.match(hooks, /Math\.ceil\(\(ensureIndex! \+ 1\) \/ pageSize\) \* pageSize/, 'it opens whole pages up to that row');
  assert.match(hooks, /!ensured\.current && anchored && items\.length > 0/, 'the first real page does not collapse the pages opened for the anchor');
  assert.match(argument, /findIndex\(\(suggestion\) => suggestion\.ideaId === anchorId\)/);
  assert.match(argument, /ROUTES_PAGE_SIZE, undefined, anchorIndex/);
});

test('a virtualised list anchors against its own geometry, because the row is not in the DOM yet', async () => {
  const virtualList = await readSource('src/components/VirtualList.tsx');
  assert.match(virtualList, /anchorKey\?: React\.Key \| null/);
  assert.match(virtualList, /onAnchorChange\?: \(key: React\.Key \| null\) => void/);
  assert.match(virtualList, /const target = variableLayout \? variableLayout\.offsets\[index\] : index \* \(itemHeight as number\)/);
  // Reporting the top row before the restore has run would overwrite the placement
  // being restored: the list renders at scroll zero first.
  assert.match(virtualList, /anchorSettled\.current/);
  for (const library of ['src/views/Library.tsx', 'src/views/GlobalLibraryView.tsx']) {
    const source = await readSource(library);
    assert.match(source, /anchorKey=\{restoreAnchorId\}/);
    // Scroll must not go through React state: it fires every frame, and this view
    // would re-render whole — sidebar, detail pane and all — for each one.
    assert.match(source, /placementRef\.current = key === null \? null : \{ anchorId: String\(key\), pageOffset/);
  }
});

test('the effects that reset the page skip their own first run', async () => {
  // Arriving with a restored filter would otherwise reset the restored page a frame
  // later, and the reader would land on page one having been promised page three.
  for (const file of ['src/views/AuthorsView.tsx', 'src/views/IdeasView.tsx']) {
    const source = await readSource(file);
    assert.match(source, /if \(!cutChanged\.current\) \{\s*cutChanged\.current = true;\s*return;\s*\}/, `${file} guards its page reset`);
  }
  const global = await readSource('src/views/GlobalLibraryView.tsx');
  assert.match(global, /if \(!searchSettled\.current\) \{\s*searchSettled\.current = true;\s*return;\s*\}/, 'the search debounce does not fire on arrival');
});

test('changing the cut throws the place away with it', async () => {
  for (const file of ['src/views/AuthorsView.tsx', 'src/views/IdeasView.tsx']) {
    const source = await readSource(file);
    assert.match(source, /setAnchorId\(null\);\s*report\.current\?\.\(\{ placement: null \}\)/, `${file} drops the anchor with the filter`);
  }
});

test('every anchored list marks its rows with the id they will be found by', async () => {
  const lists = {
    'src/views/AuthorsView.tsx': 'author.author_id',
    'src/views/IdeasView.tsx': 'node.id',
    'src/views/ArgumentMapView.tsx': 's.ideaId',
    'src/views/WorkspaceView.tsx': 'note.id',
  };
  for (const [file, expression] of Object.entries(lists)) {
    const source = await readSource(file);
    assert.match(source, new RegExp(`data-anchor-id=\\{${expression.replace(/\./g, '\\.')}\\}`), `${file} marks its rows`);
    assert.match(source, /ref=\{(scrollerRef|routesScrollerRef|listRef)\}/, `${file} anchors against its scroller`);
  }
});

// ── The two sections added after phase one ────────────────────────────────────

test('the workspace keeps its collection, its filters, its expanded folders and its open notes', async () => {
  const view = await readSource('src/views/WorkspaceView.tsx');
  for (const restored of ['scope', 'search', 'kindFilter', 'selectedTags', 'openIds', 'activeId']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // A Set does not survive a plain object, and the expanded folders are the reader's
  // route back to what they were reading.
  assert.match(view, /new Set\(snapshot\?\.expanded \?\? \[\]\)/);
  assert.match(view, /expanded: \[\.\.\.expanded\]/);

  const registry = await readSource('src/app/views/corpus.tsx');
  // The same view is a different section of the app under the other vault types.
  assert.match(registry, /snapshots\.read\('workspace'\)/);
  assert.match(registry, /snapshots\.read\('notes'\)/);
});

test('the argument map keeps its route filters but never reopens a built map', async () => {
  const [view, types] = await Promise.all([
    readSource('src/views/ArgumentMapView.tsx'),
    readSource('src/app/viewSnapshots.ts'),
  ]);
  for (const restored of ['mode', 'seedId', 'suggestionSearch', 'minConnections', 'routeSort']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // Redrawing the map means rebuilding it, and in AI mode that is a model call spent
  // on the act of walking back into the section.
  assert.doesNotMatch(view, /useState[^\n]*snapshot\?\.openArgumentMap/, 'the open map is not restored');
  assert.doesNotMatch(types, /openArgumentMap/, 'and it is not even stored');
  assert.match(view, /const \[surface, setSurface\] = useState<ArgumentMapSurface>\('catalog'\)/, 'a returning reader lands on the catalogue');
});

test('the snapshot store lives above the single render point and outside React state', async () => {
  const [app, context] = await Promise.all([readSource('src/App.tsx'), readSource('src/app/ViewContext.ts')]);

  assert.match(app, /viewSnapshotAccess\(activeVault\?\.id \?\? null\)/, 'the active vault is bound in one place');
  assert.match(app, /const snapshots = useMemo\(/, 'the access object is stable across renders');
  assert.match(app, /^\s*snapshots,$/m, 'the sections receive it through the view context');
  assert.match(context, /snapshots: ViewSnapshotAccess/);
  // As React state, every keystroke in a search box would re-render the whole shell.
  assert.doesNotMatch(app, /useState[^\n]*ViewSnapshots/, 'the snapshots are not shell state');
});

test('the three opted-in sections receive their snapshot the way they already receive a target', async () => {
  const registry = await readSource('src/app/views/corpus.tsx');
  for (const view of ['library', 'ideas', 'authors']) {
    assert.match(registry, new RegExp(`snapshots\\.read\\('${view}'\\)`), `${view} is handed its snapshot`);
    assert.match(registry, new RegExp(`snapshots\\.patch\\('${view}',`), `${view} reports its snapshot back`);
  }
});

test('a snapshot is an initial value, never a reactive prop', async () => {
  const sources = await Promise.all([
    readSource('src/views/AuthorsView.tsx'),
    readSource('src/views/IdeasView.tsx'),
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
  ]);
  for (const source of sources) {
    assert.match(source, /useState\([^)]*\(\) => snapshot\?\./, 'restored through a lazy initialiser');
    // Re-applying the snapshot after mount would fight the reader for control of
    // their own filters on every render of the shell.
    assert.doesNotMatch(source, /useEffect\(\(\) => \{[^}]*\}, \[snapshot\]\)/, 'the snapshot is not re-applied after mount');
    assert.match(source, /reportSnapshot|report\.current = onSnapshotChange/, 'the callback identity stays out of the effect deps');
  }
});

test('Autores restores its filters, its ordering and its open tab', async () => {
  const view = await readSource('src/views/AuthorsView.tsx');
  for (const restored of ['sortBy', 'synthFilter', 'savedOnly', 'filtersOpen', 'query']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // Both halves of the search box start from the stored text, or the debounce fires
  // on mount and wipes the restored cut back to the whole corpus.
  assert.match(view, /const \[query, setQuery\] = useState\(\(\) => snapshot\?\.query \?\? ''\)/);
  assert.match(view, /const \[queryFilter, setQueryFilter\] = useState\(\(\) => snapshot\?\.query \?\? ''\)/);
  // A tab that is no longer open cannot be the active one.
  assert.match(view, /surface === 'author' && !snapshot\?\.openAuthor\) return 'catalog'/);
  assert.match(view, /surface === 'matrix' && !snapshot\?\.matrixOpen\) return 'catalog'/);
});

test('Ideas restores its filters and its open idea together with the selection behind it', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  for (const restored of ['search', 'typeFilter', 'sortKey', 'filtersOpen', 'openIdea']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  assert.match(view, /setSelectedId[\s\S]{0,120}snapshot\?\.openIdea\?\.id/, 'the open tab and the detail it shows are restored as a pair');
});

test('Biblioteca keeps a cut per scope, and only what nothing else already persists', async () => {
  const [wrapper, vaultLibrary, types] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
    readSource('src/app/viewSnapshots.ts'),
  ]);

  // One sidebar section, two engines behind the scope switch. Blending their filters
  // would apply a cut of the global catalogue to the vault's own library.
  assert.match(wrapper, /snapshot=\{snapshot\?\.vault\}/);
  assert.match(wrapper, /snapshot=\{snapshot\?\.global\}/);
  assert.match(vaultLibrary, /useState<WorkFilter>\(\(\) => snapshot\?\.filter \?\? \{\}\)/);
  for (const facet of ['source', 'extraction', 'itemType', 'yearFrom', 'yearTo', 'facetTag', 'facetVault', 'attachmentFilter']) {
    assert.match(wrapper, new RegExp(`snapshot\\?\\.filters\\.${facet}`), `${facet} survives leaving the section`);
  }
  // Sorting and columns are already written to disk, and the scope lives in settings.
  assert.doesNotMatch(types, /visibleColumns|columnWidths/, 'the snapshot does not duplicate what the Library persists itself');
  assert.doesNotMatch(types, /scope: LibraryScope/, 'the scope is settings, not a snapshot');
});

test('the page and the row are one field, so neither can be restored without the other', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  // The whole point of the single field: there is no way to express a restored page
  // with no row, or a row with no page, because they are not separate values.
  assert.match(types, /placement: ListPlacement \| null/, 'every section stores its place as one value');
  assert.doesNotMatch(types, /^\s*pageOffset[?]?: number;\s*$\n\s*$/m, 'the page is never a field of its own');
  const declarations = types.match(/^\s*(pageOffset|anchorId)[?]?:/gm) ?? [];
  assert.equal(declarations.length, 2, 'the page and the row are declared once each, inside ListPlacement');

  // Six sections, one contract.
  const placements = (types.match(/placement: ListPlacement \| null/g) ?? []).length;
  assert.equal(placements, 6, 'authors, ideas, both libraries, the workspace and the argument routes');
});

test('ephemeral state dies on the way out', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  // Open modals, spinners, in-flight errors, export selections and half-typed input
  // are not a place to return to. `filtersOpen` and `matrixOpen` are not modals:
  // one is part of the cut and the other is a tab.
  for (const forbidden of [
    'loading', 'error', 'exporting', 'exportMsg', 'searchDraft', 'detailId', 'trashMode',
    'zoteroOpen', 'migrationOpen', 'duplicatesOpen', 'recoveryOpen', 'confirmDelete',
  ]) {
    assert.doesNotMatch(types, new RegExp(`\\b${forbidden}\\b`), `${forbidden} is ephemeral`);
  }
  // What is stored is the applied search, not the draft in the box.
  const authors = await readSource('src/views/AuthorsView.tsx');
  assert.match(authors, /report\.current\?\.\(\{ query: queryFilter,/);
  const global = await readSource('src/views/GlobalLibraryView.tsx');
  assert.match(global, /currentSnapshot = useCallback\(\(\): LibraryGlobalSnapshot => \(\{\s*search,/, 'the global catalogue stores the applied search');
});
