// Verifies that the numbers on the queue bar's live line never move backwards:
// the fragment counter (x/y), the inline percentage derived from it, the
// per-fragment elapsed seconds, and the elapsed time of the work being shown.
//
// It runs the REAL producers (runDeepScan's chunk fan-out and scanQueue's
// scheduler) with a stubbed transport, because that is where the counters are
// produced; nothing here is a re-implementation of the display maths.
//
// Run: node scripts/verify-queue-progress-monotonic.mjs
// Exit code 0 means every counter is monotonic; 1 means the reported regression
// is reproducible (see the frame tables printed above the verdict).

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubber(api) {
  return (filter, name, contents) => {
    api.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
    api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
  };
}

async function bundle(entry, name, stubs) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `nodus-${name}-`));
  const outfile = path.join(directory, 'bundle.mjs');
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    plugins: [{ name, setup(api) { const stub = stubber(api); for (const [filter, module, contents] of stubs) stub(filter, module, contents); } }],
  });
  return { module: await import(pathToFileURL(outfile)), directory };
}

// ── Section 1: runDeepScan writes one shared line from N parallel chunk workers ──

const CHUNK_FRAME = /^Analizando fragmento (\d+)\/(\d+) con IA…(?: \((\d+)s\))?$/;
const FUSION_FRAME = /^Fusionando idea (\d+)\/(\d+)…$/;

