// Verifies that the post-batch graph maintenance refreshes the embeddings of the ideas
// it re-themes, and only those.
//
// An idea's embedding text includes its theme labels. chainAfterDeep embeds each work
// right after its deep scan, but reprocessConnections runs later (once the queue
// drains) and rewrites those theme links — for the scanned works and for any fused
// idea they share with other works. Without a second pass, every freshly scanned book
// was left mostly "stale" in the semantic index. This checks:
//
//   1. The order: per-work embed → reprocess → refresh of the re-themed ideas → bridge
//      discovery. Never a library-wide pass: it would also re-embed every idea an older
//      embedding model produced, a paid rebuild of the whole library.
//   2. A failing refresh does not fail the maintenance pass (a retry would redo the
//      whole model-driven reprocess) and bridge discovery still runs.
//   3. Without an embedding provider, or with nothing re-themed, there is no refresh.
//
// Part of the suite (`node --test scripts/test-*.mjs`): exit code 0 means the order
// holds, 1 lists what broke.
// Run alone: node scripts/test-post-batch-reembed.mjs

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

async function bundleScanQueue(name) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `nodus-${name}-`));
  const outfile = path.join(directory, 'bundle.mjs');
  const stubs = [
    [/\.\.\/db\/database$/, 'db', `
      export function getDb() {
        return { prepare: () => ({ get: (id) => ({ nodus_id: id, zotero_key: id, title: id, doi: null, item_type: 'journalArticle', authors_json: '[]', deep_hash: 'stale', source_type: 'pdf', notes: null }), all: () => [], run: () => ({ changes: 1 }) }) };
      }
    `],
    [/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return globalThis.__reembedProbe.settings; }`],
    [/\.\.\/ai\/lightScan$/, 'light', `export async function runLightScan() {}`],
    [/\.\.\/ai\/deepScan$/, 'deep', `export function issueDeepScanPublicationOrdinal() { return 1; } export function finishDeepScanPublicationOrdinal() {} export async function runDeepScan() {}`],
    [/\.\.\/ai\/summaryScan$/, 'summary', `export async function runSummaryScan() {}`],
    [/\.\.\/ai\/reprocessConnections$/, 'reprocess', `
      export async function reprocessConnections(options) {
        globalThis.__reembedProbe.calls.push({ step: 'reprocess', ids: options.nodusIds });
        return { relationsAdded: 0, newThemes: 0, rethemedIdeaIds: globalThis.__reembedProbe.rethemed };
      }
    `],
    [/\.\.\/db\/themesRepo$/, 'themes', `export function listThemeLabels() { return []; }`],
    [/\.\.\/extraction\/textExtractor$/, 'text', `export async function resolveWorkText() { return { text: 'paper text', segments: [] }; } export function resolvedTextStateFromDoc() { return {}; }`],
    [/\.\.\/zotero\/zoteroClient$/, 'zotero', `export async function getItem() { return { abstract: 'abstract' }; }`],
    [/\.\.\/db\/worksRepo$/, 'works', `export function clearDeepQueued() {} export function setDeepPending() {} export function setDeepResult() {} export function setResolvedTextState() {} export function setSummaryPending() {}`],
    [/\.\.\/db\/workSummariesRepo$/, 'summaries', `export function failedSummaryWorks() { return []; } export function pendingSummaryWorks() { return []; }`],
    [/\.\.\/ai\/aiClient$/, 'ai', `export class AiError extends Error { constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; } }`],
    [/\.\.\/ai\/semanticBridges$/, 'bridges', `
      export async function discoverSemanticBridges() {
        globalThis.__reembedProbe.calls.push({ step: 'bridges' });
        return { added: 0, validated: 0, candidatesScanned: 0 };
      }
    `],
    [/\.\.\/ai\/embeddingPipeline$/, 'embeddings', `
      export async function startEmbedding(nodusIds, options = {}) {
        const probe = globalThis.__reembedProbe;
        // The post-reprocess refresh is the call scoped to ideas; only that one is made to fail.
        if (options.ideaIds) {
          probe.calls.push({ step: 'refresh', ids: [...options.ideaIds] });
          if (probe.failLibraryEmbed) throw new Error('embedding backend down');
          return;
        }
        probe.calls.push({ step: 'embed', ids: nodusIds });
      }
    `],
    [/\.\.\/ai\/passageEmbeddingPipeline$/, 'passages', `export async function startPassageEmbedding(nodusIds) { globalThis.__reembedProbe.calls.push({ step: 'passages', ids: nodusIds }); }`],
    [/\.\.\/perf$/, 'perf', `export function startPerf() { return () => {}; }`],
    [/\.\.\/notifications$/, 'notifications', `export function addNotification() {}`],
    [/\.\.\/util\/coalesce$/, 'coalesce', `export function coalesce(fn) { return { schedule: fn }; }`],
    [/@shared\/nodiNotifications$/, 'nodi', `export function nodiText(key) { return key; }`],
  ];
  await build({
    entryPoints: [path.join(repoRoot, 'electron/pipeline/scanQueue.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    plugins: [{
      name,
      setup(api) {
        for (const [filter, module, contents] of stubs) {
          api.onResolve({ filter }, () => ({ path: module, namespace: 'stub' }));
          api.onLoad({ filter: new RegExp(`^${module}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
        }
      },
    }],
  });
  return { module: await import(pathToFileURL(outfile)), directory };
}

