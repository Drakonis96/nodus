import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('portrait overlays have an explicit light palette', async () => {
  const [ui, characters, css] = await Promise.all([
    read('src/components/ui.tsx'),
    read('src/views/CharactersView.tsx'),
    read('src/index.css'),
  ]);

  assert.match(ui, /ai-image-badge/);
  assert.doesNotMatch(ui, /ai-image-badge[^`]*bg-black/);
  assert.match(characters, /character-card-role-badge/);
  assert.doesNotMatch(characters, /character-card-role-badge[^"]*bg-black/);
  assert.match(css, /\.light \.ai-image-badge,/);
  assert.match(css, /\.light\.worldbuilding \.character-card-role-badge/);
  assert.match(css, /background-color: rgba\(255, 255, 255, 0\.84\)/);
  assert.match(css, /color: #262626/);
});

test('encyclopedia-specific surfaces do not rely on generic theme overrides', async () => {
  const [view, workspace, css] = await Promise.all([
    read('src/views/EncyclopediaView.tsx'),
    read('src/components/world/WorldWorkspace.tsx'),
    read('src/index.css'),
  ]);

  assert.match(view, /encyclopedia-entry-row/);
  assert.match(view, /encyclopedia-stub-badge/);
  assert.match(workspace, /encyclopedia-letter-heading/);
  assert.match(css, /\.light\.worldbuilding \.encyclopedia-entry-row:hover/);
  assert.match(css, /\.light\.worldbuilding \.encyclopedia-stub-badge/);
  assert.match(css, /\.light\.worldbuilding \.encyclopedia-letter-heading/);
  assert.match(css, /\[data-testid='entry-reader'\] \.md a/);
});

test('map image overlays keep contrast while map chrome follows the light theme', async () => {
  const [view, canvas, tools, timeline, css] = await Promise.all([
    read('src/views/WorldMapsView.tsx'),
    read('src/components/world/WorldMapCanvas.tsx'),
    read('src/components/world/mapTools.tsx'),
    read('src/components/world/mapTimeline.tsx'),
    read('src/index.css'),
  ]);

  assert.match(view, /world-map-image-badge/);
  assert.doesNotMatch(view, /bg-neutral-950\/80[^"]*text-neutral-300/);
  assert.match(canvas, /world-map-image-pill/);
  assert.match(tools, /world-map-scale-rule/);
  assert.match(tools, /world-map-image-overlay-text/);
  assert.match(tools, /world-map-image-pill[^"]*" data-testid="map-no-scale"/);
  assert.match(view, /world-map-timeline-dock/);
  assert.match(timeline, /world-map-cast-chip-current/);
  assert.doesNotMatch(timeline, /backgroundColor: 'rgba\(255,255,255,.06\)'/);

  assert.match(css, /\.world-map-image-badge,\s*\n\.world-map-image-pill/);
  assert.match(css, /background-color: rgba\(10, 10, 11, \.78\)/);
  assert.match(css, /\.world-map-image-overlay-text[\s\S]{0,140}color: rgba\(255, 255, 255, \.95\)/);
  assert.match(css, /\.light \.world-map-timeline-dock[\s\S]{0,140}background-color: rgba\(255, 255, 255, \.95\)/);
  assert.match(css, /\.light \.world-map-cast-chip-current[\s\S]{0,80}background-color: #f3f4f6/);
});

test('world analysis sections and their shared controls declare light and dark palettes', async () => {
  const files = [
    'src/views/WorldChatView.tsx',
    'src/views/RulesView.tsx',
    'src/views/ConflictsView.tsx',
    'src/views/ArcsView.tsx',
    'src/views/ContinuityView.tsx',
    'src/views/QuestionsView.tsx',
  ];
  const sources = await Promise.all(files.map(read));
  const unscopedDarkToken =
    /(?:^|[\s'"`])(?:bg-neutral-(?:900|950)(?:\/\d+)?|border-neutral-(?:700|800|900)(?:\/\d+)?|text-neutral-(?:100|200)|text-(?:indigo|red|amber)-300|bg-(?:indigo|red|amber|emerald)-950\/\d+)/m;

  for (let index = 0; index < files.length; index += 1) {
    assert.match(sources[index], /dark:/, `${files[index]} defines dark-mode counterparts`);
    assert.doesNotMatch(sources[index], unscopedDarkToken, `${files[index]} has no unscoped dark-only utility`);
  }

  const [workspace, filters, dossier, fields, ruleModal] = await Promise.all([
    read('src/components/world/WorldWorkspace.tsx'),
    read('src/components/world/WorldFilterBar.tsx'),
    read('src/components/personDossierLayout.ts'),
    read('src/components/AutoSavingField.tsx'),
    read('src/components/world/NewRuleModal.tsx'),
  ]);

  assert.match(workspace, /border-neutral-200[^"'`]*dark:border-neutral-800/);
  assert.match(workspace, /bg-indigo-100 text-indigo-900[^"'`]*dark:bg-violet-950\/30 dark:text-indigo-100/);
  assert.match(filters, /bg-white[^"'`]*dark:bg-neutral-950/);
  assert.match(filters, /bg-indigo-100 text-indigo-800[^"'`]*dark:border-indigo-600/);
  assert.match(dossier, /bg-neutral-50[^'"]*dark:bg-neutral-900\/40/);
  assert.match(fields, /text-indigo-700[^"'`]*dark:text-indigo-300/);
  assert.match(ruleModal, /bg-indigo-50[^"'`]*dark:bg-indigo-950\/20/);
});
