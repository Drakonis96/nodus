/**
 * Live, destructive-on-the-copy-only audit for whole-document understanding.
 *
 * The source Nodus profile is opened read-only exactly once through SQLite's online
 * backup API. Every Electron window, migration, queue mutation and AI call then runs
 * with NODUS_USERDATA pointing at an independently created temporary profile. Only
 * the copied Gemini and OpenRouter encrypted key blobs are made available.
 *
 * Text generation: Google Gemini / gemini-3.1-flash-lite
 * Embeddings:      OpenRouter / baai/bge-m3
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-child')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), '--electron-child', ...process.argv.slice(2)],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

const { _electron: electron } = require(path.join(repoRoot, 'node_modules/playwright-core/index.js'));
const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));

const TEXT_MODEL = Object.freeze({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
const EMBEDDING_MODEL = Object.freeze({ provider: 'openrouter', model: 'baai/bge-m3' });
const SOURCE_USERDATA = path.resolve(
  process.env.NODUS_AUDIT_SOURCE_USERDATA
    ?? '/Users/jorgepb96/Library/Application Support/Nodus',
);
const REPORT_PATH = path.resolve(
  process.env.NODUS_DOCUMENT_AUDIT_REPORT
    ?? path.join(repoRoot, 'reports/document-understanding-live-audit.json'),
);
const KEEP_CLONES = process.env.NODUS_AUDIT_KEEP_CLONES === '1';
const QUESTION = '¿Cómo pasó el turismo de las iniciativas privadas y la construcción nacional del primer tercio del siglo XX a convertirse en instrumento de propaganda durante la Guerra Civil? Distingue las obras que lo tratan como eje central de las que solo lo mencionan y cita evidencia concreta.';
const TOPIC = 'Turismo, construcción nacional e instrumentalización propagandística en España entre 1907 y la Guerra Civil';
const CANDIDATE_TITLE_FRAGMENTS = [
  'Turismo y nación. El Greco, Cervantes y Covadonga',
  'Las Rutas de Guerra. Propaganda y turismo',
  'La promoción turística privada en la España del primer tercio',
  'Travel agencies in Spain during the first third',
];
const MODEL_SETTING_KEYS = [
  'chatModel', 'nodiModel', 'extractionModel', 'visionModel',
  'summaryModel', 'synthesisModel', 'documentProfileModel', 'documentAuditModel',
  'fusionModel', 'studyModel', 'tutorModel', 'improveModel', 'questionGenModel',
  'gradingModel', 'flashcardModel', 'writingModel', 'immersionModel',
  'deepResearchModel', 'argumentMapModel', 'authorModel', 'hypothesisModel',
];

const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-document-audit-'));
const snapshotPath = path.join(auditRoot, 'source-snapshot.sqlite');
const pairedProfile = path.join(auditRoot, 'paired-profile');
const workflowProfile = path.join(auditRoot, 'workflow-profile');
const startedAt = new Date().toISOString();
const report = {
  startedAt,
  source: {},
  isolation: {},
  models: { text: TEXT_MODEL, embedding: EMBEDDING_MODEL },
  corpus: {},
  candidates: [],
  paired: {},
  workflow: {},
  databaseVerification: {},
  assertions: [],
  errors: [],
};

let pairedApp = null;
let workflowApp = null;
let mcpClient = null;
const liveApps = new Set();

function log(message) {
  process.stdout.write(`[document-audit] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileState(file, hash = false) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    path: file,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ...(hash ? { sha256: sha256File(file) } : {}),
  };
}

function sourceState(registryPath, databasePath) {
  return {
    registry: fileState(registryPath, true),
    database: fileState(databasePath, false),
    wal: fileState(`${databasePath}-wal`, false),
    shm: fileState(`${databasePath}-shm`, false),
    geminiKey: fileState(path.join(SOURCE_USERDATA, 'secrets/ai_key_gemini.bin'), true),
    openrouterKey: fileState(path.join(SOURCE_USERDATA, 'secrets/ai_key_openrouter.bin'), true),
  };
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyClone(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function readRegistry() {
  const registryPath = path.join(SOURCE_USERDATA, 'vaults.json');
  assert.ok(fs.existsSync(registryPath), `No existe el registro de vaults: ${registryPath}`);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const active = registry.vaults?.find((vault) => vault.id === registry.activeVaultId);
  assert.ok(active, 'El vault activo no aparece en vaults.json.');
  assert.equal(active.type ?? 'academic', 'academic', 'La auditoría documental requiere un vault académico activo.');
  assert.ok(fs.existsSync(active.path), `No existe la base activa: ${active.path}`);
  return { registryPath, registry, active };
}

async function onlineBackup(sourcePath, targetPath) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('query_only = ON');
    await source.backup(targetPath);
  } finally {
    source.close();
  }
}

function isolatedSettingsPatch(current) {
  const modelPatch = Object.fromEntries(MODEL_SETTING_KEYS.map((key) => [key, TEXT_MODEL]));
  return {
    ...current,
    ...modelPatch,
    embeddingProvider: EMBEDDING_MODEL.provider,
    embeddingModel: EMBEDDING_MODEL.model,
    modelSettingsMode: 'advanced',
    studyAiFallbackModels: {},
    studyAiSubjectModels: {},
    syncMode: 'manual',
    autoLightScan: false,
    autoDeepScanOnReadTag: false,
    autoSummaryAfterDeep: false,
    autoBridgeAfterQueue: false,
    autoResumeQueue: false,
    documentIndexingEnabled: false,
    documentIndexIncludeArchived: false,
    documentIndexConcurrency: 1,
    announcementsEnabled: false,
    betaUpdates: false,
    autoBackupEnabled: false,
    autoBackupFolder: '',
    backupCleanupEnabled: false,
    libraryGlobalEnabled: false,
    mcpEnabled: false,
    mcpToken: '',
    nodusServerEnabled: false,
    nodusServerAutoSync: false,
    localServerEnabled: false,
    copilotEnabled: false,
    zoteroPluginEnabled: false,
    browserConnectorEnabled: false,
    mascotEnabled: false,
    demoMode: false,
    unpaywallEmail: '',
    promptLanguage: 'es',
    uiLanguage: 'es',
    onboardingComplete: true,
    tourComplete: true,
    advancedTourComplete: true,
    basicsTutorialVersion: 99,
    recoverySetupVersion: 99,
  };
}

function createIsolatedProfile(profilePath, activeVault, options = {}) {
  fs.mkdirSync(profilePath, { recursive: true });
  const targetDb = path.join(profilePath, 'nodus.sqlite');
  copyClone(snapshotPath, targetDb);

  const db = new Database(targetDb);
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='app'").get();
    assert.ok(row?.value, 'La copia no contiene settings/app.');
    const current = JSON.parse(row.value);
    db.prepare("UPDATE settings SET value=? WHERE key='app'").run(JSON.stringify(isolatedSettingsPatch(current)));
    if (options.onlyWorkIds?.length) {
      const placeholders = options.onlyWorkIds.map(() => '?').join(',');
      db.prepare(`UPDATE works SET archived=CASE WHEN nodus_id IN (${placeholders}) THEN 0 ELSE 1 END`)
        .run(...options.onlyWorkIds);
    }
  } finally {
    db.close();
  }

  const registry = {
    formatVersion: 1,
    activeVaultId: activeVault.id,
    vaults: [{
      id: activeVault.id,
      name: `${activeVault.name} · auditoría aislada`,
      path: targetDb,
      createdAt: activeVault.createdAt ?? startedAt,
      lastOpenedAt: startedAt,
      legacy: true,
      type: 'academic',
      origin: 'local',
    }],
  };
  fs.writeFileSync(path.join(profilePath, 'vaults.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  const secretsDir = path.join(profilePath, 'secrets');
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  for (const provider of ['gemini', 'openrouter']) {
    const source = path.join(SOURCE_USERDATA, `secrets/ai_key_${provider}.bin`);
    assert.ok(fs.existsSync(source), `Falta la clave cifrada de ${provider} en el perfil fuente.`);
    fs.copyFileSync(source, path.join(secretsDir, path.basename(source)));
    try { fs.chmodSync(path.join(secretsDir, path.basename(source)), 0o600); } catch { /* best effort */ }
  }

  const writtenRegistry = JSON.parse(fs.readFileSync(path.join(profilePath, 'vaults.json'), 'utf8'));
  assert.ok(writtenRegistry.vaults.every((vault) => isWithin(vault.path, profilePath)), 'Una ruta de vault escapó del perfil aislado.');
  assert.equal(fs.existsSync(path.join(profilePath, 'codex-subscription')), false, 'La copia no debe contener acceso Codex.');
  return targetDb;
}

