import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('the places tree draws explicit hierarchy connectors', async () => {
  const workspace = await read('src/components/world/WorldWorkspace.tsx');
  assert.match(workspace, /data-testid=\{`\$\{section\.id\}-tree`\}/);
  assert.match(workspace, /border-b border-l border-neutral-300 dark:border-neutral-700\/80/);
  assert.match(workspace, /children\.has\(id\) && <ul className="ml-3 pl-2">/);
});

test('place sheets reuse their ordered gallery cover as a horizontal header', async () => {
  const places = await read('src/views/PlacesView.tsx');
  assert.match(places, /const cover = images\[0\] \?\? null/);
  assert.match(places, /aspect-\[21\/8\]/);
  assert.match(places, /onImagesChange=\{setImages\}/);
  assert.match(places, /<ImageLightbox/);
});

test('the shared lightbox supports keyboard and thumbnail gallery navigation', async () => {
  const viewer = await read('src/components/ImageLightbox.tsx');
  assert.match(viewer, /event\.key === 'ArrowLeft'/);
  assert.match(viewer, /event\.key === 'ArrowRight'/);
  assert.match(viewer, /data-testid="image-lightbox-thumbnails"/);
  assert.match(viewer, /object-contain/);
  assert.match(viewer, /document\.body\.style\.overflow = 'hidden'/);
});

test('place and character images all open the shared gallery viewer', async () => {
  const [worldGallery, characterGallery, portraitEditor] = await Promise.all([
    read('src/components/world/WorldGallery.tsx'),
    read('src/components/CharacterGallery.tsx'),
    read('src/components/CharacterPortraitEditor.tsx'),
  ]);
  assert.match(worldGallery, /<ImageLightbox/);
  assert.match(characterGallery, /<ImageLightbox/);
  assert.match(characterGallery, /personPortraitUrl\(character\)/);
  assert.match(portraitEditor, /listCharacterImages\(character\.personId\)/);
  assert.match(portraitEditor, /<ImageLightbox/);
});
