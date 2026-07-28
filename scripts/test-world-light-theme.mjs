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