async function launchProfile(profilePath) {
  const env = {
    ...process.env,
    NODUS_USERDATA: profilePath,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require(path.join(repoRoot, 'node_modules/electron')),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 10 * 60_000,
  });
  liveApps.add(app);
  app.once('close', () => liveApps.delete(app));
  const page = await app.firstWindow({ timeout: 10 * 60_000 });
  page.setDefaultTimeout(30 * 60_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const actualUserData = profilePath;
  const vaults = await page.evaluate(() => window.nodus.listVaults());
  assert.ok(vaults.length === 1 && vaults.every((vault) => vault.origin === 'local'), 'El perfil aislado debe exponer un único vault local.');
  assert.ok(vaults.every((vault) => vault.path && !vault.remote), 'La copia no debe conservar remotos.');
  assert.ok(vaults.every((vault) => {
    const normalized = String(vault.path).replaceAll('\\', '/');
    return normalized.startsWith(String(actualUserData).replaceAll('\\', '/'));
  }), 'El renderer ve una ruta de vault fuera de la copia.');

  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, require(path.join(repoRoot, 'package.json')).version);

  const settings = await page.evaluate(async ({ model, embedding, keys }) => {
    const models = Object.fromEntries(keys.map((key) => [key, model]));
    return window.nodus.updateSettings({
      ...models,
      embeddingProvider: embedding.provider,
      embeddingModel: embedding.model,
      modelSettingsMode: 'advanced',
      studyAiFallbackModels: {},
      studyAiSubjectModels: {},
      syncMode: 'manual',
      autoLightScan: false,
      autoDeepScanOnReadTag: false,
      autoSummaryAfterDeep: false,
      autoBridgeAfterQueue: false,
      autoResumeQueue: false,
      documentIndexingEnabled: false,
      documentIndexIncludeArchived: false,
      documentIndexConcurrency: 1,
      announcementsEnabled: false,
      autoBackupEnabled: false,
      autoBackupFolder: '',
      libraryGlobalEnabled: false,
      nodusServerEnabled: false,
      nodusServerAutoSync: false,
      localServerEnabled: false,
      copilotEnabled: false,
      zoteroPluginEnabled: false,
      browserConnectorEnabled: false,
      mascotEnabled: false,
      demoMode: false,
      unpaywallEmail: '',
      promptLanguage: 'es',
      uiLanguage: 'es',
    });
  }, { model: TEXT_MODEL, embedding: EMBEDDING_MODEL, keys: MODEL_SETTING_KEYS });

  assert.equal(settings.providerKeys.gemini, true, 'La copia no pudo descifrar la clave de Gemini.');
  assert.equal(settings.providerKeys.openrouter, true, 'La copia no pudo descifrar la clave de OpenRouter.');
  for (const key of MODEL_SETTING_KEYS) {
    assert.deepEqual(settings[key], TEXT_MODEL, `${key} no quedó fijado al único modelo de texto permitido.`);
  }
  assert.equal(settings.embeddingProvider, EMBEDDING_MODEL.provider);
  assert.equal(settings.embeddingModel, EMBEDDING_MODEL.model);
  return { app, page, settings, actualUserData, vaults };
}

