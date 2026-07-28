import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the download resolver returns full internal images and rejects thumbnails or external URLs', async () => {
  const tmp = await mkdtemp(path.join(root, 'node_modules/.nodus-image-download-'));
  try {
    const outfile = path.join(tmp, 'imageProtocol.mjs');
    await build({
      entryPoints: [path.join(root, 'electron/imageProtocol.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      plugins: [{
        name: 'image-download-stubs',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'download-stub' }));
          builder.onLoad({ filter: /^electron$/, namespace: 'download-stub' }, () => ({
            contents: 'export const protocol = { registerSchemesAsPrivileged(){}, handle(){} };',
            loader: 'js',
          }));
          builder.onResolve({ filter: /\/db\/entitiesRepo$/ }, () => ({ path: 'entities', namespace: 'download-stub' }));
          builder.onLoad({ filter: /^entities$/, namespace: 'download-stub' }, () => ({
            contents: `
              export const getPersonPortrait = id => ({ blob: Buffer.from('portrait:' + id), mime: 'image/png' });
              export const getPersonPortraitThumbnail = id => ({ blob: Buffer.from('thumb:' + id), mime: 'image/jpeg' });
            `,
            loader: 'js',
          }));
          builder.onResolve({ filter: /\/db\/worldImagesRepo$/ }, () => ({ path: 'world', namespace: 'download-stub' }));
          builder.onLoad({ filter: /^world$/, namespace: 'download-stub' }, () => ({
            contents: `
              export const getWorldImageBlob = id => ({ blob: Buffer.from('world:' + id), mime: 'image/webp' });
              export const getWorldImageThumbnail = id => ({ blob: Buffer.from('thumb:' + id), mime: 'image/jpeg' });
            `,
            loader: 'js',
          }));
          builder.onResolve({ filter: /\/db\/worldMapsRepo$/ }, () => ({ path: 'maps', namespace: 'download-stub' }));
          builder.onLoad({ filter: /^maps$/, namespace: 'download-stub' }, () => ({
            contents: `
              export const getMapImageBlob = id => ({ blob: Buffer.from('map:' + id), mimeType: 'image/png' });
              export const getMapThumbnail = id => ({ blob: Buffer.from('thumb:' + id), mimeType: 'image/jpeg' });
            `,
            loader: 'js',
          }));
          builder.onResolve({ filter: /\/db\/characterChatRepo$/ }, () => ({ path: 'chat', namespace: 'download-stub' }));
          builder.onLoad({ filter: /^chat$/, namespace: 'download-stub' }, () => ({
            contents: `
              export const getCharacterChatImageBlob = id => ({ blob: Buffer.from('chat:' + id), mime: 'image/png' });
              export const getCharacterChatImageThumbnail = id => ({ blob: Buffer.from('thumb:' + id), mime: 'image/jpeg' });
            `,
            loader: 'js',
          }));
        },
      }],
      logLevel: 'silent',
    });
    const { originalImagePayloadFromUrl } = await import(pathToFileURL(outfile).href);
    const portrait = originalImagePayloadFromUrl('nodus-image://portrait/person-1?v=3');
    assert.equal(portrait.blob.toString(), 'portrait:person-1');
    assert.equal(portrait.mime, 'image/png');
    assert.equal(
      originalImagePayloadFromUrl('nodus-image://map/map-image-1').blob.toString(),
      'map:map-image-1',
    );
    assert.equal(originalImagePayloadFromUrl('nodus-image://portrait-thumbnail/person-1'), null);
    assert.equal(originalImagePayloadFromUrl('nodus-image://world-thumbnail/image-1'), null);
    assert.equal(originalImagePayloadFromUrl('https://example.com/image.png'), null);
    assert.equal(originalImagePayloadFromUrl('file:///private/secret.png'), null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('the shared lightbox exposes an icon button that downloads its current full source', async () => {
  const [lightbox, ipc, preload, types, maps] = await Promise.all([
    readFile(path.join(root, 'src/components/ImageLightbox.tsx'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(root, 'shared/types.ts'), 'utf8'),
    readFile(path.join(root, 'src/views/WorldMapsView.tsx'), 'utf8'),
  ]);
  assert.ok(lightbox.includes('data-testid="image-lightbox-download"'));
  assert.ok(lightbox.includes("Icon name={downloading ? 'sync' : 'download'}"));
  assert.ok(lightbox.includes('downloadOriginalImage(current.src, current.label || current.alt)'));
  assert.ok(ipc.includes("h('images:downloadOriginal'"));
  assert.ok(ipc.includes('originalImagePayloadFromUrl(source)'));
  assert.ok(ipc.includes('fs.writeFileSync(picked.filePath, image.blob)'), 'the exact repository BLOB is written');
  assert.ok(preload.includes("ipcRenderer.invoke('images:downloadOriginal'"));
  assert.ok(types.includes('downloadOriginalImage('));
  assert.ok(maps.includes('data-testid="world-map-download-original"'));
  assert.ok(maps.includes('downloadOriginalImage(imageUrl, map.name)'));
});
