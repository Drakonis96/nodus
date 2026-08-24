// Provider-free Deep Research evidence harness for the isolated Luna benchmark.
//
// This script deliberately has no generation path. It builds the production
// workshop snapshot and, in the second phase, retrieves section evidence. The
// only provider it may use is the OpenRouter BGE-M3 embedding configured in the
// explicitly supplied snapshot. Never omit --snapshot: the refusal is part of
// the safety contract because this script is intended to be run repeatedly by
// external judges.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ELECTRON_FLAG = '--electron-luna-evidence';
const VALID_VERSIONS = new Set(['v1', 'v2']);
const VALID_PHASES = new Set(['snapshot', 'sections']);

const argOf = (name, fallback = undefined) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

/** The v1/v2 switch is intentionally independent from approach and prose size. */
export function parseEvidenceVersion(value) {
  if (value === undefined || value === null || value === '') return 'v2';
  assert.ok(VALID_VERSIONS.has(String(value)), `Unknown Deep Research version: ${value}`);
  return String(value);
}

export function parseEvidencePhase(value) {
  const phase = value || 'snapshot';
  assert.ok(VALID_PHASES.has(phase), `Unknown evidence phase: ${phase}`);
  return phase;
}

/**
 * Refuse profiles that look like a live Nodus installation. A caller must pass
 * a concrete clone; accepting a default here would make accidental DB writes
 * far too easy. Tests can pass a temporary path without touching this guard.
 */
export function assertIsSafeSnapshot(snapshotDir, realProfile = process.env.NODUS_REAL_PROFILE) {
  assert.ok(snapshotDir, 'Pass an explicit --snapshot pointing at an isolated clone.');
  const resolved = path.resolve(snapshotDir);
  const normalized = resolved.replaceAll('\\', '/').toLowerCase();
  const explicitReal = realProfile ? path.resolve(realProfile) : '';
  assert.notEqual(resolved, explicitReal, 'Refusing the configured real Nodus profile.');
  assert.ok(
    !/(?:^|\/)library\/application support\/nodus(?:$|\/)/i.test(normalized)
      && !/(?:^|\/)application support\/nodus(?:$|\/)/i.test(normalized),
    `Refusing a path that looks like a live Nodus profile: ${resolved}`,
  );
  assert.ok(fs.existsSync(path.join(resolved, 'nodus.sqlite')), `Missing isolated snapshot DB: ${resolved}`);
  return resolved;
}

/**
 * A copied profile may retain absolute vault paths in `vaults.json`. Refuse it
 * before starting Electron or calling embeddings: discovering the escape only in
 * the final PRAGMA assertion wastes the complete retrieval run and can read a
 * different corpus than the one the benchmark preregistered.
 */
export function assertSnapshotVaultMetadata(snapshotDir) {
  const root = fs.realpathSync(snapshotDir);
  const catalogPath = path.join(root, 'vaults.json');
  if (!fs.existsSync(catalogPath)) return root;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const vaults = Array.isArray(catalog?.vaults) ? catalog.vaults : [];
  assert.ok(vaults.length > 0, `Snapshot vault catalog has no vaults: ${catalogPath}`);
  for (const vault of vaults) {
    assert.ok(typeof vault?.path === 'string' && vault.path.trim(), `Snapshot vault has no database path: ${catalogPath}`);
    const declared = path.resolve(vault.path);
    assert.ok(fs.existsSync(declared), `Snapshot vault database is missing: ${declared}`);
    const actual = fs.realpathSync(declared);
    const relative = path.relative(root, actual);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `Snapshot vault path escapes the isolated clone: ${declared}`);
  }
  return root;
}

export function routeForVersion(version) {
  const normalized = parseEvidenceVersion(version);
  return normalized === 'v1'
    ? { version: 'v1', snapshot: 'buildHistoricalWritingWorkshopSnapshot', sections: 'retrieveSectionMaterialLegacy', retrievalMode: 'legacy' }
    : { version: 'v2', snapshot: 'buildIdeaFirstWritingWorkshopSnapshot', sections: 'retrieveSectionMaterial', retrievalMode: 'idea_first_document_enrichment' };
}

