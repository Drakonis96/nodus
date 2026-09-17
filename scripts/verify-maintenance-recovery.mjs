// Verifies the required graph maintenance the amber banner belongs to, end to end:
//
//   1. A failure is really retried, and while the retry runs the snapshot carries what
//      the banner needs to say so (running + startedAt + attempt) instead of repeating
//      the old error as if the click had done nothing. A second failure keeps counting.
//   2. The batching that feeds the model keeps every request inside its text budget, so
//      the REAL local planner reserves the answer budget the task asks for instead of
//      clamping it to the 512-token floor that cut the reply the user saw.
//
// Run: node scripts/verify-maintenance-recovery.mjs
// Exit code 0 means the flow and the batching hold; 1 lists what broke.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

/** Pinned copy of aiClient.ts:315-323; that module cannot be bundled here (native deps). */
function estimateLocalTokens(text) {
  let units = 0;
  for (const match of text.matchAll(/[A-Za-z0-9]+|[^A-Za-z0-9\s]|\s+/g)) {
    const chunk = match[0];
    if (/\s/.test(chunk[0])) continue;
    units += /[A-Za-z0-9]/.test(chunk[0]) ? Math.max(1, Math.ceil(chunk.length / 4)) : 1;
  }
  return Math.ceil(units * 1.5);
}

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

// ── 1. Failure, retry, and what the banner can say while it runs ──────────────