function settings(embeddingProvider) {
  return {
    aiConcurrencyMode: 'manual', concurrency: 1, autoBridgeAfterQueue: true, autoSummaryAfterDeep: false,
    embeddingProvider, providerKeys: { openai: false }, zoteroUserId: '', zoteroStoragePath: '', unpaywallEmail: '',
    preferZoteroFulltext: false, ocrEnabled: false, ocrLanguages: [], ocrMaxPages: 0, themesLocked: false,
    synthesisModel: null, relationModel: null, fusionModel: null,
  };
}

async function scenario(name, { embeddingProvider, failLibraryEmbed = false, expectBridges, rethemed = ['idea-a', 'idea-b'] }) {
  const probe = { calls: [], failLibraryEmbed, rethemed, settings: settings(embeddingProvider) };
  globalThis.__reembedProbe = probe;
  const { module, directory } = await bundleScanQueue(name);
  try {
    module.scanQueue.enqueue('paper-1', 'Macrocycles', 'deep');
    const settled = () => {
      const snapshot = module.scanQueue.snapshot();
      const reprocessed = probe.calls.some((call) => call.step === 'reprocess');
      const bridged = !expectBridges || probe.calls.some((call) => call.step === 'bridges');
      return reprocessed && bridged && !snapshot.maintenanceRunning;
    };
    const deadline = Date.now() + 4000;
    while (!settled() && Date.now() < deadline) await delay(10);
    if (!settled()) throw new Error(`timeout: ${name}`);
    await delay(50);
    return { calls: probe.calls, snapshot: module.scanQueue.snapshot() };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const describe = (calls) => calls.map((call) => call.ids === undefined ? call.step : `${call.step}(${call.ids.join(',')})`).join(' → ');
const indexOf = (calls, predicate) => calls.findIndex(predicate);

console.log('Verificando que el mantenimiento tras la cola reindexa las ideas re-tematizadas…\n');

// ── 1. Order with a local embedding provider ──────────────────────────────────
const ordered = await scenario('reembed-order', { embeddingProvider: 'nodus', expectBridges: true });
console.log(`  Con proveedor local:   ${describe(ordered.calls)}`);
const perWork = indexOf(ordered.calls, (call) => call.step === 'embed' && call.ids?.[0] === 'paper-1');
const reprocess = indexOf(ordered.calls, (call) => call.step === 'reprocess');
const refresh = indexOf(ordered.calls, (call) => call.step === 'refresh');
const bridges = indexOf(ordered.calls, (call) => call.step === 'bridges');
assert(perWork >= 0, 'la obra escaneada debe indexarse justo después del análisis profundo');
assert(reprocess > perWork, 'el reprocesado de temas debe llegar después de la indexación por obra');
assert(refresh > reprocess, 'tras re-tematizar deben reindexarse las ideas re-tematizadas');
assert(JSON.stringify(ordered.calls[refresh]?.ids) === JSON.stringify(['idea-a', 'idea-b']), 'la reindexación recibe exactamente las ideas re-tematizadas');
assert(!ordered.calls.some((call) => call.step === 'embed' && call.ids === undefined), 'nunca una reindexación de toda la biblioteca');
assert(bridges > refresh, 'los puentes semánticos deben descubrirse con los vectores ya actualizados');
assert(ordered.snapshot.maintenanceError === null, 'el mantenimiento debe terminar sin error');

// ── 2. A failing refresh is not a failed maintenance pass ─────────────────────
const failing = await scenario('reembed-failure', { embeddingProvider: 'nodus', failLibraryEmbed: true, expectBridges: true });
console.log(`  Si la reindexación falla: ${describe(failing.calls)} · error=${failing.snapshot.maintenanceError ?? '—'}`);
assert(failing.snapshot.maintenanceError === null, 'un fallo de la reindexación no debe marcar el mantenimiento como fallido');
assert(failing.calls.filter((call) => call.step === 'reprocess').length === 1, 'un fallo de la reindexación no debe repetir el reprocesado con el modelo');
assert(failing.calls.some((call) => call.step === 'bridges'), 'los puentes deben ejecutarse aunque falle la reindexación');

// ── 3. No embedding provider → no refresh ─────────────────────────────────────
const lexical = await scenario('reembed-lexical', { embeddingProvider: 'openai', expectBridges: false });
console.log(`  Sin proveedor:         ${describe(lexical.calls)}`);
assert(!lexical.calls.some((call) => call.step === 'embed' || call.step === 'refresh'), 'sin proveedor de embeddings no debe intentarse ninguna indexación');

// ── 4. Nothing re-themed → no refresh ─────────────────────────────────────────
const unchanged = await scenario('reembed-unchanged', { embeddingProvider: 'nodus', expectBridges: true, rethemed: [] });
console.log(`  Sin cambios de temas:  ${describe(unchanged.calls)}`);
assert(!unchanged.calls.some((call) => call.step === 'refresh'), 'si ningún tema cambió no hay reindexación');

console.log('\n──────── Resultado ────────');
if (failures.length === 0) {
  console.log('OK: las ideas re-tematizadas se reindexan antes de buscar puentes.');
  process.exit(0);
}
console.log(`FALLO: ${failures.length} comprobaciones sin cumplir.`);
for (const failure of failures) console.log(`  · ${failure}`);
process.exit(1);
