/**
 * Paired quality audit for whole-document understanding.
 *
 * The real Nodus profile is opened once, read-only, to create a consistent SQLite
 * snapshot and to inventory existing Deep Research reports. Every migration,
 * profile, model call and generated artefact lives in a temporary NODUS_USERDATA.
 *
 * Text generation: Google Gemini / gemini-3.1-flash-lite
 * Embeddings:      OpenRouter / baai/bge-m3
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  process.env.NODUS_QUALITY_AUDIT_REPORT
    ?? path.join(repoRoot, 'reports/document-understanding-quality-audit.json'),
);
const KEEP_CLONE = process.env.NODUS_QUALITY_KEEP_CLONE === '1';
const CHAT_TRIALS = Math.max(1, Number(process.env.NODUS_QUALITY_CHAT_TRIALS ?? 2));
const RUN_GENERATIVE = process.env.NODUS_QUALITY_SKIP_GENERATIVE !== '1';
const DOCUMENT_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.NODUS_QUALITY_CONCURRENCY ?? 4)));
const RESUME_ROOT = process.env.NODUS_QUALITY_RESUME_ROOT
  ? path.resolve(process.env.NODUS_QUALITY_RESUME_ROOT)
  : null;
const HARD_NEGATIVES_PER_SURFACE = 8;
const MAX_CAMPAIGN_WORKS = 72;
const QUALITY_THRESHOLDS = Object.freeze({
  absoluteNdcgGain: 0.08,
  relativeNdcgGain: 0.20,
  maximumSurfaceRegression: 0.05,
  validCitationRate: 1,
});

const MODEL_SETTING_KEYS = [
  'chatModel', 'nodiModel', 'extractionModel', 'visionModel',
  'summaryModel', 'synthesisModel', 'documentProfileModel', 'documentAuditModel',
  'fusionModel', 'studyModel', 'tutorModel', 'improveModel', 'questionGenModel',
  'gradingModel', 'flashcardModel', 'writingModel', 'immersionModel',
  'deepResearchModel', 'argumentMapModel', 'authorModel', 'hypothesisModel',
];

const BENCHMARKS = [
  {
    reportId: 'ab1512f8-14f6-40df-904a-0c1916a6a0bc',
    slug: 'visual-modernity',
    facets: [
      'rascacielos|autom[oó]viles|neones',
      'pintoresc|tur[ií]stic',
      'yuxtaposici[oó]n|monumento.*modern|antigu.*modern',
      'conservador|texto|escrit',
    ],
  },
  {
    reportId: '1084ade7-8883-417d-acd8-2c9a3549d58d',
    slug: 'rural-coercion',
    facets: [
      'ruralizaci[oó]n|inmovilizaci[oó]n',
      'salvoconduct|permiso.*desplaz|movilidad',
      'Hermandades Sindicales|labradores|ganaderos',
      'aparcer[ií]a|arrendamiento|latifund',
      '[eé]xodo rural|intencionalidad',
    ],
  },
  {
    reportId: 'cfbcca6f-e067-4501-b790-be9a9ad74956',
    slug: 'tourism-apparatus',
    facets: [
      'Direcci[oó]n General de Turismo|DGT|Ministerio de Informaci[oó]n y Turismo|MIT',
      'material fotogr[aá]fico|fototeca|folleto',
      'itinerario|Paradores|gu[ií]a',
      'oficinas? de turismo|promoci[oó]n internacional|campa[nñ]a',
      'propaganda|legitimaci[oó]n',
    ],
  },
];

const startedAt = new Date().toISOString();
const auditRoot = RESUME_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-quality-audit-'));
const snapshotPath = path.join(auditRoot, 'source-snapshot.sqlite');
const profilePath = path.join(auditRoot, 'quality-profile');
const cloneDbPath = path.join(profilePath, 'nodus.sqlite');
const priorReport = RESUME_ROOT && fs.existsSync(REPORT_PATH)
  ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
  : null;
const report = priorReport ?? {
  startedAt,
  ok: false,
  source: {},
  isolation: {},
  models: { text: TEXT_MODEL, embedding: EMBEDDING_MODEL },
  methodology: {
    benchmarkReportIds: BENCHMARKS.map((item) => item.reportId),
    chatTrials: CHAT_TRIALS,
    documentConcurrency: DOCUMENT_CONCURRENCY,
    hardNegativesPerSurface: HARD_NEGATIVES_PER_SURFACE,
    maximumCampaignWorks: MAX_CAMPAIGN_WORKS,
    thresholds: QUALITY_THRESHOLDS,
    goldDefinition: 'Obras y pasajes citados explícitamente por informes Deep Research persistidos; las ideas no expanden el oro para evitar falsos positivos multioobra.',
    candidatePolicy: 'Unión del oro de los tres informes y de los primeros resultados difíciles de Semantic Search, Writing/Deep Research e Immersion antes del tratamiento.',
  },
  corpus: {},
  benchmarks: [],
  baseline: {},
  campaign: {},
  treatment: {},
  comparisons: {},
  generative: {},
  databaseVerification: {},
  assertions: [],
  errors: [],
};
if (priorReport) {
  report.ok = false;
  report.completedAt = null;
  report.errors = [];
  report.assertions = [];
  report.treatment = {};
  report.comparisons = {};
  report.generative = {};
  report.databaseVerification = {};
  report.methodology.resumedFromCompletedProfiles = true;
}

let app = null;

function log(message) {
  process.stdout.write(`[quality-audit] ${message}\n`);
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

function newestSourceState(roots) {
  let newest = null;
  const visit = (entry) => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
      return;
    }
    if (!/\.(?:ts|tsx|mts|mjs|js|json)$/.test(entry)) return;
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { path: entry, mtimeMs: stat.mtimeMs };
  };
  for (const root of roots) visit(root);
  return newest;
}

function assertFreshBuild() {
  const mainArtifact = path.join(repoRoot, 'dist-electron/main.js');
  const preloadArtifact = path.join(repoRoot, 'dist-electron/preload.cjs');
  const rendererArtifact = path.join(repoRoot, 'dist/index.html');
  const artifacts = [mainArtifact, preloadArtifact, rendererArtifact].map((file) => fileState(file, true));
  assert.ok(artifacts.every(Boolean), 'Falta compilar Nodus antes de lanzar la auditoría.');
  const newestSource = newestSourceState([
    path.join(repoRoot, 'electron'),
    path.join(repoRoot, 'shared'),
    path.join(repoRoot, 'src'),
  ]);
  const oldestArtifactMtime = Math.min(...artifacts.map((item) => item.mtimeMs));
  assert.ok(
    !newestSource || oldestArtifactMtime >= newestSource.mtimeMs,
    `El build está obsoleto: ${newestSource?.path ?? 'fuente desconocida'} es posterior a dist/. Ejecuta vite build.`,
  );
  return { newestSource, artifacts };
}

function sourceState(registryPath, databasePath) {
  return {
    registry: fileState(registryPath, true),
    database: fileState(databasePath),
    wal: fileState(`${databasePath}-wal`),
    shm: fileState(`${databasePath}-shm`),
    geminiKey: fileState(path.join(SOURCE_USERDATA, 'secrets/ai_key_gemini.bin'), true),
    openrouterKey: fileState(path.join(SOURCE_USERDATA, 'secrets/ai_key_openrouter.bin'), true),
  };
}

function sameFileState(before, after) {
  if (before === null || after === null) return before === after;
  return ['dev', 'ino', 'size', 'mtimeMs', 'sha256'].every((key) =>
    before[key] === undefined || before[key] === after[key]
  );
}

function readRegistry() {
  const registryPath = path.join(SOURCE_USERDATA, 'vaults.json');
  assert.ok(fs.existsSync(registryPath), `No existe ${registryPath}`);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const active = registry.vaults?.find((vault) => vault.id === registry.activeVaultId);
  assert.ok(active, 'El vault activo no aparece en el registro.');
  assert.equal(active.type ?? 'academic', 'academic');
  assert.ok(fs.existsSync(active.path), `No existe la base activa ${active.path}`);
  return { registryPath, active };
}

async function onlineBackup(sourcePath, targetPath) {
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    await db.backup(targetPath);
  } finally {
    db.close();
  }
}

function copyClone(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isolatedSettings(current) {
  return {
    ...current,
    ...Object.fromEntries(MODEL_SETTING_KEYS.map((key) => [key, TEXT_MODEL])),
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
    documentIndexConcurrency: DOCUMENT_CONCURRENCY,
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

function createProfile(active) {
  fs.mkdirSync(profilePath, { recursive: true });
  copyClone(snapshotPath, cloneDbPath);
  const db = new Database(cloneDbPath);
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='app'").get();
    assert.ok(row?.value, 'La copia no contiene settings/app.');
    db.prepare("UPDATE settings SET value=? WHERE key='app'")
      .run(JSON.stringify(isolatedSettings(JSON.parse(row.value))));
  } finally {
    db.close();
  }

  const registry = {
    formatVersion: 1,
    activeVaultId: active.id,
    vaults: [{
      id: active.id,
      name: `${active.name} · benchmark aislado`,
      path: cloneDbPath,
      createdAt: active.createdAt ?? startedAt,
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
    assert.ok(fs.existsSync(source), `Falta la clave cifrada de ${provider}.`);
    const target = path.join(secretsDir, path.basename(source));
    fs.copyFileSync(source, target);
    try { fs.chmodSync(target, 0o600); } catch { /* best effort */ }
  }
  assert.ok(isWithin(cloneDbPath, profilePath));
  assert.equal(fs.existsSync(path.join(profilePath, 'codex-subscription')), false);
}

