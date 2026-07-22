import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-image-model-'));

try {
  const output = path.join(temporary, 'catalog.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/localImageModels.ts')],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const catalog = await import(pathToFileURL(output).href);
  const model = catalog.NODUS_LOCAL_IMAGE_MODEL;
  assert.equal(model.id, 'flux-2-klein-4b-q4');
  assert.equal(model.quantization, 'Q4_0');
  assert.deepEqual(model.assets.map((asset) => asset.role), ['diffusion', 'text_encoder', 'vae', 'license', 'license']);
  assert.ok(model.assets.filter((asset) => asset.bytes > 1_000_000).every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)), 'every large artifact is pinned by SHA-256');
  assert.ok(model.assets.every((asset) => /resolve\/[a-f0-9]{40}\//.test(asset.url)), 'every artifact is pinned to an immutable Hugging Face revision');
  assert.ok(catalog.nodusLocalImageModelBytes() > 5_000_000_000, 'status includes the full diffusion, encoder and VAE download');
  assert.deepEqual(catalog.NODUS_IMAGE_QUALITY_PRESETS.map((preset) => preset.steps), [4, 4, 4], 'quality changes resolution without overriding the documented four-step schedule');
  assert.deepEqual(catalog.NODUS_IMAGE_QUALITY_PRESETS.map(({ width, height }) => [width, height]), [[640, 384], [896, 512], [1152, 640]]);

  const [manager, decorative, imageModels, ipc, preload, settings, ui, notices] = await Promise.all([
    readFile(path.join(root, 'electron/ai/nodusLocalImages.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/decorativeImages.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/imageModels.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(root, 'electron/db/settingsRepo.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/LocalImageModelSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
  ]);
  assert.match(manager, /stable-diffusion\.cpp\/releases\/download/);
  assert.match(manager, /createHash\('sha256'\)/);
  assert.match(manager, /'--diffusion-model'/);
  assert.match(manager, /'--llm'/);
  assert.match(manager, /'--vae'/);
  assert.match(manager, /'--steps', String\(preset\.steps\)/);
  assert.match(manager, /'--cfg-scale', '1\.0'/);
  assert.match(manager, /'--diffusion-fa'/);
  assert.match(manager, /'--vae-tiling'/);
  assert.match(manager, /generationTail/, 'native generations are serialized to protect unified memory');
  assert.match(decorative, /provider === 'nodus'.*generateNodusLocalImage/s, 'the production image path routes the local provider to the native engine');
  assert.match(imageModels, /NODUS_LOCAL_MODELS/, 'the shared image selector exposes the native model');
  assert.match(ipc, /ai:nodusLocalImage:downloadModel/);
  assert.match(preload, /ai:nodusLocalImage:progress/);
  assert.match(settings, /DEFAULT_NODUS_IMAGE_QUALITY/);
  assert.match(ui, /nodus-image-quality/);
  assert.match(ui, /Apache 2\.0/);
  assert.match(ui, /variante 9B.*no se descarga/s);
  assert.match(notices, /stable-diffusion\.cpp/);
  assert.match(notices, /FLUX\.2 \[klein\] 4B Q4/);
  assert.match(notices, /9B model.*not downloaded/s);
  console.log('Native FLUX.2 image model tests passed!');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