function citationRefs(text) {
  const refs = [];
  const seen = new Set();
  for (const match of String(text).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
    const ref = { kind: match[1], id: decodeURIComponent(match[2]) };
    const key = `${ref.kind}:${ref.id}`;
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  }
  return refs;
}

async function runSurfaceProbe(page, label) {
  log(`${label}: búsqueda, Asistente, Nodi, Writing Workshop e Immersion scope`);
  return page.evaluate(async ({ question, topic, model, candidateFragments }) => {
    const selection = {
      ideas: true,
      themes: true,
      contradictions: false,
      gaps: false,
      readingPath: false,
      authors: true,
      documents: true,
      passages: true,
      graph: true,
      graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: false },
    };
    const extractRefs = (text) => {
      const refs = [];
      const seen = new Set();
      for (const match of String(text).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
        const ref = { kind: match[1], id: decodeURIComponent(match[2]) };
        const key = `${ref.kind}:${ref.id}`;
        if (!seen.has(key)) { seen.add(key); refs.push(ref); }
      }
      return refs;
    };
    const verify = async (text) => {
      const refs = extractRefs(text);
      const values = refs.length ? await window.nodus.verifyCitations(refs) : {};
      return {
        total: refs.length,
        valid: refs.filter((ref) => values[`${ref.kind}:${ref.id}`] === true).length,
        invalid: refs.filter((ref) => values[`${ref.kind}:${ref.id}`] !== true),
        kinds: [...new Set(refs.map((ref) => ref.kind))],
      };
    };

    const semantic = await window.nodus.semanticSearch(question, {
      kinds: ['work', 'passage', 'idea'], limit: 24, minSimilarity: 0.15,
    });
    let assistantStream = '';
    const assistant = await window.nodus.researchChatStream(
      { messages: [{ role: 'user', content: question }], selection, model },
      { onDelta: (delta) => { assistantStream += delta; } },
    );
    let nodiStream = '';
    const nodiAnswer = await window.nodus.nodiChatStream(
      { messages: [{ role: 'user', content: question }], contexts: ['vault'], model },
      { onDelta: (delta) => { nodiStream += delta; } },
    );
    const nodi = String(nodiAnswer || nodiStream);
    const snapshot = await window.nodus.getWritingWorkshopSnapshot({
      kind: 'literature_review', objective: question, audience: 'investigación académica', tone: 'critical', language: 'es',
    });
    const scope = await window.nodus.buildImmersionScope({ topic, minutes: 90 });
    const targetRank = (items, idOf, titleOf) => candidateFragments.map((fragment) => {
      const index = items.findIndex((item) => String(titleOf(item)).includes(fragment));
      return { fragment, rank: index < 0 ? null : index + 1, id: index < 0 ? null : idOf(items[index]) };
    });
    return {
      semantic: {
        available: semantic.available,
        count: semantic.results.length,
        works: semantic.results.filter((item) => item.kind === 'work').map((item) => ({ id: item.id, title: item.title, similarity: item.similarity, snippet: item.snippet })),
        passages: semantic.results.filter((item) => item.kind === 'passage').length,
        ideas: semantic.results.filter((item) => item.kind === 'idea').length,
        targetRanks: targetRank(semantic.results.filter((item) => item.kind === 'work'), (item) => item.id, (item) => item.title),
      },
      assistant: {
        answer: assistant.answer,
        streamedChars: assistantStream.length,
        stats: assistant.stats,
        citations: await verify(assistant.answer),
      },
      nodi: {
        answer: nodi,
        streamedChars: nodiStream.length,
        citations: await verify(nodi),
      },
      writing: {
        stats: snapshot.stats,
        recommended: snapshot.recommendedSelection,
        works: snapshot.works.slice(0, 30).map((work) => ({
          id: work.id, title: work.title, score: work.score,
          documentStatus: work.documentStatus ?? null,
          hasDocumentOverview: Boolean(work.documentOverview),
          reason: work.reason,
        })),
        targetRanks: targetRank(snapshot.works, (item) => item.id, (item) => item.title),
      },
      immersionScope: {
        embeddingAvailable: scope.embeddingAvailable,
        aiKeyAvailable: scope.aiKeyAvailable,
        ideas: scope.ideas.length,
        works: scope.works.map((work) => ({ id: work.nodusId, title: work.title, score: work.score })),
        passages: scope.passageCount,
        warnings: scope.warnings,
        targetRanks: targetRank(scope.works, (item) => item.nodusId, (item) => item.title),
      },
    };
  }, { question: QUESTION, topic: TOPIC, model: TEXT_MODEL, candidateFragments: CANDIDATE_TITLE_FRAGMENTS });
}