function citationRefs(text) {
  const refs = [];
  const seen = new Set();
  for (const match of String(text).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
    let id = match[2];
    try { id = decodeURIComponent(id); } catch { /* retain raw id */ }
    const ref = { kind: match[1], id };
    const key = `${ref.kind}:${ref.id}`;
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  }
  return refs;
}

function countWords(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean).length;
}

function facetCoverage(text, facets) {
  return facets.filter((pattern) => new RegExp(pattern, 'iu').test(String(text))).length;
}

function reportMetrics(db, draft, facets) {
  const markdown = String(draft.draftMarkdown ?? '');
  const refs = citationRefs(markdown);
  const valid = refs.filter((ref) => citationExists(db, ref));
  const verdicts = {};
  for (const item of draft.supportAudit ?? []) {
    const verdict = String(item.verdict ?? 'unknown');
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  }
  return {
    words: countWords(markdown),
    sections: [...markdown.matchAll(/^##\s+/gm)].length,
    facets: { covered: facetCoverage(markdown, facets), total: facets.length },
    citations: {
      total: refs.length,
      valid: valid.length,
      validRate: refs.length ? valid.length / refs.length : 0,
      kinds: Object.fromEntries(['idea', 'work', 'passage', 'gap', 'contradiction'].map((kind) => [kind, refs.filter((ref) => ref.kind === kind).length])),
      perThousandWords: countWords(markdown) ? (refs.length / countWords(markdown)) * 1000 : 0,
    },
    bibliography: draft.bibliography?.length ?? 0,
    supportAudit: { total: draft.supportAudit?.length ?? 0, verdicts },
    limitations: draft.limitations?.length ?? 0,
    refs,
  };
}

function citationExists(db, ref) {
  const table = {
    idea: ['ideas', 'global_id'],
    work: ['works', 'nodus_id'],
    passage: ['passages', 'passage_id'],
    gap: ['gaps', 'id'],
    contradiction: ['edges', 'id'],
  }[ref.kind];
  if (!table) return false;
  return Boolean(db.prepare(`SELECT 1 FROM ${table[0]} WHERE ${table[1]}=?`).get(ref.id));
}

function loadBenchmarks() {
  const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const getReport = db.prepare('SELECT id,title,brief_json,selection_json,model_json,draft_json,created_at,updated_at FROM writing_saved_drafts WHERE id=?');
    const passageWork = db.prepare('SELECT nodus_id FROM passages WHERE passage_id=?');
    const workRow = db.prepare(
      `SELECT w.nodus_id,w.title,w.source_type,w.deep_status,w.archived,
              (SELECT COUNT(*) FROM passages p WHERE p.nodus_id=w.nodus_id) passage_count
         FROM works w WHERE w.nodus_id=?`
    );
    const fixtures = BENCHMARKS.map((config) => {
      const row = getReport.get(config.reportId);
      assert.ok(row, `No existe el informe de referencia ${config.reportId}`);
      const brief = JSON.parse(row.brief_json);
      const selection = JSON.parse(row.selection_json);
      const draft = JSON.parse(row.draft_json);
      const metrics = reportMetrics(db, draft, config.facets);
      const goldPassageIds = metrics.refs.filter((ref) => ref.kind === 'passage' && citationExists(db, ref)).map((ref) => ref.id);
      const explicitWorkIds = metrics.refs.filter((ref) => ref.kind === 'work' && citationExists(db, ref)).map((ref) => ref.id);
      const passageWorkIds = goldPassageIds.map((id) => passageWork.get(id)?.nodus_id).filter(Boolean);
      const goldWorkIds = [...new Set([...explicitWorkIds, ...passageWorkIds])];
      const goldWorks = goldWorkIds.map((id) => workRow.get(id)).filter(Boolean);
      assert.ok(goldPassageIds.length >= 6, `${config.slug}: insuficientes pasajes de referencia.`);
      assert.ok(goldWorks.length >= 7, `${config.slug}: insuficientes obras de referencia.`);
      assert.ok(goldWorks.every((work) => work.archived === 0 && work.deep_status === 'done' && work.passage_count > 0), `${config.slug}: una obra de referencia no es indexable.`);
      let model = null;
      try { model = row.model_json ? JSON.parse(row.model_json) : null; } catch { /* legacy */ }
      return {
        slug: config.slug,
        reportId: row.id,
        title: row.title,
        objective: brief.objective,
        facets: config.facets,
        goldPassageIds,
        goldWorkIds,
        goldWorks: goldWorks.map((work) => ({ id: work.nodus_id, title: work.title })),
        historical: {
          model,
          updatedAt: row.updated_at,
          selection: {
            ideas: selection.ideaIds?.length ?? 0,
            works: selection.workIds?.length ?? 0,
            passages: selection.passageIds?.length ?? 0,
          },
          ...metrics,
        },
      };
    });
    report.corpus = {
      works: db.prepare('SELECT COUNT(*) count FROM works').get().count,
      activeWorks: db.prepare('SELECT COUNT(*) count FROM works WHERE archived=0').get().count,
      passages: db.prepare('SELECT COUNT(*) count FROM passages').get().count,
      ideas: db.prepare('SELECT COUNT(*) count FROM ideas').get().count,
      savedDeepResearchReports: db.prepare('SELECT COUNT(*) count FROM writing_saved_drafts').get().count,
    };
    return fixtures;
  } finally {
    db.close();
  }
}

async function launchProfile() {
  const env = {
    ...process.env,
    NODUS_USERDATA: profilePath,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launched = await electron.launch({
    executablePath: require(path.join(repoRoot, 'node_modules/electron')),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 10 * 60_000,
  });
  const page = await launched.firstWindow({ timeout: 10 * 60_000 });
  page.setDefaultTimeout(60 * 60_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, require(path.join(repoRoot, 'package.json')).version);
  const settings = await page.evaluate(async ({ model, embedding, keys, concurrency }) => {
    return window.nodus.updateSettings({
      ...Object.fromEntries(keys.map((key) => [key, model])),
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
      documentIndexConcurrency: concurrency,
      announcementsEnabled: false,
      autoBackupEnabled: false,
      autoBackupFolder: '',
      libraryGlobalEnabled: false,
      mcpEnabled: false,
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
  }, { model: TEXT_MODEL, embedding: EMBEDDING_MODEL, keys: MODEL_SETTING_KEYS, concurrency: DOCUMENT_CONCURRENCY });
  assert.equal(settings.providerKeys.gemini, true);
  assert.equal(settings.providerKeys.openrouter, true);
  assert.equal(settings.embeddingProvider, EMBEDDING_MODEL.provider);
  assert.equal(settings.embeddingModel, EMBEDDING_MODEL.model);
  for (const key of MODEL_SETTING_KEYS) assert.deepEqual(settings[key], TEXT_MODEL, key);
  const vaults = await page.evaluate(() => window.nodus.listVaults());
  assert.equal(vaults.length, 1);
  assert.ok(vaults.every((vault) => isWithin(vault.path, profilePath)));
  return { launched, page, settings };
}

async function probeRetrieval(page, fixture, label) {
  log(`${label} · ${fixture.slug}: Semantic, Writing e Immersion`);
  return page.evaluate(async ({ objective }) => {
    const semantic = await window.nodus.semanticSearch(objective, {
      kinds: ['work', 'passage', 'idea'], limit: 40, minSimilarity: 0.12,
    });
    const writing = await window.nodus.getWritingWorkshopSnapshot({
      kind: 'literature_review',
      objective,
      audience: 'investigación académica',
      tone: 'critical',
      language: 'es',
    });
    const immersion = await window.nodus.buildImmersionScope({ topic: objective, minutes: 90 });
    return {
      semantic: {
        available: semantic.available,
        works: semantic.results.filter((item) => item.kind === 'work').map((item) => item.id),
        workDetails: semantic.results.filter((item) => item.kind === 'work').map((item) => ({ id: item.id, score: item.similarity, title: item.title })),
        passages: semantic.results.filter((item) => item.kind === 'passage').map((item) => item.id),
        ideas: semantic.results.filter((item) => item.kind === 'idea').map((item) => item.id),
      },
      writing: {
        works: writing.works.map((item) => item.id),
        workDetails: writing.works.map((item) => ({ id: item.id, score: item.score, title: item.title, documentStatus: item.documentStatus })),
        passages: writing.passages.map((item) => item.id),
        ideas: writing.ideas.map((item) => item.id),
        profiledWorks: writing.works.filter((item) => Boolean(item.documentOverview)).map((item) => item.id),
        stats: writing.stats,
      },
      immersion: {
        works: immersion.works.map((item) => item.nodusId),
        workDetails: immersion.works.map((item) => ({ id: item.nodusId, score: item.score, title: item.title, ideaCount: item.ideaCount })),
        ideas: immersion.ideas.map((item) => item.id),
        passageCount: immersion.passageCount,
        warnings: immersion.warnings,
      },
    };
  }, { objective: fixture.objective });
}

async function probeAnswers(page, fixture, label) {
  log(`${label} · ${fixture.slug}: ${CHAT_TRIALS} ensayo(s) de Chat y Nodi`);
  return page.evaluate(async ({ objective, facets, model, trials }) => {
    const selection = {
      ideas: true,
      themes: true,
      contradictions: true,
      gaps: true,
      readingPath: false,
      authors: true,
      documents: true,
      passages: true,
      graph: true,
      graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: false },
    };
    const refs = (text) => {
      const out = [];
      const seen = new Set();
      for (const match of String(text).matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
        let id = match[2];
        try { id = decodeURIComponent(id); } catch { /* retain raw */ }
        const key = `${match[1]}:${id}`;
        if (!seen.has(key)) { seen.add(key); out.push({ kind: match[1], id }); }
      }
      return out;
    };
    const compact = async (answer, stats = null) => {
      const extracted = refs(answer);
      const verified = extracted.length ? await window.nodus.verifyCitations(extracted) : {};
      return {
        chars: String(answer).length,
        facets: facets.filter((pattern) => new RegExp(pattern, 'iu').test(String(answer))).length,
        facetTotal: facets.length,
        refs: extracted,
        citations: {
          total: extracted.length,
          valid: extracted.filter((ref) => verified[`${ref.kind}:${ref.id}`] === true).length,
          invalid: extracted.filter((ref) => verified[`${ref.kind}:${ref.id}`] !== true),
        },
        stats,
      };
    };
    const chat = [];
    const nodi = [];
    for (let index = 0; index < trials; index += 1) {
      let streamed = '';
      const answer = await window.nodus.researchChatStream(
        { messages: [{ role: 'user', content: objective }], selection, model },
        { onDelta: (delta) => { streamed += delta; } },
      );
      chat.push(await compact(answer.answer || streamed, answer.stats));
      let nodiStream = '';
      const nodiAnswer = await window.nodus.nodiChatStream(
        { messages: [{ role: 'user', content: objective }], contexts: ['vault'], model },
        { onDelta: (delta) => { nodiStream += delta; } },
      );
      nodi.push(await compact(String(nodiAnswer || nodiStream)));
    }
    return { chat, nodi };
  }, { objective: fixture.objective, facets: fixture.facets, model: TEXT_MODEL, trials: CHAT_TRIALS });
}

async function waitFor(description, predicate, timeoutMs = 3 * 60 * 60_000, intervalMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last?.done) return last.value;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout esperando ${description}: ${JSON.stringify(last)}`);
}

async function runCampaign(page, ids) {
  const campaign = await page.evaluate((nodusIds) => window.nodus.startDocumentIndexCampaign({ nodusIds }), ids);
  log(`campaña ${campaign.campaignId}: ${ids.length} obras, ${DOCUMENT_CONCURRENCY} trabajadores`);
  let last = '';
  return waitFor('campaña de calidad', async () => {
    const progress = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    const jobs = progress.jobs.filter((job) => job.campaignId === campaign.campaignId);
    const counts = Object.fromEntries(['queued', 'running', 'completed', 'failed', 'unavailable', 'cancelled', 'paused']
      .map((status) => [status, jobs.filter((job) => job.status === status).length]));
    const running = jobs.filter((job) => job.status === 'running')
      .map((job) => `${job.title}:${job.phase}:${Math.floor(job.progress * 10) * 10}%`);
    const line = `${counts.completed}/${ids.length} completadas · ${running.join(' | ')}`;
    if (line !== last) { log(line); last = line; }
    const terminal = new Set(['completed', 'failed', 'unavailable', 'cancelled']);
    return jobs.length === ids.length && jobs.every((job) => terminal.has(job.status))
      ? { done: true, value: { campaign, jobs, counts } }
      : { done: false, counts, running };
  });
}

async function runDeepResearch(page, fixture) {
  log(`Deep Research actual · ${fixture.slug}`);
  await page.evaluate(({ objective, model }) => {
    window.__qualityDeep = { done: false, error: null, progress: [], report: null };
    window.nodus.generateDeepResearchReport({
      objective,
      approach: 'general',
      language: 'es',
      audience: 'investigación académica',
      sectionLimit: 5,
      model,
      decorativeImage: { enabled: false, style: 'antique_book' },
    }, {
      onProgress: (progress) => window.__qualityDeep.progress.push(progress),
    }).then((value) => {
      window.__qualityDeep.report = value;
      window.__qualityDeep.done = true;
    }).catch((error) => {
      window.__qualityDeep.error = error instanceof Error ? error.message : String(error);
      window.__qualityDeep.done = true;
    });
  }, { objective: fixture.objective, model: TEXT_MODEL });

  let last = '';
  return waitFor('Deep Research de calidad', async () => {
    const state = await page.evaluate(() => ({
      done: window.__qualityDeep.done,
      error: window.__qualityDeep.error,
      latest: window.__qualityDeep.progress.at(-1) ?? null,
    }));
    const line = state.latest ? `${state.latest.phase}: ${state.latest.message}` : '';
    if (line && line !== last) { log(`Deep · ${line}`); last = line; }
    if (!state.done) return { done: false, latest: state.latest };
    if (state.error) throw new Error(state.error);
    const value = await page.evaluate((facets) => {
      const state = window.__qualityDeep;
      const draft = state.report.draft;
      const markdown = String(draft.draftMarkdown ?? '');
      const refs = [];
      const seen = new Set();
      for (const match of markdown.matchAll(/nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)#?]+)/g)) {
        let id = match[2];
        try { id = decodeURIComponent(id); } catch { /* raw */ }
        const key = `${match[1]}:${id}`;
        if (!seen.has(key)) { seen.add(key); refs.push({ kind: match[1], id }); }
      }
      const words = markdown.trim().split(/\s+/u).filter(Boolean).length;
      const verdicts = {};
      for (const item of draft.supportAudit ?? []) verdicts[item.verdict] = (verdicts[item.verdict] ?? 0) + 1;
      return {
        phases: [...new Set(state.progress.map((item) => item.phase))],
        title: draft.title,
        words,
        sections: [...markdown.matchAll(/^##\s+/gm)].length,
        facets: { covered: facets.filter((pattern) => new RegExp(pattern, 'iu').test(markdown)).length, total: facets.length },
        refs,
        bibliography: draft.bibliography?.length ?? 0,
        limitations: draft.limitations?.length ?? 0,
        supportAudit: { total: draft.supportAudit?.length ?? 0, verdicts },
        stats: draft.stats,
        generationModel: draft.generationModel,
      };
    }, fixture.facets);
    return { done: true, value };
  }, 2 * 60 * 60_000, 2_000);
}

async function runImmersion(page, fixture) {
  log(`Immersion completa · ${fixture.slug}`);
  await page.evaluate(({ topic, model }) => {
    window.__qualityImmersion = { done: false, error: null, progress: [], session: null };
    window.nodus.generateImmersionSession({
      topic,
      language: 'es',
      minutes: 90,
      includeQuiz: true,
      model,
      decorativeImage: { enabled: false, style: 'antique_book' },
    }, {
      onProgress: (progress) => window.__qualityImmersion.progress.push(progress),
    }).then((value) => {
      window.__qualityImmersion.session = value;
      window.__qualityImmersion.done = true;
    }).catch((error) => {
      window.__qualityImmersion.error = error instanceof Error ? error.message : String(error);
      window.__qualityImmersion.done = true;
    });
  }, { topic: fixture.objective, model: TEXT_MODEL });
  let last = '';
  return waitFor('Immersion completa', async () => {
    const state = await page.evaluate(() => ({
      done: window.__qualityImmersion.done,
      error: window.__qualityImmersion.error,
      latest: window.__qualityImmersion.progress.at(-1) ?? null,
    }));
    const line = state.latest ? `${state.latest.phase}: ${state.latest.message}` : '';
    if (line && line !== last) { log(`Immersion · ${line}`); last = line; }
    if (!state.done) return { done: false, latest: state.latest };
    if (state.error) throw new Error(state.error);
    const value = await page.evaluate(() => {
      const state = window.__qualityImmersion;
      const session = state.session;
      const citations = session.plan.stations.flatMap((station) => station.citations ?? []);
      return {
        phases: [...new Set(state.progress.map((item) => item.phase))],
        model: session.model,
        stoppedReason: session.plan.stoppedReason,
        stations: session.plan.stations.length,
        ideas: session.plan.stats.ideas,
        works: session.plan.stats.works,
        citations: citations.map((item) => ({ passageId: item.passageId, workId: item.workId })),
        examQuestions: session.plan.exam.questions.length,
      };
    });
    return { done: true, value };
  }, 2 * 60 * 60_000, 2_000);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function metricsAt(order, goldValues, k = 20) {
  const ranked = dedupe(order).slice(0, k);
  const gold = new Set(goldValues);
  const relevant = ranked.map((id) => gold.has(id));
  const hits = relevant.filter(Boolean).length;
  let dcg = 0;
  relevant.forEach((hit, index) => { if (hit) dcg += 1 / Math.log2(index + 2); });
  let idcg = 0;
  for (let index = 0; index < Math.min(gold.size, k); index += 1) idcg += 1 / Math.log2(index + 2);
  const first = relevant.indexOf(true);
  return {
    k,
    returned: ranked.length,
    gold: gold.size,
    hits,
    precision: ranked.length ? hits / ranked.length : 0,
    recall: gold.size ? hits / gold.size : 0,
    ndcg: idcg ? dcg / idcg : 0,
    mrr: first >= 0 ? 1 / (first + 1) : 0,
  };
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function resolveRefWorks(db, refs) {
  const passage = db.prepare('SELECT nodus_id FROM passages WHERE passage_id=?');
  const idea = db.prepare('SELECT nodus_id FROM idea_occurrences WHERE global_id=? ORDER BY confidence DESC, nodus_id');
  const strict = [];
  const expanded = [];
  const passageIds = [];
  for (const ref of refs) {
    if (ref.kind === 'work') {
      strict.push(ref.id);
      expanded.push(ref.id);
    } else if (ref.kind === 'passage') {
      passageIds.push(ref.id);
      const row = passage.get(ref.id);
      if (row) { strict.push(row.nodus_id); expanded.push(row.nodus_id); }
    } else if (ref.kind === 'idea') {
      expanded.push(...idea.all(ref.id).map((row) => row.nodus_id));
    }
  }
  return { strictWorkIds: dedupe(strict), expandedWorkIds: dedupe(expanded), passageIds: dedupe(passageIds) };
}

function scoreRawProbe(db, raw, fixture) {
  const answerTrials = (trials) => trials.map((trial) => {
    const resolved = resolveRefWorks(db, trial.refs);
    return {
      chars: trial.chars,
      facets: trial.facets,
      facetTotal: trial.facetTotal,
      citations: trial.citations,
      strictWorks: metricsAt(resolved.strictWorkIds, fixture.goldWorkIds, 20),
      expandedWorks: metricsAt(resolved.expandedWorkIds, fixture.goldWorkIds, 20),
      passages: metricsAt(resolved.passageIds, fixture.goldPassageIds, 20),
      stats: trial.stats,
    };
  });
  return {
    semanticWorks: metricsAt(raw.retrieval.semantic.works, fixture.goldWorkIds, 20),
    semanticPassages: metricsAt(raw.retrieval.semantic.passages, fixture.goldPassageIds, 20),
    writingWorks: metricsAt(raw.retrieval.writing.works, fixture.goldWorkIds, 20),
    writingPassages: metricsAt(raw.retrieval.writing.passages, fixture.goldPassageIds, 20),
    immersionWorks: metricsAt(raw.retrieval.immersion.works, fixture.goldWorkIds, 20),
    retrievalCounts: {
      semanticWorks: raw.retrieval.semantic.works.length,
      semanticPassages: raw.retrieval.semantic.passages.length,
      writingWorks: raw.retrieval.writing.works.length,
      writingPassages: raw.retrieval.writing.passages.length,
      profiledWorks: raw.retrieval.writing.profiledWorks.length,
      immersionWorks: raw.retrieval.immersion.works.length,
      immersionPassages: raw.retrieval.immersion.passageCount,
    },
    chat: answerTrials(raw.answers.chat),
    nodi: answerTrials(raw.answers.nodi),
  };
}

function aggregateSurface(scored, key) {
  return {
    ndcg: average(scored.map((item) => item[key].ndcg)),
    recall: average(scored.map((item) => item[key].recall)),
    precision: average(scored.map((item) => item[key].precision)),
    mrr: average(scored.map((item) => item[key].mrr)),
  };
}

function aggregateAnswers(scored, key) {
  const trials = scored.flatMap((item) => item[key]);
  const citations = trials.reduce((sum, trial) => sum + trial.citations.total, 0);
  const valid = trials.reduce((sum, trial) => sum + trial.citations.valid, 0);
  return {
    trials: trials.length,
    validCitationRate: citations ? valid / citations : 0,
    meanCitations: trials.length ? citations / trials.length : 0,
    meanFacetCoverage: average(trials.map((trial) => trial.facetTotal ? trial.facets / trial.facetTotal : 0)),
    strictWorkNdcg: average(trials.map((trial) => trial.strictWorks.ndcg)),
    strictWorkRecall: average(trials.map((trial) => trial.strictWorks.recall)),
    expandedWorkNdcg: average(trials.map((trial) => trial.expandedWorks.ndcg)),
    passageRecall: average(trials.map((trial) => trial.passages.recall)),
  };
}

function comparison(before, after) {
  const delta = after - before;
  return { before, after, absolute: delta, relative: before > 0 ? delta / before : (after > 0 ? 1 : 0) };
}

function scoreDeep(db, raw, fixture) {
  const resolved = resolveRefWorks(db, raw.refs);
  const valid = raw.refs.filter((ref) => citationExists(db, ref)).length;
  return {
    ...raw,
    citations: {
      total: raw.refs.length,
      valid,
      validRate: raw.refs.length ? valid / raw.refs.length : 0,
      kinds: Object.fromEntries(['idea', 'work', 'passage', 'gap', 'contradiction'].map((kind) => [kind, raw.refs.filter((ref) => ref.kind === kind).length])),
      perThousandWords: raw.words ? (raw.refs.length / raw.words) * 1000 : 0,
    },
    goldWorks: metricsAt(resolved.strictWorkIds, fixture.goldWorkIds, 30),
    expandedGoldWorks: metricsAt(resolved.expandedWorkIds, fixture.goldWorkIds, 30),
    goldPassages: metricsAt(resolved.passageIds, fixture.goldPassageIds, 30),
    refs: undefined,
  };
}

function writeReport() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function freezeGenerativeProfileUniverse(allowedIds) {
  const db = new Database(cloneDbPath);
  try {
    const now = new Date().toISOString();
    const placeholders = allowedIds.map(() => '?').join(',');
    const versionsBefore = db.prepare('SELECT COUNT(*) count FROM document_profile_versions').get().count;
    const result = db.prepare(
      `INSERT INTO document_profile_state(nodus_id,status,error,updated_at)
       SELECT w.nodus_id,'unavailable','Excluida de la muestra fija de auditoría.',?
         FROM works w
        WHERE w.nodus_id NOT IN (${placeholders})
       ON CONFLICT(nodus_id) DO UPDATE SET
         status=CASE WHEN document_profile_state.current_version_id IS NULL THEN 'unavailable' ELSE document_profile_state.status END,
         error=CASE WHEN document_profile_state.current_version_id IS NULL THEN excluded.error ELSE document_profile_state.error END,
         updated_at=CASE WHEN document_profile_state.current_version_id IS NULL THEN excluded.updated_at ELSE document_profile_state.updated_at END`
    ).run(now, ...allowedIds);
    const frozen = db.prepare(
      `SELECT COUNT(*) count FROM document_profile_state
        WHERE status='unavailable' AND error='Excluida de la muestra fija de auditoría.'`
    ).get().count;
    return { allowed: allowedIds.length, frozen, changed: result.changes, versionsBefore };
  } finally {
    db.close();
  }
}

function assertion(name, ok, detail = null) {
  report.assertions.push({ name, ok: Boolean(ok), detail });
  assert.equal(Boolean(ok), true, `${name}${detail ? `: ${detail}` : ''}`);
}

try {
  report.isolation.build = assertFreshBuild();
  log('build verificado: los artefactos Electron y renderer son posteriores al código fuente');
  log(`fuente real, exclusivamente lectura: ${SOURCE_USERDATA}`);
  const { registryPath, active } = readRegistry();
  const beforeSource = sourceState(registryPath, active.path);
  if (RESUME_ROOT) {
    assert.equal(report.isolation.auditRoot, RESUME_ROOT, 'La copia reanudada no coincide con el informe parcial.');
    assert.ok(fs.existsSync(snapshotPath) && fs.existsSync(cloneDbPath), 'La copia reanudable está incompleta.');
    report.source.resumeBefore = beforeSource;
  } else {
    report.source = {
      userData: SOURCE_USERDATA,
      registryPath,
      activeDatabase: active.path,
      before: beforeSource,
    };
  }

  if (!RESUME_ROOT) {
    log('snapshot SQLite consistente mediante backup online read-only');
    await onlineBackup(active.path, snapshotPath);
  } else {
    log(`reanudando la copia aislada ya indexada: ${RESUME_ROOT}`);
  }
  const fixtures = loadBenchmarks();
  report.benchmarks = fixtures.map((fixture) => ({
    slug: fixture.slug,
    reportId: fixture.reportId,
    title: fixture.title,
    objective: fixture.objective,
    goldPassages: fixture.goldPassageIds.length,
    goldWorks: fixture.goldWorks,
    historical: { ...fixture.historical, refs: undefined },
  }));
  if (!RESUME_ROOT) {
    createProfile(active);
    report.isolation = {
      build: report.isolation.build,
      auditRoot,
      profilePath,
      cloneDatabase: cloneDbPath,
      copiedSecrets: ['gemini', 'openrouter'],
      sourceOpenedForWrites: false,
      realReportsSentToProvider: false,
    };
  } else {
    report.isolation = { ...report.isolation, build: report.isolation.build, resumed: true };
  }
  writeReport();

  const launched = await launchProfile();
  app = launched.launched;
  const page = launched.page;
  const baselineRaw = RESUME_ROOT ? report.baseline.raw : [];
  if (!RESUME_ROOT) {
    for (const fixture of fixtures) {
      baselineRaw.push({
        slug: fixture.slug,
        retrieval: await probeRetrieval(page, fixture, 'baseline'),
        answers: await probeAnswers(page, fixture, 'baseline'),
      });
    }
    report.baseline.raw = baselineRaw;
    writeReport();
  } else {
    assert.equal(baselineRaw?.length, fixtures.length, 'El baseline parcial no es reanudable.');
  }

  const goldIds = dedupe(fixtures.flatMap((fixture) => fixture.goldWorkIds));
  if (RESUME_ROOT) {
    const progress = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    const completedJobs = progress.jobs.filter((job) => job.status === 'completed');
    const candidateIds = completedJobs.map((job) => job.nodusId);
    const coveredGold = goldIds.filter((id) => candidateIds.includes(id));
    assert.ok(coveredGold.length > 0, 'La muestra reanudada no contiene ninguna obra de referencia.');
    report.campaign.selection = {
      total: candidateIds.length,
      goldUnion: goldIds.length,
      goldCovered: coveredGold.length,
      goldCoverage: coveredGold.length / goldIds.length,
      missingGoldIds: goldIds.filter((id) => !candidateIds.includes(id)),
      hardNegatives: candidateIds.filter((id) => !goldIds.includes(id)).length,
      ids: candidateIds,
      stoppedAtUserRequest: true,
      excludedCancelled: progress.jobs.filter((job) => job.status === 'cancelled').length,
    };
    report.campaign.result = {
      campaign: progress.campaigns.find((item) => item.campaignId === completedJobs[0]?.campaignId) ?? null,
      jobs: completedJobs,
      counts: { completed: completedJobs.length },
    };
    log(`muestra fijada por el usuario: ${completedJobs.length} perfiles completos; ${report.campaign.selection.excludedCancelled} excluidos`);
  } else {
    const eligible = new Set();
    const eligibilityDb = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    try {
      eligibilityDb.pragma('query_only = ON');
      for (const row of eligibilityDb.prepare(
        `SELECT w.nodus_id FROM works w
          WHERE w.archived=0 AND w.deep_status='done'
            AND w.source_type IN ('pdf','epub','markdown')
            AND EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id=w.nodus_id)`
      ).all()) eligible.add(row.nodus_id);
    } finally {
      eligibilityDb.close();
    }
    const negatives = [];
    for (const raw of baselineRaw) {
      negatives.push(...raw.retrieval.semantic.works.slice(0, HARD_NEGATIVES_PER_SURFACE));
      negatives.push(...raw.retrieval.writing.works.slice(0, HARD_NEGATIVES_PER_SURFACE));
      negatives.push(...raw.retrieval.immersion.works.slice(0, HARD_NEGATIVES_PER_SURFACE));
    }
    const eligibleGold = goldIds.filter((id) => eligible.has(id));
    const eligibleNegatives = dedupe(negatives)
      .filter((id) => eligible.has(id) && !eligibleGold.includes(id))
      .slice(0, Math.max(0, MAX_CAMPAIGN_WORKS - eligibleGold.length));
    const candidateIds = [...eligibleGold, ...eligibleNegatives];
    assert.ok(goldIds.every((id) => candidateIds.includes(id)), 'La campaña perdió una obra de referencia.');
    assert.ok(candidateIds.length <= MAX_CAMPAIGN_WORKS, `La campaña requiere ${candidateIds.length}; máximo prefijado ${MAX_CAMPAIGN_WORKS}.`);
    report.campaign.selection = {
      total: candidateIds.length,
      goldUnion: goldIds.length,
      hardNegatives: candidateIds.filter((id) => !goldIds.includes(id)).length,
      ids: candidateIds,
    };
    report.campaign.result = await runCampaign(page, candidateIds);
    const badJobs = report.campaign.result.jobs.filter((job) => job.status !== 'completed');
    assert.equal(badJobs.length, 0, `Fallaron perfiles: ${badJobs.map((job) => `${job.title}:${job.status}:${job.error ?? ''}`).join(' | ')}`);
  }
  writeReport();

  const treatmentRaw = [];
  for (const fixture of fixtures) {
    treatmentRaw.push({
      slug: fixture.slug,
      retrieval: await probeRetrieval(page, fixture, 'tratamiento'),
      answers: await probeAnswers(page, fixture, 'tratamiento'),
    });
  }
  report.treatment.raw = treatmentRaw;
  writeReport();

  if (RUN_GENERATIVE) {
    report.campaign.generativeFreeze = freezeGenerativeProfileUniverse(report.campaign.selection.ids);
    log(`universo generativo congelado: ${report.campaign.generativeFreeze.allowed} permitidas; ${report.campaign.generativeFreeze.frozen} excluidas`);
    const deepFixture = fixtures.find((fixture) => fixture.slug === 'tourism-apparatus');
    const immersionFixture = fixtures.find((fixture) => fixture.slug === 'visual-modernity');
    report.generative.deepResearch = {
      benchmark: deepFixture.slug,
      current: await runDeepResearch(page, deepFixture),
    };
    writeReport();
    report.generative.immersion = {
      benchmark: immersionFixture.slug,
      current: await runImmersion(page, immersionFixture),
    };
    writeReport();
  }

  await app.close();
  app = null;

  const scoredDb = new Database(cloneDbPath, { readonly: true, fileMustExist: true });
  try {
    scoredDb.pragma('query_only = ON');
    const baseline = baselineRaw.map((raw) => scoreRawProbe(scoredDb, raw, fixtures.find((fixture) => fixture.slug === raw.slug)));
    const treatment = treatmentRaw.map((raw) => scoreRawProbe(scoredDb, raw, fixtures.find((fixture) => fixture.slug === raw.slug)));
    const surfaceKeys = ['semanticWorks', 'writingWorks', 'immersionWorks', 'writingPassages'];
    const beforeSurfaces = Object.fromEntries(surfaceKeys.map((key) => [key, aggregateSurface(baseline, key)]));
    const afterSurfaces = Object.fromEntries(surfaceKeys.map((key) => [key, aggregateSurface(treatment, key)]));
    const surfaceComparisons = Object.fromEntries(surfaceKeys.map((key) => [key, {
      ndcg: comparison(beforeSurfaces[key].ndcg, afterSurfaces[key].ndcg),
      recall: comparison(beforeSurfaces[key].recall, afterSurfaces[key].recall),
      precision: comparison(beforeSurfaces[key].precision, afterSurfaces[key].precision),
    }]));
    const beforeChat = aggregateAnswers(baseline, 'chat');
    const afterChat = aggregateAnswers(treatment, 'chat');
    const beforeNodi = aggregateAnswers(baseline, 'nodi');
    const afterNodi = aggregateAnswers(treatment, 'nodi');
    const primaryBefore = average(['semanticWorks', 'writingWorks', 'immersionWorks'].map((key) => beforeSurfaces[key].ndcg));
    const primaryAfter = average(['semanticWorks', 'writingWorks', 'immersionWorks'].map((key) => afterSurfaces[key].ndcg));
    const primary = comparison(primaryBefore, primaryAfter);
    const worstRegression = Math.min(...['semanticWorks', 'writingWorks', 'immersionWorks']
      .map((key) => surfaceComparisons[key].ndcg.absolute));
    const considerable = (
      primary.absolute >= QUALITY_THRESHOLDS.absoluteNdcgGain
      || primary.relative >= QUALITY_THRESHOLDS.relativeNdcgGain
    ) && worstRegression >= -QUALITY_THRESHOLDS.maximumSurfaceRegression;
    report.baseline.scored = baseline;
    report.treatment.scored = treatment;
    report.comparisons = {
      surfaces: surfaceComparisons,
      primaryDocumentRetrievalNdcg: primary,
      chat: {
        before: beforeChat,
        after: afterChat,
        strictWorkNdcg: comparison(beforeChat.strictWorkNdcg, afterChat.strictWorkNdcg),
        strictWorkRecall: comparison(beforeChat.strictWorkRecall, afterChat.strictWorkRecall),
        passageRecall: comparison(beforeChat.passageRecall, afterChat.passageRecall),
      },
      nodi: {
        before: beforeNodi,
        after: afterNodi,
        strictWorkNdcg: comparison(beforeNodi.strictWorkNdcg, afterNodi.strictWorkNdcg),
        strictWorkRecall: comparison(beforeNodi.strictWorkRecall, afterNodi.strictWorkRecall),
        passageRecall: comparison(beforeNodi.passageRecall, afterNodi.passageRecall),
      },
      qualityGate: {
        considerable,
        worstPrimarySurfaceRegression: worstRegression,
        validCitations: afterChat.validCitationRate === 1 && afterNodi.validCitationRate === 1,
      },
    };

    if (report.generative.deepResearch?.current) {
      const fixture = fixtures.find((item) => item.slug === report.generative.deepResearch.benchmark);
      const current = scoreDeep(scoredDb, report.generative.deepResearch.current, fixture);
      const historical = fixture.historical;
      report.generative.deepResearch.comparison = {
        historical: {
          words: historical.words,
          sections: historical.sections,
          facets: historical.facets,
          citations: historical.citations,
          bibliography: historical.bibliography,
          supportAudit: historical.supportAudit,
          limitations: historical.limitations,
        },
        current,
        citationDensity: comparison(historical.citations.perThousandWords, current.citations.perThousandWords),
        facetCoverage: comparison(
          historical.facets.covered / historical.facets.total,
          current.facets.covered / current.facets.total,
        ),
      };
      report.generative.deepResearch.current = undefined;
    }
    if (report.generative.immersion?.current) {
      const fixture = fixtures.find((item) => item.slug === report.generative.immersion.benchmark);
      const current = report.generative.immersion.current;
      report.generative.immersion.scored = {
        ...current,
        goldWorks: metricsAt(current.citations.map((item) => item.workId), fixture.goldWorkIds, 30),
        goldPassages: metricsAt(current.citations.map((item) => item.passageId), fixture.goldPassageIds, 30),
      };
      report.generative.immersion.current = undefined;
    }

    const profiles = scoredDb.prepare(
      `SELECT COUNT(*) count,
              SUM(CASE WHEN s.status='current' THEN 1 ELSE 0 END) current,
              SUM(CASE WHEN json_extract(v.profile_json,'$.fallbackMode')='extractive' THEN 1 ELSE 0 END) extractiveFallbacks,
              ROUND(AVG(v.quality_score),3) averageQuality,
              MIN(v.quality_score) minimumQuality
         FROM document_profile_state s
         JOIN document_profile_versions v ON v.version_id=s.current_version_id
        WHERE s.nodus_id IN (${report.campaign.selection.ids.map(() => '?').join(',')})`
    ).get(...report.campaign.selection.ids);
    const vectorModels = scoredDb.prepare(
      'SELECT DISTINCT embedding_provider provider,embedding_model model,embedding_dim dim FROM document_vectors'
    ).all();
    const profileModels = scoredDb.prepare(
      'SELECT DISTINCT generator_model_json generator,auditor_model_json auditor,pipeline_version pipeline FROM document_profile_versions'
    ).all();
    report.databaseVerification = {
      integrity: scoredDb.pragma('integrity_check', { simple: true }),
      profiles,
      vectorModels,
      profileModels,
      profileVersions: scoredDb.prepare('SELECT COUNT(*) count FROM document_profile_versions').get().count,
    };
  } finally {
    scoredDb.close();
  }

  const afterSource = sourceState(registryPath, active.path);
  report.source.after = afterSource;
  report.source.unchanged = Object.keys(beforeSource).every((key) => sameFileState(beforeSource[key], afterSource[key]));

  assertion('Tres benchmarks reales cargados', report.benchmarks.length === 3);
  assertion('Muestra documental completa sin fallos', report.campaign.result.jobs.every((job) => job.status === 'completed'));
  assertion('Citas de Chat resolubles', report.comparisons.chat.after.validCitationRate === QUALITY_THRESHOLDS.validCitationRate);
  assertion('Citas de Nodi resolubles', report.comparisons.nodi.after.validCitationRate === QUALITY_THRESHOLDS.validCitationRate);
  assertion('Integridad SQLite de la copia', report.databaseVerification.integrity === 'ok');
  assertion('Todos los perfiles de la muestra están vigentes', report.databaseVerification.profiles.count === report.campaign.selection.total
    && report.databaseVerification.profiles.count === report.databaseVerification.profiles.current);
  assertion('Solo BGE-M3 generó vectores documentales', report.databaseVerification.vectorModels.length > 0
    && report.databaseVerification.vectorModels.every((row) => row.provider === EMBEDDING_MODEL.provider && row.model === EMBEDDING_MODEL.model));
  assertion('Solo Gemini Flash Lite generó y auditó fichas', report.databaseVerification.profileModels.length > 0
    && report.databaseVerification.profileModels.every((row) => {
      const generator = JSON.parse(row.generator);
      const auditor = JSON.parse(row.auditor);
      return generator.provider === TEXT_MODEL.provider && generator.model === TEXT_MODEL.model
        && auditor.provider === TEXT_MODEL.provider && auditor.model === TEXT_MODEL.model;
    }));
  assertion('Perfil Nodus real intacto', report.source.unchanged);
  if (RUN_GENERATIVE) {
    assertion('Deep Research e Immersion no ampliaron la muestra', report.databaseVerification.profileVersions === report.campaign.generativeFreeze.versionsBefore);
    assertion('Deep Research usó preparación documental', report.generative.deepResearch.comparison.current.phases.includes('document_preparation'));
    assertion('Deep Research conserva citas válidas', report.generative.deepResearch.comparison.current.citations.validRate === 1);
    assertion('Deep Research usó Gemini permitido', JSON.stringify(report.generative.deepResearch.comparison.current.generationModel) === JSON.stringify(TEXT_MODEL));
    assertion('Immersion usó preparación documental', report.generative.immersion.scored.phases.includes('document_preparation'));
    assertion('Immersion terminó sin degradación', !report.generative.immersion.scored.stoppedReason);
    assertion('Immersion conserva pasajes literales', report.generative.immersion.scored.citations.length > 0);
  }

  report.ok = true;
  report.completedAt = new Date().toISOString();
  writeReport();
  log(`AUDITORÍA TERMINADA · considerable=${report.comparisons.qualityGate.considerable} · ${REPORT_PATH}`);
} catch (error) {
  report.ok = false;
  report.completedAt = new Date().toISOString();
  report.errors.push(error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) });
  writeReport();
  throw error;
} finally {
  try { if (app) await app.close(); } catch { /* best effort */ }
  if (!KEEP_CLONE) {
    await sleep(500);
    try {
      fs.rmSync(auditRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      log(`snapshot y perfil temporal eliminados: ${auditRoot}`);
    } catch (error) {
      log(`limpieza pendiente: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    log(`copia temporal conservada: ${auditRoot}`);
  }
}
