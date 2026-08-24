// A/B harness for Deep Research against the REAL academic corpus.
//
// Runs `generateDeepResearchReport` headlessly over a consistent read-only
// snapshot of the live vault (VACUUM INTO, so the running app is never touched)
// and dumps the report plus the metrics that matter for report quality:
// how many ideas were *actually cited* versus how many the engine claims to have
// covered, whether the coverage top-up ever fired, and how much evidence
// (passages, gaps, contradictions) reached the prose.
//
// Usage:
//   GEMINI_API_KEY=… node scripts/verify-deep-research-live-gemini.mjs --label before
//
// The snapshot is built once and reused across labels so both sides of the A/B
// see byte-identical corpus state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const FLAG = '--electron-deep-research-live';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const label = argOf('--label', 'run');
const outDir = path.resolve(argOf('--out', path.join(os.tmpdir(), 'nodus-dr-ab')));
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-userdata')));
const sourceDb = argOf('--source-db', path.join(os.homedir(), 'Library/Application Support/nodus/nodus.sqlite'));
const sourceBefore = fs.statSync(sourceDb);

const benchmark = argOf('--benchmark', '').trim();
const benchmarkPayload = benchmark
  ? JSON.parse(fs.readFileSync(path.join(repoRoot, 'reports/deep-research-professional/historical', `${benchmark}.json`), 'utf8'))
  : null;
const benchmarkObjective = benchmarkPayload?.metrics?.objective ?? '';
const benchmarkAudience = benchmarkPayload?.report?.draft?.brief?.audience ?? '';
const OBJECTIVE = benchmarkObjective ||
  argOf(
    '--objective',
    'Analiza cómo el turismo y la literatura de viajes contribuyeron a construir la identidad nacional y regional española durante el franquismo, atendiendo a la cultura visual, la fotografía y los usos propagandísticos del patrimonio.'
  );

// ── Re-exec under Electron's node so better-sqlite3's native ABI matches ──────
if (!process.argv.includes(FLAG)) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || null;
assert.ok(apiKey, 'Gemini key reaches only the isolated child process.');
assert.ok(openRouterKey, 'OpenRouter key is required so embeddings use only baai/bge-m3.');