async function waitFor(page, description, predicate, timeoutMs = 30 * 60_000, intervalMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last?.done) return last.value;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout esperando ${description}. Último estado: ${JSON.stringify(last)}`);
}

async function runDocumentCampaign(page, candidateIds) {
  const campaign = await page.evaluate((nodusIds) => window.nodus.startDocumentIndexCampaign({ nodusIds }), candidateIds);
  log(`campaña ${campaign.campaignId}: ${candidateIds.length} obras en cola`);
  let lastLine = '';
  let paused = false;
  let pauseTested = false;
  let pauseSnapshot = null;
  const terminal = new Set(['completed', 'failed', 'unavailable', 'cancelled']);

  const final = await waitFor(page, 'la campaña documental', async () => {
    const progress = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    const jobs = progress.jobs.filter((job) => job.campaignId === campaign.campaignId);
    const running = jobs.find((job) => job.status === 'running');
    const line = running
      ? `${running.title ?? running.nodusId}: ${running.phase} ${Math.round(running.progress * 100)}%`
      : jobs.map((job) => `${job.status}:${job.phase}`).join(', ');
    if (line !== lastLine) { log(`campaña: ${line}`); lastLine = line; }

    if (!pauseTested && !paused && running && ['analyzing_sections', 'synthesizing', 'auditing', 'repairing'].includes(running.phase)) {
      await page.evaluate(({ vaultId, campaignId }) => window.nodus.setDocumentIndexCampaignStatus(vaultId, campaignId, 'paused'), campaign);
      paused = true;
      pauseTested = true;
      pauseSnapshot = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
      log('campaña pausada con un trabajo activo; los restantes quedaron retenidos');
    }

    if (paused && !jobs.some((job) => job.status === 'running') && jobs.some((job) => job.status === 'paused')) {
      await sleep(1_000);
      const stable = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
      const stableJobs = stable.jobs.filter((job) => job.campaignId === campaign.campaignId);
      assert.equal(stableJobs.some((job) => job.status === 'running'), false, 'La campaña pausada inició otro trabajo.');
      await page.evaluate(({ vaultId, campaignId }) => window.nodus.setDocumentIndexCampaignStatus(vaultId, campaignId, 'running'), campaign);
      paused = false;
      log('campaña reanudada tras verificar que la pausa era efectiva');
    }

    return jobs.length === candidateIds.length && jobs.every((job) => terminal.has(job.status))
      ? { done: true, value: { campaign, jobs, pauseSnapshot } }
      : { done: false, value: null };
  }, 45 * 60_000, 1_500);

  return final;
}

async function profileAudit(page, candidateIds) {
  return page.evaluate(async (ids) => {
    const profiles = await Promise.all(ids.map((id) => window.nodus.getDocumentProfile(id)));
    const summarized = profiles.map((profile) => ({
      nodusId: profile?.nodusId ?? null,
      versionId: profile?.versionId ?? null,
      status: profile?.status ?? null,
      overviewChars: profile?.overview.length ?? 0,
      fields: profile?.fields.length ?? 0,
      centralFields: profile?.fields.filter((field) => ['problem', 'question', 'thesis', 'method', 'conclusion', 'contribution'].includes(field.kind)).length ?? 0,
      sections: profile?.sections.length ?? 0,
      supports: profile?.supports.length ?? 0,
      validSupports: profile?.supports.filter((support) => support.validationStatus === 'valid').length ?? 0,
      linkedSupports: profile?.supports.filter((support) => Boolean(support.passageId)).length ?? 0,
      ideaLinks: profile?.ideaLinks.length ?? 0,
      audit: profile?.audit ?? null,
      qualityScore: profile?.qualityScore ?? null,
      generatorModel: profile?.generatorModel ?? null,
      auditorModel: profile?.auditorModel ?? null,
      pipelineVersion: profile?.pipelineVersion ?? null,
    }));

    const target = profiles.find((profile) => profile?.fields.length);
    let override = null;
    if (target) {
      const field = target.fields.find((item) => item.kind === 'thesis') ?? target.fields[0];
      const value = `${field.text} [AUDITORÍA AISLADA]`;
      const saved = await window.nodus.saveDocumentProfileOverride({
        nodusId: target.nodusId,
        fieldPath: `fields.${field.kind}.${field.ordinal}`,
        value,
        generatedValue: field.text,
        baseVersionId: target.versionId,
        verified: true,
      });
      const edited = await window.nodus.getDocumentProfile(target.nodusId);
      const editedField = edited.fields.find((item) => item.kind === field.kind && item.ordinal === field.ordinal);
      await window.nodus.deleteDocumentProfileOverride(saved.overrideId);
      const restored = await window.nodus.getDocumentProfile(target.nodusId);
      const restoredField = restored.fields.find((item) => item.kind === field.kind && item.ordinal === field.ordinal);
      override = {
        saved: editedField?.text === value && editedField?.overridden === true && editedField?.verified === true,
        restored: restoredField?.text === field.text && !restoredField?.overridden,
        fieldPath: `fields.${field.kind}.${field.ordinal}`,
      };
    }
    return { profiles: summarized, override };
  }, candidateIds);
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function auditMcp(page, candidateId) {
  const port = await findFreePort();
  const token = await page.evaluate(async (mcpPort) => {
    const generated = await window.nodus.regenerateMcpToken();
    await window.nodus.updateSettings({ mcpEnabled: true, mcpPort });
    return generated;
  }, port);
  assert.ok(token, 'MCP no generó token en la copia.');
  await waitFor(page, 'MCP escuchando', async () => {
    const status = await page.evaluate(() => window.nodus.getMcpStatus());
    return status.running ? { done: true, value: status } : { done: false };
  }, 30_000, 300);

  const { Client } = await import(path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
  const { StreamableHTTPClientTransport } = await import(
    path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')
  );
  mcpClient = new Client({ name: 'nodus-document-live-audit', version: '1.0.0' });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  const tools = await mcpClient.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const expected of ['nodus_get_document_profile', 'nodus_search_documents', 'nodus_search_hybrid']) {
    assert.equal(names.has(expected), true, `MCP no expone ${expected}.`);
  }
  const call = async (name, args) => {
    const result = await mcpClient.callTool({ name, arguments: args });
    const text = result.content?.find((item) => item.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  };
  const profile = await call('nodus_get_document_profile', { workId: candidateId });
  const documents = await call('nodus_search_documents', { query: QUESTION, limit: 12 });
  const hybrid = await call('nodus_search_hybrid', { query: QUESTION, limit: 12 });
  assert.equal(profile.citationPolicy, 'orientation_only');
  assert.ok(documents.documents?.length > 0, 'MCP document search returned no audited documents.');
  assert.ok(hybrid.documents?.length > 0, 'MCP hybrid search returned no document lane.');
  const result = {
    toolCount: tools.tools.length,
    requiredToolsPresent: true,
    profile: {
      status: profile.profile?.status,
      fields: profile.profile?.fields?.length ?? 0,
      citationPolicy: profile.citationPolicy,
    },
    documentHits: documents.documents.length,
    hybrid: {
      documents: hybrid.documents?.length ?? 0,
      ideas: hybrid.ideas?.length ?? 0,
      passages: hybrid.passages?.length ?? 0,
    },
  };
  await mcpClient.close();
  mcpClient = null;
  await page.evaluate(() => window.nodus.updateSettings({ mcpEnabled: false }));
  return result;
}

async function startDeepResearch(page) {
  await page.evaluate(({ objective, model }) => {
    window.__documentAuditDeep = { done: false, error: null, progress: [], report: null };
    window.nodus.generateDeepResearchReport({
      objective,
      approach: 'general',
      language: 'es',
      audience: 'investigación académica',
      sectionLimit: 3,
      model,
      decorativeImage: { enabled: false, style: 'antique_book' },
    }, {
      onProgress: (progress) => window.__documentAuditDeep.progress.push(progress),
    }).then((value) => {
      window.__documentAuditDeep.report = value;
      window.__documentAuditDeep.done = true;
    }).catch((error) => {
      window.__documentAuditDeep.error = error instanceof Error ? error.message : String(error);
      window.__documentAuditDeep.done = true;
    });
  }, { objective: QUESTION, model: TEXT_MODEL });

  let last = '';
  const result = await waitFor(page, 'Deep Research', async () => {
    const state = await page.evaluate(async () => {
      const jobs = await window.nodus.listDeepResearchJobs();
      const local = window.__documentAuditDeep;
      return {
        done: local.done,
        error: local.error,
        latest: local.progress.at(-1) ?? null,
        phases: [...new Set(local.progress.map((item) => item.phase))],
        jobs: jobs.map((job) => ({ status: job.status, progress: job.progress })),
        documentJobs: (await window.nodus.getDocumentIndexProgress()).jobs.map((job) => ({
          title: job.title, status: job.status, phase: job.phase, error: job.error ?? null,
        })),
      };
    });
    const line = state.latest ? `${state.latest.phase}: ${state.latest.message}` : state.jobs.map((job) => job.status).join(',');
    if (line && line !== last) { log(`Deep Research · ${line}`); last = line; }
    if (!state.done) return { done: false };
    if (state.error) throw new Error(`Deep Research: ${state.error} · ${state.documentJobs.map((job) => `${job.title}:${job.status}:${job.error ?? ''}`).join(' | ')}`);
    const value = await page.evaluate(async () => {
      const state = window.__documentAuditDeep;
      const report = state.report;
      const refs = [];
      const seen = new Set();
      for (const match of String(report.draft.draftMarkdown).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
        const ref = { kind: match[1], id: decodeURIComponent(match[2]) };
        const key = `${ref.kind}:${ref.id}`;
        if (!seen.has(key)) { seen.add(key); refs.push(ref); }
      }
      const verified = refs.length ? await window.nodus.verifyCitations(refs) : {};
      return {
        phases: [...new Set(state.progress.map((item) => item.phase))],
        progress: state.progress,
        report: {
          title: report.draft.title,
          abstract: report.draft.abstract,
          markdown: report.draft.draftMarkdown,
          bibliography: report.draft.bibliography,
          limitations: report.draft.limitations,
          supportAudit: report.draft.supportAudit ?? [],
          stats: report.draft.stats,
          meta: report.meta,
          generationModel: report.draft.generationModel,
          citations: {
            total: refs.length,
            valid: refs.filter((ref) => verified[`${ref.kind}:${ref.id}`] === true).length,
            invalid: refs.filter((ref) => verified[`${ref.kind}:${ref.id}`] !== true),
            kinds: [...new Set(refs.map((ref) => ref.kind))],
          },
        },
      };
    });
    return { done: true, value };
  }, 60 * 60_000, 2_000);
  return result;
}

async function startImmersion(page) {
  await page.evaluate(({ topic, model }) => {
    window.__documentAuditImmersion = { done: false, error: null, progress: [], session: null };
    window.nodus.generateImmersionSession({
      topic,
      language: 'es',
      minutes: 90,
      includeQuiz: true,
      model,
      decorativeImage: { enabled: false, style: 'antique_book' },
    }, {
      onProgress: (progress) => window.__documentAuditImmersion.progress.push(progress),
    }).then((value) => {
      window.__documentAuditImmersion.session = value;
      window.__documentAuditImmersion.done = true;
    }).catch((error) => {
      window.__documentAuditImmersion.error = error instanceof Error ? error.message : String(error);
      window.__documentAuditImmersion.done = true;
    });
  }, { topic: TOPIC, model: TEXT_MODEL });

  let last = '';
  return waitFor(page, 'Immersion', async () => {
    const state = await page.evaluate(() => ({
      done: window.__documentAuditImmersion.done,
      error: window.__documentAuditImmersion.error,
      latest: window.__documentAuditImmersion.progress.at(-1) ?? null,
    }));
    const line = state.latest ? `${state.latest.phase}: ${state.latest.message}` : '';
    if (line && line !== last) { log(`Immersion · ${line}`); last = line; }
    if (!state.done) return { done: false };
    if (state.error) throw new Error(`Immersion: ${state.error}`);
    const value = await page.evaluate(() => {
      const state = window.__documentAuditImmersion;
      const session = state.session;
      const citations = session.plan.stations.flatMap((station) => station.citations ?? []);
      const passageIds = new Set(citations.map((citation) => citation.passageId));
      return {
        phases: [...new Set(state.progress.map((item) => item.phase))],
        progress: state.progress,
        session: {
          id: session.id,
          title: session.plan.title,
          model: session.model,
          stoppedReason: session.plan.stoppedReason,
          stats: session.plan.stats,
          stations: session.plan.stations.length,
          citations: citations.length,
          uniquePassages: passageIds.size,
          citedWorks: [...new Set(citations.map((citation) => citation.workId))].length,
          examQuestions: session.plan.exam.questions.length,
          stationSummaries: session.plan.stations.map((station) => ({
            title: station.title,
            ideaIds: station.ideaIds?.length ?? 0,
            citations: station.citations?.length ?? 0,
            quiz: station.quiz?.length ?? 0,
          })),
        },
      };
    });
    return { done: true, value };
  }, 60 * 60_000, 2_000);
}

function rankMean(ranks) {
  const values = ranks.map((item) => item.rank).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarizeComparison(before, after) {
  const lexicalCoverage = (answer) => [
    /iniciativ|privad/iu,
    /construcci[oó]n nacional|naci[oó]n/iu,
    /propaganda/iu,
    /guerra civil/iu,
    /central|eje|principal|incidental|menci[oó]n/iu,
  ].filter((pattern) => pattern.test(answer)).length;
  return {
    semanticMeanTargetRank: { before: rankMean(before.semantic.targetRanks), after: rankMean(after.semantic.targetRanks) },
    writingMeanTargetRank: { before: rankMean(before.writing.targetRanks), after: rankMean(after.writing.targetRanks) },
    immersionMeanTargetRank: { before: rankMean(before.immersionScope.targetRanks), after: rankMean(after.immersionScope.targetRanks) },
    assistant: {
      documents: { before: before.assistant.stats.documents, after: after.assistant.stats.documents },
      passages: { before: before.assistant.stats.passages, after: after.assistant.stats.passages },
      contextChars: { before: before.assistant.stats.contextChars, after: after.assistant.stats.contextChars },
      citations: { before: before.assistant.citations, after: after.assistant.citations },
      requestedConceptCoverage: { before: lexicalCoverage(before.assistant.answer), after: lexicalCoverage(after.assistant.answer) },
    },
    nodi: {
      citations: { before: before.nodi.citations, after: after.nodi.citations },
      requestedConceptCoverage: { before: lexicalCoverage(before.nodi.answer), after: lexicalCoverage(after.nodi.answer) },
    },
    writingProfilesVisible: {
      before: before.writing.works.filter((work) => work.hasDocumentOverview).length,
      after: after.writing.works.filter((work) => work.hasDocumentOverview).length,
    },
  };
}

function verifyDatabase(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const models = table('document_profile_versions')
      ? db.prepare('SELECT DISTINCT generator_model_json generator,auditor_model_json auditor FROM document_profile_versions').all()
      : [];
    const vectors = table('document_vectors')
      ? db.prepare('SELECT DISTINCT embedding_provider provider,embedding_model model,embedding_dim dim FROM document_vectors').all()
      : [];
    const jobs = table('document_index_jobs')
      ? db.prepare('SELECT status,COUNT(*) count FROM document_index_jobs GROUP BY status ORDER BY status').all()
      : [];
    const profiles = table('document_profile_versions')
      ? db.prepare('SELECT COUNT(*) count FROM document_profile_versions').get().count
      : 0;
    return { models, vectors, jobs, profiles, integrity: db.pragma('integrity_check', { simple: true }) };
  } finally {
    db.close();
  }
}

function recordAssertion(name, ok, detail = null) {
  report.assertions.push({ name, ok: Boolean(ok), detail });
  assert.equal(Boolean(ok), true, `${name}${detail ? `: ${detail}` : ''}`);
}

try {
  log(`perfil fuente (solo lectura): ${SOURCE_USERDATA}`);
  const { registryPath, active } = readRegistry();
  const stateBefore = sourceState(registryPath, active.path);
  report.source = {
    userData: SOURCE_USERDATA,
    registryPath,
    activeVaultId: active.id,
    activeVaultType: active.type ?? 'academic',
    activeDatabase: active.path,
    before: stateBefore,
  };

  log('creando snapshot SQLite consistente mediante backup online de solo lectura');
  await onlineBackup(active.path, snapshotPath);
  const snapshotDb = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let candidates;
  try {
    const corpus = {
      works: snapshotDb.prepare('SELECT COUNT(*) count FROM works').get().count,
      passages: snapshotDb.prepare('SELECT COUNT(*) count FROM passages').get().count,
      ideas: snapshotDb.prepare('SELECT COUNT(*) count FROM ideas').get().count,
      activeWorks: snapshotDb.prepare('SELECT COUNT(*) count FROM works WHERE archived=0').get().count,
    };
    report.corpus = corpus;
    const rows = snapshotDb.prepare(
      `SELECT nodus_id,title,year,source_type,deep_status FROM works
        WHERE archived=0 AND source_type IN ('pdf','epub','markdown') AND deep_status='done'`
    ).all();
    candidates = CANDIDATE_TITLE_FRAGMENTS.map((fragment) => rows.find((row) => row.title.includes(fragment))).filter(Boolean);
    assert.equal(candidates.length, CANDIDATE_TITLE_FRAGMENTS.length, 'No se encontraron las cuatro obras auditables previstas.');
    assert.equal(new Set(candidates.map((row) => row.nodus_id)).size, candidates.length, 'La selección de obras contiene duplicados.');
  } finally {
    snapshotDb.close();
  }
  report.candidates = candidates;
  const candidateIds = candidates.map((row) => row.nodus_id);

  createIsolatedProfile(pairedProfile, active);
  createIsolatedProfile(workflowProfile, active, { onlyWorkIds: candidateIds });
  report.isolation = {
    auditRoot,
    pairedProfile,
    workflowProfile,
    copiedSecrets: ['gemini', 'openrouter'],
    copiedSubscriptionProfiles: [],
    sourceOpenedForWrites: false,
    registryPathsContained: true,
  };

  log('abriendo escenario pareado sobre la copia completa');
  const paired = await launchProfile(pairedProfile);
  pairedApp = paired.app;
  report.paired.settings = {
    textModels: Object.fromEntries(MODEL_SETTING_KEYS.map((key) => [key, paired.settings[key]])),
    embeddingProvider: paired.settings.embeddingProvider,
    embeddingModel: paired.settings.embeddingModel,
    providerKeys: { gemini: paired.settings.providerKeys.gemini, openrouter: paired.settings.providerKeys.openrouter },
  };
  report.paired.before = await runSurfaceProbe(paired.page, 'control sin fichas nuevas');
  report.paired.campaign = await runDocumentCampaign(paired.page, candidateIds);
  assert.equal(report.paired.campaign.jobs.every((job) => job.status === 'completed'), true,
    `La campaña terminó con fallos: ${report.paired.campaign.jobs.map((job) => `${job.title}:${job.status}:${job.error ?? ''}`).join(' | ')}`);
  report.paired.profileAudit = await profileAudit(paired.page, candidateIds);
  report.paired.after = await runSurfaceProbe(paired.page, 'tratamiento con fichas auditadas');
  report.paired.comparison = summarizeComparison(report.paired.before, report.paired.after);
  report.paired.mcp = await auditMcp(paired.page, candidateIds[0]);
  await paired.app.close();
  pairedApp = null;

  log('abriendo escenario acotado para Deep Research e Immersion bajo demanda');
  const workflow = await launchProfile(workflowProfile);
  workflowApp = workflow.app;
  report.workflow.deepResearch = await startDeepResearch(workflow.page);
  report.workflow.profilesAfterDeepResearch = await profileAudit(workflow.page, candidateIds);
  report.workflow.immersion = await startImmersion(workflow.page);
  report.workflow.queue = await workflow.page.evaluate(() => window.nodus.getDocumentIndexProgress());
  await workflow.app.close();
  workflowApp = null;

  report.databaseVerification.paired = verifyDatabase(path.join(pairedProfile, 'nodus.sqlite'));
  report.databaseVerification.workflow = verifyDatabase(path.join(workflowProfile, 'nodus.sqlite'));

  recordAssertion('Aislamiento de userData', report.isolation.registryPathsContained);
  recordAssertion('Solo claves permitidas copiadas', report.isolation.copiedSecrets.join(',') === 'gemini,openrouter');
  recordAssertion('Campaña pausó y reanudó', Boolean(report.paired.campaign.pauseSnapshot));
  recordAssertion('Cuatro perfiles publicados', report.paired.profileAudit.profiles.length === 4
    && report.paired.profileAudit.profiles.every((profile) => profile.status === 'current'));
  recordAssertion('Auditoría semántica aprobada', report.paired.profileAudit.profiles.every((profile) => profile.audit?.passed
    && profile.audit.supportCoverage >= 0.95 && profile.audit.structureCoverage >= 0.95));
  recordAssertion('Generador permitido', report.paired.profileAudit.profiles.every((profile) => JSON.stringify(profile.generatorModel) === JSON.stringify(TEXT_MODEL)));
  recordAssertion('Auditor permitido', report.paired.profileAudit.profiles.every((profile) => JSON.stringify(profile.auditorModel) === JSON.stringify(TEXT_MODEL)));
  recordAssertion('Corrección de ficha reversible', report.paired.profileAudit.override?.saved && report.paired.profileAudit.override?.restored);
  recordAssertion('Writing Workshop ve fichas', report.paired.comparison.writingProfilesVisible.after > report.paired.comparison.writingProfilesVisible.before);
  recordAssertion('Asistente incorpora documentos', report.paired.after.assistant.stats.documents > 0);
  recordAssertion('Citas del Asistente resolubles', report.paired.after.assistant.citations.total > 0
    && report.paired.after.assistant.citations.invalid.length === 0);
  recordAssertion('Citas de Nodi resolubles', report.paired.after.nodi.citations.total > 0
    && report.paired.after.nodi.citations.invalid.length === 0);
  recordAssertion('MCP declara orientación no citable', report.paired.mcp.profile.citationPolicy === 'orientation_only');
  recordAssertion('Deep Research ejecutó preparación documental', report.workflow.deepResearch.phases.includes('document_preparation'));
  recordAssertion('Deep Research terminó con citas válidas', report.workflow.deepResearch.report.citations.total > 0
    && report.workflow.deepResearch.report.citations.invalid.length === 0);
  recordAssertion('Deep Research usó Gemini permitido', JSON.stringify(report.workflow.deepResearch.report.generationModel) === JSON.stringify(TEXT_MODEL));
  recordAssertion('Immersion ejecutó preparación documental', report.workflow.immersion.phases.includes('document_preparation'));
  recordAssertion('Immersion terminó sin degradación', !report.workflow.immersion.session.stoppedReason);
  recordAssertion('Immersion conserva citas literales', report.workflow.immersion.session.citations > 0
    && report.workflow.immersion.session.uniquePassages > 0);
  recordAssertion('Vectores documentales usan BGE-M3', [report.databaseVerification.paired, report.databaseVerification.workflow]
    .every((db) => db.vectors.length > 0 && db.vectors.every((row) => row.provider === EMBEDDING_MODEL.provider && row.model === EMBEDDING_MODEL.model)));
  recordAssertion('Integridad SQLite de copias', report.databaseVerification.paired.integrity === 'ok'
    && report.databaseVerification.workflow.integrity === 'ok');

  const stateAfter = sourceState(registryPath, active.path);
  report.source.after = stateAfter;
  report.source.smallFileHashesUnchanged = ['registry', 'geminiKey', 'openrouterKey']
    .every((key) => stateBefore[key]?.sha256 === stateAfter[key]?.sha256);
  recordAssertion('Registro y claves del perfil real intactos', report.source.smallFileHashesUnchanged);
  report.completedAt = new Date().toISOString();
  report.ok = true;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(`AUDITORÍA COMPLETA · informe ${REPORT_PATH}`);
} catch (error) {
  report.ok = false;
  report.completedAt = new Date().toISOString();
  report.errors.push(error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  try { if (mcpClient) await mcpClient.close(); } catch { /* best effort */ }
  try { if (pairedApp) await pairedApp.close(); } catch { /* best effort */ }
  try { if (workflowApp) await workflowApp.close(); } catch { /* best effort */ }
  for (const app of [...liveApps]) {
    try { await app.close(); } catch { /* best effort */ }
  }
  if (!KEEP_CLONES) {
    await sleep(500);
    try {
      fs.rmSync(auditRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      log(`copias temporales eliminadas: ${auditRoot}`);
    } catch (cleanupError) {
      log(`aviso: la limpieza temporal queda pendiente (${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)})`);
    }
  } else {
    log(`copias temporales conservadas por NODUS_AUDIT_KEEP_CLONES=1: ${auditRoot}`);
  }
}
