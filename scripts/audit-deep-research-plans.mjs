// Low-cost gate for the idea-first Deep Research architecture. It executes the
// production retriever and planner against an isolated vault clone, then compares
// the resulting outline with the outline of each saved historical report. No
// section or full report is generated here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-plan-audit';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-professional-audit-1c35')));
const outputDir = path.resolve(argOf('--out', path.join(repoRoot, 'reports/deep-research-professional/idea-first-plans')));
const historicalDir = path.resolve(argOf('--historical', path.join(repoRoot, 'reports/deep-research-professional/historical')));
const only = argOf('--benchmark', '').trim();
const judgeOnly = process.argv.includes('--judge-only');
const externalPlanPath = argOf('--plan-file', '').trim();

if (!process.argv.includes(FLAG)) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Gemini key is required for the isolated plan audit.');
  assert.ok(process.env.OPENROUTER_API_KEY?.trim(), 'OpenRouter key is required for BAAI/BGE-M3.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.exit(0);
}

assert.ok(fs.existsSync(path.join(snapshotDir, 'nodus.sqlite')), `Missing isolated snapshot: ${snapshotDir}`);
fs.mkdirSync(outputDir, { recursive: true });
installRuntimeHooks(snapshotDir);

let closeDb = () => undefined;
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  secrets.setApiKey('gemini', process.env.GEMINI_API_KEY.trim());
  secrets.setApiKey('openrouter', process.env.OPENROUTER_API_KEY.trim());
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const available = await providers.listModels('gemini', secrets.getApiKey('gemini'));
  assert.ok(available.some((model) => model.id === 'gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite is unavailable.');
  const textModel = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
  settingsRepo.updateSettings({
    deepResearchModel: textModel,
    synthesisModel: textModel,
    documentProfileModel: textModel,
    documentAuditModel: textModel,
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
    syncMode: 'manual',
    documentIndexingEnabled: false,
    libraryGlobalEnabled: false,
    mcpEnabled: false,
    nodusServerEnabled: false,
    localServerEnabled: false,
  });

  const { generateDeepResearchPlanPreview } = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
  const { completeJson } = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const files = fs.readdirSync(historicalDir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'manifest.json')
    .filter((name) => !only || name === `${only}.json`)
    .sort();
  assert.ok(files.length > 0, 'No historical benchmarks selected.');

  const results = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/u, '');
    const historical = JSON.parse(fs.readFileSync(path.join(historicalDir, file), 'utf8'));
    const oldReport = historical.report ?? historical;
    const objective = historical.metrics?.objective ?? oldReport.draft?.brief?.objective;
    assert.ok(objective, `Missing objective in ${file}`);
    console.log(`\n[plan] ${slug}`);
    const started = Date.now();
    const oldPlan = planFromHistorical(oldReport);
    const previousPath = path.join(outputDir, `${slug}.json`);
    const previous = judgeOnly && fs.existsSync(previousPath)
      ? JSON.parse(fs.readFileSync(previousPath, 'utf8'))
      : null;
    const externalPlan = externalPlanPath
      ? JSON.parse(fs.readFileSync(path.resolve(externalPlanPath), 'utf8'))
      : null;
    const overridePlan = externalPlan ? (externalPlan.plan ?? externalPlan) : null;
    const overrideCoverage = overridePlan?.sections.flatMap((section) => section.coverageQuestions ?? []) ?? [];
    const preview = overridePlan ? await generateDeepResearchPlanPreview({
      objective,
      audience: oldReport.draft?.brief?.audience ?? 'comunidad académica',
      language: 'es',
      approach: 'general',
      model: textModel,
      coverageQuestions: overrideCoverage,
    }, { auditEvidence: true, planOverride: overridePlan }) : previous ? {
      plan: previous.ideaFirstRawPlan ?? previous.ideaFirstPlan,
      coverageQuestions: previous.coverageQuestions ?? [],
      fallbackUsed: previous.fallbackUsed,
      snapshotStats: previous.snapshotStats,
      planningIdeas: previous.planningIdeas ?? [],
    } : await generateDeepResearchPlanPreview({
      objective,
      audience: oldReport.draft?.brief?.audience ?? 'comunidad académica',
      language: 'es',
      approach: 'general',
      model: textModel,
    }, { auditEvidence: true });
    assert.equal(preview.snapshotStats.passages, 0, 'idea-first planning must receive zero passages');
    assert.equal(preview.fallbackUsed, false, 'the live planner must not silently fall back');
    const newPlan = planFromPreview(preview.plan);
    const historicalScore = await scorePlan(completeJson, objective, oldPlan, textModel);
    const ideaFirstScore = await scorePlan(completeJson, objective, newPlan, textModel);
    const normal = await comparePlans(completeJson, objective, oldPlan, newPlan, {
      labelA: 'Plan histórico guardado en Nodus',
      labelB: 'Plan candidato idea-first',
      blind: false,
    }, textModel);
    const blindAB = await comparePlans(completeJson, objective, oldPlan, newPlan, { labelA: 'Plan A', labelB: 'Plan B', blind: true }, textModel);
    const blindBA = await comparePlans(completeJson, objective, newPlan, oldPlan, { labelA: 'Plan A', labelB: 'Plan B', blind: true }, textModel);
    const blindWinner = blindAB.winner === 'tie' || blindBA.winner === 'tie'
      ? 'tie'
      : blindAB.winner === 'A' && blindBA.winner === 'B'
        ? 'historical'
        : blindAB.winner === 'B' && blindBA.winner === 'A'
          ? 'idea_first'
          : 'order_sensitive';
    const normalWinner = ideaFirstScore.score > historicalScore.score + 1
      ? 'idea_first'
      : historicalScore.score > ideaFirstScore.score + 1 ? 'historical' : 'tie';
    const result = {
      slug,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      model: textModel,
      embeddings: { provider: 'openrouter', model: 'baai/bge-m3' },
      snapshotStats: preview.snapshotStats,
      fallbackUsed: preview.fallbackUsed,
      coverageQuestions: preview.coverageQuestions,
      planningIdeas: preview.planningIdeas,
      claimAudit: preview.claimAudit ?? null,
      documentPreparation: preview.documentPreparation ?? null,
      qualityPercent: {
        historical: round(historicalScore.score),
        ideaFirst: round(ideaFirstScore.score),
        changePoints: round(ideaFirstScore.score - historicalScore.score),
      },
      judges: { normalWinner, blindWinner, independent: { historical: historicalScore, ideaFirst: ideaFirstScore }, openComparison: normal, blindAB, blindBA },
      historicalPlan: oldPlan,
      ideaFirstPlan: newPlan,
      ideaFirstRawPlan: preview.plan,
    };
    results.push(result);
    fs.writeFileSync(path.join(outputDir, `${slug}.json`), JSON.stringify(result, null, 2));
    console.log(`[judge] normal=${normalWinner} blind=${blindWinner} quality=${result.qualityPercent.historical}%→${result.qualityPercent.ideaFirst}%`);
  }

  const aggregate = {
    generatedAt: new Date().toISOString(),
    isolation: { snapshotDir, realVaultOpened: false },
    model: { ai: 'gemini/gemini-3.1-flash-lite', embeddings: 'openrouter/baai/bge-m3' },
    benchmarks: results.length,
    qualityPercent: {
      historical: round(mean(results.map((item) => item.qualityPercent.historical))),
      ideaFirst: round(mean(results.map((item) => item.qualityPercent.ideaFirst))),
      changePoints: round(mean(results.map((item) => item.qualityPercent.changePoints))),
    },
    normalWins: tally(results.map((item) => item.judges.normalWinner)),
    blindWins: tally(results.map((item) => item.judges.blindWinner)),
    results: results.map((item) => ({
      slug: item.slug,
      qualityPercent: item.qualityPercent,
      normalWinner: item.judges.normalWinner,
      blindWinner: item.judges.blindWinner,
      snapshotStats: item.snapshotStats,
    })),
  };
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(aggregate, null, 2));
  console.log(`\n${JSON.stringify(aggregate, null, 2)}`);
} finally {
  try { closeDb(); } catch { /* best effort */ }
}

