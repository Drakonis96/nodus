// Live, isolated provider contract for the exact low-cost models used by the AI audit.
// Secrets enter only through the environment, are copied to an ephemeral Nodus profile,
// and are never written to the report or printed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const reportPath = path.resolve(
  process.env.NODUS_AI_PROVIDER_REPORT
    || path.join(os.tmpdir(), 'nodus-ai-provider-contract-report.json'),
);
const generationModelId = 'gemini-3.5-flash-lite';
const embeddingModelId = 'baai/bge-m3';

if (!process.argv.includes('--electron-ai-provider-contract')) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Set GEMINI_API_KEY for this isolated run.');
  assert.ok(process.env.OPENROUTER_API_KEY?.trim(), 'Set OPENROUTER_API_KEY for this isolated run.');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-ai-provider-contract.mjs'), '--electron-ai-provider-contract'],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

const geminiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
assert.ok(geminiKey, 'Gemini key is available only to this isolated process.');
assert.ok(openRouterKey, 'OpenRouter key is available only to this isolated process.');

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-provider-contract-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
let clearKeys = () => undefined;
const startedAt = Date.now();
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const ai = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  clearKeys = () => {
    secrets.clearApiKey('gemini');
    secrets.clearApiKey('openrouter');
  };
  secrets.setApiKey('gemini', geminiKey);
  secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const [generationModels, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('openrouter', secrets.getApiKey('openrouter')),
  ]);
  assert.ok(
    generationModels.some((model) => model.id === generationModelId),
    `${generationModelId} is present in Gemini's live model catalogue.`,
  );
  assert.ok(
    embeddingModels.some((model) => model.id === embeddingModelId),
    `${embeddingModelId} is present in OpenRouter's live embedding catalogue.`,
  );

  const generationModel = { provider: 'gemini', model: generationModelId };
  settingsRepo.updateSettings({
    promptLanguage: 'es',
    uiLanguage: 'es',
    modelSettingsMode: 'advanced',
    synthesisModel: generationModel,
    extractionModel: generationModel,
    summaryModel: generationModel,
    fusionModel: generationModel,
    chatModel: generationModel,
    nodiModel: generationModel,
    deepResearchModel: generationModel,
    immersionModel: generationModel,
    writingModel: generationModel,
    argumentMapModel: generationModel,
    authorModel: generationModel,
    studyModel: generationModel,
    tutorModel: generationModel,
    hypothesisModel: generationModel,
    improveModel: generationModel,
    questionGenModel: generationModel,
    gradingModel: generationModel,
    flashcardModel: generationModel,
    embeddingProvider: 'openrouter',
    embeddingModel: embeddingModelId,
    chatReasoning: 'off',
  });

  const plain = await ai.completeText({
    system: 'Eres un comprobador de contrato. Sigue la instrucción literalmente.',
    user: 'Responde únicamente con la cadena NODUS_PROVIDER_OK.',
    temperature: 0,
    maxTokens: 32,
    noRetry: true,
    timeoutMs: 60_000,
    plainContext: true,
    skipStudentPseudonyms: true,
  }, generationModel);
  assert.equal(
    plain.trim().replace(/^["'`]+|["'`]+$/g, ''),
    'NODUS_PROVIDER_OK',
    'Gemini plain-text completion preserves a deterministic sentinel.',
  );

  const isContractJson = (value) => (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'ok'
    && value.count === 3
    && Array.isArray(value.items)
    && value.items.length === 3
    && value.items.every((item) => typeof item === 'string')
  );
  const structured = await ai.completeJson({
    system: [
      'Devuelve exclusivamente JSON válido.',
      'El esquema exacto es {"status":"ok","count":3,"items":["archivo","fuente","cita"]}.',
      'No añadas campos ni Markdown.',
    ].join(' '),
    user: 'Genera exactamente el objeto solicitado.',
    temperature: 0,
    maxTokens: 128,
    noRetry: true,
    timeoutMs: 60_000,
    plainContext: true,
    skipStudentPseudonyms: true,
  }, isContractJson, generationModel);
  assert.ok(isContractJson(structured), 'Gemini structured completion passes the runtime schema guard.');

  const contentDeltas = [];
  const reasoningDeltas = [];
  const streamed = await ai.completeTextStream({
    system: 'Eres un comprobador de streaming. No expliques nada.',
    user: 'Escribe exactamente: STREAMING FUNCIONA',
    temperature: 0,
    maxTokens: 32,
    noRetry: true,
    timeoutMs: 60_000,
    plainContext: true,
    skipStudentPseudonyms: true,
  }, (delta, kind) => {
    if (kind === 'reasoning') reasoningDeltas.push(delta);
    else contentDeltas.push(delta);
  }, generationModel);
  assert.ok(contentDeltas.length > 0, 'Gemini emitted at least one visible content delta.');
  assert.equal(contentDeltas.join(''), streamed, 'Streaming deltas reconstruct the returned answer exactly.');
  assert.match(streamed.toUpperCase(), /STREAMING\s+FUNCIONA/, 'The streamed answer preserves the requested content.');

  const singleVector = await ai.embed('Archivo parroquial con actas históricas de bautismo.');
  assert.ok(singleVector, 'BGE-M3 returned a vector for a single input.');
  assert.equal(singleVector.length, 1024, 'BGE-M3 returns the expected 1024 dimensions.');
  assert.ok(singleVector.every(Number.isFinite), 'Every BGE-M3 component is finite.');
  assert.ok(singleVector.some((value) => value !== 0), 'The BGE-M3 vector is non-zero.');

  const vectors = await ai.embedMany([
    'El archivo parroquial conserva actas históricas de bautismo.',
    'The parish archive preserves historical baptism records.',
    'Una receta de sopa de calabaza con jengibre.',
  ]);
  assert.equal(vectors.length, 3, 'Batch embedding preserves cardinality.');
  assert.ok(vectors.every((vector) => vector?.length === 1024), 'Every batch vector has 1024 dimensions.');
  const relatedSimilarity = cosine(vectors[0], vectors[1]);
  const unrelatedSimilarity = cosine(vectors[0], vectors[2]);
  assert.ok(
    relatedSimilarity > unrelatedSimilarity,
    `BGE-M3 multilingual semantic similarity ranks related evidence first (${relatedSimilarity} > ${unrelatedSimilarity}).`,
  );

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    generation: {
      provider: 'gemini',
      model: generationModelId,
      catalogueMatch: true,
      textContract: true,
      jsonContract: true,
      streamingContract: true,
      contentDeltaEvents: contentDeltas.length,
      reasoningDeltaEvents: reasoningDeltas.length,
    },
    embeddings: {
      provider: 'openrouter',
      model: embeddingModelId,
      catalogueMatch: true,
      dimensions: singleVector.length,
      batchSize: vectors.length,
      finite: true,
      nonZero: true,
      multilingualRelatedSimilarity: relatedSimilarity,
      unrelatedSimilarity,
      semanticRanking: relatedSimilarity > unrelatedSimilarity,
    },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated AI provider contract passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try { clearKeys(); } catch { /* the whole profile is deleted below */ }
  try { closeDb(); } catch { /* the database may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

function cosine(left, right) {
  assert.ok(left && right && left.length === right.length, 'Comparable embedding vectors exist.');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  assert.ok(leftNorm > 0 && rightNorm > 0, 'Embedding norms are non-zero.');
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-ai-provider-contract',
      getAppPath: () => repoRoot,
      isPackaged: false,
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
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
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
