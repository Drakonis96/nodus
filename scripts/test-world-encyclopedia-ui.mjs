// Contract assertions over the encyclopedia's renderer files.
//
// These are the wiring facts that no unit test can see and that the e2e would only catch
// after a full build: a view that is not routed, a sidebar entry that navigates nowhere, a
// link scheme the Markdown renderer does not know about, or an editor that would let
// somebody rewrite a character's sheet from the wrong side of the app.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('the encyclopedia is routed and reachable', async () => {
  const [app, sidebar, navigation, vaultTypes] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/WorldbuildingSidebar.tsx'),
    read('src/navigation.ts'),
    read('shared/vaultTypes.ts'),
  ]);
  assert.match(app, /view === 'encyclopedia' && <EncyclopediaView onNavigate=\{setView\} \/>/);
  assert.match(sidebar, /\{ label: 'Enciclopedia', icon: 'book', view: 'encyclopedia' \}/);
  assert.match(navigation, /'encyclopedia'/);
  assert.match(vaultTypes, /encyclopedia: \['worldbuilding'\]/);
});

test('the world graph section is gone', async () => {
  // Dropped deliberately: an A–Z index plus backlinks answers what a node-and-edge picture
  // of a fictional world was ever going to answer, and the graph would have been a fourth
  // way to look at the same six tables.
  const sidebar = await read('src/components/WorldbuildingSidebar.tsx');
  assert.doesNotMatch(sidebar, /Grafo del mundo/);
});

test("the index presentation is an ADDITION, not a replacement", async () => {
  const workspace = await read('src/components/world/WorldWorkspace.tsx');
  assert.match(workspace, /export type WorldPresentation = 'grid' \| 'tree' \| 'list' \| 'index';/);
  // The other four sections must still have their branch: adding a presentation by
  // rewriting one is the way this file breaks silently.
  assert.match(workspace, /section\.presentation === 'tree'/);
  assert.match(workspace, /section\.presentation === 'index'/);
  assert.match(workspace, /section\.presentation === 'list'/);
  // The optional footer must not become required for the four existing callers.
  assert.match(workspace, /Footer\?:/);
  assert.match(workspace, /section\.Footer && !loading/);
});

test('the selection survives a filter, which is what a reading pane needs', async () => {
  const workspace = await read('src/components/world/WorldWorkspace.tsx');
  // The guard drops the selection only when the item stops EXISTING (`items`), never when
  // it is merely hidden (`visible`). Typing in the search box must not slam the reading
  // pane shut mid-paragraph.
  assert.match(workspace, /!items\.some\(\(item\) => section\.idOf\(item\) === selectedId\)/);
});