function planFromHistorical(report) {
  return {
    title: report.draft?.title ?? '',
    abstract: report.draft?.abstract ?? '',
    sections: (report.draft?.outline ?? []).map((section) => ({
      title: section.title,
      purpose: section.purpose,
      keyClaims: section.keyClaims ?? [],
    })),
  };
}

function planFromPreview(plan) {
  return {
    title: plan.title,
    abstract: plan.abstract,
    sections: plan.sections.map((section) => ({
      title: section.title,
      purpose: section.purpose,
      keyClaims: section.keyClaims,
    })),
  };
}

async function comparePlans(completeJson, objective, a, b, labels, model) {
  const system = [
    'Eres un evaluador académico exigente. Comparas dos esquemas para el mismo informe sin juzgar la prosa final ni contar fuentes.',
    labels.blind
      ? 'No conoces el origen de A y B. Ignora el orden y toda suposición sobre cuál es nuevo.'
      : 'Conoces las etiquetas de los sistemas, pero debes decidir exclusivamente por el contenido visible.',
    'Puntúa cada plan de 0 a 100 por tesis interpretativa, progresión argumental, relevancia para el objetivo, potencial de profundidad y ausencia de fragmentación temática.',
    'Favorece títulos que formulen hallazgos o proposiciones y secciones donde cada conclusión sea necesaria para la siguiente.',
    'Penaliza listas de temas, compartimentos artificiales, causalidades impuestas, repetición de la pregunta y esquemas que parecen exhaustivos pero no sostienen una tesis.',
    'Elige A, B o tie. Devuelve SOLO JSON válido: {"winner":"A|B|tie","scoreA":0,"scoreB":0,"dimensions":{"thesis":"A|B|tie","progression":"A|B|tie","relevance":"A|B|tie","depth":"A|B|tie","coherence":"A|B|tie"},"reason":"..."}.',
  ].join('\n');
  const user = JSON.stringify({ objective, [labels.labelA]: a, [labels.labelB]: b }, null, 2);
  return completeJson({ system, user, temperature: 0, maxTokens: 1800 }, isPlanJudgement, model);
}