async function deepScanFrames({ concurrencyMode, concurrency, chunkDurations, chunks }) {
  const probe = {
    settings: {
      deepContextMode: 'standard',
      deepStandardChunkWords: 400,
      deepLongChunkWords: 800,
      promptLanguage: 'es',
      themesLocked: false,
      extractionModel: null,
      fusionModel: null,
      synthesisModel: null,
      aiConcurrencyMode: concurrencyMode,
      concurrency,
    },
    chunkDurations,
    chunks,
  };
  globalThis.__deepScanProbe = probe;
  const { module, directory } = await bundle('electron/ai/deepScan.ts', 'deep-scan-probe', [
    [/^\.\/aiClient$/, 'aiClient', `
      export class AiError extends Error { constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; } }
      export async function embedMany() { return []; }
      export async function completeJson(request) {
        const probe = globalThis.__deepScanProbe;
        // jobId is "paper-1:deep:<chunk>:<depth>:<hash>". Split, never a regex: this
        // source travels inside a template literal and "\d" would collapse to "d".
        const index = Number(String(request.jobId ?? '').split(':')[2] ?? 0) || 0;
        await new Promise((resolve) => setTimeout(resolve, probe.chunkDurations[index] ?? 20));
        return {
          document: { processing_status: 'ok', type: 'research', language: 'en', notes: null },
          ideas: [{
            id: 'i1', type: 'claim', label: 'Idea del fragmento ' + index, statement: 'Enunciado ' + index,
            role: 'secondary', development: 'Enunciado ' + index, evidence: [], theme_labels: [], confidence: 0.8,
            uncertainty_reason: null,
          }],
          internal_relations: [], external_references: [], gaps: [], authors_detail: [],
        };
      }
    `],
    [/^\.\/prompts$/, 'prompts', `export function deepScanPrompt() { return 'prompt'; }`],
    [/^\.\/fusion$/, 'fusion', `
      export async function resolveIdeaFusion() { return { decision: null, plan: { kind: 'new' } }; }
      export function applyFusionPlan() { return 'global-idea'; }
    `],
    [/^\.\.\/db\/ideasRepo$/, 'ideasRepo', `
      export function upsertOccurrence() {} export function addEvidence() { return 'evidence'; }
      export function addEdge() {} export function purgeDeepData() {}
      export function embeddingTextForIdea() { return 'texto'; } export function assertDeepDataIntegrity() {}
    `],
    [/^\.\.\/db\/gapsRepo$/, 'gapsRepo', `export function addGap() {} export function addExternalRef() {}`],
    [/^\.\.\/db\/authorsRepo$/, 'authorsRepo', `
      export function canonicalKeyFromDisplay(name) { return String(name).toLowerCase(); }
      export function linkZoteroAuthors() {} export function recomputeAuthorRelations() {}
    `],
    [/^\.\.\/db\/worksRepo$/, 'worksRepo', `export function setDeepResult() {}`],
    [/^\.\.\/db\/themesRepo$/, 'themesRepo', `
      export function getWorkThemeLabels() { return []; } export function listThemeLabels() { return []; }
      export function normalizeThemeLabel(label) { return String(label).toLowerCase().trim(); }
      export function setIdeaThemeLinks() {} export function unionWorkThemes() {}
    `],
    [/^\.\.\/db\/scanCheckpointRepo$/, 'checkpoints', `
      export function loadCheckpoints() { return new Map(); } export function saveCheckpoint() {} export function clearCheckpoints() {}
    `],
    [/^\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return globalThis.__deepScanProbe.settings; }`],
    [/^\.\.\/extraction\/textExtractor$/, 'textExtractor', `
      export function planTextChunks() {
        const probe = globalThis.__deepScanProbe;
        const words = Array.from({ length: probe.chunks * 400 }, (_, index) => 'w' + index);
        return {
          mode: 'standard', chunks: Array.from({ length: probe.chunks }, (_, index) => words.slice(index * 400, (index + 1) * 400).join(' ')),
          wordCount: words.length, chunkWords: 400, overlapWords: 0,
          maxIdeasPerChunk: 8, maxRelationsPerChunk: 4, maxGapsPerChunk: 2,
        };
      }
    `],
    [/^\.\.\/perf$/, 'perf', `export function perfLog() {} export function startPerf() { return () => {}; }`],
    [/^\.\.\/library\/libraryVaultProvenance$/, 'vaultProvenance', `export function recordLinkedLibraryAnalysis() {}`],
    [/^\.\.\/db\/libraryAnalysisProvenance$/, 'analysisProvenance', `
      export function analysisFingerprint() { return 'fingerprint'; }
      export function analysisModelFingerprint() { return 'model-fingerprint'; }
      export function isLocalAnalysisCurrent() { return false; }
      export function recordLocalAnalysisProvenance() {}
    `],
    [/^\.\.\/db\/database$/, 'database', `export function getDb() { return { transaction: (fn) => fn }; }`],
    [/@shared\/localAiModels$/, 'localAiModels', `export function modelRefSupportsExtraction() { return true; }`],
  ]);
  try {
    const frames = [];
    const startedAt = Date.now();
    const work = {
      nodus_id: 'paper-1', zotero_key: 'z1', title: 'BitNet b1.58 2B4T Technical Report',
      authors_json: '[]', year: 2025, item_type: 'journalArticle',
      deep_hash: 'stale-hash', source_type: 'pdf', notes: null,
    };
    const doc = { text: 'texto', sourceType: 'pdf', notes: null, segments: [] };
    await module.runDeepScan(work, doc, null, (progress) => {
      frames.push({ at: Date.now() - startedAt, detail: progress.detail, pct: progress.pct });
    });
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function checkChunkPhase(frames) {
  const regressions = [];
  let maxIndex = 0;
  let maxPct = -1;
  let maxSeconds = 0;
  for (const frame of frames) {
    const chunk = CHUNK_FRAME.exec(frame.detail);
    if (!chunk) continue;
    const index = Number(chunk[1]);
    const seconds = chunk[3] === undefined ? null : Number(chunk[3]);
    if (index < maxIndex) regressions.push({ kind: 'fragmento', detail: frame.detail, previous: `fragmento ${maxIndex}`, at: frame.at });
    maxIndex = Math.max(maxIndex, index);
    if (typeof frame.pct === 'number') {
      if (frame.pct < maxPct) regressions.push({ kind: 'porcentaje', detail: frame.detail, previous: `${Math.round(maxPct * 100)}%`, at: frame.at });
      maxPct = Math.max(maxPct, frame.pct);
    }
    if (seconds !== null) {
      if (seconds < maxSeconds) regressions.push({ kind: 'segundos', detail: frame.detail, previous: `(${maxSeconds}s)`, at: frame.at });
      maxSeconds = Math.max(maxSeconds, seconds);
    }
  }
  return regressions;
}

function printFrames(title, frames) {
  console.log(`\n  ${title}`);
  for (const frame of frames) {
    const pct = typeof frame.pct === 'number' ? `${String(Math.round(frame.pct * 100)).padStart(3)}%` : '  —';
    console.log(`    [${String(frame.at).padStart(5)}ms] pct=${pct}  ${frame.detail}`);
  }
}

/** Repeated frames collapse to one entry so the report stays readable. */
function dedupe(entries) {
  return [...new Map(entries.map((entry) => [`${entry.kind}|${entry.previous}|${entry.detail}`, entry])).values()];
}

// ── Section 2: the bar shows the newest-started running work, so the displayed
// row (title, elapsed, fragment counter) switches while several are in flight ──

async function scanQueueFrames(durations) {
  const probe = { durations: {} };
  globalThis.__scanQueueProbe = probe;
  const { module, directory } = await bundle('electron/pipeline/scanQueue.ts', 'scan-queue-probe', [
    [/\.\.\/db\/database$/, 'db', `
      export function getDb() { return { prepare: () => ({ get: (id) => ({ nodus_id: id, zotero_key: 'z1', title: id, doi: null, item_type: 'journalArticle', authors_json: '[]', deep_hash: 'stale', source_type: 'pdf', notes: null }), all: () => [], run: () => ({ changes: 1 }) }) }; }
    `],
    [/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return { aiConcurrencyMode: 'automatic', concurrency: 1, autoBridgeAfterQueue: false, autoSummaryAfterDeep: false, embeddingProvider: 'openai', providerKeys: { openai: false }, zoteroUserId: '', zoteroStoragePath: '', unpaywallEmail: '', preferZoteroFulltext: false, ocrEnabled: false, ocrLanguages: [], ocrMaxPages: 0, themesLocked: false, synthesisModel: null }; }`],
    [/\.\.\/ai\/lightScan$/, 'light', `export async function runLightScan() {}`],
    [/\.\.\/ai\/deepScan$/, 'deep', `
      export function issueDeepScanPublicationOrdinal() { return 1; }
      export function finishDeepScanPublicationOrdinal() {}
      export async function runDeepScan(work, _doc, _model, onProgress) {
        const ms = globalThis.__scanQueueProbe.durations[work.nodus_id] ?? 100;
        onProgress?.({ detail: 'Analizando fragmento 1/4 con IA…', pct: 0 });
        await new Promise((resolve) => setTimeout(resolve, Math.round(ms * 0.4)));
        onProgress?.({ detail: 'Analizando fragmento 4/4 con IA… (1s)', pct: 0.75 });
        await new Promise((resolve) => setTimeout(resolve, Math.round(ms * 0.6)));
      }
    `],
    [/\.\.\/ai\/summaryScan$/, 'summary', `export async function runSummaryScan() {}`],
    [/\.\.\/ai\/reprocessConnections$/, 'reprocess', `export async function reprocessConnections() { return { relationsAdded: 0, newThemes: 0 }; }`],
    [/\.\.\/db\/themesRepo$/, 'themes', `export function listThemeLabels() { return []; }`],
    [/\.\.\/extraction\/textExtractor$/, 'text', `export async function resolveWorkText() { return { text: 'paper text', segments: [] }; } export function resolvedTextStateFromDoc() { return {}; }`],
    [/\.\.\/zotero\/zoteroClient$/, 'zotero', `export async function getItem() { return { abstract: 'abstract' }; }`],
    [/\.\.\/db\/worksRepo$/, 'works', `export function clearDeepQueued() {} export function setDeepPending() {} export function setDeepResult() {} export function setResolvedTextState() {} export function setSummaryPending() {}`],
    [/\.\.\/db\/workSummariesRepo$/, 'summaries', `export function failedSummaryWorks() { return []; } export function pendingSummaryWorks() { return []; }`],
    [/\.\.\/ai\/aiClient$/, 'ai', `export class AiError extends Error { constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; } }`],
    [/\.\.\/ai\/semanticBridges$/, 'bridges', `export async function discoverSemanticBridges() { return { added: 0, validated: 0, candidatesScanned: 0 }; }`],
    [/\.\.\/ai\/embeddingPipeline$/, 'embeddings', `export async function startEmbedding() {}`],
    [/\.\.\/ai\/passageEmbeddingPipeline$/, 'passages', `export async function startPassageEmbedding() {}`],
    [/\.\.\/perf$/, 'perf', `export function startPerf() { return () => {}; }`],
    [/\.\.\/notifications$/, 'notifications', `export function addNotification() {}`],
    [/\.\.\/util\/coalesce$/, 'coalesce', `export function coalesce(fn) { return { schedule: fn }; }`],
    [/@shared\/nodiNotifications$/, 'nodi', `export function nodiText(key) { return key; }`],
  ]);
  try {
    const frames = [];
    const startedAt = Date.now();
    // Mirrors QueueBar: the work shown is the FIRST running item, and the queue moves
    // every newly started item to the front of the running block.
    for (const [nodusId, ms] of Object.entries(durations)) probe.durations[nodusId] = ms;
    const off = module.scanQueue.onProgress(() => {
      const snapshot = module.scanQueue.snapshot();
      const displayed = snapshot.items.find((item) => item.state === 'running');
      frames.push({
        at: Date.now() - startedAt,
        title: displayed?.title ?? null,
        detail: displayed?.detail ?? null,
        subPct: displayed?.subPct ?? null,
        elapsedMs: displayed?.started_at ? Date.now() - Date.parse(displayed.started_at) : null,
        running: snapshot.items.filter((item) => item.state === 'running').length,
      });
    });
    for (const nodusId of Object.keys(durations)) module.scanQueue.enqueue(nodusId, nodusId, 'deep');
    await delay(Math.max(...Object.values(durations)) * 2 + 400);
    off();
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function checkDisplayedWork(frames) {
  const regressions = [];
  const seen = new Set();
  let maxElapsed = 0;
  for (const frame of frames) {
    if (frame.elapsedMs === null) continue;
    if (frame.elapsedMs + 50 < maxElapsed) {
      const entry = { kind: 'tiempo de la obra mostrada', detail: `${frame.title} · ${(frame.elapsedMs / 1000).toFixed(1)}s`, previous: `${(maxElapsed / 1000).toFixed(1)}s`, at: frame.at };
      const key = `${entry.previous}→${entry.detail}`;
      if (!seen.has(key)) { seen.add(key); regressions.push(entry); }
    }
    maxElapsed = Math.max(maxElapsed, frame.elapsedMs);
  }
  return regressions;
}

/** Rows where the bar silently re-points at a different work. */
function displaySwitches(frames) {
  const switches = [];
  let previousTitle = null;
  for (const frame of frames) {
    if (frame.title === null) continue;
    if (previousTitle !== null && frame.title !== previousTitle) {
      switches.push({ at: frame.at, from: previousTitle, to: frame.title, running: frame.running });
    }
    previousTitle = frame.title;
  }
  return switches;
}

// ── Report ────────────────────────────────────────────────────────────────────

const failures = [];

console.log('Verificando monotonicidad de los contadores del progreso…');

// 1a. Manual concurrency: two chunk workers overlap, the late one starts its own
// second counter and restarts the line while the first chunk is still running.
{
  const frames = await deepScanFrames({ concurrencyMode: 'manual', concurrency: 2, chunks: 3, chunkDurations: [3000, 1500, 3000] });
  printFrames('runDeepScan · modo manual (2 fragmentos en paralelo), 3 fragmentos', frames);
  const regressions = dedupe(checkChunkPhase(frames));
  for (const regression of regressions) failures.push({ section: 'runDeepScan (paralelo, modo manual)', ...regression });
  console.log(`    → ${regressions.length} retrocesos: ${regressions.map((entry) => `${entry.kind} (${entry.previous} → ${entry.detail})`).join(' | ') || 'ninguno'}`);
}

// 1b. Default automatic mode: the pool is 8 wide, and a fragment that starts late
// (the document has more fragments than workers) rewrites seconds and counter.
{
  const frames = await deepScanFrames({
    concurrencyMode: 'automatic', concurrency: 1, chunks: 12,
    chunkDurations: [1200, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 30, 30, 30, 30],
  });
  printFrames('runDeepScan · modo automático por defecto (8 en paralelo), 12 fragmentos', frames);
  const regressions = dedupe(checkChunkPhase(frames));
  for (const regression of regressions) failures.push({ section: 'runDeepScan (paralelo, modo automático)', ...regression });
  console.log(`    → ${regressions.length} retrocesos: ${regressions.map((entry) => `${entry.kind} (${entry.previous} → ${entry.detail})`).join(' | ') || 'ninguno'}`);
  const fusion = frames.find((frame) => FUSION_FRAME.test(frame.detail));
  if (fusion) {
    const chunkMax = frames.filter((frame) => CHUNK_FRAME.test(frame.detail)).reduce((max, frame) => Math.max(max, frame.pct ?? 0), 0);
    console.log(`    → observación: la fase de fusión reinicia el % mostrado (${Math.round(chunkMax * 100)}% → ${Math.round((fusion.pct ?? 0) * 100)}%) en la misma línea`);
  }
}

// 2. Several works in flight: the bar re-points at another work and the shown elapsed
// (and its fragment counter) restarts while the work you were watching still runs.
{
  const frames = await scanQueueFrames({ 'obra-a': 800, 'obra-b': 400, 'obra-c': 400, 'obra-d': 400, 'obra-e': 1500, 'obra-f': 1500 });
  console.log('\n  scanQueue · modo automático (4 obras a la vez): fila mostrada por la barra');
  let previous = null;
  for (const frame of frames) {
    if (frame.title === null) continue;
    // One row per state change: the wire already batches at 250 ms.
    const key = `${frame.title}|${frame.detail}|${Math.floor((frame.elapsedMs ?? 0) / 1000)}`;
    if (key === previous) continue;
    previous = key;
    const subPct = typeof frame.subPct === 'number' ? ` pct=${Math.round(frame.subPct * 100)}%` : '';
    console.log(`    [${String(frame.at).padStart(5)}ms] ${frame.title}  obra=${(frame.elapsedMs / 1000).toFixed(1)}s  en curso=${frame.running}  ${frame.detail ?? ''}${subPct}`);
  }
  const switches = displaySwitches(frames);
  for (const entry of switches) {
    console.log(`    · cambio de obra mostrada en t=${entry.at}ms: ${entry.from} → ${entry.to} (${entry.running} obras en curso)`);
  }
  const regressions = checkDisplayedWork(frames);
  for (const regression of regressions) failures.push({ section: 'scanQueue (varias obras en paralelo)', ...regression });
  console.log(`    → ${regressions.length} retrocesos del tiempo mostrado: ${regressions.map((entry) => `${entry.previous} → ${entry.detail}`).join(' | ') || 'ninguno'}`);
}

console.log('\n──────── Resultado ────────');
if (failures.length === 0) {
  console.log('OK: todos los contadores son monótonos.');
  process.exit(0);
}
console.log(`FALLO: ${failures.length} retrocesos reproducidos con el código real.`);
for (const failure of failures) {
  console.log(`  · [${failure.section}] ${failure.kind}: ${failure.previous} → ${failure.detail} (t=${failure.at}ms)`);
}
process.exit(1);
