import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('database images use the native cached protocol instead of renderer IPC copies', async () => {
  const [protocol, urls, portrait, worldGallery, characterGallery, maps, mapCanvas, placesMap, html] =
    await Promise.all([
      read('electron/imageProtocol.ts'),
      read('src/lib/imageUrl.ts'),
      read('src/components/PersonPortrait.tsx'),
      read('src/components/world/WorldGallery.tsx'),
      read('src/components/CharacterGallery.tsx'),
      read('src/views/WorldMapsView.tsx'),
      read('src/components/world/WorldMapCanvas.tsx'),
      read('src/components/PlacesMap.tsx'),
      read('index.html'),
    ]);

  assert.match(protocol, /protocol\.handle\(NODUS_IMAGE_SCHEME/);
  assert.match(protocol, /max-age=31536000, immutable/);
  assert.match(urls, /nodus-image:\/\/\$\{route\}/);
  assert.match(html, /img-src 'self' nodus-image:/);

  for (const source of [portrait, worldGallery, characterGallery, maps, mapCanvas, placesMap]) {
    assert.doesNotMatch(source, /get(?:PersonPortrait|WorldImageBlob|CharacterImageBlob|MapImageBlob|MapThumbnail)\(/);
  }
});

test('portrait metadata carries a cache revision', async () => {
  const [types, repo, urls] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/entitiesRepo.ts'),
    read('src/lib/imageUrl.ts'),
  ]);

  assert.match(types, /interface PortraitFocus[\s\S]*updatedAt\?: string/);
  assert.match(repo, /pp\.updated_at AS pf_updated_at/);
  assert.match(repo, /updatedAt: row\.pf_updated_at/);
  assert.match(urls, /person\.portrait\.updatedAt \?\? person\.updatedAt/);
});