/** Keep the external Luna input explicit and serialisable. */
export function buildPlanningInput(objective, version, snapshot, catalog) {
  const route = routeForVersion(version);
  return {
    objective,
    version: route.version,
    retrievalMode: route.retrievalMode,
    snapshotBuilder: route.snapshot,
    sectionRetriever: route.sections,
    selection: snapshot.recommendedSelection,
    stats: snapshot.stats,
    ideas: snapshot.ideas,
    themes: snapshot.themes,
    gaps: snapshot.gaps,
    contradictions: snapshot.contradictions,
    works: snapshot.works,
    passages: snapshot.passages,
    tutorRoutes: snapshot.tutorRoutes,
    citationCatalog: catalog,
  };
}

/**
 * The production writer deliberately trims its menu for a model context window.
 * The audit artefact has a different contract: preserve every citable candidate
 * returned by the snapshot so an independent Luna judge can measure recall
 * without confusing a context-window slice with retrieval quality.
 */
export function buildCompleteCitationCatalog(snapshot) {
  const id = (value) => encodeURIComponent(String(value));
  const sourceLabel = (work) => {
    const author = work?.authors?.[0] ?? work?.author ?? 'Autor';
    return `${author}${work?.year ? ` (${work.year})` : ''}`;
  };
  return {
    ideas: (snapshot.ideas ?? []).map((idea) => ({
      token: `[${sourceLabel(idea.works?.[0])}](nodus://idea/${id(idea.id)})`,
      note: idea.statement || idea.summary || idea.label || '',
      type: idea.type || 'claim',
      works: (idea.works ?? []).map((work) => sourceLabel(work)).join('; '),
    })),
    works: (snapshot.works ?? []).map((work) => ({
      token: `[${work.title || work.label || work.id}](nodus://work/${id(work.id)})`,
      note: work.summary || work.title || work.label || '',
    })),
    gaps: (snapshot.gaps ?? []).map((gap) => ({
      token: `[${sourceLabel(gap.work)}](nodus://gap/${id(gap.id)})`,
      note: gap.summary || gap.label || '',
    })),
    contradictions: (snapshot.contradictions ?? []).map((contradiction) => ({
      token: `[${contradiction.sources?.[0] || contradiction.label || 'contradicción'}](nodus://contradiction/${id(contradiction.id)})`,
      note: contradiction.summary || contradiction.label || '',
    })),
    passages: (snapshot.passages ?? []).filter((passage) => passage.summary?.trim()).map((passage) => ({
      token: `[${sourceLabel({ authors: passage.authors, year: passage.year })}${passage.pageLabel ? `, ${passage.pageLabel}` : ''}](nodus://passage/${id(passage.id)})`,
      note: passage.summary,
      source: sourceLabel({ authors: passage.authors, year: passage.year }),
    })),
    themes: (snapshot.themes ?? []).map((theme) => ({ id: theme.id, label: theme.label, summary: theme.summary || '' })),
  };
}

export function summarizeEvidence(sections) {
  const allIdeas = sections.flatMap((section) => section.ideas ?? []);
  const allPassages = sections.flatMap((section) => section.passages ?? []);
  const allWorks = sections.flatMap((section) => section.works ?? []).filter(Boolean);
  const packs = sections.flatMap((section) => section.evidencePacks ?? []);
  const packCandidates = packs.flatMap((pack) => pack.candidates ?? []);
  const passageIds = allPassages.map((passage) => passage.id).filter(Boolean);
  const unique = (values) => new Set(values).size;
  const laneCounts = {};
  for (const candidate of packCandidates) {
    for (const lane of candidate.lanes ?? []) laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
  }
  const questions = sections.flatMap((section) => section.coverageQuestions ?? []);
  const answeredQuestions = new Set(packs.filter((pack) => (pack.passageIds ?? []).length > 0).map((pack) => pack.question)).size;
  return {
    sections: sections.length,
    coverageQuestions: unique(questions),
    questionsWithPassageCandidates: answeredQuestions,
    atomicQuestionCandidateRate: unique(questions) ? answeredQuestions / unique(questions) : 0,
    ideas: unique(allIdeas.map((idea) => idea.id)),
    passages: unique(passageIds),
    works: unique(allWorks),
    repeatedPassageAssignments: passageIds.length - unique(passageIds),
    evidencePacks: packs.length,
    evidencePackCandidates: packCandidates.length,
    evidencePackUniquePassages: unique(packCandidates.map((candidate) => candidate.passageId)),
    retrievalLaneCounts: laneCounts,
    sourceDiversity: unique(allWorks) ? unique(allWorks) / Math.max(1, unique(passageIds)) : 0,
  };
}

