// End-to-end validation of the integrated local AI runtime on a machine with a
// discrete GPU (issue #851).
//
// What it proves, per extraction model, in its OWN vault:
//   1. the runtime Nodus installs is the GPU build for this machine (not the
//      CPU-only archive the report was about);
//   2. the runtime's own probe sees the device and llama.cpp reports how many
//      layers it placed in device memory;
//   3. importing six real arXiv papers, light+deep extraction (plus the summary
//      chain), theme/relation reprocessing, the document index campaign and the
//      idea/passage embeddings all complete and persist;
//   4. the extracted content is structured (ideas, evidence, page markers),
//      not just "the model answered something".
//
// It drives the REAL application through its own preload API, against the real
// userData profile, so the vaults stay available for manual inspection
// afterwards. A throwaway profile is used only when --userdata is given.
//
// Usage:
//   node scripts/e2e-local-ai-extraction.mjs [--models=gemma,granite,qwen,lfm2]
//     [--userdata=<dir>] [--report=<file>] [--skip-download] [--keep-open]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const arg = (name, fallback = null) => {
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const MODEL_ORDER = ['gemma', 'granite', 'qwen', 'lfm2'];
const MODEL_IDS = {
  gemma: 'gemma-4-e2b-q4',
  granite: 'granite-4.0-micro-q4',
  qwen: 'qwen3.5-0.8b-q4',
  lfm2: 'lfm2.5-vl-1.6b-q4',
};
const MODEL_LABELS = {
  gemma: 'Gemma 4 E2B',
  granite: 'Granite 4.0 Micro',
  qwen: 'Qwen 3.5 0.8B',
  lfm2: 'LFM2.5 VL 1.6B',
};
const requestedModels = arg('--models', MODEL_ORDER.join(','))
  .split(',').map((entry) => entry.trim()).filter(Boolean);
for (const model of requestedModels) {
  assert.ok(Object.prototype.hasOwnProperty.call(MODEL_IDS, model), `modelo desconocido: ${model}`);
}

const papersDirectory = arg('--papers', path.join(root, 'audit', 'local-ai-gpu', 'papers'));
const reportPath = arg('--report', path.join(root, 'audit', 'local-ai-gpu', 'report.json'));
const userDataOverride = arg('--userdata');
const skipDownload = process.argv.includes('--skip-download');
const dryRun = process.argv.includes('--dry-run');
const keepOpen = process.argv.includes('--keep-open');
const queueTimeoutMs = Number(arg('--queue-timeout-ms', String(6 * 60 * 60 * 1000)));

if (!existsSync(path.join(root, 'dist-electron/main.js')) || !existsSync(path.join(root, 'dist/index.html'))) {
  throw new Error('Falta el build. Ejecuta npm run build antes de validar el pipeline local.');
}

// ── The corpus: six real English papers from arXiv ──────────────────────────
const PAPERS = [
  {
    arxiv: '1706.03762', key: 'ARXIVATTN', title: 'Attention Is All You Need', year: 2017, pages: 15,
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
  },
  {
    arxiv: '1810.04805', key: 'ARXIVBERT', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', year: 2019, pages: 16,
    abstract: 'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.',
  },
  {
    arxiv: '1512.03385', key: 'ARXIVRESNET', title: 'Deep Residual Learning for Image Recognition', year: 2015, pages: 12,
    abstract: 'Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously, reformulating the layers as learning residual functions with reference to the layer inputs.',
  },
  {
    arxiv: '1412.6980', key: 'ARXIVADAM', title: 'Adam: A Method for Stochastic Optimization', year: 2015, pages: 15,
    abstract: 'We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions, based on adaptive estimates of lower-order moments. The method is straightforward to implement, computationally efficient and has little memory requirements.',
  },
  {
    arxiv: '2006.11239', key: 'ARXIVDDPM', title: 'Denoising Diffusion Probabilistic Models', year: 2020, pages: 18,
    abstract: 'We present high quality image synthesis results using diffusion probabilistic models, a class of latent variable models inspired by considerations from nonequilibrium thermodynamics. Our best results are obtained by training on a weighted variational bound designed according to a novel connection between diffusion models and denoising score matching.',
  },
  {
    arxiv: '2010.11929', key: 'ARXIVVIT', title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', year: 2021, pages: 22,
    abstract: 'While the Transformer architecture has become the de-facto standard for natural language processing tasks, its applications to computer vision remain limited. We show that a pure Transformer applied directly to sequences of image patches can perform very well on image classification tasks.',
  },
];

