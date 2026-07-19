import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-ai-'));

try {
  const outfile = path.join(tmp, 'catalog.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/localAiModels.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const catalog = await import(pathToFileURL(outfile).href);
  const embeddings = catalog.NODUS_LOCAL_MODELS.filter((model) => model.kind === 'embedding');
  const chat = catalog.NODUS_LOCAL_MODELS.filter((model) => model.kind === 'chat');
  assert.deepEqual(embeddings.map((model) => model.label), [
    'BGE-M3 Q8_0', 'GTE Multilingual Base INT8', 'Multilingual E5 Small INT8',
  ]);
  assert.deepEqual(chat.map((model) => model.label), [
    'Qwen3.5-0.8B Q4', 'Gemma 4 E2B Q4', 'Granite 4.0 Micro Q4', 'LFM2.5-VL-1.6B Q4',
  ]);
  // Vision chat models must ship their projector; text-only chat models (Granite) must not need one.
  assert.ok(chat.every((model) => (model.vision ? Boolean(model.projectorFile) : !model.projectorFile)),
    'vision models download a projector; text models do not');
  // The extraction gate that guards the scan roles: only Gemma and Granite are trusted to extract.
  assert.deepEqual(chat.filter((model) => model.supportsExtraction).map((model) => model.label),
    ['Gemma 4 E2B Q4', 'Granite 4.0 Micro Q4']);
  assert.ok(catalog.NODUS_LOCAL_MODELS.every((model) => model.assets.every((asset) => asset.bytes > 0)), 'every asset has an expected byte size');
  assert.ok(catalog.NODUS_LOCAL_MODELS.every((model) => model.assets.filter((asset) => asset.bytes > 1_000_000).every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))), 'large assets are pinned by SHA-256');

  const [manager, aiClient, ipc, preload, settings, ui, providers, studyPolicy] = await Promise.all([
    readFile(path.join(root, 'electron/ai/nodusLocalAi.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/aiClient.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(root, 'src/views/Settings.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/LocalAiModelsSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'shared/providers.ts'), 'utf8'),
    readFile(path.join(root, 'shared/studyAi.ts'), 'utf8'),
  ]);
  assert.match(manager, /\.download/, 'downloads use partial files before atomic rename');
  assert.match(manager, /fsp\.stat\(`\$\{path\.join\(directory, asset\.file\)\}\.download`\)/, 'status includes bytes from an in-progress partial asset');
  assert.match(manager, /createHash\('sha256'\)/, 'downloads verify SHA-256');
  assert.match(manager, /'--mmproj'/, 'llama-server receives the multimodal projector');
  assert.match(manager, /'--embedding', '--pooling', 'mean'/, 'BGE runs through llama.cpp embedding mode');
  assert.match(manager, /pipeline\('feature-extraction'/, 'INT8 ONNX models run through Transformers.js');
  assert.match(manager, /model\.runtime === 'llama_cpp'.*llamaServerPath/s, 'llama.cpp is installed automatically before a dependent model download');
  assert.match(manager, /installNodusLocalRuntime.*downloadModelAssets/s, 'runtime installation continues immediately into the requested model download');
  assert.match(manager, /activeRuntimeDownload.*ActiveLocalAiDownload/s, 'runtime downloads persist in main-process state');
  assert.match(manager, /activeDownloads\.get\(model\.id\)/, 'model status reconnects to a main-process download job');
  assert.match(manager, /return followDownload\(running, onProgress\)/, 'duplicate requests follow the existing download');
  assert.match(aiClient, /ensureNodusLocalServer\(model\.model, 'chat'\)/, 'chat completions start the managed local server');
  assert.match(aiClient, /embedWithNodusLocal/, 'embedding calls route to the integrated runtime');
  assert.match(ipc, /ai:nodusLocal:downloadModel/, 'main IPC exposes model downloads');
  assert.match(ipc, /if \(!event\.sender\.isDestroyed\(\)\) event\.sender\.send\('ai:nodusLocal:progress'/, 'progress cannot abort a download after its renderer is destroyed');
  assert.match(preload, /ai:nodusLocal:progress/, 'preload forwards download progress safely');
  assert.match(settings, /Cambiar modelo de embeddings/, 'embedding changes require an explicit compatibility confirmation');
  assert.match(ui, /ConfirmModal/, 'deleting a local model uses the styled confirmation modal');
  assert.match(ui, /no son compatibles y deberán regenerarse/, 'the permanent embedding compatibility reminder is visible');
  assert.match(ui, /nodus-local-embedding-list/, 'embedding models use the shared settings list pattern');
  assert.match(ui, /nodus-local-chat-list/, 'chat models use the shared settings list pattern');
  assert.match(ui, /Preparando motor…/, 'the UI explains the automatic dependency stage');
  assert.match(ui, /status\?\.runtime\.downloading \|\| status\?\.models\.some\(\(model\) => model\.downloading\)/, 'the UI restores active transfers from the status snapshot');
  assert.match(ui, /window\.setInterval\(\(\) => \{[\s\S]*refresh\(\)/, 'a remounted settings view follows the persistent download through completion');
  assert.match(ui, /await window\.nodus\.downloadNodusLocalModel\(model\.id, setProgress\)/, 'one main-process request owns runtime preparation and model download');
  assert.doesNotMatch(ui, /await window\.nodus\.installNodusLocalRuntime\([\s\S]{0,300}await window\.nodus\.downloadNodusLocalModel/, 'the renderer does not split a model transfer into dependent stages');
  assert.match(ui, /nodus-local-download-progress/, 'rehydrated progress has a stable UI hook');
  assert.match(ui, /exposeDownloadedChatModels/, 'downloaded local chat models are exposed to the shared dropdowns');
  assert.doesNotMatch(ui, /SettingsModelDot|selectedEmbedding|selectedGeneral|selectedVision/, 'the download catalog must not present models as active selections');
  assert.doesNotMatch(ui, /onSelectEmbedding|selectChat|Usar para embeddings|Usar como general|Usar para visión|Modelo general|Modelo de visión/, 'model assignment belongs exclusively to the shared dropdowns');
  assert.doesNotMatch(ui, /lg:grid-cols-3/, 'local model catalogs do not regress to card grids');
  assert.match(providers, /nodus: 'Nodus local'/, 'the integrated provider has a user-facing label');
  assert.match(studyPolicy, /model\.provider === 'nodus'/, 'local-only study policy accepts managed Nodus models');

  console.log('Integrated local AI model tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