async function scorePlan(completeJson, objective, plan, model) {
  const system = [
    'Eres un evaluador académico exigente. Evalúas UN solo esquema para el objetivo recibido, sin compararlo con ninguna alternativa y sin inferir su origen.',
    'Puntúa cinco dimensiones de 0 a 20: thesis, progression, scope, caution y depth.',
    'thesis mide si existe una tesis interpretativa específica y defendible. progression mide si cada sección establece algo necesario para la siguiente. scope mide si cubre los mecanismos y límites explícitos del objetivo sin reintroducir exclusiones. caution mide si evita control total, causalidad, intención o eficacia no demostradas. depth mide el potencial de desarrollar mecanismos, debates y consecuencias en lugar de enumerar temas.',
    'La puntuación total score debe ser exactamente la suma de las cinco dimensiones, entre 0 y 100.',
    'Devuelve SOLO JSON válido: {"score":0,"dimensions":{"thesis":0,"progression":0,"scope":0,"caution":0,"depth":0},"strengths":["..."],"weaknesses":["..."]}.',
  ].join('\n');
  return completeJson(
    { system, user: JSON.stringify({ objective, plan }, null, 2), temperature: 0, maxTokens: 1600 },
    isPlanScore,
    model,
  );
}

function isPlanJudgement(value) {
  return value && typeof value === 'object'
    && ['A', 'B', 'tie'].includes(value.winner)
    && Number.isFinite(value.scoreA)
    && Number.isFinite(value.scoreB);
}

function isPlanScore(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.score) || !value.dimensions) return false;
  const values = ['thesis', 'progression', 'scope', 'caution', 'depth'].map((key) => value.dimensions[key]);
  return values.every((item) => Number.isFinite(item) && item >= 0 && item <= 20)
    && Math.abs(values.reduce((sum, item) => sum + item, 0) - value.score) < 0.01;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function round(value) {
  return Number(value.toFixed(1));
}
function tally(values) {
  return values.reduce((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {});
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-plan-audit',
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
