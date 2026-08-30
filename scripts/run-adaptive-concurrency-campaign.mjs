#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const corpusManifestPath = path.join(root, 'audit/adaptive-concurrency/corpus.json');
const corpusManifest = JSON.parse(await fsp.readFile(corpusManifestPath, 'utf8'));
const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const provider = arg('--provider');
const model = arg('--model');
const embeddingProvider = arg('--embedding-provider');
const embeddingModel = arg('--embedding-model');
const mode = arg('--mode');
const sourceUserData = arg('--source-userdata');
const openCodeAuthFile = arg('--opencode-auth-file');
const campaignIndex = Number(arg('--campaign-index', '1'));
const pairId = arg('--pair-id', `pair-${campaignIndex}`);
const routingMode = arg('--routing-mode', provider === 'openrouter' ? 'throughput' : provider === 'nodus' ? 'local' : 'direct');
const startAtProfiles = process.argv.includes('--start-at-profiles');
const paperCount = Number(arg('--paper-count', '10'));
const auditDatabasePath = arg('--audit-database');
if (!auditDatabasePath) {
  assert.ok(provider && model && embeddingProvider && embeddingModel, 'Faltan proveedor/modelo de generación o embeddings.');
  assert.ok(mode === 'manual' || mode === 'automatic', '--mode debe ser manual o automatic.');
  assert.ok(Number.isInteger(campaignIndex) && campaignIndex > 0, '--campaign-index no es válido.');
  assert.ok(sourceUserData, 'Se requiere --source-userdata para copiar secretos/modelos sin tocar el perfil real.');
}
assert.ok(Number.isInteger(paperCount) && paperCount >= 1 && paperCount <= 10, '--paper-count debe estar entre 1 y 10.');
if (!auditDatabasePath && (!fs.existsSync(path.join(root, 'dist-electron/main.js')) || !fs.existsSync(path.join(root, 'dist/index.html')))) {
  throw new Error('Falta el build. Ejecuta npm run build antes de una campaña facturable.');
}

