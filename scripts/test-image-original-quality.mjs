import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createCanvas, Image } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the shared storage pipeline preserves exact source bytes and derives only the thumbnail', async () => {
  const tmp = await mkdtemp(path.join(root, 'node_modules/.nodus-image-quality-'));
  try {
    const outfile = path.join(tmp, 'imageStorage.mjs');
    await build({
      entryPoints: [path.join(root, 'electron/imageStorage.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      external: ['@napi-rs/canvas'],
      plugins: [{
        name: 'stub-electron',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub-electron' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub-electron' }, () => ({
            contents: 'export const nativeImage = undefined;',
            loader: 'js',
          }));
        },
      }],
      logLevel: 'silent',
    });
    const { prepareImageStorage } = await import(pathToFileURL(outfile).href);
    const canvas = createCanvas(1800, 1200);
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 1800, 1200);
    gradient.addColorStop(0, '#1d3557');
    gradient.addColorStop(0.5, '#d4a373');
    gradient.addColorStop(1, '#6a040f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1800, 1200);
    const original = canvas.toBuffer('image/png');

    const stored = prepareImageStorage(original, 'image/jpeg');
    assert.ok(stored.image.equals(original), 'the full image remains byte-for-byte identical');
    assert.equal(stored.mimeType, 'image/png', 'the actual MIME wins over a stale declaration');
    assert.deepEqual([stored.width, stored.height], [1800, 1200]);
    assert.equal(stored.thumbnailMimeType, 'image/jpeg');
    const thumbnail = new Image();
    thumbnail.src = stored.thumbnail;
    assert.equal(Math.max(thumbnail.width, thumbnail.height), 480, 'only the list thumbnail is reduced');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('every worldbuilding demo visual has a larger lossless original beside its thumbnail', async () => {
  const assetDir = path.join(root, 'electron/assets/worldbuilding-demo');
  const originals = fs.readdirSync(assetDir).filter((file) => file.endsWith('.png')).sort();
  assert.equal(originals.length, 45);

  for (const originalName of originals) {
    const thumbnailName = originalName.replace(/\.png$/, '.webp');
    const originalPath = path.join(assetDir, originalName);
    const thumbnailPath = path.join(assetDir, thumbnailName);
    assert.ok(fs.existsSync(thumbnailPath), `${thumbnailName} exists`);

    const originalBytes = fs.readFileSync(originalPath);
    const thumbnail = new Image();
    thumbnail.src = fs.readFileSync(thumbnailPath);
    const originalWidth = originalBytes.readUInt32BE(16);
    const originalHeight = originalBytes.readUInt32BE(20);

    assert.ok(
      originalWidth * originalHeight > thumbnail.width * thumbnail.height * 2.4,
      `${originalName} carries materially more source detail`,
    );
    assert.ok(fs.statSync(originalPath).size > fs.statSync(thumbnailPath).size, `${originalName} is not the compressed derivative`);
  }
});

test('cards use thumbnails while lightboxes and editors request originals', async () => {
  const [portrait, characterPortrait, characterEditor, characterGallery, worldGallery, places, maps] = await Promise.all([
    readFile(path.join(root, 'src/components/PersonPortrait.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CharacterPortrait.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CharacterPortraitEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CharacterGallery.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/world/WorldGallery.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/PlacesView.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/world/WorldMapCanvas.tsx'), 'utf8'),
  ]);
  assert.ok(portrait.includes('personPortraitThumbnailUrl') && portrait.includes('personPortraitUrl'));
  assert.ok(characterPortrait.includes('fullResolution = false'), 'character cards default to thumbnails');
  assert.ok(characterEditor.includes('fullResolution'), 'the framing editor uses the source image');
  assert.ok(characterGallery.includes('worldImageThumbnailUrl(image)') && characterGallery.includes('src: worldImageUrl(image)'));
  assert.ok(worldGallery.includes('worldImageThumbnailUrl(image)') && worldGallery.includes('src: worldImageUrl(image)'));
  assert.ok(places.includes('src={worldImageUrl(cover)}'), 'the expanded place header uses the source');
  assert.ok(maps.includes('mapImageUrl(map.imageId)'), 'the zoomable map canvas uses the source');
});