async function main() {
  const snapshotArg = argOf('--snapshot');
  assert.ok(snapshotArg, 'Pass an explicit --snapshot pointing at an isolated clone.');
  const snapshotDir = assertIsSafeSnapshot(snapshotArg);
  assertSnapshotVaultMetadata(snapshotDir);
  const phase = parseEvidencePhase(argOf('--phase', 'snapshot'));
  const version = parseEvidenceVersion(argOf('--version', 'v2'));
  const objective = String(argOf('--objective', '')).trim();
  const planPathArg = argOf('--plan-file');
  const outputPath = path.resolve(argOf(
    '--out',
    path.join(repoRoot, 'reports/deep-research-professional/luna-evidence', `${phase}-${version}.json`),
  ));
  assert.ok(phase === 'snapshot' ? objective : (objective || planPathArg), 'Snapshot phase needs --objective; sections phase needs --plan-file or --objective.');
  if (phase === 'sections') assert.ok(planPathArg, 'Sections phase needs an explicit --plan-file.');
  const planPath = planPathArg ? path.resolve(planPathArg) : null;
  if (planPath) assert.ok(fs.existsSync(planPath), `Missing plan file: ${planPath}`);

  if (!process.argv.includes(ELECTRON_FLAG)) {
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), ELECTRON_FLAG], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    });
    return;
  }

  installRuntimeHooks(snapshotDir);
  let closeDb = () => undefined;
  try {
    const { getApiKey } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
    const { getSettings, updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
    const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
    closeDb = close;
    const workshop = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
    const builder = version === 'v1'
      ? workshop.buildHistoricalWritingWorkshopSnapshot
      : workshop.buildIdeaFirstWritingWorkshopSnapshot;
    const retriever = version === 'v1'
      ? workshop.retrieveSectionMaterialLegacy
      : workshop.retrieveSectionMaterial;

    // This clone is allowed to hold the copied embedding secret. Generation is
    // disabled at settings level and this module never imports/calls completeText.
    assert.ok(getApiKey('openrouter'), 'The isolated clone has no copied OpenRouter key.');
    updateSettings({
      embeddingProvider: 'openrouter',
      embeddingModel: 'baai/bge-m3',
      deepResearchModel: null,
      synthesisModel: null,
      documentIndexingEnabled: false,
      syncMode: 'manual',
      mcpEnabled: false,
      nodusServerEnabled: false,
      localServerEnabled: false,
    });
    const settings = getSettings();
    assert.equal(settings.embeddingProvider, 'openrouter');
    assert.equal(settings.embeddingModel, 'baai/bge-m3');

    const brief = { kind: 'deep_research', objective: objective || inferObjective(planPath), language: 'es', deepResearchVersion: version };
    assert.ok(brief.objective.trim(), 'An objective is required for the evidence export.');
    const snapshot = await builder(brief);
    const catalog = buildCompleteCitationCatalog(snapshot);
    const base = {
      generatedAt: new Date().toISOString(),
      objective: brief.objective,
      version,
      retrievalMode: routeForVersion(version).retrievalMode,
      providers: { generation: 'none', embeddings: 'openrouter/baai/bge-m3' },
      isolation: { snapshotDir, databasePath: path.join(snapshotDir, 'nodus.sqlite'), realVaultOpened: false },
      catalog,
      snapshotStats: snapshot.stats,
    };

    let result;
    if (phase === 'snapshot') {
      result = {
        ...base,
        phase,
        planInputs: buildPlanningInput(brief.objective, version, snapshot, catalog),
        snapshot,
        metrics: {
          ideas: snapshot.ideas.length,
          passages: snapshot.passages.length,
          works: snapshot.works.length,
          citableIdeas: catalog.ideas.length,
          citablePassages: catalog.passages.length,
          citableWorks: catalog.works.length,
        },
      };
    } else {
      const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      const plan = raw.plan ?? raw;
      assert.ok(Array.isArray(plan.sections) && plan.sections.length > 0, 'Plan has no sections.');
      const sections = [];
      for (const section of plan.sections) {
        const input = {
          objective: brief.objective,
          sectionTitle: section.title,
          purpose: section.purpose ?? '',
          keyClaims: section.keyClaims ?? [],
          coverageQuestions: section.coverageQuestions ?? [],
          excludeIdeaIds: [],
          excludePassageIds: [],
          limits: { ideas: 12, passages: 12 },
        };
        const retrieved = await retriever(input);
        const workIds = new Set([
          ...retrieved.ideas.flatMap((idea) => (idea.works ?? []).map((work) => work.nodus_id)),
          ...retrieved.passages.map((passage) => passage.nodus_id),
        ].filter(Boolean));
        sections.push({
          id: section.id,
          title: section.title,
          purpose: section.purpose ?? '',
          keyClaims: section.keyClaims ?? [],
          coverageQuestions: section.coverageQuestions ?? [],
          retrievalInput: input,
          works: [...workIds],
          ideas: retrieved.ideas.map((idea) => ({
            id: idea.id,
            label: idea.label,
            statement: idea.statement,
            summary: idea.summary,
            score: idea.score,
            works: (idea.works ?? []).map((work) => ({ nodusId: work.nodus_id, title: work.title, authors: work.authors, year: work.year })),
          })),
          passages: retrieved.passages.map((passage) => ({
            id: passage.id,
            nodusId: passage.nodus_id,
            label: passage.label,
            pageLabel: passage.pageLabel,
            summary: passage.summary,
            score: passage.score,
            reason: passage.reason,
            citation: passage.citation,
          })),
          evidencePacks: retrieved.evidencePacks ?? [],
        });
      }
      result = {
        ...base,
        phase,
        planPath,
        plan,
        planInputs: { objective: brief.objective, version, sections: sections.map((section) => section.retrievalInput) },
        sections,
        metrics: summarizeEvidence(sections),
      };
    }

    // Confirm SQLite itself points at the supplied clone, not merely the app hook.
    const openedPath = getDb().prepare('PRAGMA database_list').all().find((row) => row.name === 'main')?.file;
    assert.equal(fs.realpathSync(openedPath), fs.realpathSync(path.join(snapshotDir, 'nodus.sqlite')));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ outputPath, phase, version, ...result.metrics, realVaultOpened: false }, null, 2));
  } finally {
    try { closeDb(); } catch { /* best effort */ }
  }
}

function inferObjective(file) {
  const name = path.basename(file || '');
  if (name.startsWith('tourism-plan-')) return 'Analizar el turismo como aparato de propaganda y legitimación durante el franquismo, atendiendo a la organización, competencias y evolución de la Dirección General de Turismo y del Ministerio de Información y Turismo; la producción y distribución de material fotográfico; itinerarios, Paradores, guías, oficinas y campañas internacionales; y el debate sobre la eficacia real de estos dispositivos sin presuponer control total de la recepción.';
  return '';
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-luna-evidence',
      getAppPath: () => repoRoot,
      isPackaged: false,
      getName: () => 'Nodus',
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
    net: {},
  };
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  for (const ext of ['.ts', '.tsx']) {
    require.extensions[ext] = (module, filename) => {
      const source = fs.readFileSync(filename, 'utf8');
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
        },
        fileName: filename,
      }).outputText;
      module._compile(output, filename);
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