const profile = path.resolve(arg('--profile', await fsp.mkdtemp(path.join(os.tmpdir(), 'nodus-adaptive-campaign-'))));
const output = path.resolve(arg('--out', path.join(profile, 'audit/raw-campaign.json')));
const perfJsonl = path.join(profile, 'audit/perf.jsonl');
await fsp.mkdir(path.join(profile, 'audit'), { recursive: true, mode: 0o700 });

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function sha256Files(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(path.relative(root, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function workingTreeStateHash() {
  const hash = crypto.createHash('sha256');
  const trackedDiff = spawnSync('git', ['diff', '--binary', 'HEAD'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(trackedDiff.status, 0, trackedDiff.stderr?.toString() || 'No se pudo leer el diff del candidato.');
  hash.update(trackedDiff.stdout);
  const untrackedResult = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'buffer',
  });
  assert.equal(untrackedResult.status, 0, untrackedResult.stderr?.toString() || 'No se pudieron enumerar los archivos nuevos.');
  const untracked = untrackedResult.stdout.toString().split('\0').filter(Boolean).sort();
  for (const relative of untracked) {
    const file = path.join(root, relative);
    if (!fs.statSync(file).isFile()) continue;
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function databaseHashes(directory) {
  if (!directory || !fs.existsSync(directory)) return {};
  const result = {};
  const visit = async (current) => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.sqlite(?:3)?$/i.test(entry.name)) result[path.relative(directory, target)] = sha256File(target);
    }
  };
  await visit(directory);
  return result;
}

function protectedDatabaseHashes(hashes) {
  return Object.fromEntries(Object.entries(hashes).filter(([relative]) => {
    const normalized = relative.replaceAll('\\', '/');
    return normalized === 'nodus.sqlite' || /^vaults\/[^/]+\/nodus\.sqlite$/i.test(normalized);
  }));
}

function changedHashes(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((relative) => before[relative] !== after[relative])
    .sort()
    .map((relative) => ({ relative, before: before[relative] ?? null, after: after[relative] ?? null }));
}

function normalizedEvidenceText(value, typographic = false) {
  let normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00ad/g, '')
    .replace(/-\s+(?=\p{Ll})/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
  if (typographic) normalized = normalized
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s*([,.;:!?()[\]{}])\s*/g, '$1');
  return normalized;
}

function validateVectorRows(rows) {
  let valid = 0;
  for (const row of rows) {
    const bytes = row.embedding;
    assert.ok(Buffer.isBuffer(bytes), `${row.kind}:${row.id}: embedding nulo.`);
    assert.ok(Number.isInteger(row.embedding_dim) && row.embedding_dim > 0, `${row.kind}:${row.id}: dimensión inválida.`);
    assert.equal(bytes.byteLength, row.embedding_dim * 4, `${row.kind}:${row.id}: longitud/dimensión incompatibles.`);
    const copy = Uint8Array.from(bytes);
    const vector = new Float32Array(copy.buffer);
    let norm = 0;
    for (const value of vector) {
      assert.ok(Number.isFinite(value), `${row.kind}:${row.id}: embedding no finito.`);
      norm += value * value;
    }
    assert.ok(norm > 1e-12, `${row.kind}:${row.id}: embedding nulo.`);
    valid += 1;
  }
  return { total: rows.length, valid, invalid: rows.length - valid };
}

async function auditCampaignDatabase(databasePath, selectedKeys, cacheDirectory) {
  const audit = spawnSync(require('electron'), [
    path.join(root, 'scripts/adaptive-concurrency-db-audit.mjs'),
    '--database', databasePath,
    '--keys', selectedKeys.join(','),
    '--cache', cacheDirectory,
  ], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(audit.status, 0, audit.stderr || audit.stdout || 'La auditoría estructural no pudo ejecutarse.');
  return JSON.parse(audit.stdout);
  /* istanbul ignore next -- The standalone helper below uses Electron's native ABI.
   * Keeping this implementation adjacent documents the exact contract for readers
   * of the campaign runner; Node itself returns through the helper above. */
  const Database = require('better-sqlite3');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = selectedKeys.map(() => '?').join(',');
    const works = database.prepare(`
      SELECT nodus_id, zotero_key, title, deep_status, summary_status, resolved_has_page_markers
        FROM works WHERE zotero_key IN (${placeholders}) ORDER BY rowid
    `).all(...selectedKeys);
    assert.deepEqual(
      works.map((work) => work.zotero_key).sort(),
      [...selectedKeys].sort(),
      'La base aislada no contiene exactamente la selección de papers.',
    );
    assert.ok(works.every((work) => work.deep_status === 'done' && work.summary_status === 'done'),
      'Una obra se marcó sin completar extracción o resumen.');
    assert.ok(works.every((work) => work.resolved_has_page_markers === 1),
      'Una obra perdió los marcadores de página del PDF.');

    const evidence = database.prepare(`
      SELECT e.id, e.global_id, e.nodus_id, e.quote, e.location, e.kind, e.source_ref,
             e.page_number, w.zotero_key, CASE WHEN i.global_id IS NULL THEN 0 ELSE 1 END AS idea_exists
        FROM evidence e
        JOIN works w ON w.nodus_id=e.nodus_id
        LEFT JOIN ideas i ON i.global_id=e.global_id
       WHERE w.zotero_key IN (${placeholders})
       ORDER BY w.rowid, e.rowid
    `).all(...selectedKeys);
    assert.ok(evidence.length > 0, 'La extracción terminó sin evidencias.');

    const paperByKey = new Map(corpusManifest.papers.map((paper) => [paper.key, paper]));
    const pageText = new Map();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    let explicit = 0;
    let paraphrased = 0;
    let exactLiteral = 0;
    let typographicLiteral = 0;
    let evidenceWithPage = 0;
    for (const item of evidence) {
      const paper = paperByKey.get(item.zotero_key);
      assert.ok(paper, `${item.id}: evidencia asociada a una obra fuera del corpus.`);
      assert.equal(item.idea_exists, 1, `${item.id}: evidencia huérfana de idea.`);
      assert.ok(String(item.quote ?? '').trim(), `${item.id}: evidencia vacía.`);
      assert.ok(String(item.source_ref ?? '').endsWith(`:${paper.attachmentKey}`), `${item.id}: fuente Zotero inválida.`);
      assert.ok(item.kind === 'explicit' || item.kind === 'paraphrased', `${item.id}: tipo de evidencia inválido.`);
      if (item.page_number != null) {
        evidenceWithPage += 1;
        assert.ok(Number.isInteger(item.page_number) && item.page_number >= 1 && item.page_number <= paper.pages,
          `${item.id}: página fuera del PDF.`);
      }
      if (item.kind === 'paraphrased') {
        paraphrased += 1;
        continue;
      }
      explicit += 1;
      assert.ok(item.page_number != null, `${item.id}: cita explícita sin página.`);
      const pageKey = `${paper.key}:${item.page_number}`;
      if (!pageText.has(pageKey)) {
        const pdfPath = path.join(cacheDirectory, `${paper.arxiv}.pdf`);
        assert.ok(fs.existsSync(pdfPath), `${paper.key}: falta el PDF canónico para auditar citas.`);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(pdfPath)), disableWorker: true }).promise;
        try {
          const page = await pdf.getPage(item.page_number);
          const content = await page.getTextContent();
          pageText.set(pageKey, content.items.map((entry) => 'str' in entry ? entry.str : '').join(' '));
        } finally {
          await pdf.destroy();
        }
      }
      const source = pageText.get(pageKey);
      const exact = normalizedEvidenceText(source).includes(normalizedEvidenceText(item.quote));
      const typographic = normalizedEvidenceText(source, true).includes(normalizedEvidenceText(item.quote, true));
      if (exact) exactLiteral += 1;
      if (typographic) typographicLiteral += 1;
      assert.ok(typographic, `${item.id}: la cita explícita no aparece literalmente en la página declarada.`);
    }

    const vectorQueries = [
      ['idea', `SELECT DISTINCT i.global_id AS id, i.embedding, i.embedding_dim FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id JOIN works w ON w.nodus_id=io.nodus_id WHERE i.orphaned_at IS NULL AND w.zotero_key IN (${placeholders})`],
      ['passage', `SELECT p.passage_id AS id, p.embedding, p.embedding_dim FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE w.zotero_key IN (${placeholders})`],
      ['document', `SELECT d.vector_id AS id, d.embedding, d.embedding_dim FROM document_vectors d JOIN works w ON w.nodus_id=d.nodus_id WHERE w.zotero_key IN (${placeholders})`],
    ];
    const embeddings = {};
    for (const [kind, sql] of vectorQueries) {
      const rows = database.prepare(sql).all(...(sql.includes(placeholders) ? selectedKeys : []))
        .map((row) => ({ ...row, kind }));
      assert.ok(rows.length > 0, `${kind}: no se publicaron vectores.`);
      embeddings[kind] = validateVectorRows(rows);
    }

    const profiles = database.prepare(`
      SELECT s.nodus_id, s.status, v.state, v.quality_score, v.audit_json
        FROM document_profile_state s
        JOIN document_profile_versions v ON v.version_id=s.current_version_id
        JOIN works w ON w.nodus_id=s.nodus_id
       WHERE w.zotero_key IN (${placeholders})
    `).all(...selectedKeys);
    assert.equal(profiles.length, selectedKeys.length, 'Falta un perfil documental actual.');
    assert.ok(profiles.every((profile) => profile.status === 'current' && profile.state === 'current'),
      'Un perfil no alcanzó estado current.');
    assert.ok(profiles.every((profile) => Number(profile.quality_score) >= 0.8 && String(profile.audit_json ?? '').trim()),
      'Un perfil no superó la auditoría automática mínima.');

    const papers = database.prepare(`
      SELECT w.zotero_key,
             (SELECT COUNT(*) FROM idea_occurrences io WHERE io.nodus_id=w.nodus_id) AS ideas,
             (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id) AS evidence,
             (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id AND e.kind='explicit') AS explicit,
             (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id AND e.kind='paraphrased') AS paraphrased
        FROM works w WHERE w.zotero_key IN (${placeholders}) ORDER BY w.rowid
    `).all(...selectedKeys);
    assert.ok(papers.every((paper) => paper.ideas > 0 && paper.evidence >= paper.ideas),
      'Una obra quedó vacía o con ideas sin cobertura mínima de evidencia.');

    return {
      pass: true,
      works: works.length,
      papers,
      evidence: {
        total: evidence.length,
        explicit,
        paraphrased,
        withPage: evidenceWithPage,
        exactLiteral,
        typographicLiteral,
        explicitLiteralPrecision: explicit ? typographicLiteral / explicit : 0,
      },
      embeddings,
      profiles: {
        total: profiles.length,
        current: profiles.filter((profile) => profile.status === 'current').length,
        minimumQualityScore: Math.min(...profiles.map((profile) => Number(profile.quality_score))),
        audited: profiles.filter((profile) => String(profile.audit_json ?? '').trim()).length,
      },
    };
  } finally {
    database.close();
  }
}

