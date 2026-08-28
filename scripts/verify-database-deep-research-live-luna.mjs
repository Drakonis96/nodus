// Opt-in, Luna-only generative quality gate for Database Deep Research.
// A full batch is 9 report types × 8 languages × 3 independent reports = 216.
// Each report exercises planner, critic, verifier, writer, one editor revision,
// and a blind judge in both A/B orders. Two full passing batches close the gate.
//
// NODUS_DB_RESEARCH_LIVE=1 node scripts/verify-database-deep-research-live-luna.mjs
// Smoke: ... --batches 1 --report-types 1 --languages 1 --generations 1
// Stratified: ... --batches 1 --report-types 9 --languages 8 --generations 1 --sampling paired

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = path.join(root, 'node_modules/.bin/electron');
const flag = '--electron-database-deep-research-live-luna';
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

if (!process.argv.includes(flag)) {
  if (process.env.NODUS_DB_RESEARCH_LIVE !== '1') {
    console.log('Live harness is opt-in; set NODUS_DB_RESEARCH_LIVE=1.');
    process.exit(0);
  }
  execFileSync(electron, [...process.argv.slice(1), flag], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
  process.exit(0);
}

const modelName = arg('--model', process.env.NODUS_DB_RESEARCH_LIVE_MODEL ?? 'gpt-5.6-luna');
assert.match(modelName, /^gpt-5\.6-luna(?:[-:].*)?$/i, 'live harness only accepts gpt-5.6-luna variants');
const model = { provider: 'codex', model: modelName };
const batches = Math.max(1, Math.min(2, Number(arg('--batches', '2')) || 2));
const reportLimit = Math.max(1, Math.min(9, Number(arg('--report-types', '9')) || 9));
const languageLimit = Math.max(1, Math.min(8, Number(arg('--languages', '8')) || 8));
const generations = Math.max(1, Math.min(3, Number(arg('--generations', '3')) || 3));
const sampling = arg('--sampling', 'cartesian');
assert.ok(['cartesian', 'paired'].includes(sampling), 'sampling must be cartesian or paired');
const outFile = path.resolve(arg('--out', path.join(os.tmpdir(), 'nodus-database-deep-research-luna.json')));

const connectedUserData = process.env.NODUS_DB_RESEARCH_CODEX_USER_DATA?.trim();
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-db-research-luna-runtime-'));
if (connectedUserData) {
  const subscriptionSource = path.join(path.resolve(connectedUserData), 'codex-subscription');
  assert.ok(fs.existsSync(subscriptionSource), 'connected Codex subscription profile not found');
  // Copy only the Codex auth directory into an ephemeral profile. Importing
  // aiClient also initializes Nodus repositories; pointing it at the real
  // profile could run migrations or retention against user data.
  fs.cpSync(subscriptionSource, path.join(runtimeDir, 'codex-subscription'), { recursive: true, force: false });
}
installRuntimeHooks(runtimeDir);
process.on('exit', () => { try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch {} });
const prompts = require(path.join(root, 'shared/databaseDeepResearchPrompts.ts'));
const client = require(path.join(root, 'electron/ai/aiClient.ts'));
const reportTypes = ['general', 'data_quality', 'cohort_comparison', 'temporal_anomalies', 'relationships_integrity', 'causal_impact', 'survival_retention', 'privacy_attachments', 'formulas_reconciliation'].slice(0, reportLimit);
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'].slice(0, languageLimit);
const dimensions = ['numerical_accuracy', 'traceability', 'statistical_coverage', 'selection_intelligence', 'professional_narrative', 'model_use', 'security_robustness', 'visual_communication'];

const complete = async (role, reportType, language, objective, context, guard, maxTokens = 2200) => {
  const prompt = prompts.buildDatabaseDeepResearchPrompt({ role, reportType, language, objective, context: JSON.stringify(context) });
  return client.completeJson({ system: prompt.system, user: prompt.user, temperature: 0, maxTokens, reasoning: 'off', noRetry: true }, guard, model);
};

const narrativeHasLiteralNumbers = (value) => {
  const strings = [value.title, value.summary, ...value.sections.flatMap((section) => [section.heading, ...section.paragraphs.map((paragraph) => paragraph.textTemplate)])];
  return strings.some((value) => /\d/.test(String(value).replace(/\{\{artifact:[^}]+\}\}/g, '')));
};