// ── 1. Consistent snapshot of the live corpus (never touches the original) ────
fs.mkdirSync(snapshotDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const snapshotDb = path.join(snapshotDir, 'nodus.sqlite');
if (!fs.existsSync(snapshotDb)) {
  assert.ok(fs.existsSync(sourceDb), `Source vault not found: ${sourceDb}`);
  const Database = require('better-sqlite3');
  const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
  const started = Date.now();
  source.prepare('VACUUM INTO ?').run(snapshotDb);
  source.close();
  console.log(`[snapshot] built in ${Math.round((Date.now() - started) / 1000)}s → ${snapshotDb}`);
} else {
  console.log(`[snapshot] reusing ${snapshotDb}`);
}

installRuntimeHooks(snapshotDir);

let closeDb = () => undefined;
const phases = [];
const startedAt = Date.now();

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const active = vaults.getActiveVault();
  console.log(`[vault] ${active.name} · type=${active.type} · legacy=${active.legacy}`);
  assert.equal(active.type, 'academic', 'The A/B must run through the academic Deep Research pipeline.');

  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  secrets.setApiKey('gemini', apiKey);
  if (openRouterKey) secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const wanted = argOf('--model', 'gemini-3.1-flash-lite');
  const available = await providers.listModels('gemini', secrets.getApiKey('gemini'));
  const modelName = available.some((m) => m.id === wanted) ? wanted : null;
  assert.equal(modelName, 'gemini-3.1-flash-lite', 'The audit is restricted to gemini-3.1-flash-lite.');
  console.log(`[model] ${modelName}`);

  // Only the Deep Research model is forced. Embedding provider/model stay exactly
  // as the vault has them, or the stored idea/passage vectors stop matching.
  const before = settingsRepo.getSettings();
  const textModel = { provider: 'gemini', model: modelName };
  settingsRepo.updateSettings({
    deepResearchModel: textModel,
    synthesisModel: textModel,
    documentProfileModel: textModel,
    documentAuditModel: textModel,
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
    promptLanguage: 'es',
    syncMode: 'manual',
    autoLightScan: false,
    autoDeepScanOnReadTag: false,
    autoSummaryAfterDeep: false,
    autoBridgeAfterQueue: false,
    autoResumeQueue: false,
    documentIndexingEnabled: false,
    libraryGlobalEnabled: false,
    mcpEnabled: false,
    nodusServerEnabled: false,
    localServerEnabled: false,
  });
  console.log('[embeddings] openrouter · baai/bge-m3');

  // Instrument the per-section retrieval from the outside, so the A/B can show
  // whether it actually fired without the product code knowing it is measured.
  const workshop = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
  const retrieval = { calls: 0, ideas: 0, passages: 0, available: typeof workshop.retrieveSectionMaterial === 'function' };
  if (retrieval.available) {
    const original = workshop.retrieveSectionMaterial;
    workshop.retrieveSectionMaterial = async (input) => {
      retrieval.calls += 1;
      const out = await original(input);
      retrieval.ideas += out?.ideas?.length ?? 0;
      retrieval.passages += out?.passages?.length ?? 0;
      return out;
    };
  }

  const { generateDeepResearchReport } = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
  const report = await generateDeepResearchReport(
    { objective: OBJECTIVE, language: 'es',audience: benchmarkAudience || 'comunidad académica' },
    (p) => {
      phases.push({ phase: p.phase, message: p.message, words: p.wordsSoFar ?? null });
      console.log(`  · ${p.phase}: ${p.message}`);
    }
  );

  const metrics = measure(report, phases, Date.now() - startedAt, modelName, OBJECTIVE);
  metrics.sectionRetrieval = retrieval;
  metrics.embeddings = { provider: 'openrouter', model: 'baai/bge-m3' };
  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ metrics, report }, null, 2));
  fs.writeFileSync(
    path.join(outDir, `${label}.md`),
    `# ${report.draft.title}\n\n${report.draft.draftMarkdown}\n`
  );
  console.log(`\n=== METRICS (${label}) ===`);
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  try {
    closeDb();
  } catch {
    /* best effort */
  }
  const sourceAfter = fs.statSync(sourceDb);
  assert.deepEqual(
    { dev: sourceAfter.dev, ino: sourceAfter.ino, size: sourceAfter.size, mtimeMs: sourceAfter.mtimeMs },
    { dev: sourceBefore.dev, ino: sourceBefore.ino, size: sourceBefore.size, mtimeMs: sourceBefore.mtimeMs },
    'The real Nodus database must remain byte-state unchanged.',
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────
function measure(report, phases, elapsedMs, model, objective) {
  const md = report.draft.draftMarkdown ?? '';
  const re = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]+)\)/g;
  const cited = { idea: new Set(), work: new Set(), passage: new Set(), gap: new Set(), contradiction: new Set() };
  let total = 0;
  for (const m of md.matchAll(re)) {
    cited[m[2]].add(decodeURIComponent(m[3]));
    total += 1;
  }
  // Count the prose only. Including the reference list makes a report with a longer
  // bibliography look longer than one with more argument in it.
  const words = md
    .split(/^##\s+(?:Referencias|References|Références|Literaturverzeichnis|Kaynakça|Bibliografia|Referências)\s*$/mu)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const claimed = report.meta.ideasCovered;
  const abstract = (report.draft.abstract ?? '').trim();
  return {
    label,
    model,
    objective,
    elapsedSeconds: Math.round(elapsedMs / 1000),
    meta: report.meta,
    prose: { words, pagesAt450: Math.round(words / 450) },
    citations: {
      total,
      ideas: cited.idea.size,
      works: cited.work.size,
      passages: cited.passage.size,
      gaps: cited.gap.size,
      contradictions: cited.contradiction.size,
    },
    // The headline honesty check: how much of the claimed coverage is real.
    coverageHonesty: {
      ideasClaimedCovered: claimed,
      ideasActuallyCited: cited.idea.size,
      ratio: claimed > 0 ? Number((cited.idea.size / claimed).toFixed(3)) : null,
    },
    coverageTopUpRan: phases.some((p) => p.phase === 'coverage'),
    sectionsWritten: report.meta.sections,
    limitations: report.draft.limitations,
    nextSteps: report.draft.nextSteps,
    // The assembled Markdown deliberately contains the abstract once under its own
    // heading. Only flag it when the same abstract was also copied into the body.
    abstractDuplicatedInBody: abstract.length > 0 && md.split(abstract).length - 1 > 1,
    bibliographyEntries: (report.draft.bibliography ?? []).length,
    phases: phases.map((p) => p.phase),
  };
}

// ── Electron/TS runtime hooks (same pattern as the other shadow runners) ──────
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-deep-research-ab',
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
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