if (auditDatabasePath) {
  const selectedKeys = corpusManifest.papers.slice(0, paperCount).map((paper) => paper.key);
  const cacheDirectory = path.resolve(arg('--cache', path.join(os.tmpdir(), 'nodus-adaptive-corpus-v1')));
  const result = await auditCampaignDatabase(path.resolve(auditDatabasePath), selectedKeys, cacheDirectory);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

async function cloneTree(source, destination) {
  const stat = await fsp.stat(source);
  if (stat.isDirectory()) {
    await fsp.mkdir(destination, { recursive: true });
    for (const entry of await fsp.readdir(source)) await cloneTree(path.join(source, entry), path.join(destination, entry));
  } else {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_FICLONE);
  }
}

const sourceHashesBefore = await databaseHashes(sourceUserData);
const protectedSourceHashesBefore = protectedDatabaseHashes(sourceHashesBefore);
let importedOpenCodeGoKey = null;
if (provider === 'opencode-go' && openCodeAuthFile) {
  const auth = JSON.parse(await fsp.readFile(path.resolve(openCodeAuthFile), 'utf8'));
  importedOpenCodeGoKey = auth?.['opencode-go']?.key;
  assert.ok(typeof importedOpenCodeGoKey === 'string' && importedOpenCodeGoKey.trim(),
    'El fichero de autenticación no contiene una clave de OpenCode Go.');
}
if (sourceUserData) {
  await fsp.mkdir(path.join(profile, 'secrets'), { recursive: true, mode: 0o700 });
  for (const name of [...new Set([provider === 'gemini' ? 'gemini' : provider, embeddingProvider === 'gemini' ? 'gemini' : embeddingProvider])]) {
    if (name === 'nodus') continue;
    const source = path.join(sourceUserData, 'secrets', `ai_key_${name}.bin`);
    if (name === 'opencode-go' && importedOpenCodeGoKey) continue;
    assert.ok(fs.existsSync(source), `Falta el secreto cifrado de ${name} en el perfil fuente.`);
    const digest = sha256File(source);
    await fsp.copyFile(source, path.join(profile, 'secrets', path.basename(source)), fs.constants.COPYFILE_FICLONE);
    assert.equal(sha256File(source), digest, `El secreto fuente de ${name} cambió durante la copia.`);
  }
  const localIds = [provider === 'nodus' ? model : null, embeddingProvider === 'nodus' ? embeddingModel : null].filter(Boolean);
  if (localIds.length) {
    for (const id of localIds) {
      const source = path.join(sourceUserData, 'local-ai/models', id);
      assert.ok(fs.existsSync(source), `Falta el modelo local descargado ${id}.`);
      await cloneTree(source, path.join(profile, 'local-ai/models', id));
    }
    const runtime = path.join(sourceUserData, 'local-ai/runtime');
    assert.ok(fs.existsSync(runtime), 'Falta el runtime local distribuido.');
    await cloneTree(runtime, path.join(profile, 'local-ai/runtime'));
  }
}