test('Markdown knows the world link scheme, without treating it as a citation', async () => {
  const markdown = await read('src/components/Markdown.tsx');
  assert.match(markdown, /nodus:\\\/\\\/world\\\/\(\[a-z\]\+\)\\\/\(\.\+\)/);
  assert.match(markdown, /onWorldEntry\?: \(kind: string, id: string\) => void;/);
  // The academic citation scheme still works.
  assert.match(markdown, /nodus:\\\/\\\/idea\\\//);
  // A world link must NOT be routed through parseCitation: its CitationLink fetches a
  // preview of an academic source over IPC, which a world entry has no answer for.
  const citation = markdown.slice(markdown.indexOf('function parseCitation'));
  assert.doesNotMatch(citation.slice(0, 900), /world/);
});

test('a projection is read here and edited in its own section', async () => {
  const reader = await read('src/components/world/WorldEntryReader.tsx');
  // Every write path is behind `entry.editable`, which the repo sets only for articles.
  // Letting the encyclopedia rewrite a character's backstory would give a writer two
  // places to change the same paragraph.
  assert.match(reader, /entry\.editable \? \(/);
  assert.match(reader, /\{entry\.editable && \(\n/);
  assert.match(reader, /data-testid="entry-full-sheet"/);
  // The AI draft is displayed from `proposedBody` and needs an explicit accept.
  assert.match(reader, /detail\?\.proposedBody &&/);
  assert.match(reader, /acceptWorldArticleDraft/);
});

test('the home page no longer claims the built sections are unbuilt', async () => {
  const home = await read('src/views/WorldbuildingHome.tsx');
  for (const built of ['enciclopedia', 'lugares', 'facciones', 'culturas', 'cronología', 'mapa', 'relaciones', 'escenas']) {
    assert.doesNotMatch(
      home,
      new RegExp(`Las demás secciones[^']*${built}`),
      `${built} ships and must not be listed as under construction`
    );
  }
});

test('Continuity is a reading, not a collection you add to', async () => {
  const [workspace, view, sidebar, app] = await Promise.all([
    read('src/components/world/WorldWorkspace.tsx'),
    read('src/views/ContinuityView.tsx'),
    read('src/components/WorldbuildingSidebar.tsx'),
    read('src/App.tsx'),
  ]);
  // The create button exists only where creating is a thing. Without this guard the
  // section shows an "add" button that opens nothing.
  assert.match(workspace, /\{createModal && \(/);
  assert.match(workspace, /createLabel\?:/);
  assert.doesNotMatch(view, /createModal/);
  assert.doesNotMatch(view, /createLabel/);

  // The section renamed: "Consistencia" collided with "Conflictos" in the same group, and
  // "continuity error" is what a novelist already says.
  assert.doesNotMatch(sidebar, /Consistencia/);
  assert.match(sidebar, /\{ label: 'Continuidad', icon: 'check', view: 'continuity' \}/);
  assert.match(app, /view === 'continuity' && <ContinuityView onNavigate=\{setView\} \/>/);
});

test('the badge and the section read the same array', async () => {
  const [badge, view, appSource] = await Promise.all([
    read('src/components/world/ContinuityBadge.tsx'),
    read('src/views/ContinuityView.tsx'),
    read('src/App.tsx'),
  ]);
  // One provider for the whole vault, refreshed when the view changes: section edits do
  // not go through notifyDataChanged, so navigation is the signal. Without it a writer
  // edits scenes, opens a sheet, and sees a badge computed before their edits.
  assert.match(appSource, /<ContinuityProvider enabled=\{isWorldbuilding\} revision=\{CONTINUITY_VIEWS\.has\(view\)/);
  // …and only on views that can show one: ten queries arriving mid-gesture on the Leaflet
  // canvas is work competing with what the writer is doing.
  assert.match(badge, /export const CONTINUITY_VIEWS/);
  assert.doesNotMatch(badge, /CONTINUITY_VIEWS = new Set\(\[[^\]]*'map'/);
  assert.match(badge, /useDataRefresh\(reload\)/);
  assert.match(view, /useContinuity\(\)/);
  // The section never edits the world behind the author's back: the only mechanical fix
  // is re-deriving the day chain.
  assert.match(view, /recomputeSceneDays/);
  assert.doesNotMatch(view, /updateCharacter|updateScene|updateWorldPlace/);
});

test('a conflict is an encyclopedia entry and an arc is not', async () => {
  const [encyclopedia, types] = await Promise.all([
    read('shared/worldEncyclopedia.ts'),
    read('shared/types.ts'),
  ]);
  // A war is a thing the world contains and a reader can be told about, so `[[la Guerra de
  // los Tres Ríos]]` resolves. An ARC is spoiler by nature — indexing it would put the end
  // of the book in the index.
  assert.match(types, /export type WorldEntryKind = .*'conflict'/);
  assert.doesNotMatch(types, /export type WorldEntryKind = .*'arc'/);
  assert.match(encyclopedia, /WORLD_ENTRY_KINDS: WorldEntryKind\[\] = \[[^\]]*'conflict'/);
});

test('conflicts open on the board, and are created from the scene', async () => {
  const [view, sidebar, app] = await Promise.all([
    read('src/views/ConflictsView.tsx'),
    read('src/components/WorldbuildingSidebar.tsx'),
    read('src/App.tsx'),
  ]);
  // The board is the product; the CRUD around it is infrastructure.
  assert.match(view, /useState<'board' \| 'list'>\('board'\)/);
  assert.match(sidebar, /\{ label: 'Conflictos', icon: 'scale', view: 'conflicts' \}/);
  assert.match(app, /view === 'conflicts' && <ConflictsView onNavigate=\{setView\} \/>/);
  // The primary creation path is the scene strip, so the sheet never writes a beat.
  assert.doesNotMatch(view, /setWorldBeat/);
});

test('Arcs is a reading, and «Tramas» is gone', async () => {
  const [view, sidebar, app] = await Promise.all([
    read('src/views/ArcsView.tsx'),
    read('src/components/WorldbuildingSidebar.tsx'),
    read('src/App.tsx'),
  ]);
  // A plot IS a thread with kind='arc' and no character subject. Shipping both guarantees
  // two lists of the same thing that disagree within a week.
  assert.doesNotMatch(sidebar, /'Tramas'/);
  assert.match(sidebar, /\{ label: 'Arcos narrativos', icon: 'route', view: 'arcs' \}/);
  assert.match(app, /view === 'arcs' && <ArcsView onNavigate=\{setView\} \/>/);

  // Nothing here writes: the milestones are marked on the scene sheet.
  assert.doesNotMatch(view, /setWorldBeat|updateWorldThread|createWorldThread|deleteWorldThread/);
  // One axis, the story. A chronological toggle would draw a line nobody reads.
  // Asserted against CODE, not prose: the first version of this matched the comment
  // that explains why the toggle does not exist.
  const code = view.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert.doesNotMatch(code, /chronological/);
  assert.match(view, /listScenes\('narrative'\)/);
  // Native SVG rather than a chart library: three shapes and a line is not a chart.
  assert.match(view, /<svg/);
  // …and it reuses the shared filter bar verbatim rather than growing its own.
  assert.match(view, /WorldFilterBar/);
  assert.match(view, /applyWorldFilter/);
});

test('a rule is an encyclopedia entry, and its price is a field of its own', async () => {
  const [types, encyclopedia, view, reader] = await Promise.all([
    read('shared/types.ts'),
    read('shared/worldEncyclopedia.ts'),
    read('src/views/RulesView.tsx'),
    read('src/components/world/WorldEntryReader.tsx'),
  ]);
  assert.match(types, /export type WorldEntryKind = .*'rule'/);
  assert.match(encyclopedia, /WORLD_ENTRY_KINDS: WorldEntryKind\[\] = \[[^\]]*'rule'/);
  // The price is a field, not a paragraph inside the statement: the whole diagnostic layer
  // asks one question of it.
  assert.match(view, /save\(\{ cost: value \}\)/);
  assert.match(view, /save\(\{ limits: value \}\)/);
  // A rule is a CHILD of the article it came from.
  assert.match(reader, /data-testid="entry-make-rule"/);
  assert.match(reader, /articleId=\{entry\.id\}/);
});

test('the price question lives in the scene, with three states', async () => {
  const panel = await read('src/components/world/RulesInPlay.tsx');
  // Prepopulated from the link graph, the place and the cast: the author ANSWERS.
  assert.match(panel, /rulesInPlay\(scene\.sceneId\)/);
  // Three states. "I have not looked" is not "the price is missing", and collapsing them
  // turns every fresh mark into an accusation.
  // The testids are built from the value, so they never appear as a literal attribute.
  assert.match(panel, /'rule-paid-yes' : 'rule-paid-no'/);
  assert.match(panel, /beat\.paid == null/);
});
