import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(os.tmpdir(), 'nodus-scan-queue-life-'));
const bundle = path.join(output, 'queue.mjs');

globalThis.__scanQueueLife = {
  works: new Map([['paper-1', { nodus_id: 'paper-1', zotero_key: 'z1', title: 'Paper one', doi: null, item_type: 'journalArticle' }]]),
  reprocessStarted: false,
  releaseReprocess: null,
  releaseBridge: null,
};

await build({
  entryPoints: [path.join(repoRoot, 'electron/pipeline/scanQueue.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  plugins: [{
    name: 'scan-queue-life-stubs',
    setup(api) {
      const stub = (filter, name, contents) => {
        api.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
      };
      stub(/\.\.\/db\/database$/, 'db', `
        export function getDb(){return {prepare(sql){return {
          get(id){if(sql.includes('SELECT * FROM works'))return globalThis.__scanQueueLife.works.get(id);return null},
          all(){return []},run(){return {changes:1}}
        }}}}
      `);
      stub(/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings(){return {aiConcurrencyMode:'manual',concurrency:1,autoBridgeAfterQueue:false,autoSummaryAfterDeep:false,embeddingProvider:'openai',providerKeys:{openai:false},zoteroUserId:'',zoteroStoragePath:'',unpaywallEmail:'',preferZoteroFulltext:false,ocrEnabled:false,ocrLanguages:[],ocrMaxPages:0,themesLocked:false,synthesisModel:null}}`);
      stub(/\.\.\/ai\/lightScan$/, 'light', `export async function runLightScan(){}`);
      stub(/\.\.\/ai\/deepScan$/, 'deep', `export function issueDeepScanPublicationOrdinal(){return 1}export function finishDeepScanPublicationOrdinal(){}export async function runDeepScan(){}`);
      stub(/\.\.\/ai\/summaryScan$/, 'summary', `export async function runSummaryScan(){}`);
      stub(/\.\.\/ai\/reprocessConnections$/, 'reprocess', `export async function reprocessConnections(_options,_model,onProgress){globalThis.__scanQueueLife.reprocessStarted=true;onProgress?.({phase:'themes',label:'Agrupando ideas en temas',current:1,total:1});await new Promise(resolve=>{globalThis.__scanQueueLife.releaseReprocess=resolve});return {relationsAdded:0,newThemes:0}}`);
      stub(/\.\.\/db\/themesRepo$/, 'themes', `export function listThemeLabels(){return []}`);
      stub(/\.\.\/extraction\/textExtractor$/, 'text', `export async function resolveWorkText(){return {text:'paper text',segments:[]}}export function resolvedTextStateFromDoc(){return {}}`);
      stub(/\.\.\/zotero\/zoteroClient$/, 'zotero', `export async function getItem(){return {abstract:'abstract'}}`);
      stub(/\.\.\/db\/worksRepo$/, 'works', `export function clearDeepQueued(){}export function setDeepPending(){}export function setDeepResult(){}export function setResolvedTextState(){}export function setSummaryPending(){}`);
      stub(/\.\.\/db\/workSummariesRepo$/, 'summaries', `export function failedSummaryWorks(){return []}export function pendingSummaryWorks(){return []}`);
      stub(/\.\.\/ai\/aiClient$/, 'ai', `export class AiError extends Error{constructor(message,retriable=false,config=false){super(message);this.retriable=retriable;this.config=config}}`);
      stub(/\.\.\/ai\/semanticBridges$/, 'bridges', `export async function discoverSemanticBridges(){await new Promise(resolve=>{globalThis.__scanQueueLife.releaseBridge=resolve});return {added:0,validated:0,candidatesScanned:0}}`);
      stub(/\.\.\/ai\/embeddingPipeline$/, 'embeddings', `export async function startEmbedding(){}`);
      stub(/\.\.\/ai\/passageEmbeddingPipeline$/, 'passages', `export async function startPassageEmbedding(){}`);
      stub(/\.\.\/perf$/, 'perf', `export function startPerf(){return ()=>{}}`);
      stub(/\.\.\/notifications$/, 'notifications', `export function addNotification(){}`);
      stub(/\.\.\/util\/coalesce$/, 'coalesce', `export function coalesce(fn){return {schedule:fn}}`);
      stub(/@shared\/nodiNotifications$/, 'nodi', `export function nodiText(key){return key}`);
    },
  }],
});

const { scanQueue } = await import(pathToFileURL(bundle));
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), label);
};

test('required graph maintenance remains active after the paper itself finishes', async () => {
  scanQueue.enqueue('paper-1', 'Paper one', 'deep');
  await waitFor(() => globalThis.__scanQueueLife.reprocessStarted, 'maintenance starts');
  const during = scanQueue.snapshot();
  assert.equal(during.maintenanceRunning, true);
  assert.equal(during.done, 1, 'the item may be done, but the task is not');
  assert.equal(during.finishedAt, null, 'global time cannot freeze before maintenance');
  assert.match(during.maintenanceDetail, /Agrupando ideas en temas/);
  globalThis.__scanQueueLife.releaseReprocess();
  await waitFor(() => !scanQueue.snapshot().maintenanceRunning, 'maintenance settles');
  assert.ok(scanQueue.snapshot().finishedAt, 'the task finishes only after its required post-processing');
});

test('stopping an accepted provider operation never hides it while it is still running', async () => {
  scanQueue.clear();
  scanQueue.enqueueBridge();
  await waitFor(() => scanQueue.snapshot().items.some((item) => item.state === 'running'), 'bridge starts');
  const id = scanQueue.snapshot().items.find((item) => item.state === 'running').id;
  scanQueue.removeItem(id);
  const stopping = scanQueue.snapshot();
  assert.equal(stopping.items.length, 1, 'accepted work remains represented');
  assert.equal(stopping.items[0].state, 'running');
  assert.match(stopping.items[0].detail, /Deteniendo/);
  assert.equal(stopping.finishedAt, null);
  globalThis.__scanQueueLife.releaseBridge();
  await waitFor(() => scanQueue.snapshot().items.length === 0 && !scanQueue.isBusy(), 'accepted work really settles');
});

test.after(async () => {
  delete globalThis.__scanQueueLife;
  await rm(output, { recursive: true, force: true });
});