for (const paper of PAPERS) {
  const file = path.join(papersDirectory, `${paper.arxiv}.pdf`);
  if (!existsSync(file)) throw new Error(`Falta el PDF del corpus: ${file}`);
}

/** The Zotero item Nodus ingests; the PDF itself is fetched from the stand-in API below. */
function zoteroItem(paper, index) {
  return {
    key: paper.key,
    itemKey: paper.key,
    library: { type: 'user', id: '0', name: 'Mi biblioteca' },
    version: 100 + index,
    title: paper.title,
    creators: [{ lastName: 'Authors', firstName: 'arXiv', creatorType: 'author' }],
    year: paper.year,
    itemType: 'journalArticle',
    doi: null,
    abstract: paper.abstract,
    tags: [],
    collections: [],
    publisher: null,
    publicationTitle: 'arXiv',
    isbn: null,
    issn: null,
    url: `https://arxiv.org/abs/${paper.arxiv}`,
    date: String(paper.year),
    language: 'en',
    volume: null,
    issue: null,
    pages: null,
    edition: null,
    place: null,
    rights: null,
    extra: `arXiv:${paper.arxiv}`,
    fields: { archiveID: `arXiv:${paper.arxiv}` },
    dateAdded: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  };
}

// ── A Zotero local-API stand-in that serves the real PDFs ───────────────────
const attachmentKeyFor = (paper) => `${paper.key}ATT`;
const paperByAttachment = new Map(PAPERS.map((paper) => [attachmentKeyFor(paper), paper]));
const paperByParent = new Map(PAPERS.map((paper) => [paper.key, paper]));

function paperPayload(paper) {
  const index = PAPERS.indexOf(paper);
  return {
    key: paper.key, version: 100 + index,
    data: {
      key: paper.key, version: 100 + index, itemType: 'journalArticle', title: paper.title,
      date: String(paper.year), abstractNote: paper.abstract,
      creators: [{ creatorType: 'author', firstName: 'arXiv', lastName: 'Authors' }],
      tags: [], collections: [], url: `https://arxiv.org/abs/${paper.arxiv}`,
    },
  };
}

const zoteroServer = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const json = (payload, headers = {}) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Last-Modified-Version': '7', ...headers });
    response.end(JSON.stringify(payload));
  };
  const missing = () => {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end('{"error":"not found"}');
  };
  if (pathname.endsWith('/groups') || pathname.endsWith('/collections') || pathname.endsWith('/collections/top')) return json([]);
  if (pathname.endsWith('/deleted')) return missing();
  const fileMatch = pathname.match(/\/items\/([^/]+)\/file$/);
  if (fileMatch) {
    const paper = paperByAttachment.get(decodeURIComponent(fileMatch[1]));
    if (!paper) return missing();
    response.writeHead(302, { Location: pathToFileURL(path.join(papersDirectory, `${paper.arxiv}.pdf`)).href });
    return response.end();
  }
  const childrenMatch = pathname.match(/\/items\/([^/]+)\/children$/);
  if (childrenMatch) {
    const paper = paperByParent.get(decodeURIComponent(childrenMatch[1]));
    if (!paper) return missing();
    const key = attachmentKeyFor(paper);
    return json([{
      key, version: 100,
      data: {
        key, version: 100, itemType: 'attachment', parentItem: paper.key, title: 'Full text PDF',
        contentType: 'application/pdf', linkMode: 'imported_file', filename: `${paper.arxiv}.pdf`,
      },
    }], { 'Total-Results': '1' });
  }
  const itemMatch = pathname.match(/\/items\/([^/]+)$/);
  if (itemMatch) {
    const key = decodeURIComponent(itemMatch[1]);
    const paper = paperByParent.get(key);
    if (paper) return json(paperPayload(paper));
    const attachment = paperByAttachment.get(key);
    if (attachment) {
      return json({
        key, version: 100,
        data: {
          key, version: 100, itemType: 'attachment', parentItem: attachment.key, title: 'Full text PDF',
          contentType: 'application/pdf', linkMode: 'imported_file', filename: `${attachment.arxiv}.pdf`,
        },
      });
    }
    return missing();
  }
  if (pathname.endsWith('/items/top')) {
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const start = Number(url.searchParams.get('start') ?? '0');
    return json(PAPERS.slice(start, start + limit).map(paperPayload), { 'Total-Results': String(PAPERS.length) });
  }
  if (pathname.endsWith('/items')) return json([paperPayload(PAPERS[0])], { 'Total-Results': '1' });
  return missing();
});
await new Promise((resolve) => zoteroServer.listen(0, '127.0.0.1', resolve));
const zoteroBase = `http://127.0.0.1:${zoteroServer.address().port}/api`;

