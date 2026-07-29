// Live, isolated verification of every text-generating AI surface in the Databases
// vault. Image-generation columns are deliberately excluded: this audit is restricted
// to Gemini Flash-Lite and that feature requires a dedicated image-generation model.
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
  process.env.NODUS_DATABASE_AI_REPORT || path.join(os.tmpdir(), 'nodus-database-ai-shadow-report.json'),
);

if (!process.argv.includes('--electron-database-ai-shadow')) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-database-ai-shadow.mjs'), '--electron-database-ai-shadow'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey);
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-ai-shadow-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
let clearKey = () => undefined;
const startedAt = Date.now();

try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const aiColumn = require(path.join(repoRoot, 'electron/ai/databaseAiColumn.ts'));
  const analysis = require(path.join(repoRoot, 'electron/ai/databaseAnalysis.ts'));
  const chat = require(path.join(repoRoot, 'electron/ai/databaseChat.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  secrets.setApiKey('gemini', apiKey);
  clearKey = () => secrets.clearApiKey('gemini');
  delete process.env.GEMINI_API_KEY;
  const modelId = 'gemini-3.5-flash-lite';
  const available = await providers.listModels('gemini', secrets.getApiKey('gemini'));
  assert.ok(available.some((candidate) => candidate.id === modelId), `${modelId} is available`);
  const model = { provider: 'gemini', model: modelId };
  settings.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    studyAiEnabled: true,
    studyAiPrivacyMode: 'balanced',
    studyAiLocalOnly: false,
    studyAiConfirmExternal: false,
    chatModel: model,
    synthesisModel: model,
  });

  const database = repo.createDatabase('Ventas regionales ficticias');
  const product = repo.createColumn(database.id, 'Producto', 'title');
  const price = repo.createColumn(database.id, 'Precio', 'number');
  const units = repo.createColumn(database.id, 'Unidades', 'number');
  const region = repo.createColumn(database.id, 'Región', 'select');
  const date = repo.createColumn(database.id, 'Fecha', 'date');
  const summary = repo.createColumn(database.id, 'Resumen IA', 'ai', {
    aiPrompt: 'Resume esta fila en una sola frase factual. No inventes valores.',
    aiModel: model,
  });
  const north = repo.addOption(region.id, 'Norte');
  const south = repo.addOption(region.id, 'Sur');
  const fixture = [
    ['Atlas', 10, 1, north.id, '2025-01-10'],
    ['Boreal', 20, 2, north.id, '2025-01-20'],
    ['Ceres', 30, 3, north.id, '2025-02-05'],
    ['Duna', 40, 4, north.id, '2025-02-15'],
    ['Eco', 5, 1, south.id, '2025-03-01'],
    ['Faro', 8, 2, south.id, '2025-03-10'],
    ['Gema', 12, 3, south.id, '2025-04-01'],
    ['Helio', 15, 4, south.id, '2025-04-20'],
  ];
  const rows = fixture.map(([name, amount, count, area, when]) => {
    const row = repo.createRow(database.id);
    repo.setCell(row.id, product.id, String(name));
    repo.setCell(row.id, price.id, String(amount));
    repo.setCell(row.id, units.id, String(count));
    repo.setCell(row.id, region.id, String(area));
    repo.setCell(row.id, date.id, String(when));
    return row;
  });

  const cellText = await aiColumn.runAiCell(rows[0].id, summary.id);
  assert.ok(cellText.length > 10);
  assert.match(cellText, /Atlas/i);
  assert.match(cellText, /10/);
  assert.equal(repo.getRow(rows[0].id).cells[summary.id], cellText, 'AI cell is persisted in the intended cell');

  const profileReport = await analysis.generateAnalysisReport(database.id, { model });
  assert.ok(profileReport.report.length > 80);
  assert.match(profileReport.profileText, /8 filas/i);
  assert.match(profileReport.report, /8/);

  const suggested = await analysis.suggestDatabaseAnalyses(database.id, { model });
  assert.ok(suggested.suggestions.length >= 1);
  const validKinds = new Set(
    ['descriptive', 'correlation', 'correlation_matrix', 'covariance_matrix', 'chi_square',
      'crosstab', 'group_compare', 'top_values', 'time_series', 'data_quality'],
  );
  assert.ok(suggested.suggestions.every((item) => validKinds.has(item.kind)));
  const actualColumnIds = new Set(repo.getColumns(database.id).map((column) => column.id));
  assert.ok(suggested.suggestions.every((item) => item.columns.every((id) => actualColumnIds.has(id))));

  const computed = analysis.runDatabaseAnalysis(database.id, {
    kind: 'correlation',
    columns: [price.id, units.id],
  });
  assert.equal(computed.result.kind, 'correlation');
  assert.ok(Number.isFinite(computed.result.pearson.r));
  const narration = await analysis.narrateAnalysisResult(computed.result, { model });
  assert.ok(narration.length > 40);
  assert.match(narration, /correl|Pearson|relaci[oó]n/i);

  const deltas = [];
  const chatAnswer = await chat.streamDatabaseChat(
    {
      databaseIds: [database.id],
      question: '¿Cuántas filas hay y qué producto tiene el precio 40? Responde solo con datos verificables.',
      history: [],
    },
    (delta) => { if (delta) deltas.push(delta); },
  );
  assert.ok(deltas.length > 0, 'database chat streams visible text deltas');
  assert.match(chatAnswer.text, /8/);
  assert.match(chatAnswer.text, /Duna/i);
  assert.doesNotMatch(chatAnswer.text, /9 filas|precio 40.*(?:Atlas|Boreal|Ceres|Eco|Faro|Gema|Helio)/i);

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    provider: 'gemini',
    model: modelId,
    fixture: { rows: fixture.length, columns: repo.getColumns(database.id).length },
    aiColumn: { persisted: true, chars: cellText.length },
    profileReport: { profileChars: profileReport.profileText.length, reportChars: profileReport.report.length },
    suggestions: suggested.suggestions.length,
    deterministicAnalysis: { kind: computed.result.kind, pearson: computed.result.pearson.r },
    narration: { chars: narration.length },
    chat: { streamedDeltas: deltas.length, chars: chatAnswer.text.length, grounded: true },
    imageGeneration: { liveCallSkippedByModelRestriction: true, deterministicContractCoveredSeparately: true },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Databases AI verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  try { clearKey(); } catch { /* isolated profile is deleted next */ }
  try { closeDb(); } catch { /* database may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-database-ai-shadow',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
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