const results = [];
for (let batch = 0; batch < batches; batch += 1) {
  let batchPassed = true;
  const combinations = sampling === 'paired'
    ? reportTypes.map((reportType, index) => [reportType, languages[index % languages.length]])
    : reportTypes.flatMap((reportType) => languages.map((language) => [reportType, language]));
  for (const [reportType, language] of combinations) for (let generation = 0; generation < generations; generation += 1) {
    const artifactId = `artifact-${batch}-${reportType}-${language}-${generation}`;
    const objective = 'Find decision-relevant patterns using only the approved deterministic artifact ledger.';
    const ledger = [{
      artifactId,
      method: 'robustSummary',
      columns: ['metric_anonymized'],
      filters: { query: '', columnIds: [] },
      n: 128,
      denominator: 128,
      hash: 'a'.repeat(64),
      status: 'verified',
      output: { mean: 12.5, median: 11.9, lower: 10.2, upper: 14.1 },
    }];
    const schema = { rowCount: 128, columnTypes: ['number', 'date', 'select'], roles: { metrics: ['metric_anonymized'], time: 'time_anonymized' }, allowedOperations: ['robustSummary', 'bootstrap', 'missingness'] };
    const started = Date.now();
    const planner = await complete('planner', reportType, language, objective, { schema, ledger: [] }, prompts.isDatabaseDeepResearchPlannerOutput);
    const critic = await complete('critic', reportType, language, objective, { schema, planner, ledger }, prompts.isDatabaseDeepResearchCriticOutput);
    const verifier = await complete('verifier', reportType, language, objective, { claims: [{ claimId: artifactId, artifactRefs: [artifactId] }], ledger }, prompts.isDatabaseDeepResearchVerifierOutput);
    const writer = await complete('writer', reportType, language, objective, { schema, planner, critic, verifier, ledger, placeholderExample: `{{artifact:${artifactId}:output.mean}}` }, prompts.isDatabaseDeepResearchNarrativeOutput, 3200);
    const approved = new Set([artifactId]);
    const writerGate = prompts.validateDatabaseDeepResearchNarrative(writer, approved);
    assert.equal(writerGate.ok, true, writerGate.errors.join(','));
    assert.equal(narrativeHasLiteralNumbers(writer), false, 'writer introduced a literal number');
    const editor = await complete('editor', reportType, language, objective, { draft: writer, critic, verifier, ledger, approvedArtifactIds: [...approved] }, prompts.isDatabaseDeepResearchNarrativeOutput, 3200);
    const editorGate = prompts.validateDatabaseDeepResearchNarrative(editor, approved);
    assert.equal(editorGate.ok, true, editorGate.errors.join(','));
    assert.equal(narrativeHasLiteralNumbers(editor), false, 'editor introduced a literal number');
    const judgeContext = (a, b) => ({ a, b, ledger, requiredDimensions: dimensions, instruction: 'Score each required dimension independently; the revised report must reach at least nine without inventing arithmetic.' });
    const judgeAB = await complete('judge', reportType, language, objective, judgeContext(writer, editor), prompts.isDatabaseDeepResearchJudgeOutput, 2800);
    const judgeBA = await complete('judge', reportType, language, objective, judgeContext(editor, writer), prompts.isDatabaseDeepResearchJudgeOutput, 2800);
    const missingDimensions = dimensions.filter((dimension) => !judgeAB.dimensions[dimension] || !judgeBA.dimensions[dimension]);
    const finalScores = dimensions.map((dimension) => Math.min(judgeAB.dimensions[dimension]?.b ?? 0, judgeBA.dimensions[dimension]?.a ?? 0));
    const passed = missingDimensions.length === 0 && finalScores.every((score) => score >= 9) && judgeAB.defects.length === 0 && judgeBA.defects.length === 0;
    batchPassed &&= passed;
    results.push({ batch, reportType, language, generation, passed, finalScores, missingDimensions, elapsedMs: Date.now() - started });
    process.stdout.write(`${passed ? '✓' : '✗'} ${batch + 1}/${batches} ${reportType}/${language}/${generation + 1}\n`);
  }
  assert.equal(batchPassed, true, `Luna quality batch ${batch + 1} did not reach 9/10 in every dimension`);
}

fs.writeFileSync(outFile, JSON.stringify({ provider: model.provider, model: model.model, batches, reportTypes, languages, generations, sampling, reportsPerFullBatch: 216, dimensions, results }, null, 2), { mode: 0o600 });
console.log(`Wrote ${results.length} complete, blind-judged reports to ${outFile}`);

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-db-research-luna', getAppPath: () => root, isPackaged: false, getName: () => 'Nodus' },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
    net: {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(root, `${request.replace('@shared/', 'shared/')}.ts`);
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