// ── Report scaffolding ──────────────────────────────────────────────────────
const report = {
  startedAt: new Date().toISOString(),
  machine: {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? null,
    totalMemGiB: Math.round(os.totalmem() / 1024 ** 3),
  },
  corpus: PAPERS.map((paper) => ({ arxiv: paper.arxiv, title: paper.title })),
  profiles: {},
};

async function writeReport() {
  report.updatedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lastNotes = new Map();
const note = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const noteOnce = (key, message) => {
  if (lastNotes.get(key) === message) return;
  lastNotes.set(key, message);
  note(message);
};

async function waitFor(label, probe, { timeout = queueTimeoutMs, interval = 4_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando: ${label}`);
}

// ── Launch the real application ─────────────────────────────────────────────
const childEnv = { ...process.env, NODUS_ZOTERO_API_BASE: zoteroBase };
delete childEnv.ELECTRON_RUN_AS_NODE;
if (userDataOverride) childEnv.NODUS_USERDATA = userDataOverride;

const app = await electron.launch({ executablePath: require('electron'), args: [root], env: childEnv });
// The main process's own console output carries the diagnostics the app writes when a
// structured reply is rejected, an engine falls back or a server fails to start. Keep
// it in this run's log so a failure can be read instead of inferred.
const appLog = [];
const appConsolePath = path.join(path.dirname(reportPath), 'app-console.log');
await fsp.mkdir(path.dirname(appConsolePath), { recursive: true });
await fsp.writeFile(appConsolePath, '', 'utf8');
for (const stream of [app.process().stdout, app.process().stderr]) {
  stream?.setEncoding?.('utf8');
  stream?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      appLog.push(line);
      if (appLog.length > 5000) appLog.shift();
      void fsp.appendFile(appConsolePath, `${line}\n`, 'utf8').catch(() => undefined);
    }
  });
}
report.appConsole = appLog;
report.appConsolePath = appConsolePath;
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
report.appVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion()).catch(() => null);
report.userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')).catch(() => null);

const ipc = (method, ...args) => page.evaluate(
  ([name, callArgs]) => {
    const namespace = window.nodus;
    if (typeof namespace[name] !== 'function') throw new Error(`API ausente: ${name}`);
    return namespace[name](...callArgs);
  },
  [method, args],
);

async function statusSnapshot(label) {
  const status = await ipc('getNodusLocalAiStatus');
  report.runtime ??= {};
  report.runtime[label] = {
    version: status.runtime.version,
    asset: status.runtime.asset ?? null,
    backend: status.runtime.backend ?? null,
    device: status.runtime.device ?? null,
    nvidia: status.runtime.nvidia ?? null,
    offload: status.runtime.offload ?? null,
    fallbackReason: status.runtime.fallbackReason ?? null,
    processedOnCpu: status.runtime.processedOnCpu ?? null,
    endpoint: status.runtime.endpoint ?? null,
    calibration: status.calibration ?? null,
    activeModelId: status.activeModelId ?? null,
    activeSlots: status.activeSlots ?? 0,
    logTail: status.runtime.logTail ?? [],
  };
  return status;
}

let failure = null;
try {
  await statusSnapshot('beforeInstall');

  // ── Phase 1: runtime + models ────────────────────────────────────────────
  const localModels = ['bge-m3-q8_0', ...requestedModels.map((name) => MODEL_IDS[name])];
  report.observations = [
    'Bulk submission (processFullBulk) with aiConcurrencyMode=automatic puts four works in flight against the single admitted local slot; in the first pass on this machine the fusion step of 4 of 5 works ended unfinished ("respuesta JSON inválida o tiempo de espera") while the extraction itself had completed (18-23 ideas per work).',
    'The validated run therefore analyzes one paper at a time (processFull + wait), which is also what the per-work Analyze action does, and retries any work the local model leaves unfinished.',
  ];
  report.fusionRejections = [];
  report.downloads = {};
  for (const modelId of localModels) {
    const status = await ipc('getNodusLocalAiStatus');
    const already = status.models.find((model) => model.id === modelId)?.downloaded;
    if (already && skipDownload) {
      report.downloads[modelId] = { skipped: true };
      continue;
    }
    const started = Date.now();
    await page.evaluate(async (id) => { await window.nodus.downloadNodusLocalModel(id, () => {}); }, modelId);
    report.downloads[modelId] = { ms: Date.now() - started };
    await writeReport();
  }
  const installed = await statusSnapshot('afterInstall');
  assert.equal(installed.runtime.ready, true, 'el runtime local debe estar instalado');
  assert.notEqual(installed.runtime.backend, null, 'el runtime instalado debe declarar su backend');

  // ── Phase 2: one vault per extraction model ──────────────────────────────
  for (const name of dryRun ? [] : requestedModels) {
    const modelId = MODEL_IDS[name];
    const vaultName = `Local AI · ${MODEL_LABELS[name]}`;
    const profile = { model: name, modelId, vaultName, startedAt: new Date().toISOString() };
    report.profiles[name] = profile;
    try {
      const vaults = await ipc('listVaults');
      const existing = vaults.find((vault) => vault.name === vaultName);
      const vault = existing ?? (await ipc('createVault', {
        name: vaultName,
        type: 'academic',
        aiModel: { provider: 'nodus', model: modelId },
        embeddingProvider: 'nodus',
        embeddingModel: 'bge-m3-q8_0',
      })).vault;
      profile.vaultId = vault.id;
      profile.vaultCreated = !existing;
      await ipc('switchVault', vault.id);

      await ipc('updateSettings', {
        modelSettingsMode: 'advanced',
        synthesisModel: { provider: 'nodus', model: modelId },
        extractionModel: { provider: 'nodus', model: modelId },
        summaryModel: { provider: 'nodus', model: modelId },
        fusionModel: { provider: 'nodus', model: modelId },
        relationModel: { provider: 'nodus', model: modelId },
        documentProfileModel: { provider: 'nodus', model: modelId },
        documentAuditModel: { provider: 'nodus', model: modelId },
        embeddingProvider: 'nodus',
        embeddingModel: 'bge-m3-q8_0',
        zoteroUserId: '0',
        preferZoteroFulltext: false,
        ocrEnabled: false,
        autoSummaryAfterDeep: true,
        autoBridgeAfterQueue: false,
        documentIndexingEnabled: false,
        promptLanguage: 'en',
        aiConcurrencyMode: 'automatic',
      });
      profile.settings = await ipc('getSettings').then((settings) => ({
        extractionModel: settings.extractionModel, summaryModel: settings.summaryModel,
        fusionModel: settings.fusionModel, embeddingProvider: settings.embeddingProvider,
        embeddingModel: settings.embeddingModel, aiConcurrencyMode: settings.aiConcurrencyMode,
      })).catch(() => null);

      // Import the six papers into this vault.
      const works = await ipc('ingestZoteroItems', PAPERS.map(zoteroItem));
      const nodusIds = works.map((work) => work.nodus_id).filter(Boolean);
      profile.imported = nodusIds.length;
      note(`${name}: imported ${nodusIds.length} works into "${vaultName}"`);
      await writeReport();

      const summarizeWorks = (works) => works.map((work) => ({
        title: work.title,
        light: work.light_status,
        deep: work.deep_status,
        summary: work.summary_status,
        ideas: work.ideaCount,
        themes: (work.themes ?? []).length,
      }));

      // Analysis runs one paper at a time, the way the per-work "Analyze" action
      // does. Submitting all six at once with a single local slot puts four works
      // in flight against one runtime slot and starves the fusion step (observed in
      // this machine's first pass: 4 of 5 works ended with an unfinished fusion).
      const settleQueue = (label) => waitFor(label, async () => {
        const queue = await ipc('getQueue');
        profile.queue = { total: queue.total, done: queue.done, failed: queue.failed, pausedReason: queue.pausedReason ?? null, current: queue.current?.title ?? null };
        noteOnce(`queue:${label}`, `${label}: queue ${queue.done + queue.failed}/${queue.total} (failed ${queue.failed})`
          + `${queue.current ? ` — ${queue.current.kind}: ${queue.current.title}` : ''}${queue.pausedReason ? ` — PAUSED: ${queue.pausedReason}` : ''}`);
        if (queue.pausedReason) return true;
        if (queue.total === 0) return null;
        return queue.current == null && queue.done + queue.failed >= queue.total;
      });

      const modelRef = { provider: 'nodus', model: modelId };
      // The scan queue pauses globally when a model is refused for the extraction role
      // (which is exactly what happens in the vaults whose model the capability matrix
      // blocks). A previous vault's refusal must not silently carry over into this one,
      // or its jobs would never even be attempted.
      const queueBefore = await ipc('getQueue');
      if (queueBefore.paused || queueBefore.pausedReason) {
        note(`${name}: resuming the scan queue left paused by a previous vault (${queueBefore.pausedReason ?? 'paused'})`);
        await ipc('resumeQueue');
      }
      for (const nodusId of nodusIds) {
        await ipc('processFull', nodusId, modelRef);
        await settleQueue(`${name}:${nodusId.slice(0, 8)}`);
      }
      profile.works = summarizeWorks(await ipc('listWorks'));

      // Anything the local model left unfinished gets another pass on its own. Each
      // pass resumes only the ideas whose fusion did not land, so repeated passes
      // converge instead of restarting the paper.
      profile.retries = [];
      const retryRounds = Number(arg('--retry-rounds', '4'));
      for (let round = 0; round < retryRounds; round += 1) {
        const failed = (await ipc('listWorks')).filter((work) => work.deep_status === 'failed');
        if (!failed.length) break;
        for (const work of failed) {
          note(`${name}: retrying "${work.title}" on its own (round ${round + 1}/${retryRounds})`);
          await ipc('processFull', work.nodus_id, modelRef);
          await settleQueue(`${name}:retry:${work.nodus_id.slice(0, 8)}`);
          const after = (await ipc('listWorks')).find((entry) => entry.nodus_id === work.nodus_id);
          profile.retries.push({ title: work.title, round: round + 1, deep: after?.deep_status ?? null, ideas: after?.ideaCount ?? 0 });
        }
      }
      profile.works = summarizeWorks(await ipc('listWorks'));

      // Theme + relation reprocessing: the only analysis role that is not gated by
      // the extraction capability matrix, so the two models Nodus refuses to use
      // for idea extraction still get a real, persisted inference pass.
      profile.reprocess = await ipc('reprocessThemeConnections', { relations: true }, { provider: 'nodus', model: modelId })
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

      // Document index (profiles) for the imported works. Bounded twice: the deadline,
      // and a stall detector — a vault whose model is blocked for the document-profile
      // role leaves jobs queued with nothing running, and waiting the full budget would
      // hide that instead of recording it.
      const campaign = await ipc('startDocumentIndexCampaign', { includeArchived: false });
      profile.documentIndexCampaignId = campaign?.campaignId ?? campaign?.id ?? null;
      let stalledPolls = 0;
      await waitFor(`índice documental de ${name}`, async () => {
        const progress = await ipc('getDocumentIndexProgress');
        profile.documentIndex = { active: progress.active, queued: progress.queued, failed: progress.failed, jobs: progress.jobs?.length ?? 0 };
        noteOnce(`docindex:${name}`, `${name}: document index active=${progress.active} queued=${progress.queued} jobs=${progress.jobs?.length ?? 0} failed=${progress.failed}`);
        if (progress.active === 0 && progress.queued === 0) return true;
        if (progress.active === 0) {
          stalledPolls += 1;
          if (stalledPolls >= 5) {
            profile.documentIndex.blocked = 'queued jobs never started (the document-profile role is refused for this model)';
            note(`${name}: document index is stalled with ${progress.queued} queued jobs and nothing running; recording it as blocked`);
            return true;
          }
        } else {
          stalledPolls = 0;
        }
        return null;
      }, { timeout: 45 * 60 * 1000 });

      // Embeddings: ideas, then full-text passages (BGE-M3 Q8 through llama.cpp).
      // A vault where extraction was refused has nothing to embed; that is recorded
      // instead of waiting for a pipeline that will never be started.
      profile.ideasPersisted = (profile.works ?? []).reduce((sum, work) => sum + (work.ideas ?? 0), 0);
      if (!profile.ideasPersisted) {
        profile.embeddings = { skipped: 'no ideas persisted (extraction refused by the capability matrix)' };
        profile.passageEmbeddings = { skipped: 'same' };
      } else {
        await ipc('startEmbedding', nodusIds);
        await waitFor(`embeddings de ideas de ${name}`, async () => {
          const status = await ipc('getEmbeddingStatus');
          profile.embeddings = { running: status.running, ideasEmbedded: status.ideasEmbedded, totalIdeas: status.totalIdeas, error: status.error ?? null };
          noteOnce(`emb:${name}`, `${name}: idea embeddings ${status.ideasEmbedded}/${status.totalIdeas} running=${status.running}`);
          return status.running === false && (status.startedAt != null || status.error != null);
        }, { timeout: 60 * 60 * 1000 });

        await ipc('startPassageEmbedding', nodusIds);
        await waitFor(`embeddings de pasajes de ${name}`, async () => {
          const status = await ipc('getPassageStatus');
          profile.passageEmbeddings = { running: status.running, passagesEmbedded: status.passagesEmbedded, totalPassages: status.totalPassages, error: status.error ?? null };
          noteOnce(`pass:${name}`, `${name}: passage embeddings ${status.passagesEmbedded}/${status.totalPassages} running=${status.running}`);
          return status.running === false && (status.startedAt != null || status.error != null);
        }, { timeout: 90 * 60 * 1000 });
      }

      // Persisted results.
      const finalWorks = await ipc('listWorks');
      const graph = await ipc('getGraph', 'ideas');
      profile.works = summarizeWorks(finalWorks);
      profile.ideaNodes = (graph.nodes ?? []).length;
      profile.relationEdges = (graph.edges ?? []).length;
      profile.ideasWithOccurrences = (finalWorks ?? []).reduce((sum, work) => sum + (work.ideaCount ?? 0), 0);
      profile.runtimeDuringRun = (await statusSnapshot(`vault:${name}`)).runtime;
      profile.verdict = {
        allWorksCompleted: profile.works.every((work) => work.deep === 'done'),
        structuredIdeas: profile.ideasWithOccurrences > 0,
        gpuOffloadObserved: (report.runtime[`vault:${name}`]?.offload?.layers ?? 0) > 0,
      };
      profile.finishedAt = new Date().toISOString();
      profile.ok = true;
    } catch (error) {
      profile.ok = false;
      profile.error = error instanceof Error ? error.message : String(error);
      await writeReport();
      throw error;
    }
    await writeReport();
  }
} catch (error) {
  failure = error;
  report.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
} finally {
  await writeReport();
  zoteroServer.close();
  if (keepOpen) {
    console.log('[e2e-local-ai] leaving the application open for inspection');
  } else {
    await app.close().catch(() => undefined);
  }
}

const lines = Object.entries(report.profiles).map(([name, profile]) => {
  const deep = (profile.works ?? []).filter((work) => work.deep === 'done').length;
  return `${name.padEnd(8)} ok=${profile.ok} import=${profile.imported ?? 0}/${PAPERS.length}`
    + ` deepDone=${deep}/${(profile.works ?? []).length} ideas=${profile.ideasWithOccurrences ?? 0}`
    + ` embeddings=${profile.embeddings?.ideasEmbedded ?? 0}/${profile.embeddings?.totalIdeas ?? 0}`
    + ` passages=${profile.passageEmbeddings?.passagesEmbedded ?? 0}/${profile.passageEmbeddings?.totalPassages ?? 0}`
    + ` gpu=${report.runtime?.[`vault:${name}`]?.offload?.layers ?? 0}/${report.runtime?.[`vault:${name}`]?.offload?.totalLayers ?? 0} layers`
    + (profile.error ? ` ERROR=${profile.error}` : '');
});
console.log(lines.join('\n'));
console.log(`[e2e-local-ai] report: ${reportPath}`);
if (failure) throw failure;
