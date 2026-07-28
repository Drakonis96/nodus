import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-popovers-'));
const bundle = path.join(outDir, 'viewportPopover.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/viewportPopover.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' },
);

const { positionViewportPopover } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('a dropdown at the right edge stays inside the viewport', () => {
  const result = positionViewportPopover(
    { left: 850, right: 950, top: 100, bottom: 132 },
    { width: 240, height: 220 },
    { width: 960, height: 700 },
  );
  assert.equal(result.left, 712);
  assert.equal(result.left + result.width, 952);
});

test('a dropdown flips above its trigger when the bottom is crowded', () => {
  const result = positionViewportPopover(
    { left: 300, right: 400, top: 610, bottom: 642 },
    { width: 240, height: 260 },
    { width: 960, height: 700 },
  );
  assert.equal(result.placement, 'above');
  assert.equal(result.top, 346);
  assert.equal(result.maxHeight, 598);
});

test('a dropdown remains usable in a viewport narrower than its normal width', () => {
  const result = positionViewportPopover(
    { left: 4, right: 40, top: 10, bottom: 42 },
    { width: 240, height: 300 },
    { width: 180, height: 240 },
  );
  assert.equal(result.left, 8);
  assert.equal(result.width, 164);
  assert.ok(result.maxHeight > 0);
});

test('worldbuilding dropdowns use the portaled collision-aware panel', async () => {
  const [filters, timeline, popover, eventTypes, placePicker, characterDossier, personDossier] = await Promise.all([
    readFile(path.join(repoRoot, 'src/components/world/WorldFilterBar.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/world/mapTimeline.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/world/ViewportPopover.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/EventTypePicker.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ConfiguredPlacePicker.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/CharacterDossier.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/PersonDossier.tsx'), 'utf8'),
  ]);
  assert.match(filters, /<ViewportPopover/);
  assert.doesNotMatch(filters, /absolute left-0 top-full/);
  assert.match(timeline, /testId="map-cast-dropdown"/);
  assert.doesNotMatch(timeline, /className="absolute z-\[50\]/);
  assert.match(popover, /createPortal\(/);
  assert.match(popover, /positionViewportPopover/);
  assert.match(eventTypes, /<ViewportPopover/);
  assert.doesNotMatch(eventTypes, /createPortal\(/);
  assert.match(placePicker, /<ViewportPopover/);
  assert.match(placePicker, /findOrCreatePlace\(query\.trim\(\)\)/);
  assert.match(characterDossier, /<ConfiguredPlacePicker/);
  assert.match(personDossier, /<ConfiguredPlacePicker/);
  assert.doesNotMatch(characterDossier, /findOrCreatePlace/);
  assert.doesNotMatch(personDossier, /findOrCreatePlace/);
});