async function maintenanceAttempts() {
  const probe = { failures: 2, calls: 0 };
  globalThis.__maintenanceProbe = probe;
  const { module, directory } = await bundle('electron/pipeline/scanQueue.ts', 'maintenance-retry', [
    [/\.\.\/db\/database$/, 'db', `
      export function getDb() {
        return { prepare: () => ({ get: (id) => ({ nodus_id: id, zotero_key: id, title: id, doi: null, item_type: 'journalArticle', authors_json: '[]', deep_hash: 'stale', source_type: 'pdf', notes: null }), all: () => [], run: () => ({ changes: 1 }) }) };
      }
    `],
    [/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return { aiConcurrencyMode: 'manual', concurrency: 1, autoBridgeAfterQueue: false, autoSummaryAfterDeep: false, embeddingProvider: 'openai', providerKeys: { openai: false }, zoteroUserId: '', zoteroStoragePath: '', unpaywallEmail: '', preferZoteroFulltext: false, ocrEnabled: false, ocrLanguages: [], ocrMaxPages: 0, themesLocked: false, synthesisModel: null }; }`],
    [/\.\.\/ai\/lightScan$/, 'light', `export async function runLightScan() {}`],
    [/\.\.\/ai\/deepScan$/, 'deep', `export function issueDeepScanPublicationOrdinal() { return 1; } export function finishDeepScanPublicationOrdinal() {} export async function runDeepScan() {}`],
    [/\.\.\/ai\/summaryScan$/, 'summary', `export async function runSummaryScan() {}`],
    [/\.\.\/ai\/reprocessConnections$/, 'reprocess', `
      export async function reprocessConnections(_options, _model, onProgress) {
        const probe = globalThis.__maintenanceProbe;
        probe.calls += 1;
        onProgress?.({ phase: 'themes', label: 'Agrupando ideas en temas', current: 1, total: 3 });
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (probe.failures > 0) {
          probe.failures -= 1;
          throw new Error('La respuesta de «gemma-4-e2b-q4» (Nodus local) se cortó al alcanzar el límite de 512 tokens de salida y el JSON quedó incompleto. Usa un modelo con mayor límite de salida o reduce el tamaño de la tarea.');
        }
        return { relationsAdded: 0, newThemes: 0 };
      }
    `],
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
    const record = (label) => {
      const snapshot = module.scanQueue.snapshot();
      frames.push({
        label,
        running: snapshot.maintenanceRunning,
        error: snapshot.maintenanceError ? 'error' : null,
        startedAt: snapshot.maintenanceStartedAt,
        attempt: snapshot.maintenanceAttempt,
      });
    };
    const waitFor = async (predicate, label, ms = 4000) => {
      const deadline = Date.now() + ms;
      while (!predicate() && Date.now() < deadline) await delay(10);
      if (!predicate()) throw new Error(`timeout: ${label}`);
    };

    module.scanQueue.enqueue('paper-1', 'BitNet', 'deep');
    await waitFor(() => globalThis.__maintenanceProbe.calls === 1 && module.scanQueue.snapshot().maintenanceError, 'first failure');
    await waitFor(() => !module.scanQueue.snapshot().maintenanceRunning, 'first pass settles');
    record('fallo 1');

    module.scanQueue.resume();
    await waitFor(() => module.scanQueue.snapshot().maintenanceRunning && module.scanQueue.snapshot().maintenanceStartedAt, 'retry in flight');
    record('reintento 1 en curso');

    await waitFor(() => globalThis.__maintenanceProbe.calls === 2 && !module.scanQueue.snapshot().maintenanceRunning, 'second failure');
    record('fallo 2');

    module.scanQueue.resume();
    await waitFor(() => module.scanQueue.snapshot().maintenanceRunning && module.scanQueue.snapshot().maintenanceAttempt === 3, 'second retry in flight');
    record('reintento 2 en curso');

    await waitFor(() => !module.scanQueue.snapshot().maintenanceRunning && !module.scanQueue.snapshot().maintenanceError, 'recovery');
    record('recuperado');
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ── 2. Batch text budget versus what the real planner reserves for the answer ──

async function reprocessBatches() {
  const ideas = Array.from({ length: 24 }, (_, index) => ({
    global_id: `i${index}`,
    type: 'claim',
    label: `Idea ${index} del informe técnico`,
    // Heavy on purpose: the paper that failed carries long statements.
    statement: `Enunciado ${index}. ` + 'palabra '.repeat(400).trim(),
  }));
  const probe = { calls: [], overflow: [], ideas };
  probe.estimate = estimateLocalTokens;
  globalThis.__reprocessProbe = probe;

  const planner = await bundle('electron/ai/localRequestPlanner.ts', 'reprocess-planner', []);
  probe.planner = planner.module;

  const { module, directory } = await bundle('electron/ai/reprocessConnections.ts', 'reprocess-batches', [
    [/^\.\.\/db\/database$/, 'db', `
      export function getDb() {
        const ideas = globalThis.__reprocessProbe.ideas;
        const occurrences = ideas.map((idea) => ({ global_id: idea.global_id, nodus_id: 'w1' }));
        return {
          transaction: (fn) => fn,
          prepare: (sql) => ({
            // The ideas query and the occurrence query both mention io.global_id (one
            // inside its EXISTS subquery), so the projection is what tells them apart.
            all: () => (sql.includes('i.label, i.statement') ? ideas : sql.includes('io.global_id, io.nodus_id') ? occurrences : []),
            run: () => ({ changes: 1 }),
          }),
        };
      }
    `],
    [/^\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return { promptLanguage: 'es', themesLocked: false, extractionModel: null, synthesisModel: null, relationModel: null, fusionModel: null }; }`],
    [/^\.\.\/db\/themesRepo$/, 'themes', `
      export function listThemeLabels() { return []; }
      export function normalizeThemeLabel(label) { return String(label).toLowerCase().trim(); }
      export function pruneOrphanThemes() {} export function replaceIdeaThemeLinks() {} export function setWorkThemes() {}
    `],
    [/^\.\.\/db\/ideasRepo$/, 'ideasRepo', `
      export function addEdge() { return 'edge'; } export function canonicalEdgeKey() { return 'key'; }
      export function currentEmbeddingConfig() { return null; } export function ideaVectorsForCompute() { return []; }
      export function normalizeEdgeType(type) { return type; }
    `],
    [/^\.\.\/db\/scanCheckpointRepo$/, 'checkpoints', `export function loadCheckpoints() { return new Map(); } export function saveCheckpoint() {} export function clearCheckpoints() {}`],
    [/^\.\.\/graph\/computeHost$/, 'computeHost', `export async function computeNearestNeighbors() { return []; }`],
    [/^\.\/aiClient$/, 'aiClient', `
      export async function completeJson(request) {
        const probe = globalThis.__reprocessProbe;
        const { buildLocalRequestPlan } = probe.planner;
        const promptTokens = probe.estimate(request.system) + probe.estimate(request.user) + 16;
        let plan;
        try {
          plan = buildLocalRequestPlan({
            provider: 'nodus', model: 'gemma-4-e2b-q4', task: request.task,
            promptTokens, requestedOutputTokens: request.maxTokens, nativeTransport: true, contextMode: 'auto',
          });
        } catch (error) {
          probe.overflow.push({ chars: request.user.length, items: request.batchSize, message: String(error.message).slice(0, 60) });
          throw error;
        }
        probe.calls.push({
          chars: request.user.length,
          items: request.batchSize,
          promptTokens: plan.promptTokens,
          contextTokens: plan.contextTokens,
          requested: plan.requestedOutputTokens,
          reserved: plan.outputTokens,
        });
        const ids = [...request.user.matchAll(/"id":"(i\\d+)"/g)].map((match) => match[1]);
        return { assignments: ids.map((id) => ({ id, themes: ['Tema'] })) };
      }
    `],
  ]);
  try {
    const frames = [];
    const result = await module.reprocessConnections({ relations: false }, null, (progress) => {
      frames.push({ at: frames.length, current: progress.current, total: progress.total, label: progress.label });
    });
    return { frames, result, probe };
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(planner.directory, { recursive: true, force: true });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log('Verificando el postprocesado del grafo: reintento y troceado de peticiones…\n');

const attempts = await maintenanceAttempts();
console.log('  Cola: transiciones del mantenimiento');
for (const frame of attempts) {
  console.log(`    ${frame.label.padEnd(24)} running=${String(frame.running).padEnd(5)} error=${frame.error ?? '—'} intento=${frame.attempt ?? '—'} startedAt=${frame.startedAt ? 'sí' : '—'}`);
}
const [firstFailure, retryOne, secondFailure, retryTwo, recovered] = attempts;
assert(firstFailure.running === false && firstFailure.error === 'error' && firstFailure.attempt === 1, 'el primer fallo debe dejar error, sin reloj y con intento 1');
assert(retryOne.running === true && retryOne.error === 'error' && retryOne.attempt === 2 && retryOne.startedAt, 'mientras reintenta, el banner debe poder decir "reintentando" (running + reloj + intento 2)');
assert(secondFailure.attempt === 2 && secondFailure.running === false, 'el segundo fallo debe conservar el intento 2 y parar el reloj');
assert(retryTwo.attempt === 3 && retryTwo.running === true, 'el tercer intento debe anunciarse como intento 3');
assert(recovered.error === null && recovered.attempt === 0 && recovered.startedAt === null && recovered.running === false, 'al recuperarse, error/intento/reloj deben quedar limpios');

const { frames, result, probe } = await reprocessBatches();
console.log('\n  Temas: lotes enviados al modelo (24 ideas con enunciados largos)');
for (const call of probe.calls) {
  console.log(`    lote de ${String(call.items).padStart(2)} ideas · ${String(call.chars).padStart(6)} car. de prompt · prompt=${call.promptTokens} ctx=${call.contextTokens} · salida pedida=${call.requested} reservada=${call.reserved}`);
}
console.log(`    progreso emitido: ${frames.map((frame) => `${frame.current}/${frame.total}`).join(' → ')}`);
console.log(`    resultado: ${result.ideas} ideas, ${result.themedIdeas} con tema, ${result.newThemes} temas nuevos`);

assert(probe.overflow.length === 0, `ningún lote debe desbordar el contexto (${probe.overflow.length} desbordes)`);
assert(probe.calls.length > 1, `un documento pesado debe trocearse en varios lotes, no en ${probe.calls.length}`);
assert(frames.length > 0 && frames.every((frame) => frame.total === probe.calls.length), 'el contador de lotes del progreso debe coincidir con las llamadas hechas');
assert(frames.every((frame, index) => index === 0 || frame.current >= frames[index - 1].current), 'el contador de lotes solo puede avanzar');
for (const call of probe.calls) {
  assert(call.reserved === call.requested, `el planificador debe reservar la salida pedida (pedida=${call.requested}, reservada=${call.reserved})`);
  assert(call.chars <= 10000 + 2100, `el prompt de un lote debe caber en el presupuesto de texto (${call.chars} caracteres)`);
}
assert(result.themedIdeas === 24, `las 24 ideas deben quedar con tema (quedaron ${result.themedIdeas})`);

// What the previous item-count batching sent: every idea in one request. The real
// planner is asked about a prompt with the same text volume the batches carried.
const totalChars = probe.calls.reduce((sum, call) => sum + call.chars, 0);
const control = { kind: 'fits', requested: 256 + 96 * probe.ideas.length, reserved: null };
try {
  const plan = probe.planner.buildLocalRequestPlan({
    provider: 'nodus', model: 'gemma-4-e2b-q4', task: 'theme-assignment',
    promptTokens: estimateLocalTokens('palabra '.repeat(Math.round(totalChars / 8))) + 16,
    requestedOutputTokens: control.requested,
    nativeTransport: true, contextMode: 'auto',
  });
  control.kind = plan.outputTokens < plan.requestedOutputTokens ? 'clamped' : 'fits';
  control.reserved = plan.outputTokens;
} catch (error) {
  control.kind = 'overflow';
  control.reserved = String(error.message).split(':')[0];
}
console.log(`\n  Control (lo que enviaba el troceado anterior): 1 lote de ${probe.ideas.length} ideas → salida pedida=${control.requested}, ${control.kind === 'overflow' ? `no cabe en el contexto (${control.reserved})` : `reservada=${control.reserved}`}`);
assert(control.kind !== 'fits', 'el control debe demostrar que el lote único recorta la salida o desborda el contexto');

console.log('\n──────── Resultado ────────');
if (failures.length === 0) {
  console.log('OK: el reintento se ve en la interfaz y los lotes caben con presupuesto completo.');
  process.exit(0);
}
console.log(`FALLO: ${failures.length} comprobaciones sin cumplir.`);
for (const failure of failures) console.log(`  · ${failure}`);
process.exit(1);
