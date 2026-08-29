import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');

test('published genealogy tree uses the canonical Desktop geometry and relation semantics', async () => {
  const source = variants(await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8'));
  assert.match(source, /computeTreeLayout\(/, 'Web tree must share the Desktop layout algorithm');
  assert.match(source, /buildTreeFamilies\(/, 'parent edges must be grouped into the same family trunks');
  assert.match(source, /row\.type === 'parent'/, 'parent direction is preserved');
  assert.match(source, /row\.type === 'spouse'/, 'spouse edges are preserved');
  assert.match(source, /row\.type === 'sibling'/, 'sibling edges are preserved');
  assert.match(source, /orientation/, 'orientation is a real layout input, not an SVG-only rotation');
  assert.match(source, /treeFamilyLaneY\(/, 'family connectors occupy the canonical inter-generation lane');
});

test('published genealogy tree keeps Desktop reader interactions and safe navigation', async () => {
  const source = variants(await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8'));
  assert.match(source, /data-testid="tree-focus-person"/);
  assert.match(source, /data-testid="tree-search-input"/);
  assert.match(source, /data-testid="tree-pan-viewport"/);
  assert.match(source, /data-testid="tree-orientation"/);
  assert.match(source, /data-testid="tree-branch-color-controls"/);
  assert.match(source, /data-testid="tree-paternal-visibility"/);
  assert.match(source, /data-testid="tree-maternal-visibility"/);
  assert.match(source, /useIsLightTheme\(\)/, 'branch colors adapt to the active light or dark theme');
  assert.match(source, /deriveTreeKinship\(/, 'branch membership uses the shared Desktop kinship derivation');
  assert.match(source, /data-testid="tree-svg"/);
  assert.match(source, /data-testid="tree-person-node"/);
  assert.match(source, /onDoubleClick=\{\(\) => setFocusAndCenter\(node\.personId\)\}/);
  assert.match(source, /onOpenPerson\?\.\(person\)/, 'person dossiers remain reachable from tree nodes');
  assert.match(source, /api\.assetUrl\(spaceId, hash\)/, 'portraits use published asset references only');
  assert.match(source, /parseHistoricalDate\(/, 'historical birth years feed deterministic couple ordering');
  assert.doesNotMatch(source, /index \* 190|index \* 150/, 'coordinates are not fabricated from row indexes');
});

test('published genealogy timeline keeps Desktop person and event-type filters', async () => {
  const [web, api] = await Promise.all([
    readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8').then(variants),
    readFile(path.join(root, 'server/lib/routes/corpus.mjs'), 'utf8').then(variants),
  ]);
  assert.match(web, /testId="timeline-person-filter"/);
  assert.match(web, /testId="timeline-type-filter"/);
  assert.match(web, /data-testid="timeline-event-card"/);
  assert.match(web, /selectedPersonIds\.length === 0/);
  assert.match(web, /selectedTypes\.length === 0/);
  assert.match(api, /function publishedEvents\(snapshot\)/);
  assert.match(api, /participants: participants\.filter/);
  assert.match(api, /place_name: place\?\.name/);
});