function waitForServerReady(child) {
  return new Promise((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => reject(new Error('El Zotero falso no arrancó.')), 30_000);
    child.stdout.on('data', (chunk) => {
      pending += String(chunk);
      const newline = pending.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(pending.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.once('exit', (code) => reject(new Error(`El Zotero falso terminó antes de arrancar (${code}).`)));
  });
}

const zotero = spawn(process.execPath, [
  'scripts/adaptive-concurrency-audit.mjs', 'serve', '--paper-count', String(paperCount),
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const zoteroReady = await waitForServerReady(zotero);
let app = null;
const startedNs = process.hrtime.bigint();
let vaultPath = null;
let queue = null;
let documentProgress = null;
let featureChecks = null;
let campaignError = null;
let interruptSignal = null;
const interrupt = (signal) => {
  if (interruptSignal) return;
  interruptSignal = signal;
  // Installing a listener suppresses Node's abrupt default exit. Closing the
  // Electron app lets its normal shutdown stop leased local runtimes; the main
  // try/catch then writes a resumable failed campaign instead of orphaning it.
  void app?.close().catch(() => undefined);
  zotero.kill('SIGTERM');
};
const onSigint = () => interrupt('SIGINT');
const onSigterm = () => interrupt('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);
try {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: profile,
    NODUS_PERF_JSONL: perfJsonl,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
    NODUS_ZOTERO_API_BASE: zoteroReady.baseUrl,
    ...(routingMode === 'controlled' ? { NODUS_AUDIT_OPENROUTER_PROVIDER: arg('--openrouter-provider', 'DeepInfra') } : {}),
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [root], env: childEnv });
  if (process.argv.includes('--debug-app-logs')) {
    app.process().stdout?.on('data', (chunk) => process.stderr.write(`[electron:stdout] ${chunk}`));
    app.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron:stderr] ${chunk}`));
  }
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await page.waitForFunction(() => typeof window.nodus?.getSettings === 'function');
  if (importedOpenCodeGoKey) {
    await page.evaluate((key) => window.nodus.setApiKey('opencode-go', key), importedOpenCodeGoKey);
    importedOpenCodeGoKey = null;
  }
  const setup = await page.evaluate(async (config) => {
    let vault = (await window.nodus.listVaults()).find((entry) => entry.active);
    if (!vault) {
      vault = (await window.nodus.createVault({ name: 'Adaptive concurrency audit', type: 'academic' })).vault;
      const switched = await window.nodus.switchVault(vault.id);
      if (!switched.ok) throw new Error(switched.message);
      vault = switched.activeVault ?? vault;
    }
    const ref = { provider: config.provider, model: config.model };
    await window.nodus.updateSettings({
      aiConcurrencyMode: config.mode,
      aiConcurrencyVersion: 1,
      concurrency: 1,
      promptLanguage: 'en',
      extractionModel: ref,
      synthesisModel: ref,
      summaryModel: ref,
      fusionModel: ref,
      documentProfileModel: ref,
      documentAuditModel: ref,
      chatModel: ref,
      nodiModel: ref,
      deepResearchModel: ref,
      immersionModel: ref,
      writingModel: ref,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      openRouterThroughput: config.routingMode === 'throughput',
      autoSummaryAfterDeep: true,
      autoBridgeAfterQueue: true,
      documentIndexingEnabled: false,
      preferZoteroFulltext: false,
      ocrEnabled: false,
      deepContextMode: 'standard',
      deepStandardChunkWords: 1800,
    });
    const ping = await window.nodus.zoteroPing();
    if (!ping.ok) throw new Error(ping.error ?? 'Zotero falso no disponible.');
    const library = { type: 'user', id: '0', name: 'Audit' };
    const items = await window.nodus.zoteroSearchItems(library, '');
    const works = await window.nodus.ingestZoteroItems(items);
    if (works.length !== config.paperCount) throw new Error(`Se importaron ${works.length}/${config.paperCount} obras.`);
    return { vaultPath: vault.path, nodusIds: works.map((work) => work.nodus_id) };
  }, { provider, model, embeddingProvider, embeddingModel, mode, routingMode, paperCount });
  vaultPath = setup.vaultPath;
  const deadline = Date.now() + Number(arg('--timeout-ms', String(4 * 60 * 60_000)));
  if (!startAtProfiles) {
    await page.evaluate(async ({ nodusIds, provider: selectedProvider, model: selectedModel }) => {
      await window.nodus.processFullBulk(nodusIds, { provider: selectedProvider, model: selectedModel });
    }, { nodusIds: setup.nodusIds, provider, model });

    let stableSince = 0;
    let lastSignature = '';
    while (Date.now() < deadline) {
      queue = await page.evaluate(() => window.nodus.getQueue());
      if (queue.pausedReason) throw new Error(`Cola pausada: ${queue.pausedReason}`);
      if (queue.maintenanceError) throw new Error(`Postprocesado pendiente: ${queue.maintenanceError}`);
      const active = queue.items.some((item) => item.state === 'queued' || item.state === 'running' || item.state === 'paused');
      const deepCount = queue.items.filter((item) => item.kind === 'deep').length;
      const hasBridge = queue.items.some((item) => item.kind === 'bridge');
      const signature = `${queue.total}:${queue.done}:${queue.failed}:${deepCount}:${hasBridge}`;
      // A completely failed extraction cannot enqueue the bridge maintenance job.
      // Finish the observation loop immediately so the assertion below records the
      // actual provider errors instead of misreporting a four-hour timeout.
      if (!active && deepCount === paperCount && (hasBridge || queue.failed > 0)) {
        if (signature !== lastSignature) stableSince = Date.now();
        if (Date.now() - stableSince >= 5_000) break;
      } else stableSince = 0;
      lastSignature = signature;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } else {
    queue = await page.evaluate(() => window.nodus.getQueue());
  }
  assert.ok(queue && !queue.items.some((item) => ['queued', 'running', 'paused'].includes(item.state)), 'La campaña agotó el timeout con trabajos activos.');
  assert.equal(queue.failed, 0, queue.items.filter((item) => item.state === 'failed').map((item) => item.error).join('\n'));

  const documentCampaign = await page.evaluate((nodusIds) => window.nodus.startDocumentIndexCampaign({ nodusIds }), setup.nodusIds);
  while (Date.now() < deadline) {
    documentProgress = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    const campaign = documentProgress.campaigns.find((entry) => entry.campaignId === documentCampaign.campaignId);
    if (campaign?.status === 'failed') {
      const details = documentProgress.jobs
        .filter((job) => job.campaignId === documentCampaign.campaignId && (job.status === 'failed' || job.status === 'unavailable'))
        .map((job) => `${job.title ?? job.nodusId}: ${job.error ?? job.status}`)
        .join('\n');
      throw new Error(`Perfil documental falló: ${campaign.error ?? `${campaign.failedJobs} trabajos`}${details ? `\n${details}` : ''}`);
    }
    if (campaign?.status === 'completed') {
      assert.equal(campaign.totalJobs, paperCount);
      assert.equal(campaign.completedJobs, paperCount);
      assert.equal(campaign.failedJobs, 0);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.ok(documentProgress?.campaigns.some((entry) => entry.campaignId === documentCampaign.campaignId && entry.status === 'completed'), 'La campaña de perfiles documentales agotó el timeout.');

  if (!process.argv.includes('--skip-extended')) {
    featureChecks = await page.evaluate(async ({ selectedProvider, selectedModel }) => {
      const selected = { provider: selectedProvider, model: selectedModel };
      const objective = 'Compare the central contributions, assumptions, evidence, limitations, and practical implications of the indexed papers.';
      const selection = {
        ideas: true, themes: true, contradictions: true, gaps: true, readingPath: false,
        authors: true, documents: true, passages: true, graph: true,
        graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: false },
      };
      const references = (text) => {
        const result = [];
        const seen = new Set();
        for (const match of String(text).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
          let id = match[2];
          try { id = decodeURIComponent(id); } catch { /* Keep the exact emitted id. */ }
          const key = `${match[1]}:${id}`;
          if (!seen.has(key)) { seen.add(key); result.push({ kind: match[1], id }); }
        }
        return result;
      };
      const citationAudit = async (text) => {
        const refs = references(text);
        const verdicts = refs.length ? await window.nodus.verifyCitations(refs) : {};
        return {
          total: refs.length,
          valid: refs.filter((ref) => verdicts[`${ref.kind}:${ref.id}`] === true).length,
          invalid: refs.filter((ref) => verdicts[`${ref.kind}:${ref.id}`] !== true).length,
        };
      };

      const semantic = await window.nodus.semanticSearch(objective, {
        kinds: ['work', 'passage', 'idea'], limit: 40, minSimilarity: 0.12,
      });
      let chatStream = '';
      const chat = await window.nodus.researchChatStream(
        { messages: [{ role: 'user', content: objective }], selection, model: selected },
        { onDelta: (delta) => { chatStream += delta; } },
      );
      const chatText = chat.answer || chatStream;
      let nodiStream = '';
      const nodi = await window.nodus.nodiChatStream(
        { messages: [{ role: 'user', content: objective }], contexts: ['vault'], model: selected },
        { onDelta: (delta) => { nodiStream += delta; } },
      );
      const nodiText = String(nodi || nodiStream);

      const brief = {
        kind: 'literature_review', objective, audience: 'academic researchers', tone: 'critical', language: 'en',
      };
      const writingSnapshot = await window.nodus.getWritingWorkshopSnapshot(brief);
      const writing = await window.nodus.generateWritingWorkshopDraft({
        brief, selection: writingSnapshot.recommendedSelection, model: selected,
      });

      const immersion = await window.nodus.generateImmersionSession({
        topic: 'efficient and reliable foundation-model adaptation', language: 'en', minutes: 30,
        includeQuiz: true, model: selected, decorativeImage: { enabled: false, style: 'antique_book' },
      });
      const immersionCitations = immersion.plan.stations.flatMap((station) => station.citations ?? []);

      const reportObjectives = [
        'Compare the central methodological contributions and assumptions of the indexed papers using only evidence from this corpus.',
        'Assess the evaluation evidence, limitations, and threats to validity reported by the indexed papers.',
        'Explain the most important conceptual connections and practical trade-offs across the indexed papers.',
      ];
      const reports = [];
      for (const reportObjective of reportObjectives) {
        const report = await window.nodus.generateDeepResearchReport({
          objective: reportObjective, language: 'en', audience: 'academic researchers',
          sectionLimit: 3, model: selected, decorativeImage: { enabled: false, style: 'antique_book' },
          // Verify the production default. v2 is an explicit, higher-token opt-in
          // with its own quality suite and may expand the architecture beyond the
          // requested preference to satisfy its full-document coverage contract.
          deepResearchVersion: 'v1',
        });
        reports.push({
          words: report.meta.words,
          worksCited: report.meta.worksCited,
          stoppedReason: report.meta.stoppedReason,
          verification: report.meta.verification ?? null,
          citations: await citationAudit(report.draft.draftMarkdown),
        });
      }
      return {
        semantic: {
          available: semantic.available,
          results: semantic.results.length,
          works: semantic.results.filter((entry) => entry.kind === 'work').length,
          passages: semantic.results.filter((entry) => entry.kind === 'passage').length,
          ideas: semantic.results.filter((entry) => entry.kind === 'idea').length,
        },
        chat: { chars: chatText.length, citations: await citationAudit(chatText), stats: chat.stats },
        nodi: { chars: nodiText.length, citations: await citationAudit(nodiText) },
        writing: {
          chars: writing.draftMarkdown.length,
          bibliography: writing.bibliography.length,
          citations: await citationAudit(writing.draftMarkdown),
        },
        immersion: {
          stations: immersion.plan.stations.length,
          stoppedReason: immersion.plan.stoppedReason,
          citations: immersionCitations.length,
          invalidCitations: immersionCitations.filter((citation) =>
            !citation.passageId || !citation.workId || !citation.text?.trim()).length,
        },
        deepResearch: reports,
      };
    }, { selectedProvider: provider, selectedModel: model });

    assert.ok(featureChecks.semantic.available && featureChecks.semantic.results > 0, 'La búsqueda semántica no devolvió resultados.');
    assert.ok(featureChecks.chat.chars > 0 && featureChecks.nodi.chars > 0, 'Chat o Nodi devolvieron una respuesta vacía.');
    assert.ok(featureChecks.chat.citations.total > 0, 'Chat no emitió ninguna cita verificable.');
    assert.ok(featureChecks.nodi.citations.total > 0, 'Nodi no emitió ninguna cita verificable.');
    assert.equal(featureChecks.chat.citations.invalid, 0, 'Chat emitió citas internas inválidas.');
    assert.equal(featureChecks.nodi.citations.invalid, 0, 'Nodi emitió citas internas inválidas.');
    assert.ok(featureChecks.writing.chars > 0 && featureChecks.writing.bibliography > 0, 'Writing no produjo un borrador bibliográfico completo.');
    assert.ok(featureChecks.writing.citations.total > 0, 'Writing no emitió ninguna cita verificable.');
    assert.equal(featureChecks.writing.citations.invalid, 0, 'Writing emitió citas internas inválidas.');
    assert.ok(featureChecks.immersion.stations > 0 && !featureChecks.immersion.stoppedReason, 'Immersion terminó de forma incompleta.');
    assert.ok(featureChecks.immersion.citations > 0, 'Immersion no emitió ninguna cita verificable.');
    assert.equal(featureChecks.immersion.invalidCitations, 0, 'Immersion publicó citas incompletas.');
    assert.equal(featureChecks.deepResearch.length, 3, 'No se completaron los tres informes Deep Research.');
    assert.ok(featureChecks.deepResearch.every((report) => report.words > 0 && report.worksCited > 0 && !report.stoppedReason), 'Un informe Deep Research quedó incompleto.');
    assert.ok(featureChecks.deepResearch.every((report) => report.citations.total > 0), 'Un informe Deep Research no emitió citas verificables.');
    assert.ok(featureChecks.deepResearch.every((report) => report.citations.invalid === 0), 'Deep Research emitió citas internas inválidas.');
    assert.ok(featureChecks.deepResearch.every((report) => report.verification?.checked > 0
      && report.verification.unverified === 0), 'Deep Research dejó afirmaciones citadas sin verificación semántica.');
  }
} catch (error) {
  campaignError = error instanceof Error ? error : new Error(String(error));
} finally {
  if (app) await app.close().catch(() => undefined);
  zotero.kill('SIGTERM');
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  if (interruptSignal && !campaignError) campaignError = new Error(`Campaña interrumpida por ${interruptSignal}; el perfil aislado conserva sus checkpoints.`);
}

const totalNs = process.hrtime.bigint() - startedNs;
const sourceHashesAfter = await databaseHashes(sourceUserData);
const protectedSourceHashesAfter = protectedDatabaseHashes(sourceHashesAfter);
const ambientDatabaseDrift = changedHashes(sourceHashesBefore, sourceHashesAfter);
let isolationError = null;
try {
  assert.deepEqual(
    protectedSourceHashesAfter,
    protectedSourceHashesBefore,
    'La base principal o una base de vault del perfil real cambió durante la campaña aislada.',
  );
} catch (error) {
  isolationError = error instanceof Error ? error : new Error(String(error));
}
const integrity = vaultPath
  ? spawnSync('sqlite3', [vaultPath, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).stdout.trim()
  : 'missing-vault';
let qualityAudit = null;
let qualityAuditError = null;
if (vaultPath) {
  try {
    qualityAudit = await auditCampaignDatabase(vaultPath, zoteroReady.paperKeys, zoteroReady.cache);
  } catch (error) {
    qualityAuditError = error instanceof Error ? error : new Error(String(error));
  }
}
const perfEvents = fs.existsSync(perfJsonl)
  ? (await fsp.readFile(perfJsonl, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];
const requestHashes = perfEvents
  .filter((event) => event.phase === 'AI inference' && event.meta?.requestHash)
  .map((event) => event.meta.requestHash);
const rootRequestHashes = [...new Set(perfEvents
  .filter((event) => event.phase === 'AI inference'
    && typeof event.meta?.jobId === 'string'
    && /:deep:\d+:0:/.test(event.meta.jobId)
    && event.meta?.requestHash)
  .map((event) => event.meta.requestHash))].sort();
const backendEffective = [...new Set(perfEvents.map((event) => event.meta?.backend).filter(Boolean))];
const concurrencyChanges = perfEvents
  .filter((event) => event.phase === 'AI concurrency change')
  .map((event) => ({ timestamp: event.timestamp, ...(event.meta ?? {}) }));
const phaseTimings = Object.fromEntries([...perfEvents.reduce((groups, event) => {
  if (!Number.isFinite(event.durationMs)) return groups;
  const values = groups.get(event.phase) ?? [];
  values.push(event.durationMs);
  groups.set(event.phase, values);
  return groups;
}, new Map())].map(([phase, values]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (ratio) => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
  return [phase, {
    count: ordered.length,
    totalMs: ordered.reduce((sum, value) => sum + value, 0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  }];
}));
const corpusManifestHash = sha256File(path.join(root, 'audit/adaptive-concurrency/corpus.json'));
const promptBundleHash = sha256Files([
  'electron/ai/deepResearch.ts',
  'electron/ai/deepScan.ts',
  'electron/ai/documentProfile.ts',
  'electron/ai/fusion.ts',
  'electron/ai/immersionCore.ts',
  'electron/ai/nodiChat.ts',
  'electron/ai/prompts.ts',
  'electron/ai/researchAssistant.ts',
  'electron/ai/summaryScan.ts',
  'electron/ai/writingWorkshop.ts',
].map((file) => path.join(root, file)).filter((file) => fs.existsSync(file)));
const paperTimes = new Map();
for (const event of perfEvents) {
  if (!event.nodusId) continue;
  const timestamp = Date.parse(event.timestamp);
  const current = paperTimes.get(event.nodusId) ?? {
    first: timestamp,
    last: timestamp,
    extractionMs: 0,
    summaryMs: 0,
    profileMs: 0,
  };
  current.first = Math.min(current.first, timestamp);
  current.last = Math.max(current.last, timestamp + event.durationMs);
  if (event.phase === 'deep pipeline') current.extractionMs += event.durationMs;
  else if (event.phase === 'summary pipeline') current.summaryMs += event.durationMs;
  else if (event.phase === 'document profile') current.profileMs += event.durationMs;
  paperTimes.set(event.nodusId, current);
}
const paperQueue = [];
const seenPapers = new Set();
for (const item of queue?.items ?? []) {
  const nodusId = item.nodus_id;
  if (!nodusId || seenPapers.has(nodusId)) continue;
  seenPapers.add(nodusId);
  paperQueue.push({ nodusId, title: item.title ?? nodusId });
}
for (const nodusId of paperTimes.keys()) {
  if (!seenPapers.has(nodusId)) paperQueue.push({ nodusId, title: nodusId });
}
const indexingWindowMs = paperTimes.size
  ? Math.max(...[...paperTimes.values()].map((timing) => timing.last))
    - Math.min(...[...paperTimes.values()].map((timing) => timing.first))
  : 0;
const raw = {
  schema: 'nodus-adaptive-raw-campaign/1',
  id: `${provider}-${model}-${routingMode}-${mode}-${campaignIndex}`,
  pairId,
  provider,
  model,
  embeddingProvider,
  embeddingModel,
  routingMode,
  mode,
  campaignIndex,
  host: { platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() },
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  workingTreeStateHash: workingTreeStateHash(),
  corpusManifestHash,
  corpusSelection: { count: paperCount, keys: zoteroReady.paperKeys },
  promptBundleHash,
  totalNs: totalNs.toString(),
  totalMs: Number(totalNs) / 1_000_000,
  indexingWindowMs,
  queue,
  documentIndex: documentProgress,
  featureChecks,
  papers: paperQueue.map(({ nodusId, title }, index) => {
    const timing = paperTimes.get(nodusId) ?? { first: 0, last: 0, extractionMs: 0, summaryMs: 0, profileMs: 0 };
    return {
      ordinal: index + 1,
      nodusId,
      title,
      extractionMs: timing.extractionMs,
      summaryMs: timing.summaryMs,
      profileMs: timing.profileMs,
      totalMs: timing.extractionMs + timing.summaryMs + timing.profileMs,
      wallSpanMs: timing.last - timing.first,
    };
  }),
  requestHashes,
  rootRequestHashes,
  backendEffective,
  concurrencyChanges,
  sqliteIntegrity: integrity,
  qualityAudit,
  sourceDatabaseHashes: {
    protected: { before: protectedSourceHashesBefore, after: protectedSourceHashesAfter },
    ambient: { before: sourceHashesBefore, after: sourceHashesAfter, drift: ambientDatabaseDrift },
  },
  telemetry: {
    path: perfJsonl,
    events: perfEvents.length,
    maximumRssBytes: Math.max(0, ...perfEvents.map((event) => event.rssBytes ?? 0)),
    phaseTimings,
  },
  outcome: campaignError || isolationError || qualityAuditError
    ? { status: 'failed', error: (campaignError ?? isolationError ?? qualityAuditError).message }
    : { status: 'completed', error: null },
  certification: campaignError || isolationError || qualityAuditError
    ? { status: 'failed', reason: 'La campaña no superó todos los gates automáticos.' }
    : { status: 'campaign-verified', reason: 'Integridad, completitud, citas explícitas, vectores y perfiles superaron los gates automáticos; falta la comparación manual/automática.' },
};
await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
await fsp.writeFile(output, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  ...raw,
  requestHashes: `[${requestHashes.length} hashes]`,
  queue: queue ? { total: queue.total, done: queue.done, failed: queue.failed } : null,
  sourceDatabaseHashes: isolationError ? 'verification-failed' : 'protected-databases-verified-identical',
  ambientDatabaseDrift: ambientDatabaseDrift.map((entry) => entry.relative),
}, null, 2)}\n`);
process.stderr.write(`Perfil aislado conservado para auditoría: ${profile}\n`);
if (campaignError || isolationError || qualityAuditError) throw (campaignError ?? isolationError ?? qualityAuditError);
